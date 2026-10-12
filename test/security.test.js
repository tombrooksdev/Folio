// Regression tests for the security audit (F01 to F16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { statSync, mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createGithub, validRepo } from '../src/github.js';
import { renderMarkdown, setAllowRemoteImages } from '../src/render.js';
import { hashPassword, verifyOrDummy, validatePassword, validateUsername } from '../src/auth.js';
import { createLimiter } from '../src/util.js';

const PW = 'correct-horse-9';

async function boot(opts = {}) {
  const uploadDir = mkdtempSync(join(tmpdir(), 'folio-sec-'));
  const db = openDb(':memory:');
  const server = createApp(db, { uploadDir, ...opts }).listen(0);
  server.unref();
  const port = server.address().port, base = `http://localhost:${port}`;
  const client = () => {
    let cookie = '';
    return async (path, { method = 'GET', form, raw, headers = {} } = {}) => {
      const r = await fetch(base + path, {
        method, redirect: 'manual',
        headers: { cookie, ...(form && { 'content-type': 'application/x-www-form-urlencoded' }), ...(raw && { 'content-type': 'application/octet-stream' }), ...headers },
        body: raw ?? (typeof form === 'string' ? form : form && new URLSearchParams(form)),
      });
      const sc = r.headers.getSetCookie?.() ?? [];
      const sid = sc.map((c) => c.split(';')[0]).filter((c) => /sid=[0-9a-f]/.test(c)).at(-1);
      if (sid) cookie = sid;
      return { status: r.status, loc: r.headers.get('location'), text: await r.text(), headers: r.headers, cookies: sc };
    };
  };
  const req = client();
  const loginAs = async (u, p = PW) => { const c = client(); const r = await c('/login', { method: 'POST', form: { username: u, password: p } }); assert.equal(r.status, 302, `login ${u}`); return c; };
  const addUser = async (username, role) => db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, await hashPassword(PW), role);
  return { req, client, loginAs, addUser, db, port, uploadDir, close: () => server.close() };
}
const admin = async (b) => { await b.req('/setup', { method: 'POST', form: { username: 'root', password: PW } }); await b.req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } }); };

// ---- F01: GitHub path traversal ----
test('F01: repo names cannot traverse the GitHub API', async () => {
  for (const bad of ['..', 'a/..', '../a', '../user', '../..', './x', 'a/.', 'a/b/c', '-a/b', '', 'a b/c']) assert.equal(validRepo(bad), false, bad);
  for (const good of ['tombrooksdev/Folio', 'o/r', 'a-b/c.d_e', 'x/.github']) assert.equal(validRepo(good), true, good);
  const calls = [];
  const gh = createGithub({ fetchFn: async (u) => { calls.push(u); return { ok: true, status: 200, json: async () => ({}) }; } });
  await assert.rejects(() => gh.repo('../user'), /unexpected GitHub address/);
  assert.equal(calls.length, 0);
  const b = await boot(); await admin(b);
  assert.equal((await b.req('/s/ENG/code/link', { method: 'POST', form: { repo: '../user' } })).status, 400);
  // a bad value already stored in the database is refused at read time too
  b.db.prepare("UPDATE spaces SET github_repo = '../user' WHERE key = 'ENG'").run();
  const page = await b.req('/s/ENG/code');
  assert.equal(page.status, 400); assert.match(page.text, /not valid/);
  const id = (await b.req('/s/ENG/issues', { method: 'POST', form: { title: 'x' } })).loc.split('/')[2];
  assert.equal((await b.req(`/i/${id}/dev`)).status, 404);
  b.close();
});

