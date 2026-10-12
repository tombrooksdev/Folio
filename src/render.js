import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: false });

let allowRemoteImages = false;
export const setAllowRemoteImages = (v) => { allowRemoteImages = !!v; };
const isRemote = (src = '') => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src.trim()) || /^https?:/i.test(src.trim());

const allowed = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'del', 'input', 'details', 'summary']),
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    input: ['type', 'checked', 'disabled'],
    code: ['class'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    // external links open safely; task-list checkboxes are always read-only
    a: (tag, attribs) => (/^https?:/i.test(attribs.href ?? '') ? { tagName: 'a', attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } } : { tagName: 'a', attribs }),
    input: (tag, attribs) => ({ tagName: 'input', attribs: { ...attribs, disabled: 'disabled' } }),
  },
  // only checkboxes may stay (no fake password boxes), and remote images are dropped unless the admin allowed them
  exclusiveFilter: (frame) =>
    (frame.tag === 'input' && frame.attribs.type !== 'checkbox') ||
    (frame.tag === 'img' && (!frame.attribs.src || (!allowRemoteImages && isRemote(frame.attribs.src)))),
};

// Set by the app so "ENG-12" in text can become a link to the issue (returns the issue id, or null).
let keyResolver = null;
export const setKeyResolver = (fn) => { keyResolver = fn; };
let mentionResolver = null; // (username) => boolean
export const setMentionResolver = (fn) => { mentionResolver = fn; };

const PANELS = { NOTE: ['note', 'Note'], INFO: ['info', 'Info'], TIP: ['tip', 'Tip'], SUCCESS: ['success', 'Success'], WARNING: ['warning', 'Warning'], IMPORTANT: ['warning', 'Important'], CAUTION: ['warning', 'Caution'] };

// Confluence-style panels: "> [!INFO]" becomes a coloured callout. Runs after sanitising, on markup we generated ourselves.
function panels(html) {
  return html.replace(/<blockquote>\s*<p>\[!([A-Za-z]+)\][ \t]*(?:<br\s*\/?>)?\s*/g, (m, name) => {
    const p = PANELS[name.toUpperCase()];
    return p ? `<blockquote class="panel panel-${p[0]}"><p class="panel-title">${p[1]}</p><p>` : m;
  });
}

// Turn issue keys in text (not inside links or code) into links.
function linkKeys(html) {
  if (!keyResolver && !mentionResolver) return html;
  let skip = 0;
  return html.split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith('<')) {
      const tag = /^<\/?\s*([a-z0-9]+)/i.exec(part)?.[1]?.toLowerCase();
      if (['a', 'code', 'pre'].includes(tag)) skip += part[1] === '/' ? -1 : 1;
      return part;
    }
    if (skip > 0) return part;
    return part
      .replace(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g, (m, key, n) => {
        const id = keyResolver?.(key, Number(n));
        return id ? `<a class="issue-link" href="/i/${id}">${m}</a>` : m;
      })
      .replace(/(^|[^\w@/])@([A-Za-z0-9._-]{1,32})/g, (m, pre, name) => (mentionResolver?.(name) ? `${pre}<span class="mention">@${name}</span>` : m));
  }).join('');
}

export function renderMarkdown(src) {
  return linkKeys(panels(sanitizeHtml(marked.parse(src ?? ''), allowed)));
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
  subtask: 'M6 3v8a4 4 0 004 4h8M15 11l4 4-4 4',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  bell: 'M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 003.4 0',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.9.7 1.5 1.6 1.5 2.6V17h4v-.5c0-1 .6-1.9 1.5-2.6A6 6 0 0012 3z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  help: 'M9.1 9a3 3 0 115.8 1c-.6 1.3-2.4 1.7-2.9 3M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  user: 'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
  tasks: 'M9 6h11M9 12h11M9 18h11M3.5 6l1.2 1.2L7 4.9M3.5 12l1.2 1.2L7 10.9M3.5 18l1.2 1.2L7 16.9',
  logo: 'M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v6h6M8 13h8M8 17h5',
};
export const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;

