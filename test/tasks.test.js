import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseQuickAdd, parseDuration, fmtDur, nextOccurrence, addMonths, addDays, mondayOf, plannedGroup, dueLabel, isDate, repeatLabel,
} from '../public/taskcore.js';

// ---- unit: dates, lengths, repeat, grouping, quick add ----
const TODAY = '2026-10-12'; // a Monday

test('lengths parse and print', () => {
  assert.equal(parseDuration('30m'), 30);
  assert.equal(parseDuration('1h30'), 90);
  assert.equal(parseDuration('2h'), 120);
  assert.equal(parseDuration('1d'), 480);
  assert.equal(parseDuration('1.5h'), 90);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('0'), null);
  assert.equal(parseDuration('7000'), null);
  assert.equal(parseDuration('soon'), null);
  assert.equal(fmtDur(195), '3h 15m');
  assert.equal(fmtDur(60), '1h');
  assert.equal(fmtDur(45), '45m');
});

test('repeat rules: weekdays skip weekends, month ends are clamped', () => {
  assert.equal(nextOccurrence('2026-10-09', 'weekdays'), '2026-10-12'); // Friday -> Monday
  assert.equal(nextOccurrence('2026-10-12', 'weekdays'), '2026-10-13');
  assert.equal(nextOccurrence('2026-10-12', 'daily'), '2026-10-13');
  assert.equal(nextOccurrence('2026-10-12', 'weekly'), '2026-10-19');
  assert.equal(nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextOccurrence('2028-01-31', 'monthly'), '2028-02-29'); // leap year
  assert.equal(nextOccurrence('2026-12-31', 'monthly'), '2027-01-31'); // across the year
  assert.equal(nextOccurrence('2028-02-29', 'yearly'), '2029-02-28');
  assert.equal(nextOccurrence('2026-10-12', 'every:3:day'), '2026-10-15');
  assert.equal(nextOccurrence('2026-10-12', 'every:2:week'), '2026-10-26');
  assert.equal(nextOccurrence('2026-11-30', 'every:3:month'), '2027-02-28');
  assert.equal(nextOccurrence('2026-10-12', 'nonsense'), null);
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(repeatLabel('every:2:week'), 'Every 2 weeks');
  assert.equal(repeatLabel('every:1:month'), 'Every month');
});

test('dates: validity, weeks, groups and labels', () => {
  assert.ok(isDate('2026-02-28'));
  assert.ok(!isDate('2026-02-30'));
  assert.ok(!isDate('26-02-28'));
  assert.equal(mondayOf('2026-10-18'), '2026-10-12'); // Sunday belongs to the week that started Monday
  assert.equal(plannedGroup('2026-10-11', TODAY), 'Overdue');
  assert.equal(plannedGroup(TODAY, TODAY), 'Today');
  assert.equal(plannedGroup('2026-10-13', TODAY), 'Tomorrow');
  assert.equal(plannedGroup('2026-10-16', TODAY), 'This week');
  assert.equal(plannedGroup('2026-10-19', TODAY), 'Later');
  assert.equal(dueLabel('2026-10-10', TODAY), 'Overdue 2d');
  assert.equal(dueLabel('2026-10-16', TODAY), 'Fri 16 Oct');
  assert.equal(dueLabel('2027-01-02', TODAY), 'Sat 2 Jan 2027');
});

const ctx = { today: TODAY, people: ['sam', 'Tom'], lists: ['Launch', 'Home chores'] };
test('quick add: the example from the spec', () => {
  const p = parseQuickAdd('Write the launch post  fri  ~1h30  @sam  !  #Launch', ctx);
  assert.equal(p.title, 'Write the launch post');
  assert.equal(p.due_on, '2026-10-16');
  assert.equal(p.estimate_min, 90);
  assert.equal(p.assignee, 'sam');
  assert.equal(p.important, true);
  assert.equal(p.list, 'Launch');
  assert.equal(p.tokens.length, 5);
});

test('quick add: every date form', () => {
  const due = (t) => parseQuickAdd(t, ctx).due_on;
  assert.equal(due('x today'), TODAY);
  assert.equal(due('x tomorrow'), '2026-10-13');
  assert.equal(due('x mon'), '2026-10-19'); // today is Monday: the next one, not today
  assert.equal(due('x wed'), '2026-10-14');
  assert.equal(due('x next week'), '2026-10-19');
  assert.equal(due('x 12 oct'), TODAY);
  assert.equal(due('x 3 jan'), '2027-01-03'); // already past this year: next year
  assert.equal(due('x oct 20'), '2026-10-20');
  assert.equal(due('x +3d'), '2026-10-15');
  assert.equal(due('x +2w'), '2026-10-26');
  assert.equal(due('x +1m'), '2026-11-12');
  assert.equal(due('x 31 feb'), null);
  assert.equal(due('no date here'), null);
});

