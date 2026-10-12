// Training area ("Learn"), getting-started checklist, contextual hints, practice space and per-user flags.
import { readFileSync } from 'node:fs';
import { esc, icon, renderMarkdown } from './render.js';
import { tx } from './db.js';

const here = new URL('./learn/', import.meta.url);
export const COURSES = JSON.parse(readFileSync(new URL('index.json', here), 'utf8'));
const lessonCache = new Map();
function lessonBody(courseId, lessonId) {
  const k = `${courseId}/${lessonId}`;
  if (!lessonCache.has(k)) {
    const raw = readFileSync(new URL(`${k}.md`, here), 'utf8');
    lessonCache.set(k, raw.replace(/^---[\s\S]*?---\n/, ''));
  }
  return lessonCache.get(k);
}

// ---- per-user flags ----
export const getFlag = (db, userId, key) => db.prepare('SELECT value FROM user_flags WHERE user_id = ? AND key = ?').get(userId, key)?.value ?? null;
export const setFlag = (db, userId, key, value = '1') =>
  db.prepare('INSERT INTO user_flags (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, at = CURRENT_TIMESTAMP').run(userId, key, value);
const FLAG_OK = /^(tour|checklist-dismissed|desktop-alerts|hint:[a-z0-9-]{1,40}|lesson:[a-z-]{1,30}\/[a-z-]{1,40})$/;

// ---- hints: small dismissible tips shown once ----
export function hint(db, user, id, html) {
  if (getFlag(db, user.id, `hint:${id}`)) return '';
  return `<aside class="hint" data-hint="${esc(id)}">${icon('bulb')}<div>${html}</div><button type="button" class="icon-btn" data-hint-dismiss aria-label="Dismiss tip">${icon('plus')}</button></aside>`;
}

// ---- getting-started checklist (ticks itself from real data) ----
export function checklist(db, user) {
  const n = (sql) => db.prepare(sql).get().n > 0;
  return [
    { id: 'tour', title: 'Take the quick tour', done: !!getFlag(db, user.id, 'tour'), href: '/learn#tour' },
    { id: 'space', title: 'Create a space for your team or project', done: n("SELECT COUNT(*) n FROM spaces WHERE key != 'PRACTICE'"), href: '/#new-space' },
    { id: 'page', title: 'Write your first page', done: n("SELECT COUNT(*) n FROM pages p JOIN spaces s ON s.id = p.space_id WHERE s.key != 'PRACTICE'"), href: '/learn/getting-started/first-page' },
    { id: 'issue', title: 'Create your first issue', done: n("SELECT COUNT(*) n FROM issues i JOIN spaces s ON s.id = i.space_id WHERE s.key != 'PRACTICE'"), href: '/learn/getting-started/first-issue' },
    { id: 'sprint', title: 'Start a sprint', done: n("SELECT COUNT(*) n FROM sprints sp JOIN spaces s ON s.id = sp.space_id WHERE s.key != 'PRACTICE' AND sp.state != 'planned'"), href: '/learn/sprints/plan' },
    { id: 'team', title: 'Add a teammate', done: n('SELECT COUNT(*) - 1 n FROM users'), href: '/learn/admin/people' },
  ];
}
export function checklistCard(db, user) {
  if (getFlag(db, user.id, 'checklist-dismissed')) return '';
  const steps = checklist(db, user);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return '';
  return `<section class="checklist" id="checklist"><header><div><h2>Get started with Folio</h2><p class="muted">${done} of ${steps.length} done. Each step ticks itself off as you go.</p></div>
    <button type="button" class="link-btn" data-flag="checklist-dismissed" data-remove="#checklist">Dismiss</button></header>
    <div class="bar"><span class="fill w${Math.round((done / steps.length) * 20) * 5}"></span></div>
    <ul>${steps.map((s) => `<li class="${s.done ? 'done' : ''}"><span class="tick">${s.done ? icon('check') : ''}</span>${s.done ? `<span>${esc(s.title)}</span>` : `<a href="${s.href}">${esc(s.title)}</a>`}</li>`).join('')}</ul></section>`;
}

