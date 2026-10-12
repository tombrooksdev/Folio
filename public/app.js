// Shared client behaviour: theme toggle, scroll progress, command palette, TOC, copy buttons, stagger.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---- header menus (Create, Help, Notifications, Themes, Account): one open at a time, Escape and outside click close ----
const menus = [];
function menu(btnSel, menuSel, onOpen) {
  const btn = $(btnSel), box = $(menuSel);
  if (!btn || !box) return null;
  const entry = { btn, box, close() { box.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } };
  menus.push(entry);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !box.classList.contains('open');
    menus.forEach((m) => m.close());
    if (willOpen) { box.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); onOpen?.(); }
  });
  // choosing a link or action closes the menu; theme swatches and toggles inside it keep it open
  box.addEventListener('click', (e) => { if (e.target.closest('a, [data-close-menu]')) entry.close(); });
  return entry;
}
document.addEventListener('click', (e) => menus.forEach((m) => { if (!m.box.contains(e.target)) m.close(); }));
addEventListener('keydown', (e) => { if (e.key === 'Escape') { const open = menus.find((m) => m.box.classList.contains('open')); if (open) { open.close(); open.btn.focus(); } } });

// stagger entrance animations
$$('[data-i]').forEach((el) => el.style.setProperty('--i', el.dataset.i));

// theme picker. Each theme is a token set in style.css; swatch = [background, surface-ish, accent].
const THEMES = [
  ['Light', [
    ['tombrooks', 'tombrooks.dev', '#faf6ee', '#ffffff', '#c44a1f'],
    ['paper', 'Paper', '#f7f7f5', '#ffffff', '#2563eb'],
    ['sage', 'Sage', '#f3f6f1', '#fcfdfb', '#2f7d4f'],
    ['blush', 'Blush', '#fdf4f6', '#ffffff', '#c92a64'],
    ['solarized', 'Solarized', '#fdf6e3', '#fffdf5', '#268bd2'],
  ]],
  ['Dark', [
    ['tombrooks-dark', 'tombrooks.dev', '#1a1917', '#242220', '#e0764a'],
    ['midnight', 'Midnight', '#0b1020', '#111830', '#5aa9ff'],
    ['forest', 'Forest', '#0f1a14', '#15231b', '#52c283'],
    ['dracula', 'Dracula', '#282a36', '#2f3140', '#bd93f9'],
    ['nord', 'Nord', '#2e3440', '#343b49', '#88c0d0'],
    ['contrast', 'High contrast', '#000000', '#0a0a0a', '#ffd60a'],
  ]],
];
const themeBtn = $('#theme'), themeBox = $('#theme-menu');
function setTheme(id) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('folio-theme', id); } catch {}
  $$('.theme-opt', themeBox).forEach((b) => b.setAttribute('aria-checked', b.dataset.theme === id));
}
if (themeBtn) {
  themeBox.innerHTML = THEMES.map(([group, list]) => `<h4>${group}</h4><div class="theme-grid">${list.map(([id, name]) =>
    `<button type="button" class="theme-opt ghost" role="menuitemradio" data-theme="${id}" aria-checked="false"><span class="swatch"><i></i><i></i><i></i></span>${name}</button>`).join('')}</div>`).join('');
  THEMES.flatMap(([, l]) => l).forEach(([id, , a, b, c]) => {
    const sw = $$('.swatch', $(`.theme-opt[data-theme="${id}"]`, themeBox))[0].children;
    [a, b, c].forEach((col, i) => (sw[i].style.background = col));
  });
  setTheme(document.documentElement.dataset.theme);
  menu('#theme', '#theme-menu');
  document.getElementById('theme-menu').addEventListener('click', (e) => { const b = e.target.closest('.theme-opt'); if (b) setTheme(b.dataset.theme); });
}