// ---- F02 / F08: cookies, HSTS, headers ----
function rawRequest(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port, path, method, headers }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t })); });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}
test('F02: secure cookies and HSTS on a real host; plain localhost keeps working', async () => {
  const b = await boot({ secureCookies: true, trustProxy: true });
  const form = `username=root&password=${PW}`, type = { 'content-type': 'application/x-www-form-urlencoded' };
  const setup = await rawRequest(b.port, '/setup', { method: 'POST', body: form, headers: { ...type, host: 'wiki.example.com', 'x-forwarded-proto': 'https' } });
  assert.equal(setup.status, 302);
  const cookie = setup.headers['set-cookie'].join(';');
  assert.match(cookie, /__Host-folio_sid=[0-9a-f]+/); assert.match(cookie, /; Secure/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\//);
  assert.match(setup.headers['strict-transport-security'], /max-age=31536000; includeSubDomains/);
  // the __Host- cookie works for later requests
  const home = await rawRequest(b.port, '/', { headers: { host: 'wiki.example.com', 'x-forwarded-proto': 'https', cookie: cookie.split(';')[0] } });
  assert.equal(home.status, 200);
  // no HSTS on plain HTTP
  assert.equal((await rawRequest(b.port, '/login', { headers: { host: 'wiki.example.com' } })).headers['strict-transport-security'], undefined);
  // plain-HTTP localhost still gets a usable (non-Secure) cookie
  const local = await b.loginAs('root');
  assert.ok(local);
  b.close();
});

test('F08: hardening headers on pages and static files', async () => {
  const b = await boot(); await admin(b);
  const home = await b.req('/');
  const csp = home.headers.get('content-security-policy');
  for (const d of ["base-uri 'none'", "form-action 'self'", "object-src 'none'", "frame-ancestors 'none'", "font-src 'self'", "img-src 'self' data:"]) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /https:/);
  assert.equal(home.headers.get('cache-control'), 'no-store');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.match(home.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(home.headers.get('cross-origin-opener-policy'), 'same-origin');
  const css = await b.req('/style.css');
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
  assert.notEqual(css.headers.get('cache-control'), 'no-store');
  b.close();
});

// ---- F03: errors and malformed input ----
test('F03: no stack traces, malformed input is handled, null Origin is blocked', async () => {
  const b = await boot(); await admin(b);
  const dup = await b.req('/spaces', { method: 'POST', form: 'name=A&name=B&key=XYZ', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.ok(dup.status < 500, `got ${dup.status}`); assert.doesNotMatch(dup.text, /at file:|node_modules|TypeError/);
  const nested = await b.req('/spaces', { method: 'POST', form: 'name[a]=1&key=QQQ', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.doesNotMatch(nested.text, /at file:|TypeError/);
  assert.equal((await b.req('/spaces', { method: 'POST', form: { name: 'N', key: 'NN' }, headers: { origin: 'null' } })).status, 403);
  assert.equal((await b.req('/spaces', { method: 'POST', form: { name: 'N', key: 'NN' }, headers: { origin: 'not a url' } })).status, 403);
  assert.equal((await b.req('/spaces', { method: 'POST', form: { name: 'N', key: 'NN' }, headers: { origin: 'https://evil.example' } })).status, 403);
  // unexpected exceptions become a generic message
  const boom = createGithub({ fetchFn: async () => { throw new Error('secret /home/tom/db path'); } });
  const b2 = await boot({ github: boom }); await admin(b2);
  b2.db.prepare("UPDATE spaces SET github_repo = 'o/r' WHERE key = 'ENG'").run();
  const res = await b2.req('/s/ENG/code');
  assert.equal(res.status, 502); assert.doesNotMatch(res.text, /secret|\/home\/tom/); assert.match(res.text, /Could not load/);
  assert.equal((await b2.req('/')).status, 200); // still serving
  b.close(); b2.close();
});

// ---- F04: login ----
test('F04: unknown users cost the same as known ones, and the limiter locks out repeat failures', async () => {
  const t0 = performance.now(); assert.equal(await verifyOrDummy('whatever-pass', null), false); assert.ok(performance.now() - t0 > 3, 'the dummy hash must really be computed');
  const lim = createLimiter({ max: 3, windowMs: 50 });
  for (let i = 0; i < 3; i++) lim.hit('k');
  assert.equal(lim.allowed('k'), false); lim.reset('k'); assert.equal(lim.allowed('k'), true);
  lim.hit('old'); await new Promise((r) => setTimeout(r, 70)); lim.prune(); assert.equal(lim.size, 0); // stale keys are pruned
  const b = await boot(); await admin(b);
  const anon = b.client();
  for (let i = 0; i < 10; i++) assert.equal((await anon('/login', { method: 'POST', form: { username: 'root', password: 'wrong-wrong-1' } })).status, 401);
  assert.equal((await anon('/login', { method: 'POST', form: { username: 'root', password: PW } })).status, 429); // locked out, even with the right password
  const other = await boot(); await admin(other);
  assert.equal((await other.client()('/login', { method: 'POST', form: { username: 'ROOT', password: PW } })).status, 302); // case-insensitive username, success path
  assert.equal((await other.client()('/login', { method: 'POST', form: { username: 'nobody', password: 'x'.repeat(5000) } })).status, 401); // huge password is just refused
  b.close(); other.close();
});

// ---- F05: first-run setup ----
test('F05: setup token, disabled setup, and a race that can only make one admin', async () => {
  const t = await boot({ setupToken: 'let-me-in' });
  assert.equal((await t.req('/setup', { method: 'POST', form: { username: 'root', password: PW } })).status, 403);
  assert.equal((await t.req('/setup', { method: 'POST', form: { username: 'root', password: PW, token: 'wrong' } })).status, 403);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  assert.match((await t.req('/setup')).text, /Setup token/);
  assert.equal((await t.req('/setup', { method: 'POST', form: { username: 'root', password: PW, token: 'let-me-in' } })).status, 302);
  assert.equal(t.db.prepare("SELECT role FROM users WHERE username = 'root'").get().role, 'admin');
  t.close();

  const d = await boot({ disableSetup: true });
  assert.equal((await d.req('/setup')).status, 404);
  assert.equal((await d.req('/setup', { method: 'POST', form: { username: 'root', password: PW } })).status, 404);
  assert.equal(d.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  d.close();

  const r = await boot();
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => r.client()('/setup', { method: 'POST', form: { username: `user${i}`, password: PW } })));
  assert.equal(r.db.prepare('SELECT COUNT(*) n FROM users').get().n, 1); // the check and the insert are one atomic step
  assert.equal(results.filter((x) => x.loc === '/').length, 1);
  r.close();
});

// ---- F06: roles ----
test('F06: viewers are read-only, members edit, only admins manage people and GitHub', async () => {
  const b = await boot(); await admin(b);
  await b.addUser('vera', 'viewer'); await b.addUser('mia', 'member');
  const viewer = await b.loginAs('vera'), member = await b.loginAs('mia');
  const pid = (await b.req('/s/ENG/pages', { method: 'POST', form: { title: 'Doc', body: 'x' } })).loc.split('/')[2];

  assert.equal((await viewer(`/p/${pid}`)).status, 200); // can read
  assert.doesNotMatch((await viewer('/')).text, /id="create-btn"/); // and the Create button is hidden
  for (const [path, form] of [['/spaces', { name: 'X', key: 'XX' }], [`/p/${pid}/delete`, {}], [`/p/${pid}`, { title: 'Hacked', body: 'y' }], ['/s/ENG/pages', { title: 'N', body: '' }],
    ['/s/ENG/issues', { title: 'I' }], [`/p/${pid}/comments`, { body: 'hi' }], ['/learn/sandbox', {}], ['/attachments?space=ENG&name=a.png', undefined]])
    assert.equal((await viewer(path, { method: 'POST', form })).status, 403, path);
  assert.equal((await b.req(`/p/${pid}`)).text.includes('Hacked'), false);
  for (const ok of [['/me/flag', { key: 'tour' }], ['/settings/notifications', { mention: '1' }], ['/notifications/read-all', {}], [`/watch/page/${pid}`, {}]])
    assert.notEqual((await viewer(ok[0], { method: 'POST', form: ok[1] })).status, 403, ok[0]); // personal settings stay available

  assert.equal((await member('/s/ENG/pages', { method: 'POST', form: { title: 'By member', body: '' } })).status, 302);
  assert.equal((await member('/s/ENG/code/link', { method: 'POST', form: { repo: 'o/r' } })).status, 403);
  assert.equal((await member('/admin/users')).status, 403);
  assert.equal((await b.req('/admin/users')).status, 200);
  assert.equal((await b.req('/s/ENG/code/link', { method: 'POST', form: { repo: 'o/r' } })).status, 302);

  // attachments: only the uploader or an admin may delete
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = JSON.parse((await member('/attachments?space=ENG&name=a.png', { method: 'POST', raw: png })).text);
  const other = await b.addUser('max', 'member'); void other;
  const max = await b.loginAs('max');
  assert.equal((await max(`/attachments/${up.id}/delete`, { method: 'POST', form: {} })).status, 403);
  assert.equal((await b.req(`/attachments/${up.id}/delete`, { method: 'POST', form: {} })).status, 302); // admin
  // comments: author or admin
  await member(`/p/${pid}/comments`, { method: 'POST', form: { body: 'mine' } });
  const cid = b.db.prepare('SELECT id FROM page_comments LIMIT 1').get().id;
  assert.equal((await max(`/comments/${cid}/delete`, { method: 'POST' })).status, 403);

  // people management and the last-admin guard
  const rootId = b.db.prepare("SELECT id FROM users WHERE username = 'root'").get().id;
  assert.match((await b.req(`/admin/users/${rootId}/role`, { method: 'POST', form: { role: 'member' } })).loc, /err=/);
  assert.equal(b.db.prepare('SELECT role FROM users WHERE id = ?').get(rootId).role, 'admin');
  const miaId = b.db.prepare("SELECT id FROM users WHERE username = 'mia'").get().id;
  await b.req(`/admin/users/${miaId}/role`, { method: 'POST', form: { role: 'viewer' } });
  assert.equal(b.db.prepare('SELECT role FROM users WHERE id = ?').get(miaId).role, 'viewer');
  assert.equal((await b.req('/admin/users', { method: 'POST', form: { username: 'newbie', password: PW, role: 'member' } })).loc, '/admin/users');
  assert.equal(b.db.prepare("SELECT role FROM users WHERE username = 'newbie'").get().role, 'member');
  b.close();
});

test('F06: a database from before roles gets its first user promoted to admin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'folio-mig-')), file = join(dir, 'old.db');
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO users (username, password_hash) VALUES ('first','x'), ('second','y');");
  old.close();
  const db = openDb(file);
  assert.deepEqual(db.prepare('SELECT username, role FROM users ORDER BY id').all().map((r) => `${r.username}:${r.role}`), ['first:admin', 'second:member']);
});

// ---- F07: sanitiser ----
test('F07: no password inputs, remote images or protocol-relative images; links are hardened', () => {
  setAllowRemoteImages(false);
  const html = renderMarkdown('<input type="password" placeholder="Password"> <img src="//evil.example/x.png"> <img src="https://evil.example/p.gif"> ![ok](/files/1/a.png)\n\n- [x] done\n\n[out](https://example.com) [in](/p/1) [bad](javascript:alert(1))');
  assert.doesNotMatch(html, /type="password"/); assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /<img src="\/files\/1\/a\.png"/); // uploaded images stay
  assert.match(html, /<input(?=[^>]*type="checkbox")(?=[^>]*disabled)[^>]*>/);
  assert.doesNotMatch(html, /<img \/>/); // images without a usable source are dropped entirely // task lists stay, read-only
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer nofollow">out<\/a>/);
  assert.match(html, /<a href="\/p\/1">in<\/a>/); assert.doesNotMatch(html, /javascript:/);
  setAllowRemoteImages(true);
  assert.match(renderMarkdown('![x](https://ok.example/p.png)'), /https:\/\/ok\.example\/p\.png/); // opt-in
  setAllowRemoteImages(false);
});

// ---- F09: private files ----
test('F09: the database and uploads are created private', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'folio-perm-')), file = join(dir, 'sub', 'folio.db');
  const db = openDb(file);
  db.prepare("INSERT INTO spaces (key, name) VALUES ('A1', 'x')").run();
  assert.equal(statSync(file).mode & 0o077, 0);
  assert.equal(statSync(join(dir, 'sub')).mode & 0o077, 0);
  for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) assert.equal(statSync(file + ext).mode & 0o077, 0, ext);
  const up = join(dir, 'uploads');
  createApp(db, { uploadDir: up }).listen(0).unref();
  assert.equal(statSync(up).mode & 0o077, 0);
});

