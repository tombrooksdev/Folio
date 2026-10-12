// Scrum: board, backlog, sprints, issues (with epics, labels, attachments), issue search, drag-and-drop ordering.
import { tx } from './db.js';
import { str } from './util.js';
import { esc, icon, renderMarkdown, hueClass } from './render.js';
import { logChange, mountReports, sprintStats, burndownSvg } from './reports.js';
import { mountEpics, epicsFor, epicsPanel } from './epics.js';
import { hint } from './learn.js';
import { watchButton } from './notify.js';
import { addToTasksButton } from './tasks.js';
import {
  TYPES, PRIORITIES, STATUSES, label, initial, issueKey, sum, pointsOf, parseLabels, setLabels,
  listIssues, getIssueFull, typeIco, prioIco, avatar, epicChip, card, row, crumbs, statusChip, progressBar,
  recordChanges, logCreated, eventHtml,
} from './issues.js';

const LINKS = { blocks: ['blocks', 'is blocked by'], relates: ['relates to', 'relates to'], duplicates: ['duplicates', 'is duplicated by'] };

export function mountBoard(app, ctx) {
  const { db, page, getSpace, files, notifier } = ctx;
  mountReports(app, ctx);
  mountEpics(app, ctx);
  const getIssue = (id) => db.prepare('SELECT * FROM issues WHERE id = ?').get(Number(id));
  const spaceById = (id) => db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
  const users = () => db.prepare('SELECT id, username FROM users ORDER BY username').all();
  const optional = (v, allowed) => (allowed.includes(v) ? v : allowed[0]);
  const spaceLabels = (spaceId) => db.prepare('SELECT DISTINCT l.label FROM issue_labels l JOIN issues i ON i.id = l.issue_id WHERE i.space_id = ? ORDER BY l.label').all(spaceId).map((r) => r.label);

  const quickAdd = (space, sprintId, id) => `<button type="button" class="create-row" data-toggle="${id}">${icon('plus')}Create issue</button>
    <form class="quick-add" id="${id}" hidden method="post" action="/s/${esc(space.key)}/issues">
      <input type="hidden" name="sprint_id" value="${sprintId ?? ''}"><input type="hidden" name="back" value="backlog">
      <select name="type" aria-label="Issue type">${TYPES.map((t) => `<option value="${t}">${label(t)}</option>`).join('')}</select>
      <input name="title" placeholder="What needs to be done?" aria-label="New issue title" required><button class="sm">Create</button></form>`;


  // Board columns, optionally split into swimlanes (Jira's "Group by").
  function boardHtml(issues, space, sprint, group) {
    const columns = (items, headers) => `<div class="board">${STATUSES.map(([st, name]) => {
      const col = items.filter((i) => i.status === st);
      return `<section class="column${headers ? '' : ' headless'}">${headers ? `<header><h2>${name}</h2><span class="count" data-count>${col.length}</span><span class="pts" data-points-total>${sum(col)}</span></header>` : ''}
        <div class="drop" data-drop data-status="${st}" data-sprint="${sprint.id}">${col.map((i) => card(i, space)).join('')}</div></section>`;
    }).join('')}</div>`;
    if (!group) return columns(issues, true);
    const lanes = new Map();
    for (const i of issues) {
      const k = group === 'assignee' ? i.assignee ?? 'Unassigned' : i.epic_name ?? 'No epic';
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(i);
    }
    const last = group === 'assignee' ? 'Unassigned' : 'No epic';
    const names = [...lanes.keys()].sort((x, y) => (x === last) - (y === last) || x.localeCompare(y));
    return `<div class="board-head">${STATUSES.map(([st, name]) => `<div>${name}<span class="count">${issues.filter((i) => i.status === st).length}</span></div>`).join('')}</div>
      ${names.map((n) => `<section class="lane"><button type="button" class="lane-head" aria-expanded="true">${icon('chevron')}${esc(n)} <span class="muted">(${lanes.get(n).length} issue${lanes.get(n).length === 1 ? '' : 's'})</span></button>${columns(lanes.get(n), false)}</section>`).join('')}`;
  }

  // ---- board ----
  app.get('/s/:key/board', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const sprint = db.prepare("SELECT * FROM sprints WHERE space_id = ? AND state = 'active'").get(space.id);
    if (!sprint)
      return page(res, {
        title: 'Board', user: req.user, space, section: 'board', toc: false,
        body: `<div class="jira">${crumbs(space, 'Board')}<h1 class="page-title">${esc(space.key)} board</h1>
          <div class="empty">${emptyBoard()}<h3>No active sprint</h3><p>Plan a sprint in the backlog, then start it to see it here.</p><a class="btn" href="/s/${esc(space.key)}/backlog">Go to backlog</a></div></div>`,
      });
    const issues = listIssues(db, 'i.sprint_id = ?', sprint.id);
    const total = sum(issues), done = sum(issues.filter((i) => i.status === 'done'));
    const pct = total ? Math.round((done / total) * 100) : 0;
    const left = Math.ceil((new Date(sprint.ends_at) - Date.now()) / 864e5);
    const people = users();
    const epics = epicsFor(db, space.id), labels = spaceLabels(space.id);
    const group = ['assignee', 'epic'].includes(req.query.group) ? req.query.group : '';
    page(res, {
      title: `Board`, user: req.user, space, section: 'board', toc: false,
      body: `<div class="jira">${hint(db, req.user, 'board', 'Drag a card between columns to change its status. Use <b>Group by</b> for swimlanes and the avatars to see one person\'s work.')}${crumbs(space, 'Board')}
        <div class="j-head"><div><h1 class="page-title">${esc(space.key)} board</h1>
          <p class="j-sub"><b>${esc(sprint.name)}</b>${sprint.goal ? `<span class="goal">${icon('flag')}${esc(sprint.goal)}</span>` : ''}</p></div>
          <div class="actions"><span class="j-chip" title="Sprint ends ${esc(sprint.ends_at.slice(0, 10))}">${icon('clock')}${left >= 0 ? `${left} day${left === 1 ? '' : 's'} remaining` : `${-left} day${left === -1 ? '' : 's'} overdue`}</span>
          <form method="post" action="/sprints/${sprint.id}/complete" data-confirm="Complete this sprint? Unfinished issues return to the backlog."><button class="ghost">Complete sprint</button></form></div></div>
        <div class="j-filters"><div class="j-search-wrap">${icon('search')}<input class="j-search" id="board-search" type="search" placeholder="Search this board" aria-label="Search this board"></div>
          <div class="av-filters" aria-label="Filter by assignee">${people.map((u) => `<button type="button" class="av-filter avatar ${hueClass(u.username)}" data-user="${esc(u.username)}" title="${esc(u.username)}" aria-pressed="false">${initial(u.username)}</button>`).join('')}</div>
          ${epics.length ? `<select id="epic-filter" class="j-select" aria-label="Filter by epic"><option value="">Epic</option>${epics.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>` : ''}
          ${labels.length ? `<select id="label-filter" class="j-select" aria-label="Filter by label"><option value="">Label</option>${labels.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select>` : ''}
          <select id="group-by" class="j-select" aria-label="Group by"><option value="">Group: None</option><option value="assignee"${group === 'assignee' ? ' selected' : ''}>Group: Assignee</option><option value="epic"${group === 'epic' ? ' selected' : ''}>Group: Epic</option></select>
          <button type="button" class="link-btn" id="only-mine" data-me="${esc(req.user.username)}">Only my issues</button>
          <button type="button" class="link-btn" id="clear-filters" hidden>Clear filters</button>
          <span class="j-progress muted"><b>${done}</b> of <b>${total}</b> points done (${pct}%)</span></div>
        <details class="burndown"><summary>Burndown</summary><div class="chart-card">${burndownSvg(sprintStats(db, sprint))}</div><p><a href="/sprints/${sprint.id}/report">Full sprint report</a></p></details>
        ${boardHtml(issues, space, sprint, group)}</div>
        <script src="/board.js"></script>`,
    });
  });

  // ---- backlog ----
  app.get('/s/:key/backlog', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const sprints = db.prepare("SELECT * FROM sprints WHERE space_id = ? AND state != 'closed' ORDER BY state = 'active' DESC, id").all(space.id);
    const hasActive = sprints.some((s) => s.state === 'active');
    const block = (s) => {
      const items = listIssues(db, s ? 'i.sprint_id = ?' : 'i.space_id = ? AND i.sprint_id IS NULL', s ? s.id : space.id);
      const by = (st) => items.filter((i) => i.status === st).length;
      const id = `qa-${s ? s.id : 'backlog'}`;
      return `<section class="sprint-block" data-sprint-block>
        <header><button type="button" class="collapse" aria-label="Collapse section" aria-expanded="true">${icon('chevron')}</button>
          <h2>${s ? esc(s.name) : 'Backlog'}</h2>
          <span class="muted">${s ? `${esc((s.started_at ?? '').slice(0, 10))}${s.ends_at ? ` - ${esc(s.ends_at.slice(0, 10))} ` : ''}` : ''}(${items.length} issue${items.length === 1 ? '' : 's'})</span>
          <span class="spacer"></span>
          ${s ? `<span class="cnts"><span class="cnt st-todo" title="To do">${by('todo')}</span><span class="cnt st-doing" title="In progress">${by('doing')}</span><span class="cnt st-done" title="Done">${by('done')}</span></span>` : ''}
          <span class="pts" title="Story points" data-points-total>${sum(items)}</span>
          ${s && s.state === 'planned' && !hasActive ? `<form class="inline" method="post" action="/sprints/${s.id}/start"><select name="weeks" aria-label="Sprint length"><option value="1">1 week</option><option value="2" selected>2 weeks</option><option value="3">3 weeks</option><option value="4">4 weeks</option></select><button class="ghost sm">Start sprint</button></form>` : ''}
          ${s && s.state === 'active' ? `<a class="btn ghost sm" href="/s/${esc(space.key)}/board">Open board</a>` : ''}
          ${!s ? `<button type="button" class="ghost sm" data-toggle="new-sprint">Create sprint</button>` : ''}</header>
        <div class="sprint-body">${s?.goal ? `<p class="muted goal">${icon('flag')}${esc(s.goal)}</p>` : ''}
        <div class="drop list" data-drop data-sprint="${s ? s.id : ''}">${items.map((i) => row(i, space)).join('') || `<p class="drop-hint muted">${s ? 'Plan your sprint by dragging issues here.' : 'Your backlog is empty.'}</p>`}</div>
        ${quickAdd(space, s?.id, id)}</div></section>`;
    };
    page(res, {
      title: 'Backlog', user: req.user, space, section: 'backlog', toc: false,
      body: `<div class="jira">${hint(db, req.user, 'backlog', 'Create a sprint, <b>drag issues into it</b>, then press <b>Start sprint</b>. Drag within a list to set priority order.')}${crumbs(space, 'Backlog')}
        <div class="j-head"><h1 class="page-title">Backlog</h1><div class="actions"><a class="btn ghost" href="/s/${esc(space.key)}/issues">${icon('search')}Search issues</a><a class="btn ghost" href="/s/${esc(space.key)}/issues/new">${icon('plus')}Create issue</a></div></div>
        ${epicsPanel(space, epicsFor(db, space.id))}
        <form class="new-space" id="new-sprint" hidden method="post" action="/s/${esc(space.key)}/sprints">
          <input name="name" placeholder="Sprint name, e.g. Sprint ${sprints.length + 1}" aria-label="Sprint name" required><input name="goal" placeholder="Sprint goal (optional)" aria-label="Sprint goal"><button>Create sprint</button></form>
        ${sprints.map(block).join('')}${block(null)}</div>
        <script src="/board.js"></script>`,
    });
  });

  // ---- issue search (like Jira's "Issues") ----
  app.get('/s/:key/issues', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const q = req.query;
    const where = ['i.space_id = ?'], args = [space.id];
    const text = String(q.q ?? '').trim();
    if (text) { where.push("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR (? || '-' || i.num) LIKE ? ESCAPE '\\')"); const like = `%${text.replace(/[\\%_]/g, '\\$&')}%`; args.push(like, like, space.key, like); }
    if (STATUSES.some((s) => s[0] === q.status)) { where.push('i.status = ?'); args.push(q.status); }
    if (TYPES.includes(q.type)) { where.push('i.type = ?'); args.push(q.type); }
    if (PRIORITIES.includes(q.priority)) { where.push('i.priority = ?'); args.push(q.priority); }
    if (q.assignee === 'none') where.push('i.assignee_id IS NULL');
    else if (q.assignee) { where.push('i.assignee_id = ?'); args.push(Number(q.assignee) || 0); }
    if (q.epic === 'none') where.push('i.epic_id IS NULL');
    else if (q.epic) { where.push('i.epic_id = ?'); args.push(Number(q.epic) || 0); }
    if (q.label) { where.push('EXISTS (SELECT 1 FROM issue_labels l WHERE l.issue_id = i.id AND l.label = ?)'); args.push(String(q.label).toLowerCase()); }
    if (q.sprint === 'backlog') where.push('i.sprint_id IS NULL');
    else if (q.sprint) { where.push('i.sprint_id = ?'); args.push(Number(q.sprint) || 0); }
    const found = db.prepare(`SELECT i.*, u.username assignee, e.name epic_name, (SELECT group_concat(label, ',') FROM issue_labels WHERE issue_id = i.id) label_list
      FROM issues i LEFT JOIN users u ON u.id = i.assignee_id LEFT JOIN epics e ON e.id = i.epic_id WHERE ${where.join(' AND ')} ORDER BY i.updated_at DESC, i.id DESC LIMIT 200`).all(...args);
    const epics = epicsFor(db, space.id), labels = spaceLabels(space.id), sprints = db.prepare('SELECT id, name FROM sprints WHERE space_id = ? ORDER BY id DESC').all(space.id);
    const opt = (v, t, cur) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(t)}</option>`;
    page(res, {
      title: 'Issues', user: req.user, space, section: 'issues', toc: false,
      body: `<div class="jira">${crumbs(space, 'Issues')}
        <div class="j-head"><h1 class="page-title">Search issues</h1><div class="actions"><a class="btn" href="/s/${esc(space.key)}/issues/new">${icon('plus')}Create issue</a></div></div>
        <form class="filter-bar" method="get" action="/s/${esc(space.key)}/issues">
          <input name="q" value="${esc(text)}" placeholder="Search summary, description or key" aria-label="Text">
          <select name="status" aria-label="Status">${opt('', 'Any status', q.status)}${STATUSES.map(([v, t]) => opt(v, t, q.status)).join('')}</select>
          <select name="type" aria-label="Type">${opt('', 'Any type', q.type)}${TYPES.map((t) => opt(t, label(t), q.type)).join('')}</select>
          <select name="priority" aria-label="Priority">${opt('', 'Any priority', q.priority)}${PRIORITIES.map((t) => opt(t, label(t), q.priority)).join('')}</select>
          <select name="assignee" aria-label="Assignee">${opt('', 'Any assignee', q.assignee)}${opt('none', 'Unassigned', q.assignee)}${users().map((u) => opt(u.id, u.username, q.assignee)).join('')}</select>
          <select name="epic" aria-label="Epic">${opt('', 'Any epic', q.epic)}${opt('none', 'No epic', q.epic)}${epics.map((e) => opt(e.id, e.name, q.epic)).join('')}</select>
          <select name="label" aria-label="Label">${opt('', 'Any label', q.label)}${labels.map((l) => opt(l, l, q.label)).join('')}</select>
          <select name="sprint" aria-label="Sprint">${opt('', 'Any sprint', q.sprint)}${opt('backlog', 'Backlog', q.sprint)}${sprints.map((s) => opt(s.id, s.name, q.sprint)).join('')}</select>
          <button>Search</button><a class="link-btn" href="/s/${esc(space.key)}/issues">Reset</a></form>
        <p class="muted">${found.length}${found.length === 200 ? '+' : ''} issue${found.length === 1 ? '' : 's'} found</p>
        <div class="list">${found.map((i) => row(i, space, { drag: false })).join('') || '<p class="muted pad">No issues match.</p>'}</div></div>`,
    });
  });

  // ---- sprints ----
  app.post('/s/:key/sprints', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const name = str(req.body.name, 60);
    if (!name) return res.status(400).send('Name required');
    db.prepare('INSERT INTO sprints (space_id, name, goal) VALUES (?, ?, ?)').run(space.id, name, str(req.body.goal, 200));
    res.redirect(`/s/${space.key}/backlog`);
  });
  app.post('/sprints/:id/start', (req, res) => {
    const s = db.prepare('SELECT * FROM sprints WHERE id = ?').get(Number(req.params.id));
    if (!s || s.state !== 'planned') return res.status(400).send('Sprint cannot be started');
    if (db.prepare("SELECT 1 FROM sprints WHERE space_id = ? AND state = 'active'").get(s.space_id)) return res.status(409).send('Another sprint is already active');
    const weeks = Math.max(1, Math.min(4, Number(req.body.weeks) || 2));
    db.prepare("UPDATE sprints SET state = 'active', weeks = ?, started_at = CURRENT_TIMESTAMP, ends_at = datetime('now', ?) WHERE id = ?").run(weeks, `+${weeks * 7} days`, s.id);
    const started = db.prepare('SELECT started_at FROM sprints WHERE id = ?').get(s.id).started_at;
    for (const i of db.prepare('SELECT id, points, status FROM issues WHERE sprint_id = ?').all(s.id))
      db.prepare('INSERT INTO sprint_log (sprint_id, issue_id, scope_delta, done_delta, initial, at) VALUES (?, ?, ?, ?, 1, ?)').run(s.id, i.id, i.points ?? 0, i.status === 'done' ? i.points ?? 0 : 0, started);
    notifier.sprintEvent(s, spaceById(s.space_id), req.user, 'started');
    res.redirect(`/s/${spaceById(s.space_id).key}/board`);
  });
  app.post('/sprints/:id/complete', (req, res) => {
    const s = db.prepare('SELECT * FROM sprints WHERE id = ?').get(Number(req.params.id));
    if (!s || s.state !== 'active') return res.status(400).send('Sprint is not active');
    tx(db, () => {
      db.prepare("INSERT INTO sprint_carry (sprint_id, issue_id, title, points) SELECT sprint_id, id, title, points FROM issues WHERE sprint_id = ? AND status != 'done'").run(s.id);
      db.prepare("UPDATE issues SET sprint_id = NULL, status = 'todo' WHERE sprint_id = ? AND status != 'done'").run(s.id);
      db.prepare("UPDATE sprints SET state = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(s.id);
    });
    notifier.sprintEvent(s, spaceById(s.space_id), req.user, 'completed');
    res.redirect(`/s/${spaceById(s.space_id).key}/reports`);
  });

  // ---- issues ----
  function issueForm(space, i, action, heading) {
    const sprints = db.prepare("SELECT * FROM sprints WHERE space_id = ? AND state != 'closed' ORDER BY id").all(space.id);
    const epics = epicsFor(db, space.id);
    const opts = (list, cur, fmt = label) => list.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${fmt(v)}</option>`).join('');
    return `<form class="issue-form" method="post" action="${action}" data-upload-space="${esc(space.key)}"${i.id ? ` data-upload-issue="${i.id}"` : ''}>
      <input type="hidden" name="back" value="${esc(i.back ?? '')}">
      <input class="title-input" name="title" value="${esc(i.title)}" placeholder="Issue title" aria-label="Title" required autofocus>
      <div class="fields">
        <label>Type<select name="type">${opts(TYPES, i.type)}</select></label>
        <label>Priority<select name="priority">${opts(PRIORITIES, i.priority)}</select></label>
        <label>Status<select name="status">${opts(STATUSES.map((s) => s[0]), i.status, (v) => STATUSES.find((s) => s[0] === v)[1])}</select></label>
        <label>Story points<input name="points" inputmode="numeric" value="${i.points ?? ''}" placeholder="-"></label>
        <label>Sprint<select name="sprint_id"><option value="">Backlog</option>${sprints.map((s) => `<option value="${s.id}"${s.id === i.sprint_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label>Assignee<select name="assignee_id"><option value="">Unassigned</option>${users().map((u) => `<option value="${u.id}"${u.id === i.assignee_id ? ' selected' : ''}>${esc(u.username)}</option>`).join('')}</select></label>
        <label>Epic<select name="epic_id"><option value="">None</option>${epics.map((e) => `<option value="${e.id}"${e.id === i.epic_id ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
        <label>Parent issue<select name="parent_id"><option value="">None (top level)</option>${db.prepare('SELECT id, num, title FROM issues WHERE space_id = ? AND parent_id IS NULL AND id != ? ORDER BY num').all(space.id, i.id ?? 0).map((p) => `<option value="${p.id}"${p.id === i.parent_id ? ' selected' : ''}>${esc(space.key)}-${p.num} ${esc(p.title.slice(0, 40))}</option>`).join('')}</select></label>
        <label>Labels<input name="labels" value="${esc(i.label_list ? i.label_list.split(',').join(', ') : '')}" placeholder="frontend, urgent"></label>
      </div>
      <label class="desc">Description <span class="muted">(Markdown; paste or drop images to attach them)</span><textarea name="description" id="issue-desc" rows="10" placeholder="What needs doing, and how will we know it's done?">${esc(i.description)}</textarea></label>
      <div class="actions"><button>${esc(heading)}</button><a class="btn ghost" href="${i.id ? `/i/${i.id}` : `/s/${esc(space.key)}/backlog`}">Cancel</a></div></form>
      <script src="/files.js"></script>`;
  }
  const blank = { title: '', description: '', type: 'story', priority: 'medium', status: 'todo', points: null, sprint_id: null, assignee_id: null, epic_id: null, parent_id: null, label_list: '' };

  app.get('/s/:key/issues/new', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const epic = req.query.epic && db.prepare('SELECT id FROM epics WHERE id = ? AND space_id = ?').get(Number(req.query.epic), space.id);
    page(res, {
      title: 'Create issue', user: req.user, space, section: 'backlog', toc: false,
      body: `<div class="jira"><span class="eyebrow">${esc(space.name)}</span><h1 class="page-title">Create issue</h1>${issueForm(space, { ...blank, epic_id: epic?.id ?? null }, `/s/${esc(space.key)}/issues`, 'Create issue')}</div>`,
    });
  });

  function saveFields(body, space, selfId = null) {
    const title = str(body.title, 200);
    if (!title) return null;
    // sub-tasks: one level only, same space, parent can't be the issue itself, and an issue with sub-tasks can't become one
    let parent = body.parent_id ? db.prepare('SELECT id, parent_id FROM issues WHERE id = ? AND space_id = ?').get(Number(body.parent_id), space.id) : null;
    if (parent && (parent.parent_id || parent.id === selfId || (selfId && db.prepare('SELECT 1 FROM issues WHERE parent_id = ?').get(selfId)))) parent = null;
    const sprintId = body.sprint_id ? Number(body.sprint_id) : null;
    const sprint = sprintId ? db.prepare("SELECT * FROM sprints WHERE id = ? AND space_id = ? AND state != 'closed'").get(sprintId, space.id) : null;
    const assignee = body.assignee_id ? db.prepare('SELECT id FROM users WHERE id = ?').get(Number(body.assignee_id)) : null;
    const epic = body.epic_id ? db.prepare('SELECT id FROM epics WHERE id = ? AND space_id = ?').get(Number(body.epic_id), space.id) : null;
    return {
      title, description: str(body.description, 100000, { trim: false }), type: optional(body.type, TYPES), priority: PRIORITIES.includes(body.priority) ? body.priority : 'medium',
      status: STATUSES.some((s) => s[0] === body.status) ? body.status : 'todo', points: pointsOf(body.points),
      sprint_id: sprint?.id ?? null, assignee_id: assignee?.id ?? null, epic_id: epic?.id ?? null, labels: parseLabels(body.labels).join(', '), parent_id: parent?.id ?? null,
    };
  }
  app.post('/s/:key/issues', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const f = saveFields(req.body, space);
    if (!f) return res.status(400).send('Title required');
    const id = tx(db, () => {
      const num = db.prepare('SELECT COALESCE(MAX(num), 0) + 1 n FROM issues WHERE space_id = ?').get(space.id).n;
      const rank = db.prepare('SELECT COALESCE(MAX(rank), 0) + 1 r FROM issues WHERE space_id = ?').get(space.id).r;
      const newId = Number(db.prepare(`INSERT INTO issues (space_id, num, title, description, type, priority, status, points, sprint_id, assignee_id, epic_id, parent_id, reporter_id, rank)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(space.id, num, f.title, f.description, f.type, f.priority, f.status, f.points, f.sprint_id, f.assignee_id, f.epic_id, f.parent_id, req.user.id, rank).lastInsertRowid);
      setLabels(db, newId, f.labels);
      logCreated(db, newId, req.user.id);
      files.adopt(space.id, { issue_id: newId }, f.description);
      logChange(db, newId, null, f);
      return newId;
    });
    notifier.issueCreated(getIssue(id), space, req.user);
    if (req.get('X-Requested-With') === 'fetch') {
      const num = db.prepare('SELECT num FROM issues WHERE id = ?').get(id).num;
      return res.json({ id, key: `${space.key}-${num}`, url: `/i/${id}` });
    }
    const back = String(req.body.back ?? '');
    res.redirect(back === 'backlog' ? `/s/${space.key}/backlog` : /^\/i\/\d+$/.test(back) ? back : `/i/${id}`);
  });

  app.get('/i/:id', (req, res) => {
    const i = getIssueFull(db, req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const space = spaceById(i.space_id);
    const all = users();
    const name = (id) => all.find((u) => u.id === id)?.username;
    const sprints = db.prepare("SELECT * FROM sprints WHERE space_id = ? AND state != 'closed' ORDER BY id").all(space.id);
    const epics = epicsFor(db, space.id);
    const children = listIssues(db, 'i.parent_id = ?', i.id);
    const commentRows = db.prepare('SELECT c.*, u.username FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE issue_id = ? ORDER BY c.id').all(i.id);
    const eventRows = db.prepare('SELECT e.*, u.username FROM issue_events e LEFT JOIN users u ON u.id = e.user_id WHERE issue_id = ? ORDER BY e.id').all(i.id);
    const activity = [
      ...commentRows.map((c) => ({ at: c.created_at, id: c.id, kind: 'comment', html: `<div class="comment" data-kind="comment">${avatar(c.username ?? '?')}<div><b>${esc(c.username ?? 'Deleted user')}</b> <span class="muted">${esc(c.created_at.slice(0, 16))} UTC</span><div class="doc">${renderMarkdown(c.body)}</div></div></div>` })),
      ...eventRows.map((e) => ({ at: e.at, id: e.id, kind: 'history', html: `<div class="event" data-kind="history"><span class="ev-dot"></span><div>${eventHtml(e)} <span class="muted">${esc(e.at.slice(0, 16))} UTC</span></div></div>` })),
    ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.kind === 'comment' ? 1 : -1));
    const links = [
      ...db.prepare('SELECT l.id lid, l.type link_type, 0 inbound, o.* FROM issue_links l JOIN issues o ON o.id = l.to_id WHERE l.from_id = ?').all(i.id),
      ...db.prepare('SELECT l.id lid, l.type link_type, 1 inbound, o.* FROM issue_links l JOIN issues o ON o.id = l.from_id WHERE l.to_id = ?').all(i.id),
    ].map((l) => ({ ...l, phrase: LINKS[l.link_type][l.inbound], key: `${spaceById(l.space_id).key}-${l.num}` }));
    const phrases = [...new Set(links.map((l) => l.phrase))];
    const field = (fieldName, control) => `<form class="field-form" method="post" action="/i/${i.id}/field"><input type="hidden" name="field" value="${fieldName}">${control}</form>`;
    const select = (fieldName, opts, cur, cls = '') => field(fieldName, `<select name="value" class="${cls}" data-auto aria-label="${fieldName}">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`);
    const doneKids = children.filter((c) => c.status === 'done').length;
    page(res, {
      title: `${issueKey(i, space)} ${i.title}`, user: req.user, space, section: 'backlog', toc: false, editUrl: `/i/${i.id}/edit`,
      body: `<div class="jira">${crumbs(space, `<a href="/s/${esc(space.key)}/backlog">Backlog</a>`, ...(i.parent_id ? [`<a href="/i/${i.parent_id}">${esc(space.key)}-${i.parent_num}</a>`] : []), esc(issueKey(i, space)))}
        <div class="issue-grid">
          <div class="issue-main">
            <h1 class="issue-title">${esc(i.title)}</h1>
            <div class="actions"><a class="btn ghost sm" href="/i/${i.id}/edit">${icon('edit')}Edit</a>
              ${watchButton(notifier, req.user, 'issue', i.id)}${req.user.role !== 'viewer' ? addToTasksButton('issue', i.id) : ''}
              <button type="button" class="ghost sm" data-toggle="add-child">${icon('subtask')}Add sub-task</button>
              <button type="button" class="ghost sm" data-toggle="add-link">${icon('link')}Link issue</button>
              <form method="post" action="/i/${i.id}/delete" data-confirm="Move this issue to the trash? You can restore it for 30 days.${children.length ? ' Its sub-tasks become standalone issues.' : ''}"><button class="danger sm">${icon('trash')}Delete</button></form></div>
            <h3 class="j-h">Description</h3>
            <article class="doc">${i.description ? renderMarkdown(i.description) : '<p class="muted">Add a description by editing this issue.</p>'}</article>
            ${files.panel({ issue_id: i.id }, space)}
            ${!i.parent_id ? `<section class="children"><h3 class="j-h">Sub-tasks ${children.length ? `<span class="count">${doneKids}/${children.length}</span>` : ''}</h3>
              ${children.length ? `${progressBar(doneKids, children.length)}<div class="list">${children.map((c) => row(c, space, { drag: false })).join('')}</div>` : ''}
              <form class="quick-add" id="add-child" hidden method="post" action="/s/${esc(space.key)}/issues">
                <input type="hidden" name="parent_id" value="${i.id}"><input type="hidden" name="back" value="/i/${i.id}"><input type="hidden" name="epic_id" value="${i.epic_id ?? ''}">
                <input name="title" placeholder="Sub-task summary" aria-label="Sub-task summary" required><button class="sm">Create</button></form></section>` : ''}
            <section class="links"><h3 class="j-h">Linked issues</h3>
              ${phrases.map((p) => `<div class="link-group"><span class="link-phrase">${esc(p)}</span><div class="list">${links.filter((l) => l.phrase === p).map((l) => `<div class="issue-row link-row">${typeIco(l.type)}<a class="ikey" href="/i/${l.id}">${esc(l.key)}</a><a class="ir-title" href="/i/${l.id}">${esc(l.title)}</a><span class="spacer"></span>${statusChip(l.status)}<form method="post" action="/links/${l.lid}/delete"><input type="hidden" name="back" value="/i/${i.id}"><button class="link-btn danger-text" aria-label="Remove link">${icon('trash')}</button></form></div>`).join('')}</div></div>`).join('')}
              <form class="quick-add" id="add-link" hidden method="post" action="/i/${i.id}/links">
                <select name="type" aria-label="Link type"><option value="blocks">blocks</option><option value="blocked_by">is blocked by</option><option value="relates">relates to</option><option value="duplicates">duplicates</option><option value="duplicated_by">is duplicated by</option></select>
                <input name="key" placeholder="${esc(space.key)}-12" aria-label="Issue key" pattern="[A-Za-z][A-Za-z0-9]+-[0-9]+" required><button class="sm">Link</button></form>
              ${phrases.length ? '' : '<p class="muted">No linked issues.</p>'}</section>
            <h3 class="j-h">Activity</h3>
            <div class="tabs mini" role="tablist"><button type="button" class="tab on" data-activity="all">All</button><button type="button" class="tab" data-activity="comment">Comments</button><button type="button" class="tab" data-activity="history">History</button></div>
            <div class="activity" id="activity">${activity.map((a) => a.html).join('') || '<p class="muted">No activity yet.</p>'}</div>
            <form class="comment-form" method="post" action="/i/${i.id}/comment">${avatar(req.user.username)}<div><textarea name="body" rows="2" placeholder="Add a comment..." aria-label="Comment" required></textarea><button class="sm">Save</button></div></form>
          </div>
          <aside class="issue-side">
            <div class="status-pick">${select('status', STATUSES.map(([v, t]) => [v, t]), i.status, `status-select st-${i.status}`)}</div>
            <div class="details"><h3>Details</h3>
              <dl>
                <dt>Assignee</dt><dd>${select('assignee_id', [['', 'Unassigned'], ...all.map((u) => [u.id, u.username])], i.assignee_id)}</dd>
                <dt>Reporter</dt><dd>${i.reporter_id ? `${avatar(name(i.reporter_id))}${esc(name(i.reporter_id) ?? '')}` : '<span class="muted">None</span>'}</dd>
                <dt>Type</dt><dd>${typeIco(i.type)}${select('type', TYPES.map((t) => [t, label(t)]), i.type)}</dd>
                <dt>Priority</dt><dd>${prioIco(i.priority)}${select('priority', PRIORITIES.map((p) => [p, label(p)]), i.priority)}</dd>
                <dt>Epic</dt><dd>${epicChip(i)}${select('epic_id', [['', 'None'], ...epics.map((e) => [e.id, e.name])], i.epic_id)}</dd>
                <dt>Labels</dt><dd>${field('labels', `<input name="value" value="${esc(i.label_list ? i.label_list.split(',').join(', ') : '')}" placeholder="None" data-auto aria-label="Labels">`)}</dd>
                <dt>Story points</dt><dd>${field('points', `<input name="value" inputmode="numeric" value="${i.points ?? ''}" placeholder="None" data-auto aria-label="Story points">`)}</dd>
                <dt>Sprint</dt><dd>${select('sprint_id', [['', 'Backlog'], ...sprints.map((s) => [s.id, s.name])], i.sprint_id)}</dd>
              </dl></div>
            ${space.github_repo ? `<div class="details dev-panel" data-src="/i/${i.id}/dev"><h3>Development</h3><p class="muted pad">Loading...</p></div>` : ''}
            <p class="muted stamps">Created ${esc(i.created_at.slice(0, 16))} UTC<br>Updated ${esc(i.updated_at.slice(0, 16))} UTC</p>
          </aside>
        </div></div>`,
    });
  });
  // Link two issues (Jira-style: blocks / is blocked by / relates to / duplicates / is duplicated by).
  app.post('/i/:id/links', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const m = /^([A-Za-z][A-Za-z0-9]+)-(\d+)$/.exec(String(req.body.key ?? '').trim());
    const other = m && db.prepare('SELECT i.id FROM issues i JOIN spaces s ON s.id = i.space_id WHERE s.key = ? AND i.num = ?').get(m[1].toUpperCase(), Number(m[2]));
    const t = String(req.body.type ?? '');
    const swap = t === 'blocked_by' || t === 'duplicated_by';
    const type = swap ? t.replace('blocked_by', 'blocks').replace('duplicated_by', 'duplicates') : t;
    if (!other || other.id === i.id || !LINKS[type]) return res.status(400).send('Could not link: check the issue key');
    const [from, to] = swap ? [other.id, i.id] : [i.id, other.id];
    db.prepare('INSERT OR IGNORE INTO issue_links (from_id, to_id, type) VALUES (?, ?, ?)').run(from, to, type);
    res.redirect(`/i/${i.id}`);
  });
  app.post('/links/:id/delete', (req, res) => {
    const l = db.prepare('SELECT * FROM issue_links WHERE id = ?').get(Number(req.params.id));
    if (!l) return res.status(404).send('No such link');
    db.prepare('DELETE FROM issue_links WHERE id = ?').run(l.id);
    const back = String(req.body.back ?? '');
    res.redirect(/^\/i\/\d+$/.test(back) ? back : `/i/${l.from_id}`);
  });
  // Inline single-field edits from the issue sidebar.
  app.post('/i/:id/field', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const space = spaceById(i.space_id);
    const { field, value = '' } = req.body;
    const next = { ...i };
    if (field === 'status' && STATUSES.some((s) => s[0] === value)) next.status = value;
    else if (field === 'type' && TYPES.includes(value)) next.type = value;
    else if (field === 'priority' && PRIORITIES.includes(value)) next.priority = value;
    else if (field === 'points') next.points = pointsOf(value);
    else if (field === 'labels') {
      const before = parseLabels(getIssueFull(db, i.id).label_list).join(', '), after = parseLabels(value).join(', ');
      let ch = [];
      tx(db, () => { ch = recordChanges(db, i.id, req.user.id, { labels: before }, { labels: after }); setLabels(db, i.id, value); db.prepare('UPDATE issues SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(i.id); });
      notifier.issueChanged(getIssue(i.id), space, req.user, ch);
      return res.redirect(`/i/${i.id}`);
    }
    else if (field === 'epic_id') next.epic_id = value && db.prepare('SELECT id FROM epics WHERE id = ? AND space_id = ?').get(Number(value), space.id) ? Number(value) : null;
    else if (field === 'assignee_id') next.assignee_id = value && db.prepare('SELECT id FROM users WHERE id = ?').get(Number(value)) ? Number(value) : null;
    else if (field === 'sprint_id') next.sprint_id = value && db.prepare("SELECT id FROM sprints WHERE id = ? AND space_id = ? AND state != 'closed'").get(Number(value), space.id) ? Number(value) : null;
    else return res.status(400).send('Bad field');
    let ch = [];
    tx(db, () => {
      db.prepare('UPDATE issues SET status=?, type=?, priority=?, points=?, assignee_id=?, sprint_id=?, epic_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(next.status, next.type, next.priority, next.points, next.assignee_id, next.sprint_id, next.epic_id, i.id);
      ch = recordChanges(db, i.id, req.user.id, i, next);
      logChange(db, i.id, i, next);
    });
    notifier.issueChanged(getIssue(i.id), space, req.user, ch);
    res.redirect(`/i/${i.id}`);
  });
  app.get('/i/:id/edit', (req, res) => {
    const i = getIssueFull(db, req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const space = spaceById(i.space_id);
    page(res, {
      title: `Edit ${issueKey(i, space)}`, user: req.user, space, section: 'backlog', toc: false,
      body: `<div class="jira"><span class="eyebrow">${esc(issueKey(i, space))}</span><h1 class="page-title">Edit issue</h1>${issueForm(space, i, `/i/${i.id}`, 'Save changes')}</div>`,
    });
  });
  app.post('/i/:id', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const f = saveFields(req.body, spaceById(i.space_id), i.id);
    if (!f) return res.status(400).send('Title required');
    const oldLabels = parseLabels(getIssueFull(db, i.id).label_list).join(', ');
    let changes = [];
    tx(db, () => {
      db.prepare(`UPDATE issues SET title=?, description=?, type=?, priority=?, status=?, points=?, sprint_id=?, assignee_id=?, epic_id=?, parent_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(f.title, f.description, f.type, f.priority, f.status, f.points, f.sprint_id, f.assignee_id, f.epic_id, f.parent_id, i.id);
      changes = recordChanges(db, i.id, req.user.id, { ...i, labels: oldLabels }, f);
      setLabels(db, i.id, f.labels);
      files.adopt(i.space_id, { issue_id: i.id }, f.description);
      logChange(db, i.id, i, f);
    });
    notifier.issueChanged(getIssue(i.id), spaceById(i.space_id), req.user, changes, changes.some((c) => c.field === 'description') ? f.description : '');
    res.redirect(`/i/${i.id}`);
  });
  app.post('/i/:id/delete', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const space = spaceById(i.space_id);
    const id = ctx.trash.trashIssue(i, space, req.user);
    res.redirect(`/s/${space.key}/backlog?trashed=${id}`);
  });
  app.post('/i/:id/comment', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const body = str(req.body.body, 20000);
    if (body) {
      db.prepare('INSERT INTO comments (issue_id, author_id, body) VALUES (?, ?, ?)').run(i.id, req.user.id, body);
      notifier.issueComment(i, spaceById(i.space_id), req.user, body);
    }
    res.redirect(`/i/${i.id}`);
  });

  // Drag-and-drop: set status and/or sprint, and place the card before another (or at the end).
  app.post('/issues/:id/move', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).json({ error: 'not found' });
    const b = req.body;
    let status = i.status, sprintId = i.sprint_id;
    const hasStatus = STATUSES.some((s) => s[0] === b.status);
    if (hasStatus) status = b.status;
    if ('sprint' in b) {
      sprintId = b.sprint ? Number(b.sprint) : null;
      if (sprintId && !db.prepare("SELECT 1 FROM sprints WHERE id = ? AND space_id = ? AND state != 'closed'").get(sprintId, i.space_id))
        return res.status(400).json({ error: 'bad sprint' });
    }
    let moved = [];
    tx(db, () => {
      // neighbours in the destination container, excluding the card being moved
      const peers = db.prepare(`SELECT id, rank FROM issues WHERE space_id = ? AND sprint_id IS ? AND id != ? ${hasStatus ? 'AND status = ?' : ''} ORDER BY rank, id`)
        .all(...[i.space_id, sprintId, i.id, ...(hasStatus ? [status] : [])]);
      const at = peers.findIndex((p) => p.id === Number(b.before));
      let rank;
      if (at === -1) rank = (peers.at(-1)?.rank ?? 0) + 1;
      else if (at === 0) rank = peers[0].rank - 1;
      else rank = (peers[at - 1].rank + peers[at].rank) / 2;
      db.prepare('UPDATE issues SET status = ?, sprint_id = ?, rank = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, sprintId, rank, i.id);
      moved = recordChanges(db, i.id, req.user.id, i, { status, sprint_id: sprintId });
      logChange(db, i.id, i, { sprint_id: sprintId, status, points: i.points });
    });
    notifier.issueChanged(getIssue(i.id), spaceById(i.space_id), req.user, moved);
    res.json({ ok: true });
  });
}

function emptyBoard() {
  return `<svg class="art" viewBox="0 0 84 84" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="14" width="18" height="56" rx="3"/><rect x="33" y="14" width="18" height="38" rx="3"/><rect x="56" y="14" width="18" height="46" rx="3"/></svg>`;
}
