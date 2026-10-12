// Tasks: a calm personal and team to-do list. Lists, smart lists (My Day, Important, Planned...), steps, repeat,
// reminders, assignment, sharing, a week planner, and a calendar export. See docs/specs/tasks.md.
import { tx } from './db.js';
import { str } from './util.js';
import { esc, icon, renderMarkdown } from './render.js';
import { hint, getFlag, setFlag } from './learn.js';
import {
  isDate, addDays, diffDays, mondayOf, dayLabel, fmtDur, parseDuration, REPEAT_RE, repeatLabel, nextOccurrence,
  dueLabel, plannedGroup, PLANNED_ORDER, parseQuickAdd,
} from '../public/taskcore.js';

export const LIMITS = { title: 200, quick: 300, notes: 20000, step: 200, steps: 50, tasksPerList: 2000, lists: 100, listName: 60, group: 40, members: 50 };
const DEFAULT_CAPACITY = 360; // minutes in a planned day before it turns amber
const SMART = {
  'my-day': ['My Day', 'sun'],
  important: ['Important', 'star'],
  planned: ['Planned', 'calendar'],
  assigned: ['Assigned to me', 'user'],
  all: ['All tasks', 'list'],
  completed: ['Completed', 'check'],
};
const LIST_PATH = (id) => `/tasks/lists/${id}`;
const ts = (d) => d.toISOString().slice(0, 19).replace('T', ' '); // 'YYYY-MM-DD HH:MM:SS', the same shape SQLite writes

