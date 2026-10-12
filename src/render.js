import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: false });

const allowed = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'del', 'input', 'details', 'summary']),
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    input: ['type', 'checked', 'disabled'],
    code: ['class'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
};

export function renderMarkdown(src) {
  return sanitizeHtml(marked.parse(src ?? ''), allowed);
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Deterministic colour class per space key, so each space keeps its own hue.
export const hueClass = (key) => "h" + (Math.abs([...String(key)].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261)) % 12);

const PATHS = {
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z',
  sun: 'M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M3 12h2m14 0h2M5.6 18.4L7 17m10-10l1.4-1.4M12 16a4 4 0 100-8 4 4 0 000 8z',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  chevron: 'M9 6l6 6-6 6',
  arrow: 'M5 12h14m-6-6l6 6-6 6',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  bold: 'M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z',
  italic: 'M19 4h-9M14 20H5M15 4L9 20',
  heading: 'M6 4v16M18 4v16M6 12h12',
  link: 'M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  quote: 'M7 7h4v4c0 3-2 5-4 5M15 7h4v4c0 3-2 5-4 5',
  check: 'M5 13l4 4L19 7',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7M8 21v-7h8v7',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  board: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z',
  backlog: 'M4 6h16M4 12h16M4 18h10',
  bug: 'M9 8a3 3 0 016 0v7a3 3 0 01-6 0zM9 12H5m14 0h-4M8 6L5 4m11 2l3-2M9 17l-4 2m10-2l4 2',
  story: 'M7 3h10v18l-5-4-5 4z',
  task: 'M5 5h14v14H5zM9 12l2 2 4-4',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  play: 'M7 5l12 7-12 7z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  palette: 'M12 3a9 9 0 100 18c1.1 0 1.8-.9 1.5-2-.3-1 .3-2 1.4-2H17a4 4 0 004-4c0-5-4-10-9-10zM7.5 12h.01M10 7.5h.01M15 7.5h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  equals: 'M5 9h14M5 15h14',
  branch: 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9',
  paperclip: 'M21 12.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.3',
  logo: 'M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v6h6M8 13h8M8 17h5',
};
export const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;

export function layout({ title, user, body, sidebar = '', toc = false, bare = false }) {
  const initial = user ? esc(user.username.slice(0, 1).toUpperCase()) : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Folio</title>
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script></head>
<body>
<div class="progress" id="progress"></div>
${bare ? body : `<header class="top">
  <a class="brand" href="/">folio<i>.</i></a>
  ${
    user
      ? `<button class="icon-btn" type="button" id="side-toggle" aria-label="Toggle sidebar">${icon('sidebar')}</button>
         <button class="cmdk-btn ghost" type="button" id="cmdk-open" aria-label="Search">${icon('search')}<span>Search pages</span><kbd>Ctrl K</kbd></button>
         <div class="theme-wrap"><button class="icon-btn" type="button" id="theme" aria-label="Choose theme" aria-haspopup="true" aria-expanded="false">${icon('palette')}</button><div class="theme-menu" id="theme-menu" role="menu"></div></div>
         <span class="avatar" title="${esc(user.username)}">${initial}</span>
         <form method="post" action="/logout"><button class="ghost sm">Sign out</button></form>`
      : '<span class="spacer"></span>'
  }
</header>
<div class="shell${sidebar ? ' has-side' : ''}${sidebar && !toc ? ' no-toc' : ''}">
  ${sidebar ? `<nav class="side" aria-label="Pages">${sidebar}</nav>` : ''}
  <main>${body}</main>
  ${sidebar && toc ? '<aside class="toc" id="toc" aria-label="On this page"></aside>' : ''}
</div>`}
<div class="cmdk" id="cmdk" role="dialog" aria-modal="true" aria-label="Search">
  <div class="cmdk-box"><input id="cmdk-input" placeholder="Search every page..." autocomplete="off"><div class="cmdk-list" id="cmdk-list"></div></div>
</div>
<script src="/app.js"></script>
</body></html>`;
}

export function treeHtml(nodes, currentId, open = new Set()) {
  if (!nodes.length) return '';
  return `<ul class="tree">${nodes
    .map((n) => {
      const kids = n.children.length > 0;
      const isOpen = open.has(n.id);
      return `<li${kids ? ` class="has-kids${isOpen ? ' open' : ''}" data-id="${n.id}"` : ''}>
        ${kids ? `<button type="button" class="twisty" aria-label="Expand ${esc(n.title)}" aria-expanded="${isOpen}">${icon('chevron')}</button>` : '<span class="twisty-gap"></span>'}<a href="/p/${n.id}"${n.id === currentId ? ' class="cur" aria-current="page"' : ''}>${esc(n.title)}</a>${treeHtml(n.children, currentId, open)}</li>`;
    })
    .join('')}</ul>`;
}
