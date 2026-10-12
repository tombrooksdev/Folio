// Tasks: pure helpers shared by the server and the browser (dates, lengths, repeat rules, quick add).
// Dates are plain 'YYYY-MM-DD' strings and all arithmetic is done in UTC, so daylight saving never shifts a day.

const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (dt) => dt.toISOString().slice(0, 10);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(toDate(s)) === s;
export const addDays = (s, n) => { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); };
export const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / 86400000);
export const weekday = (s) => toDate(s).getUTCDay(); // 0 = Sunday
export const mondayOf = (s) => addDays(s, -((weekday(s) + 6) % 7));
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n, ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return iso(new Date(Date.UTC(ny, nm - 1, Math.min(d, daysIn(ny, nm)))));
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (s, today) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${DAYS[weekday(s)]} ${d} ${MONTHS[m - 1]}${today && Number(today.slice(0, 4)) !== y ? ` ${y}` : ''}`;
};

// ---- length ----
export function fmtDur(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}
// '30m', '1h30', '2h', '1.5h', '1d' (a working day is 8 hours), '90' (minutes) -> minutes, or null
export function parseDuration(text) {
  const t = String(text).trim().toLowerCase();
  let m;
  let min = null;
  if ((m = /^(\d+(?:\.\d+)?)d$/.exec(t))) min = Math.round(Number(m[1]) * 480);
  else if ((m = /^(\d+)h(\d{1,2})m?$/.exec(t))) min = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+(?:\.\d+)?)h$/.exec(t))) min = Math.round(Number(m[1]) * 60);
  else if ((m = /^(\d+)m?$/.exec(t))) min = Number(m[1]);
  return min && min >= 1 && min <= 6000 ? min : null;
}

// ---- repeat ----
export const REPEAT_RE = /^(daily|weekdays|weekly|monthly|yearly|every:[1-9]\d{0,2}:(day|week|month))$/;
export function repeatLabel(rule) {
  if (!rule) return 'Never';
  const named = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[rule];
  if (named) return named;
  const [, n, unit] = rule.split(':');
  return `Every ${n === '1' ? '' : `${n} `}${unit}${n === '1' ? '' : 's'}`;
}
// The date after `from` that a repeating task falls on next.
export function nextOccurrence(from, rule) {
  switch (rule) {
    case 'daily': return addDays(from, 1);
    case 'weekdays': { let n = addDays(from, 1); while ([0, 6].includes(weekday(n))) n = addDays(n, 1); return n; }
    case 'weekly': return addDays(from, 7);
    case 'monthly': return addMonths(from, 1);
    case 'yearly': return addMonths(from, 12);
    default: {
      const m = /^every:(\d+):(day|week|month)$/.exec(rule ?? '');
      if (!m) return null;
      const n = Number(m[1]);
      return m[2] === 'day' ? addDays(from, n) : m[2] === 'week' ? addDays(from, n * 7) : addMonths(from, n);
    }
  }
}

// ---- due labels and grouping ----
export function dueLabel(due, today) {
  if (!due) return '';
  const d = diffDays(due, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 0) return `Overdue ${-d}d`;
  return dayLabel(due, today);
}
// Planned groups: Overdue, Today, Tomorrow, This week (to Sunday), Later
export function plannedGroup(due, today) {
  const d = diffDays(due, today);
  if (d < 0) return 'Overdue';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return due <= addDays(mondayOf(today), 6) ? 'This week' : 'Later';
}
export const PLANNED_ORDER = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later'];

// ---- quick add ----
const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTH_IDX = Object.fromEntries(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].flatMap((m, i) => {
  const long = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return [[m, i + 1], [long, i + 1], ...(m === 'sep' ? [['sept', 9]] : [])];
}));
const slug = (name) => String(name).toLowerCase().replace(/\s+/g, '-');

function dateOf(day, month, today) {
  const y = Number(today.slice(0, 4));
  for (const yy of [y, y + 1]) {
    const s = `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isDate(s) && s >= today) return s;
  }
  return null;
}

// text -> { title, due_on, estimate_min, assignee, important, list, my_day, tokens: [{kind, raw, label}] }
// Only words that clearly match are taken out of the title: `@name` must be a known person and `#List` a known list.
export function parseQuickAdd(text, { today, people = [], lists = [] } = {}) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const out = { title: '', due_on: null, estimate_min: null, assignee: null, important: false, list: null, my_day: false, tokens: [] };
  const keep = [];
  const take = (kind, raw, label) => out.tokens.push({ kind, raw, label });
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lw = w.toLowerCase(), next = (words[i + 1] ?? '').toLowerCase();
    let m;
    if (w === '!') { out.important = true; take('important', w, 'Important'); continue; }
    if (w === '*') { out.my_day = true; take('my_day', w, 'My Day'); continue; }
    if (!out.estimate_min && lw.startsWith('~') && (m = parseDuration(lw.slice(1)))) { out.estimate_min = m; take('length', w, fmtDur(m)); continue; }
    if (w.startsWith('@') && !out.assignee) {
      const p = people.find((n) => n.toLowerCase() === lw.slice(1));
      if (p) { out.assignee = p; take('person', w, `@${p}`); continue; }
    }
    if (w.startsWith('#') && !out.list) {
      const l = lists.find((n) => slug(n) === lw.slice(1));
      if (l) { out.list = l; take('list', w, l); continue; }
    }
    if (!out.due_on && today) {
      let due = null, used = 1;
      if (lw === 'today') due = today;
      else if (lw === 'tomorrow' || lw === 'tmrw') due = addDays(today, 1);
      else if (lw === 'next' && next === 'week') { due = addDays(mondayOf(today), 7); used = 2; }
      else if (lw in WEEKDAYS) { const ahead = ((WEEKDAYS[lw] - weekday(today) + 6) % 7) + 1; due = addDays(today, ahead); }
      else if ((m = /^\+(\d{1,3})([dwm])$/.exec(lw))) { const n = Number(m[1]); due = m[2] === 'd' ? addDays(today, n) : m[2] === 'w' ? addDays(today, n * 7) : addMonths(today, n); }
      else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(lw)) && MONTH_IDX[next]) { due = dateOf(Number(m[1]), MONTH_IDX[next], today); used = 2; }
      else if (MONTH_IDX[lw] && (m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(next))) { due = dateOf(Number(m[1]), MONTH_IDX[lw], today); used = 2; }
      if (due) {
        out.due_on = due;
        take('due', words.slice(i, i + used).join(' '), dayLabel(due, today));
        i += used - 1;
        continue;
      }
    }
    keep.push(w);
  }
  out.title = keep.join(' ');
  return out;
}
