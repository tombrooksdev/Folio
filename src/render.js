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

export function layout({ title, user, body, sidebar = '', q = '' }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Folio</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<header class="top">
  <a class="brand" href="/">Folio</a>
  ${
    user
      ? `<form class="search" action="/search"><input name="q" value="${esc(q)}" placeholder="Search all pages" aria-label="Search"></form>
         <span class="who">${esc(user.username)}</span>
         <form method="post" action="/logout"><button class="link">Sign out</button></form>`
      : ''
  }
</header>
<div class="shell${sidebar ? ' has-side' : ''}">
  ${sidebar ? `<nav class="side">${sidebar}</nav>` : ''}
  <main>${body}</main>
</div>
</body></html>`;
}

export function treeHtml(nodes, currentId) {
  if (!nodes.length) return '';
  return `<ul>${nodes
    .map(
      (n) =>
        `<li><a href="/p/${n.id}"${n.id === currentId ? ' class="cur"' : ''}>${esc(n.title)}</a>${treeHtml(n.children, currentId)}</li>`
    )
    .join('')}</ul>`;
}
