// Line diff (longest common subsequence) for comparing page versions.
import { esc } from './render.js';

export function diffLines(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  if (x.length * y.length > 1e6) return [...x.map((t) => ({ t: 'del', s: t })), ...y.map((t) => ({ t: 'add', s: t }))]; // too big: show as replaced
  const n = x.length, m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: 'same', s: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: 'del', s: x[i++] });
    else out.push({ t: 'add', s: y[j++] });
  }
  while (i < n) out.push({ t: 'del', s: x[i++] });
  while (j < m) out.push({ t: 'add', s: y[j++] });
  return out;
}

// Render a diff as a table, folding long unchanged stretches (keeps 3 lines of context).
export function diffHtml(lines) {
  const keep = new Set();
  lines.forEach((l, i) => { if (l.t !== 'same') for (let k = i - 3; k <= i + 3; k++) keep.add(k); });
  const rows = [];
  let folded = 0;
  lines.forEach((l, i) => {
    if (l.t === 'same' && !keep.has(i)) { folded++; return; }
    if (folded) { rows.push(`<tr class="fold"><td colspan="2">${folded} unchanged line${folded === 1 ? '' : 's'}</td></tr>`); folded = 0; }
    const sign = l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ';
    rows.push(`<tr class="${l.t}"><td class="sign">${sign}</td><td class="line">${esc(l.s) || '&nbsp;'}</td></tr>`);
  });
  if (folded) rows.push(`<tr class="fold"><td colspan="2">${folded} unchanged line${folded === 1 ? '' : 's'}</td></tr>`);
  const changed = lines.filter((l) => l.t !== 'same').length;
  return changed ? `<table class="diff">${rows.join('')}</table>` : '<p class="muted">No differences.</p>';
}