// reading progress
const bar = $('#progress');
const onScroll = () => {
  const h = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${h > 0 ? Math.min(scrollY / h, 1) : 0})`;
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// command palette: recent pages when empty, matches highlighted as you type, a row for the full search
const box = $('#cmdk'), input = $('#cmdk-input'), list = $('#cmdk-list');
let sel = 0, timer, rows = [], query = '', opener = null, token = 0;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICON = {
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  arrow: 'M5 12h14m-6-6l6 6-6 6',
};
const svg = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;
// wrap each typed word in <mark> (on text that is already escaped)
const mark = (text, q) => {
  const terms = q.split(/\s+/).filter(Boolean).map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return terms.length ? esc(text).replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>') : esc(text);
};
function openPalette() {
  opener = document.activeElement;
  box.classList.add('open'); input.value = ''; query = ''; sel = 0;
  document.body.classList.add('cmdk-on');
  input.focus();
  showRecent();
}
function closePalette() {
  if (!box.classList.contains('open')) return;
  box.classList.remove('open'); document.body.classList.remove('cmdk-on');
  token++; clearTimeout(timer);
  input.blur(); // a hidden field must not keep focus, or the "/" shortcut thinks you are typing
  if (opener?.isConnected && opener !== document.body) opener.focus();
}
function paint(label) {
  list.innerHTML = (label ? `<div class="cmdk-label">${label}</div>` : '') + rows.map((r, i) => (r.all
    ? `<a role="option" id="cmdk-o-${i}" class="cmdk-all${i === sel ? ' sel' : ''}" aria-selected="${i === sel}" data-i="${i}" href="/search?q=${encodeURIComponent(query)}">${svg('arrow')}<span class="cm-main">See every result for <b>“${esc(query)}”</b></span></a>`
    : `<a role="option" id="cmdk-o-${i}" class="${i === sel ? 'sel' : ''}" aria-selected="${i === sel}" data-i="${i}" href="/p/${r.id}">${svg(r.recent ? 'clock' : 'file')}<span class="cm-main"><span class="cm-title">${mark(r.title, query)}</span>${r.snip ? `<span class="cm-snip">${mark(r.snip, query)}</span>` : ''}</span><span class="cm-space">${esc(r.space)}</span></a>`)).join('');
  input.setAttribute('aria-activedescendant', rows.length ? `cmdk-o-${sel}` : '');
  list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
function pick(i, e) { const r = rows[i]; if (r) { if (e?.preventDefault) e.preventDefault(); location.href = r.all ? `/search?q=${encodeURIComponent(query)}` : `/p/${r.id}`; } }
async function showRecent() {
  const mine = ++token;
  list.innerHTML = '<div class="cmdk-empty">Type to search every page</div>'; rows = [];
  try {
    const r = await (await fetch('/recent.json')).json();
    if (mine !== token || query) return;
    rows = r.map((x) => ({ ...x, recent: true })); sel = 0;
    if (rows.length) paint('Recently viewed');
  } catch { /* leave the hint */ }
}
async function run(q) {
  const mine = ++token;
  try {
    const r = await (await fetch('/search.json?q=' + encodeURIComponent(q))).json();
    if (mine !== token) return; // a newer keystroke is already on its way
    rows = [...r, { all: true }]; sel = 0;
    if (!r.length) { list.innerHTML = `<div class="cmdk-empty">No pages match <b>“${esc(q)}”</b></div><a role="option" id="cmdk-o-0" class="cmdk-all sel" aria-selected="true" data-i="0" href="/search?q=${encodeURIComponent(q)}">${svg('arrow')}<span class="cm-main">Search with every word</span></a>`; input.setAttribute('aria-activedescendant', 'cmdk-o-0'); return; }
    paint();
  } catch { list.innerHTML = '<div class="cmdk-empty">Search is unavailable right now</div>'; rows = []; }
}
input.addEventListener('input', () => {
  clearTimeout(timer);
  query = input.value.trim();
  if (!query) { showRecent(); return; }
  timer = setTimeout(() => run(query), 100);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && rows.length) { sel = (sel + 1) % rows.length; paint(rows[0]?.recent ? 'Recently viewed' : ''); e.preventDefault(); }
  else if (e.key === 'ArrowUp' && rows.length) { sel = (sel - 1 + rows.length) % rows.length; paint(rows[0]?.recent ? 'Recently viewed' : ''); e.preventDefault(); }
  else if (e.key === 'Enter') {
    if (rows[sel]) pick(sel, e);
    else if (input.value.trim()) location.href = '/search?q=' + encodeURIComponent(input.value.trim());
  }
});
list.addEventListener('mousemove', (e) => { // the pointer and the keyboard share one highlight
  const a = e.target.closest('a[data-i]');
  if (a && Number(a.dataset.i) !== sel) { list.querySelector('.sel')?.classList.remove('sel'); sel = Number(a.dataset.i); a.classList.add('sel'); input.setAttribute('aria-activedescendant', a.id); }
});
box.addEventListener('click', (e) => { if (e.target === box) closePalette(); });
$('#cmdk-open')?.addEventListener('click', openPalette);
$('#cmdk-open-hero')?.addEventListener('click', openPalette);
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && $('#cmdk-open')) { e.preventDefault(); box.classList.contains('open') ? closePalette() : openPalette(); }
  if (e.key === 'Escape') closePalette();
});

// article: heading anchors, table of contents with scroll-spy, code copy buttons
const doc = $('#doc');
if (doc) {
  const heads = $$('h2, h3', doc);
  const toc = $('#toc');
  heads.forEach((h, i) => {
    h.id = h.id || 'h-' + i + '-' + h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    h.insertAdjacentHTML('afterbegin', `<a class="anchor" href="#${h.id}" aria-label="Link to section">#</a>`);
  });
  if (toc && heads.length > 1) {
    toc.innerHTML = '<h4>On this page</h4>' + heads.map((h) => `<a href="#${h.id}" class="${h.tagName === 'H3' ? 'l3' : ''}">${esc(h.textContent.replace(/^#/, ''))}</a>`).join('');
    const links = $$('a', toc);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { links.forEach((l) => l.classList.toggle('on', l.hash === '#' + en.target.id)); }
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    heads.forEach((h) => io.observe(h));
  } else if (toc) toc.remove();
  $$('pre', doc).forEach((pre) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText);
      b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1400);
    });
    pre.append(b);
  });
}