test('quick add: edge cases leave ordinary words alone', () => {
  assert.equal(parseQuickAdd('Email @nobody about it', ctx).title, 'Email @nobody about it'); // unknown person stays in the title
  assert.equal(parseQuickAdd('Fix #bug', ctx).title, 'Fix #bug'); // unknown list stays
  assert.equal(parseQuickAdd('Wow!', ctx).important, false); // only a lone ! counts
  assert.equal(parseQuickAdd('Buy milk ~soon', ctx).estimate_min, null);
  assert.equal(parseQuickAdd('Buy milk ~soon', ctx).title, 'Buy milk ~soon');
  assert.equal(parseQuickAdd('a * b', ctx).my_day, true);
  assert.equal(parseQuickAdd('Clean #home-chores', ctx).list, 'Home chores'); // spaces in list names become dashes
  assert.equal(parseQuickAdd('@SAM check', ctx).assignee, 'sam'); // case-insensitive, canonical name
  assert.equal(parseQuickAdd('   ', ctx).title, '');
  assert.equal(parseQuickAdd('tomorrow', ctx).title, ''); // all tokens: the server rejects an empty title
  const two = parseQuickAdd('a fri sat', ctx);
  assert.equal(two.due_on, '2026-10-16'); // first date wins
  assert.equal(two.title, 'a sat'); // the second stays as text
  assert.equal(parseQuickAdd('x ~2h ~3h', ctx).estimate_min, 120);
});

// ---- integration ----
async function boot() {
  const uploadDir = mkdtempSync(join(tmpdir(), 'folio-test-'));
  const db = openDb(':memory:');
  const app = createApp(db, { uploadDir });
  const server = app.listen(0);
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, { method = 'GET', form, headers = {} } = {}) => {
      const r = await fetch(base + path, { method, redirect: 'manual', headers: { ...(form && { 'content-type': 'application/x-www-form-urlencoded' }), ...headers, cookie: [cookie, headers.cookie].filter(Boolean).join('; ') }, body: form && new URLSearchParams(form) });
      const sid = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => /sid=[0-9a-f]/.test(c)).at(-1);
      if (sid) cookie = sid;
      return { status: r.status, loc: r.headers.get('location'), text: await r.text(), headers: r.headers };
    };
  };
  const admin = client();
  await admin('/setup', { method: 'POST', form: { username: 'ann', password: 'correct-horse-9' } });
  const join_ = async (username, role = 'member') => {
    await admin('/admin/users', { method: 'POST', form: { username, password: 'correct-horse-9', role } });
    const c = client();
    await c('/login', { method: 'POST', form: { username, password: 'correct-horse-9' } });
    return c;
  };
  const id = (name) => db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  return { admin, join: join_, db, tick: (d) => app.locals.tasksTick(d), id, close: () => server.close() };
}
const today = () => new Date().toISOString().slice(0, 10);
const taskId = (db, title) => db.prepare('SELECT id FROM tasks WHERE title = ?').get(title)?.id;
const add = (c, title, extra = {}) => c('/tasks', { method: 'POST', form: { title, ...extra } });

test('add a task with a date and a length in one line; it shows in Planned and My Day with totals', async () => {
  const { admin, db, close } = await boot();
  await add(admin, `Plan sprint tomorrow ~1h30 *`);
  await add(admin, 'Review notes today ~45m *');
  const t = db.prepare('SELECT * FROM tasks WHERE title = ?').get('Plan sprint');
  assert.equal(t.estimate_min, 90);
  assert.equal(t.due_on, addDays(today(), 1));
  const day = (await admin('/tasks/my-day')).text;
  assert.match(day, /Plan sprint/);
  assert.match(day, /2h 15m planned/);
  const planned = (await admin('/tasks/planned')).text;
  assert.match(planned, /Tomorrow/);
  assert.match(planned, /Today/);
  assert.equal((await add(admin, 'tomorrow')).loc.includes('err='), true); // no title left
  close();
});

test('My Day starts empty each day and offers overdue and due-soon tasks as suggestions', async () => {
  const { admin, db, close } = await boot();
  await add(admin, 'Late thing');
  db.prepare("UPDATE tasks SET due_on = ? WHERE title = 'Late thing'").run(addDays(today(), -2));
  await add(admin, 'Soon thing +2d');
  await add(admin, 'Far thing +20d');
  await add(admin, 'Chosen *');
  const html = (await admin('/tasks/my-day')).text;
  assert.match(html, /Chosen/);
  const sugg = html.slice(html.indexOf('t-suggest'));
  assert.match(sugg, /Late thing/);
  assert.match(sugg, /Soon thing/);
  assert.doesNotMatch(sugg, /Far thing/);
  assert.match(sugg, /Overdue 2d/);
  // adding a suggestion moves it into the day
  const lid = taskId(db, 'Late thing');
  await admin(`/tasks/${lid}/my-day`, { method: 'POST', form: { on: '1' } });
  assert.doesNotMatch((await admin('/tasks/my-day')).text.slice((await admin('/tasks/my-day')).text.indexOf('t-suggest')), /Late thing/);
  // yesterday's day is not today's
  db.prepare("UPDATE task_my_day SET day = ?").run(addDays(today(), -1));
  assert.doesNotMatch((await admin('/tasks/my-day')).text.split('t-suggest')[0], /Chosen/);
  close();
});

