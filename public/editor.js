// Live Markdown preview (debounced) and delete confirmation. CSP forbids inline scripts, so this lives in a file.
const body = document.getElementById('body');
const preview = document.getElementById('preview');
let timer;
async function refresh() {
  const res = await fetch('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ body: body.value }),
  });
  preview.innerHTML = await res.text();
}
body.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 300); });
refresh();
document.querySelectorAll('form[data-confirm]').forEach((f) =>
  f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));