// ---- F10: uploads ----
test('F10: content is checked against the extension, storage is capped, orphans are purged', async () => {
  const b = await boot(); await admin(b);
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const bad = await b.req('/attachments?space=ENG&name=evil.png', { method: 'POST', raw: html });
  assert.equal(bad.status, 415); assert.equal(readdirSync(b.uploadDir).length, 0); // and nothing was left on disk
  assert.equal((await b.req('/attachments?space=ENG&name=x.pdf', { method: 'POST', raw: html })).status, 415);
  assert.equal((await b.req('/attachments?space=ENG&name=notes.txt', { method: 'POST', raw: html })).status, 200); // plain files are fine (served as downloads)
  assert.equal((await b.req('/attachments?space=ENG&name=a.png', { method: 'POST', raw: Buffer.from('89504e470d0a1a0a', 'hex') })).status, 200);

  const small = await boot({ maxStorageMb: 0.00005 }); await admin(small); // 52 bytes
  assert.equal((await small.req('/attachments?space=ENG&name=a.txt', { method: 'POST', raw: Buffer.alloc(40, 97) })).status, 200);
  const full = await small.req('/attachments?space=ENG&name=b.txt', { method: 'POST', raw: Buffer.alloc(40, 98) });
  assert.equal(full.status, 413); assert.match(full.text, /storage limit/);

  // orphan older than a day is removed on start-up; a recent one is kept
  const dir = mkdtempSync(join(tmpdir(), 'folio-orph-')), db = openDb(':memory:');
  db.prepare("INSERT INTO spaces (key, name) VALUES ('ENG', 'Eng')").run();
  writeFileSync(join(dir, 'old'), 'x'); writeFileSync(join(dir, 'new'), 'y');
  const ins = db.prepare("INSERT INTO attachments (space_id, filename, mime, size, stored, created_at) VALUES (1, ?, 'text/plain', 1, ?, datetime('now', ?))");
  ins.run('old.txt', 'old', '-2 days'); ins.run('new.txt', 'new', '-1 hours');
  createApp(db, { uploadDir: dir }).listen(0).unref();
  assert.deepEqual(readdirSync(dir).sort(), ['new']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attachments').get().n, 1);
  b.close(); small.close();
});

// ---- F11 / F16: sessions and accounts ----
test('F11: expired sessions are purged; changing your password signs out other sessions', async () => {
  const b = await boot(); await admin(b);
  const other = await b.loginAs('root');
  assert.equal((await other('/')).status, 200);
  const res = await b.req('/account/password', { method: 'POST', form: { current: PW, password: 'a-new-passphrase-7' } });
  assert.match(res.loc, /ok=password/);
  assert.equal((await other('/')).status, 302); // the other session was revoked
  assert.equal((await b.req('/')).status, 200); // this one survives
  assert.match((await b.req('/account/password', { method: 'POST', form: { current: 'wrong-wrong-1', password: 'another-pass-77' } })).loc, /err=/);
  await b.loginAs('root', 'a-new-passphrase-7');
  // sign out everywhere else
  const third = await b.loginAs('root', 'a-new-passphrase-7');
  await b.req('/account/signout-everywhere', { method: 'POST' });
  assert.equal((await third('/')).status, 302);

  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (username, password_hash) VALUES ('u', 'x')").run();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 1, ?)').run('expired', Date.now() - 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 1, ?)').run('live', Date.now() + 100000);
  createApp(db, { uploadDir: mkdtempSync(join(tmpdir(), 'folio-s-')) }).listen(0).unref();
  assert.deepEqual(db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash), ['live']);
  b.close();
});

