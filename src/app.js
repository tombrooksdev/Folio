import express from 'express';
import { readFileSync } from 'node:fs';
import { buildTree, ftsQuery, tx } from './db.js';
import {
  COOKIE, hashPassword, verifyPassword, createSession, userForToken, destroySession,
  loginAllowed, recordFailedLogin,
} from './auth.js';
import { mountBoard } from './board.js';
import { createFiles } from './files.js';
import { createGithub, mountGithub } from './github.js';
import { mountComments, commentsPanel, commentCount } from './comments.js';
import { TEMPLATES, findTemplate, fillTemplate } from './templates.js';
import { diffLines, diffHtml } from './diff.js';
import { parseLabels } from './issues.js';
import { createNotifier, mountNotifications, unreadCount, watchButton } from './notify.js';
import { mountLearn, checklistCard, hint, getFlag } from './learn.js';
import { renderMarkdown, esc, layout, treeHtml, icon, hueClass, setKeyResolver, setMentionResolver } from './render.js';

const { version: VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const CHANGELOG = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const parseCookies = (h = '') =>
  Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));

export function createApp(db, {
  secureCookies = false,
  uploadDir = new URL('../data/uploads', import.meta.url).pathname,
  maxUploadMb = 25,
  github = createGithub(),
  webhookUrl = '',
  publicUrl = '',
  fetchFn = globalThis.fetch,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  const keyStmt = db.prepare('SELECT i.id FROM issues i JOIN spaces s ON s.id = i.space_id WHERE s.key = ? AND i.num = ?');
  setKeyResolver((key, num) => keyStmt.get(key, num)?.id ?? null);
  const userStmt = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE');
  setMentionResolver((name) => !!userStmt.get(name));
  app.use(express.static(new URL('../public', import.meta.url).pathname, { setHeaders: (res, f) => res.set('Cache-Control', f.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache') }));
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
  const page = (res, opts) => {
    if (opts.user && !opts.bare) {
      if (opts.sidebar === undefined) opts.sidebar = sidebar(opts.space ?? null, opts.current, opts.section);
      opts.spaces = db.prepare('SELECT key, name FROM spaces ORDER BY name').all();
      opts.people = db.prepare('SELECT id, username FROM users ORDER BY username').all();
      opts.spaceKey = opts.space?.key ?? '';
      opts.unread = unreadCount(db, opts.user.id);
      opts.tour = !getFlag(db, opts.user.id, 'tour');
    }
    res.send(layout(opts));
  };
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

  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok'); });

  // Everything below needs a signed-in user.
  app.use((req, res, next) => {
    if (!userCount()) return res.redirect('/setup');
    if (!req.user) return res.redirect('/login');
    next();
  });

  const files = createFiles({ db, uploadDir, maxBytes: maxUploadMb * 1048576 });
  const notifier = createNotifier({ db, webhookUrl, publicUrl, fetchFn });
  const ctx = { db, page: (res, o) => page(res, o), getSpace: (k) => getSpace(k), files, github, notifier };
  files.mount(app, ctx);
  mountBoard(app, ctx);
  mountComments(app, ctx);
  mountGithub(app, ctx);
  mountNotifications(app, ctx);
  mountLearn(app, ctx);

  // ---- spaces ----
  app.get('/', (req, res) => {
    const spaces = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM pages WHERE space_id = s.id) n FROM spaces s ORDER BY name').all();
    const recent = db.prepare(`SELECT p.id, p.title, p.updated_at, s.name space FROM pages p JOIN spaces s ON s.id = p.space_id ORDER BY p.updated_at DESC, p.id DESC LIMIT 6`).all();
    const starred = db.prepare('SELECT p.id, p.title, s.name space FROM page_stars st JOIN pages p ON p.id = st.page_id JOIN spaces s ON s.id = p.space_id WHERE st.user_id = ? ORDER BY p.title LIMIT 12').all(req.user.id);
    const viewed = db.prepare('SELECT p.id, p.title, s.name space, v.at FROM page_views v JOIN pages p ON p.id = v.page_id JOIN spaces s ON s.id = p.space_id WHERE v.user_id = ? ORDER BY v.at DESC LIMIT 6').all(req.user.id);
    page(res, {
      title: 'Home', user: req.user,
      body: `${checklistCard(db, req.user)}<div class="page-head"><div><span class="eyebrow">Workspace</span><h1 class="page-title">Spaces</h1></div>
          <a class="btn" href="#new-space">${icon('plus')}New space</a></div>
        <div class="list">${spaces.map((s) => `<a class="row-item" href="/s/${esc(s.key)}"><span class="key">${esc(s.key.slice(0, 3))}</span><span class="t">${esc(s.name)}</span><span class="s">${s.n} ${s.n === 1 ? 'page' : 'pages'}</span></a>`).join('')}</div>
        ${spaces.length ? '' : `<div class="empty">${emptyArt()}<h3>No spaces yet</h3><p>A space holds the pages for one team or project.</p></div>`}
        ${starred.length ? `<div class="section-head"><h2>Starred</h2></div><div class="list">${starred.map((r) => `<a class="row-item" href="/p/${r.id}">${icon('star')}<span class="t">${esc(r.title)}</span><span class="s">${esc(r.space)}</span></a>`).join('')}</div>` : ''}
        ${viewed.length ? `<div class="section-head"><h2>Recently viewed</h2></div><div class="list">${viewed.map((r) => `<a class="row-item" href="/p/${r.id}">${icon('clock')}<span class="t">${esc(r.title)}</span><span class="s">${esc(r.space)} · ${esc(r.at.slice(0, 16))}</span></a>`).join('')}</div>` : ''}
        ${recent.length ? `<div class="section-head"><h2>Recently updated</h2></div>
        <div class="list">${recent.map((r) => `<a class="row-item" href="/p/${r.id}">${icon('file')}<span class="t">${esc(r.title)}</span><span class="s">${esc(r.space)} · ${esc(r.updated_at.slice(0, 16))}</span></a>`).join('')}</div>` : ''}
        <div class="section-head" id="new-space"><h2>Create a space</h2></div>
        <form class="new-space" method="post" action="/spaces">
          <input name="name" placeholder="Name, e.g. Engineering" aria-label="Space name" required>
          <input name="key" placeholder="Key, e.g. ENG" aria-label="Space key" pattern="[A-Za-z0-9\\-]{2,12}" required>
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
      title: space.name, user: req.user, space, toc: false,
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
    const tpl = findTemplate(String(req.query.template ?? ''));
    editorPage(req, res, space, { title: fillTemplate(tpl?.title ?? '', req.user.username), body: fillTemplate(tpl?.body ?? '', req.user.username), parent_id: parent?.id ?? '', label_list: '' }, `/s/${space.key}/pages`, 'New page');
  });
  // "Create page" gallery, like Confluence's template picker
  app.get('/s/:key/create', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const parent = req.query.parent && getPage(Number(req.query.parent))?.space_id === space.id ? `&parent=${Number(req.query.parent)}` : '';
    page(res, {
      title: 'Create page', user: req.user, space, section: 'create', toc: false,
      body: `<nav class="crumbs"><a href="/">Spaces</a>${icon('chevron')}<a href="/s/${esc(space.key)}">${esc(space.name)}</a>${icon('chevron')}Create</nav>
        <h1 class="page-title">Create a page</h1><p class="muted">Pick a template or start blank. You can change everything afterwards.</p>
        <div class="template-grid">${TEMPLATES.map((t) => `<a class="template-card" href="/s/${esc(space.key)}/new?template=${t.id}${parent}">${icon(t.id === 'blank' ? 'file' : 'edit')}<b>${esc(t.name)}</b><span class="muted">${esc(t.desc)}</span></a>`).join('')}</div>`,
    });
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
      files.adopt(space.id, { page_id: Number(r.lastInsertRowid) }, req.body.body);
      setPageLabels(Number(r.lastInsertRowid), req.body.labels);
      return Number(r.lastInsertRowid);
    });
    notifier.pageCreated(getPage(id), space, req.user);
    res.redirect(`/p/${id}`);
  });
  app.get('/p/:id(\\d+)', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(p.space_id);
    const crumbs = breadcrumbs(p);
    db.prepare("INSERT INTO page_views (user_id, page_id) VALUES (?, ?) ON CONFLICT (user_id, page_id) DO UPDATE SET at = CURRENT_TIMESTAMP").run(req.user.id, p.id);
    const starred = !!db.prepare('SELECT 1 FROM page_stars WHERE page_id = ? AND user_id = ?').get(p.id, req.user.id);
    const labels = db.prepare('SELECT label FROM page_labels WHERE page_id = ? ORDER BY label').all(p.id).map((l) => l.label);
    const author = p.updated_by ? db.prepare('SELECT username FROM users WHERE id = ?').get(p.updated_by)?.username : null;
    page(res, {
      title: p.title, user: req.user, space, current: p.id, toc: true, editUrl: `/p/${p.id}/edit`,
      body: `<header class="article-head">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="/s/${esc(space.key)}">${esc(space.name)}</a>${crumbs.map((c) => `${icon('chevron')}<a href="/p/${c.id}">${esc(c.title)}</a>`).join('')}</nav>
          <h1 class="page-title">${esc(p.title)}</h1>
          ${labels.length ? `<div class="page-labels">${labels.map((l) => `<a class="label-chip" href="/s/${esc(space.key)}/labels/${encodeURIComponent(l)}">${esc(l)}</a>`).join('')}</div>` : ''}
          <div class="meta"><span class="chip">${icon('clock')}Updated ${esc(p.updated_at.slice(0, 16))} UTC</span>${author ? `<span class="chip">by ${esc(author)}</span>` : ''}<a class="chip" href="#comments">${commentCount(db, p.id)} comment${commentCount(db, p.id) === 1 ? '' : 's'}</a></div>
          <div class="actions">
            <a class="btn" href="/p/${p.id}/edit">${icon('edit')}Edit</a>
            ${watchButton(notifier, req.user, 'page', p.id)}
            <form method="post" action="/p/${p.id}/star"><button class="ghost star${starred ? ' on' : ''}" aria-pressed="${starred}" title="${starred ? 'Remove from starred' : 'Add to starred'}">${icon('star')}${starred ? 'Starred' : 'Star'}</button></form>
            <a class="btn ghost" href="/s/${esc(space.key)}/create?parent=${p.id}">${icon('plus')}Child page</a>
            <a class="btn ghost" href="/p/${p.id}/history">${icon('clock')}History</a>
            <a class="btn ghost" href="/p/${p.id}.md">${icon('download')}Markdown</a>
            <button type="button" class="ghost width-toggle" id="width-toggle" aria-pressed="false">${icon('sidebar')}Readable width</button>
          </div>
        </header>
        <article class="doc" id="doc">${renderMarkdown(p.body)}</article>
        ${files.panel({ page_id: p.id }, space)}
        ${commentsPanel(db, p, req.user)}`,
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
    editorPage(req, res, space, { ...p, label_list: db.prepare('SELECT label FROM page_labels WHERE page_id = ? ORDER BY label').all(p.id).map((l) => l.label).join(', ') }, `/p/${p.id}`, 'Edit page', p.id);
  });
  app.post('/p/:id(\\d+)', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const title = (req.body.title ?? '').trim();
    if (!title) return res.status(400).send('Title required');
    // moving: the new parent must be in the same space and not the page itself or one of its descendants
    let parentId = p.parent_id;
    if ('parent_id' in req.body) {
      const want = req.body.parent_id ? Number(req.body.parent_id) : null;
      const below = new Set(descendantIds(p.id));
      if (want === null || (getPage(want)?.space_id === p.space_id && !below.has(want))) parentId = want;
    }
    tx(db, () => {
      db.prepare('INSERT INTO versions (page_id, title, body, edited_by) VALUES (?, ?, ?, ?)').run(p.id, p.title, p.body, p.updated_by);
      db.prepare("UPDATE pages SET title = ?, body = ?, parent_id = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?")
        .run(title, req.body.body ?? '', parentId, req.user.id, p.id);
      files.adopt(p.space_id, { page_id: p.id }, req.body.body);
      if ('labels' in req.body) setPageLabels(p.id, req.body.labels);
    });
    notifier.pageUpdated(getPage(p.id), db.prepare('SELECT * FROM spaces WHERE id = ?').get(p.space_id), req.user, p.body);
    res.redirect(`/p/${p.id}`);
  });
  app.post('/p/:id/delete', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const space = db.prepare('SELECT key FROM spaces WHERE id = ?').get(p.space_id);
    files.purge({ page_id: p.id });
    db.prepare('DELETE FROM pages WHERE id = ?').run(p.id); // children cascade
    res.redirect(`/s/${space.key}`);
  });
  app.post('/p/:id/star', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const had = db.prepare('DELETE FROM page_stars WHERE page_id = ? AND user_id = ?').run(p.id, req.user.id).changes;
    if (!had) db.prepare('INSERT INTO page_stars (page_id, user_id) VALUES (?, ?)').run(p.id, req.user.id);
    res.redirect(`/p/${p.id}`);
  });
  app.get('/s/:key/labels/:label', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const label = String(req.params.label).toLowerCase();
    const pages = db.prepare('SELECT p.id, p.title, p.updated_at FROM pages p JOIN page_labels l ON l.page_id = p.id WHERE p.space_id = ? AND l.label = ? ORDER BY p.title').all(space.id, label);
    page(res, {
      title: `Label: ${label}`, user: req.user, space, toc: false,
      body: `<span class="eyebrow">Label</span><h1 class="page-title"><span class="label-chip big">${esc(label)}</span></h1>
        <div class="list">${pages.map((p) => `<a class="row-item" href="/p/${p.id}">${icon('file')}<span class="t">${esc(p.title)}</span><span class="s">${esc(p.updated_at.slice(0, 16))}</span></a>`).join('') || '<p class="muted pad">No pages have this label.</p>'}</div>`,
    });
  });
  // Compare a saved version with the current page (or with another version): /p/1/diff?from=12&to=current
  app.get('/p/:id/diff', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const ver = (id) => db.prepare('SELECT * FROM versions WHERE id = ? AND page_id = ?').get(Number(id), p.id);
    const from = ver(req.query.from);
    const to = req.query.to && req.query.to !== 'current' ? ver(req.query.to) : { title: p.title, body: p.body, created_at: p.updated_at, current: true };
    if (!from || !to) return res.status(404).send('No such version');
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(p.space_id);
    page(res, {
      title: `Compare: ${p.title}`, user: req.user, space, current: p.id, toc: false,
      body: `<span class="eyebrow">Compare versions</span><h1 class="page-title"><a href="/p/${p.id}">${esc(p.title)}</a></h1>
        <p class="muted">${esc(from.created_at.slice(0, 16))} UTC  to  ${to.current ? 'current version' : `${esc(to.created_at.slice(0, 16))} UTC`}</p>
        ${from.title !== to.title ? `<p class="diff-title"><del>${esc(from.title)}</del> <ins>${esc(to.title)}</ins></p>` : ''}
        ${diffHtml(diffLines(from.body, to.body))}
        <div class="actions"><a class="btn ghost" href="/p/${p.id}/history">Back to history</a></div>`,
    });
  });
  app.get('/p/:id/history', (req, res) => {
    const p = getPage(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const vs = db.prepare(`SELECT v.id, v.title, v.created_at, u.username FROM versions v LEFT JOIN users u ON u.id = v.edited_by WHERE page_id = ? ORDER BY v.id DESC`).all(p.id);
    page(res, {
      title: `History: ${p.title}`, user: req.user, space: spaceOf(p), current: p.id,
      body: `<span class="eyebrow">Version history</span><h1 class="page-title"><a href="/p/${p.id}">${esc(p.title)}</a></h1>
        <div class="row-list">${vs.map((v, i) => `<a class="row-item" href="/p/${p.id}/history/${v.id}" data-i="${i}">${icon('clock')}<span class="t">${esc(v.title)}</span><span class="s">${esc(v.created_at.slice(0, 16))} UTC${v.username ? `<br>${esc(v.username)}` : ''}</span></a>`).join('') || `<div class="empty">${emptyArt()}<h3>No earlier versions</h3><p class="muted">Versions are saved each time you edit.</p></div>`}</div>`,
    });
  });
  app.get('/p/:id/history/:vid', (req, res) => {
    const p = getPage(Number(req.params.id));
    const v = db.prepare('SELECT * FROM versions WHERE id = ? AND page_id = ?').get(Number(req.params.vid), Number(req.params.id));
    if (!p || !v) return res.status(404).send('No such version');
    page(res, {
      title: v.title, user: req.user, space: spaceOf(p), current: p.id,
      body: `<span class="eyebrow">Version from ${esc(v.created_at)} UTC</span><h1 class="page-title">${esc(v.title)}</h1>
        <form method="post" action="/p/${p.id}/restore/${v.id}" class="actions"><button>Restore this version</button><a class="btn ghost" href="/p/${p.id}/diff?from=${v.id}&to=current">${icon('clock')}Compare with current</a><a class="btn ghost" href="/p/${p.id}/history">Back</a></form>
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

  // ---- changelog (rendered from CHANGELOG.md) ----
  app.get('/changelog', (req, res) => {
    page(res, {
      title: 'Changelog', user: req.user, toc: false,
      body: `<div class="page-head"><div><span class="eyebrow">Folio v${esc(VERSION)}</span><h1 class="page-title">What's new</h1></div></div>
        <article class="doc changelog">${renderMarkdown(CHANGELOG.replace(/^# Changelog\s*/, ''))}</article>`,
    });
  });

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
  function spaceOf(p) { return db.prepare('SELECT * FROM spaces WHERE id = ?').get(p.space_id); }
  // Confluence-style nav: Home, then every space; the current space expands into its page tree.
  function sidebar(space, currentId, section) {
    const spaces = db.prepare('SELECT * FROM spaces ORDER BY name').all();
    const cur = currentId ? getPage(currentId) : null;
    const open = new Set(cur ? [cur.id, ...breadcrumbs(cur).map((c) => c.id)] : []);
    return `<a class="nav-link${space || section === 'notifications' ? '' : ' cur'}" href="/">${icon('home')}Home</a><a class="nav-link" href="/learn">${icon('bulb')}Learn</a>
      <div class="nav-label"><span>Spaces</span><a href="/#new-space" title="New space" aria-label="New space">${icon('plus')}</a></div>
      <ul class="spaces">${spaces.map((s) => {
        const here = space && s.id === space.id;
        return `<li class="space${here ? ' here' : ''}"><a class="space-link" href="/s/${esc(s.key)}"><span class="mono-tile ${hueClass(s.key)}">${esc(s.key.slice(0, 1))}</span>${esc(s.name)}</a>${here
          ? `<div class="space-body"><a class="nav-link sm-nav${section === 'board' ? ' cur' : ''}" href="/s/${esc(s.key)}/board">${icon('board')}Board</a><a class="nav-link sm-nav${section === 'backlog' ? ' cur' : ''}" href="/s/${esc(s.key)}/backlog">${icon('backlog')}Backlog</a><a class="nav-link sm-nav${section === 'issues' ? ' cur' : ''}" href="/s/${esc(s.key)}/issues">${icon('search')}Issues</a><a class="nav-link sm-nav${section === 'reports' ? ' cur' : ''}" href="/s/${esc(s.key)}/reports">${icon('chart')}Reports</a><a class="nav-link sm-nav${section === 'code' ? ' cur' : ''}" href="/s/${esc(s.key)}/code">${icon('branch')}Code</a><div class="nav-label sub">Pages</div><a class="create" href="/s/${esc(s.key)}/create${cur ? `?parent=${cur.id}` : ''}">${icon('plus')}Create page</a>${treeHtml(spaceTree(s.id), currentId, open) || '<p class="muted pad">No pages yet</p>'}</div>`
          : ''}</li>`;
      }).join('')}</ul>
      <p class="credit"><a href="/changelog" title="What's new">folio v${VERSION}</a> · by <a href="https://tombrooks.dev" target="_blank" rel="noopener">tombrooks.dev</a></p>`;
  }
  function setPageLabels(pageId, text) {
    db.prepare('DELETE FROM page_labels WHERE page_id = ?').run(pageId);
    for (const l of parseLabels(text)) db.prepare('INSERT INTO page_labels (page_id, label) VALUES (?, ?)').run(pageId, l);
  }
  function descendantIds(id) {
    return db.prepare('WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT p.id FROM pages p JOIN t ON p.parent_id = t.id) SELECT id FROM t').all(id).map((r) => r.id);
  }
  // <option>s for the "Parent page" picker: the space's tree, minus the page being edited and everything under it
  function parentOptions(space, selfId, selected) {
    const skip = new Set(selfId ? descendantIds(selfId) : []);
    const walk = (nodes, depth) => nodes.filter((n) => !skip.has(n.id)).map((n) =>
      `<option value="${n.id}"${n.id === Number(selected) ? ' selected' : ''}>${'&nbsp;&nbsp;'.repeat(depth)}${esc(n.title)}</option>${walk(n.children, depth + 1)}`).join('');
    return `<option value="">Top level of ${esc(space.name)}</option>${walk(spaceTree(space.id), 0)}`;
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
      title: heading, user: req.user, space, current: existingId, toc: false,
      body: `${hint(db, req.user, 'editor', 'Paste or drop an image to attach it. Your work is saved in this browser as a draft while you type.')}<span class="eyebrow">${esc(heading)}</span>
        <form method="post" action="${action}" id="edit-form" data-upload-space="${esc(space.key)}"${existingId ? ` data-upload-page="${existingId}"` : ''}>
          <div class="draft-banner" id="draft-banner" hidden><span id="draft-text"></span><span class="spacer"></span><button type="button" class="ghost sm" id="draft-restore">Restore draft</button><button type="button" class="link-btn" id="draft-discard">Discard</button></div>
          <input class="title-input" name="title" value="${esc(p.title)}" placeholder="Page title" aria-label="Page title" required autofocus>
          <input class="label-input" name="labels" value="${esc(p.label_list ?? '')}" placeholder="Labels, e.g. runbook, onboarding" aria-label="Labels">
          <div class="toolbar" role="toolbar" aria-label="Formatting">
            <label class="parent-pick">Parent <select name="parent_id" aria-label="Parent page">${parentOptions(space, existingId, p.parent_id)}</select></label><span class="sep"></span>
            ${tb('bold', 'Bold (Ctrl+B)')}${tb('italic', 'Italic (Ctrl+I)')}${tb('heading', 'Heading', true)}${tb('list', 'List')}${tb('quote', 'Quote')}${tb('code', 'Code')}${tb('link', 'Link', true)}<button type="button" class="ghost" id="attach-btn" title="Attach a file or image" aria-label="Attach a file or image">${icon('paperclip')}</button><input type="file" id="attach-input" multiple hidden>
            <span class="status"><span class="dot" id="dot"></span><span id="words">0 words</span></span>
          </div>
          <div class="editor">
            <textarea id="body" name="body" placeholder="Write Markdown here. Press Ctrl+S to save." aria-label="Page body">${esc(p.body)}</textarea>
            <div class="preview doc" id="preview"></div>
          </div>
          <div class="actions"><button>${icon('save')}Save page</button><a class="btn ghost" href="${existingId ? `/p/${existingId}` : `/s/${esc(space.key)}`}">Cancel</a></div>
        </form>
        ${existingId ? `<form method="post" action="/p/${existingId}/delete" data-confirm="Delete this page and all its child pages?"><button class="danger">${icon('trash')}Delete page</button></form>` : ''}
        <script src="/files.js"></script><script src="/editor.js"></script>`,
    });
  }

  return app;
}

function emptyArt() {
  return `<svg class="art" viewBox="0 0 84 84" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M22 10h28l14 14v50H22z"/><path d="M50 10v14h14M32 42h22M32 52h22M32 62h14"/></svg>`;
}

function authForm(heading, action, error) {
  const setup = action === '/setup';
  return `<div class="auth">
    <section class="auth-art"><a class="brand" href="/">folio<i>.</i></a><div><blockquote>Write it down once. <em>Find it</em> in seconds.</blockquote><small>Self-hosted. Your data stays in one file. By tombrooks.dev</small></div></section>
    <section class="auth-form"><form class="form" method="post" action="${action}">
      <h1>${esc(heading)}</h1><p class="muted">${setup ? 'This first account becomes the administrator.' : 'Welcome back.'}</p>
      ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
      <input name="username" placeholder="Username" aria-label="Username" autocomplete="username" required autofocus>
      <input type="password" name="password" placeholder="Password" aria-label="Password" autocomplete="${setup ? 'new-password' : 'current-password'}" required>
      <button>${esc(heading)}</button>
    </form></section></div>`;
}
