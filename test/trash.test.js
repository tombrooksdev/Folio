import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function boot() {
  const uploadDir = mkdtempSync(join(tmpdir(), 'folio-test-'));
  const db = openDb(':memory:');
  const server = createApp(db, { uploadDir }).listen(0);
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, { method = 'GET', form, raw } = {}) => {
      const r = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, ...(form && { 'content-type': 'application/x-www-form-urlencoded' }), ...(raw && { 'content-type': 'application/octet-stream' }) }, body: raw ?? (form && new URLSearchParams(form)) });
      const sid = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => /sid=[0-9a-f]/.test(c)).at(-1);
      if (sid) cookie = sid;
      return { status: r.status, loc: r.headers.get('location'), text: await r.text() };
    };
  };
  const admin = client();
  await admin('/setup', { method: 'POST', form: { username: 'ann', password: 'correct-horse-9' } });
  await admin('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const join_ = async (username, role = 'member') => {
    await admin('/admin/users', { method: 'POST', form: { username, password: 'correct-horse-9', role } });
    const c = client();
    await c('/login', { method: 'POST', form: { username, password: 'correct-horse-9' } });
    return c;
  };
  return { admin, join: join_, db, uploadDir, close: () => server.close() };
}

test('a deleted page goes to the trash with its children, and Restore brings everything back', async () => {
  const { admin, db, uploadDir, close } = await boot();
  const mk = async (title, extra = {}) => (await admin('/s/ENG/pages', { method: 'POST', form: { title, body: `body of ${title}`, ...extra } })).loc.split('/')[2];
  const parent = await mk('Runbook', { labels: 'ops, urgent' });
  const child = await mk('Child', { parent_id: parent });
  await admin(`/p/${parent}`, { method: 'POST', form: { title: 'Runbook', body: 'second draft' } }); // makes a version
  await admin(`/p/${parent}/comments`, { method: 'POST', form: { body: 'looks good' } });
  const att = JSON.parse((await admin(`/attachments?space=ENG&page=${parent}&name=a.txt`, { method: 'POST', raw: 'file body' })).text);
  const stored = db.prepare('SELECT stored FROM attachments WHERE id = ?').get(att.id).stored;
  const del = await admin(`/p/${parent}/delete`, { method: 'POST' });
  assert.match(del.loc, /^\/s\/ENG\?trashed=\d+$/);
  assert.equal((await admin(`/p/${parent}`)).status, 404);
  assert.equal((await admin(`/p/${child}`)).status, 404);
  assert.equal(existsSync(join(uploadDir, stored)), true); // the file waits for a possible restore
  assert.equal((await admin('/search?q=second')).text.includes('Runbook'), false); // out of search too
  const bin = (await admin('/s/ENG/trash')).text;
  assert.match(bin, /Runbook/);
  assert.match(bin, /and 1 child page/);
  const tid = del.loc.split('=')[1];
  const back = await admin(`/trash/${tid}/restore`, { method: 'POST' });
  assert.equal(back.loc, `/p/${parent}`);
  assert.match((await admin(`/p/${parent}`)).text, /second draft/);
  assert.match((await admin(`/p/${parent}`)).text, /looks good/);
  assert.match((await admin(`/p/${parent}`)).text, /a\.txt/);
  assert.match((await admin(`/p/${child}`)).text, /body of Child/);
  assert.match((await admin(`/p/${parent}/history`)).text, /Runbook/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM page_labels WHERE page_id = ?').get(Number(parent)).n, 2);
  assert.match((await admin('/search?q=second')).text, /Runbook/); // searchable again
  assert.equal((await admin(`/trash/${tid}/restore`, { method: 'POST' })).status, 404); // gone from the bin
  assert.equal((await admin(att.url)).text, 'file body');
  close();
});

test('restoring a page whose parent was deleted puts it at the top level; a taken id is remapped', async () => {
  const { admin, db, close } = await boot();
  const mk = async (title, parent) => (await admin('/s/ENG/pages', { method: 'POST', form: { title, body: title, ...(parent && { parent_id: parent }) } })).loc.split('/')[2];
  const top = await mk('Top');
  const kid = await mk('Kid', top);
  const del = await admin(`/p/${kid}/delete`, { method: 'POST' });
  await admin(`/p/${top}/delete`, { method: 'POST' });
  const newcomer = await mk('Newcomer'); // may reuse the freed id
  await admin(`/trash/${del.loc.split('=')[1]}/restore`, { method: 'POST' });
  const row = db.prepare("SELECT id, parent_id FROM pages WHERE title = 'Kid'").get();
  assert.equal(row.parent_id, null);
  assert.ok(db.prepare("SELECT 1 FROM pages WHERE title = 'Newcomer'").get());
  assert.equal(String(row.id) === newcomer, false);
  close();
});

test('a deleted issue is restored with comments, labels, links and history; a taken number is replaced', async () => {
  const { admin, db, close } = await boot();
  const mk = async (title, extra = {}) => (await admin('/s/ENG/issues', { method: 'POST', form: { title, ...extra } })).loc.split('/')[2];
  const keep = await mk('Keeper'); // ENG-1
  const bug = await mk('Login bug', { points: '3', labels: 'auth' }); // ENG-2, the newest
  await admin(`/i/${bug}/comment`, { method: 'POST', form: { body: 'repro steps' } });
  await admin(`/i/${bug}/links`, { method: 'POST', form: { type: 'relates', key: 'ENG-1' } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM issue_links').get().n, 1);
  const del = await admin(`/i/${bug}/delete`, { method: 'POST' });
  assert.match(del.loc, /^\/s\/ENG\/backlog\?trashed=\d+$/);
  assert.equal((await admin(`/i/${bug}`)).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM issue_links').get().n, 0);
  assert.match((await admin('/s/ENG/trash')).text, /ENG-2/);
  const fresh = await mk('Newer'); // numbers are max + 1, so this is ENG-2 now
  assert.equal(db.prepare('SELECT num FROM issues WHERE id = ?').get(Number(fresh)).num, 2);
  const r = await admin(`/trash/${del.loc.split('=')[1]}/restore`, { method: 'POST' });
  assert.match(r.loc, /^\/i\/\d+\?note=/);
  assert.match(decodeURIComponent(r.loc), /came back as ENG-3/);
  const back = db.prepare("SELECT * FROM issues WHERE title = 'Login bug'").get();
  assert.equal(back.num, 3);
  assert.equal(back.points, 3);
  const page = (await admin(`/i/${back.id}`)).text;
  assert.match(page, /repro steps/);
  assert.match(page, /auth/);
  assert.match(page, /ENG-1/); // the link is back
  assert.equal(db.prepare('SELECT COUNT(*) n FROM issue_links').get().n, 1);
  void keep;
  close();
});

test('restoring an issue into a running sprint puts its points back in scope', async () => {
  const { admin, db, close } = await boot();
  const mk = async (title, extra = {}) => (await admin('/s/ENG/issues', { method: 'POST', form: { title, ...extra } })).loc.split('/')[2];
  const sprint = db.prepare('SELECT 1').get() && (await admin('/s/ENG/sprints', { method: 'POST', form: { name: 'S1' } }));
  void sprint;
  const sid = db.prepare('SELECT id FROM sprints').get()?.id;
  if (!sid) return close();
  const a = await mk('In sprint', { points: '5', sprint_id: String(sid) });
  await admin(`/sprints/${sid}/start`, { method: 'POST', form: { weeks: '2' } });
  const scope = () => db.prepare('SELECT COALESCE(SUM(scope_delta), 0) n FROM sprint_log WHERE sprint_id = ?').get(sid).n;
  const before = scope();
  const del = await admin(`/i/${a}/delete`, { method: 'POST' });
  assert.equal(scope(), before - 5);
  await admin(`/trash/${del.loc.split('=')[1]}/restore`, { method: 'POST' });
  assert.equal(scope(), before);
  close();
});

test('who can restore, delete for good and empty the trash; expiry', async () => {
  const { admin, join, db, uploadDir, close } = await boot();
  const sam = await join('sam'), vic = await join('vic', 'viewer');
  const mk = async (c, title) => (await c('/s/ENG/pages', { method: 'POST', form: { title, body: 'x' } })).loc.split('/')[2];
  const p1 = await mk(sam, 'Sam page');
  const d1 = (await sam(`/p/${p1}/delete`, { method: 'POST' })).loc.split('=')[1];
  assert.match((await vic('/s/ENG/trash')).text, /Sam page/); // anyone can look
  assert.doesNotMatch((await vic('/s/ENG/trash')).text, /Restore/); // viewers cannot act
  assert.equal((await vic(`/trash/${d1}/restore`, { method: 'POST' })).status, 403);
  const p2 = await mk(admin, 'Ann page');
  const d2 = (await admin(`/p/${p2}/delete`, { method: 'POST' })).loc.split('=')[1];
  assert.equal((await sam(`/trash/${d2}/delete`, { method: 'POST' })).status, 403); // not theirs to destroy
  assert.equal((await sam(`/s/ENG/trash/empty`, { method: 'POST' })).status, 403);
  assert.equal((await sam(`/trash/${d2}/restore`, { method: 'POST' })).status, 302); // but any member may restore
  const p3 = await mk(sam, 'Doomed');
  const att = JSON.parse((await sam(`/attachments?space=ENG&page=${p3}&name=x.txt`, { method: 'POST', raw: 'bye' })).text);
  const stored = db.prepare('SELECT stored FROM attachments WHERE id = ?').get(att.id).stored;
  const d3 = (await sam(`/p/${p3}/delete`, { method: 'POST' })).loc.split('=')[1];
  await sam(`/trash/${d3}/delete`, { method: 'POST' }); // the person who deleted it may remove it for good
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trash WHERE id = ?').get(Number(d3)).n, 0);
  assert.equal(existsSync(join(uploadDir, stored)), false); // and its file goes with it
  // expiry
  const p4 = await mk(admin, 'Old');
  const d4 = (await admin(`/p/${p4}/delete`, { method: 'POST' })).loc.split('=')[1];
  db.prepare("UPDATE trash SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(Number(d4));
  const fresh = await mk(admin, 'Recent');
  const d5 = (await admin(`/p/${fresh}/delete`, { method: 'POST' })).loc.split('=')[1];
  const { createTrash } = await import('../src/trash.js');
  createTrash({ db, files: { discard() {} } }).purgeExpired();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trash WHERE id = ?').get(Number(d4)).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trash WHERE id = ?').get(Number(d5)).n, 1);
  await admin('/s/ENG/trash/empty', { method: 'POST' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trash').get().n, 0);
  assert.equal((await admin('/s/NOPE/trash')).status, 404);
  close();
});