// sidebar: collapse the whole nav, expand/collapse page tree nodes (state remembered per browser)
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
document.body.classList.toggle('side-collapsed', load('folio-side-collapsed', false));
$('#side-toggle')?.addEventListener('click', () => save('folio-side-collapsed', document.body.classList.toggle('side-collapsed')));
const openNodes = new Set(load('folio-open-nodes', []));
$$('.tree li.has-kids').forEach((li) => {
  if (openNodes.has(li.dataset.id)) { li.classList.add('open'); li.querySelector(':scope > .twisty').setAttribute('aria-expanded', 'true'); }
  li.querySelector(':scope > .twisty').addEventListener('click', (e) => {
    const isOpen = li.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', isOpen);
    isOpen ? openNodes.add(li.dataset.id) : openNodes.delete(li.dataset.id);
    save('folio-open-nodes', [...openNodes]);
  });
});

// article width: full by default, optional readable column (remembered)
const wt = $('#width-toggle');
document.body.classList.toggle('readable', load('folio-readable', false));
if (wt) {
  const paint = () => wt.setAttribute('aria-pressed', document.body.classList.contains('readable'));
  paint();
  wt.addEventListener('click', () => { save('folio-readable', document.body.classList.toggle('readable')); paint(); });
}

// generic behaviours used across pages
document.querySelectorAll('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
  const target = document.getElementById(b.dataset.toggle);
  target.hidden = !target.hidden;
  if (!target.hidden) target.querySelector('input:not([type=hidden]),textarea')?.focus();
}));
document.querySelectorAll('[data-auto]').forEach((el) => el.addEventListener('change', () => el.form.requestSubmit()));
// panels whose HTML is fetched after load (e.g. the GitHub "Development" panel on an issue)
document.querySelectorAll('[data-src]').forEach(async (el) => {
  try { const r = await fetch(el.dataset.src); el.innerHTML = r.ok ? await r.text() : ''; } catch { el.innerHTML = '<h3>Development</h3><p class="muted pad">Could not load.</p>'; }
});

