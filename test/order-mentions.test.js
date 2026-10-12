import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMention, rank, insertMention } from '../public/mentions.js';

// ---- @mention picker logic ----
test('finding the @word being typed', () => {
  assert.deepEqual(findMention('hi @sa', 6), { start: 3, query: 'sa' });
  assert.deepEqual(findMention('@', 1), { start: 0, query: '' });
  assert.deepEqual(findMention('ask @sam.k-1 now', 12), { start: 4, query: 'sam.k-1' });
  assert.equal(findMention('mail me at tom@example', 22), null); // an email address is not a mention
  assert.equal(findMention('hi @sam and', 11), null); // the caret is past the word
  assert.equal(findMention('a@@b', 4), null);
  assert.deepEqual(findMention('line one\n@an', 12), { start: 9, query: 'an' }); // a new line starts a fresh word
  assert.deepEqual(findMention('hi @sa and more', 6), { start: 3, query: 'sa' }); // only text before the caret counts
});
test('ranking people: prefix matches first, then contains, capped', () => {
  const names = ['sam', 'sarah', 'ann', 'Rosa', 'tom', 'Sasha', 'sal', 'sid', 'sue'];
  assert.deepEqual(rank(names, 'sa'), ['sam', 'sarah', 'Sasha', 'sal', 'Rosa']);
  assert.deepEqual(rank(names, ''), ['sam', 'sarah', 'ann', 'Rosa', 'tom', 'Sasha']); // limit of six
  assert.deepEqual(rank(names, 'SAM'), ['sam']);
  assert.deepEqual(rank(names, 'zzz'), []);
  assert.deepEqual(rank(names, 's', 2), ['sam', 'sarah']);
});
test('choosing a person replaces the word and leaves the caret after it', () => {
  const r = insertMention('hi @sa and more', 6, { start: 3, query: 'sa' }, 'sarah');
  assert.equal(r.text, 'hi @sarah  and more');
  assert.equal(r.caret, 10);
  assert.deepEqual(insertMention('@', 1, { start: 0, query: '' }, 'tom'), { text: '@tom ', caret: 5 });
});

// ---- integration ----
async function boot() {
  const db = openDb(':memory:');
  const server = createApp(db, { uploadDir: mkdtempSync(join(tmpdir(), 'folio-test-')) }).listen(0);
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, { method = 'GET', form, headers = {} } = {}) => {
      const r = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, ...(form && { 'content-type': 'application/x-www-form-urlencoded' }), ...headers }, body: form && new URLSearchParams(form) });
      const sid = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => /sid=[0-9a-f]/.test(c)).at(-1);
      if (sid) cookie = sid;
      return { status: r.status, loc: r.headers.get('location'), text: await r.text() };
    };
  };
  const admin = client();
  await admin('/setup', { method: 'POST', form: { username: 'ann', password: 'correct-horse-9' } });
  await admin('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  await admin('/spaces', { method: 'POST', form: { name: 'Ops', key: 'OPS' } });
  const join_ = async (username, role = 'member') => {
    await admin('/admin/users', { method: 'POST', form: { username, password: 'correct-horse-9', role } });
    const c = client();
    await c('/login', { method: 'POST', form: { username, password: 'correct-horse-9' } });
    return c;
  };
  const mk = async (title, extra = {}, space = 'ENG') => Number((await admin(`/s/${space}/pages`, { method: 'POST', form: { title, body: title, ...extra } })).loc.split('/')[2]);
  const order = (parent = null, space = 'ENG') => db.prepare('SELECT title, position FROM pages WHERE space_id = (SELECT id FROM spaces WHERE key = ?) AND parent_id IS ?').all(space, parent).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)).map((r) => r.title).join(',');
  const side = async (id) => [...(await admin(`/p/${id}`)).text.matchAll(/<li data-page="\d+"[^>]*>\s*(?:<button[^>]*>.*?<\/button>|<span class="twisty-gap"><\/span>)<a href="\/p\/\d+"[^>]*>([^<]+)<\/a>/gs)].map((m) => m[1]);
  return { admin, join: join_, db, mk, order, side, base, close: () => server.close() };
}

