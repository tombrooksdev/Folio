// Markdown editor: live preview, formatting toolbar, shortcuts, word count, unsaved indicator, delete confirm.
(() => {
const body = document.getElementById('body');
const preview = document.getElementById('preview');
const form = document.getElementById('edit-form');
const dot = document.getElementById('dot');
const words = document.getElementById('words');
let timer, dirty = false;

async function refresh() {
  const res = await fetch('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ body: body.value }),
  });
  preview.innerHTML = await res.text();
}
function count() {
  const n = (body.value.match(/\S+/g) ?? []).length;
  words.textContent = `${n} word${n === 1 ? '' : 's'} · ${Math.max(1, Math.round(n / 220))} min read`;
}
body.addEventListener('input', () => {
  dirty = true; dot.classList.add('dirty'); count();
  clearTimeout(timer); timer = setTimeout(refresh, 250);
});
form.addEventListener('submit', () => { dirty = false; });
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// wrap the selection (or insert a placeholder) with markdown syntax
function wrap(before, after = before, placeholder = 'text') {
  const { selectionStart: s, selectionEnd: e, value } = body;
  const sel = value.slice(s, e) || placeholder;
  body.setRangeText(before + sel + after, s, e, 'select');
  body.setSelectionRange(s + before.length, s + before.length + sel.length);
  body.focus(); body.dispatchEvent(new Event('input'));
}
function linePrefix(prefix) {
  const { selectionStart: s, value } = body;
  const start = value.lastIndexOf('\n', s - 1) + 1;
  body.setRangeText(prefix, start, start, 'end');
  body.focus(); body.dispatchEvent(new Event('input'));
}
const actions = {
  bold: () => wrap('**'), italic: () => wrap('*'), code: () => wrap('`', '`', 'code'),
  heading: () => linePrefix('## '), list: () => linePrefix('- '), quote: () => linePrefix('> '),
  link: () => wrap('[', '](https://)', 'link text'),
};
document.querySelectorAll('[data-md]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.md]()));
body.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 's') { e.preventDefault(); form.requestSubmit(); }
  if (mod && e.key === 'b') { e.preventDefault(); actions.bold(); }
  if (mod && e.key === 'i') { e.preventDefault(); actions.italic(); }
  if (e.key === 'Tab') { e.preventDefault(); body.setRangeText('  ', body.selectionStart, body.selectionEnd, 'end'); }
});
// ---- draft autosave (like Confluence): keep unsaved work in this browser and offer to restore it ----
const titleInput = form.elements.title;
const key = `folio-draft:${location.pathname}`;
const banner = document.getElementById('draft-banner');
const save = () => { try { localStorage.setItem(key, JSON.stringify({ title: titleInput.value, body: body.value, at: Date.now() })); } catch {} };
let draftTimer;
const queueSave = () => { clearTimeout(draftTimer); draftTimer = setTimeout(save, 800); };
body.addEventListener('input', queueSave);
titleInput.addEventListener('input', () => { dirty = true; dot.classList.add('dirty'); queueSave(); });
form.addEventListener('submit', () => { try { localStorage.removeItem(key); } catch {} });
try {
  const draft = JSON.parse(localStorage.getItem(key) || 'null');
  if (draft && (draft.body !== body.value || draft.title !== titleInput.value)) {
    document.getElementById('draft-text').textContent = `Unsaved draft from ${new Date(draft.at).toLocaleString()}`;
    banner.hidden = false;
    document.getElementById('draft-restore').addEventListener('click', () => {
      titleInput.value = draft.title; body.value = draft.body; banner.hidden = true;
      body.dispatchEvent(new Event('input'));
    });
    document.getElementById('draft-discard').addEventListener('click', () => { localStorage.removeItem(key); banner.hidden = true; });
  }
} catch {}

count(); refresh();
})();
