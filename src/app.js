import express from 'express';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { buildTree, ftsQuery, tx } from './db.js';
import {
  COOKIE, HOST_COOKIE, ROLES, MIN_PASSWORD, hashPassword, verifyPassword, verifyOrDummy, validatePassword, validateUsername,
  createSession, userForToken, destroySession, destroyOtherSessions, purgeExpiredSessions,
} from './auth.js';
import { str, wrap, sleep, createLimiter } from './util.js';
import { mountBoard } from './board.js';
import { createFiles } from './files.js';
import { createGithub, mountGithub } from './github.js';
import { mountComments, commentsPanel, commentCount } from './comments.js';
import { TEMPLATES, findTemplate, fillTemplate } from './templates.js';
import { diffLines, diffHtml } from './diff.js';
import { parseLabels } from './issues.js';
import { createNotifier, mountNotifications, unreadCount, watchButton } from './notify.js';
import { mountLearn, checklistCard, hint, getFlag } from './learn.js';
import { renderMarkdown, esc, layout, treeHtml, icon, hueClass, setKeyResolver, setMentionResolver, setAllowRemoteImages } from './render.js';

const { version: VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const CHANGELOG = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const parseCookies = (h = '') =>
  Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));

export function createApp(db, {
  secureCookies = false,
  trustProxy = false,
  uploadDir = new URL('../data/uploads', import.meta.url).pathname,
  maxUploadMb = 25,
  maxStorageMb = 2048,
  github = createGithub(),
  webhookUrl = '',
  publicUrl = '',
  fetchFn = globalThis.fetch,
  setupToken = '',
  disableSetup = false,
  allowRemoteImages = false,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  if (trustProxy) app.set('trust proxy', 1);
  setAllowRemoteImages(allowRemoteImages);
  const keyStmt = db.prepare('SELECT i.id FROM issues i JOIN spaces s ON s.id = i.space_id WHERE s.key = ? AND i.num = ?');
  setKeyResolver((key, num) => keyStmt.get(key, num)?.id ?? null);
  const userStmt = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE');
  setMentionResolver((name) => !!userStmt.get(name));

  // Expired sessions are removed at start-up and hourly.
  purgeExpiredSessions(db);
  setInterval(() => purgeExpiredSessions(db), 3600e3).unref();

  const publicHost = (() => { try { return publicUrl ? new URL(publicUrl).host : ''; } catch { return ''; } })();
  const isLocal = (req) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(req.hostname);
  // Secure cookies everywhere except plain-HTTP localhost, so running it on your own machine still works.
  const useSecure = (req) => secureCookies && !isLocal(req);
  const wantsJson = (req) => req.get('X-Requested-With') === 'fetch' || /application\/json/.test(req.get('accept') ?? '');
  const deny = (req, res, status, message) => (wantsJson(req) ? res.status(status).json({ error: message }) : res.status(status).type('text').send(message));

  // 1. Security headers on everything, including static files.
  const CSP = `default-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:${allowRemoteImages ? ' https:' : ''}; style-src 'self'; script-src 'self'; font-src 'self'`;
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (secureCookies && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // 2. Static assets.
  app.use(express.static(new URL('../public', import.meta.url).pathname, { setHeaders: (res, f) => res.set('Cache-Control', f.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache') }));

  // 3. Cross-site request defence, then identify the user.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const site = req.get('sec-fetch-site');
      if (site && site !== 'same-origin') return deny(req, res, 403, 'Cross-site request blocked');
      const origin = req.get('origin');
      if (origin !== undefined) {
        let host = null;
        try { host = origin === 'null' ? null : new URL(origin).host; } catch { /* unparseable: treated as blocked */ }
        if (!host || (host !== req.get('host') && host !== publicHost)) return deny(req, res, 403, 'Cross-origin request blocked');
      }
    }
    const cookies = parseCookies(req.headers.cookie);
    req.token = cookies[HOST_COOKIE] ?? cookies[COOKIE];
    req.user = userForToken(db, req.token);
    res.set('Cache-Control', 'no-store'); // signed-in pages must not come back from the browser cache after logout
    next();
  });

  // 4. Body parsing: small by default, larger only where people write documents.
  const smallBody = express.urlencoded({ extended: false, limit: '100kb' });
  const bigBody = express.urlencoded({ extended: false, limit: '2mb' });
  const BIG = /^\/(s\/[^/]+\/(pages|issues|epics)|p\/\d+|i\/\d+|e\/\d+|preview|p\/\d+\/comments|i\/\d+\/comment|i\/\d+\/field)$/;
  app.use((req, res, next) => (BIG.test(req.path) ? bigBody : smallBody)(req, res, next));
  // A repeated or nested field (name=A&name=B) becomes its last value, so handlers always see strings.
  app.use((req, res, next) => {
    for (const src of [req.body, req.query]) for (const k of Object.keys(src ?? {})) {
      const v = src[k];
      if (Array.isArray(v)) src[k] = v[v.length - 1];
      else if (v && typeof v === 'object') src[k] = '';
    }
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
      opts.canWrite = opts.user.role !== 'viewer';
    }
    res.send(layout(opts));
  };
  const setCookie = (req, res, token, maxAge) => {
    const secure = useSecure(req);
    const other = secure ? COOKIE : HOST_COOKIE;
    if (parseCookies(req.headers.cookie)[other]) res.clearCookie(other, { path: '/' }); // never leave the other flavour behind
    res.cookie(secure ? HOST_COOKIE : COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge, path: '/' });
  };
  const clearCookies = (res) => { res.clearCookie(COOKIE, { path: '/' }); res.clearCookie(HOST_COOKIE, { path: '/' }); };
  const insecureNotice = (req) => (secureCookies && !isLocal(req) && !req.secure
    ? 'This connection is not HTTPS, so your browser will refuse to keep you signed in. Use the HTTPS address, or set FOLIO_SECURE_COOKIES=0 to allow plain HTTP on a trusted network.' : '');
  const tokenOk = (given) => {
    const a = createHash('sha256').update(String(given ?? '')).digest(), b = createHash('sha256').update(setupToken).digest();
    return timingSafeEqual(a, b);
  };

  // ---- auth ----
  const ipLimiter = createLimiter({ max: 10, windowMs: 15 * 60e3 });
  const userLimiter = createLimiter({ max: 20, windowMs: 15 * 60e3 });

  app.get('/setup', (req, res) => {
    if (userCount()) return res.redirect('/login');
    if (disableSetup) return res.status(404).send(layout({ bare: true, title: 'Set up', body: authForm('Setup is disabled', '', 'The web setup page is turned off. Create the first user from the command line with: folio add-user NAME', { hideForm: true }) }));
    page(res, { bare: true, title: 'Set up', body: authForm('Create admin account', '/setup', insecureNotice(req), { token: !!setupToken, notice: true }) });
  });
  app.post('/setup', wrap(async (req, res) => {
    if (userCount()) return res.redirect('/login');
    if (disableSetup) return res.status(404).send('Setup is disabled');
    const form = (msg, status = 400) => res.status(status).send(layout({ bare: true, title: 'Set up', body: authForm('Create admin account', '/setup', msg, { token: !!setupToken }) }));
    if (setupToken && !tokenOk(req.body.token)) return form('The setup token is wrong.', 403);
    const username = str(req.body.username, 64), password = typeof req.body.password === 'string' ? req.body.password : '';
    const problem = validateUsername(username) || validatePassword(password, username);
    if (problem) return form(problem);
    const hash = await hashPassword(password);
    // atomic: only the first request can ever create the administrator
    const made = db.prepare("INSERT INTO users (username, password_hash, role) SELECT ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)").run(username, hash);
    if (made.changes !== 1) return res.redirect('/login');
    const s = createSession(db, Number(made.lastInsertRowid));
    setCookie(req, res, s.token, s.maxAge);
    res.redirect('/');
  }));
  app.get('/login', (req, res) => {
    if (!userCount()) return res.redirect(disableSetup ? '/setup' : '/setup');
    page(res, { bare: true, title: 'Sign in', body: authForm('Sign in', '/login', insecureNotice(req), { notice: true }) });
  });
  app.post('/login', wrap(async (req, res) => {
    const username = str(req.body.username, 64), password = typeof req.body.password === 'string' ? req.body.password : '';
    const userKey = username.toLowerCase();
    if (!ipLimiter.allowed(req.ip) || !userLimiter.allowed(userKey)) return res.status(429).send('Too many attempts. Try again later.');
    const u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    const ok = await verifyOrDummy(password, u?.password_hash); // always does the hashing work, so timing doesn't reveal which usernames exist
    if (!u || !ok) {
      ipLimiter.hit(req.ip); userLimiter.hit(userKey);
      await sleep(300);
      return res.status(401).send(layout({ bare: true, title: 'Sign in', body: authForm('Sign in', '/login', 'Wrong username or password.') }));
    }
    ipLimiter.reset(req.ip); userLimiter.reset(userKey);
    destroySession(db, req.token); // rotate: a new session id at every login
    const s = createSession(db, u.id);
    setCookie(req, res, s.token, s.maxAge);
    res.redirect('/');
  }));
  app.post('/logout', (req, res) => {
    destroySession(db, req.token);
    clearCookies(res);
    res.redirect('/login');
  });

  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok'); });

  // Everything below needs a signed-in user.
  app.use((req, res, next) => {
    if (!userCount()) return res.redirect('/setup');
    if (!req.user) return res.redirect('/login');
    next();
  });

  // ---- roles: viewer = read only, member = edit, admin = also users and integrations ----
  const VIEWER_OK = [/^\/logout$/, /^\/me\/flag$/, /^\/notifications\//, /^\/settings\/notifications$/, /^\/account(\/|$)/, /^\/watch\//, /^\/learn\/[^/]+\/[^/]+\/complete$/, /^\/preview$/];
  const ADMIN_ONLY = [/^\/s\/[^/]+\/code\/(link|unlink)$/, /^\/admin(\/|$)/];
  app.use((req, res, next) => {
    const role = req.user.role;
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (role !== 'admin' && ADMIN_ONLY.some((r) => r.test(req.path))) return deny(req, res, 403, 'Administrators only');
    if (!read && role === 'viewer' && !VIEWER_OK.some((r) => r.test(req.path))) return deny(req, res, 403, 'Your account is read-only');
    next();
  });
  // Light per-user rate limits on the endpoints that are expensive to serve.
  const hot = createLimiter({ max: 120, windowMs: 60e3 }), uploads = createLimiter({ max: 60, windowMs: 60e3 });
  app.use(['/preview', '/search.json'], (req, res, next) => (hot.allowed(req.user.id) ? (hot.hit(req.user.id), next()) : deny(req, res, 429, 'Slow down a little')));
  app.use('/attachments', (req, res, next) => (req.method !== 'POST' || uploads.allowed(req.user.id) ? (req.method === 'POST' && uploads.hit(req.user.id), next()) : deny(req, res, 429, 'Too many uploads, try again in a minute')));

  // ---- account ----
  app.get('/account', (req, res) => {
    const msg = { password: 'Password changed. Other sessions were signed out.', signout: 'Signed out of every other session.' }[req.query.ok];
    page(res, {
      title: 'Account', user: req.user, toc: false,
      body: `<span class="eyebrow">${esc(req.user.role)}</span><h1 class="page-title">${esc(req.user.username)}</h1>
        ${msg ? `<p class="ok-note" role="status">${esc(msg)}</p>` : ''}${req.query.err ? `<p class="err" role="alert">${esc(req.query.err)}</p>` : ''}
        <div class="section-head"><h2>Change password</h2></div>
        <form class="form" method="post" action="/account/password">
          <input type="password" name="current" placeholder="Current password" aria-label="Current password" autocomplete="current-password" required>
          <input type="password" name="password" placeholder="New password (${MIN_PASSWORD}+ characters)" aria-label="New password" autocomplete="new-password" required>
          <button>Change password</button></form>
        <div class="section-head"><h2>Sessions</h2></div>
        <p class="muted">Signed in somewhere you no longer trust? Sign out everywhere else. Changing your password does this too.</p>
        <form method="post" action="/account/signout-everywhere"><button class="ghost">Sign out other sessions</button></form>
        ${req.user.role === 'admin' ? `<div class="section-head"><h2>Administration</h2></div><a class="btn ghost" href="/admin/users">${icon('settings')}Manage people</a>` : ''}`,
    });
  });
  app.post('/account/password', wrap(async (req, res) => {
    const back = (err) => res.redirect(`/account?err=${encodeURIComponent(err)}`);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!ipLimiter.allowed(`pw:${req.user.id}`)) return res.status(429).send('Too many attempts. Try again later.');
    if (!(await verifyPassword(req.body.current, row.password_hash))) { ipLimiter.hit(`pw:${req.user.id}`); await sleep(300); return back('Your current password is wrong.'); }
    const problem = validatePassword(password, req.user.username);
    if (problem) return back(problem);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), req.user.id);
    destroyOtherSessions(db, req.user.id, req.token);
    res.redirect('/account?ok=password');
  }));
  app.post('/account/signout-everywhere', (req, res) => {
    destroyOtherSessions(db, req.user.id, req.token);
    res.redirect('/account?ok=signout');
  });

  // ---- people (administrators) ----
  app.get('/admin/users', (req, res) => {
    const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username COLLATE NOCASE').all();
    page(res, {
      title: 'People', user: req.user, toc: false,
      body: `<span class="eyebrow">Administration</span><h1 class="page-title">People</h1>
        ${req.query.err ? `<p class="err" role="alert">${esc(req.query.err)}</p>` : ''}
        <p class="muted"><b>Viewers</b> can read everything but change nothing. <b>Members</b> create and edit. <b>Administrators</b> also manage people and link GitHub.</p>
        <div class="list">${users.map((u) => `<form class="row-item user-row" method="post" action="/admin/users/${u.id}/role"><span class="avatar sm-av ${hueClass(u.username)}">${esc(u.username.slice(0, 1).toUpperCase())}</span><span class="t">${esc(u.username)}</span>
          <select name="role" aria-label="Role for ${esc(u.username)}" data-auto>${ROLES.map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></form>`).join('')}</div>
        <div class="section-head"><h2>Add a person</h2></div>
        <form class="form" method="post" action="/admin/users">
          <input name="username" placeholder="Username" aria-label="Username" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,31}">
          <input type="password" name="password" placeholder="Password (${MIN_PASSWORD}+ characters)" aria-label="Password" autocomplete="new-password" required>
          <select name="role" aria-label="Role"><option value="member">Member</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select>
          <button>${icon('plus')}Add person</button></form>`,
    });
  });
  app.post('/admin/users', wrap(async (req, res) => {
    const username = str(req.body.username, 64), password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = ROLES.includes(req.body.role) ? req.body.role : 'member';
    const problem = validateUsername(username) || validatePassword(password, username) || (userStmt.get(username) ? 'That username is already taken.' : null);
    if (problem) return res.redirect(`/admin/users?err=${encodeURIComponent(problem)}`);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, await hashPassword(password), role);
    res.redirect('/admin/users');
  }));
  app.post('/admin/users/:id(\\d+)/role', (req, res) => {
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).send('No such user');
    const role = ROLES.includes(req.body.role) ? req.body.role : null;
    if (!role) return res.redirect('/admin/users?err=Unknown+role');
    if (target.role === 'admin' && role !== 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n < 2)
      return res.redirect(`/admin/users?err=${encodeURIComponent('There must be at least one administrator.')}`);
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
    res.redirect('/admin/users');
  });

  const files = createFiles({ db, uploadDir, maxBytes: maxUploadMb * 1048576, maxStorageBytes: maxStorageMb * 1048576 });
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
    const name = str(req.body.name, 60);
    const key = str(req.body.key, 12).toUpperCase();
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
    const title = str(req.body.title, 200);
    if (!title) return res.status(400).send('Title required');
    let parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
    if (parentId && getPage(parentId)?.space_id !== space.id) parentId = null;
    const id = tx(db, () => {
      const r = db.prepare('INSERT INTO pages (space_id, parent_id, title, body, updated_by) VALUES (?, ?, ?, ?, ?)')
        .run(space.id, parentId, title, str(req.body.body, 1e6, { trim: false }), req.user.id);
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
    const title = str(req.body.title, 200);
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
        .run(title, str(req.body.body, 1e6, { trim: false }), parentId, req.user.id, p.id);
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

  app.post('/preview', (req, res) => res.type('html').send(renderMarkdown(str(req.body.body, 1e6, { trim: false }))));

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
      body: `${hint(db, req.user, 'editor', 'Paste or drop an image to attach it. Your work is saved in this browser as a draft while you type.')}<h1 class="sr-only">${esc(heading)}</h1>
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

  // ---- last resorts: unknown URLs and errors. Never reveal stack traces or file paths. ----
  app.use((req, res) => deny(req, res, 404, 'Not found'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    deny(req, res, status, status === 413 ? 'That request is too large.' : status < 500 ? 'Bad request' : 'Something went wrong');
  });

  return app;
}

function emptyArt() {
  return `<svg class="art" viewBox="0 0 84 84" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M22 10h28l14 14v50H22z"/><path d="M50 10v14h14M32 42h22M32 52h22M32 62h14"/></svg>`;
}

function authForm(heading, action, error, { token = false, notice = false, hideForm = false } = {}) {
  const setup = action === '/setup';
  return `<div class="auth">
    <section class="auth-art"><a class="brand" href="/">folio<i>.</i></a><div><blockquote>Write it down once. <em>Find it</em> in seconds.</blockquote><small>Self-hosted. Your data stays in one file. By tombrooks.dev</small></div></section>
    <section class="auth-form"><form class="form" method="post" action="${action}">
      <h1>${esc(heading)}</h1><p class="muted">${hideForm ? '' : setup ? 'This first account becomes the administrator.' : 'Welcome back.'}</p>
      ${error ? `<p class="${notice ? 'warn-note' : 'err'}" role="alert">${esc(error)}</p>` : ''}
      ${hideForm ? '' : `${token ? '<input type="password" name="token" placeholder="Setup token" aria-label="Setup token" autocomplete="off" required>' : ''}
      <input name="username" placeholder="Username" aria-label="Username" autocomplete="username" required autofocus>
      <input type="password" name="password" placeholder="Password${setup ? ' (10+ characters)' : ''}" aria-label="Password" autocomplete="${setup ? 'new-password' : 'current-password'}" required>
      <button>${esc(heading)}</button>`}
    </form></section></div>`;
}