// ---- time zones: the browser sends its UTC offset in a cookie; dates are plain dates, reminders are UTC ----
const offsetOf = (req) => {
  const m = /(?:^|;\s*)tz=(-?\d{1,4})(?:;|$)/.exec(req.headers.cookie ?? '');
  const n = m ? Number(m[1]) : 0;
  return Math.abs(n) <= 900 ? n : 0;
};
const localDay = (off, now = Date.now()) => new Date(now - off * 60000).toISOString().slice(0, 10);
const toUtc = (local, off) => { // 'YYYY-MM-DDTHH:MM' in the person's time -> 'YYYY-MM-DD HH:MM:SS' UTC
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(local ?? '');
  if (!m || !isDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  return ts(new Date(Date.UTC(y, mo - 1, d, Number(m[2]), Number(m[3])) + off * 60000));
};
const toLocal = (utc, off) => (utc ? new Date(new Date(`${utc.replace(' ', 'T')}Z`) - off * 60000).toISOString().slice(0, 16) : '');

// Only ever send people back to a Tasks page (never an arbitrary address).
const safeReturn = (v, fallback = '/tasks/my-day') => (typeof v === 'string' && /^\/tasks(?:[/?][^\r\n\\]*)?$/.test(v) ? v : fallback);
const withParam = (url, k, v) => `${url}${url.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(v)}`;
const dropParam = (url, k) => url.replace(new RegExp(`([?&])${k}=[^&]*(&|$)`), (m, a, b) => (b ? a : '')).replace(/[?&]$/, '');
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ---- who can see a task ----
// A list is visible to its owner, to everyone when it is a team list, and to named members when it is shared.
// A task is also visible to the person it is assigned to, even from someone else's private list.
const VIS = "(l.owner_id = ? OR l.visibility = 'team' OR (l.visibility = 'shared' AND EXISTS (SELECT 1 FROM task_list_members m WHERE m.list_id = l.id AND m.user_id = ?)) OR t.assignee_id = ?)";
const MINE = '(t.assignee_id = ? OR (t.assignee_id IS NULL AND t.created_by = ?))';
const COLS = `t.*, l.name list_name, l.hue list_hue, l.owner_id list_owner,
  (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id) steps_total,
  (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id AND s.done = 1) steps_done,
  EXISTS (SELECT 1 FROM task_my_day d WHERE d.task_id = t.id AND d.user_id = ? AND d.day = ?) in_day,
  EXISTS (SELECT 1 FROM task_reminders r WHERE r.task_id = t.id AND r.user_id = ?) has_reminder,
  (l.owner_id = ? OR l.visibility = 'team' OR (l.visibility = 'shared' AND EXISTS (SELECT 1 FROM task_list_members m WHERE m.list_id = l.id AND m.user_id = ? AND m.can_edit = 1))) can_edit,
  a.username assignee_name, c.username creator_name, ci.username completer_name,
  (SELECT s.key || '-' || i.num FROM issues i JOIN spaces s ON s.id = i.space_id WHERE i.id = t.link_issue_id) issue_key,
  (SELECT i.title FROM issues i WHERE i.id = t.link_issue_id) issue_title,
  (SELECT p.title FROM pages p WHERE p.id = t.link_page_id) page_title`;
const FROM = 'FROM tasks t JOIN task_lists l ON l.id = t.list_id LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by LEFT JOIN users ci ON ci.id = t.completed_by';

export function mountTasks(app, ctx) {
  const { db, page, notifier, files } = ctx;
  const writer = (u) => u.role !== 'viewer';
  const users = () => db.prepare('SELECT id, username FROM users ORDER BY username COLLATE NOCASE').all();

  // ---- queries ----
  function fetchTasks(user, today, where = '1', params = [], order = 't.position, t.id', limit = 500) {
    return db.prepare(`SELECT ${COLS} ${FROM} WHERE ${VIS} AND (${where}) ORDER BY ${order} LIMIT ${limit}`)
      .all(user.id, today, user.id, user.id, user.id, user.id, user.id, user.id, ...params);
  }
  const countTasks = (user, where, params = []) =>
    db.prepare(`SELECT COUNT(*) n ${FROM} WHERE ${VIS} AND (${where})`).get(user.id, user.id, user.id, ...params).n;
  const getTask = (id, user, today = '') => fetchTasks(user, today, 't.id = ?', [Number(id)])[0] ?? null;
  const getList = (id) => (Number.isInteger(Number(id)) ? db.prepare('SELECT * FROM task_lists WHERE id = ?').get(Number(id)) : undefined);
  // 'owner' | 'edit' | 'view' | null
  function listAccess(list, user) {
    if (!list) return null;
    if (list.owner_id === user.id) return 'owner';
    if (list.visibility === 'team') return writer(user) ? 'edit' : 'view';
    if (list.visibility === 'shared') {
      const m = db.prepare('SELECT can_edit FROM task_list_members WHERE list_id = ? AND user_id = ?').get(list.id, user.id);
      if (m) return m.can_edit && writer(user) ? 'edit' : 'view';
    }
    return null;
  }
  const editableLists = (user) => db.prepare('SELECT * FROM task_lists ORDER BY position, id').all().filter((l) => ['owner', 'edit'].includes(listAccess(l, user)));
  const visibleLists = (user) => db.prepare('SELECT * FROM task_lists ORDER BY position, id').all().filter((l) => listAccess(l, user));
  function ensureDefaultList(user) {
    if (!writer(user) || db.prepare('SELECT 1 FROM task_lists WHERE owner_id = ?').get(user.id)) return;
    db.prepare("INSERT INTO task_lists (owner_id, name, hue, position) VALUES (?, 'Tasks', 7, 0)").run(user.id);
  }
  const defaultList = (user) => {
    ensureDefaultList(user);
    return db.prepare('SELECT * FROM task_lists WHERE owner_id = ? ORDER BY position, id LIMIT 1').get(user.id);
  };
  const capacity = (user) => Number(getFlag(db, user.id, 'task-capacity')) || DEFAULT_CAPACITY;
  const rememberTz = (req) => {
    const off = String(offsetOf(req));
    if (/(?:^|;\s*)tz=/.test(req.headers.cookie ?? '') && getFlag(db, req.user.id, 'tz') !== off) setFlag(db, req.user.id, 'tz', off);
  };

  // minutes planned per day for the person's own incomplete tasks (used for totals and the over-budget warning)
  function dayTotals(user, from) {
    const rows = db.prepare(`SELECT t.due_on, SUM(t.estimate_min) min ${FROM} WHERE ${VIS} AND ${MINE} AND t.completed_at IS NULL AND t.due_on >= ? AND t.estimate_min IS NOT NULL GROUP BY t.due_on`)
      .all(user.id, user.id, user.id, user.id, user.id, from);
    return new Map(rows.map((r) => [r.due_on, r.min]));
  }

  // ---- views ----
  const sumMin = (rows) => rows.reduce((a, t) => a + (t.estimate_min ?? 0), 0);
  function viewRows(view, user, today, q = '') {
    const open = 't.completed_at IS NULL';
    const inDay = 'EXISTS (SELECT 1 FROM task_my_day d WHERE d.task_id = t.id AND d.user_id = ? AND d.day = ?)';
    switch (view) {
      case 'my-day': return {
        open: fetchTasks(user, today, `${open} AND ${inDay}`, [user.id, today]),
        done: fetchTasks(user, today, `t.completed_at IS NOT NULL AND ${inDay}`, [user.id, today], 't.completed_at DESC', 100),
        suggestions: fetchTasks(user, today, `${open} AND t.assignee_id = ? AND t.due_on IS NOT NULL AND t.due_on <= ? AND NOT ${inDay}`, [user.id, addDays(today, 3), user.id, today], 't.due_on, t.id', 30),
      };
      case 'important': return { open: fetchTasks(user, today, `${open} AND t.important = 1 AND ${MINE}`, [user.id, user.id]), done: fetchTasks(user, today, `t.completed_at IS NOT NULL AND t.important = 1 AND ${MINE}`, [user.id, user.id], 't.completed_at DESC', 50) };
      case 'planned': return { open: fetchTasks(user, today, `${open} AND t.due_on IS NOT NULL AND ${MINE}`, [user.id, user.id], 't.due_on, t.position, t.id') };
      case 'assigned': return { open: fetchTasks(user, today, `${open} AND t.assignee_id = ? AND (t.created_by IS NULL OR t.created_by != ?)`, [user.id, user.id], 'c.username COLLATE NOCASE, t.due_on IS NULL, t.due_on, t.id'), done: fetchTasks(user, today, 't.completed_at IS NOT NULL AND t.assignee_id = ? AND (t.created_by IS NULL OR t.created_by != ?)', [user.id, user.id], 't.completed_at DESC', 50) };
      case 'all': return { open: fetchTasks(user, today, open, [], 'l.position, l.id, t.position, t.id', 1000) };
      case 'completed': return { open: [], done: fetchTasks(user, today, q ? "t.completed_at IS NOT NULL AND t.title LIKE ? ESCAPE '\\'" : 't.completed_at IS NOT NULL', q ? [`%${likeEscape(q)}%`] : [], 't.completed_at DESC', 200) };
      default: return { open: [], done: [] };
    }
  }
  const counts = (user, today) => ({
    'my-day': countTasks(user, 't.completed_at IS NULL AND EXISTS (SELECT 1 FROM task_my_day d WHERE d.task_id = t.id AND d.user_id = ? AND d.day = ?)', [user.id, today]),
    important: countTasks(user, `t.completed_at IS NULL AND t.important = 1 AND ${MINE}`, [user.id, user.id]),
    planned: countTasks(user, `t.completed_at IS NULL AND t.due_on IS NOT NULL AND ${MINE}`, [user.id, user.id]),
    overdue: countTasks(user, `t.completed_at IS NULL AND t.due_on < ? AND ${MINE}`, [today, user.id, user.id]),
    assigned: countTasks(user, 't.completed_at IS NULL AND t.assignee_id = ? AND (t.created_by IS NULL OR t.created_by != ?)', [user.id, user.id]),
    all: countTasks(user, 't.completed_at IS NULL'),
  });

  // ---- html ----
  function navHtml(user, today, current) {
    const c = counts(user, today);
    const link = (href, key, name, ico, n, extra = '') => `<a class="nav-link${current === key ? ' cur' : ''}" href="${href}"${current === key ? ' aria-current="page"' : ''}>${icon(ico)}<span class="grow">${esc(name)}</span>${extra}${n ? `<span class="count">${n}</span>` : ''}</a>`;
    const lists = visibleLists(user);
    const open = db.prepare(`SELECT list_id, COUNT(*) n FROM tasks WHERE completed_at IS NULL GROUP BY list_id`).all();
    const nOpen = new Map(open.map((r) => [r.list_id, r.n]));
    const mine = lists.filter((l) => l.owner_id === user.id);
    const others = lists.filter((l) => l.owner_id !== user.id);
    const li = (l) => link(LIST_PATH(l.id), `list:${l.id}`, l.name, 'list', nOpen.get(l.id) ?? 0, `<i class="dot h${l.hue}" aria-hidden="true"></i>`);
    const groups = new Map();
    for (const l of mine) { const g = l.group_name ?? ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(l); }
    return `<a class="nav-link" href="/">${icon('home')}Back to Folio</a>
      <div class="nav-label"><span>Tasks</span></div>
      ${Object.entries(SMART).map(([k, [name, ico]]) => link(`/tasks/${k}`, k, name, ico, k === 'completed' ? 0 : c[k], k === 'planned' && c.overdue ? `<span class="t-badge" title="${c.overdue} overdue">${c.overdue} overdue</span>` : '')).join('')}
      ${link('/tasks/week', 'week', 'Week planner', 'calendar', 0)}
      <div class="nav-label"><span>Lists</span></div>
      ${[...groups].map(([g, ls]) => `${g ? `<div class="nav-label sub">${esc(g)}</div>` : ''}${ls.map(li).join('')}`).join('')}
      ${others.length ? `<div class="nav-label sub">Shared with you</div>${others.map(li).join('')}` : ''}
      ${writer(user) ? `<form class="new-list" method="post" action="/tasks/lists"><label class="sr-only" for="new-list-name">New list</label><input id="new-list-name" name="name" placeholder="New list" maxlength="${LIMITS.listName}" autocomplete="off" required><button class="ghost sm" aria-label="Create list">${icon('plus')}</button></form>` : ''}
      <p class="muted pad"><a href="/tasks/export.ics">Export dated tasks (.ics)</a></p>`;
  }

  const sel = (name, label, options, value, attrs = '') => `<select name="${name}" aria-label="${label}"${attrs}>${options.map(([v, text]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;

  function rowHtml(t, c) {
    const done = !!t.completed_at;
    const toggle = c.canWrite && (t.can_edit || t.assignee_id === c.user.id);
    const title = esc(t.title);
    const parts = [];
    if (c.showList) parts.push(`<span class="t-m"><i class="dot h${t.list_hue}" aria-hidden="true"></i>${esc(t.list_name)}</span>`);
    if (t.due_on && !done) parts.push(`<span class="t-m due${t.due_on < c.today ? ' overdue' : ''}">${icon('calendar')}${esc(dueLabel(t.due_on, c.today))}</span>`);
    if (t.steps_total) parts.push(`<span class="t-m">${t.steps_done} of ${t.steps_total}</span>`);
    if (t.estimate_min) parts.push(`<span class="t-m">${icon('clock')}${fmtDur(t.estimate_min)}</span>`);
    if (t.repeat_rule) parts.push(`<span class="t-m" title="Repeats: ${esc(repeatLabel(t.repeat_rule))}">${icon('repeat')}${esc(repeatLabel(t.repeat_rule))}</span>`);
    if (t.has_reminder && !done) parts.push(`<span class="t-m" title="You have a reminder">${icon('bell')}<span class="sr-only">Reminder set</span></span>`);
    if (t.in_day && !done && c.view !== 'my-day') parts.push(`<span class="t-m" title="In My Day">${icon('sun')}<span class="sr-only">In My Day</span></span>`);
    if (t.assignee_name && t.assignee_id !== c.user.id) parts.push(`<span class="t-m">@${esc(t.assignee_name)}</span>`);
    if (c.view === 'assigned' && t.creator_name) parts.push(`<span class="t-m">from @${esc(t.creator_name)}</span>`);
    if (t.issue_key) parts.push(`<span class="t-m">${esc(t.issue_key)}</span>`);
    if (done && t.completer_name) parts.push(`<span class="t-m">done by @${esc(t.completer_name)}</span>`);
    const drag = c.view === 'list' && !done && c.canWrite && t.can_edit;
    return `<li class="task-row${done ? ' done' : ''}${c.open === t.id ? ' open' : ''}" data-id="${t.id}"${drag ? ' draggable="true"' : ''}>
      <form class="t-check" method="post" action="/tasks/${t.id}/complete"><input type="hidden" name="return" value="${esc(c.here)}"><input type="hidden" name="done" value="${done ? 0 : 1}">
        <input type="checkbox" class="task-check" aria-label="${done ? 'Reopen' : 'Complete'}: ${title}" data-tauto${done ? ' checked' : ''}${toggle ? '' : ' disabled'}>${toggle ? '<noscript><button class="sm">Save</button></noscript>' : ''}</form>
      <a class="t-main" href="${esc(withParam(c.base, 't', t.id))}"><span class="t-title">${title}</span>${parts.length ? `<span class="t-meta">${parts.join('')}</span>` : ''}</a>
      <form class="t-star" method="post" action="/tasks/${t.id}"><input type="hidden" name="return" value="${esc(c.here)}"><input type="hidden" name="important" value="${t.important ? 0 : 1}">
        <button class="ghost star-btn${t.important ? ' on' : ''}" aria-pressed="${!!t.important}" aria-label="Important: ${title}" title="${t.important ? 'Not important' : 'Mark important'}"${c.canWrite && t.can_edit ? '' : ' disabled'}>${icon('star')}</button></form>
    </li>`;
  }
  const groupHtml = (title, rows, c, { note = '', total = true, id } = {}) => {
    const m = sumMin(rows);
    return `<section class="t-group"${id ? ` id="${id}"` : ''}><h2 class="t-group-h">${esc(title)} <span class="count">${rows.length}</span>${total && m ? `<span class="t-total">${fmtDur(m)} planned</span>` : ''}${note}</h2>
      <ul class="t-list">${rows.map((t) => rowHtml(t, c)).join('')}</ul></section>`;
  };
  const completedHtml = (rows, c) => (rows.length ? `<details class="t-done"><summary>Completed <span class="count">${rows.length}</span></summary><ul class="t-list">${rows.map((t) => rowHtml(t, c)).join('')}</ul></details>` : '');

  const quickAdd = (c, { view, listId = '', placeholder = 'Add a task' }) => {
    const people = users().map((u) => u.username);
    const lists = editableLists(c.user).map((l) => l.name);
    return `<form class="t-add" id="quick-form" method="post" action="/tasks" data-people="${esc(JSON.stringify(people))}" data-lists="${esc(JSON.stringify(lists))}" data-today="${c.today}">
      <input type="hidden" name="return" value="${esc(c.here)}"><input type="hidden" name="view" value="${esc(view)}"><input type="hidden" name="list_id" value="${listId}">
      <label class="sr-only" for="quick-add">Add a task</label>${icon('plus')}
      <input id="quick-add" name="title" placeholder="${esc(placeholder)}" autocomplete="off" maxlength="${LIMITS.quick}" aria-describedby="quick-help" required>
      <button class="sm">Add</button>
      <p class="t-chips muted" id="quick-help" aria-live="polite">Shortcuts: a date (<code>fri</code>, <code>+3d</code>), <code>~1h30</code>, <code>@name</code>, <code>!</code>, <code>#List</code>, <code>*</code></p></form>`;
  };

  function paneHtml(t, c) {
    const off = c.off, edit = c.canWrite && t.can_edit, mineTask = c.canWrite && (t.can_edit || t.assignee_id === c.user.id);
    const here = c.paneUrl, ro = edit ? '' : ' disabled';
    const steps = db.prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY position, id').all(t.id);
    const rem = db.prepare('SELECT remind_at, sent_at FROM task_reminders WHERE task_id = ? AND user_id = ?').get(t.id, c.user.id);
    const stdEst = [15, 30, 60, 120, 240, 480];
    const estSel = t.estimate_min ? (stdEst.includes(t.estimate_min) ? t.estimate_min : 'custom') : '';
    const rr = t.repeat_rule ?? '';
    const rrStd = ['', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
    const custom = /^every:(\d+):(day|week|month)$/.exec(rr);
    const lists = editableLists(c.user);
    if (!lists.some((l) => l.id === t.list_id)) lists.push({ id: t.list_id, name: t.list_name });
    const hid = `<input type="hidden" name="return" value="${esc(here)}">`;
    const title = esc(t.title);
    const link = t.issue_key ? `<a href="/i/${t.link_issue_id}">${esc(t.issue_key)} ${esc(t.issue_title)}</a>` : t.page_title ? `<a href="/p/${t.link_page_id}">${esc(t.page_title)}</a>` : '';
    return `<aside class="t-pane" id="t-pane" aria-label="Task details" data-task="${t.id}">
      <div class="t-pane-top"><a class="btn ghost sm" id="pane-close" href="${esc(c.base)}">Close</a></div>
      ${c.err ? `<p class="err" role="alert">${esc(c.err)}</p>` : ''}
      <div class="t-pane-title">
        <form method="post" action="/tasks/${t.id}/complete">${hid}<input type="hidden" name="done" value="${t.completed_at ? 0 : 1}"><input type="checkbox" class="task-check" aria-label="${t.completed_at ? 'Reopen' : 'Complete'}: ${title}" data-tauto${t.completed_at ? ' checked' : ''}${mineTask ? '' : ' disabled'}></form>
        <form method="post" action="/tasks/${t.id}" class="grow">${hid}<input id="pane-title" class="t-title-in" name="title" value="${title}" maxlength="${LIMITS.title}" aria-label="Task title" data-tauto${ro}></form>
      </div>
      <div class="t-steps"><h3>Steps${steps.length ? ` <span class="count">${steps.filter((s) => s.done).length} of ${steps.length}</span>` : ''}</h3>
        <ul>${steps.map((s) => `<li class="${s.done ? 'done' : ''}"><form method="post" action="/tasks/${t.id}/steps/${s.id}">${hid}<input type="hidden" name="op" value="toggle"><input type="checkbox" class="step-check" aria-label="${s.done ? 'Untick' : 'Tick'}: ${esc(s.title)}" data-tauto${s.done ? ' checked' : ''}${mineTask ? '' : ' disabled'}><span>${esc(s.title)}</span></form>
          ${edit ? `<form method="post" action="/tasks/${t.id}/steps/${s.id}">${hid}<input type="hidden" name="op" value="delete"><button class="ghost sm" aria-label="Delete step: ${esc(s.title)}">${icon('trash')}</button></form>` : ''}</li>`).join('')}</ul>
        ${edit ? `<form class="t-step-add" method="post" action="/tasks/${t.id}/steps">${hid}<label class="sr-only" for="step-new">Add a step</label><input id="step-new" name="title" placeholder="Add step" maxlength="${LIMITS.step}" autocomplete="off" required><button class="ghost sm">${icon('plus')}<span class="sr-only">Add step</span></button></form>` : ''}</div>
      <div class="t-toggles">
        <form method="post" action="/tasks/${t.id}/my-day">${hid}<input type="hidden" name="on" value="${t.in_day ? 0 : 1}"><button class="ghost" aria-pressed="${!!t.in_day}"${c.canWrite ? '' : ' disabled'}>${icon('sun')}${t.in_day ? 'In My Day' : 'Add to My Day'}</button></form>
        <form method="post" action="/tasks/${t.id}">${hid}<input type="hidden" name="important" value="${t.important ? 0 : 1}"><button class="ghost" aria-pressed="${!!t.important}"${ro}>${icon('star')}Important</button></form>
        ${edit && !t.completed_at ? `<form method="post" action="/tasks/${t.id}/move">${hid}<button name="dir" value="up" class="ghost">${icon('up')}Move up</button><button name="dir" value="down" class="ghost">${icon('down')}Move down</button></form>` : ''}
      </div>
      <form class="t-details" method="post" action="/tasks/${t.id}">${hid}
        <label>Due <span class="t-inline"><input id="pane-due" type="date" name="due_on" aria-label="Due date" value="${esc(t.due_on ?? '')}" data-tauto${ro}>
          <span class="t-quick"><button name="due_quick" value="today" class="ghost sm"${ro}>Today</button><button name="due_quick" value="tomorrow" class="ghost sm"${ro}>Tomorrow</button><button name="due_quick" value="next-week" class="ghost sm"${ro}>Next week</button><button name="due_quick" value="clear" class="ghost sm"${ro}>Clear</button></span></span></label>
        <label>Remind me <span class="t-inline"><input type="datetime-local" name="remind" value="${esc(toLocal(rem?.remind_at, off))}" aria-label="Reminder time" data-tauto${mineTask ? '' : ' disabled'}>${rem?.sent_at ? '<span class="muted">sent</span>' : ''}</span></label>
        <label>Repeat <span class="t-inline">${sel('repeat', 'Repeat', [...rrStd.map((v) => [v, repeatLabel(v)]), ['custom', 'Custom...']], custom ? 'custom' : rr, ro)}
          <span class="muted">every</span><input type="number" name="repeat_n" min="1" max="999" value="${custom ? custom[1] : 2}" aria-label="Repeat every"${ro} class="narrow">${sel('repeat_unit', 'Repeat unit', [['day', 'days'], ['week', 'weeks'], ['month', 'months']], custom ? custom[2] : 'week', ro)}</span></label>
        <label>Length <span class="t-inline">${sel('estimate', 'Length', [['', 'None'], [15, '15m'], [30, '30m'], [60, '1h'], [120, '2h'], [240, 'Half day'], [480, 'Day'], ['custom', 'Custom...']], estSel, ro)}
          <input name="estimate_custom" value="${estSel === 'custom' ? esc(fmtDur(t.estimate_min).replace(/ /g, '')) : ''}" placeholder="e.g. 45m, 1h30" aria-label="Custom length" class="narrow"${ro}></span></label>
        <label>Assigned to ${sel('assignee', 'Assigned to', [['', 'Nobody'], ...users().map((u) => [u.id, u.username])], t.assignee_id ?? '', `${ro} data-tauto`)}</label>
        <label>List ${sel('list_id', 'List', lists.map((l) => [l.id, l.name]), t.list_id, `${ro} data-tauto`)}</label>
        <label>Link <input name="link" value="${esc(t.issue_key ?? (t.link_page_id ? `/p/${t.link_page_id}` : ''))}" placeholder="Issue key (ENG-12) or page address" maxlength="200"${ro}></label>
        ${link ? `<p class="t-link">${icon('link')}${link}</p>` : ''}
        <label>Notes <textarea name="notes" rows="5" maxlength="${LIMITS.notes}" placeholder="Notes (Markdown, ENG-12 keys and @mentions work)"${ro}>${esc(t.notes)}</textarea></label>
        <div class="actions"><button${mineTask ? '' : ' disabled'}>Save</button></div>
      </form>
      ${t.notes ? `<div class="doc t-notes">${renderMarkdown(t.notes)}</div>` : ''}
      ${files.taskPanel(t, here, { upload: mineTask, canDelete: (a) => edit || a.uploaded_by === c.user.id })}
      <p class="muted t-info">Created${t.creator_name ? ` by @${esc(t.creator_name)}` : ''} ${esc(t.created_at.slice(0, 10))}${t.completed_at ? ` · Completed${t.completer_name ? ` by @${esc(t.completer_name)}` : ''} ${esc(t.completed_at.slice(0, 16))} UTC` : ''}</p>
      ${edit ? `<form method="post" action="/tasks/${t.id}/delete" data-confirm="Delete this task?"><input type="hidden" name="return" value="${esc(c.base)}"><button class="danger">${icon('trash')}Delete task</button></form>` : ''}
    </aside>`;
  }

  function render(req, res, { key, title, subtitle = '', total = '', body, base, listId = '' }) {
    const user = req.user, today = localDay(offsetOf(req));
    const here = req.originalUrl.startsWith('/tasks') ? req.originalUrl.split('#')[0] : base;
    let paneTask = null;
    if (req.query.t && /^\d{1,9}$/.test(req.query.t)) paneTask = getTask(req.query.t, user, today);
    const c = { user, today, off: offsetOf(req), base, here, open: paneTask?.id, canWrite: writer(user), paneUrl: paneTask ? withParam(base, 't', paneTask.id) : base, err: str(req.query.err, 200) };
    const pane = paneTask ? paneHtml(paneTask, c) : '';
    page(res, {
      title, user, section: 'tasks', toc: false, sidebar: navHtml(user, today, key),
      body: `<div class="tasks${pane ? ' has-pane' : ''}"><div class="t-main-col">
        <div class="t-head"><div><h1 class="page-title">${esc(title)}</h1>${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}</div>${total}</div>
        ${body(c, paneTask)}</div>${pane}</div><script type="module" src="/tasks.js"></script>`,
    });
  }

  // ---- pages ----
  app.get('/tasks', (req, res) => res.redirect('/tasks/my-day'));

  app.get('/tasks/:view(my-day|important|planned|assigned|all|completed)', (req, res) => {
    const view = req.params.view, user = req.user, off = offsetOf(req), today = localDay(off);
    ensureDefaultList(user); rememberTz(req);
    const q = view === 'completed' ? str(req.query.q, 100) : '';
    const base = `/tasks/${view}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    const data = viewRows(view, user, today, q);
    const cap = capacity(user);
    const [name] = SMART[view];
    const canWrite = writer(user);
    let total = '', subtitle = '';
    if (view === 'my-day') {
      const m = sumMin(data.open);
      subtitle = dayLabel(today, '');
      total = m ? `<span class="t-total${m > cap ? ' over' : ''}">${fmtDur(m)} planned${m > cap ? ` · over your ${fmtDur(cap)} day` : ''}</span>` : '';
    }
    render(req, res, {
      key: view, title: name, subtitle, total, base,
      body: (c) => {
        const empty = (h, p) => `<div class="empty">${icon(SMART[view][1])}<h3>${h}</h3><p>${p}</p></div>`;
        let main = '';
        if (view === 'my-day') {
          main = (data.open.length ? groupHtml('Today', data.open, { ...c, view, showList: true }, { total: false }) : empty('Nothing planned for today', 'My Day starts fresh each day. Add a task with the sun button, or pick from the suggestions below.'))
            + (data.suggestions.length ? `<details class="t-suggest"><summary>Suggestions <span class="count">${data.suggestions.length}</span></summary><p class="muted">Overdue and due soon. Add the ones you will do today.</p><ul class="t-list">${data.suggestions.map((t) => `<li class="task-row"><span class="t-main"><span class="t-title">${esc(t.title)}</span><span class="t-meta"><span class="t-m due${t.due_on < today ? ' overdue' : ''}">${esc(dueLabel(t.due_on, today))}</span>${t.estimate_min ? `<span class="t-m">${fmtDur(t.estimate_min)}</span>` : ''}</span></span>
              ${canWrite ? `<form method="post" action="/tasks/${t.id}/my-day"><input type="hidden" name="return" value="${esc(c.here)}"><input type="hidden" name="on" value="1"><button class="ghost sm">${icon('sun')}Add to My Day</button></form>` : ''}</li>`).join('')}</ul></details>` : '');
        } else if (view === 'planned') {
          const totals = dayTotals(user, today);
          const groups = new Map(PLANNED_ORDER.map((g) => [g, []]));
          for (const t of data.open) groups.get(plannedGroup(t.due_on, today)).push(t);
          main = [...groups].filter(([, rows]) => rows.length).map(([g, rows]) => {
            const over = [...new Set(rows.map((t) => t.due_on))].filter((d) => (totals.get(d) ?? 0) > cap);
            const note = over.length ? `<span class="t-total over">Over budget: ${over.map((d) => `${dayLabel(d, today)} (${fmtDur(totals.get(d))})`).join(', ')}</span>` : '';
            return groupHtml(g, rows, { ...c, view, showList: true }, { note });
          }).join('') || empty('Nothing planned', 'Tasks with a due date appear here, grouped by when they are due.');
        } else if (view === 'assigned') {
          const by = new Map();
          for (const t of data.open) { const k = t.creator_name ?? 'Unknown'; if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
          main = [...by].map(([who, rows]) => groupHtml(`From @${who}`, rows, { ...c, view, showList: true })).join('') || empty('Nothing assigned to you', 'When a teammate assigns you a task it appears here and in your bell.');
        } else if (view === 'all') {
          const by = new Map();
          for (const t of data.open) { if (!by.has(t.list_id)) by.set(t.list_id, []); by.get(t.list_id).push(t); }
          main = [...by.values()].map((rows) => groupHtml(rows[0].list_name, rows, { ...c, view })).join('') || empty('No tasks yet', 'Add your first task above.');
        } else if (view === 'important') {
          main = data.open.length ? groupHtml('Starred', data.open, { ...c, view, showList: true }) : empty('No important tasks', 'Star a task and it will wait for you here.');
        } else {
          main = `<form class="t-search" method="get" action="/tasks/completed" role="search"><label class="sr-only" for="done-q">Search completed tasks</label><input id="done-q" type="search" name="q" value="${esc(q)}" placeholder="Search completed tasks"><button class="ghost sm">Search</button></form>`
            + (data.done.length ? `<ul class="t-list">${data.done.map((t) => rowHtml(t, { ...c, view, showList: true })).join('')}</ul>` : empty('Nothing completed yet', q ? 'No completed task matches that search.' : 'Finished tasks are kept here.'));
        }
        const add = canWrite && view !== 'completed' && view !== 'assigned' ? quickAdd(c, { view, placeholder: view === 'my-day' ? 'Add a task for today' : 'Add a task' }) : '';
        const hintHtml = hint(db, user, 'tasks', 'Type a whole task in one line: <code>Write the launch post fri ~1h30 @sam ! #Launch</code>. Dates, lengths, people and lists are picked out as you type.');
        const done = view === 'completed' ? '' : completedHtml(data.done ?? [], { ...c, view, showList: true });
        return `${hintHtml}${add}${main}${done}`;
      },
    });
  });

  app.get('/tasks/lists/:id(\\d+)', (req, res) => {
    const list = getList(req.params.id), user = req.user;
    const access = listAccess(list, user);
    if (!access) return res.status(404).send('No such list');
    const off = offsetOf(req), today = localDay(off);
    rememberTz(req);
    const open = fetchTasks(user, today, 't.list_id = ? AND t.completed_at IS NULL', [list.id]);
    const done = fetchTasks(user, today, 't.list_id = ? AND t.completed_at IS NOT NULL', [list.id], 't.completed_at DESC', 100);
    const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(list.owner_id)?.username;
    const m = sumMin(open);
    render(req, res, {
      key: `list:${list.id}`, title: list.name, base: LIST_PATH(list.id), listId: list.id,
      subtitle: `${{ private: 'Private to you', shared: 'Shared with named people', team: 'Team list: everyone can see it' }[list.visibility]}${list.owner_id !== user.id ? ` · by @${owner}` : ''}`,
      total: m ? `<span class="t-total">${fmtDur(m)} planned</span>` : '',
      body: (c) => `${access !== 'view' && c.canWrite ? quickAdd(c, { view: 'list', listId: list.id, placeholder: `Add a task to ${list.name}` }) : ''}
        ${open.length ? `<ul class="t-list"${access !== 'view' && c.canWrite ? ' data-reorder' : ''}>${open.map((t) => rowHtml(t, { ...c, view: 'list' })).join('')}</ul>` : `<div class="empty">${icon('list')}<h3>This list is empty</h3><p>${access === 'view' ? 'Nothing here yet.' : 'Add a task above.'}</p></div>`}
        ${completedHtml(done, { ...c, view: 'list' })}
        ${access === 'owner' && c.canWrite ? listSettings(list, c) : ''}`,
    });
  });

  function listSettings(list, c) {
    const members = db.prepare('SELECT m.user_id, m.can_edit, u.username FROM task_list_members m JOIN users u ON u.id = m.user_id WHERE m.list_id = ? ORDER BY u.username COLLATE NOCASE').all(list.id);
    const back = `<input type="hidden" name="return" value="${esc(c.base)}">`;
    const candidates = users().filter((u) => u.id !== list.owner_id && !members.some((m2) => m2.user_id === u.id));
    return `<details class="t-settings"><summary>${icon('settings')}List settings</summary>
      <form class="form" method="post" action="/tasks/lists/${list.id}">${back}
        <label>Name <input name="name" value="${esc(list.name)}" maxlength="${LIMITS.listName}" required></label>
        <label>Colour ${sel('hue', 'Colour', Array.from({ length: 12 }, (_, i) => [i, `Colour ${i + 1}`]), list.hue)}</label>
        <label>Who can see it ${sel('visibility', 'Who can see it', [['private', 'Only me'], ['shared', 'People I choose'], ['team', 'Everyone (team list)']], list.visibility)}</label>
        <label>Group <input name="group_name" value="${esc(list.group_name ?? '')}" maxlength="${LIMITS.group}" placeholder="Optional folder in the sidebar"></label>
        <div class="actions"><button>Save list</button><button name="move" value="up" class="ghost">${icon('up')}Move up</button><button name="move" value="down" class="ghost">${icon('down')}Move down</button></div></form>
      <h3>Shared with</h3>
      <ul class="t-members">${members.map((m2) => `<li><span>@${esc(m2.username)}</span>
        <form method="post" action="/tasks/lists/${list.id}/share">${back}<input type="hidden" name="op" value="update"><input type="hidden" name="user_id" value="${m2.user_id}">${sel('can_edit', `Access for ${m2.username}`, [[1, 'Can edit'], [0, 'View only']], m2.can_edit, ' data-tauto')}<noscript><button class="sm">Save</button></noscript></form>
        <form method="post" action="/tasks/lists/${list.id}/share">${back}<input type="hidden" name="op" value="remove"><input type="hidden" name="user_id" value="${m2.user_id}"><button class="ghost sm" aria-label="Stop sharing with ${esc(m2.username)}">${icon('trash')}</button></form></li>`).join('') || '<li class="muted">Nobody yet.</li>'}</ul>
      ${candidates.length ? `<form class="form t-share" method="post" action="/tasks/lists/${list.id}/share">${back}<input type="hidden" name="op" value="add">
        ${sel('user_id', 'Person', candidates.map((u) => [u.id, u.username]), '')}
        ${sel('can_edit', 'Access', [[1, 'Can edit'], [0, 'View only']], 1)}<button class="ghost">Share</button></form>` : '<p class="muted">There is nobody else to share with yet. Administrators can add people from the account menu.</p>'}
      <form method="post" action="/tasks/lists/${list.id}" data-confirm="Delete this list and every task in it?"><input type="hidden" name="action" value="delete"><button class="danger">${icon('trash')}Delete list</button></form></details>`;
  }

  // ---- week planner (time boxing) ----
  const GRID = { from: 6, to: 22 }; // hours shown
  app.get('/tasks/week', (req, res) => {
    const user = req.user, off = offsetOf(req), today = localDay(off);
    rememberTz(req);
    const start = mondayOf(isDate(req.query.start) ? req.query.start : today), end = addDays(start, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const cap = capacity(user);
    const lo = ts(new Date(Date.parse(`${start}T00:00:00Z`) - 36 * 3600e3)), hi = ts(new Date(Date.parse(`${end}T00:00:00Z`) + 60 * 3600e3));
    const scheduled = fetchTasks(user, today, `t.completed_at IS NULL AND ${MINE} AND t.start_at BETWEEN ? AND ?`, [user.id, user.id, lo, hi], 't.start_at').map((t) => ({ ...t, local: toLocal(t.start_at, off) })).filter((t) => t.local.slice(0, 10) >= start && t.local.slice(0, 10) <= end);
    const tray = fetchTasks(user, today, `t.completed_at IS NULL AND ${MINE} AND t.start_at IS NULL AND (t.due_on <= ? OR EXISTS (SELECT 1 FROM task_my_day d WHERE d.task_id = t.id AND d.user_id = ? AND d.day = ?))`, [user.id, user.id, end, user.id, today], 't.due_on IS NULL, t.due_on, t.id', 60);
    const planned = new Map();
    for (const t of [...scheduled.map((x) => ({ day: x.local.slice(0, 10), m: x.estimate_min })), ...tray.filter((x) => x.due_on && x.due_on >= start).map((x) => ({ day: x.due_on, m: x.estimate_min }))]) planned.set(t.day, (planned.get(t.day) ?? 0) + (t.m ?? 0));
    const can = writer(user);
    const hours = Array.from({ length: GRID.to - GRID.from }, (_, i) => GRID.from + i);
    const here = `/tasks/week?start=${start}`;
    const block = (t) => {
      const [hh, mm] = t.local.slice(11).split(':').map(Number);
      const mins = hh * 60 + mm;
      return `<div class="wk-block h${t.list_hue}" data-id="${t.id}" data-top="${mins - GRID.from * 60}" data-h="${t.estimate_min ?? 30}"${can ? ' draggable="true"' : ''}>
        <a href="/tasks/all?t=${t.id}">${esc(t.title)}</a><span class="muted">${t.local.slice(11)} · ${fmtDur(t.estimate_min ?? 30)}</span>
        ${can && t.can_edit ? `<form method="post" action="/tasks/${t.id}/schedule"><input type="hidden" name="return" value="${esc(here)}"><input type="hidden" name="clear" value="1"><button class="ghost sm" aria-label="Unschedule: ${esc(t.title)}">${icon('trash')}</button></form>` : ''}</div>`;
    };
    const inGrid = (t) => { const mins = Number(t.local.slice(11, 13)) * 60 + Number(t.local.slice(14, 16)); return mins >= GRID.from * 60 && mins < GRID.to * 60; };
    render(req, res, {
      key: 'week', title: 'Week planner', subtitle: `${dayLabel(start, today)} to ${dayLabel(end, today)}`, base: '/tasks/week',
      total: `<span class="t-weeknav"><a class="btn ghost sm" href="/tasks/week?start=${addDays(start, -7)}">${icon('chevron')}<span class="sr-only">Previous week</span></a><a class="btn ghost sm" href="/tasks/week">This week</a><a class="btn ghost sm" href="/tasks/week?start=${addDays(start, 7)}"><span class="sr-only">Next week</span>${icon('chevron')}</a></span>`,
      body: () => `<p class="muted">${can ? 'Drag a task onto a day to give it a start time; its length becomes the block height. Or use the Schedule button on a task.' : 'Time-boxed tasks for the week.'}</p>
        <div class="wk" data-start="${start}" data-grid-from="${GRID.from}" data-return="${esc(here)}">
          <div class="wk-days">${days.map((d) => {
            const m = planned.get(d) ?? 0, over = m > cap;
            const mine = scheduled.filter((t) => t.local.slice(0, 10) === d);
            return `<section class="wk-day${d === today ? ' today' : ''}" aria-label="${dayLabel(d, today)}"><h2>${dayLabel(d, today)}${d === today ? ' <span class="muted">today</span>' : ''}</h2>
              <p class="wk-total${over ? ' over' : ''}">${m ? `${fmtDur(m)} of ${fmtDur(cap)}${over ? ' · Over budget' : ''}` : '&nbsp;'}</p>
              <div class="wk-grid" data-day="${d}">${hours.map((h) => `<div class="wk-hour" data-hour="${h}"><span>${String(h).padStart(2, '0')}:00</span></div>`).join('')}${mine.filter(inGrid).map(block).join('')}</div>
              ${mine.filter((t) => !inGrid(t)).map((t) => `<p class="muted">${t.local.slice(11)} <a href="/tasks/all?t=${t.id}">${esc(t.title)}</a></p>`).join('')}</section>`;
          }).join('')}</div>
          <section class="wk-tray" aria-label="Unscheduled tasks"><h2>Unscheduled <span class="count">${tray.length}</span></h2>
            ${tray.length ? `<ul class="t-list">${tray.map((t) => `<li class="wk-item" data-id="${t.id}"${can ? ' draggable="true"' : ''}><span class="t-title">${esc(t.title)}</span><span class="t-meta">${t.due_on ? `<span class="t-m due${t.due_on < today ? ' overdue' : ''}">${esc(dueLabel(t.due_on, today))}</span>` : ''}${t.estimate_min ? `<span class="t-m">${fmtDur(t.estimate_min)}</span>` : ''}</span>
              ${can && t.can_edit ? `<details><summary>Schedule</summary><form class="t-inline" method="post" action="/tasks/${t.id}/schedule"><input type="hidden" name="return" value="${esc(here)}">${sel('day', `Day for ${t.title}`, days.map((d) => [d, dayLabel(d, today)]), days.includes(t.due_on) ? t.due_on : days.includes(today) ? today : days[0])}<input type="time" name="time" value="09:00" step="900" aria-label="Start time for ${esc(t.title)}" required><button class="sm">Schedule</button></form></details>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Everything dated is already placed.</p>'}</section>
        </div>`,
    });
  });

  // ---- calendar export ----
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => { const out = []; let rest = line; while (Buffer.byteLength(rest) > 74) { let n = 74; while (Buffer.byteLength(rest.slice(0, n)) > 74) n--; out.push(rest.slice(0, n)); rest = ` ${rest.slice(n)}`; } out.push(rest); return out.join('\r\n'); };
  const icsStamp = (utc) => utc.replace(/[-:]/g, '').replace(' ', 'T') + 'Z';
  app.get('/tasks/export.ics', (req, res) => {
    const user = req.user, today = localDay(offsetOf(req));
    const rows = fetchTasks(user, today, `t.completed_at IS NULL AND ${MINE} AND (t.due_on IS NOT NULL OR t.start_at IS NOT NULL)`, [user.id, user.id], 't.due_on, t.id', 2000);
    const now = icsStamp(ts(new Date()));
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Folio//Tasks//EN', 'CALSCALE:GREGORIAN'];
    for (const t of rows) {
      lines.push('BEGIN:VEVENT', `UID:folio-task-${t.id}@folio`, `DTSTAMP:${now}`);
      if (t.start_at) {
        const end = ts(new Date(new Date(`${t.start_at.replace(' ', 'T')}Z`).getTime() + (t.estimate_min ?? 30) * 60000));
        lines.push(`DTSTART:${icsStamp(t.start_at)}`, `DTEND:${icsStamp(end)}`);
      } else lines.push(`DTSTART;VALUE=DATE:${t.due_on.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${addDays(t.due_on, 1).replaceAll('-', '')}`);
      lines.push(`SUMMARY:${icsText(t.title)}`);
      if (t.notes) lines.push(`DESCRIPTION:${icsText(t.notes.slice(0, 500))}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.type('text/calendar').set('Content-Disposition', 'attachment; filename="folio-tasks.ics"').send(`${lines.map(fold).join('\r\n')}\r\n`);
  });

  // ---- writes ----
  const back = (req, res, fallback, err) => {
    let to = safeReturn(req.body.return, fallback);
    if (err) to = withParam(to, 'err', err);
    res.redirect(303, to);
  };
  const nextPosition = (listId) => (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 p FROM tasks WHERE list_id = ?').get(listId).p);
  const nameOf = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username;

  function notifyAssigned(task, assigneeId, actor) {
    if (!assigneeId || assigneeId === actor.id) return;
    notifier.deliver(new Map([[assigneeId, 'task_assigned']]), { actor, text: `${actor.username} assigned you the task "${task.title}"`, url: `/tasks/assigned?t=${task.id}`, ref: `task:${task.id}` });
  }

  // Quick add. The same parser runs in the browser to show chips; the server's reading is the one that counts.
  app.post('/tasks', (req, res) => {
    const user = req.user, today = localDay(offsetOf(req));
    const lists = editableLists(user);
    const names = users().map((u) => u.username);
    const p = parseQuickAdd(str(req.body.title, LIMITS.quick), { today, people: names, lists: lists.map((l) => l.name) });
    const title = p.title.slice(0, LIMITS.title);
    if (!title) return back(req, res, '/tasks/my-day', 'Type a title for the task.');
    let list = p.list ? lists.find((l) => l.name === p.list) : null;
    if (!list && req.body.list_id) list = lists.find((l) => l.id === Number(req.body.list_id));
    if (!list) list = defaultList(user);
    if (!list || !['owner', 'edit'].includes(listAccess(list, user))) return back(req, res, '/tasks/my-day', 'You cannot add tasks to that list.');
    if (db.prepare('SELECT COUNT(*) n FROM tasks WHERE list_id = ?').get(list.id).n >= LIMITS.tasksPerList) return back(req, res, '/tasks/my-day', 'That list is full.');
    const view = String(req.body.view ?? '');
    const assignee = p.assignee ? db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(p.assignee).id : user.id;
    const myDay = p.my_day || view === 'my-day';
    const important = p.important || view === 'important';
    const due = p.due_on ?? (view === 'planned' ? today : null);
    const id = tx(db, () => {
      const r = db.prepare('INSERT INTO tasks (list_id, title, created_by, assignee_id, important, due_on, estimate_min, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(list.id, title, user.id, assignee, important ? 1 : 0, due, p.estimate_min, nextPosition(list.id));
      const tid = Number(r.lastInsertRowid);
      if (myDay) db.prepare('INSERT OR IGNORE INTO task_my_day (user_id, task_id, day) VALUES (?, ?, ?)').run(user.id, tid, today);
      return tid;
    });
    notifyAssigned({ id, title }, assignee, user);
    back(req, res, '/tasks/my-day');
  });

  // Turn an issue or a page into a task.
  app.post('/tasks/from', (req, res) => {
    const user = req.user, today = localDay(offsetOf(req));
    const id = Number(req.body.id);
    const kind = req.body.kind === 'page' ? 'page' : 'issue';
    const src = kind === 'issue'
      ? db.prepare("SELECT i.id, i.title, s.key || '-' || i.num label FROM issues i JOIN spaces s ON s.id = i.space_id WHERE i.id = ?").get(id)
      : db.prepare('SELECT id, title, title label FROM pages WHERE id = ?').get(id);
    if (!src) return res.status(404).send('Not found');
    const col = kind === 'issue' ? 'link_issue_id' : 'link_page_id';
    const existing = db.prepare(`SELECT id FROM tasks WHERE ${col} = ? AND created_by = ? AND completed_at IS NULL`).get(id, user.id);
    if (existing) return res.redirect(303, `/tasks/all?t=${existing.id}`);
    const list = defaultList(user);
    const tid = Number(db.prepare(`INSERT INTO tasks (list_id, title, created_by, assignee_id, ${col}, position) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(list.id, (kind === 'issue' ? `${src.label} ${src.title}` : `Review: ${src.title}`).slice(0, LIMITS.title), user.id, user.id, id, nextPosition(list.id)).lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO task_my_day (user_id, task_id, day) VALUES (?, ?, ?)').run(user.id, tid, today);
    res.redirect(303, `/tasks/my-day?t=${tid}`);
  });

  function parseLink(text) {
    const t = String(text ?? '').trim();
    if (!t) return { clear: true };
    let m = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})$/.exec(t);
    if (m) {
      const i = db.prepare('SELECT i.id FROM issues i JOIN spaces s ON s.id = i.space_id WHERE s.key = ? AND i.num = ?').get(m[1].toUpperCase(), Number(m[2]));
      return i ? { issue: i.id } : { error: `No issue ${t.toUpperCase()}.` };
    }
    if ((m = /(?:^|\/)i\/(\d+)\/?$/.exec(t))) return db.prepare('SELECT 1 FROM issues WHERE id = ?').get(Number(m[1])) ? { issue: Number(m[1]) } : { error: 'No such issue.' };
    if ((m = /(?:^|\/)p\/?(\d+)\/?$/.exec(t))) return db.prepare('SELECT 1 FROM pages WHERE id = ?').get(Number(m[1])) ? { page: Number(m[1]) } : { error: 'No such page.' };
    return { error: 'Use an issue key such as ENG-12, or a page address.' };
  }

  app.post('/tasks/:id(\\d+)', (req, res) => {
    const user = req.user, off = offsetOf(req), today = localDay(off), b = req.body;
    const t = getTask(req.params.id, user, today);
    if (!t) return res.status(404).send('No such task');
    const editor = t.can_edit;
    const assigneeOnly = !editor && t.assignee_id === user.id;
    if (!editor && !assigneeOnly) return res.status(403).send('You can only view this task');
    const set = {}, errs = [];
    if (editor) {
      if ('title' in b) { const v = str(b.title, LIMITS.title); v ? (set.title = v) : errs.push('A task needs a title.'); }
      if ('notes' in b) set.notes = str(b.notes, LIMITS.notes, { trim: false });
      if ('important' in b) set.important = b.important === '1' ? 1 : 0;
      if (b.due_quick) {
        const q = { today, tomorrow: addDays(today, 1), 'next-week': addDays(mondayOf(today), 7), clear: null }[b.due_quick];
        if (q !== undefined) set.due_on = q;
      } else if ('due_on' in b) {
        if (b.due_on === '') set.due_on = null;
        else if (isDate(b.due_on)) set.due_on = b.due_on;
        else errs.push('That date is not valid.');
      }
      if ('repeat' in b) {
        const rule = b.repeat === 'custom' ? `every:${Math.min(999, Math.max(1, parseInt(b.repeat_n, 10) || 0))}:${b.repeat_unit}` : str(b.repeat, 20);
        if (!rule) set.repeat_rule = null;
        else if (REPEAT_RE.test(rule)) set.repeat_rule = rule;
        else errs.push('That repeat rule is not valid.');
      }
      if ('estimate' in b) {
        if (b.estimate === '') set.estimate_min = null;
        else { const m = b.estimate === 'custom' ? parseDuration(str(b.estimate_custom, 20)) : parseDuration(str(b.estimate, 10)); m ? (set.estimate_min = m) : errs.push('Length must be between 1 minute and 100 hours.'); }
      }
      if ('assignee' in b) {
        const a = b.assignee === '' ? null : db.prepare('SELECT id FROM users WHERE id = ?').get(Number(b.assignee))?.id;
        if (b.assignee !== '' && !a) errs.push('No such person.'); else set.assignee_id = a;
      }
      if ('link' in b) {
        const l = parseLink(b.link);
        if (l.error) errs.push(l.error);
        else { set.link_issue_id = l.issue ?? null; set.link_page_id = l.page ?? null; }
      }
      if ('list_id' in b && Number(b.list_id) !== t.list_id) {
        const target = editableLists(user).find((l) => l.id === Number(b.list_id));
        if (!target) errs.push('You cannot move the task to that list.');
        else if (db.prepare('SELECT COUNT(*) n FROM tasks WHERE list_id = ?').get(target.id).n >= LIMITS.tasksPerList) errs.push('That list is full.');
        else { set.list_id = target.id; set.position = nextPosition(target.id); }
      }
    }
    tx(db, () => {
      const keys = Object.keys(set);
      if (keys.length) db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), t.id);
      if ('remind' in b) {
        if (b.remind === '') db.prepare('DELETE FROM task_reminders WHERE task_id = ? AND user_id = ?').run(t.id, user.id);
        else {
          const utc = toUtc(b.remind, off);
          if (!utc) errs.push('That reminder time is not valid.');
          else db.prepare('INSERT INTO task_reminders (task_id, user_id, remind_at) VALUES (?, ?, ?) ON CONFLICT (task_id, user_id) DO UPDATE SET remind_at = excluded.remind_at, sent_at = NULL').run(t.id, user.id, utc);
        }
      }
    });
    if ('assignee_id' in set && set.assignee_id !== t.assignee_id) notifyAssigned({ id: t.id, title: set.title ?? t.title }, set.assignee_id, user);
    if ('notes' in set) {
      const fresh = [...notifier.mentioned(set.notes)].filter((id) => !notifier.mentioned(t.notes).has(id));
      if (fresh.length) notifier.deliver(new Map(fresh.map((id) => [id, 'mention'])), { actor: user, text: `${user.username} mentioned you in the task "${set.title ?? t.title}"`, url: `/tasks/all?t=${t.id}`, ref: `task:${t.id}` });
    }
    back(req, res, `/tasks/all?t=${t.id}`, errs[0]);
  });

  app.post('/tasks/:id(\\d+)/delete', (req, res) => {
    const t = getTask(req.params.id, req.user);
    if (!t) return res.status(404).send('No such task');
    if (!t.can_edit) return res.status(403).send('You can only view this task');
    files.purge({ task_id: t.id });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
    back(req, res, '/tasks/all');
  });

  app.post('/tasks/:id(\\d+)/complete', (req, res) => {
    const user = req.user, today = localDay(offsetOf(req));
    const t = getTask(req.params.id, user, today);
    if (!t) return res.status(404).send('No such task');
    if (!t.can_edit && t.assignee_id !== user.id) return res.status(403).send('You can only view this task');
    const wantDone = req.body.done === '0' ? false : req.body.done === '1' ? true : !t.completed_at;
    if (wantDone === !!t.completed_at) return back(req, res, `/tasks/all?t=${t.id}`);
    tx(db, () => {
      if (wantDone) {
        db.prepare('UPDATE tasks SET completed_at = CURRENT_TIMESTAMP, completed_by = ? WHERE id = ?').run(user.id, t.id);
        if (t.repeat_rule) spawnNext(t, today);
      } else db.prepare('UPDATE tasks SET completed_at = NULL, completed_by = NULL WHERE id = ?').run(t.id);
    });
    if (wantDone && t.created_by && t.created_by !== user.id)
      notifier.deliver(new Map([[t.created_by, 'task_done']]), { actor: user, text: `${user.username} completed the task "${t.title}"`, url: `/tasks/all?t=${t.id}`, ref: `task:${t.id}` });
    back(req, res, `/tasks/all?t=${t.id}`);
  });

  // The next occurrence of a repeating task: same details, fresh steps, due on the next date after the later of (due, today).
  function spawnNext(t, today) {
    const from = t.due_on && t.due_on > today ? t.due_on : today;
    const due = nextOccurrence(from, t.repeat_rule);
    if (!due) return;
    const r = db.prepare(`INSERT INTO tasks (list_id, title, notes, created_by, assignee_id, important, due_on, repeat_rule, estimate_min, link_issue_id, link_page_id, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.list_id, t.title, t.notes, t.created_by, t.assignee_id, t.important, due, t.repeat_rule, t.estimate_min, t.link_issue_id, t.link_page_id, nextPosition(t.list_id));
    const nid = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO task_steps (task_id, title, done, position) SELECT ?, title, 0, position FROM task_steps WHERE task_id = ?').run(nid, t.id);
    const shift = diffDays(due, t.due_on ?? today) * 86400000;
    for (const rm of db.prepare('SELECT user_id, remind_at FROM task_reminders WHERE task_id = ?').all(t.id))
      db.prepare('INSERT INTO task_reminders (task_id, user_id, remind_at) VALUES (?, ?, ?)').run(nid, rm.user_id, ts(new Date(new Date(`${rm.remind_at.replace(' ', 'T')}Z`).getTime() + shift)));
  }

  app.post('/tasks/:id(\\d+)/steps', (req, res) => {
    const t = getTask(req.params.id, req.user);
    if (!t) return res.status(404).send('No such task');
    if (!t.can_edit) return res.status(403).send('You can only view this task');
    const title = str(req.body.title, LIMITS.step);
    if (!title) return back(req, res, `/tasks/all?t=${t.id}`);
    if (db.prepare('SELECT COUNT(*) n FROM task_steps WHERE task_id = ?').get(t.id).n >= LIMITS.steps) return back(req, res, `/tasks/all?t=${t.id}`, `A task can have up to ${LIMITS.steps} steps.`);
    db.prepare('INSERT INTO task_steps (task_id, title, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM task_steps WHERE task_id = ?))').run(t.id, title, t.id);
    back(req, res, `/tasks/all?t=${t.id}`);
  });
  app.post('/tasks/:id(\\d+)/steps/:sid(\\d+)', (req, res) => {
    const t = getTask(req.params.id, req.user);
    const s = t && db.prepare('SELECT * FROM task_steps WHERE id = ? AND task_id = ?').get(Number(req.params.sid), t.id);
    if (!t || !s) return res.status(404).send('No such step');
    const op = req.body.op;
    if (op === 'toggle') {
      if (!t.can_edit && t.assignee_id !== req.user.id) return res.status(403).send('You can only view this task');
      db.prepare('UPDATE task_steps SET done = ? WHERE id = ?').run(s.done ? 0 : 1, s.id);
    } else {
      if (!t.can_edit) return res.status(403).send('You can only view this task');
      if (op === 'delete') db.prepare('DELETE FROM task_steps WHERE id = ?').run(s.id);
      else if (op === 'rename') { const title = str(req.body.title, LIMITS.step); if (title) db.prepare('UPDATE task_steps SET title = ? WHERE id = ?').run(title, s.id); }
      else return res.status(400).send('Unknown step action');
    }
    back(req, res, `/tasks/all?t=${t.id}`);
  });

  // Reorder inside a list: dir=up|down moves one place; before=<task id> (or empty for the end) is what dragging sends.
  app.post('/tasks/:id(\\d+)/move', (req, res) => {
    const t = getTask(req.params.id, req.user);
    if (!t) return res.status(404).send('No such task');
    if (!t.can_edit) return res.status(403).send('You can only view this task');
    const ids = db.prepare('SELECT id FROM tasks WHERE list_id = ? AND completed_at IS NULL ORDER BY position, id').all(t.list_id).map((r) => r.id);
    const i = ids.indexOf(t.id);
    if (i < 0) return back(req, res, `/tasks/all?t=${t.id}`);
    ids.splice(i, 1);
    const b = req.body;
    if (b.dir === 'up') ids.splice(Math.max(0, i - 1), 0, t.id);
    else if (b.dir === 'down') ids.splice(Math.min(ids.length, i + 1), 0, t.id);
    else if ('before' in b) {
      const at = b.before === '' ? -1 : ids.indexOf(Number(b.before));
      if (b.before !== '' && at < 0) return res.status(400).send('That task is not in this list');
      ids.splice(at < 0 ? ids.length : at, 0, t.id);
    } else return res.status(400).send('Say where to move it');
    const set = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    tx(db, () => ids.forEach((id, k) => set.run(k + 1, id)));
    back(req, res, `/tasks/all?t=${t.id}`);
  });

  app.post('/tasks/:id(\\d+)/my-day', (req, res) => {
    const today = localDay(offsetOf(req));
    const t = getTask(req.params.id, req.user, today);
    if (!t) return res.status(404).send('No such task');
    const on = req.body.on === '0' ? false : req.body.on === '1' ? true : !t.in_day;
    if (on) db.prepare('INSERT OR IGNORE INTO task_my_day (user_id, task_id, day) VALUES (?, ?, ?)').run(req.user.id, t.id, today);
    else db.prepare('DELETE FROM task_my_day WHERE user_id = ? AND task_id = ? AND day = ?').run(req.user.id, t.id, today);
    back(req, res, `/tasks/all?t=${t.id}`);
  });

  // Time boxing: give a task a start time on a day. Its length becomes the block height.
  app.post('/tasks/:id(\\d+)/schedule', (req, res) => {
    const off = offsetOf(req), today = localDay(off);
    const t = getTask(req.params.id, req.user, today);
    if (!t) return res.status(404).send('No such task');
    if (!t.can_edit) return res.status(403).send('You can only view this task');
    const fallback = '/tasks/week';
    if (req.body.clear === '1') { db.prepare('UPDATE tasks SET start_at = NULL WHERE id = ?').run(t.id); return back(req, res, fallback); }
    const time = /^(\d{2}):(\d{2})$/.exec(str(req.body.time, 5));
    const utc = isDate(req.body.day) && time ? toUtc(`${req.body.day}T${time[1]}:${time[2]}`, off) : null;
    if (!utc) return back(req, res, fallback, 'Pick a valid day and time.');
    db.prepare('UPDATE tasks SET start_at = ?, due_on = ? WHERE id = ?').run(utc, req.body.day, t.id);
    back(req, res, fallback);
  });

  // ---- lists ----
  app.post('/tasks/lists', (req, res) => {
    const user = req.user;
    const name = str(req.body.name, LIMITS.listName);
    if (!name) return res.status(400).send('A list needs a name');
    const n = db.prepare('SELECT COUNT(*) n FROM task_lists WHERE owner_id = ?').get(user.id).n;
    if (n >= LIMITS.lists) return res.status(400).send(`You can have up to ${LIMITS.lists} lists`);
    const visibility = ['private', 'shared', 'team'].includes(req.body.visibility) ? req.body.visibility : 'private';
    const r = db.prepare('INSERT INTO task_lists (owner_id, name, hue, visibility, position) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, name, n % 12, visibility, db.prepare('SELECT COALESCE(MAX(position), 0) + 1 p FROM task_lists WHERE owner_id = ?').get(user.id).p);
    res.redirect(303, LIST_PATH(r.lastInsertRowid));
  });
  const ownedList = (req, res) => {
    const list = getList(req.params.id);
    const access = listAccess(list, req.user);
    if (!access) { res.status(404).send('No such list'); return null; }
    if (access !== 'owner') { res.status(403).send('Only the owner can change a list'); return null; }
    return list;
  };
  app.post('/tasks/lists/:id(\\d+)', (req, res) => {
    const list = ownedList(req, res);
    if (!list) return;
    const b = req.body;
    if (b.action === 'delete') { for (const r of db.prepare('SELECT id FROM tasks WHERE list_id = ?').all(list.id)) files.purge({ task_id: r.id }); db.prepare('DELETE FROM task_lists WHERE id = ?').run(list.id); return res.redirect(303, '/tasks/my-day'); }
    if (b.move === 'up' || b.move === 'down') {
      const mine = db.prepare('SELECT id FROM task_lists WHERE owner_id = ? ORDER BY position, id').all(list.owner_id).map((r) => r.id);
      const i = mine.indexOf(list.id), j = b.move === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < mine.length) { [mine[i], mine[j]] = [mine[j], mine[i]]; mine.forEach((id, k) => db.prepare('UPDATE task_lists SET position = ? WHERE id = ?').run(k, id)); }
    } else {
      const name = str(b.name, LIMITS.listName) || list.name;
      const hue = Number.isInteger(Number(b.hue)) && Number(b.hue) >= 0 && Number(b.hue) <= 11 ? Number(b.hue) : list.hue;
      const visibility = ['private', 'shared', 'team'].includes(b.visibility) ? b.visibility : list.visibility;
      const group = 'group_name' in b ? (str(b.group_name, LIMITS.group) || null) : list.group_name;
      db.prepare('UPDATE task_lists SET name = ?, hue = ?, visibility = ?, group_name = ? WHERE id = ?').run(name, hue, visibility, group, list.id);
    }
    res.redirect(303, safeReturn(b.return, LIST_PATH(list.id)));
  });
  app.post('/tasks/lists/:id(\\d+)/share', (req, res) => {
    const list = ownedList(req, res);
    if (!list) return;
    const b = req.body, uid = Number(b.user_id), target = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!target || uid === list.owner_id) return res.redirect(303, LIST_PATH(list.id));
    const canEdit = b.can_edit === '0' ? 0 : 1;
    if (b.op === 'add') {
      if (db.prepare('SELECT COUNT(*) n FROM task_list_members WHERE list_id = ?').get(list.id).n >= LIMITS.members) return res.status(400).send('Too many people on this list');
      db.prepare('INSERT INTO task_list_members (list_id, user_id, can_edit) VALUES (?, ?, ?) ON CONFLICT (list_id, user_id) DO UPDATE SET can_edit = excluded.can_edit').run(list.id, uid, canEdit);
      if (list.visibility === 'private') db.prepare("UPDATE task_lists SET visibility = 'shared' WHERE id = ?").run(list.id);
    } else if (b.op === 'update') db.prepare('UPDATE task_list_members SET can_edit = ? WHERE list_id = ? AND user_id = ?').run(canEdit, list.id, uid);
    else if (b.op === 'remove') db.prepare('DELETE FROM task_list_members WHERE list_id = ? AND user_id = ?').run(list.id, uid);
    res.redirect(303, safeReturn(b.return, LIST_PATH(list.id)));
  });

  // Daily capacity, set from the Account page.
  app.post('/account/capacity', (req, res) => {
    const h = Number(req.body.hours);
    if (!(h >= 1 && h <= 16)) return res.redirect('/account?err=' + encodeURIComponent('Daily capacity must be between 1 and 16 hours.'));
    setFlag(db, req.user.id, 'task-capacity', String(Math.round(h * 60)));
    res.redirect('/account?ok=capacity');
  });

  // What the file routes need to know about a task: may this person see its files, add to them, or manage them?
  ctx.taskFiles = (user, taskId) => {
    const t = getTask(taskId, user);
    if (!t) return null;
    return { edit: !!t.can_edit && writer(user), upload: writer(user) && (!!t.can_edit || t.assignee_id === user.id) };
  };

  // ---- reminders and the daily digest ----
  const visibleTo = (userId, taskId) => !!db.prepare(`SELECT 1 ${FROM} WHERE t.id = ? AND ${VIS}`).get(taskId, userId, userId, userId);
  function tick(now = new Date()) {
    const stamp = ts(now);
    const due = db.prepare('SELECT r.task_id, r.user_id, t.title FROM task_reminders r JOIN tasks t ON t.id = r.task_id WHERE r.sent_at IS NULL AND r.remind_at <= ? AND t.completed_at IS NULL LIMIT 200').all(stamp);
    for (const r of due) {
      // claim first, so a restart or a second timer can never send it twice
      const claimed = db.prepare('UPDATE task_reminders SET sent_at = ? WHERE task_id = ? AND user_id = ? AND sent_at IS NULL').run(stamp, r.task_id, r.user_id);
      if (claimed.changes !== 1 || !visibleTo(r.user_id, r.task_id)) continue;
      notifier.deliver(new Map([[r.user_id, 'task_reminder']]), { actor: null, text: `Reminder: ${r.title}`, url: `/tasks/all?t=${r.task_id}`, ref: `task:${r.task_id}` });
    }
    for (const u of db.prepare('SELECT id FROM users').all()) {
      const off = Number(getFlag(db, u.id, 'tz')) || 0, local = new Date(now.getTime() - off * 60000), day = local.toISOString().slice(0, 10);
      if (local.getUTCHours() < 8 || getFlag(db, u.id, 'task-digest') === day) continue;
      setFlag(db, u.id, 'task-digest', day);
      const dueToday = countTasks(u, `t.completed_at IS NULL AND t.due_on = ? AND ${MINE}`, [day, u.id, u.id]);
      const overdue = countTasks(u, `t.completed_at IS NULL AND t.due_on < ? AND ${MINE}`, [day, u.id, u.id]);
      if (dueToday + overdue === 0) continue;
      const text = [dueToday && `${dueToday} due today`, overdue && `${overdue} overdue`].filter(Boolean).join(', ');
      notifier.deliver(new Map([[u.id, 'task_due']]), { actor: null, text: `Tasks: ${text}`, url: '/tasks/planned', ref: `task-digest:${day}` });
    }
  }
  return { tick };
}

// Small pieces other pages use.
export const addToTasksButton = (kind, id) => `<form method="post" action="/tasks/from"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${id}"><button class="ghost" title="Add this to your tasks">${icon('task')}Add to my tasks</button></form>`;
export function capacityForm(db, user) {
  const h = (Number(getFlag(db, user.id, 'task-capacity')) || DEFAULT_CAPACITY) / 60;
  return `<div class="section-head"><h2>Daily task capacity</h2></div>
    <p class="muted">Tasks warns you when the lengths of one day's tasks add up to more than this.</p>
    <form class="form" method="post" action="/account/capacity"><label>Hours per day <input type="number" name="hours" min="1" max="16" step="0.25" value="${h}" required></label><button>Save</button></form>`;
}
