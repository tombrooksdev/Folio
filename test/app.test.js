import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createGithub } from '../src/github.js';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function boot(opts = {}) {
  const uploadDir = mkdtempSync(join(tmpdir(), 'folio-test-'));
  const server = createApp(openDb(':memory:'), { uploadDir, ...opts }).listen(0);
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const req = async (path, { method = 'GET', form, raw, headers = {} } = {}) => {
    const r = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form && { 'content-type': 'application/x-www-form-urlencoded' }), ...(raw && { 'content-type': 'application/octet-stream' }), ...headers },
      body: raw ?? (form && new URLSearchParams(form)),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, loc: r.headers.get('location'), text: await r.text(), headers: r.headers };
  };
  return { req, uploadDir, close: () => server.close() };
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

test('scrum: sprint lifecycle, drag/move, ordering, completion', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const mk = async (title, extra = {}) => (await req('/s/ENG/issues', { method: 'POST', form: { title, ...extra } })).loc.split('/')[2];
  const a = await mk('Login page', { points: '3', type: 'story' });
  const b = await mk('Fix crash', { points: '2', type: 'bug' });
  const c = await mk('Write docs', { type: 'task' });

  assert.match((await req('/s/ENG/board')).text, /No active sprint/);
  await req('/s/ENG/sprints', { method: 'POST', form: { name: 'Sprint 1', goal: 'Ship login' } });
  const sprintId = (await req('/s/ENG/backlog')).text.match(/data-sprint="(\d+)"/)[1];
  for (const id of [a, b]) await req(`/issues/${id}/move`, { method: 'POST', form: { sprint: sprintId, before: '' } });
  assert.equal((await req(`/sprints/${sprintId}/start`, { method: 'POST', form: { weeks: '2' } })).loc, '/s/ENG/board');
  assert.equal((await req(`/sprints/${sprintId}/start`, { method: 'POST', form: {} })).status, 400); // already active

  let board = (await req('/s/ENG/board')).text;
  assert.match(board, /Sprint 1/); assert.match(board, /Login page/); assert.doesNotMatch(board, /Write docs/);

  await req(`/issues/${a}/move`, { method: 'POST', form: { status: 'done', before: '' } });
  board = (await req('/s/ENG/board')).text;
  assert.match(board, /<b>3<\/b> of <b>5<\/b> points done/);

  // reorder within a column: put b before a in the done column
  await req(`/issues/${b}/move`, { method: 'POST', form: { status: 'done', before: a } });
  const done = (await req('/s/ENG/board')).text.split('data-status="done"')[1];
  assert.ok(done.indexOf('Fix crash') < done.indexOf('Login page'));

  assert.equal((await req(`/issues/${c}/move`, { method: 'POST', form: { sprint: '9999' } })).status, 400); // unknown sprint

  await req(`/i/${a}/comment`, { method: 'POST', form: { body: 'looks **good**' } });
  assert.match((await req(`/i/${a}`)).text, /<strong>good<\/strong>/);

  await req(`/sprints/${sprintId}/complete`, { method: 'POST' });
  assert.match((await req('/s/ENG/board')).text, /No active sprint/);
  assert.match((await req('/s/ENG/backlog')).text, /Write docs/);
  close();
});