export function layout({ title, user, body, sidebar = '', toc = false, bare = false, spaces = [], people = [], spaceKey = '', editUrl = '', unread = 0, tour = false, canWrite = true }) {
  const initial = user ? esc(user.username.slice(0, 1).toUpperCase()) : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Folio</title>
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script></head>
<body${spaceKey ? ` data-space="${esc(spaceKey)}"` : ''}${editUrl ? ` data-edit="${esc(editUrl)}"` : ''}${tour && !bare ? ' data-tour="1"' : ''}>
<div class="progress" id="progress"></div>
${bare ? body : `<header class="top">
  <div class="top-left">
    <a class="brand" href="/">folio<i>.</i></a>
    ${user ? `<button class="icon-btn" type="button" id="side-toggle" aria-label="Toggle sidebar" title="Show or hide the sidebar">${icon('sidebar')}</button>
    ${canWrite ? `<div class="menu-wrap"><button class="create-btn" type="button" id="create-btn" aria-haspopup="true" aria-expanded="false">${icon('plus')}<span>Create</span></button>
      <div class="menu create-menu" id="create-menu" role="menu">
        <button type="button" role="menuitem" data-create="issue">${icon('task')}<span>Issue<small>Story, bug or task</small></span><kbd>C</kbd></button>
        <a role="menuitem" href="${spaces.length ? `/s/${esc(spaceKey || spaces[0].key)}/create` : '/#new-space'}">${icon('file')}<span>Page<small>From a template or blank</small></span></a>
        <a role="menuitem" href="/#new-space">${icon('board')}<span>Space<small>A home for a team or project</small></span></a>
      </div></div>` : ''}` : ''}
  </div>
  ${user ? `<div class="top-right">
    <button class="cmdk-btn" type="button" id="cmdk-open" aria-label="Search">${icon('search')}<span>Search</span><kbd>/</kbd></button>
    <div class="menu-wrap"><button class="icon-btn" type="button" id="bell" aria-label="Notifications" title="Notifications" aria-haspopup="true" aria-expanded="false"><span class="ico">${icon('bell')}<span class="badge" id="bell-count"${unread ? '' : ' hidden'}>${unread > 99 ? '99+' : unread}</span></span></button><div class="menu bell-menu" id="bell-menu"></div></div>
    <div class="menu-wrap"><button class="icon-btn" type="button" id="help-btn" aria-label="Help" title="Help" aria-haspopup="true" aria-expanded="false">${icon('help')}</button>
      <div class="menu help-menu" id="help-menu" role="menu">
        <a role="menuitem" href="/learn">${icon('bulb')}Learn Folio</a>
        <button type="button" role="menuitem" data-tour-start data-close-menu>${icon('play')}Take the tour</button>
        <button type="button" role="menuitem" data-shortcuts>${icon('edit')}Keyboard shortcuts<kbd>?</kbd></button>
        <a role="menuitem" href="/changelog">${icon('file')}What's new</a>
      </div></div>
    <div class="menu-wrap"><button class="icon-btn" type="button" id="theme" aria-label="Choose a theme" title="Theme" aria-haspopup="true" aria-expanded="false">${icon('palette')}</button><div class="menu theme-menu" id="theme-menu" role="menu"></div></div>
    <span class="top-sep" aria-hidden="true"></span>
    <div class="menu-wrap"><button class="avatar-btn" type="button" id="user-btn" aria-label="Account menu for ${esc(user.username)}" aria-haspopup="true" aria-expanded="false"><span class="avatar">${initial}</span></button>
      <div class="menu user-menu" id="user-menu" role="menu">
        <div class="user-head"><span class="avatar">${initial}</span><span><b>${esc(user.username)}</b><small>${esc(user.role === 'admin' ? 'Administrator' : user.role === 'viewer' ? 'Viewer' : 'Member')}</small></span></div>
        <a role="menuitem" href="/account">${icon('settings')}Account and password</a>
        <a role="menuitem" href="/settings/notifications">${icon('bell')}Notification settings</a>
        ${user.role === 'admin' ? `<a role="menuitem" href="/admin/users">${icon('board')}Manage people</a>` : ''}
        <form method="post" action="/logout" class="menu-sep"><button role="menuitem">${icon('arrow')}Sign out</button></form>
      </div></div>
  </div>` : '<span class="spacer"></span>'}
</header>
<div class="shell${sidebar ? ' has-side' : ''}${sidebar && !toc ? ' no-toc' : ''}">
  ${sidebar ? `<nav class="side" aria-label="Pages">${sidebar}</nav>` : ''}
  <main>${body}</main>
  ${sidebar && toc ? '<aside class="toc" id="toc" aria-label="On this page"></aside>' : ''}
</div>`}
${user && !bare ? createDialogs({ spaces, people, spaceKey, canWrite }) : ''}
<div class="cmdk" id="cmdk" role="dialog" aria-modal="true" aria-label="Search">
  <div class="cmdk-box"><input id="cmdk-input" type="search" placeholder="Search every page..." aria-label="Search every page" autocomplete="off"><div class="cmdk-list" id="cmdk-list"></div></div>
</div>
<script src="/app.js"></script>
${user && !bare ? '<script src="/tour.js"></script>' : ''}
</body></html>`;
}

function createDialogs({ spaces, people, spaceKey, canWrite = true }) {
  const keys = [['C', 'Create an issue'], ['/', 'Search'], ['E', 'Edit this page or issue'], ['G then H', 'Go to home'], ['G then B', 'Go to the board'], ['G then L', 'Go to the backlog'], ['G then I', 'Go to issue search'], ['G then T', 'Go to Tasks'], ['N', 'New task (on a Tasks page)'], ['[', 'Show or hide the sidebar'], ['?', 'Show this help']];
  return `${canWrite ? `<dialog class="modal" id="create-issue" aria-labelledby="ci-title">
  <form method="dialog" class="modal-head"><h2 id="ci-title">Create issue</h2><button class="icon-btn" aria-label="Close">${icon('plus')}</button></form>
  <form id="create-issue-form" class="modal-body">
    <label>Space<select name="space" required>${spaces.map((s) => `<option value="${esc(s.key)}"${s.key === spaceKey ? ' selected' : ''}>${esc(s.name)} (${esc(s.key)})</option>`).join('')}</select></label>
    <label>Issue type<select name="type"><option value="story">Story</option><option value="bug">Bug</option><option value="task">Task</option></select></label>
    <label>Summary<input name="title" required autocomplete="off" placeholder="What needs to be done?"></label>
    <label>Description<textarea name="description" rows="5" placeholder="Details (Markdown)"></textarea></label>
    <div class="two"><label>Priority<select name="priority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></label>
      <label>Assignee<select name="assignee_id"><option value="">Unassigned</option>${people.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join('')}</select></label></div>
    <p class="err" id="ci-error" role="alert" hidden></p>
    <div class="modal-foot"><label class="check"><input type="checkbox" id="ci-another"> Create another</label><span class="spacer"></span><button type="button" class="ghost" data-close>Cancel</button><button>Create</button></div>
  </form></dialog>` : ''}
<dialog class="modal" id="shortcuts" aria-labelledby="sc-title"><form method="dialog" class="modal-head"><h2 id="sc-title">Keyboard shortcuts</h2><button class="icon-btn" aria-label="Close">${icon('plus')}</button></form>
  <div class="modal-body"><dl class="keys">${keys.map(([k, d]) => `<dt>${k.split(' then ').map((x) => `<kbd>${x}</kbd>`).join(' then ')}</dt><dd>${d}</dd>`).join('')}</dl></div></dialog>
<div class="toasts" id="toasts" aria-live="polite"></div>`;
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
