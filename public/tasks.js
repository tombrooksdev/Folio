// Tasks page behaviour. Every Tasks page works as plain forms and links; this file only makes it quicker:
// updates swap into the page without a reload, quick add shows what it understood, shortcuts, and the week planner.
import { parseQuickAdd } from './taskcore.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOUR = 48; // px per hour in the week grid (matches .wk-hour in style.css)

// ---- time zone: tell the server the browser's offset so "today" and reminders are right ----
try {
  const off = String(new Date().getTimezoneOffset());
  if (!new RegExp(`(?:^|; )tz=${off}(?:;|$)`).test(document.cookie)) {
    document.cookie = `tz=${off}; path=/; max-age=31536000; samesite=lax`;
    if (!sessionStorage.getItem('folio-tz-reload')) { sessionStorage.setItem('folio-tz-reload', '1'); location.reload(); }
  }
} catch { /* cookies or storage blocked: dates fall back to UTC */ }

function toast(text) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  box.append(el);
  setTimeout(() => el.classList.add('out'), 4000);
  setTimeout(() => el.remove(), 4400);
}

// ---- swapping pages in place ----
const inTasks = (el) => !!el.closest?.('main, nav.side') && location.pathname.startsWith('/tasks');
let busy = false;

function remember() {
  const a = document.activeElement;
  if (!a || a === document.body || !a.closest('main, nav.side')) return null;
  return { id: a.id, name: a.name, action: a.form?.getAttribute('action') };
}
function restore(m) {
  if (!m) return;
  const el = (m.id && document.getElementById(m.id)) || (m.name && m.action && $(`form[action="${CSS.escape(m.action)}"] [name="${CSS.escape(m.name)}"]`));
  el?.focus?.({ preventScroll: true });
}
function swap(html, url, { push = false, focus = null } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('main'), side = doc.querySelector('nav.side');
  if (!main || !side) { location.href = url; return; }
  const mem = remember();
  $('main').innerHTML = main.innerHTML;
  $('nav.side').innerHTML = side.innerHTML;
  document.title = doc.title;
  const u = new URL(url, location.href);
  const path = u.pathname + u.search;
  if (path !== location.pathname + location.search) (push ? history.pushState : history.replaceState).call(history, null, '', path);
  layoutWeek();
  if (focus) $(focus)?.focus();
  else restore(mem);
}

async function get(url, opts) {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch(url, { headers: { 'X-Requested-With': 'fetch' } });
    if (!r.ok) { toast((await r.text()).slice(0, 120) || 'Something went wrong'); return; }
    swap(await r.text(), r.url, opts);
  } catch { location.href = url; } finally { busy = false; }
}
async function post(url, params, opts) {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, body: new URLSearchParams(params) });
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).error; } catch { /* not json */ }
      toast(msg || 'Could not save that');
      return;
    }
    swap(await r.text(), r.url, opts);
  } catch { toast('Could not reach the server'); } finally { busy = false; }
}

// forms
document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (e.defaultPrevented || !(form instanceof HTMLFormElement) || form.method !== 'post' || !inTasks(form)) return;
  // getAttribute, not form.action: a field named "action" (the delete-list form has one) shadows the property
  const action = form.getAttribute('action') ?? '';
  if (!/^\/(?:tasks(?:\/|$)|attachments\/\d+\/delete$)/.test(action)) return;
  e.preventDefault();
  if (form.dataset.confirm && !form.dataset.bound && !confirm(form.dataset.confirm)) return;
  const quick = form.id === 'quick-form';
  await post(action, new FormData(form, e.submitter), { focus: quick ? '#quick-add' : null });
});
// links
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="/tasks"]');
  if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || a.target || !inTasks(a) || a.pathname === '/tasks/export.ics') return;
  e.preventDefault();
  get(a.href, { push: true, focus: a.matches('.t-main') ? '#pane-title' : null });
});
addEventListener('popstate', () => { if (location.pathname.startsWith('/tasks')) get(location.href); });
$$('form[data-confirm]').forEach((f) => { f.dataset.bound = '1'; }); // app.js already asks for these

// ---- controls that save as soon as they change ----
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.matches?.('[data-tauto]') || !inTasks(el)) return;
  const form = el.form;
  if (el.type === 'checkbox' && el.closest('.task-row') && !reduceMotion) {
    // let the circle fill and the row strike through before it moves away
    el.closest('.task-row').classList.add('completing');
    setTimeout(() => form.requestSubmit(), 320);
  } else form.requestSubmit();
});

// ---- quick add: show what was understood while typing ----
document.addEventListener('input', (e) => {
  const input = e.target;
  if (input.id !== 'quick-add') return;
  const form = input.form, help = $('#quick-help');
  if (!help.dataset.default) help.dataset.default = help.innerHTML;
  let people = [], lists = [];
  try { people = JSON.parse(form.dataset.people); lists = JSON.parse(form.dataset.lists); } catch { /* use none */ }
  const p = parseQuickAdd(input.value, { today: form.dataset.today, people, lists });
  if (!p.tokens.length) { help.innerHTML = help.dataset.default; return; }
  help.replaceChildren();
  for (const t of p.tokens) {
    const chip = document.createElement('span');
    chip.className = `chip-tok k-${t.kind}`;
    chip.textContent = t.label;
    help.append(chip, ' ');
  }
  const title = document.createElement('span');
  title.textContent = p.title ? `Title: ${p.title}` : 'Add a title';
  help.append(title);
});