test('reports: burndown, velocity and sprint history', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const mk = async (title, points) => (await req('/s/ENG/issues', { method: 'POST', form: { title, points } })).loc.split('/')[2];
  const a = await mk('One', '3'), b = await mk('Two', '5'), c = await mk('Three', '2');
  await req('/s/ENG/sprints', { method: 'POST', form: { name: 'Sprint 1' } });
  const sid = (await req('/s/ENG/backlog')).text.match(/data-sprint="(\d+)"/)[1];
  for (const id of [a, b]) await req(`/issues/${id}/move`, { method: 'POST', form: { sprint: sid, before: '' } });
  await req(`/sprints/${sid}/start`, { method: 'POST', form: { weeks: '2' } });
  await req(`/issues/${c}/move`, { method: 'POST', form: { sprint: sid, before: '' } }); // scope added mid-sprint
  await req(`/issues/${a}/move`, { method: 'POST', form: { status: 'done', before: '' } });

  assert.match((await req('/s/ENG/board')).text, /<svg class="chart"/);
  let rep = (await req(`/sprints/${sid}/report`)).text;
  assert.match(rep, /<b>8<\/b><span>Committed/);
  assert.match(rep, /<b>\+2<\/b><span>Scope change/);
  assert.match(rep, /<b>3<\/b><span>Completed/);
  assert.match(rep, /<b>7<\/b><span>Remaining/);

  await req(`/sprints/${sid}/complete`, { method: 'POST' });
  rep = (await req(`/sprints/${sid}/report`)).text;
  assert.match(rep, /Not completed \(2\)/); assert.match(rep, /Two/);
  const reports = (await req('/s/ENG/reports')).text;
  assert.match(reports, /Sprint 1/); assert.match(reports, /3\/10 pts/); assert.match(reports, /aria-label="Velocity chart"/);
  close();
});

test('issue sidebar: inline field edits update the issue and the burndown log', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const id = (await req('/s/ENG/issues', { method: 'POST', form: { title: 'Thing', points: '3' } })).loc.split('/')[2];
  assert.equal((await req(`/i/${id}/field`, { method: 'POST', form: { field: 'status', value: 'doing' } })).loc, `/i/${id}`);
  assert.equal((await req(`/i/${id}/field`, { method: 'POST', form: { field: 'points', value: '8' } })).status, 302);
  assert.equal((await req(`/i/${id}/field`, { method: 'POST', form: { field: 'priority', value: 'nope' } })).status, 400); // invalid values are rejected
  assert.equal((await req(`/i/${id}/field`, { method: 'POST', form: { field: 'bogus', value: 'x' } })).status, 400);
  const page = (await req(`/i/${id}`)).text;
  assert.match(page, /<option value="doing" selected>/);
  assert.match(page, /value="8"/);
  close();
});

test('changelog page renders from CHANGELOG.md with the package version', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  const { version } = JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url)));
  const page = (await req('/changelog')).text;
  assert.match(page, new RegExp(`Folio v${version.replaceAll('.', '\\.')}`));
  assert.match(page, new RegExp(`\\[?${version.replaceAll('.', '\\.')}\\]?`));
  assert.match(page, /Unreleased/);
  close();
});


