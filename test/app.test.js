import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

async function boot() {
  const server = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const req = async (path, { method = 'GET', form } = {}) => {
    const r = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form && { 'content-type': 'application/x-www-form-urlencoded' }) },
      body: form && new URLSearchParams(form),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, loc: r.headers.get('location'), text: await r.text() };
  };
  return { req, close: () => server.close() };
}

test('setup, spaces, pages, history, search, sanitising', async () => {
  const { req, close } = await boot();
  assert.equal((await req('/')).loc, '/setup');
  assert.equal((await req('/setup', { method: 'POST', form: { username: 'tom', password: 'longenough' } })).loc, '/');
  assert.equal((await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'eng' } })).loc, '/s/ENG');

  const created = await req('/s/ENG/pages', { method: 'POST', form: { title: 'Runbook', body: '# Hi\n\nrestarting <script>alert(1)</script> servers' } });
  const id = created.loc.split('/')[2];
  const view = await req(`/p/${id}`);
  assert.match(view.text, /<h1>Hi<\/h1>/);
  assert.doesNotMatch(view.text, /<script>alert/);

  await req(`/p/${id}`, { method: 'POST', form: { title: 'Runbook v2', body: 'deploying databases' } });
  const hist = await req(`/p/${id}/history`);
  assert.match(hist.text, /Runbook/);
  const vid = hist.text.match(/history\/(\d+)/)[1];
  await req(`/p/${id}/restore/${vid}`, { method: 'POST' });
  assert.match((await req(`/p/${id}`)).text, /restarting/);

  assert.match((await req('/search?q=restart')).text, /Runbook/); // porter stemming
  assert.match((await req('/search?q=%22%20OR%20*')).text, /0 results|Search/); // hostile FTS input doesn't crash

  const child = await req('/s/ENG/pages', { method: 'POST', form: { title: 'Child', parent_id: id } });
  await req(`/p/${id}/delete`, { method: 'POST' });
  assert.equal((await req(child.loc)).status, 404); // cascade
  close();
});

test('login rejects bad password and logout works', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/logout', { method: 'POST' });
  assert.equal((await req('/login', { method: 'POST', form: { username: 'a', password: 'nope' } })).status, 401);
  assert.equal((await req('/login', { method: 'POST', form: { username: 'a', password: 'longenough' } })).loc, '/');
  close();
});
