// Confluence-style page comments: top-level comments with one level of replies.
import { esc, icon, renderMarkdown, hueClass } from './render.js';

const av = (name) => `<span class="avatar sm-av ${hueClass(name ?? '?')}" title="${esc(name ?? '')}">${esc((name ?? '?').slice(0, 1).toUpperCase())}</span>`;

export function commentCount(db, pageId) {
  return db.prepare('SELECT COUNT(*) n FROM page_comments WHERE page_id = ?').get(pageId).n;
}

export function commentsPanel(db, page, user) {
  const all = db.prepare('SELECT c.*, u.username FROM page_comments c LEFT JOIN users u ON u.id = c.author_id WHERE page_id = ? ORDER BY c.id').all(page.id);
  const tops = all.filter((c) => !c.parent_id);
  const one = (c, reply) => `<div class="pc${reply ? ' reply' : ''}" id="c${c.id}">${av(c.username)}<div class="pc-body">
      <div class="pc-head"><b>${esc(c.username ?? 'Deleted user')}</b> <span class="muted">${esc(c.created_at.slice(0, 16))} UTC</span></div>
      <div class="doc">${renderMarkdown(c.body)}</div>
      <div class="pc-actions">${reply ? '' : `<button type="button" class="link-btn" data-toggle="reply-${c.id}">Reply</button>`}
        ${c.author_id === user.id ? `<form method="post" action="/comments/${c.id}/delete" data-confirm="Delete this comment${reply ? '' : ' and its replies'}?"><button class="link-btn danger-text">Delete</button></form>` : ''}</div>
      ${reply ? '' : `<form class="reply-form" id="reply-${c.id}" hidden method="post" action="/p/${page.id}/comments"><input type="hidden" name="parent_id" value="${c.id}"><textarea name="body" rows="2" placeholder="Write a reply..." aria-label="Reply" required></textarea><button class="sm">Reply</button></form>`}</div></div>`;
  return `<section class="page-comments" id="comments"><h3 class="j-h">Comments <span class="count">${all.length}</span></h3>
    ${tops.map((c) => `<div class="thread">${one(c, false)}${all.filter((r) => r.parent_id === c.id).map((r) => one(r, true)).join('')}</div>`).join('') || '<p class="muted">No comments yet. Start the conversation.</p>'}
    <form class="comment-form" method="post" action="/p/${page.id}/comments">${av(user.username)}<div><textarea name="body" rows="3" placeholder="Add a comment (Markdown)" aria-label="Comment" required></textarea><button class="sm">${icon('plus')}Comment</button></div></form></section>`;
}

export function mountComments(app, { db }) {
  app.post('/p/:id/comments', (req, res) => {
    const p = db.prepare('SELECT id FROM pages WHERE id = ?').get(Number(req.params.id));
    if (!p) return res.status(404).send('No such page');
    const body = (req.body.body ?? '').trim();
    let parent = null;
    if (req.body.parent_id) {
      parent = db.prepare('SELECT id, parent_id FROM page_comments WHERE id = ? AND page_id = ?').get(Number(req.body.parent_id), p.id);
      if (!parent) return res.status(400).send('Bad parent');
    }
    if (body) {
      const r = db.prepare('INSERT INTO page_comments (page_id, parent_id, author_id, body) VALUES (?, ?, ?, ?)').run(p.id, parent ? parent.parent_id ?? parent.id : null, req.user.id, body);
      return res.redirect(`/p/${p.id}#c${r.lastInsertRowid}`);
    }
    res.redirect(`/p/${p.id}#comments`);
  });
  app.post('/comments/:id/delete', (req, res) => {
    const c = db.prepare('SELECT * FROM page_comments WHERE id = ?').get(Number(req.params.id));
    if (!c) return res.status(404).send('No such comment');
    if (c.author_id !== req.user.id) return res.status(403).send('You can only delete your own comments');
    db.prepare('DELETE FROM page_comments WHERE id = ?').run(c.id);
    res.redirect(`/p/${c.page_id}#comments`);
  });
}