test('epics and labels: create, assign, filter, progress', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  await req('/s/ENG/epics', { method: 'POST', form: { name: 'Onboarding' } });
  const epicId = (await req('/s/ENG/backlog')).text.match(/data-epic-pick="(\d+)"/)[1];
  const a = (await req('/s/ENG/issues', { method: 'POST', form: { title: 'Signup', points: '5', epic_id: epicId, labels: 'Frontend, urgent frontend' } })).loc.split('/')[2];
  const b = (await req('/s/ENG/issues', { method: 'POST', form: { title: 'Other', points: '3' } })).loc.split('/')[2];

  let issue = (await req(`/i/${a}`)).text;
  assert.match(issue, /Onboarding/); assert.match(issue, /value="frontend, urgent"/); // de-duplicated, lower-cased
  await req(`/i/${a}/field`, { method: 'POST', form: { field: 'status', value: 'done' } });
  const epic = (await req(`/e/${epicId}`)).text;
  assert.match(epic, /1 of 1 issues done/); assert.match(epic, /5\/5 points/);

  const byEpic = (await req(`/s/ENG/issues?epic=${epicId}`)).text;
  assert.match(byEpic, /Signup/); assert.doesNotMatch(byEpic, />Other</);
  assert.match((await req('/s/ENG/issues?label=urgent')).text, /Signup/);
  assert.doesNotMatch((await req('/s/ENG/issues?label=nope')).text, /Signup/);
  assert.match((await req('/s/ENG/issues?epic=none')).text, /Other/);
  assert.match((await req('/s/ENG/issues?q=100%25_')).text, /0 issues found/); // LIKE wildcards are escaped

  await req(`/i/${b}/field`, { method: 'POST', form: { field: 'epic_id', value: '99999' } }); // other-space/unknown epic ignored
  assert.doesNotMatch((await req(`/i/${b}`)).text, /class="epic-chip/);
  await req(`/e/${epicId}/delete`, { method: 'POST' });
  issue = (await req(`/i/${a}`)).text;
  assert.match(issue, /Signup/); assert.doesNotMatch(issue, /class="epic-chip/); // issue survives, loses the epic
  close();
});

test('attachments: upload, serve safely, adopt pasted images, delete', async () => {
  const { req, uploadDir, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = JSON.parse((await req('/attachments?space=ENG&name=shot.png', { method: 'POST', raw: png })).text);
  assert.match(up.markdown, /^!\[shot\.png\]\(\/files\/\d+\/shot\.png\)$/);
  const file = await req(up.url);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.match(file.headers.get('content-disposition'), /^inline/);

  // an HTML upload must download, never render
  const html = JSON.parse((await req('/attachments?space=ENG&name=evil.html', { method: 'POST', raw: Buffer.from('<script>alert(1)</script>') })).text);
  const served = await req(html.url);
  assert.match(served.headers.get('content-disposition'), /^attachment/);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  const svg = JSON.parse((await req('/attachments?space=ENG&name=x.svg', { method: 'POST', raw: Buffer.from('<svg/>') })).text);
  assert.match((await req(svg.url)).headers.get('content-disposition'), /^attachment/);

  // path tricks in the name are neutralised
  const sneaky = JSON.parse((await req('/attachments?space=ENG&name=' + encodeURIComponent('../../etc/passwd'), { method: 'POST', raw: png })).text);
  assert.equal(sneaky.filename, 'passwd');

  // a page created with the pasted image adopts it and lists it
  const pid = (await req('/s/ENG/pages', { method: 'POST', form: { title: 'Doc', body: `look ${up.markdown}` } })).loc.split('/')[2];
  const view = (await req(`/p/${pid}`)).text;
  assert.match(view, /Attachments <span class="count">1<\/span>/);
  assert.match(view, /<img src="\/files\/\d+\/shot\.png"/);

  assert.equal((await req('/attachments?space=NOPE&name=a.png', { method: 'POST', raw: png })).status, 404);
  assert.equal((await req('/attachments?space=ENG&name=a.png', { method: 'POST', raw: Buffer.alloc(0) })).status, 400);

  const before = readdirSync(uploadDir).length;
  await req(`/attachments/${up.id}/delete`, { method: 'POST', form: { back: `/p/${pid}` } });
  assert.equal(readdirSync(uploadDir).length, before - 1);
  assert.equal((await req(up.url)).status, 404);

  // deleting a page removes its attachments' files
  const mine = JSON.parse((await req(`/attachments?space=ENG&page=${pid}&name=doc.pdf`, { method: 'POST', raw: Buffer.from('%PDF') })).text);
  const n = readdirSync(uploadDir).length;
  await req(`/p/${pid}/delete`, { method: 'POST' });
  assert.equal(readdirSync(uploadDir).length, n - 1);
  assert.equal((await req(mine.url)).status, 404);
  close();
});

test('attachments: uploads over the size limit are refused', async () => {
  const { req, close } = await boot({ maxUploadMb: 1 });
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const res = await req('/attachments?space=ENG&name=big.bin', { method: 'POST', raw: Buffer.alloc(1048576 + 10) });
  assert.equal(res.status, 413);
  close();
});

test('page comments: thread, reply, only authors delete; pages can be moved without cycles', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const p1 = (await req('/s/ENG/pages', { method: 'POST', form: { title: 'Parent', body: 'x' } })).loc.split('/')[2];
  const p2 = (await req('/s/ENG/pages', { method: 'POST', form: { title: 'Child', body: 'y', parent_id: p1 } })).loc.split('/')[2];

  const c = await req(`/p/${p1}/comments`, { method: 'POST', form: { body: 'First **comment**' } });
  const cid = c.loc.match(/#c(\d+)/)[1];
  await req(`/p/${p1}/comments`, { method: 'POST', form: { body: 'A reply', parent_id: cid } });
  const view = (await req(`/p/${p1}`)).text;
  assert.match(view, /Comments <span class="count">2<\/span>/); assert.match(view, /<strong>comment<\/strong>/); assert.match(view, /pc reply/);
  assert.equal((await req(`/p/${p1}/comments`, { method: 'POST', form: { body: 'x', parent_id: '9999' } })).status, 400);
  await req(`/comments/${cid}/delete`, { method: 'POST' });
  assert.match((await req(`/p/${p1}`)).text, /Comments <span class="count">0<\/span>/); // replies cascade

  // move: Parent under Child would be a cycle, so the parent stays unchanged
  await req(`/p/${p1}`, { method: 'POST', form: { title: 'Parent', body: 'x', parent_id: p2 } });
  assert.match((await req(`/p/${p1}/edit`)).text, /<option value="" selected>|<option value="">Top level/);
  assert.doesNotMatch((await req(`/p/${p1}/edit`)).text, new RegExp(`<option value="${p2}"`)); // own descendants are not offered
  await req(`/p/${p2}`, { method: 'POST', form: { title: 'Child', body: 'y', parent_id: '' } }); // move to top level
  assert.doesNotMatch((await req(`/p/${p2}`)).text.match(/<nav class="crumbs"[\s\S]*?<\/nav>/)[0], /Parent/); // no longer under Parent
  close();
});

test('github: link a repo, browse tabs, key links, development panel, errors', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const json = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
    if (url.endsWith('/repos/o/r')) return json({ full_name: 'o/r', html_url: 'https://github.com/o/r', description: 'demo', default_branch: 'main', language: 'JS', stargazers_count: 3, forks_count: 1, open_issues_count: 2 });
    if (url.includes('/commits')) return json([{ sha: 'abcdef1234', html_url: 'https://github.com/o/r/commit/abcdef1', commit: { message: 'Fix login ENG-1 and <b>html</b>\n\nbody', author: { name: 'Tom', date: new Date().toISOString() } } }]);
    if (url.includes('/pulls')) return json([{ number: 7, title: 'Add signup ENG-1', state: 'open', html_url: 'https://github.com/o/r/pull/7', user: { login: 'tom' }, updated_at: new Date().toISOString(), head: { ref: 'eng-1-signup' }, body: '' }]);
    if (url.includes('/branches')) return json([{ name: 'main', protected: true, commit: { sha: 'abcdef1' } }]);
    if (url.includes('/readme')) return json({ content: Buffer.from('# Hello readme').toString('base64') });
    return json({}, 404);
  };
  const { req, close } = await boot({ github: createGithub({ fetchFn }) });
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const id = (await req('/s/ENG/issues', { method: 'POST', form: { title: 'Signup' } })).loc.split('/')[2];

  assert.match((await req('/s/ENG/code')).text, /Link a GitHub repository/);
  assert.equal((await req('/s/ENG/code/link', { method: 'POST', form: { repo: 'not a repo!' } })).status, 400);
  assert.equal((await req('/s/ENG/code/link', { method: 'POST', form: { repo: 'https://github.com/o/r.git' } })).loc, '/s/ENG/code');

  const commits = (await req('/s/ENG/code')).text;
  assert.match(commits, /o\/r/); assert.match(commits, new RegExp(`<a class="issue-link" href="/i/${id}">ENG-1</a>`));
  assert.match(commits, /&lt;b&gt;html&lt;\/b&gt;/); // commit text is escaped
  assert.match((await req('/s/ENG/code?tab=pulls')).text, /Add signup/);
  assert.match((await req('/s/ENG/code?tab=branches')).text, /protected/);
  assert.match((await req('/s/ENG/code?tab=readme')).text, /<h1>Hello readme<\/h1>/);
  assert.match((await req(`/i/${id}`)).text, /data-src="\/i\/\d+\/dev"/);
  const dev = (await req(`/i/${id}/dev`)).text;
  assert.match(dev, /#7 Add signup ENG-1/); assert.match(dev, /abcdef1/);
  assert.ok(calls.every((u) => u.startsWith('https://api.github.com/repos/o/r'))); // only ever talks to the linked repo

  await req('/s/ENG/code/unlink', { method: 'POST' });
  assert.match((await req('/s/ENG/code')).text, /Link a GitHub repository/);
  assert.equal((await req(`/i/${id}/dev`)).status, 404);
  close();
});

test('github: errors are shown, not thrown', async () => {
  const { req, close } = await boot({ github: createGithub({ fetchFn: async () => ({ ok: false, status: 403, json: async () => ({}) }) }) });
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  await req('/s/ENG/code/link', { method: 'POST', form: { repo: 'o/r' } });
  const res = await req('/s/ENG/code');
  assert.equal(res.status, 502);
  assert.match(res.text, /rate limit/i);
  close();
});

test('issues: sub-tasks, links, history, JSON create, key auto-linking, panels', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const mk = async (title, extra = {}) => (await req('/s/ENG/issues', { method: 'POST', form: { title, ...extra } })).loc.split('/')[2];
  const parent = await mk('Parent story', { points: '5' });
  const child = (await req('/s/ENG/issues', { method: 'POST', form: { title: 'Child task', parent_id: parent, back: `/i/${parent}` } })).loc;
  assert.equal(child, `/i/${parent}`);
  const kid = (await req('/s/ENG/issues?q=Child')).text.match(/href="\/i\/(\d+)"/)[1];
  let view = (await req(`/i/${parent}`)).text;
  assert.match(view, /Sub-tasks <span class="count">0\/1<\/span>/); assert.match(view, /Child task/);
  assert.match((await req(`/i/${kid}`)).text, /ENG-1<\/a>/); // breadcrumb to the parent
  // one level only: a sub-task cannot be a parent
  const grand = (await req('/s/ENG/issues', { method: 'POST', form: { title: 'Grandchild', parent_id: kid } })).loc.split('/')[2];
  assert.doesNotMatch((await req(`/i/${grand}`)).text, /Sub-task of/);

  // links, shown with the right phrase on each side
  const other = await mk('Other issue');
  assert.equal((await req(`/i/${parent}/links`, { method: 'POST', form: { type: 'blocks', key: 'ENG-4' } })).loc, `/i/${parent}`);
  assert.match((await req(`/i/${parent}`)).text, /<span class="link-phrase">blocks<\/span>/);
  assert.match((await req(`/i/${other}`)).text, /<span class="link-phrase">is blocked by<\/span>/);
  assert.equal((await req(`/i/${parent}/links`, { method: 'POST', form: { type: 'blocks', key: 'ENG-1' } })).status, 400); // self
  assert.equal((await req(`/i/${parent}/links`, { method: 'POST', form: { type: 'blocks', key: 'NOPE-9' } })).status, 400);
  const lid = (await req(`/i/${parent}`)).text.match(/\/links\/(\d+)\/delete/)[1];
  await req(`/links/${lid}/delete`, { method: 'POST', form: { back: `/i/${parent}` } });
  assert.match((await req(`/i/${parent}`)).text, /No linked issues/);

  // history
  await req(`/i/${parent}/field`, { method: 'POST', form: { field: 'status', value: 'doing' } });
  await req(`/i/${parent}/field`, { method: 'POST', form: { field: 'points', value: '8' } });
  view = (await req(`/i/${parent}`)).text;
  assert.match(view, /created the issue/);
  assert.match(view, /changed <b>Status<\/b> from <span class="ev-val">To do<\/span> to <span class="ev-val">In progress<\/span>/);
  assert.match(view, /changed <b>Story points<\/b> from <span class="ev-val">5<\/span> to <span class="ev-val">8<\/span>/);

  // JSON create for the Create dialog
  const json = await req('/s/ENG/issues', { method: 'POST', form: { title: 'From dialog', type: 'bug' }, headers: { 'X-Requested-With': 'fetch' } });
  assert.equal(json.status, 200);
  assert.match(JSON.parse(json.text).key, /^ENG-\d+$/);

  // key auto-linking and panels in Markdown
  await req(`/i/${other}`, { method: 'POST', form: { title: 'Other issue', description: 'See ENG-1 and `ENG-1` and [ENG-1](http://x)\n\n> [!WARNING]\n> Careful here\n' } });
  view = (await req(`/i/${other}`)).text;
  assert.match(view, new RegExp(`<a class="issue-link" href="/i/${parent}">ENG-1</a> and <code>ENG-1</code>`)); // not inside code
  assert.match(view, /class="panel panel-warning"><p class="panel-title">Warning<\/p><p>Careful here/);
  close();
});

