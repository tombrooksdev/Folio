// Attachments: upload from a drop zone, and paste / drop / attach images into the Markdown editors.
(() => {
async function upload(file, scope) {
  const q = new URLSearchParams({ space: scope.space, name: file.name });
  if (scope.page) q.set('page', scope.page);
  if (scope.issue) q.set('issue', scope.issue);
  const res = await fetch(`/attachments?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
  return res.json();
}

// drop zones on page / issue views
document.querySelectorAll('[data-upload]').forEach((zone) => {
  const scope = { space: zone.dataset.space, page: zone.dataset.pageId, issue: zone.dataset.issueId };
  const input = zone.querySelector('input[type=file]');
  async function send(list) {
    zone.classList.add('busy');
    try { for (const f of list) await upload(f, scope); location.reload(); }
    catch (e) { zone.classList.remove('busy'); alert(e.message); }
  }
  input.addEventListener('change', () => send(input.files));
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, () => zone.classList.remove('over')));
  zone.addEventListener('drop', (e) => { e.preventDefault(); send(e.dataTransfer.files); });
});

// Markdown editors (page editor and issue form): insert a link / image at the cursor
const form = document.querySelector('form[data-upload-space]');
const area = form?.querySelector('textarea');
if (area) {
  const scope = { space: form.dataset.uploadSpace, page: form.dataset.uploadPage, issue: form.dataset.uploadIssue };
  async function attach(list) {
    for (const f of list) {
      const name = /^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? `pasted-${Date.now()}.${f.type.split('/')[1] || 'png'}` : f.name;
      const placeholder = `![Uploading ${name}...]()`;
      area.setRangeText(`${placeholder}\n`, area.selectionStart, area.selectionEnd, 'end');
      try {
        const r = await upload(new File([f], name, { type: f.type }), scope);
        area.value = area.value.replace(placeholder, r.markdown);
      } catch (e) {
        area.value = area.value.replace(`${placeholder}\n`, '');
        alert(e.message);
      }
      area.dispatchEvent(new Event('input'));
    }
  }
  area.addEventListener('paste', (e) => {
    const list = [...(e.clipboardData?.files ?? [])];
    if (list.length) { e.preventDefault(); attach(list); }
  });
  area.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  area.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files.length) { e.preventDefault(); attach([...e.dataTransfer.files]); }
  });
  const btn = document.getElementById('attach-btn'), pick = document.getElementById('attach-input');
  btn?.addEventListener('click', () => pick.click());
  pick?.addEventListener('change', () => { attach([...pick.files]); pick.value = ''; });
}
})();
