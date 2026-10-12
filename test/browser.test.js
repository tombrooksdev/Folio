// Browser checks for the Tasks page script. These need Playwright and a Chromium, which Folio does not depend on,
// so the whole file skips itself when they are missing. To run it:
//   npm i --no-save playwright && npx playwright install chromium && npm test
// or point PLAYWRIGHT_FROM at any package.json whose node_modules has playwright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let chromium = null;
try {
  const req = createRequire(process.env.PLAYWRIGHT_FROM ?? new URL('../package.json', import.meta.url));
  chromium = req('playwright').chromium;
} catch { /* not installed */ }

let browser = null;
if (chromium) try { browser = await chromium.launch(); } catch { /* no browser binary */ }
const skip = browser ? false : 'Playwright with Chromium is not installed';

async function session() {
  const db = openDb(':memory:');
  const server = createApp(db, { uploadDir: mkdtempSync(join(tmpdir(), 'folio-ui-')) }).listen(0);
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: 'Europe/London' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/setup`);
  await page.fill('[name=username]', 'tom');
  await page.fill('[name=password]', 'correct-horse-9');
  await page.click('button');
  await page.waitForURL(`${base}/`);
  await page.evaluate(() => fetch('/me/flag', { method: 'POST', body: new URLSearchParams({ key: 'tour' }) })); // no first-login tour in the way
  return { page, base, errors, db, done: async () => { await ctx.close(); server.close(); } };
}

test('quick add shows chips, adds rows, opens the pane with focus, completes and closes', { skip }, async () => {
  const { page, base, errors, done } = await session();
  await page.goto(`${base}/tasks/my-day`);
  await page.fill('#quick-add', 'Write the post fri ~1h30 ! *');
  const help = await page.textContent('#quick-help');
  assert.match(help, /1h 30m/);
  assert.match(help, /Important/);
  assert.match(help, /My Day/);
  assert.match(help, /Title: Write the post/);
  await page.press('#quick-add', 'Enter');
  await page.waitForSelector('.task-row');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'quick-add'); // ready for the next one
  await page.fill('#quick-add', 'Second thing *'); await page.press('#quick-add', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 2);
  assert.equal(new URL(page.url()).pathname, '/tasks/my-day'); // no full reload to somewhere else
  await page.click('.task-row .t-main');
  await page.waitForSelector('#t-pane');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pane-title');
  await page.fill('#step-new', 'Outline'); await page.press('#step-new', 'Enter');
  await page.waitForSelector('.t-steps li');
  await page.click('.task-row:nth-child(2) .task-check');
  await page.waitForSelector('.t-done');
  assert.equal(await page.locator('.t-group .task-row').count(), 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#t-pane'));
  assert.deepEqual(errors, []);
  await done();
});

test('lists swap in, quick pick sets the date, delete asks once, shortcuts work', { skip }, async () => {
  const { page, base, errors, done } = await session();
  await page.goto(`${base}/tasks/my-day`);
  await page.fill('#new-list-name', 'Launch'); await page.click('.new-list button');
  await page.waitForURL(/\/tasks\/lists\/\d+/);
  assert.ok(await page.locator('nav.side >> text=Launch').count());
  await page.fill('#quick-add', 'Draft post'); await page.press('#quick-add', 'Enter');
  await page.waitForSelector('.task-row');
  await page.click('.task-row .t-main'); await page.waitForSelector('#t-pane');
  await page.click('button[name=due_quick][value=today]');
  await page.waitForFunction((d) => document.querySelector('#pane-due')?.value === d, new Date().toISOString().slice(0, 10)).catch(() => {}); // UTC vs London can differ by a day
  assert.ok(await page.inputValue('#pane-due'));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#t-pane'));
  await page.keyboard.press('n');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'quick-add');
  await page.click('.task-row .t-main'); await page.waitForSelector('#t-pane');
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.accept(); });
  await page.click('text=Delete task');
  await page.waitForFunction(() => !document.querySelector('.task-row'));
  assert.equal(dialogs, 1);
  await page.click('.t-settings > summary');
  await page.click('text=Delete list');
  await page.waitForURL(/\/tasks\/my-day/);
  assert.equal(dialogs, 2);
  assert.deepEqual(errors, []);
  await done();
});

test('dragging reorders a list and time-boxes a task on the week planner', { skip }, async () => {
  const { page, base, errors, db, done } = await session();
  await page.goto(`${base}/tasks/my-day`);
  for (const t of ['One', 'Two', 'Three']) { await page.fill('#quick-add', t); await page.press('#quick-add', 'Enter'); await page.waitForFunction((n) => document.body.textContent.includes(n), t); }
  await page.goto(`${base}/tasks/lists/1`);
  await page.waitForSelector('ul[data-reorder]');
  const titles = () => page.$$eval('.task-row .t-title', (els) => els.map((e) => e.textContent).join(','));
  assert.equal(await titles(), 'One,Two,Three');
  await page.locator('.task-row', { hasText: 'Three' }).dragTo(page.locator('.task-row', { hasText: 'One' }), { targetPosition: { x: 40, y: 3 } });
  await page.waitForFunction(() => document.querySelector('.task-row .t-title').textContent === 'Three');
  assert.equal(await titles(), 'Three,One,Two');
  // week planner: a dated task dropped on a day gets a start time, and the block is sized from its length
  await page.goto(`${base}/tasks/my-day`);
  await page.fill('#quick-add', 'Deep work today ~2h'); await page.press('#quick-add', 'Enter');
  await page.waitForFunction(() => document.body.textContent.includes('Deep work'));
  await page.goto(`${base}/tasks/week`);
  const item = page.locator('.wk-item', { hasText: 'Deep work' });
  await item.waitFor();
  await item.dragTo(page.locator('.wk-grid[data-day]').first(), { targetPosition: { x: 40, y: 4 * 48 + 2 } });
  await page.waitForSelector('.wk-block');
  assert.equal(await page.locator('.wk-block').first().evaluate((el) => el.style.height), '96px'); // two hours at 48px an hour
  assert.ok(db.prepare("SELECT start_at FROM tasks WHERE title = 'Deep work'").get().start_at);
  assert.deepEqual(errors, []);
  await done();
});

test('attach a file to a task from the pane, see it, and delete it', { skip }, async () => {
  const { page, base, errors, done } = await session();
  await page.goto(`${base}/tasks/my-day`);
  await page.fill('#quick-add', 'Needs a file *'); await page.press('#quick-add', 'Enter');
  await page.click('.task-row .t-main'); await page.waitForSelector('#t-pane');
  await page.setInputFiles('[data-task-upload] input[type=file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForSelector('.t-files .file-list a:has-text("notes.txt")');
  assert.equal(await page.locator('.t-files .count').textContent(), '1');
  const href = await page.getAttribute('.t-files .file-list a', 'href');
  assert.equal(await page.evaluate(async (h) => (await fetch(h)).text(), href), 'hello');
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.accept(); });
  await page.click('.t-files form button');
  await page.waitForFunction(() => !document.querySelector('.t-files .file-list'));
  assert.equal(dialogs, 1);
  assert.ok(await page.locator('#t-pane').count()); // still on the task
  assert.deepEqual(errors, []);
  await done();
});

test('deleting a page offers Undo, and Restore from the trash works', { skip }, async () => {
  const { page, base, errors, done } = await session();
  await page.goto(`${base}/`);
  await page.evaluate(async () => {
    await fetch('/spaces', { method: 'POST', body: new URLSearchParams({ name: 'Eng', key: 'ENG' }) });
    await fetch('/s/ENG/pages', { method: 'POST', body: new URLSearchParams({ title: 'Doomed page', body: 'x' }) });
  });
  await page.goto(`${base}/p/1/edit`);
  page.on('dialog', (d) => d.accept());
  await page.click('text=Delete page');
  await page.waitForURL(/\/s\/ENG$/); // the ?trashed param is tidied away from the address bar
  await page.waitForSelector('.toast >> text=Moved to the trash');
  await page.click('.toast button:has-text("Undo")');
  await page.waitForURL(`${base}/p/1`);
  assert.match(await page.textContent('h1'), /Doomed page/);
  // and from the trash page
  await page.goto(`${base}/p/1/edit`); await page.click('text=Delete page'); await page.waitForURL(/\/s\/ENG$/);
  await page.goto(`${base}/s/ENG/trash`);
  await page.click('text=Restore');
  await page.waitForURL(`${base}/p/1`);
  assert.deepEqual(errors, []);
  await done();
});

test('the @mention picker works in the editor and in quick add, by keyboard and mouse', { skip }, async () => {
  const { page, base, errors, db, done } = await session();
  const hash = db.prepare('SELECT password_hash h FROM users').get().h;
  for (const n of ['sam', 'sarah', 'ann']) db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(n, hash);
  await page.goto(`${base}/`);
  await page.evaluate(() => fetch('/spaces', { method: 'POST', body: new URLSearchParams({ name: 'Eng', key: 'ENG' }) }));
  await page.goto(`${base}/s/ENG/new`);
  const body = page.locator('#body');
  await body.click();
  await body.pressSequentially('Thanks @sa');
  await page.waitForSelector('.mention-pop');
  assert.deepEqual(await page.$$eval('.mention-name', (o) => o.map((e) => e.textContent)), ['sam', 'sarah']);
  assert.equal(await body.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await body.inputValue(), 'Thanks @sarah '); // chosen, not submitted
  assert.equal(await page.locator('.mention-pop').count(), 0);
  await page.waitForFunction(() => /sarah/.test(document.querySelector('#preview').textContent)); // the live preview saw the change
  await body.pressSequentially('and @a');
  await page.waitForSelector('.mention-pop');
  await page.locator('.mention-opt', { hasText: 'ann' }).click(); // the mouse works too
  assert.equal(await body.inputValue(), 'Thanks @sarah and @ann ');
  await body.pressSequentially('mail tom@x');
  assert.equal(await page.locator('.mention-pop').count(), 0); // an email address does not open it
  await body.pressSequentially(' @');
  await page.waitForSelector('.mention-pop');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.mention-pop').count(), 0);
  assert.match(await body.inputValue(), / @$/); // Escape only closed the list
  // Tasks quick add: Enter picks a person instead of adding the task
  await page.goto(`${base}/tasks/my-day`);
  await page.click('#quick-add');
  await page.locator('#quick-add').pressSequentially('Call back @sam');
  await page.waitForSelector('.mention-pop');
  await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('#quick-add'), 'Call back @sam ');
  assert.equal(await page.locator('.task-row').count(), 0);
  assert.match(await page.textContent('#quick-help'), /@sam/); // the chips saw it too
  assert.deepEqual(errors, []);
  await done();
});

test('dragging a page in the sidebar reorders and nests it', { skip }, async () => {
  const { page, base, errors, db, done } = await session();
  await page.goto(`${base}/`);
  await page.evaluate(async () => {
    await fetch('/spaces', { method: 'POST', body: new URLSearchParams({ name: 'Eng', key: 'ENG' }) });
    for (const t of ['Alpha', 'Beta', 'Gamma']) await fetch('/s/ENG/pages', { method: 'POST', body: new URLSearchParams({ title: t, body: t }) });
  });
  await page.goto(`${base}/p/1`);
  const names = () => page.$$eval('.space-body > .tree > li > a', (a) => a.map((e) => e.textContent.trim()).join(','));
  assert.equal(await names(), 'Alpha,Beta,Gamma');
  const gamma = page.locator('.tree li[data-page="3"] > a'), alpha = page.locator('.tree li[data-page="1"] > a');
  const h = (await alpha.boundingBox()).height;
  await gamma.dragTo(alpha, { targetPosition: { x: 20, y: 2 } }); // top edge: before
  await page.waitForFunction(() => document.querySelector('.space-body > .tree > li > a').textContent.trim() === 'Gamma');
  assert.equal(await names(), 'Gamma,Alpha,Beta');
  await page.locator('.tree li[data-page="2"] > a').dragTo(page.locator('.tree li[data-page="3"] > a'), { targetPosition: { x: 20, y: h / 2 } }); // middle: inside
  await page.waitForFunction(() => document.querySelectorAll('.space-body > .tree > li').length === 2);
  assert.equal(db.prepare("SELECT parent_id FROM pages WHERE title = 'Beta'").get().parent_id, 3);
  assert.equal(await names(), 'Gamma,Alpha');
  // a page cannot be dropped into its own child
  await page.locator('.tree li[data-page="3"] > a').dragTo(page.locator('.tree li[data-page="2"] > a'), { targetPosition: { x: 20, y: h / 2 } }).catch(() => {});
  assert.equal(db.prepare("SELECT parent_id FROM pages WHERE title = 'Gamma'").get().parent_id, null);
  assert.deepEqual(errors, []);
  await done();
});

test.after(async () => { await browser?.close(); });
