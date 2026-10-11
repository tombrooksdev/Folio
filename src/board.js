// Scrum board: backlog, sprints, issues, drag-and-drop ordering. Mounted onto the main app after auth.
import { tx } from './db.js';
import { esc, icon, renderMarkdown, hueClass } from './render.js';
import { logChange, mountReports, sprintStats, burndownSvg } from './reports.js';

const TYPES = ['story', 'bug', 'task'];
const PRIORITIES = ['high', 'medium', 'low'];
const STATUSES = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
const label = (s) => s[0].toUpperCase() + s.slice(1);
const initial = (name) => esc((name ?? '?').slice(0, 1).toUpperCase());

export function mountBoard(app, { db, page, getSpace }) {
  mountReports(app, { db, page, getSpace });
  const issueKey = (i, space) => `${space.key}-${i.num}`;
  const getIssue = (id) => db.prepare('SELECT * FROM issues WHERE id = ?').get(Number(id));
  const spaceById = (id) => db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
  const users = () => db.prepare('SELECT id, username FROM users ORDER BY username').all();
  const optional = (v, allowed) => (allowed.includes(v) ? v : allowed[0]);
  const pointsOf = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Math.trunc(Number(v)))));

  function listIssues(where, ...args) {
    return db.prepare(
      `SELECT i.*, u.username assignee FROM issues i LEFT JOIN users u ON u.id = i.assignee_id WHERE ${where} ORDER BY i.rank, i.id`
    ).all(...args);
  }
  const sum = (rows) => rows.reduce((a, r) => a + (r.points ?? 0), 0);

  const typeIco = (t) => `<span class="type-ico t-${t}" title="${label(t)}">${icon(t)}</span>`;
  const prioIco = (p) => `<span class="prio p-${p}" title="${label(p)} priority">${icon(p === 'high' ? 'up' : p === 'low' ? 'down' : 'equals')}</span>`;
  const avatar = (name) => (name ? `<span class="avatar sm-av ${hueClass(name)}" title="${esc(name)}">${initial(name)}</span>` : '<span class="avatar sm-av unassigned" title="Unassigned"></span>');
  const dataAttrs = (i, space) => `data-drag data-id="${i.id}" data-points="${i.points ?? 0}" data-assignee="${esc(i.assignee ?? '')}" data-text="${esc(`${issueKey(i, space)} ${i.title}`.toLowerCase())}"`;
  const status = (st) => `<span class="chip st-${st}">${STATUSES.find((s) => s[0] === st)[1]}</span>`;

  function card(i, space) {
    return `<a class="issue-card${i.status === 'done' ? ' is-done' : ''}" draggable="true" ${dataAttrs(i, space)} href="/i/${i.id}">
      <span class="ic-title">${esc(i.title)}</span>
      <span class="ic-foot">${typeIco(i.type)}<span class="ikey">${esc(issueKey(i, space))}</span><span class="spacer"></span>
      ${prioIco(i.priority)}${i.points != null ? `<span class="pts">${i.points}</span>` : ''}${avatar(i.assignee)}</span></a>`;
  }
  function row(i, space) {
    return `<a class="issue-row${i.status === 'done' ? ' is-done' : ''}" draggable="true" ${dataAttrs(i, space)} href="/i/${i.id}">
      ${typeIco(i.type)}<span class="ikey">${esc(issueKey(i, space))}</span><span class="ir-title">${esc(i.title)}</span><span class="spacer"></span>
      ${status(i.status)}${prioIco(i.priority)}${i.points != null ? `<span class="pts">${i.points}</span>` : '<span class="pts none">-</span>'}${avatar(i.assignee)}</a>`;
  }
  const quickAdd = (space, sprintId, id) => `<button type="button" class="create-row" data-toggle="${id}">${icon('plus')}Create issue</button>
    <form class="quick-add" id="${id}" hidden method="post" action="/s/${esc(space.key)}/issues">
      <input type="hidden" name="sprint_id" value="${sprintId ?? ''}"><input type="hidden" name="back" value="backlog">
      <select name="type" aria-label="Issue type">${TYPES.map((t) => `<option value="${t}">${label(t)}</option>`).join('')}</select>
      <input name="title" placeholder="What needs to be done?" aria-label="New issue title" required><button class="sm">Create</button></form>`;
  const crumbs = (space, ...rest) => `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Spaces</a>${icon('chevron')}<a href="/s/${esc(space.key)}">${esc(space.name)}</a>${rest.map((r) => `${icon('chevron')}${r}`).join('')}</nav>`;

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
    const issues = listIssues('i.sprint_id = ?', sprint.id);
    const total = sum(issues), done = sum(issues.filter((i) => i.status === 'done'));
    const pct = total ? Math.round((done / total) * 100) : 0;
    const left = Math.ceil((new Date(sprint.ends_at) - Date.now()) / 864e5);
    const people = users();
    page(res, {
      title: `Board`, user: req.user, space, section: 'board', toc: false,
      body: `<div class="jira">${crumbs(space, 'Board')}
        <div class="j-head"><div><h1 class="page-title">${esc(space.key)} board</h1>
          <p class="j-sub"><b>${esc(sprint.name)}</b>${sprint.goal ? `<span class="goal">${icon('flag')}${esc(sprint.goal)}</span>` : ''}</p></div>
          <div class="actions"><span class="j-chip" title="Sprint ends ${esc(sprint.ends_at.slice(0, 10))}">${icon('clock')}${left >= 0 ? `${left} day${left === 1 ? '' : 's'} remaining` : `${-left} day${left === -1 ? '' : 's'} overdue`}</span>
          <form method="post" action="/sprints/${sprint.id}/complete" data-confirm="Complete this sprint? Unfinished issues return to the backlog."><button class="ghost">Complete sprint</button></form></div></div>
        <div class="j-filters"><div class="j-search-wrap">${icon('search')}<input class="j-search" id="board-search" type="search" placeholder="Search this board" aria-label="Search this board"></div>
          <div class="av-filters" aria-label="Filter by assignee">${people.map((u) => `<button type="button" class="av-filter avatar ${hueClass(u.username)}" data-user="${esc(u.username)}" title="${esc(u.username)}" aria-pressed="false">${initial(u.username)}</button>`).join('')}</div>
          <button type="button" class="link-btn" id="only-mine" data-me="${esc(req.user.username)}">Only my issues</button>
          <button type="button" class="link-btn" id="clear-filters" hidden>Clear filters</button>
          <span class="j-progress muted"><b>${done}</b> of <b>${total}</b> points done (${pct}%)</span></div>
        <details class="burndown"><summary>Burndown</summary><div class="chart-card">${burndownSvg(sprintStats(db, sprint))}</div><p><a href="/sprints/${sprint.id}/report">Full sprint report</a></p></details>
        <div class="board">${STATUSES.map(([st, name]) => {
          const col = issues.filter((i) => i.status === st);
          return `<section class="column"><header><h2>${name}</h2><span class="count" data-count>${col.length}</span><span class="pts" data-points-total>${sum(col)}</span></header>
            <div class="drop" data-drop data-status="${st}" data-sprint="${sprint.id}">${col.map((i) => card(i, space)).join('')}</div></section>`;
        }).join('')}</div></div>
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
      const items = listIssues(s ? 'i.sprint_id = ?' : 'i.space_id = ? AND i.sprint_id IS NULL', s ? s.id : space.id);
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
      body: `<div class="jira">${crumbs(space, 'Backlog')}
        <div class="j-head"><h1 class="page-title">Backlog</h1><div class="actions"><a class="btn ghost" href="/s/${esc(space.key)}/issues/new">${icon('plus')}Create issue</a></div></div>
        <form class="new-space" id="new-sprint" hidden method="post" action="/s/${esc(space.key)}/sprints">
          <input name="name" placeholder="Sprint name, e.g. Sprint ${sprints.length + 1}" aria-label="Sprint name" required><input name="goal" placeholder="Sprint goal (optional)" aria-label="Sprint goal"><button>Create sprint</button></form>
        ${sprints.map(block).join('')}${block(null)}</div>
        <script src="/board.js"></script>`,
    });
  });

  // ---- sprints ----
  app.post('/s/:key/sprints', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const name = (req.body.name ?? '').trim();
    if (!name) return res.status(400).send('Name required');
    db.prepare('INSERT INTO sprints (space_id, name, goal) VALUES (?, ?, ?)').run(space.id, name, (req.body.goal ?? '').trim());
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
    res.redirect(`/s/${spaceById(s.space_id).key}/reports`);
  });

  // ---- issues ----
  function issueForm(space, i, action, heading) {
    const sprints = db.prepare("SELECT * FROM sprints WHERE space_id = ? AND state != 'closed' ORDER BY id").all(space.id);
    const opts = (list, cur, fmt = label) => list.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${fmt(v)}</option>`).join('');
    return `<form class="issue-form" method="post" action="${action}">
      <input type="hidden" name="back" value="${esc(i.back ?? '')}">
      <input class="title-input" name="title" value="${esc(i.title)}" placeholder="Issue title" aria-label="Title" required autofocus>
      <div class="fields">
        <label>Type<select name="type">${opts(TYPES, i.type)}</select></label>
        <label>Priority<select name="priority">${opts(PRIORITIES, i.priority)}</select></label>
        <label>Status<select name="status">${opts(STATUSES.map((s) => s[0]), i.status, (v) => STATUSES.find((s) => s[0] === v)[1])}</select></label>
        <label>Story points<input name="points" inputmode="numeric" value="${i.points ?? ''}" placeholder="-"></label>
        <label>Sprint<select name="sprint_id"><option value="">Backlog</option>${sprints.map((s) => `<option value="${s.id}"${s.id === i.sprint_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label>Assignee<select name="assignee_id"><option value="">Unassigned</option>${users().map((u) => `<option value="${u.id}"${u.id === i.assignee_id ? ' selected' : ''}>${esc(u.username)}</option>`).join('')}</select></label>
      </div>
      <label class="desc">Description <span class="muted">(Markdown)</span><textarea name="description" rows="10" placeholder="What needs doing, and how will we know it's done?">${esc(i.description)}</textarea></label>
      <div class="actions"><button>${esc(heading)}</button><a class="btn ghost" href="${i.id ? `/i/${i.id}` : `/s/${esc(space.key)}/backlog`}">Cancel</a></div></form>`;
  }
  const blank = { title: '', description: '', type: 'story', priority: 'medium', status: 'todo', points: null, sprint_id: null, assignee_id: null };

  app.get('/s/:key/issues/new', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    page(res, {
      title: 'Create issue', user: req.user, space, section: 'backlog', toc: false,
      body: `<span class="eyebrow">${esc(space.name)}</span><h1 class="page-title">Create issue</h1>${issueForm(space, { ...blank }, `/s/${esc(space.key)}/issues`, 'Create issue')}`,
    });
  });

  function saveFields(body, space) {
    const title = (body.title ?? '').trim();
    if (!title) return null;
    const sprintId = body.sprint_id ? Number(body.sprint_id) : null;
    const sprint = sprintId ? db.prepare("SELECT * FROM sprints WHERE id = ? AND space_id = ? AND state != 'closed'").get(sprintId, space.id) : null;
    const assignee = body.assignee_id ? db.prepare('SELECT id FROM users WHERE id = ?').get(Number(body.assignee_id)) : null;
    return {
      title, description: body.description ?? '', type: optional(body.type, TYPES), priority: optional(body.priority ?? 'medium', PRIORITIES.includes(body.priority) ? [body.priority] : ['medium']),
      status: STATUSES.some((s) => s[0] === body.status) ? body.status : 'todo', points: pointsOf(body.points),
      sprint_id: sprint?.id ?? null, assignee_id: assignee?.id ?? null,
    };
  }
  app.post('/s/:key/issues', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const f = saveFields(req.body, space);
    if (!f) return res.status(400).send('Title required');
    const id = tx(db, () => {
      const num = db.prepare('SELECT COALESCE(MAX(num), 0) + 1 n FROM issues WHERE space_id = ?').get(space.id).n;
      const rank = (db.prepare('SELECT COALESCE(MAX(rank), 0) + 1 r FROM issues WHERE space_id = ?').get(space.id).r);
      const newId = Number(db.prepare(`INSERT INTO issues (space_id, num, title, description, type, priority, status, points, sprint_id, assignee_id, reporter_id, rank)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(space.id, num, f.title, f.description, f.type, f.priority, f.status, f.points, f.sprint_id, f.assignee_id, req.user.id, rank).lastInsertRowid);
      logChange(db, newId, null, f);
      return newId;
    });
    res.redirect(req.body.back === 'backlog' ? `/s/${space.key}/backlog` : `/i/${id}`);
  });

  app.get('/i/:id', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const space = spaceById(i.space_id);
    const all = users();
    const name = (id) => all.find((u) => u.id === id)?.username;
    const sprints = db.prepare("SELECT * FROM sprints WHERE space_id = ? AND state != 'closed' ORDER BY id").all(space.id);
    const comments = db.prepare('SELECT c.*, u.username FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE issue_id = ? ORDER BY c.id').all(i.id);
    const field = (fieldName, control) => `<form class="field-form" method="post" action="/i/${i.id}/field"><input type="hidden" name="field" value="${fieldName}">${control}</form>`;
    const select = (fieldName, opts, cur, cls = '') => field(fieldName, `<select name="value" class="${cls}" data-auto aria-label="${fieldName}">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`);
    page(res, {
      title: `${issueKey(i, space)} ${i.title}`, user: req.user, space, section: 'backlog', toc: false,
      body: `<div class="jira">${crumbs(space, `<a href="/s/${esc(space.key)}/backlog">Backlog</a>`, esc(issueKey(i, space)))}
        <div class="issue-grid">
          <div class="issue-main">
            <h1 class="issue-title">${esc(i.title)}</h1>
            <div class="actions"><a class="btn ghost sm" href="/i/${i.id}/edit">${icon('edit')}Edit</a>
              <form method="post" action="/i/${i.id}/delete" data-confirm="Delete this issue?"><button class="danger sm">${icon('trash')}Delete</button></form></div>
            <h3 class="j-h">Description</h3>
            <article class="doc">${i.description ? renderMarkdown(i.description) : '<p class="muted">Add a description by editing this issue.</p>'}</article>
            <h3 class="j-h">Activity</h3>
            <div class="comments">${comments.map((c) => `<div class="comment">${avatar(c.username ?? '?')}<div><b>${esc(c.username ?? 'Deleted user')}</b> <span class="muted">${esc(c.created_at.slice(0, 16))} UTC</span><div class="doc">${renderMarkdown(c.body)}</div></div></div>`).join('')}</div>
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
                <dt>Story points</dt><dd>${field('points', `<input name="value" inputmode="numeric" value="${i.points ?? ''}" placeholder="None" data-auto aria-label="Story points">`)}</dd>
                <dt>Sprint</dt><dd>${select('sprint_id', [['', 'Backlog'], ...sprints.map((s) => [s.id, s.name])], i.sprint_id)}</dd>
              </dl></div>
            <p class="muted stamps">Created ${esc(i.created_at.slice(0, 16))} UTC<br>Updated ${esc(i.updated_at.slice(0, 16))} UTC</p>
          </aside>
        </div></div>
        <script src="/board.js"></script>`,
    });
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
    else if (field === 'assignee_id') next.assignee_id = value && db.prepare('SELECT id FROM users WHERE id = ?').get(Number(value)) ? Number(value) : null;
    else if (field === 'sprint_id') next.sprint_id = value && db.prepare("SELECT id FROM sprints WHERE id = ? AND space_id = ? AND state != 'closed'").get(Number(value), space.id) ? Number(value) : null;
    else return res.status(400).send('Bad field');
    tx(db, () => {
      db.prepare('UPDATE issues SET status=?, type=?, priority=?, points=?, assignee_id=?, sprint_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(next.status, next.type, next.priority, next.points, next.assignee_id, next.sprint_id, i.id);
      logChange(db, i.id, i, next);
    });
    res.redirect(`/i/${i.id}`);
  });
  app.get('/i/:id/edit', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const space = spaceById(i.space_id);
    page(res, {
      title: `Edit ${issueKey(i, space)}`, user: req.user, space, section: 'backlog', toc: false,
      body: `<span class="eyebrow">${esc(issueKey(i, space))}</span><h1 class="page-title">Edit issue</h1>${issueForm(space, i, `/i/${i.id}`, 'Save changes')}`,
    });
  });
  app.post('/i/:id', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const f = saveFields(req.body, spaceById(i.space_id));
    if (!f) return res.status(400).send('Title required');
    tx(db, () => {
      db.prepare(`UPDATE issues SET title=?, description=?, type=?, priority=?, status=?, points=?, sprint_id=?, assignee_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(f.title, f.description, f.type, f.priority, f.status, f.points, f.sprint_id, f.assignee_id, i.id);
      logChange(db, i.id, i, f);
    });
    res.redirect(`/i/${i.id}`);
  });
  app.post('/i/:id/delete', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    tx(db, () => { logChange(db, i.id, i, null); db.prepare('DELETE FROM issues WHERE id = ?').run(i.id); });
    res.redirect(`/s/${spaceById(i.space_id).key}/backlog`);
  });
  app.post('/i/:id/comment', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).send('No such issue');
    const body = (req.body.body ?? '').trim();
    if (body) db.prepare('INSERT INTO comments (issue_id, author_id, body) VALUES (?, ?, ?)').run(i.id, req.user.id, body);
    res.redirect(`/i/${i.id}`);
  });

  // Drag-and-drop: set status and/or sprint, and place the card before another (or at the end).
  app.post('/issues/:id/move', (req, res) => {
    const i = getIssue(req.params.id);
    if (!i) return res.status(404).json({ error: 'not found' });
    const b = req.body;
    let status = i.status, sprintId = i.sprint_id;
    if (STATUSES.some((s) => s[0] === b.status)) status = b.status;
    if ('sprint' in b) {
      sprintId = b.sprint ? Number(b.sprint) : null;
      if (sprintId && !db.prepare("SELECT 1 FROM sprints WHERE id = ? AND space_id = ? AND state != 'closed'").get(sprintId, i.space_id))
        return res.status(400).json({ error: 'bad sprint' });
    }
    tx(db, () => {
      // neighbours in the destination container, excluding the card being moved
      const peers = db.prepare(
        `SELECT id, rank FROM issues WHERE space_id = ? AND sprint_id IS ? AND id != ? ${STATUSES.some((s) => s[0] === b.status) ? 'AND status = ?' : ''} ORDER BY rank, id`
      ).all(...[i.space_id, sprintId, i.id, ...(STATUSES.some((s) => s[0] === b.status) ? [status] : [])]);
      const at = peers.findIndex((p) => p.id === Number(b.before));
      let rank;
      if (at === -1) rank = (peers.at(-1)?.rank ?? 0) + 1;
      else if (at === 0) rank = peers[0].rank - 1;
      else rank = (peers[at - 1].rank + peers[at].rank) / 2;
      db.prepare('UPDATE issues SET status = ?, sprint_id = ?, rank = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, sprintId, rank, i.id);
      logChange(db, i.id, i, { sprint_id: sprintId, status, points: i.points });
    });
    res.json({ ok: true });
  });
}

function emptyBoard() {
  return `<svg class="art" viewBox="0 0 84 84" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="14" width="18" height="56" rx="3"/><rect x="33" y="14" width="18" height="38" rx="3"/><rect x="56" y="14" width="18" height="46" rx="3"/></svg>`;
}
