import express from 'express';
import { buildTree, ftsQuery, tx } from './db.js';
import {
  COOKIE, hashPassword, verifyPassword, createSession, userForToken, destroySession,
  loginAllowed, recordFailedLogin,
} from './auth.js';
import { renderMarkdown, esc, layout, treeHtml } from './render.js';

const parseCookies = (h = '') =>
  Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));

export function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(new URL('../public', import.meta.url).pathname, { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    // CSRF defence: reject cross-origin state changes.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) return res.status(403).send('Cross-origin request blocked');
    }
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.token = token;
    req.user = userForToken(db, token);
    next();
  });

  const userCount = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const page = (res, opts) => res.send(layout(opts));
  const setCookie = (res, token, maxAge) =>
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge, path: '/' });

  // ---- auth ----
  app.get('/setup', (req, res) => {
    if (userCount()) return res.redirect('/login');
    page(res, { title: 'Set up', body: authForm('Create admin account', '/setup', '') });
  });
  app.post('/setup', (req, res) => {
    if (userCount()) return res.redirect('/login');
    const { username = '', password = '' } = req.body;
    if (!username.trim() || password.length < 8)
      return page(res, { title: 'Set up', body: authForm('Create admin account', '/setup', 'Username required; password must be 8+ characters.') });
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.trim(), hashPassword(password));
    const s = createSession(db, Number(lastInsertRowid));
    setCookie(res, s.token, s.maxAge);
    res.redirect('/');
  });
  app.get('/login', (req, res) => {
    if (!userCount()) return res.redirect('/setup');
    page(res, { title: 'Sign in', body: authForm('Sign in', '/login', '') });
  });
  app.post('/login', (req, res) => {
    const { username = '', password = '' } = req.body;
    if (!loginAllowed(req.ip)) return res.status(429).send('Too many attempts. Try again later.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    if (!u || !verifyPassword(password, u.password_hash)) {
      recordFailedLogin(req.ip);
      return res.status(401).send(layout({ title: 'Sign in', body: authForm('Sign in', '/login', 'Wrong username or password.') }));
    }
    const s = createSession(db, u.id);
    setCookie(res, s.token, s.maxAge);
    res.redirect('/');
  });
  app.post('/logout', (req, res) => {
    destroySession(db, req.token);
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/login');
  });

  // Everything below needs a signed-in user.
  app.use((req, res, next) => {
    if (!userCount()) return res.redirect('/setup');
    if (!req.user) return res.redirect('/login');
    next();
  });

  // ---- spaces ----
  app.get('/', (req, res) => {
    const spaces = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM pages WHERE space_id = s.id) n FROM spaces s ORDER BY name').all();
    page(res, {
      title: 'Spaces', user: req.user,
      body: `<h1>Spaces</h1>
        ${spaces.map((s) => `<div class="card"><a href="/s/${esc(s.key)}"><strong>${esc(s.name)}</strong></a> <span class="muted">${esc(s.key)} · ${s.n} pages</span></div>`).join('') || '<p class="muted">No spaces yet. Create your first one below.</p>'}
        <h2>New space</h2>
        <form class="form" method="post" action="/spaces">
          <input name="name" placeholder="Name, e.g. Engineering" required>
          <input name="key" placeholder="Key, e.g. ENG" pattern="[A-Za-z0-9-]{2,12}" required>
          <button>Create space</button>
        </form>`,
    });
  });
  app.post('/spaces', (req, res) => {
    const name = (req.body.name ?? '').trim();
    const key = (req.body.key ?? '').trim().toUpperCase();
    if (!name || !/^[A-Z0-9-]{2,12}$/.test(key)) return res.status(400).send('Invalid name or key');
    try {
      db.prepare('INSERT INTO spaces (key, name) VALUES (?, ?)').run(key, name);
    } catch {
      return res.status(409).send('A space with that key already exists');
    }
    res.redirect(`/s/${key}`);
  });
  app.get('/s/:key', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const tree = spaceTree(space.id);
    page(res, {
      title: space.name, user: req.user, sidebar: sidebar(space, tree),
      body: `<h1>${esc(space.name)}</h1>
        <div class="actions"><a class="btn" href="/s/${esc(space.key)}/new">New page</a></div>
        ${tree.length ? '<p class="muted">Choose a page from the sidebar.</p>' : '<p class="muted">This space is empty. Create the first page.</p>'}`,
    });
  });

  // ---- pages ----
  app.get('/s/:key/new', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const parent = req.query.parent ? getPage(Number(req.query.parent)) : null;
    editorPage(req, res, space, { title: '', body: '', parent_id: parent?.id ?? '' }, `/s/${space.key}/pages`, 'New page');
  });
  app.post('/s/:key/pages', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const title = (req.body.title ?? '').trim();
    if (!title) return res.status(400).send('Title required');
    let parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
    if (parentId && getPage(parentId)?.space_id !== space.id) parentId = null;
    const id = tx(db, () => {
      const r = db.prepare('INSERT INTO pages (space_id, parent_id, title, body, updated_by) VALUES (?, ?, ?, ?, ?)')
        .run(space.id, parentId, title, req.body.body ?? '', req.user.id);
      return Number(r.lastInsertRowid);
    });
    res.redirect(`/p/${id}`);
  });
  app.get('/p/:id(\\d+)', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(p.space_id);
    const crumbs = breadcrumbs(p);
    const author = p.updated_by ? db.prepare('SELECT username FROM users WHERE id = ?').get(p.updated_by)?.username : null;
    page(res, {
      title: p.title, user: req.user, sidebar: sidebar(space, spaceTree(space.id), p.id),
      body: `<p class="muted"><a href="/s/${esc(space.key)}">${esc(space.name)}</a>${crumbs.map((c) => ` / <a href="/p/${c.id}">${esc(c.title)}</a>`).join('')}</p>
        <h1>${esc(p.title)}</h1>
        <div class="actions">
          <a class="btn" href="/p/${p.id}/edit">Edit</a>
          <a href="/s/${esc(space.key)}/new?parent=${p.id}">Add child page</a>
          <a href="/p/${p.id}/history">History</a>
          <a href="/p/${p.id}.md">Markdown</a>
        </div>
        <p class="muted">Updated ${esc(p.updated_at)} UTC${author ? ` by ${esc(author)}` : ''}</p>
        <article class="doc">${renderMarkdown(p.body)}</article>`,
    });
  });
  app.get('/p/:id.md', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    res.type('text/markdown').set('Content-Disposition', `attachment; filename="page-${p.id}.md"`).send(`# ${p.title}\n\n${p.body}\n`);
  });
  app.get('/p/:id/edit', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(p.space_id);
    editorPage(req, res, space, p, `/p/${p.id}`, 'Edit page', p.id);
  });
  app.post('/p/:id(\\d+)', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const title = (req.body.title ?? '').trim();
    if (!title) return res.status(400).send('Title required');
    tx(db, () => {
      db.prepare('INSERT INTO versions (page_id, title, body, edited_by) VALUES (?, ?, ?, ?)').run(p.id, p.title, p.body, p.updated_by);
      db.prepare("UPDATE pages SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?")
        .run(title, req.body.body ?? '', req.user.id, p.id);
    });
    res.redirect(`/p/${p.id}`);
  });
  app.post('/p/:id/delete', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const space = db.prepare('SELECT key FROM spaces WHERE id = ?').get(p.space_id);
    db.prepare('DELETE FROM pages WHERE id = ?').run(p.id); // children cascade
    res.redirect(`/s/${space.key}`);
  });
  app.get('/p/:id/history', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const vs = db.prepare(`SELECT v.id, v.title, v.created_at, u.username FROM versions v LEFT JOIN users u ON u.id = v.edited_by WHERE page_id = ? ORDER BY v.id DESC`).all(p.id);
    page(res, {
      title: `History: ${p.title}`, user: req.user,
      body: `<h1>History: <a href="/p/${p.id}">${esc(p.title)}</a></h1>
        ${vs.map((v) => `<div class="card"><a href="/p/${p.id}/history/${v.id}">${esc(v.title)}</a> <span class="muted">saved ${esc(v.created_at)} UTC${v.username ? ` · ${esc(v.username)}` : ''}</span></div>`).join('') || '<p class="muted">No earlier versions yet.</p>'}`,
    });
  });
  app.get('/p/:id/history/:vid', (req, res) => {
    const p = getPage(Number(req.params.id));
    const v = db.prepare('SELECT * FROM versions WHERE id = ? AND page_id = ?').get(Number(req.params.vid), Number(req.params.id));
    if (!p || !v) return res.status(404).send('No such version');
    page(res, {
      title: v.title, user: req.user,
      body: `<h1>${esc(v.title)}</h1><p class="muted">Version from ${esc(v.created_at)} UTC</p>
        <form method="post" action="/p/${p.id}/restore/${v.id}" class="actions"><button>Restore this version</button><a href="/p/${p.id}/history">Back</a></form>
        <article class="doc">${renderMarkdown(v.body)}</article>`,
    });
  });
  app.post('/p/:id/restore/:vid', (req, res) => {
    const p = getPage(Number(req.params.id));
    const v = db.prepare('SELECT * FROM versions WHERE id = ? AND page_id = ?').get(Number(req.params.vid), Number(req.params.id));
    if (!p || !v) return res.status(404).send('No such version');
    tx(db, () => {
      db.prepare('INSERT INTO versions (page_id, title, body, edited_by) VALUES (?, ?, ?, ?)').run(p.id, p.title, p.body, p.updated_by);
      db.prepare('UPDATE pages SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?').run(v.title, v.body, req.user.id, p.id);
    });
    res.redirect(`/p/${p.id}`);
  });

  app.post('/preview', (req, res) => res.type('html').send(renderMarkdown(req.body.body ?? '')));

  // ---- search ----
  app.get('/search', (req, res) => {
    const q = (req.query.q ?? '').toString();
    const match = ftsQuery(q);
    const rows = match
      ? db.prepare(`SELECT p.id, p.title, s.name space, snippet(pages_fts, 1, '[[', ']]', '…', 18) snip
                    FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid JOIN spaces s ON s.id = p.space_id
                    WHERE pages_fts MATCH ? ORDER BY rank LIMIT 50`).all(match)
      : [];
    page(res, {
      title: 'Search', user: req.user, q,
      body: `<h1>Search</h1>${q ? `<p class="muted">${rows.length} result${rows.length === 1 ? '' : 's'} for “${esc(q)}”</p>` : ''}
        ${rows.map((r) => `<div class="card"><a href="/p/${r.id}"><strong>${esc(r.title)}</strong></a> <span class="muted">${esc(r.space)}</span><br>${esc(r.snip).replaceAll('[[', '<mark>').replaceAll(']]', '</mark>')}</div>`).join('')}`,
    });
  });

  // ---- helpers ----
  function getSpace(key) { return db.prepare('SELECT * FROM spaces WHERE key = ?').get(String(key).toUpperCase()); }
  function getPage(id) { return Number.isInteger(id) ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : undefined; }
  function spaceTree(spaceId) { return buildTree(db.prepare('SELECT id, parent_id, title FROM pages WHERE space_id = ?').all(spaceId)); }
  function sidebar(space, tree, currentId) {
    return `<h3><a href="/s/${esc(space.key)}">${esc(space.name)}</a></h3>${treeHtml(tree, currentId)}<p><a href="/s/${esc(space.key)}/new">+ New page</a></p>`;
  }
  function breadcrumbs(p) {
    const out = [];
    let cur = p;
    while (cur.parent_id) { cur = getPage(cur.parent_id); out.unshift(cur); }
    return out;
  }
  function editorPage(req, res, space, p, action, heading, existingId) {
    page(res, {
      title: heading, user: req.user, sidebar: sidebar(space, spaceTree(space.id), existingId),
      body: `<h1>${esc(heading)}</h1>
        <form method="post" action="${action}">
          <input type="hidden" name="parent_id" value="${esc(p.parent_id ?? '')}">
          <p><input name="title" value="${esc(p.title)}" placeholder="Page title" required style="width:100%;font-size:1.3rem"></p>
          <div class="editor">
            <textarea id="body" name="body" placeholder="Write Markdown here…">${esc(p.body)}</textarea>
            <div class="preview doc" id="preview"></div>
          </div>
          <div class="actions"><button>Save</button><a href="${existingId ? `/p/${existingId}` : `/s/${esc(space.key)}`}">Cancel</a></div>
        </form>
        ${existingId ? `<form method="post" action="/p/${existingId}/delete" data-confirm="Delete this page and all its child pages?"><button class="danger">Delete page</button></form>` : ''}
        <script src="/editor.js"></script>`,
    });
  }

  return app;
}

function authForm(heading, action, error) {
  return `<h1>${esc(heading)}</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form class="form" method="post" action="${action}">
      <input name="username" placeholder="Username" autocomplete="username" required autofocus>
      <input type="password" name="password" placeholder="Password" autocomplete="${action === '/setup' ? 'new-password' : 'current-password'}" required>
      <button>${esc(heading)}</button>
    </form>`;
}