test('Important, Planned groups with overdue, Completed and search', async () => {
  const { admin, db, close } = await boot();
  await add(admin, 'Starred !');
  await add(admin, 'Plain');
  await add(admin, 'Overdue one');
  db.prepare("UPDATE tasks SET due_on = ? WHERE title = 'Overdue one'").run(addDays(today(), -3));
  assert.match((await admin('/tasks/important')).text, /Starred/);
  assert.doesNotMatch((await admin('/tasks/important')).text, />Plain</);
  const planned = (await admin('/tasks/planned')).text;
  assert.match(planned, /Overdue/);
  assert.match(planned, /Overdue 3d/);
  const sid = taskId(db, 'Starred');
  await admin(`/tasks/${sid}/complete`, { method: 'POST', form: { done: '1' } });
  assert.match((await admin('/tasks/completed')).text, /Starred/);
  assert.match((await admin('/tasks/completed?q=star')).text, /Starred/);
  assert.doesNotMatch((await admin('/tasks/completed?q=zzz')).text, /Starred/);
  assert.match((await admin('/tasks/completed?q=%25')).text, /No completed task matches/); // LIKE wildcards are literal
  await admin(`/tasks/${sid}/complete`, { method: 'POST', form: { done: '0' } }); // reopen
  assert.equal(db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(sid).completed_at, null);
  close();
});

