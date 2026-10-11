// Sprint reporting: burndown, velocity, sprint history. Pure data + SVG helpers, plus routes.
import { esc, icon } from './render.js';

// Record how an issue's change affects the scope / done points of any active sprint it touches.
export function logChange(db, issueId, before, after) {
  const ids = new Set([before?.sprint_id, after?.sprint_id].filter(Boolean));
  for (const sid of ids) {
    if (!db.prepare("SELECT 1 FROM sprints WHERE id = ? AND state = 'active'").get(sid)) continue;
    const inS = (s) => s && s.sprint_id === sid;
    const scope = (s) => (inS(s) ? s.points ?? 0 : 0);
    const done = (s) => (inS(s) && s.status === 'done' ? s.points ?? 0 : 0);
    const ds = scope(after) - scope(before), dd = done(after) - done(before);
    if (ds || dd) db.prepare('INSERT INTO sprint_log (sprint_id, issue_id, scope_delta, done_delta) VALUES (?, ?, ?, ?)').run(sid, issueId, ds, dd);
  }
}

const DAY = 864e5;
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function sprintStats(db, sprint) {
  const logs = db.prepare('SELECT scope_delta, done_delta, initial, at FROM sprint_log WHERE sprint_id = ? ORDER BY at, id').all(sprint.id);
  const started = sprint.started_at ?? sprint.ends_at ?? new Date().toISOString();
  const initial = logs.filter((l) => l.initial).reduce((a, l) => a + l.scope_delta, 0);
  const scope = logs.reduce((a, l) => a + l.scope_delta, 0);
  const done = logs.reduce((a, l) => a + l.done_delta, 0);

  const startDay = day(started);
  const planned = sprint.ends_at ? day(sprint.ends_at) : startDay + 14 * DAY;
  const lastDay = sprint.closed_at ? day(sprint.closed_at) : Math.max(planned, day(new Date().toISOString()));
  const endDay = Math.max(sprint.state === 'closed' ? Math.max(planned, lastDay) : planned, startDay + DAY);
  const n = Math.round((endDay - startDay) / DAY) + 1;
  const todayIdx = sprint.state === 'closed' ? Math.round((day(sprint.closed_at) - startDay) / DAY) : Math.round((day(new Date().toISOString()) - startDay) / DAY);
  const days = Array.from({ length: n }, (_, i) => {
    const d = iso(startDay + i * DAY);
    const remaining = logs.filter((l) => l.at.slice(0, 10) <= d).reduce((a, l) => a + l.scope_delta - l.done_delta, 0);
    return { date: d, ideal: initial * (1 - i / (n - 1)), actual: i <= todayIdx ? remaining : null };
  });
  return { initial, scope, done, remaining: scope - done, added: scope - initial, days };
}

const nice = (v) => { const step = v <= 10 ? 2 : v <= 25 ? 5 : v <= 60 ? 10 : 20; return Math.max(step * 2, Math.ceil(v / step) * step); };

export function burndownSvg(stats) {
  const W = 680, H = 250, L = 38, R = 14, T = 14, B = 30;
  const { days } = stats;
  const max = nice(Math.max(1, stats.initial, ...days.map((d) => d.actual ?? 0)));
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, days.length - 1);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const pts = (key) => days.map((d, i) => (d[key] == null ? null : `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`)).filter(Boolean);
  const actual = pts('actual');
  const last = days.findLastIndex((d) => d.actual != null);
  const ticks = [0, 1, 2, 3, 4].map((t) => (max * t) / 4);
  const every = Math.ceil(days.length / 8);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Burndown chart: ${stats.remaining} of ${stats.scope} points remaining"><title>Burndown</title>
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${Math.round(t)}</text>`).join('')}
    ${days.map((d, i) => (i % every === 0 || i === days.length - 1 ? `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${d.date.slice(8)}/${d.date.slice(5, 7)}</text>` : '')).join('')}
    ${actual.length > 1 ? `<path class="area" d="M${actual[0]} L${actual.join(' L')} L${x(last).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)}Z"/>` : ''}
    <polyline class="ideal" points="${pts('ideal').join(' ')}"/>
    ${actual.length ? `<polyline class="actual" points="${actual.join(' ')}"/>${last >= 0 ? `<circle class="dot-end" cx="${x(last).toFixed(1)}" cy="${y(days[last].actual).toFixed(1)}" r="4"/>` : ''}` : ''}
  </svg>
  <p class="legend"><span class="k actual"></span>Remaining <span class="k ideal"></span>Ideal</p>`;
}

