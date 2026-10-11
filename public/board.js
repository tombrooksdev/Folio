// Drag-and-drop for the board and backlog, plus confirm prompts. Cards are links, so a plain click still navigates.
(() => {
let dragged = null;

function placeholderFor(zone) { return zone.querySelector('.drop-hint'); }

function recount() {
  document.querySelectorAll('[data-drop]').forEach((zone) => {
    const items = zone.querySelectorAll('[data-drag]');
    const total = [...items].reduce((a, el) => a + Number(el.dataset.points || 0), 0);
    const holder = zone.closest('.column, .sprint-block');
    holder?.querySelector('[data-count]') && (holder.querySelector('[data-count]').textContent = items.length);
    holder?.querySelector('[data-points-total]') && (holder.querySelector('[data-points-total]').textContent = total);
  });
}

function after(zone, y) {
  // the card the pointer is above, so we can insert before it
  return [...zone.querySelectorAll('[data-drag]:not(.dragging)')].find((el) => {
    const r = el.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
}

document.addEventListener('dragstart', (e) => {
  const el = e.target.closest?.('[data-drag]');
  if (!el) return;
  dragged = el;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', el.dataset.id);
});
document.addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  document.querySelectorAll('.over').forEach((z) => z.classList.remove('over'));
  dragged = null;
});
document.addEventListener('dragover', (e) => {
  const zone = e.target.closest?.('[data-drop]');
  if (!zone || !dragged) return;
  e.preventDefault();
  document.querySelectorAll('.over').forEach((z) => z !== zone && z.classList.remove('over'));
  zone.classList.add('over');
  placeholderFor(zone)?.remove();
  const next = after(zone, e.clientY);
  next ? zone.insertBefore(dragged, next) : zone.append(dragged);
});
document.addEventListener('drop', async (e) => {
  const zone = e.target.closest?.('[data-drop]');
  if (!zone || !dragged) return;
  e.preventDefault();
  zone.classList.remove('over');
  const body = new URLSearchParams();
  if (zone.dataset.status) body.set('status', zone.dataset.status);
  if ('sprint' in zone.dataset) body.set('sprint', zone.dataset.sprint);
  const next = dragged.nextElementSibling?.closest('[data-drag]');
  body.set('before', next ? next.dataset.id : '');
  recount();
  const res = await fetch(`/issues/${dragged.dataset.id}/move`, { method: 'POST', body });
  if (!res.ok) location.reload();
  document.querySelectorAll('.list[data-drop]').forEach((z) => {
    if (!z.querySelector('[data-drag]') && !z.querySelector('.drop-hint')) z.insertAdjacentHTML('beforeend', '<p class="drop-hint muted">Drag issues here</p>');
  });
});

document.querySelectorAll('form[data-confirm]').forEach((f) =>
  f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));
})();