// ---- progress ----
const lessonKey = (c, l) => `lesson:${c}/${l}`;
function progress(db, user, course) {
  const done = new Set(db.prepare("SELECT key FROM user_flags WHERE user_id = ? AND key LIKE 'lesson:%'").all(user.id).map((r) => r.key));
  const lessons = course.lessons.map((l) => ({ ...l, done: done.has(lessonKey(course.id, l.id)) }));
  return { lessons, done: lessons.filter((l) => l.done).length, total: lessons.length };
}

// ---- practice space ----
const SANDBOX = 'PRACTICE';
export function createSandbox(db, user) {
  if (db.prepare('SELECT 1 FROM spaces WHERE key = ?').get(SANDBOX)) return;
  tx(db, () => {
    const sid = Number(db.prepare('INSERT INTO spaces (key, name) VALUES (?, ?)').run(SANDBOX, 'Practice space').lastInsertRowid);
    const page = (parent, title, body) => Number(db.prepare('INSERT INTO pages (space_id, parent_id, title, body, updated_by) VALUES (?, ?, ?, ?, ?)').run(sid, parent, title, body, user.id).lastInsertRowid);
    const home = page(null, 'Welcome to the practice space', `This space is safe to experiment in. Nothing here affects your real work, and you can delete the whole space from the **Learn** page.\n\n## Things to try\n\n- [ ] Edit this page and add a heading\n- [ ] Create a child page from a **template**\n- [ ] Paste an image into the editor\n- [ ] Star this page\n- [ ] Open **Board** and drag a card to *Done*\n\n> [!INFO]\n> Panels like this one are written as a quote that starts with \`[!INFO]\`.\n\nIssues are linked automatically: see PRACTICE-3.`);
    page(home, 'Sample meeting notes', `**Date:** today  \n**Attendees:** you\n\n## Agenda\n\n- Review the sprint\n- Plan the week\n\n## Action items\n\n- [ ] Try dragging an issue into a new sprint`);
    page(null, 'Sample runbook', `> [!WARNING]\n> Check the status page before you start.\n\n## Steps\n\n1. Pull the latest build\n2. Deploy\n3. Watch the logs\n\n\`\`\`bash\ndocker compose up -d --build\n\`\`\``);
    const epic = (name) => Number(db.prepare('INSERT INTO epics (space_id, name) VALUES (?, ?)').run(sid, name).lastInsertRowid);
    const e1 = epic('Onboarding'), e2 = epic('Launch');
    const sp = Number(db.prepare("INSERT INTO sprints (space_id, name, goal, state, weeks, started_at, ends_at) VALUES (?, ?, ?, 'active', 2, datetime('now', '-3 days'), datetime('now', '+11 days'))").run(sid, 'Practice sprint 1', 'Learn how a sprint feels').lastInsertRowid);
    let num = 0, rank = 0;
    const issue = (title, type, prio, status, pts, inSprint, epicId) => {
      const id = Number(db.prepare('INSERT INTO issues (space_id, num, title, type, priority, status, points, sprint_id, epic_id, assignee_id, reporter_id, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sid, ++num, title, type, prio, status, pts, inSprint ? sp : null, epicId, user.id, user.id, ++rank).lastInsertRowid);
      db.prepare("INSERT INTO issue_events (issue_id, user_id, field) VALUES (?, ?, 'created')").run(id, user.id);
      if (inSprint) db.prepare("INSERT INTO sprint_log (sprint_id, issue_id, scope_delta, done_delta, initial, at) VALUES (?, ?, ?, ?, 1, datetime('now', '-3 days'))").run(sp, id, pts ?? 0, status === 'done' ? pts ?? 0 : 0);
    };
    issue('Draw the welcome screen', 'story', 'high', 'doing', 5, true, e1);
    issue('Write the getting-started guide', 'task', 'medium', 'todo', 3, true, e1);
    issue('Fix the typo on the pricing page', 'bug', 'low', 'done', 1, true, e2);
    issue('Set up error tracking', 'task', 'medium', 'todo', 2, true, e2);
    issue('Add dark mode', 'story', 'medium', 'todo', 5, false, e1);
    issue('Plan the launch email', 'task', 'low', 'todo', 2, false, e2);
    issue('Crash when saving an empty form', 'bug', 'high', 'todo', 3, false, null);
  });
}
export const sandboxExists = (db) => !!db.prepare('SELECT 1 FROM spaces WHERE key = ?').get(SANDBOX);

export function mountLearn(app, { db, page }) {
  const findCourse = (id) => COURSES.find((c) => c.id === id);
  const spaceNav = () => `<a class="nav-link" href="/">${icon('home')}Back to Folio</a>`;
  function sidebar(user, current, lessonId) {
    return `${spaceNav()}<a class="nav-link${!current ? ' cur' : ''}" href="/learn">${icon('bulb')}Learn</a><div class="nav-label"><span>Courses</span></div>
      <ul class="spaces">${COURSES.map((c) => {
        const p = progress(db, user, c), here = c.id === current;
        return `<li class="space${here ? ' here' : ''}"><a class="space-link" href="/learn/${c.id}">${icon(c.icon)}${esc(c.title)}<span class="muted prog">${p.done}/${p.total}</span></a>
          ${here ? `<ul class="lesson-nav">${p.lessons.map((l) => `<li><a href="/learn/${c.id}/${l.id}" class="${l.id === lessonId ? 'cur' : ''}"><span class="tick sm${l.done ? ' on' : ''}">${l.done ? icon('check') : ''}</span>${esc(l.title)}</a></li>`).join('')}</ul>` : ''}</li>`;
      }).join('')}</ul>`;
  }
  const render = (res, req, opts) => page(res, { user: req.user, toc: false, sidebar: sidebar(req.user, opts.course, opts.lesson), ...opts });

  app.get('/learn', (req, res) => {
    const all = COURSES.map((c) => ({ c, p: progress(db, req.user, c) }));
    const next = all.find(({ p }) => p.done < p.total);
    const nextLesson = next?.p.lessons.find((l) => !l.done);
    const lessonTotal = all.reduce((a, x) => a + x.p.total, 0), lessonDone = all.reduce((a, x) => a + x.p.done, 0);
    const sandbox = sandboxExists(db);
    render(res, req, {
      title: 'Learn',
      body: `<div class="page-head"><div><span class="eyebrow">Training</span><h1 class="page-title">Learn Folio</h1>
          <p class="muted">Short lessons, practice space included. ${lessonDone} of ${lessonTotal} lessons complete.</p></div>
          <div class="actions"><button type="button" class="ghost" data-tour-start>${icon('play')}Replay the tour</button><a class="btn ghost" href="/changelog">What's new</a></div></div>
        ${nextLesson ? `<a class="continue-card" href="/learn/${next.c.id}/${nextLesson.id}"><span class="eyebrow">${lessonDone ? 'Continue where you left off' : 'Start here'}</span><b>${esc(nextLesson.title)}</b><span class="muted">${esc(next.c.title)} · ${nextLesson.minutes} min</span>${icon('arrow')}</a>` : '<div class="continue-card done"><b>You have finished every lesson.</b><span class="muted">Nicely done. Come back whenever you need a refresher.</span></div>'}
        <div class="course-grid">${all.map(({ c, p }) => `<a class="course-card" href="/learn/${c.id}">${icon(c.icon)}<b>${esc(c.title)}</b><span class="muted">${esc(c.summary)}</span>
          <div class="bar"><span class="fill w${Math.round((p.done / p.total) * 20) * 5}"></span></div><span class="muted small">${p.done} of ${p.total} · ${esc(c.audience)}</span></a>`).join('')}</div>
        <section class="practice"><div><h2>Practice space</h2><p class="muted">A safe space with sample pages, an epic and a running sprint. Click, drag and break things. It never touches your real work, and you can remove it any time.</p></div>
          <div class="actions">${sandbox
            ? `<a class="btn" href="/s/PRACTICE/board">Open the practice space</a><form method="post" action="/learn/sandbox/delete" data-confirm="Delete the practice space and everything in it?"><button class="danger">Remove it</button></form>`
            : `<form method="post" action="/learn/sandbox"><button>${icon('plus')}Create practice space</button></form>`}</div></section>`,
    });
  });

  app.get('/learn/:course', (req, res) => {
    const c = findCourse(req.params.course);
    if (!c) return res.status(404).send('No such course');
    const p = progress(db, req.user, c);
    const next = p.lessons.find((l) => !l.done) ?? p.lessons[0];
    render(res, req, {
      title: c.title, course: c.id,
      body: `<nav class="crumbs"><a href="/learn">Learn</a>${icon('chevron')}<span>${esc(c.title)}</span></nav>
        <h1 class="page-title">${esc(c.title)}</h1><p class="muted">${esc(c.summary)} For: ${esc(c.audience.toLowerCase())}.</p>
        <div class="bar wide"><span class="fill w${Math.round((p.done / p.total) * 20) * 5}"></span></div>
        <div class="list">${p.lessons.map((l, i) => `<a class="row-item" href="/learn/${c.id}/${l.id}"><span class="tick${l.done ? ' on' : ''}">${l.done ? icon('check') : i + 1}</span><span class="t">${esc(l.title)}</span><span class="s">${l.minutes} min</span></a>`).join('')}</div>
        <div class="actions"><a class="btn" href="/learn/${c.id}/${next.id}">${p.done === 0 ? 'Start course' : p.done === p.total ? 'Review course' : 'Continue'}</a></div>`,
    });
  });

  app.get('/learn/:course/:lesson', (req, res) => {
    const c = findCourse(req.params.course);
    const idx = c?.lessons.findIndex((l) => l.id === req.params.lesson) ?? -1;
    if (idx < 0) return res.status(404).send('No such lesson');
    const l = c.lessons[idx], prev = c.lessons[idx - 1], next = c.lessons[idx + 1];
    const done = !!getFlag(db, req.user.id, lessonKey(c.id, l.id));
    const nextCourse = !next && COURSES[COURSES.indexOf(c) + 1];
    render(res, req, {
      title: l.title, course: c.id, lesson: l.id,
      body: `<nav class="crumbs"><a href="/learn">Learn</a>${icon('chevron')}<a href="/learn/${c.id}">${esc(c.title)}</a>${icon('chevron')}<span>${esc(l.title)}</span></nav>
        <span class="eyebrow">Lesson ${idx + 1} of ${c.lessons.length} · ${l.minutes} min</span><h1 class="page-title">${esc(l.title)}</h1>
        <article class="doc lesson">${renderMarkdown(lessonBody(c.id, l.id))}</article>
        <div class="lesson-foot">
          ${prev ? `<a class="btn ghost" href="/learn/${c.id}/${prev.id}">Back</a>` : '<span></span>'}
          <form method="post" action="/learn/${c.id}/${l.id}/complete"><button>${done ? 'Continue' : next ? 'Mark complete and continue' : 'Finish course'}${icon('arrow')}</button></form>
        </div>${nextCourse ? `<p class="muted">Next course: <a href="/learn/${nextCourse.id}">${esc(nextCourse.title)}</a></p>` : ''}`,
    });
  });
  app.post('/learn/:course/:lesson/complete', (req, res) => {
    const c = findCourse(req.params.course);
    const idx = c?.lessons.findIndex((l) => l.id === req.params.lesson) ?? -1;
    if (idx < 0) return res.status(404).send('No such lesson');
    setFlag(db, req.user.id, lessonKey(c.id, req.params.lesson));
    const next = c.lessons[idx + 1];
    res.redirect(next ? `/learn/${c.id}/${next.id}` : `/learn/${c.id}`);
  });

  app.post('/learn/sandbox', (req, res) => { createSandbox(db, req.user); res.redirect('/s/PRACTICE/board'); });
  app.post('/learn/sandbox/delete', (req, res) => { db.prepare('DELETE FROM spaces WHERE key = ?').run(SANDBOX); res.redirect('/learn'); });

  // Flags: tour finished, hint dismissed, checklist dismissed, desktop alerts, lesson done
  app.post('/me/flag', (req, res) => {
    const key = String(req.body.key ?? '');
    if (!FLAG_OK.test(key)) return res.status(400).json({ error: 'bad key' });
    if (req.body.clear) db.prepare('DELETE FROM user_flags WHERE user_id = ? AND key = ?').run(req.user.id, key);
    else setFlag(db, req.user.id, key, String(req.body.value ?? '1'));
    res.json({ ok: true });
  });
}
