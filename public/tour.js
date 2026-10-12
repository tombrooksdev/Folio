// First-login tour: a short spotlight walkthrough. Starts automatically once per user, and from Help > Take the tour.
(() => {
const STEPS = [
  { title: 'Welcome to Folio', text: 'Here is a 30-second look at the places you will use most. You can skip it now and replay it any time from the Help menu.', center: true },
  { target: '.side', title: 'Your spaces live here', text: 'A space holds one team\'s pages and issues. Open one to see its Board, Backlog and page tree.', place: 'right' },
  { target: '#create-btn', title: 'Create anything', text: 'New issues, pages and spaces start here. Tip: press <kbd>C</kbd> to create an issue from anywhere.' },
  { target: '#cmdk-open', title: 'Search everything', text: 'Press <kbd>/</kbd> or <kbd>Ctrl K</kbd> and start typing to jump to any page.' },
  { target: '#bell', title: 'Stay in the loop', text: 'New pages, new issues, assignments and @mentions show up here. You choose what you hear about.' },
  { target: '#help-btn', title: 'Help is one click away', text: 'Replay this tour, open the Learn area, or see every keyboard shortcut.' },
  { target: '#theme', title: 'Make it yours', text: 'Pick one of eleven themes, light or dark, including a high-contrast one.' },
  { title: 'You are ready', text: 'The Learn area has short lessons, and a practice space where nothing you do can hurt your real work.', center: true, last: true },
];

let root, spot, pop, i, steps;
const $ = (s) => document.querySelector(s);
const post = (key) => fetch('/me/flag', { method: 'POST', body: new URLSearchParams({ key }) }).catch(() => {});

function visible(el) { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0; }

function end(markDone = true) {
  root?.remove(); root = null;
  document.removeEventListener('keydown', onKey, true);
  if (markDone) post('tour');
}
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); end(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
}
function go(d) {
  i += d;
  if (i >= steps.length) return end();
  if (i < 0) i = 0;
  show();
}
function show() {
  const s = steps[i];
  const el = s.target ? $(s.target) : null;
  const dots = steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
  pop.innerHTML = `<h3>${s.title}</h3><p>${s.text}</p>
    <div class="tour-foot"><span class="tour-dots" aria-hidden="true">${dots}</span><span class="spacer"></span>
      ${s.last ? '<a class="btn ghost sm" href="/learn">Open Learn</a>' : '<button type="button" class="link-btn" data-act="skip">Skip tour</button>'}
      ${i > 0 && !s.last ? '<button type="button" class="ghost sm" data-act="back">Back</button>' : ''}
      <button type="button" class="sm" data-act="next">${s.last ? 'Done' : i === 0 ? 'Start tour' : 'Next'}</button></div>`;
  pop.querySelector('[data-act=next]').focus();
  if (!el) { // centred card
    spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
    pop.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%)';
    return;
  }
  el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const r = el.getBoundingClientRect(), pad = 6;
  spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  const pw = Math.min(340, innerWidth - 24), ph = pop.offsetHeight || 170;
  let left, top;
  if (s.place === 'right' && r.right + pw + 24 < innerWidth) { left = r.right + 16; top = Math.max(12, r.top + 24); }
  else { left = Math.min(Math.max(12, r.left), innerWidth - pw - 12); top = r.bottom + 14; if (top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 14); }
  pop.style.cssText = `left:${left}px;top:${top}px;transform:none`;
}

function start() {
  if (root) return;
  steps = STEPS.filter((s) => s.center || visible($(s.target)));
  i = 0;
  root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-pop" role="dialog" aria-modal="true" aria-label="Folio tour"></div>';
  document.body.append(root);
  spot = root.querySelector('.tour-spot'); pop = root.querySelector('.tour-pop');
  pop.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'next') go(1); else if (a === 'back') go(-1); else if (a === 'skip') end();
  });
  root.querySelector('.tour-block').addEventListener('click', () => {});
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', () => root && show(), { passive: true });
  show();
}

document.querySelectorAll('[data-tour-start]').forEach((b) => b.addEventListener('click', () => { document.getElementById('help-menu')?.classList.remove('open'); start(); }));
if (document.body.dataset.tour === '1' && !document.querySelector('dialog[open]')) setTimeout(start, 600);
})();
