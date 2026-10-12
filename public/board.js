// Board and backlog behaviour: drag-and-drop, filters, collapsible sprints, quick-create, inline field edits.
// Cards are links, so a plain click still navigates.
(() => {
let dragged = null;
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function recount() {
  $$('[data-drop]').forEach((zone) => {
    const items = $$('[data-drag]:not([hidden])', zone);
    const total = items.reduce((a, el) => a + Number(el.dataset.points || 0), 0);
    const holder = zone.closest('.column, .sprint-block');
    const count = holder?.querySelector('[data-count]'), pts = holder?.querySelector('[data-points-total]');
    if (count) count.textContent = items.length;
    if (pts) pts.textContent = total;
  });
}
const after = (zone, y) => $$('[data-drag]:not(.dragging)', zone).find((el) => y < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);

document.addEventListener('dragstart', (e) => {
  const el = e.target.closest?.('[data-drag]');
  if (!el) return;
  dragged = el; el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', el.dataset.id);
});
document.addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  $$('.over').forEach((z) => z.classList.remove('over'));
  dragged = null;
});
document.addEventListener('dragover', (e) => {
  const zone = e.target.closest?.('[data-drop]');
  if (!zone || !dragged) return;
  e.preventDefault();
  $$('.over').forEach((z) => z !== zone && z.classList.remove('over'));
  zone.classList.add('over');
  zone.querySelector('.drop-hint')?.remove();
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
  // keep the Done styling honest when a card changes column
  if (zone.dataset.status) dragged.classList.toggle('is-done', zone.dataset.status === 'done');
  recount();
  const res = await fetch(`/issues/${dragged.dataset.id}/move`, { method: 'POST', body });
  if (!res.ok) location.reload();
  $$('.list[data-drop]').forEach((z) => {
    if (!z.querySelector('[data-drag]') && !z.querySelector('.drop-hint')) z.insertAdjacentHTML('beforeend', '<p class="drop-hint muted">Drag issues here</p>');
  });
});

// ---- board filters (search text + assignee) ----
const search = document.getElementById('board-search');
if (search) {
  const users = new Set();
  const mine = document.getElementById('only-mine'), clear = document.getElementById('clear-filters');
  const epic = document.getElementById('epic-filter'), lab = document.getElementById('label-filter');
  const apply = () => {
    const q = search.value.trim().toLowerCase();
    $$('.board [data-drag]').forEach((el) => {
      el.hidden = !((!q || el.dataset.text.includes(q)) && (!users.size || users.has(el.dataset.assignee))
        && (!epic?.value || el.dataset.epic === epic.value) && (!lab?.value || el.dataset.labels.includes(`,${lab.value},`)));
    });
    clear.hidden = !(q || users.size || epic?.value || lab?.value);
    recount();
  };
  search.addEventListener('input', apply);
  epic?.addEventListener('change', apply);
  lab?.addEventListener('change', apply);
  $$('.av-filter').forEach((b) => b.addEventListener('click', () => {
    const u = b.dataset.user;
    users.has(u) ? users.delete(u) : users.add(u);
    b.setAttribute('aria-pressed', users.has(u));
    apply();
  }));
  mine.addEventListener('click', () => {
    users.clear(); users.add(mine.dataset.me);
    $$('.av-filter').forEach((b) => b.setAttribute('aria-pressed', b.dataset.user === mine.dataset.me));
    apply();
  });
  clear.addEventListener('click', () => {
    users.clear(); search.value = '';
    if (epic) epic.value = ''; if (lab) lab.value = '';
    $$('.av-filter').forEach((b) => b.setAttribute('aria-pressed', false));
    apply();
  });
}

// ---- swimlanes: choose grouping, collapse lanes ----
document.getElementById('group-by')?.addEventListener('change', (e) => {
  const u = new URL(location.href);
  e.target.value ? u.searchParams.set('group', e.target.value) : u.searchParams.delete('group');
  location.href = u;
});
$$('.lane-head').forEach((b) => b.addEventListener('click', () => {
  const lane = b.closest('.lane');
  b.setAttribute('aria-expanded', lane.classList.toggle('collapsed') ? 'false' : 'true');
}));

// ---- backlog: collapse sprints, show create forms ----
$$('.collapse').forEach((b) => b.addEventListener('click', () => {
  const block = b.closest('.sprint-block');
  b.setAttribute('aria-expanded', block.classList.toggle('collapsed') ? 'false' : 'true');
}));

// ---- backlog: click an epic to filter every list by it ----
$$('[data-epic-pick]').forEach((b) => b.addEventListener('click', () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  $$('[data-epic-pick]').forEach((o) => o.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', on);
  $$('.sprint-block [data-drag]').forEach((el) => { el.hidden = on && el.dataset.epic !== b.dataset.epicPick; });
  recount();
}));
})();
