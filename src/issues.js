// Shared issue data access and HTML fragments (cards, rows, chips) used by the board, backlog, epics and issue search.
import { esc, icon, hueClass } from './render.js';

export const TYPES = ['story', 'bug', 'task'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const STATUSES = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
export const label = (s) => s[0].toUpperCase() + s.slice(1);
export const initial = (name) => esc((name ?? '?').slice(0, 1).toUpperCase());
export const issueKey = (i, space) => `${space.key}-${i.num}`;
export const sum = (rows) => rows.reduce((a, r) => a + (r.points ?? 0), 0);
export const pointsOf = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Math.trunc(Number(v)))));

// ---- labels ----
export function parseLabels(text) {
  const seen = new Set();
  for (const raw of String(text ?? '').split(/[\s,]+/)) {
    const l = raw.toLowerCase().replace(/[^a-z0-9_:.-]/g, '').slice(0, 24);
    if (l) seen.add(l);
    if (seen.size >= 10) break;
  }
  return [...seen];
}
export function setLabels(db, issueId, text) {
  db.prepare('DELETE FROM issue_labels WHERE issue_id = ?').run(issueId);
  for (const l of parseLabels(text)) db.prepare('INSERT INTO issue_labels (issue_id, label) VALUES (?, ?)').run(issueId, l);
}

// ---- queries ----
const SELECT = `SELECT i.*, u.username assignee, e.name epic_name, pi.num parent_num, pi.title parent_title,
  (SELECT group_concat(label, ',') FROM issue_labels WHERE issue_id = i.id) label_list
  FROM issues i LEFT JOIN users u ON u.id = i.assignee_id LEFT JOIN epics e ON e.id = i.epic_id LEFT JOIN issues pi ON pi.id = i.parent_id`;
export function listIssues(db, where, ...args) {
  return db.prepare(`${SELECT} WHERE ${where} ORDER BY i.rank, i.id`).all(...args);
}
export function getIssueFull(db, id) {
  return db.prepare(`${SELECT} WHERE i.id = ?`).get(Number(id));
}

// ---- fragments ----
export const typeIco = (t) => `<span class="type-ico t-${t}" title="${label(t)}">${icon(t)}</span>`;
export const prioIco = (p) => `<span class="prio p-${p}" title="${label(p)} priority">${icon(p === 'high' ? 'up' : p === 'low' ? 'down' : 'equals')}</span>`;
export const avatar = (name) =>
  name ? `<span class="avatar sm-av ${hueClass(name)}" title="${esc(name)}">${initial(name)}</span>` : '<span class="avatar sm-av unassigned" title="Unassigned"></span>';
export const statusChip = (st) => `<span class="chip st-${st}">${STATUSES.find((s) => s[0] === st)[1]}</span>`;
export const epicChip = (i) => (i.epic_id ? `<span class="epic-chip ${hueClass('epic' + i.epic_id)}" title="Epic: ${esc(i.epic_name)}">${esc(i.epic_name)}</span>` : '');
export const labelChips = (i) => (i.label_list ? i.label_list.split(',').map((l) => `<span class="label-chip">${esc(l)}</span>`).join('') : '');

export const parentChip = (i, space) => (i.parent_id ? `<span class="parent-chip" title="Sub-task of ${esc(space.key)}-${i.parent_num}: ${esc(i.parent_title)}">${icon('subtask')}${esc(space.key)}-${i.parent_num}</span>` : '');

const dataAttrs = (i, space) =>
  `data-drag data-id="${i.id}" data-points="${i.points ?? 0}" data-assignee="${esc(i.assignee ?? '')}" data-epic="${i.epic_id ?? ''}" data-labels=",${esc(i.label_list ?? '')},"
   data-text="${esc(`${issueKey(i, space)} ${i.title}`.toLowerCase())}"`;