test('F16: password and username rules, case-insensitive usernames', async () => {
  assert.match(validatePassword('short'), /at least 10/);
  assert.match(validatePassword('password123'), /too common/); assert.match(validatePassword('aaaaaaaaaaaa'), /too common/);
  assert.match(validatePassword('x'.repeat(2000)), /at most/); assert.match(validatePassword('Root-user-1', 'root-user-1'), /username/);
  assert.equal(validatePassword('a-sensible-passphrase'), null);
  for (const bad of ['a', 'has space', 'x'.repeat(40), '-lead', 'a<b>']) assert.ok(validateUsername(bad), bad);
  assert.equal(validateUsername('tom.brooks_1'), null);
  const b = await boot();
  assert.equal((await b.req('/setup', { method: 'POST', form: { username: 'root', password: 'short' } })).status, 400);
  assert.equal((await b.req('/setup', { method: 'POST', form: { username: 'root', password: PW } })).status, 302);
  assert.match((await b.req('/admin/users', { method: 'POST', form: { username: 'ROOT', password: PW, role: 'member' } })).loc, /taken/);
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  assert.throws(() => b.db.prepare("INSERT INTO users (username, password_hash) VALUES ('Root', 'x')").run()); // the database enforces it too
  b.close();
});

// ---- F12 / F13 / F14 ----
test('F12: issue search treats input as data', async () => {
  const b = await boot(); await admin(b);
  await b.req('/s/ENG/issues', { method: 'POST', form: { title: 'Plain issue' } });
  for (const q of ["a%", "x' OR 1=1 --", "'); DROP TABLE issues; --", 'ENG-1', '\\']) { const r = await b.req(`/s/ENG/issues?q=${encodeURIComponent(q)}`); assert.equal(r.status, 200, q); }
  assert.match((await b.req('/s/ENG/issues?q=ENG-1')).text, /Plain issue/);
  assert.doesNotMatch((await b.req("/s/ENG/issues?q=x'%20OR%201%3D1%20--")).text, /Plain issue/);
  assert.ok(b.db.prepare('SELECT COUNT(*) n FROM issues').get().n === 1);
  assert.throws(() => b.db.prepare("INSERT INTO spaces (key, name) VALUES ('bad key', 'x')").run()); // keys are constrained in the schema
  b.close();
});

