// Shared client behaviour: theme toggle, scroll progress, command palette, TOC, copy buttons, stagger.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// stagger entrance animations
$$('[data-i]').forEach((el) => el.style.setProperty('--i', el.dataset.i));

// theme
const MOON = '<svg class="i" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';
const SUN = '<svg class="i" viewBox="0 0 24 24"><path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M3 12h2m14 0h2M5.6 18.4L7 17m10-10l1.4-1.4M12 16a4 4 0 100-8 4 4 0 000 8z"/></svg>';
const themeBtn = $('#theme');
const paintTheme = () => themeBtn && (themeBtn.innerHTML = document.documentElement.dataset.theme === 'dark' ? SUN : MOON);
paintTheme();
themeBtn?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('folio-theme', next); } catch {}
  paintTheme();
});

// reading progress
const bar = $('#progress');
const onScroll = () => {
  const h = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${h > 0 ? Math.min(scrollY / h, 1) : 0})`;
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// command palette
const box = $('#cmdk'), input = $('#cmdk-input'), list = $('#cmdk-list');
let sel = 0, timer, results = [];
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function openPalette() { box.classList.add('open'); input.value = ''; list.innerHTML = '<div class="cmdk-empty">Type to search every page</div>'; input.focus(); }
function closePalette() { box.classList.remove('open'); }
function paint() {
  list.innerHTML = results.length
    ? results.map((r, i) => `<a href="/p/${r.id}" class="${i === sel ? 'sel' : ''}">${esc(r.title)}<small>${esc(r.space)} · ${esc(r.snip)}</small></a>`).join('')
    : '<div class="cmdk-empty">No matching pages</div>';
}
input.addEventListener('input', () => {
  clearTimeout(timer);
  const q = input.value.trim();
  if (!q) { list.innerHTML = '<div class="cmdk-empty">Type to search every page</div>'; return; }
  timer = setTimeout(async () => {
    results = await (await fetch('/search.json?q=' + encodeURIComponent(q))).json();
    sel = 0; paint();
  }, 120);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); paint(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
  if (e.key === 'Enter') {
    if (results[sel]) location.href = '/p/' + results[sel].id;
    else if (input.value.trim()) location.href = '/search?q=' + encodeURIComponent(input.value.trim());
  }
});
box.addEventListener('click', (e) => { if (e.target === box) closePalette(); });
$('#cmdk-open')?.addEventListener('click', openPalette);
$('#cmdk-open-hero')?.addEventListener('click', openPalette);
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && $('#cmdk-open')) { e.preventDefault(); openPalette(); }
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