test('people.json lists usernames for the picker, for signed-in people only', async () => {
  const { admin, join, base, close } = await boot();
  await join('sam');
  assert.deepEqual(JSON.parse((await admin('/people.json')).text), ['ann', 'sam']);
  const anon = await fetch(`${base}/people.json`, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/login');
  close();
});

test('recent.json lists what you viewed, newest first, only for you', async () => {
  const { admin, join, mk, close } = await boot();
  const a = await mk('First'), b = await mk('Second');
  const sam = await join('sam');
  assert.deepEqual(JSON.parse((await admin('/recent.json')).text), []);
  await admin(`/p/${a}`); await admin(`/p/${b}`);
  const r = JSON.parse((await admin('/recent.json')).text);
  assert.deepEqual(r.map((x) => x.title), ['Second', 'First']);
  assert.equal(r[0].space, 'Eng');
  assert.deepEqual(JSON.parse((await sam('/recent.json')).text), []); // other people's history is not shown
  close();
});

test('pages stay alphabetical until someone reorders; new pages follow the rule', async () => {
  const { admin, mk, order, close } = await boot();
  const c = await mk('Cat'), a = await mk('Apple');
  await mk('Bee');
  assert.equal(order(), 'Apple,Bee,Cat');
  await mk('Aardvark');
  assert.equal(order(), 'Aardvark,Apple,Bee,Cat'); // untouched group: still alphabetical
  await admin(`/p/${c}/move`, { method: 'POST', form: { target: String(a), where: 'before' } });
  assert.equal(order(), 'Aardvark,Cat,Apple,Bee');
  await mk('Zebra'); // once ordered by hand, a new page goes to the end, not into the alphabet
  assert.equal(order(), 'Aardvark,Cat,Apple,Bee,Zebra');
  await mk('Ant');
  assert.equal(order(), 'Aardvark,Cat,Apple,Bee,Zebra,Ant');
  close();
});

test('a trashed page comes back in its place', async () => {
  const { admin, db, mk, order, close } = await boot();
  const a = await mk('A'), b = await mk('B'), c = await mk('C');
  await admin(`/p/${c}/move`, { method: 'POST', form: { target: String(a), where: 'before' } });
  assert.equal(order(), 'C,A,B');
  const del = await admin(`/p/${a}/delete`, { method: 'POST' });
  assert.equal(order(), 'C,B');
  await admin(`/trash/${del.loc.split('=')[1]}/restore`, { method: 'POST' });
  assert.equal(order(), 'C,A,B');
  assert.equal(db.prepare('SELECT position FROM pages WHERE id = ?').get(a).position, 2);
  void b;
  close();
});

test('move: before, after, inside, up and down', async () => {
  const { admin, mk, order, close } = await boot();
  const [a, b, c, d] = [await mk('A'), await mk('B'), await mk('C'), await mk('D')];
  const mv = (id, form) => admin(`/p/${id}/move`, { method: 'POST', form, headers: { 'X-Requested-With': 'fetch' } });
  assert.equal(order(), 'A,B,C,D');
  assert.deepEqual(JSON.parse((await mv(d, { target: String(a), where: 'before' })).text), { ok: true });
  assert.equal(order(), 'D,A,B,C');
  await mv(d, { target: String(c), where: 'after' });
  assert.equal(order(), 'A,B,C,D');
  await mv(a, { target: String(b), where: 'after' });
  assert.equal(order(), 'B,A,C,D');
  await mv(c, { dir: 'up' });
  assert.equal(order(), 'B,C,A,D');
  await mv(c, { dir: 'up' });
  await mv(c, { dir: 'up' }); // already first: stays
  assert.equal(order(), 'C,B,A,D');
  await mv(d, { dir: 'down' }); // already last
  assert.equal(order(), 'C,B,A,D');
  await mv(a, { target: String(c), where: 'inside' }); // becomes a child of C
  assert.equal(order(), 'C,B,D');
  assert.equal(order(c), 'A');
  await mv(b, { target: String(a), where: 'inside' }); // and B under A, so C > A > B
  assert.equal(order(a), 'B');
  // no cycles: C cannot go under its own descendants, or under itself
  assert.equal((await mv(c, { target: String(b), where: 'inside' })).status, 400);
  assert.equal((await mv(c, { target: String(b), where: 'before' })).status, 400);
  assert.equal((await mv(c, { target: String(c), where: 'before' })).status, 400);
  assert.equal(order(c), 'A');
  // dropping before a nested page re-parents next to it
  await mv(d, { target: String(b), where: 'before' });
  assert.equal(order(a), 'D,B');
  close();
});

test('move: bad input, other spaces, viewers, and the plain-form fallback', async () => {
  const { admin, join, mk, order, close } = await boot();
  const vic = await join('vic', 'viewer');
  const a = await mk('A'), b = await mk('B'), other = await mk('Other', {}, 'OPS');
  assert.equal((await admin(`/p/${a}/move`, { method: 'POST', form: { target: String(other), where: 'before' } })).status, 400);
  assert.equal((await admin(`/p/${a}/move`, { method: 'POST', form: { target: String(b), where: 'sideways' } })).status, 400);
  assert.equal((await admin(`/p/${a}/move`, { method: 'POST', form: { target: 'x', where: 'before' } })).status, 400);
  assert.equal((await admin(`/p/${a}/move`, { method: 'POST', form: {} })).status, 400);
  assert.equal((await admin('/p/9999/move', { method: 'POST', form: { dir: 'up' } })).status, 404);
  assert.equal((await vic(`/p/${a}/move`, { method: 'POST', form: { dir: 'down' } })).status, 403);
  assert.equal(order(), 'A,B');
  // without JavaScript the buttons post a form and land back on the editor
  const r = await admin(`/p/${a}/move`, { method: 'POST', form: { dir: 'down', back: `/p/${a}/edit` } });
  assert.equal(r.loc, `/p/${a}/edit`);
  assert.equal((await admin(`/p/${a}/move`, { method: 'POST', form: { dir: 'down', back: 'https://evil.example/' } })).loc, `/p/${a}`);
  assert.match((await admin(`/p/${a}/edit`)).text, /Move up/);
  close();
});

test('the sidebar tree follows the saved order, and only writers get the drag script', async () => {
  const { admin, join, mk, side, close } = await boot();
  const a = await mk('Alpha'), c = await mk('Gamma');
  await mk('Beta');
  await admin(`/p/${c}/move`, { method: 'POST', form: { target: String(a), where: 'before' } });
  assert.deepEqual(await side(a), ['Gamma', 'Alpha', 'Beta']);
  assert.match((await admin(`/p/${a}`)).text, /<script src="\/tree\.js">/);
  assert.match((await admin(`/p/${a}`)).text, /data-write="1"/);
  const vic = await join('vic', 'viewer');
  assert.doesNotMatch((await vic(`/p/${a}`)).text, /tree\.js/);
  assert.match((await vic(`/p/${a}`)).text, /mentions\.js/); // everyone gets the picker; it only helps where they can type
  close();
});

test('changing the parent in the editor puts the page at the end of its new group', async () => {
  const { admin, mk, order, close } = await boot();
  const top = await mk('Top'), x = await mk('X'), y = await mk('Y');
  await admin(`/p/${y}/move`, { method: 'POST', form: { target: String(x), where: 'before' } }); // orders the top level
  await mk('Kid1', { parent_id: String(top) });
  await mk('Kid0', { parent_id: String(top) });
  assert.equal(order(top), 'Kid0,Kid1'); // an unordered group stays alphabetical
  await admin(`/p/${x}`, { method: 'POST', form: { title: 'X', body: 'x', parent_id: String(top) } });
  assert.equal(order(top), 'Kid0,Kid1,X');
  close();
});

test('an old database gets the position column', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const file = join(mkdtempSync(join(tmpdir(), 'folio-db-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE spaces (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pages (id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL, parent_id INTEGER, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by INTEGER);
    INSERT INTO spaces (key, name) VALUES ('ENG', 'Eng'); INSERT INTO pages (space_id, title) VALUES (1, 'Old page');`);
  old.close();
  const db = openDb(file);
  assert.equal(db.prepare('SELECT position FROM pages').get().position, 0);
  openDb(file); // harmless twice
});
