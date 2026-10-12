// Recycle bin for pages and issues. Deleting takes a snapshot of the item and everything that hangs off it
// (child pages, versions, comments, labels, links, history and attachment records) and removes the live rows;
// restoring puts them back. Uploaded files stay on disk until an entry is deleted for good or expires.
import { tx } from './db.js';
import { logChange } from './reports.js';
import { esc, icon } from './render.js';

export const KEEP_DAYS = 30;
const marks = (n) => Array.from({ length: n }, () => '?').join(',');
const plain = (rows) => rows.map((r) => ({ ...r }));

export function createTrash({ db, files }) {
  const all = (sql, ...a) => plain(db.prepare(sql).all(...a));
  const exists = (table, id) => id != null && !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
  const ok = (table, id) => (exists(table, id) ? id : null);
  // Row ids can be reused after a delete, so a parent only counts if it is still the same row (same id, title and creation time).
  const ref = (table, id) => (id == null ? null : db.prepare(`SELECT id, title, created_at FROM ${table} WHERE id = ?`).get(id) ?? null);
  const same = (table, r) => (r && db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND title = ? AND created_at = ?`).get(r.id, r.title, r.created_at) ? r.id : null);
  const insert = (table, row, skip = []) => {
    const keys = Object.keys(row).filter((k) => !skip.includes(k));
    return Number(db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${marks(keys.length)})`).run(...keys.map((k) => row[k])).lastInsertRowid);
  };
  const save = (kind, spaceId, title, label, data, user) => Number(db.prepare('INSERT INTO trash (kind, space_id, title, label, data, deleted_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(kind, spaceId, title, label, JSON.stringify(data), user?.id ?? null).lastInsertRowid);

  const t = {
    trashPage(p, user) {
      return tx(db, () => {
        const ids = all('WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT p.id FROM pages p JOIN t ON p.parent_id = t.id) SELECT id FROM t', p.id).map((r) => r.id);
        const inIds = `IN (${marks(ids.length)})`;
        const data = {
          root: p.id,
          parent: ref('pages', p.parent_id) && { ...ref('pages', p.parent_id) },
          pages: all(`SELECT * FROM pages WHERE id ${inIds}`, ...ids),
          versions: all(`SELECT * FROM versions WHERE page_id ${inIds}`, ...ids),
          labels: all(`SELECT * FROM page_labels WHERE page_id ${inIds}`, ...ids),
          comments: all(`SELECT * FROM page_comments WHERE page_id ${inIds} ORDER BY id`, ...ids),
          attachments: all(`SELECT * FROM attachments WHERE page_id ${inIds}`, ...ids),
        };
        const id = save('page', p.space_id, p.title, ids.length > 1 ? `and ${ids.length - 1} child ${ids.length === 2 ? 'page' : 'pages'}` : '', data, user);
        db.prepare(`DELETE FROM attachments WHERE page_id ${inIds}`).run(...ids); // rows only: the files stay for a restore
        db.prepare('DELETE FROM pages WHERE id = ?').run(p.id); // children cascade
        return id;
      });
    },
    trashIssue(i, space, user) {
      return tx(db, () => {
        const data = {
          issue: { ...i },
          parent: ref('issues', i.parent_id) && { ...ref('issues', i.parent_id) },
          comments: all('SELECT * FROM comments WHERE issue_id = ? ORDER BY id', i.id),
          labels: all('SELECT * FROM issue_labels WHERE issue_id = ?', i.id),
          links: all('SELECT * FROM issue_links WHERE from_id = ? OR to_id = ?', i.id, i.id),
          events: all('SELECT * FROM issue_events WHERE issue_id = ? ORDER BY id', i.id),
          attachments: all('SELECT * FROM attachments WHERE issue_id = ?', i.id),
        };
        const id = save('issue', i.space_id, i.title, `${space.key}-${i.num}`, data, user);
        logChange(db, i.id, i, null);
        db.prepare('DELETE FROM attachments WHERE issue_id = ?').run(i.id);
        db.prepare('DELETE FROM issues WHERE id = ?').run(i.id);
        return id;
      });
    },

    // Put an entry back. Returns { url, note } or { error }.
    restore(entry) {
      if (!exists('spaces', entry.space_id)) return { error: 'The space this came from no longer exists.' };
      const data = JSON.parse(entry.data);
      const out = tx(db, () => (entry.kind === 'page' ? restorePage(data) : restoreIssue(data, entry)));
      db.prepare('DELETE FROM trash WHERE id = ?').run(entry.id);
      return out;
    },
    // Remove an entry for good, including the files that were kept for it.
    forget(entry) {
      const data = JSON.parse(entry.data);
      files.discard(data.attachments ?? []);
      db.prepare('DELETE FROM trash WHERE id = ?').run(entry.id);
    },
    purgeExpired(days = KEEP_DAYS) {
      for (const e of all("SELECT * FROM trash WHERE deleted_at < datetime('now', ?)", `-${days} days`)) t.forget(e);
    },
    count: (spaceId) => db.prepare('SELECT COUNT(*) n FROM trash WHERE space_id = ?').get(spaceId).n,
  };

  function reattach(rows, owner) {
    for (const a of rows) {
      const row = { ...a, ...owner, uploaded_by: ok('users', a.uploaded_by) };
      insert('attachments', row, exists('attachments', a.id) ? ['id'] : []);
    }
  }

  function restorePage(data) {
    const inTree = new Set(data.pages.map((p) => p.id));
    const map = new Map();
    let pending = [...data.pages];
    while (pending.length) { // parents before children
      const next = pending.filter((p) => inTree.has(p.parent_id) && !map.has(p.parent_id));
      for (const p of pending.filter((q) => !next.includes(q))) {
        const parent = inTree.has(p.parent_id) ? map.get(p.parent_id) : same('pages', data.parent); // the original parent may be gone: top level
        map.set(p.id, insert('pages', { ...p, parent_id: parent, updated_by: ok('users', p.updated_by) }, exists('pages', p.id) ? ['id'] : []));
      }
      pending = next;
    }
    for (const v of data.versions) insert('versions', { ...v, page_id: map.get(v.page_id), edited_by: ok('users', v.edited_by) }, ['id']);
    for (const l of data.labels) insert('page_labels', { ...l, page_id: map.get(l.page_id) });
    const cmap = new Map();
    for (const c of data.comments) cmap.set(c.id, insert('page_comments', { ...c, page_id: map.get(c.page_id), parent_id: cmap.get(c.parent_id) ?? null, author_id: ok('users', c.author_id) }, ['id']));
    for (const a of data.attachments) reattach([a], { page_id: map.get(a.page_id) });
    const root = map.get(data.root);
    return { url: `/p/${root}`, note: '' };
  }

  function restoreIssue(data, entry) {
    const i = data.issue;
    let num = i.num;
    let note = '';
    if (db.prepare('SELECT 1 FROM issues WHERE space_id = ? AND num = ?').get(i.space_id, num)) {
      num = db.prepare('SELECT COALESCE(MAX(num), 0) + 1 n FROM issues WHERE space_id = ?').get(i.space_id).n;
      note = `${entry.label} was taken by a newer issue, so it came back as ${entry.label.replace(/-\d+$/, '')}-${num}.`;
    }
    const sprint = db.prepare("SELECT id FROM sprints WHERE id = ? AND state != 'closed'").get(i.sprint_id)?.id ?? null;
    const row = {
      ...i, num, sprint_id: sprint, epic_id: ok('epics', i.epic_id), parent_id: same('issues', data.parent),
      assignee_id: ok('users', i.assignee_id), reporter_id: ok('users', i.reporter_id),
    };
    const id = insert('issues', row, exists('issues', i.id) ? ['id'] : []);
    for (const c of data.comments) insert('comments', { ...c, issue_id: id, author_id: ok('users', c.author_id) }, ['id']);
    for (const l of data.labels) insert('issue_labels', { ...l, issue_id: id });
    for (const l of data.links) {
      const from = l.from_id === i.id ? id : ok('issues', l.from_id), to = l.to_id === i.id ? id : ok('issues', l.to_id);
      if (from && to) insert('issue_links', { ...l, from_id: from, to_id: to }, ['id']);
    }
    for (const e of data.events) insert('issue_events', { ...e, issue_id: id, user_id: ok('users', e.user_id) }, ['id']);
    reattach(data.attachments, { issue_id: id });
    logChange(db, id, null, { ...row, id });
    return { url: `/i/${id}`, note };
  }
  return t;
}

const when = (at) => at.slice(0, 16);
export function mountTrash(app, { db, page, getSpace, trash }) {
  app.get('/s/:key/trash', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const rows = db.prepare(`SELECT t.*, u.username FROM trash t LEFT JOIN users u ON u.id = t.deleted_by WHERE t.space_id = ? ORDER BY t.id DESC`).all(space.id);
    const write = req.user.role !== 'viewer', admin = req.user.role === 'admin';
    page(res, {
      title: 'Trash', user: req.user, space, section: 'trash', toc: false,
      body: `<div class="page-head"><div><h1 class="page-title">Trash</h1><p class="muted">Deleted pages and issues from ${esc(space.name)} stay here for ${KEEP_DAYS} days, then are removed for good.</p></div>
          ${admin && rows.length ? `<form method="post" action="/s/${esc(space.key)}/trash/empty" data-confirm="Delete everything in the trash for good?"><button class="danger">${icon('trash')}Empty trash</button></form>` : ''}</div>
        ${req.query.err ? `<p class="err" role="alert">${esc(req.query.err)}</p>` : ''}${req.query.note ? `<p class="ok-note" role="status">${esc(req.query.note)}</p>` : ''}
        ${rows.length ? `<div class="list">${rows.map((r) => `<div class="row-item trash-row">${icon(r.kind === 'page' ? 'file' : 'task')}<span class="t">${r.kind === 'issue' ? `<b>${esc(r.label)}</b> ` : ''}${esc(r.title)}${r.kind === 'page' && r.label ? ` <span class="muted">${esc(r.label)}</span>` : ''}</span>
          <span class="s">${esc(r.username ?? 'unknown')} · ${esc(when(r.deleted_at))} UTC</span>
          ${write ? `<form method="post" action="/trash/${r.id}/restore"><button class="ghost sm">Restore</button></form>` : ''}
          ${write && (admin || r.deleted_by === req.user.id) ? `<form method="post" action="/trash/${r.id}/delete" data-confirm="Delete this for good? It cannot be restored."><button class="danger sm" aria-label="Delete ${esc(r.title)} for good">${icon('trash')}</button></form>` : ''}</div>`).join('')}</div>`
        : `<div class="empty">${icon('trash')}<h3>The trash is empty</h3><p>Anything you delete from this space can be brought back from here.</p></div>`}`,
    });
  });
  const entry = (req) => db.prepare('SELECT * FROM trash WHERE id = ?').get(Number(req.params.id));
  app.post('/trash/:id(\\d+)/restore', (req, res) => {
    const e = entry(req);
    if (!e) return res.status(404).send('Nothing to restore');
    const r = trash.restore(e);
    const key = db.prepare('SELECT key FROM spaces WHERE id = ?').get(e.space_id)?.key;
    if (r.error) return res.redirect(`/s/${key}/trash?err=${encodeURIComponent(r.error)}`);
    res.redirect(r.note ? `${r.url}?note=${encodeURIComponent(r.note)}` : r.url);
  });
  app.post('/trash/:id(\\d+)/delete', (req, res) => {
    const e = entry(req);
    if (!e) return res.status(404).send('Nothing to delete');
    if (req.user.role !== 'admin' && e.deleted_by !== req.user.id) return res.status(403).send('Only the person who deleted it, or an administrator, can delete it for good');
    const key = db.prepare('SELECT key FROM spaces WHERE id = ?').get(e.space_id).key;
    trash.forget(e);
    res.redirect(`/s/${key}/trash`);
  });
  app.post('/s/:key/trash/empty', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    if (req.user.role !== 'admin') return res.status(403).send('Administrators only');
    for (const e of db.prepare('SELECT * FROM trash WHERE space_id = ?').all(space.id)) trash.forget(e);
    res.redirect(`/s/${space.key}/trash`);
  });
}
