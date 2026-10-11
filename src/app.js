import express from 'express';
import { buildTree, ftsQuery, tx } from './db.js';
import {
  COOKIE, hashPassword, verifyPassword, createSession, userForToken, destroySession,
  loginAllowed, recordFailedLogin,
} from './auth.js';
import { renderMarkdown, esc, layout, treeHtml, icon, hueClass } from './render.js';

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
    page(res, { bare: true, title: 'Set up', body: authForm('Create admin account', '/setup', '') });
  });
  app.post('/setup', (req, res) => {
    if (userCount()) return res.redirect('/login');
    const { username = '', password = '' } = req.body;
    if (!username.trim() || password.length < 8)
      return page(res, { bare: true, title: 'Set up', body: authForm('Create admin account', '/setup', 'Username required; password must be 8+ characters.') });
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.trim(), hashPassword(password));
    const s = createSession(db, Number(lastInsertRowid));
    setCookie(res, s.token, s.maxAge);
    res.redirect('/');
  });
  app.get('/login', (req, res) => {
    if (!userCount()) return res.redirect('/setup');
    page(res, { bare: true, title: 'Sign in', body: authForm('Sign in', '/login', '') });
  });
  app.post('/login', (req, res) => {
    const { username = '', password = '' } = req.body;
    if (!loginAllowed(req.ip)) return res.status(429).send('Too many attempts. Try again later.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    if (!u || !verifyPassword(password, u.password_hash)) {
      recordFailedLogin(req.ip);
      return res.status(401).send(layout({ bare: true, title: 'Sign in', body: authForm('Sign in', '/login', 'Wrong username or password.') }));
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
    const recent = db.prepare(`SELECT p.id, p.title, p.updated_at, s.name space FROM pages p JOIN spaces s ON s.id = p.space_id ORDER BY p.updated_at DESC, p.id DESC LIMIT 6`).all();
    const total = spaces.reduce((a, s) => a + s.n, 0);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    page(res, {
      title: 'Home', user: req.user,
      body: `<section class="hero">
          <span class="orb a"></span><span class="orb b"></span>
          <h1>${greet}, ${esc(req.user.username)}.</h1>
          <p>Your team's knowledge, written down once and found in seconds.</p>
          <div class="row"><button class="btn" type="button" id="cmdk-open-hero">${icon('search')}Search everything</button></div>
          <div class="stats"><div><b>${spaces.length}</b><span>Spaces</span></div><div><b>${total}</b><span>Pages</span></div></div>
        </section>
        <div class="section-head"><h2>Spaces</h2></div>
        <div class="grid">
          ${spaces.map((s, i) => `<a class="space-card ${hueClass(s.key)}" href="/s/${esc(s.key)}" data-i="${i}">
            <div class="tile">${esc(s.key.slice(0, 2))}</div><span class="arrow">${icon('arrow')}</span>
            <h3>${esc(s.name)}</h3><p class="muted">${s.n} ${s.n === 1 ? 'page' : 'pages'}</p></a>`).join('')}
          <form class="space-card new-space" method="post" action="/spaces" data-i="${spaces.length}">
            <strong>New space</strong>
            <input name="name" placeholder="Name, e.g. Engineering" aria-label="Space name" required>
            <input name="key" placeholder="Key, e.g. ENG" aria-label="Space key" pattern="[A-Za-z0-9\\-]{2,12}" required>
            <button>${icon('plus')}Create space</button>
          </form>
        </div>
        ${recent.length ? `<div class="section-head"><h2>Recently updated</h2></div>
        <div class="row-list">${recent.map((r, i) => `<a class="row-item" href="/p/${r.id}" data-i="${i}">${icon('file')}<span class="t">${esc(r.title)}</span><span class="s">${esc(r.space)}<br>${esc(r.updated_at.slice(0, 16))}</span></a>`).join('')}</div>` : ''}`,
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
      title: space.name, user: req.user, sidebar: sidebar(space, tree), toc: false,
      body: `<div class="article-head"><span class="eyebrow">Space · ${esc(space.key)}</span><h1 class="page-title">${esc(space.name)}</h1>
        <div class="actions"><a class="btn" href="/s/${esc(space.key)}/new">${icon('plus')}New page</a></div></div>
        ${tree.length ? `<div class="row-list">${tree.map((n, i) => `<a class="row-item" href="/p/${n.id}" data-i="${i}">${icon('file')}<span class="t">${esc(n.title)}</span><span class="s">${n.children.length ? n.children.length + ' sub-pages' : ''}</span></a>`).join('')}</div>`
        : `<div class="empty">${emptyArt()}<h3>Nothing here yet</h3><p class="muted">Write the first page and it will appear in the sidebar.</p><a class="btn" href="/s/${esc(space.key)}/new">${icon('plus')}Create the first page</a></div>`}`,
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
      body: `<header class="article-head">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="/s/${esc(space.key)}">${esc(space.name)}</a>${crumbs.map((c) => `${icon('chevron')}<a href="/p/${c.id}">${esc(c.title)}</a>`).join('')}</nav>
          <h1 class="page-title">${esc(p.title)}</h1>
          <div class="meta"><span class="chip">${icon('clock')}Updated ${esc(p.updated_at.slice(0, 16))} UTC</span>${author ? `<span class="chip">by ${esc(author)}</span>` : ''}</div>
          <div class="actions">
            <a class="btn" href="/p/${p.id}/edit">${icon('edit')}Edit</a>
            <a class="btn ghost" href="/s/${esc(space.key)}/new?parent=${p.id}">${icon('plus')}Child page</a>
            <a class="btn ghost" href="/p/${p.id}/history">${icon('clock')}History</a>
            <a class="btn ghost" href="/p/${p.id}.md">${icon('download')}Markdown</a>
          </div>
        </header>
        <article class="doc" id="doc">${renderMarkdown(p.body)}</article>`,
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
      body: `<span class="eyebrow">Version history</span><h1 class="page-title"><a href="/p/${p.id}">${esc(p.title)}</a></h1>
        <div class="row-list">${vs.map((v, i) => `<a class="row-item" href="/p/${p.id}/history/${v.id}" data-i="${i}">${icon('clock')}<span class="t">${esc(v.title)}</span><span class="s">${esc(v.created_at.slice(0, 16))} UTC${v.username ? `<br>${esc(v.username)}` : ''}</span></a>`).join('') || `<div class="empty">${emptyArt()}<h3>No earlier versions</h3><p class="muted">Versions are saved each time you edit.</p></div>`}</div>`,
    });
  });
  app.get('/p/:id/history/:vid', (req, res) => {
    const p = getPage(Number(req.params.id));
    const v = db.prepare('SELECT * FROM versions WHERE id = ? AND page_id = ?').get(Number(req.params.vid), Number(req.params.id));
    if (!p || !v) return res.status(404).send('No such version');
    page(res, {
      title: v.title, user: req.user,
      body: `<span class="eyebrow">Version from ${esc(v.created_at)} UTC</span><h1 class="page-title">${esc(v.title)}</h1>
        <form method="post" action="/p/${p.id}/restore/${v.id}" class="actions"><button>Restore this version</button><a class="btn ghost" href="/p/${p.id}/history">Back</a></form>
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
      title: 'Search', user: req.user,
      body: `<span class="eyebrow">Search</span><h1 class="page-title">${q ? `“${esc(q)}”` : 'Search'}</h1>
        ${q ? `<p class="muted">${rows.length} result${rows.length === 1 ? '' : 's'}</p>` : ''}
        <div class="row-list">${rows.map((r, i) => `<a class="row-item" href="/p/${r.id}" data-i="${i}">${icon('file')}<span><span class="t">${esc(r.title)}</span><br><span class="muted">${esc(r.snip).replaceAll('[[', '<mark>').replaceAll(']]', '</mark>')}</span></span><span class="s">${esc(r.space)}</span></a>`).join('')}</div>`,
    });
  });
  app.get('/search.json', (req, res) => {
    const match = ftsQuery((req.query.q ?? '').toString());
    res.json(match ? db.prepare(`SELECT p.id, p.title, s.name space, snippet(pages_fts, 1, '', '', '…', 12) snip
      FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid JOIN spaces s ON s.id = p.space_id
      WHERE pages_fts MATCH ? ORDER BY rank LIMIT 8`).all(match) : []);
  });

  // ---- helpers ----
  function getSpace(key) { return db.prepare('SELECT * FROM spaces WHERE key = ?').get(String(key).toUpperCase()); }
  function getPage(id) { return Number.isInteger(id) ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : undefined; }
  function spaceTree(spaceId) { return buildTree(db.prepare('SELECT id, parent_id, title FROM pages WHERE space_id = ?').all(spaceId)); }
  function sidebar(space, tree, currentId) {
    return `<a class="side-head" href="/s/${esc(space.key)}"><span class="tile-sm logo ${hueClass(space.key)}">${esc(space.key.slice(0, 1))}</span>${esc(space.name)}</a>${treeHtml(tree, currentId)}<a class="add" href="/s/${esc(space.key)}/new">${icon('plus')}New page</a>`;
  }
  function breadcrumbs(p) {
    const out = [];
    let cur = p;
    while (cur.parent_id) { cur = getPage(cur.parent_id); out.unshift(cur); }
    return out;
  }
  function editorPage(req, res, space, p, action, heading, existingId) {
    const tb = (name, label, sep) => `${sep ? '<span class="sep"></span>' : ''}<button type="button" class="ghost" data-md="${name}" title="${label}" aria-label="${label}">${icon(name)}</button>`;
    page(res, {
      title: heading, user: req.user, sidebar: sidebar(space, spaceTree(space.id), existingId), toc: false,
      body: `<span class="eyebrow">${esc(heading)}</span>
        <form method="post" action="${action}" id="edit-form">
          <input type="hidden" name="parent_id" value="${esc(p.parent_id ?? '')}">
          <input class="title-input" name="title" value="${esc(p.title)}" placeholder="Page title" aria-label="Page title" required autofocus>
          <div class="toolbar" role="toolbar" aria-label="Formatting">
            ${tb('bold', 'Bold (Ctrl+B)')}${tb('italic', 'Italic (Ctrl+I)')}${tb('heading', 'Heading', true)}${tb('list', 'List')}${tb('quote', 'Quote')}${tb('code', 'Code')}${tb('link', 'Link', true)}
            <span class="status"><span class="dot" id="dot"></span><span id="words">0 words</span></span>
          </div>
          <div class="editor">
            <textarea id="body" name="body" placeholder="Write Markdown here. Press Ctrl+S to save." aria-label="Page body">${esc(p.body)}</textarea>
            <div class="preview doc" id="preview"></div>
          </div>
          <div class="actions"><button>${icon('save')}Save page</button><a class="btn ghost" href="${existingId ? `/p/${existingId}` : `/s/${esc(space.key)}`}">Cancel</a></div>
        </form>
        ${existingId ? `<form method="post" action="/p/${existingId}/delete" data-confirm="Delete this page and all its child pages?"><button class="danger">${icon('trash')}Delete page</button></form>` : ''}
        <script src="/editor.js"></script>`,
    });
  }

  return app;
}

function emptyArt() {
  return `<svg class="art" viewBox="0 0 140 110" aria-hidden="true"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs>
    <rect x="30" y="14" width="80" height="84" rx="10" fill="url(#g)" opacity=".18"/><rect x="38" y="8" width="80" height="84" rx="10" fill="url(#g)"/>
    <rect x="52" y="28" width="40" height="6" rx="3" fill="#fff" opacity=".9"/><rect x="52" y="44" width="52" height="5" rx="2.5" fill="#fff" opacity=".6"/><rect x="52" y="56" width="46" height="5" rx="2.5" fill="#fff" opacity=".6"/><rect x="52" y="68" width="30" height="5" rx="2.5" fill="#fff" opacity=".6"/></svg>`;
}

function authForm(heading, action, error) {
  const setup = action === '/setup';
  return `<div class="auth">
    <section class="auth-art"><span class="orb a"></span><span class="orb b"></span><h2>Everything your team knows, in one place.</h2><p>Spaces, pages and search that belong to you. Self-hosted, private, no subscription.</p></section>
    <section class="auth-form"><form class="form" method="post" action="${action}">
      <h1>${esc(heading)}</h1><p class="muted">${setup ? 'This first account becomes the administrator.' : 'Welcome back.'}</p>
      ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
      <input name="username" placeholder="Username" aria-label="Username" autocomplete="username" required autofocus>
      <input type="password" name="password" placeholder="Password" aria-label="Password" autocomplete="${setup ? 'new-password' : 'current-password'}" required>
      <button>${esc(heading)}</button>
    </form></section></div>`;
}