export function velocitySvg(rows) {
  if (!rows.length) return '';
  const W = 680, H = 220, L = 38, R = 14, T = 14, B = 34;
  const max = nice(Math.max(1, ...rows.flatMap((r) => [r.committed, r.completed])));
  const slot = (W - L - R) / rows.length, bw = Math.min(34, slot / 3);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Velocity chart"><title>Velocity</title>
    ${[0, 1, 2, 3, 4].map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y((max * t) / 4).toFixed(1)}" y2="${y((max * t) / 4).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y((max * t) / 4) + 3).toFixed(1)}" text-anchor="end">${Math.round((max * t) / 4)}</text>`).join('')}
    ${rows.map((r, i) => {
      const cx = L + slot * i + slot / 2;
      return `<rect class="bar-committed" x="${(cx - bw - 2).toFixed(1)}" y="${y(r.committed).toFixed(1)}" width="${bw}" height="${(y(0) - y(r.committed)).toFixed(1)}" rx="3"/>
        <rect class="bar-done" x="${(cx + 2).toFixed(1)}" y="${y(r.completed).toFixed(1)}" width="${bw}" height="${(y(0) - y(r.completed)).toFixed(1)}" rx="3"/>
        <text class="axis" x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle">${esc(r.name.length > 12 ? r.name.slice(0, 11) + '…' : r.name)}</text>`;
    }).join('')}
  </svg><p class="legend"><span class="k committed"></span>Committed <span class="k done"></span>Completed</p>`;
}

export function mountReports(app, { db, page, getSpace }) {
  const tile = (n, label) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;

  app.get('/s/:key/reports', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const sprints = db.prepare("SELECT * FROM sprints WHERE space_id = ? AND state != 'planned' ORDER BY id DESC").all(space.id);
    const rows = sprints.map((s) => ({ s, ...sprintStats(db, s) }));
    const closed = rows.filter((r) => r.s.state === 'closed').reverse().slice(-8).map((r) => ({ name: r.s.name, committed: r.initial, completed: r.done }));
    const last3 = closed.slice(-3);
    const avg = last3.length ? Math.round(last3.reduce((a, r) => a + r.completed, 0) / last3.length) : 0;
    page(res, {
      title: 'Reports', user: req.user, space, section: 'reports', toc: false,
      body: `<div class="page-head"><div><span class="eyebrow">${esc(space.name)}</span><h1 class="page-title">Reports</h1></div></div>
        ${closed.length ? `<div class="section-head"><h2>Velocity</h2><span class="muted">Average of last ${last3.length}: <b>${avg}</b> points per sprint</span></div><div class="chart-card">${velocitySvg(closed)}</div>` : ''}
        <div class="section-head"><h2>Sprint history</h2></div>
        <div class="list">${rows.map(({ s, initial, done, scope }) => `<a class="row-item" href="/sprints/${s.id}/report">${icon('board')}<span><span class="t">${esc(s.name)}</span><br><span class="muted">${esc((s.started_at ?? '').slice(0, 10))} to ${esc((s.closed_at ?? s.ends_at ?? '').slice(0, 10))}${s.goal ? ` · ${esc(s.goal)}` : ''}</span></span>
          <span class="chip st-${s.state === 'active' ? 'doing' : 'done'}">${s.state === 'active' ? 'Active' : 'Closed'}</span><span class="s">${done}/${scope} pts${scope ? ` · ${Math.round((done / scope) * 100)}%` : ''}</span></a>`).join('')}</div>
        ${rows.length ? '' : `<div class="empty"><h3>No sprints yet</h3><p>Reports appear once you have started a sprint.</p><a class="btn" href="/s/${esc(space.key)}/backlog">Go to backlog</a></div>`}`,
    });
  });

  app.get('/sprints/:id/report', (req, res) => {
    const s = db.prepare('SELECT * FROM sprints WHERE id = ?').get(Number(req.params.id));
    if (!s || s.state === 'planned') return res.status(404).send('No such sprint report');
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(s.space_id);
    const st = sprintStats(db, s);
    const list = (rows) => rows.map((i) => `<a class="row-item" href="/i/${i.id}"><span class="ikey">${esc(space.key)}-${i.num}</span><span class="t">${esc(i.title)}</span><span class="s">${i.points ?? '-'} pts</span></a>`).join('') || '<p class="muted pad">None</p>';
    const doneIssues = db.prepare("SELECT id, num, title, points FROM issues WHERE sprint_id = ? AND status = 'done' ORDER BY rank").all(s.id);
    const open = s.state === 'active'
      ? db.prepare("SELECT id, num, title, points FROM issues WHERE sprint_id = ? AND status != 'done' ORDER BY rank").all(s.id)
      : db.prepare('SELECT c.issue_id id, i.num, c.title, c.points FROM sprint_carry c LEFT JOIN issues i ON i.id = c.issue_id WHERE c.sprint_id = ?').all(s.id).filter((r) => r.num);
    page(res, {
      title: `${s.name} report`, user: req.user, space, section: 'reports', toc: false,
      body: `<nav class="crumbs"><a href="/s/${esc(space.key)}/reports">Reports</a>${icon('chevron')}<span>${esc(s.name)}</span></nav>
        <h1 class="page-title">${esc(s.name)}</h1>${s.goal ? `<p class="muted goal">${icon('flag')}${esc(s.goal)}</p>` : ''}
        <div class="stats">${tile(st.initial, 'Committed')}${tile(st.added >= 0 ? `+${st.added}` : st.added, 'Scope change')}${tile(st.done, 'Completed')}${tile(st.remaining, 'Remaining')}</div>
        <div class="section-head"><h2>Burndown</h2><span class="muted">${esc(s.started_at.slice(0, 10))} to ${esc((s.closed_at ?? s.ends_at).slice(0, 10))}</span></div>
        <div class="chart-card">${burndownSvg(st)}</div>
        <div class="section-head"><h2>Completed (${doneIssues.length})</h2></div><div class="list">${list(doneIssues)}</div>
        <div class="section-head"><h2>${s.state === 'active' ? 'Still open' : 'Not completed'} (${open.length})</h2></div><div class="list">${list(open)}</div>`,
    });
  });
}
