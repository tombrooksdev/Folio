// Epics: group issues under a larger goal, with progress rolled up from their issues.
import { esc, icon, renderMarkdown, hueClass } from './render.js';
import { str } from './util.js';
import { listIssues, row, sum, crumbs, progressBar } from './issues.js';

export function epicsFor(db, spaceId) {
  return db.prepare(`SELECT e.*,
      (SELECT COUNT(*) FROM issues WHERE epic_id = e.id) total,
      (SELECT COUNT(*) FROM issues WHERE epic_id = e.id AND status = 'done') done_count,
      (SELECT COALESCE(SUM(points), 0) FROM issues WHERE epic_id = e.id) pts,
      (SELECT COALESCE(SUM(points), 0) FROM issues WHERE epic_id = e.id AND status = 'done') pts_done
    FROM epics e WHERE e.space_id = ? ORDER BY e.done, e.name`).all(spaceId);
}

export function epicsPanel(space, epics) {
  return `<details class="epics-panel"${epics.length ? ' open' : ''}><summary>Epics <span class="count">${epics.length}</span></summary>
    <div class="epic-list">${epics.map((e) => `<div class="epic-card${e.done ? ' is-done' : ''}" data-epic-filter="${e.id}">
        <div class="epic-top"><button type="button" class="epic-chip ${hueClass('epic' + e.id)}" data-epic-pick="${e.id}" aria-pressed="false" title="Filter the backlog by this epic">${esc(e.name)}</button>
          <a class="epic-open" href="/e/${e.id}" title="Open epic" aria-label="Open epic ${esc(e.name)}">${icon('arrow')}</a></div>
        ${progressBar(e.pts_done, e.pts)}
        <span class="muted">${e.done_count} of ${e.total} done · ${e.pts_done}/${e.pts} pts</span></div>`).join('')}
      <form class="epic-new" method="post" action="/s/${esc(space.key)}/epics"><input name="name" placeholder="Create epic" aria-label="Epic name" required><button class="ghost sm">${icon('plus')}</button></form></div></details>`;
}

export function mountEpics(app, { db, page, getSpace }) {
  const getEpic = (id) => db.prepare('SELECT * FROM epics WHERE id = ?').get(Number(id));
  const spaceById = (id) => db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);

  app.post('/s/:key/epics', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const name = str(req.body.name, 60);
    if (!name) return res.status(400).send('Name required');
    db.prepare('INSERT INTO epics (space_id, name, description) VALUES (?, ?, ?)').run(space.id, name, str(req.body.description, 20000, { trim: false }));
    res.redirect(`/s/${space.key}/backlog`);
  });

  app.get('/e/:id', (req, res) => {
    const e = getEpic(req.params.id);
    if (!e) return res.status(404).send('No such epic');
    const space = spaceById(e.space_id);
    const issues = listIssues(db, 'i.epic_id = ?', e.id);
    const done = issues.filter((i) => i.status === 'done');
    page(res, {
      title: `Epic: ${e.name}`, user: req.user, space, section: 'backlog', toc: false,
      body: `<div class="jira">${crumbs(space, `<a href="/s/${esc(space.key)}/backlog">Backlog</a>`, 'Epic')}
        <div class="j-head"><div><h1 class="page-title"><span class="epic-chip big ${hueClass('epic' + e.id)}">${esc(e.name)}</span></h1>
          <p class="j-sub"><span class="chip st-${e.done ? 'done' : 'doing'}">${e.done ? 'Done' : 'Open'}</span><span class="muted">${done.length} of ${issues.length} issues done · ${sum(done)}/${sum(issues)} points</span></p></div>
          <div class="actions"><a class="btn ghost" href="/s/${esc(space.key)}/issues/new?epic=${e.id}">${icon('plus')}Create issue</a>
            <form method="post" action="/e/${e.id}/done"><button class="ghost">${e.done ? 'Reopen epic' : 'Mark as done'}</button></form></div></div>
        ${progressBar(sum(done), sum(issues))}
        ${e.description ? `<article class="doc">${renderMarkdown(e.description)}</article>` : ''}
        <div class="section-head"><h2>Issues in this epic</h2></div>
        <div class="list">${issues.map((i) => row(i, space, { drag: false })).join('') || '<p class="muted pad">No issues yet. Add the epic to an issue from its details panel.</p>'}</div>
        <div class="section-head"><h2>Edit epic</h2></div>
        <form class="issue-form" method="post" action="/e/${e.id}">
          <input name="name" value="${esc(e.name)}" aria-label="Epic name" required>
          <textarea name="description" rows="5" placeholder="What is this epic about? (Markdown)" aria-label="Description">${esc(e.description)}</textarea>
          <div class="actions"><button>Save epic</button></div></form>
        <form method="post" action="/e/${e.id}/delete" data-confirm="Delete this epic? Its issues stay, but lose the epic."><button class="danger sm">${icon('trash')}Delete epic</button></form></div>`,
    });
  });
  app.post('/e/:id', (req, res) => {
    const e = getEpic(req.params.id);
    if (!e) return res.status(404).send('No such epic');
    const name = str(req.body.name, 60);
    if (!name) return res.status(400).send('Name required');
    db.prepare('UPDATE epics SET name = ?, description = ? WHERE id = ?').run(name, str(req.body.description, 20000, { trim: false }), e.id);
    res.redirect(`/e/${e.id}`);
  });
  app.post('/e/:id/done', (req, res) => {
    const e = getEpic(req.params.id);
    if (!e) return res.status(404).send('No such epic');
    db.prepare('UPDATE epics SET done = ? WHERE id = ?').run(e.done ? 0 : 1, e.id);
    res.redirect(`/e/${e.id}`);
  });
  app.post('/e/:id/delete', (req, res) => {
    const e = getEpic(req.params.id);
    if (!e) return res.status(404).send('No such epic');
    db.prepare('DELETE FROM epics WHERE id = ?').run(e.id);
    res.redirect(`/s/${spaceById(e.space_id).key}/backlog`);
  });
}