test('pages: templates, labels, stars, recently viewed, version diff', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'tom', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  assert.match((await req('/s/ENG/create')).text, /Meeting notes/);
  const tpl = (await req('/s/ENG/new?template=meeting-notes')).text;
  assert.match(tpl, new RegExp(`Meeting notes ${new Date().toISOString().slice(0, 10)}`)); assert.match(tpl, /Attendees:\*\* tom/);
  assert.match((await req('/s/ENG/new?template=nope')).text, /placeholder="Page title"/); // unknown template = blank

  const id = (await req('/s/ENG/pages', { method: 'POST', form: { title: 'Runbook', body: 'line one\nline two\nline three', labels: 'Ops, runbook ops' } })).loc.split('/')[2];
  let view = (await req(`/p/${id}`)).text;
  assert.match(view, /href="\/s\/ENG\/labels\/ops"/); assert.match(view, /href="\/s\/ENG\/labels\/runbook"/);
  assert.match((await req('/s/ENG/labels/ops')).text, /Runbook/);

  await req(`/p/${id}/star`, { method: 'POST' });
  let home = (await req('/')).text;
  assert.match(home, /<h2>Starred<\/h2>/); assert.match(home, /<h2>Recently viewed<\/h2>/);
  await req(`/p/${id}/star`, { method: 'POST' });
  assert.doesNotMatch((await req('/')).text, /<h2>Starred<\/h2>/);

  await req(`/p/${id}`, { method: 'POST', form: { title: 'Runbook v2', body: 'line one\nline TWO\nline three\nline four', labels: 'ops' } });
  const vid = (await req(`/p/${id}/history`)).text.match(/history\/(\d+)/)[1];
  const diff = (await req(`/p/${id}/diff?from=${vid}&to=current`)).text;
  assert.match(diff, /<tr class="del"><td class="sign">-<\/td><td class="line">line two/);
  assert.match(diff, /<tr class="add"><td class="sign">\+<\/td><td class="line">line TWO/);
  assert.match(diff, /<tr class="add"><td class="sign">\+<\/td><td class="line">line four/);
  assert.match(diff, /<del>Runbook<\/del> <ins>Runbook v2<\/ins>/);
  assert.equal((await req(`/p/${id}/diff?from=99999`)).status, 404);
  close();
});