export function card(i, space) {
  const tags = parentChip(i, space) + epicChip(i) + labelChips(i);
  return `<a class="issue-card${i.status === 'done' ? ' is-done' : ''}" draggable="true" ${dataAttrs(i, space)} href="/i/${i.id}">
    <span class="ic-title">${esc(i.title)}</span>${tags ? `<span class="ic-tags">${tags}</span>` : ''}
    <span class="ic-foot">${typeIco(i.type)}<span class="ikey">${esc(issueKey(i, space))}</span><span class="spacer"></span>
    ${prioIco(i.priority)}${i.points != null ? `<span class="pts">${i.points}</span>` : ''}${avatar(i.assignee)}</span></a>`;
}
export function row(i, space, { drag = true } = {}) {
  return `<a class="issue-row${i.status === 'done' ? ' is-done' : ''}" ${drag ? 'draggable="true"' : ''} ${dataAttrs(i, space)} href="/i/${i.id}">
    ${typeIco(i.type)}<span class="ikey">${esc(issueKey(i, space))}</span><span class="ir-title">${esc(i.title)}</span>${parentChip(i, space)}${epicChip(i)}${labelChips(i)}<span class="spacer"></span>
    ${statusChip(i.status)}${prioIco(i.priority)}${i.points != null ? `<span class="pts">${i.points}</span>` : '<span class="pts none">-</span>'}${avatar(i.assignee)}</a>`;
}
export const crumbs = (space, ...rest) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Spaces</a>${icon('chevron')}<a href="/s/${esc(space.key)}">${esc(space.name)}</a>${rest.map((r) => `${icon('chevron')}${r}`).join('')}</nav>`;

export function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span class="fill w${Math.round(pct / 5) * 5}"></span></div>`;
}

// ---- change history ("History" tab on an issue) ----
export const FIELD_LABELS = { title: 'Summary', description: 'Description', status: 'Status', type: 'Type', priority: 'Priority', points: 'Story points',
  assignee_id: 'Assignee', sprint_id: 'Sprint', epic_id: 'Epic', labels: 'Labels', parent_id: 'Parent', created: 'Issue' };

// Compare two issue states and write one event per changed field. Names are looked up now so history stays readable later.
export function recordChanges(db, issueId, userId, before, after) {
  const pretty = {
    status: (v) => STATUSES.find((s) => s[0] === v)?.[1] ?? v,
    type: label, priority: label,
    points: (v) => (v == null ? 'None' : String(v)),
    assignee_id: (v) => (v ? db.prepare('SELECT username FROM users WHERE id = ?').get(v)?.username ?? 'Unknown' : 'Unassigned'),
    sprint_id: (v) => (v ? db.prepare('SELECT name FROM sprints WHERE id = ?').get(v)?.name ?? 'Unknown' : 'Backlog'),
    epic_id: (v) => (v ? db.prepare('SELECT name FROM epics WHERE id = ?').get(v)?.name ?? 'Unknown' : 'None'),
    parent_id: (v) => (v ? `#${v}` : 'None'),
  };
  const insert = db.prepare('INSERT INTO issue_events (issue_id, user_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)');
  const changes = [];
  const record = (field, a, b) => { insert.run(issueId, userId, field, a, b); changes.push({ field, from: a, to: b }); };
  for (const f of ['title', 'status', 'type', 'priority', 'points', 'assignee_id', 'sprint_id', 'epic_id', 'labels', 'parent_id']) {
    if (!(f in after)) continue;
    const a = before[f] ?? null, b = after[f] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    const fmt = pretty[f] ?? ((v) => (v == null || v === '' ? 'None' : String(v)));
    record(f, fmt(a), fmt(b));
  }
  if ('description' in after && (before.description ?? '') !== (after.description ?? '')) record('description', null, null);
  return changes;
}
export const logCreated = (db, issueId, userId) => db.prepare("INSERT INTO issue_events (issue_id, user_id, field) VALUES (?, ?, 'created')").run(issueId, userId);

export function eventHtml(e) {
  const who = `<b>${esc(e.username ?? 'Someone')}</b>`;
  if (e.field === 'created') return `${who} created the issue`;
  if (e.field === 'description') return `${who} updated the description`;
  return `${who} changed <b>${FIELD_LABELS[e.field] ?? esc(e.field)}</b> from <span class="ev-val">${esc(e.old_value ?? 'None')}</span> to <span class="ev-val">${esc(e.new_value ?? 'None')}</span>`;
}