test('F13: cross-site requests are refused', async () => {
  const b = await boot(); await admin(b);
  for (const site of ['cross-site', 'same-site', 'none']) assert.equal((await b.req('/spaces', { method: 'POST', form: { name: 'N', key: 'NN' }, headers: { 'sec-fetch-site': site } })).status, 403, site);
  assert.equal((await b.req('/spaces', { method: 'POST', form: { name: 'N', key: 'NN' }, headers: { 'sec-fetch-site': 'same-origin' } })).status, 302);
  const pub = await boot({ publicUrl: 'https://wiki.example.com' }); await admin(pub);
  assert.equal((await pub.req('/spaces', { method: 'POST', form: { name: 'N', key: 'NN' }, headers: { origin: 'https://wiki.example.com' } })).status, 302);
  b.close(); pub.close();
});

test('F14: a failing GitHub call answers with an error page and the server keeps running', async () => {
  const gh = createGithub({ fetchFn: async () => ({ ok: true, status: 200, json: async () => null }) });
  const b = await boot({ github: gh }); await admin(b);
  b.db.prepare("UPDATE spaces SET github_repo = 'o/r' WHERE key = 'ENG'").run();
  for (const tab of ['commits', 'pulls', 'branches', 'readme']) assert.equal((await b.req(`/s/ENG/code?tab=${tab}`)).status, 502, tab);
  const id = (await b.req('/s/ENG/issues', { method: 'POST', form: { title: 'x' } })).loc.split('/')[2];
  assert.equal((await b.req(`/i/${id}/dev`)).status, 200);
  assert.equal((await b.req('/healthz')).status, 200);
  b.close();
});