// ---- Create menu, "Create issue" dialog, toasts ----
const toasts = $('#toasts');
function toast(text, url) {
  if (!toasts) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>${url ? `<a href="${esc(url)}">View</a>` : ''}`;
  toasts.append(el);
  setTimeout(() => el.classList.add('out'), 5000);
  setTimeout(() => el.remove(), 5400);
}
try { // a toast queued before a page reload (e.g. after creating an issue on the board)
  const queued = JSON.parse(sessionStorage.getItem('folio-toast') || 'null');
  if (queued) { sessionStorage.removeItem('folio-toast'); toast(queued.text, queued.url); }
} catch {}

// After a delete the server sends ?trashed=ID, and after a restore that renamed an issue ?note=...
{
  const u = new URL(location.href), tid = u.searchParams.get('trashed'), note = u.searchParams.get('note');
  if (note) toast(note);
  if (tid && /^\d+$/.test(tid) && toasts) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>Moved to the trash</span><button type="button" class="link-btn">Undo</button>';
    el.querySelector('button').addEventListener('click', async () => {
      const r = await fetch(`/trash/${tid}/restore`, { method: 'POST', headers: { 'X-Requested-With': 'fetch' } });
      if (r.ok) location.href = r.url; else el.querySelector('span').textContent = 'Could not restore it';
    });
    toasts.append(el);
    setTimeout(() => el.classList.add('out'), 12000);
    setTimeout(() => el.remove(), 12400);
  }
  if (tid || note) { u.searchParams.delete('trashed'); u.searchParams.delete('note'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
}

const createBtn = $('#create-btn'), createMenu = $('#create-menu'), issueDlg = $('#create-issue');
const createEntry = menu('#create-btn', '#create-menu');
function openIssueDialog() {
  if (!issueDlg) return;
  createEntry?.close();
  if (!issueDlg.open) issueDlg.showModal();
  issueDlg.querySelector('[name=title]').focus();
}
$$('[data-create=issue]').forEach((b) => b.addEventListener('click', openIssueDialog));
$$('dialog.modal').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#create-issue-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget, data = new FormData(form), space = data.get('space');
  data.delete('space');
  const err = $('#ci-error');
  err.hidden = true;
  const res = await fetch(`/s/${encodeURIComponent(space)}/issues`, { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, body: new URLSearchParams(data) });
  if (!res.ok) { err.textContent = (await res.text()) || 'Could not create the issue'; err.hidden = false; return; }
  const made = await res.json();
  const text = `${made.key} created`;
  const another = $('#ci-another').checked;
  if (another) { form.elements.title.value = ''; form.elements.description.value = ''; form.elements.title.focus(); } else issueDlg.close();
  if (/\/(board|backlog|issues)$/.test(location.pathname)) {
    try { sessionStorage.setItem('folio-toast', JSON.stringify({ text, url: made.url })); } catch {}
    location.reload();
  } else toast(text, made.url);
});

// ---- Activity tabs on an issue (All / Comments / History) ----
$$('[data-activity]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-activity]').forEach((o) => o.classList.toggle('on', o === b));
  $$('#activity [data-kind]').forEach((el) => { el.hidden = b.dataset.activity !== 'all' && el.dataset.kind !== b.dataset.activity; });
}));

// ---- Keyboard shortcuts (Jira-style) ----
let chord = null;
addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey || t.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const space = document.body.dataset.space;
  if (chord) {
    const go = { h: '/', b: space && `/s/${space}/board`, l: space && `/s/${space}/backlog`, i: space && `/s/${space}/issues`, r: space && `/s/${space}/reports`, t: '/tasks' }[e.key];
    chord = null;
    if (go) { e.preventDefault(); location.href = go; }
    return;
  }
  if (e.key === 'g') { chord = true; setTimeout(() => (chord = null), 1500); }
  else if (e.key === 'c' && issueDlg) { e.preventDefault(); openIssueDialog(); }
  else if (e.key === '/' && $('#cmdk-open')) { e.preventDefault(); openPalette(); }
  else if (e.key === 'e' && document.body.dataset.edit) location.href = document.body.dataset.edit;
  else if (e.key === '[') $('#side-toggle')?.click();
  else if (e.key === '?') $('#shortcuts')?.showModal();
});

// ---- Flags: dismiss hints and the checklist, remembered per user on the server ----
const flag = (key, clear) => fetch('/me/flag', { method: 'POST', body: new URLSearchParams(clear ? { key, clear: '1' } : { key }) }).catch(() => {});
document.addEventListener('click', (e) => {
  const hintBtn = e.target.closest('[data-hint-dismiss]');
  if (hintBtn) { const el = hintBtn.closest('[data-hint]'); flag(`hint:${el.dataset.hint}`); el.remove(); return; }
  const f = e.target.closest('[data-flag]');
  if (f) { flag(f.dataset.flag); if (f.dataset.remove) document.querySelector(f.dataset.remove)?.remove(); }
});

// ---- Help menu ----
const helpEntry = menu('#help-btn', '#help-menu');
$$('[data-shortcuts]').forEach((b) => b.addEventListener('click', () => { helpEntry?.close(); $('#shortcuts')?.showModal(); }));
menu('#user-btn', '#user-menu');

// ---- Notifications: bell, badge, polling, desktop alerts ----
const bell = $('#bell'), bellMenu = $('#bell-menu'), bellCount = $('#bell-count');
const setBadge = (n) => { if (!bellCount) return; bellCount.textContent = n > 99 ? '99+' : n; bellCount.hidden = !n; };
async function loadBell() {
  bellMenu.innerHTML = '<p class="muted pad">Loading...</p>';
  bellMenu.innerHTML = await (await fetch('/notifications/menu')).text();
  wireDesktopAlerts(bellMenu);
}
function wireDesktopAlerts(scope) {
  scope.querySelectorAll('#desktop-alerts').forEach((b) => {
    const ok = 'Notification' in window;
    if (!ok) { b.hidden = true; return; }
    if (Notification.permission === 'granted' && localStorage.getItem('folio-desktop-alerts') === '1') b.textContent = 'Desktop alerts are on';
    b.addEventListener('click', async () => {
      const p = await Notification.requestPermission();
      try { localStorage.setItem('folio-desktop-alerts', p === 'granted' ? '1' : '0'); } catch {}
      b.textContent = p === 'granted' ? 'Desktop alerts are on' : 'Alerts are blocked in your browser';
    });
  });
}
menu('#bell', '#bell-menu', loadBell);
wireDesktopAlerts(document);
let seenNote = null;
async function poll() {
  try {
    const r = await (await fetch('/notifications/count')).json();
    setBadge(r.count);
    if (seenNote === null) seenNote = r.latest?.id ?? 0; // first poll only sets the baseline, so old items never pop up
    else if (r.latest && r.latest.id > seenNote) {
      seenNote = r.latest.id;
      toast(r.latest.text, r.latest.url);
      let on = false; try { on = localStorage.getItem('folio-desktop-alerts') === '1'; } catch {}
      if (on && 'Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('Folio', { body: r.latest.text });
    }
  } catch {}
}
if (bell) { poll(); setInterval(poll, 30000); }