test('board: swimlanes and the create dialog markup', async () => {
  const { req, close } = await boot();
  await req('/setup', { method: 'POST', form: { username: 'a', password: 'longenough' } });
  await req('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const id = (await req('/s/ENG/issues', { method: 'POST', form: { title: 'Lane test', assignee_id: '1', points: '2' } })).loc.split('/')[2];
  await req('/s/ENG/sprints', { method: 'POST', form: { name: 'S1' } });
  const sid = (await req('/s/ENG/backlog')).text.match(/data-sprint="(\d+)"/)[1];
  await req(`/issues/${id}/move`, { method: 'POST', form: { sprint: sid, before: '' } });
  await req(`/sprints/${sid}/start`, { method: 'POST', form: { weeks: '1' } });
  assert.doesNotMatch((await req('/s/ENG/board')).text, /class="lane"/);
  const lanes = (await req('/s/ENG/board?group=assignee')).text;
  assert.match(lanes, /class="lane-head"[^>]*>[\s\S]*?a <span class="muted">\(1 issue\)/);
  assert.match(lanes, /class="board-head"/);
  const page = (await req('/s/ENG/board')).text;
  assert.match(page, /id="create-issue"/); assert.match(page, /data-create="issue"/); assert.match(page, /id="shortcuts"/);
  close();
});
