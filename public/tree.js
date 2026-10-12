// Reorder pages in the sidebar tree by dragging. Drop on the top quarter of a page to go before it, the bottom
// quarter to go after it, and the middle to become its child. The editor also has Move up / Move down buttons.
(() => {
const links = () => [...document.querySelectorAll('.tree li[data-page] > a')];
let dragId = null;
const zone = (e, a) => {
  const r = a.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
};
const clear = () => links().forEach((a) => a.classList.remove('drop-before', 'drop-after', 'drop-inside'));
links().forEach((a) => { a.draggable = true; });
document.addEventListener('dragstart', (e) => {
  const li = e.target.closest?.('.tree li[data-page]');
  if (!li || !e.target.closest('.tree li > a')) return;
  dragId = li.dataset.page;
  e.dataTransfer.setData('text/x-folio-tree', dragId);
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => {
  const a = dragId && e.target.closest?.('.tree li[data-page] > a');
  if (!a || a.parentElement.dataset.page === dragId) return;
  e.preventDefault();
  clear();
  a.classList.add(`drop-${zone(e, a)}`);
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget?.closest?.('.tree')) clear(); });
document.addEventListener('dragend', () => { dragId = null; clear(); });
document.addEventListener('drop', async (e) => {
  const a = dragId && e.target.closest?.('.tree li[data-page] > a');
  if (!a) return;
  e.preventDefault();
  const target = a.parentElement.dataset.page, where = zone(e, a), id = dragId;
  dragId = null; clear();
  if (target === id) return;
  // a page cannot go inside its own descendants; the server refuses too, but there is no need to ask
  if (a.closest(`.tree li[data-page="${id}"]`)) return;
  const r = await fetch(`/p/${id}/move`, { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, body: new URLSearchParams({ target, where }) });
  if (r.ok) {
    if (where === 'inside') try { const open = new Set(JSON.parse(localStorage.getItem('folio-open-nodes') || '[]')); open.add(target); localStorage.setItem('folio-open-nodes', JSON.stringify([...open])); } catch {}
    location.reload();
  }
});
})();