// ---- keyboard shortcuts (N new, Space done, D due date, M My Day, I important, Esc close) ----
function subject() {
  const row = document.activeElement?.closest?.('.task-row[data-id]') ?? $('.task-row.open');
  return row ? { row, id: row.dataset.id } : null;
}
async function ensurePane(s) {
  if ($('#t-pane')?.dataset.task === s.id) return true;
  const a = s.row.querySelector('.t-main');
  if (!a) return false;
  await get(a.href, { push: true });
  return $('#t-pane')?.dataset.task === s.id;
}
addEventListener('keydown', async (e) => {
  if (!location.pathname.startsWith('/tasks') || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const typing = t.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape' && !document.querySelector('dialog[open], .menu.open, .cmdk.open') && $('#pane-close') && (!typing || t.id === 'pane-title')) { $('#pane-close').click(); return; }
  if (typing || document.querySelector('dialog[open]')) return;
  const s = subject();
  if (e.key === 'n') { const q = $('#quick-add'); if (q) { e.preventDefault(); q.focus(); } }
  else if (e.key === ' ' && s && document.activeElement?.closest?.('.task-row') && !t.closest('button, input')) { e.preventDefault(); s.row.querySelector('.task-check:not(:disabled)')?.click(); }
  else if (e.key === 'i' && s) s.row.querySelector('.star-btn:not(:disabled)')?.click();
  else if (e.key === 'm' && s) { if (await ensurePane(s)) $('#t-pane form[action$="/my-day"] button:not(:disabled)')?.click(); }
  else if (e.key === 'd' && s) { if (await ensurePane(s)) { e.preventDefault?.(); $('#pane-due')?.focus(); } }
});

// ---- files on a task: pick or drop, then refresh the pane ----
async function attach(taskId, list) {
  for (const f of list) {
    const r = await fetch(`/attachments?task=${taskId}&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'fetch' }, body: f });
    if (!r.ok) { toast((await r.json().catch(() => ({}))).error || 'Upload failed'); break; }
  }
  get(location.href);
}
document.addEventListener('change', (e) => {
  const zone = e.target.closest?.('[data-task-upload]');
  if (zone && e.target.type === 'file') { attach(zone.dataset.taskUpload, [...e.target.files]); e.target.value = ''; }
});
document.addEventListener('dragover', (e) => { const z = e.target.closest?.('[data-task-upload]'); if (z && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', (e) => e.target.closest?.('[data-task-upload]')?.classList.remove('over'));
document.addEventListener('drop', (e) => {
  const z = e.target.closest?.('[data-task-upload]');
  if (z && e.dataTransfer?.files.length) { e.preventDefault(); z.classList.remove('over'); attach(z.dataset.taskUpload, [...e.dataTransfer.files]); }
});

// ---- reorder tasks in a list by dragging (the pane also has Move up and Move down) ----
let dragRow = null;
document.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('ul[data-reorder] > .task-row[draggable]');
  if (!row) return;
  dragRow = row;
  e.dataTransfer.setData('text/x-folio-row', row.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
});
const dropTarget = (e) => {
  const row = e.target.closest?.('ul[data-reorder] > .task-row');
  if (!dragRow || !row || row === dragRow) return null;
  const r = row.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? row : row.nextElementSibling; // null means the end
};
document.addEventListener('dragover', (e) => {
  if (dragRow && e.target.closest?.('ul[data-reorder]')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
document.addEventListener('drop', (e) => {
  if (!dragRow || !e.target.closest?.('ul[data-reorder]')) return;
  e.preventDefault();
  const row = e.target.closest('.task-row');
  const before = row && row !== dragRow ? dropTarget(e) : undefined;
  const id = dragRow.dataset.id;
  dragRow = null;
  if (before === undefined) return;
  post(`/tasks/${id}/move`, { before: before?.dataset.id ?? '', return: location.pathname + location.search });
});
document.addEventListener('dragend', () => { dragRow = null; });

// ---- week planner: place blocks, drag to time-box ----
function layoutWeek() {
  $$('.wk-block').forEach((b) => {
    b.style.top = `${(Number(b.dataset.top) / 60) * HOUR}px`;
    b.style.height = `${Math.max((Number(b.dataset.h) / 60) * HOUR, 20)}px`;
  });
}
layoutWeek();
document.addEventListener('dragstart', (e) => {
  const el = e.target.closest?.('.wk-block, .wk-item');
  if (!el) return;
  e.dataTransfer.setData('text/plain', el.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => { if (e.target.closest?.('.wk-grid')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
document.addEventListener('drop', (e) => {
  const grid = e.target.closest?.('.wk-grid');
  const id = e.dataTransfer?.getData('text/plain');
  if (!grid || !/^\d+$/.test(id ?? '')) return;
  e.preventDefault();
  const week = $('.wk');
  const from = Number(week.dataset.gridFrom);
  const y = e.clientY - grid.getBoundingClientRect().top;
  const mins = Math.max(0, Math.round(((y / HOUR) * 60) / 15) * 15) + from * 60;
  const clamped = Math.min(mins, 23 * 60 + 45);
  const time = `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
  post(`/tasks/${id}/schedule`, { day: grid.dataset.day, time, return: week.dataset.return });
});
