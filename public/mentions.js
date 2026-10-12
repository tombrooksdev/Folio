// @mention picker: type "@" in a text area (or the Tasks quick-add box) and choose a person.
// The matching logic is plain functions so it can be tested without a browser.
export const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9._-]{0,32})$/;

// The @word being typed just before the caret, or null.
export function findMention(text, caret) {
  const m = MENTION_RE.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}
// People whose name starts with the query first, then those that contain it. Alphabetical inside each group.
export function rank(names, query, limit = 6) {
  const q = query.toLowerCase();
  const starts = names.filter((n) => n.toLowerCase().startsWith(q));
  const has = names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...starts, ...has].slice(0, limit);
}
export function insertMention(text, caret, mention, name) {
  const before = `${text.slice(0, mention.start)}@${name} `;
  return { text: before + text.slice(caret), caret: before.length };
}

if (typeof document !== 'undefined') {
  let people = null, loading = null;
  const load = () => (people ? Promise.resolve(people) : (loading ??= fetch('/people.json').then((r) => (r.ok ? r.json() : [])).catch(() => []).then((l) => (people = l))));
  let pop = null, field = null, items = [], sel = 0, mention = null;

  const eligible = (el) => el && ((el.tagName === 'TEXTAREA' && !el.hasAttribute('data-no-mention')) || el.id === 'quick-add');

  // where the caret is on screen: measure the text up to it in an invisible copy of the field
  function caretRect(el, pos) {
    const cs = getComputedStyle(el), div = document.createElement('div');
    for (const p of ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'whiteSpace', 'wordBreak', 'overflowWrap', 'textTransform', 'tabSize']) div.style[p] = cs[p];
    div.style.position = 'absolute'; div.style.visibility = 'hidden'; div.style.top = '0'; div.style.left = '-9999px';
    if (el.tagName === 'TEXTAREA') div.style.whiteSpace = 'pre-wrap'; else div.style.whiteSpace = 'pre';
    div.textContent = el.value.slice(0, pos);
    const mark = document.createElement('span'); mark.textContent = '​'; div.append(mark);
    document.body.append(div);
    const box = el.getBoundingClientRect();
    const x = box.left + mark.offsetLeft - el.scrollLeft, y = box.top + mark.offsetTop - el.scrollTop, h = parseFloat(cs.lineHeight) || 20;
    div.remove();
    return { x, y, h };
  }

  function close() {
    if (!pop) return;
    pop.remove(); pop = null;
    if (field) { field.setAttribute('aria-expanded', 'false'); field.removeAttribute('aria-activedescendant'); }
    items = []; mention = null;
  }
  function paint() {
    pop.innerHTML = items.map((n, i) => `<div role="option" id="mention-opt-${i}" class="mention-opt${i === sel ? ' sel' : ''}" aria-selected="${i === sel}" data-i="${i}"><span class="mention-av" aria-hidden="true">${n[0].toUpperCase()}</span><span class="mention-name">${n.replace(/[&<>"']/g, '')}</span></div>`).join('');
    field.setAttribute('aria-activedescendant', `mention-opt-${sel}`);
  }
  function open() {
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'mention-pop'; pop.className = 'mention-pop'; pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', 'People');
      pop.addEventListener('mousedown', (e) => { // choosing must not blur the field
        e.preventDefault();
        const o = e.target.closest('.mention-opt');
        if (o) choose(Number(o.dataset.i));
      });
      document.body.append(pop);
      field.setAttribute('aria-expanded', 'true'); field.setAttribute('aria-controls', 'mention-pop'); field.setAttribute('aria-autocomplete', 'list');
    }
    paint();
    const c = caretRect(field, mention.start + 1), below = c.y + c.h + 4;
    pop.style.left = `${Math.max(8, Math.min(c.x, innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${below + pop.offsetHeight > innerHeight ? Math.max(8, c.y - pop.offsetHeight - 4) : below}px`;
  }
  function choose(i) {
    const name = items[i];
    if (!name || !field) return;
    const r = insertMention(field.value, field.selectionStart, mention, name);
    field.value = r.text;
    field.setSelectionRange(r.caret, r.caret);
    close();
    field.dispatchEvent(new Event('input', { bubbles: true })); // editors and chips update
  }
  async function update(el) {
    if (!eligible(el)) return;
    const m = findMention(el.value, el.selectionStart ?? 0);
    if (!m) { close(); return; }
    const list = rank(await load(), m.query);
    if (!list.length || document.activeElement !== el) { close(); return; }
    field = el; mention = m; items = list; sel = Math.min(sel, list.length - 1);
    open();
  }

  document.addEventListener('input', (e) => { sel = 0; update(e.target); });
  document.addEventListener('click', (e) => { if (pop && !pop.contains(e.target)) close(); });
  document.addEventListener('focusout', (e) => { if (e.target === field) setTimeout(close, 0); });
  document.addEventListener('keydown', (e) => {
    if (!pop || e.target !== field || e.isComposing) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown') { stop(); sel = (sel + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp') { stop(); sel = (sel - 1 + items.length) % items.length; paint(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { stop(); choose(sel); }
    else if (e.key === 'Escape') { stop(); close(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') setTimeout(() => update(field), 0);
  }, true);
}