test('lists: create, view, move task, reorder, delete', async () => {
  const { admin, db, close } = await boot();
  assert.equal((await admin('/tasks/my-day')).status, 200); // creates the default list
  const made = await admin('/tasks/lists', { method: 'POST', form: { name: 'Launch' } });
  assert.match(made.loc, /^\/tasks\/lists\/\d+$/);
  const lid = Number(made.loc.split('/').pop());
  await add(admin, 'In launch', { list_id: lid });
  await add(admin, 'Also launch #launch');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE list_id = ?').get(lid).n, 2);
  const page = (await admin(made.loc)).text;
  assert.match(page, /In launch/);
  assert.match(page, /Also launch/);
  const other = await admin('/tasks/lists', { method: 'POST', form: { name: 'Docs' } });
  const did = Number(other.loc.split('/').pop());
  const tid = taskId(db, 'In launch');
  await admin(`/tasks/${tid}`, { method: 'POST', form: { list_id: String(did) } });
  assert.equal(db.prepare('SELECT list_id FROM tasks WHERE id = ?').get(tid).list_id, did);
  await admin(`/tasks/lists/${did}`, { method: 'POST', form: { move: 'up' } });
  const order = db.prepare('SELECT name FROM task_lists ORDER BY position, id').all().map((r) => r.name);
  assert.deepEqual(order, ['Tasks', 'Docs', 'Launch']);
  await admin(`/tasks/lists/${lid}`, { method: 'POST', form: { name: 'Launch v2', hue: '5', visibility: 'private', group_name: 'Work' } });
  assert.equal(db.prepare('SELECT hue, group_name FROM task_lists WHERE id = ?').get(lid).group_name, 'Work');
  assert.match((await admin('/tasks/all')).text, /Launch v2/);
  await admin(`/tasks/lists/${lid}`, { method: 'POST', form: { action: 'delete' } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE title = ?').get('Also launch').n, 0); // cascade
  close();
});

test('steps and the detail pane', async () => {
  const { admin, db, close } = await boot();
  await add(admin, 'Big job');
  const id = taskId(db, 'Big job');
  await admin(`/tasks/${id}/steps`, { method: 'POST', form: { title: 'Outline' } });
  await admin(`/tasks/${id}/steps`, { method: 'POST', form: { title: 'Draft' } });
  const [s1] = db.prepare('SELECT id FROM task_steps WHERE task_id = ? ORDER BY id').all(id);
  await admin(`/tasks/${id}/steps/${s1.id}`, { method: 'POST', form: { op: 'toggle' } });
  const pane = (await admin(`/tasks/all?t=${id}`)).text;
  assert.match(pane, /id="t-pane"/);
  assert.match(pane, /1 of 2/);
  assert.match((await admin('/tasks/all')).text, /1 of 2/); // progress on the row
  await admin(`/tasks/${id}/steps/${s1.id}`, { method: 'POST', form: { op: 'delete' } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_steps WHERE task_id = ?').get(id).n, 1);
  // the cap
  for (let i = 0; i < 60; i++) await admin(`/tasks/${id}/steps`, { method: 'POST', form: { title: `s${i}` } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_steps WHERE task_id = ?').get(id).n, 50);
  close();
});

test('updating fields, validation, notes and links', async () => {
  const { admin, db, close } = await boot();
  await admin('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const issue = (await admin('/s/ENG/issues', { method: 'POST', form: { title: 'Fix login' } })).loc.split('/')[2];
  await add(admin, 'Thing');
  const id = taskId(db, 'Thing');
  const upd = (form) => admin(`/tasks/${id}`, { method: 'POST', form });
  const row = () => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  await upd({ due_on: '2026-12-25', estimate: '120', repeat: 'weekly', notes: 'See ENG-1 please' });
  assert.equal(row().due_on, '2026-12-25');
  assert.equal(row().estimate_min, 120);
  assert.equal(row().repeat_rule, 'weekly');
  await upd({ estimate: 'custom', estimate_custom: '1h30' });
  assert.equal(row().estimate_min, 90);
  await upd({ repeat: 'custom', repeat_n: '3', repeat_unit: 'month' });
  assert.equal(row().repeat_rule, 'every:3:month');
  assert.match((await upd({ due_on: '2026-02-30' })).loc, /err=/);
  assert.equal(row().due_on, '2026-12-25'); // unchanged
  assert.match((await upd({ repeat: 'hourly' })).loc, /err=/);
  assert.match((await upd({ estimate: 'custom', estimate_custom: 'forever' })).loc, /err=/);
  await upd({ due_quick: 'tomorrow' });
  assert.equal(row().due_on, addDays(today(), 1));
  await upd({ due_quick: 'clear' });
  assert.equal(row().due_on, null);
  assert.match((await upd({ title: '   ' })).loc, /err=/);
  assert.equal(row().title, 'Thing');
  await upd({ link: 'ENG-1' });
  assert.equal(row().link_issue_id, Number(issue));
  assert.match((await admin(`/tasks/all?t=${id}`)).text, /Fix login/);
  assert.match((await upd({ link: 'NOPE-9' })).loc, /err=/);
  await upd({ link: '/p/999' });
  assert.match((await upd({ link: '/p/999' })).loc, /err=/);
  await upd({ link: '' });
  assert.equal(row().link_issue_id, null);
  // limits
  await upd({ title: 'x'.repeat(500) });
  assert.equal(row().title.length, 200);
  await upd({ notes: 'n'.repeat(30000) });
  assert.equal(row().notes.length, 20000);
  // notes are sanitised when shown
  await upd({ notes: '<script>alert(1)</script> **bold**' });
  assert.doesNotMatch((await admin(`/tasks/all?t=${id}`)).text, /<script>alert/);
  await admin(`/tasks/${id}/delete`, { method: 'POST' });
  assert.equal(row(), undefined);
  close();
});

test('completing a repeating task creates the next one on the right date', async () => {
  const { admin, db, close } = await boot();
  const mk = async (title, due, rule) => { await add(admin, title); const id = taskId(db, title); db.prepare('UPDATE tasks SET due_on = ?, repeat_rule = ? WHERE id = ?').run(due, rule, id); return id; };
  const t = today();
  // due in the future: next is counted from the due date
  const future = await mk('Weekly review', addDays(t, 3), 'weekly');
  db.prepare('INSERT INTO task_steps (task_id, title, done) VALUES (?, ?, 1)').run(future, 'Check');
  await admin(`/tasks/${future}/complete`, { method: 'POST', form: { done: '1' } });
  const next = db.prepare("SELECT * FROM tasks WHERE title = 'Weekly review' AND completed_at IS NULL").get();
  assert.equal(next.due_on, addDays(t, 10));
  assert.equal(db.prepare('SELECT done FROM task_steps WHERE task_id = ?').get(next.id).done, 0); // steps start unticked
  // overdue: next is counted from today, so it is not overdue again
  const late = await mk('Daily stretch', addDays(t, -5), 'daily');
  await admin(`/tasks/${late}/complete`, { method: 'POST', form: { done: '1' } });
  assert.equal(db.prepare("SELECT due_on FROM tasks WHERE title = 'Daily stretch' AND completed_at IS NULL").get().due_on, addDays(t, 1));
  // reopening does not create another
  await admin(`/tasks/${late}/complete`, { method: 'POST', form: { done: '0' } });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE title = 'Daily stretch'").get().n, 2);
  // completing twice in a row is a no-op
  const once = await mk('Once', addDays(t, 1), 'daily');
  await admin(`/tasks/${once}/complete`, { method: 'POST', form: { done: '1' } });
  await admin(`/tasks/${once}/complete`, { method: 'POST', form: { done: '1' } });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE title = 'Once'").get().n, 2);
  close();
});

test('assigning: Assigned to me, notification, My Day is personal, assigner is told when it is done', async () => {
  const { admin, join, db, id, close } = await boot();
  const sam = await join('sam');
  await add(admin, 'Review the page @sam ~30m +1d');
  const t = db.prepare('SELECT * FROM tasks WHERE title = ?').get('Review the page');
  assert.equal(t.assignee_id, id('sam'));
  assert.match((await sam('/tasks/assigned')).text, /Review the page/);
  assert.match((await sam('/tasks/assigned')).text, /From @ann/);
  assert.match((await sam('/tasks/planned')).text, /Review the page/); // it is on his plan
  assert.doesNotMatch((await admin('/tasks/planned')).text, /Review the page/); // and not on the assigner's
  const note = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND kind = 'task_assigned'").get(id('sam'));
  assert.match(note.text, /ann assigned you the task "Review the page"/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ?").get(id('ann')).n, 0); // you are not told about your own action
  // the assignee can see the task even though it lives in the assigner's private list, but cannot edit it
  assert.equal((await sam(`/tasks/all?t=${t.id}`)).text.includes('id="t-pane"'), true);
  await sam(`/tasks/${t.id}`, { method: 'POST', form: { title: 'Hijack', important: '1', assignee: '' } }); // fields only editors may change are ignored
  assert.deepEqual({ ...db.prepare('SELECT title, important, assignee_id FROM tasks WHERE id = ?').get(t.id) }, { title: 'Review the page', important: 0, assignee_id: id('sam') });
  // his My Day does not change hers
  await sam(`/tasks/${t.id}/my-day`, { method: 'POST', form: { on: '1' } });
  assert.match((await sam('/tasks/my-day')).text, /Review the page/);
  assert.doesNotMatch((await admin('/tasks/my-day')).text.split('t-suggest')[0], /Review the page/);
  // finishing it tells the assigner, and she can see who did it
  await sam(`/tasks/${t.id}/complete`, { method: 'POST', form: { done: '1' } });
  const done = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND kind = 'task_done'").get(id('ann'));
  assert.match(done.text, /sam completed the task "Review the page"/);
  assert.match((await admin('/tasks/completed')).text, /done by @sam/);
  // reassigning notifies the new person; notifications honour preferences
  await sam('/settings/notifications', { method: 'POST', form: {} }); // everything off
  await admin(`/tasks/${t.id}`, { method: 'POST', form: { assignee: String(id('sam')) } });
  await admin(`/tasks/${t.id}`, { method: 'POST', form: { assignee: String(id('ann')) } });
  await admin(`/tasks/${t.id}`, { method: 'POST', form: { assignee: String(id('sam')) } });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind = 'task_assigned'").get(id('sam')).n, 1);
  close();
});

test('private lists are invisible to everyone else, including administrators', async () => {
  const { admin, join, db, id, close } = await boot();
  const sam = await join('sam');
  await sam('/tasks/my-day');
  await add(sam, 'Secret plan');
  const lid = db.prepare('SELECT list_id FROM tasks WHERE title = ?').get('Secret plan').list_id;
  const tid = taskId(db, 'Secret plan');
  assert.equal(db.prepare('SELECT owner_id FROM task_lists WHERE id = ?').get(lid).owner_id, id('sam'));
  assert.equal((await admin(`/tasks/lists/${lid}?t=${tid}`)).status, 404);
  assert.equal((await admin(`/tasks/lists/${lid}`)).status, 404);
  assert.doesNotMatch((await admin(`/tasks/all?t=${tid}`)).text, /Secret plan/); // the pane never opens
  assert.doesNotMatch((await admin('/tasks/all')).text, /Secret plan/);
  assert.doesNotMatch((await admin('/tasks/export.ics')).text, /Secret plan/);
  // every write on someone else's private data is a 404, not a 403
  for (const [path, form] of [[`/tasks/${tid}`, { title: 'x' }], [`/tasks/${tid}/complete`, {}], [`/tasks/${tid}/delete`, {}], [`/tasks/${tid}/steps`, { title: 'x' }], [`/tasks/${tid}/my-day`, {}], [`/tasks/${tid}/schedule`, { clear: '1' }]])
    assert.equal((await admin(path, { method: 'POST', form })).status, 404, path);
  assert.equal((await admin(`/tasks/lists/${lid}`, { method: 'POST', form: { name: 'mine now' } })).status, 404);
  assert.equal((await admin(`/tasks/lists/${lid}/share`, { method: 'POST', form: { op: 'add', user_id: String(id('ann')) } })).status, 404);
  assert.equal((await admin(`/tasks/lists/${lid}`, { method: 'POST', form: { action: 'delete' } })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE title = ?').get('Secret plan').n, 1);
  // nor can you drop a task into someone else's list or assign into it by id
  await admin('/tasks/my-day');
  await add(admin, 'Sneaky', { list_id: String(lid) });
  assert.notEqual(db.prepare('SELECT list_id FROM tasks WHERE title = ?').get('Sneaky').list_id, lid);
  await admin(`/tasks/${taskId(db, 'Sneaky')}`, { method: 'POST', form: { list_id: String(lid) } });
  assert.notEqual(db.prepare('SELECT list_id FROM tasks WHERE title = ?').get('Sneaky').list_id, lid);
  close();
});

test('shared and team lists: members, edit rights, viewers read only', async () => {
  const { admin, join, db, id, close } = await boot();
  const sam = await join('sam'), kim = await join('kim'), vic = await join('vic', 'viewer');
  const made = await admin('/tasks/lists', { method: 'POST', form: { name: 'Launch' } });
  const lid = Number(made.loc.split('/').pop());
  await add(admin, 'Ship it', { list_id: String(lid) });
  const tid = taskId(db, 'Ship it');
  assert.equal((await sam(made.loc)).status, 404); // private until shared
  await admin(`/tasks/lists/${lid}/share`, { method: 'POST', form: { op: 'add', user_id: String(id('sam')), can_edit: '1' } });
  await admin(`/tasks/lists/${lid}/share`, { method: 'POST', form: { op: 'add', user_id: String(id('kim')), can_edit: '0' } });
  assert.equal(db.prepare('SELECT visibility FROM task_lists WHERE id = ?').get(lid).visibility, 'shared');
  assert.match((await sam(made.loc)).text, /Ship it/);
  assert.match((await sam('/tasks/my-day')).text, /Launch/); // it appears in his sidebar
  assert.equal((await vic(made.loc)).status, 404); // not named
  // editor can change things and add tasks; view-only member cannot
  await add(sam, 'Sam adds', { list_id: String(lid) });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE title = ?').get('Sam adds').n, 1);
  await sam(`/tasks/${tid}`, { method: 'POST', form: { title: 'Ship it now' } });
  assert.equal(db.prepare('SELECT title FROM tasks WHERE id = ?').get(tid).title, 'Ship it now');
  assert.equal((await kim(`/tasks/${tid}`, { method: 'POST', form: { title: 'Nope' } })).status, 403);
  assert.equal((await kim(`/tasks/${tid}/complete`, { method: 'POST', form: { done: '1' } })).status, 403);
  await add(kim, 'Kim adds', { list_id: String(lid) });
  assert.notEqual(db.prepare('SELECT list_id FROM tasks WHERE title = ?').get('Kim adds').list_id, lid); // it went to her own default list instead
  assert.match((await kim(made.loc)).text, /Ship it now/);
  assert.equal((await sam(`/tasks/lists/${lid}`, { method: 'POST', form: { name: 'Mine' } })).status, 403); // only the owner manages the list
  // un-sharing removes access
  await admin(`/tasks/lists/${lid}/share`, { method: 'POST', form: { op: 'remove', user_id: String(id('sam')) } });
  assert.equal((await sam(made.loc)).status, 404);
  // team list: everyone sees it, viewers cannot change it
  await admin(`/tasks/lists/${lid}`, { method: 'POST', form: { name: 'Launch', visibility: 'team' } });
  assert.match((await vic(made.loc)).text, /Ship it now/);
  assert.doesNotMatch((await vic(made.loc)).text, /id="quick-form"/);
  assert.equal((await vic('/tasks', { method: 'POST', form: { title: 'x' } })).status, 403);
  assert.equal((await vic(`/tasks/${tid}/complete`, { method: 'POST', form: { done: '1' } })).status, 403);
  assert.equal((await vic(`/tasks/${tid}`, { method: 'POST', form: { title: 'x' } })).status, 403);
  assert.equal((await vic('/tasks/lists', { method: 'POST', form: { name: 'x' } })).status, 403);
  assert.equal((await vic(`/tasks/${tid}/my-day`, { method: 'POST', form: {} })).status, 403);
  // a member can work in a team list
  await sam(`/tasks/${tid}`, { method: 'POST', form: { title: 'Team edit' } });
  assert.equal(db.prepare('SELECT title FROM tasks WHERE id = ?').get(tid).title, 'Team edit');
  // viewers get no list created behind their back
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_lists WHERE owner_id = ?').get(id('vic')).n, 0);
  close();
});

test('a task assigned from a private list is copied into Assigned to me; the list stays private', async () => {
  const { admin, join, db, close } = await boot();
  const sam = await join('sam');
  await add(admin, 'Pass this on @sam');
  const lid = db.prepare('SELECT list_id FROM tasks WHERE title = ?').get('Pass this on').list_id;
  assert.match((await sam('/tasks/assigned')).text, /Pass this on/);
  assert.equal((await sam(`/tasks/lists/${lid}`)).status, 404);
  assert.match((await sam('/tasks/all')).text, /Pass this on/); // visible to him as the assignee
  close();
});

test('a viewer can open Tasks but nothing is created for them', async () => {
  const { join, close, db } = await boot();
  const vic = await join('vic', 'viewer');
  assert.equal((await vic('/tasks/my-day')).status, 200);
  assert.match((await vic('/tasks/my-day')).text, /My Day/);
  assert.equal((await vic('/tasks/lists/999')).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_lists').get().n, 0);
  close();
});

test('signed-out visitors and cross-site posts are turned away', async () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'folio-test-'));
  const db = openDb(':memory:');
  const server = createApp(db, { uploadDir }).listen(0);
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  await fetch(`${base}/setup`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=ann&password=correct-horse-9', redirect: 'manual' });
  const r = await fetch(`${base}/tasks/my-day`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
  const x = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' }, body: 'title=x', redirect: 'manual' });
  assert.equal(x.status, 403);
  server.close();
});

test('the return address can only point back into Tasks', async () => {
  const { admin, close } = await boot();
  for (const bad of ['https://evil.example/', '//evil.example', '/login', '/tasks/..\\evil', 'javascript:alert(1)']) {
    const r = await add(admin, 'Redirect probe', { return: bad });
    assert.match(r.loc, /^\/tasks(\/|\?|$)/, bad);
    assert.ok(!r.loc.includes('\\'), bad);
  }
  assert.equal((await add(admin, 'Good return', { return: '/tasks/planned?x=1' })).loc, '/tasks/planned?x=1');
  close();
});

test('caps: tasks per list, lists per person, and titles', async () => {
  const { admin, db, close } = await boot();
  await admin('/tasks/my-day');
  const lid = db.prepare('SELECT id FROM task_lists').get().id;
  const ins = db.prepare('INSERT INTO tasks (list_id, title) VALUES (?, ?)');
  for (let i = 0; i < 2000; i++) ins.run(lid, `t${i}`);
  assert.match((await add(admin, 'One too many')).loc, /err=/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE title = 'One too many'").get().n, 0);
  await add(admin, 'y'.repeat(1000)); // the quick-add box is capped
  assert.ok(db.prepare("SELECT MAX(LENGTH(title)) m FROM tasks WHERE title LIKE 'yyy%'").get().m <= 200);
  const mk = db.prepare("INSERT INTO task_lists (owner_id, name) VALUES (1, 'l')");
  while (db.prepare('SELECT COUNT(*) n FROM task_lists').get().n < 100) mk.run();
  assert.equal((await admin('/tasks/lists', { method: 'POST', form: { name: 'one more' } })).status, 400);
  assert.equal((await admin('/tasks/lists', { method: 'POST', form: { name: '' } })).status, 400);
  close();
});

test('reminders are sent once, survive a restart, skip finished tasks and honour settings', async () => {
  const { admin, join, db, tick, id, close } = await boot();
  const sam = await join('sam');
  await add(admin, 'Call the printer');
  const tid = taskId(db, 'Call the printer');
  const when = new Date(Date.now() + 3600e3);
  // browsers send the local time; with no time-zone cookie the server reads it as UTC
  await admin(`/tasks/${tid}`, { method: 'POST', form: { remind: when.toISOString().slice(0, 16) } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_reminders').get().n, 1);
  assert.match((await admin(`/tasks/all?t=${tid}`)).text, new RegExp(`value="${when.toISOString().slice(0, 16)}"`));
  tick(new Date()); // not due yet
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'task_reminder'").get().n, 0);
  const later = new Date(Date.now() + 2 * 3600e3);
  tick(later);
  tick(later); // a second timer, or a restart, must not send it again
  tick(new Date(later.getTime() + 60e3));
  const sent = db.prepare("SELECT * FROM notifications WHERE kind = 'task_reminder'").all();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].user_id, id('ann'));
  assert.match(sent[0].text, /Call the printer/);
  assert.ok(db.prepare('SELECT sent_at FROM task_reminders').get().sent_at);
  // resetting the time arms it again
  await admin(`/tasks/${tid}`, { method: 'POST', form: { remind: new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16) } });
  assert.equal(db.prepare('SELECT sent_at FROM task_reminders').get().sent_at, null);
  // finished tasks do not nag
  await admin(`/tasks/${tid}/complete`, { method: 'POST', form: { done: '1' } });
  tick(new Date(Date.now() + 9 * 3600e3));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'task_reminder'").get().n, 1);
  // reminders are personal: an assignee sets their own without touching hers
  await add(admin, 'Shared job @sam');
  const jid = taskId(db, 'Shared job');
  await sam(`/tasks/${jid}`, { method: 'POST', form: { remind: new Date(Date.now() + 3600e3).toISOString().slice(0, 16) } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_reminders WHERE task_id = ?').get(jid).n, 1);
  assert.equal(db.prepare('SELECT user_id FROM task_reminders WHERE task_id = ?').get(jid).user_id, id('sam'));
  // switched off in settings: nothing is delivered
  await sam('/settings/notifications', { method: 'POST', form: {} });
  tick(new Date(Date.now() + 3 * 3600e3));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'task_reminder' AND user_id = ?").get(id('sam')).n, 0);
  // a bad time is refused
  assert.match((await admin(`/tasks/${jid}`, { method: 'POST', form: { remind: 'tomorrow-ish' } })).loc, /err=/);
  close();
});

test('reminders respect the browser time zone', async () => {
  const { admin, db, close } = await boot();
  await add(admin, 'Zoned');
  const tid = taskId(db, 'Zoned');
  // UTC+2 -> the browser offset is -120; 09:00 local is 07:00 UTC
  await admin(`/tasks/${tid}`, { method: 'POST', form: { remind: '2030-01-01T09:00' }, headers: { cookie: 'tz=-120' } });
  assert.equal(db.prepare('SELECT remind_at FROM task_reminders').get().remind_at, '2030-01-01 07:00:00');
  close();
});

test('the morning digest runs once a day, after 08:00 local, and only when something is due', async () => {
  const { admin, db, tick, id, close } = await boot();
  await add(admin, 'Due now today');
  await add(admin, 'Past due');
  const day = today();
  db.prepare("UPDATE tasks SET due_on = ? WHERE title = 'Due now today'").run(day);
  db.prepare("UPDATE tasks SET due_on = ? WHERE title = 'Past due'").run(addDays(day, -2));
  tick(new Date(`${day}T07:30:00Z`)); // too early
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'task_due'").get().n, 0);
  tick(new Date(`${day}T08:05:00Z`));
  tick(new Date(`${day}T09:00:00Z`)); // not again the same day
  const d = db.prepare("SELECT * FROM notifications WHERE kind = 'task_due'").all();
  assert.equal(d.length, 1);
  assert.equal(d[0].user_id, id('ann'));
  assert.match(d[0].text, /1 due today, 1 overdue/);
  tick(new Date(`${addDays(day, 1)}T08:05:00Z`)); // the next day it runs again
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'task_due'").get().n, 2);
  // quiet days send nothing
  db.prepare('DELETE FROM tasks').run();
  tick(new Date(`${addDays(day, 2)}T08:05:00Z`));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'task_due'").get().n, 2);
  close();
});

test('day totals warn when a day is over your capacity, and capacity is per person', async () => {
  const { admin, close } = await boot();
  await add(admin, 'Big one today ~5h');
  await add(admin, 'Another today ~2h');
  const planned = (await admin('/tasks/planned')).text;
  assert.match(planned, /Over budget/);
  assert.match(planned, /7h planned/);
  assert.match((await admin('/tasks/week')).text, /Over budget/);
  await admin('/account/capacity', { method: 'POST', form: { hours: '8' } });
  assert.doesNotMatch((await admin('/tasks/planned')).text, /Over budget:/);
  assert.match((await admin('/account')).text, /Daily task capacity/);
  assert.match((await admin('/account/capacity', { method: 'POST', form: { hours: '99' } })).loc, /err=/);
  close();
});

test('week planner: schedule, unschedule, drag fallbacks and the .ics export', async () => {
  const { admin, db, close } = await boot();
  await add(admin, 'Deep work today ~2h');
  const tid = taskId(db, 'Deep work');
  const t = today();
  assert.match((await admin('/tasks/week')).text, /Unscheduled/);
  assert.match((await admin('/tasks/week')).text, /Deep work/);
  const r = await admin(`/tasks/${tid}/schedule`, { method: 'POST', form: { day: t, time: '10:30', return: '/tasks/week' } });
  assert.equal(r.loc, '/tasks/week');
  assert.equal(db.prepare('SELECT start_at FROM tasks WHERE id = ?').get(tid).start_at, `${t} 10:30:00`);
  const week = (await admin('/tasks/week')).text;
  assert.match(week, /class="wk-block/);
  assert.match(week, /data-top="270"/); // 10:30 is 4.5 hours after the 06:00 start
  assert.match(week, /data-h="120"/); // two hours long
  assert.match((await admin(`/tasks/${tid}/schedule`, { method: 'POST', form: { day: 'x', time: '99:99' } })).loc, /err=/);
  const ics = await admin('/tasks/export.ics');
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(ics.text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics.text, new RegExp(`DTSTART:${t.replaceAll('-', '')}T103000Z`));
  assert.match(ics.text, new RegExp(`DTEND:${t.replaceAll('-', '')}T123000Z`)); // length becomes the duration
  assert.match(ics.text, /SUMMARY:Deep work/);
  await admin(`/tasks/${tid}/schedule`, { method: 'POST', form: { clear: '1' } });
  const undated = (await admin('/tasks/export.ics')).text;
  assert.match(undated, /DTSTART;VALUE=DATE:/); // still dated, now all day
  await add(admin, 'Comma, semicolon; and a\\ slash');
  db.prepare("UPDATE tasks SET due_on = ? WHERE title LIKE 'Comma%'").run(t);
  assert.match((await admin('/tasks/export.ics')).text, /SUMMARY:Comma\\, semicolon\\; and a\\\\ slash/);
  assert.ok((await admin('/tasks/export.ics')).text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  close();
});

test('add an issue or a page to my tasks', async () => {
  const { admin, db, close } = await boot();
  await admin('/spaces', { method: 'POST', form: { name: 'Eng', key: 'ENG' } });
  const issue = (await admin('/s/ENG/issues', { method: 'POST', form: { title: 'Fix login' } })).loc.split('/')[2];
  const pageId = (await admin('/s/ENG/pages', { method: 'POST', form: { title: 'Runbook', body: 'x' } })).loc.split('/')[2];
  assert.match((await admin(`/i/${issue}`)).text, /Add to my tasks/);
  assert.match((await admin(`/p/${pageId}`)).text, /Add to my tasks/);
  const r = await admin('/tasks/from', { method: 'POST', form: { kind: 'issue', id: issue } });
  assert.match(r.loc, /^\/tasks\/my-day\?t=\d+$/);
  const t = db.prepare('SELECT * FROM tasks WHERE link_issue_id = ?').get(Number(issue));
  assert.equal(t.title, 'ENG-1 Fix login');
  await admin('/tasks/from', { method: 'POST', form: { kind: 'issue', id: issue } }); // again: opens the same task
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE link_issue_id = ?').get(Number(issue)).n, 1);
  await admin('/tasks/from', { method: 'POST', form: { kind: 'page', id: pageId } });
  assert.equal(db.prepare('SELECT title FROM tasks WHERE link_page_id = ?').get(Number(pageId)).title, 'Review: Runbook');
  assert.equal((await admin('/tasks/from', { method: 'POST', form: { kind: 'issue', id: '9999' } })).status, 404);
  // deleting the issue leaves the task, minus the link
  await admin(`/s/ENG/issues`);
  db.prepare('DELETE FROM issues WHERE id = ?').run(Number(issue));
  assert.equal(db.prepare('SELECT link_issue_id FROM tasks WHERE id = ?').get(t.id).link_issue_id, null);
  close();
});

test('the Tasks link, notification kinds and shortcut help are on every page', async () => {
  const { admin, close } = await boot();
  assert.match((await admin('/')).text, /id="tasks-link" href="\/tasks"/);
  const settings = (await admin('/settings/notifications')).text;
  for (const k of ['task_assigned', 'task_reminder', 'task_due', 'task_done']) assert.match(settings, new RegExp(`name="${k}"`));
  assert.equal((await admin('/tasks')).loc, '/tasks/my-day');
  close();
});

test('old databases upgrade in place', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'folio-db-'));
  const file = join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO users (username, password_hash) VALUES ('old', 'x');");
  old.close();
  const db = openDb(file);
  for (const t of ['task_lists', 'task_list_members', 'tasks', 'task_steps', 'task_my_day', 'task_reminders'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t);
  assert.equal(db.prepare('SELECT username FROM users').get().username, 'old');
  openDb(file); // opening twice is harmless
});
