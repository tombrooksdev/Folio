// File attachments for pages and issues. Files live on disk (data/uploads), metadata in SQLite.
// Uploads are sent as a raw request body (no multipart parser needed): POST /attachments?space=KEY&page=ID&name=file.png
import express from 'express';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, extname, resolve, join } from 'node:path';
import { esc, icon } from './render.js';

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
};
// Only these are shown inline in the browser; everything else (including SVG and HTML) downloads, so uploads can never run script.
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']);
const isImage = (mime) => mime.startsWith('image/') && INLINE.has(mime);
const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function createFiles({ db, uploadDir, maxBytes = 25 * 1048576 }) {
  const root = resolve(uploadDir);
  mkdirSync(root, { recursive: true });
  const urlFor = (a) => `/files/${a.id}/${encodeURIComponent(a.filename)}`;

  function remove(rows) {
    for (const a of rows) {
      rmSync(join(root, a.stored), { force: true });
      db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    }
  }
  const files = {
    // Attach uploads referenced in a body (e.g. pasted images) to the page/issue once it exists.
    adopt(spaceId, owner, body) {
      const col = 'page_id' in owner ? 'page_id' : 'issue_id';
      for (const m of String(body ?? '').matchAll(/\/files\/(\d+)\//g))
        db.prepare(`UPDATE attachments SET ${col} = ? WHERE id = ? AND space_id = ? AND page_id IS NULL AND issue_id IS NULL`).run(owner[col], Number(m[1]), spaceId);
    },
    // Delete files (and rows) belonging to an owner. A page owner includes its child pages.
    purge(owner) {
      if ('issue_id' in owner) return remove(db.prepare('SELECT * FROM attachments WHERE issue_id = ?').all(owner.issue_id));
      const ids = db.prepare('WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT p.id FROM pages p JOIN t ON p.parent_id = t.id) SELECT id FROM t').all(owner.page_id).map((r) => r.id);
      for (const id of ids) remove(db.prepare('SELECT * FROM attachments WHERE page_id = ?').all(id));
    },
    // Attachment list plus an upload drop zone, for a page or an issue view.
    panel(owner, space) {
      const col = 'page_id' in owner ? 'page_id' : 'issue_id';
      const rows = db.prepare(`SELECT a.*, u.username FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.${col} = ? ORDER BY a.id`).all(owner[col]);
      const back = col === 'page_id' ? `/p/${owner.page_id}` : `/i/${owner.issue_id}`;
      return `<section class="attachments" id="attachments"><h3 class="j-h">Attachments <span class="count">${rows.length}</span></h3>
        ${rows.length ? `<ul class="file-list">${rows.map((a) => `<li>${isImage(a.mime) ? `<a class="thumb" href="${urlFor(a)}" target="_blank" rel="noopener"><img src="${urlFor(a)}" alt="" loading="lazy"></a>` : `<span class="file-ico">${icon('file')}</span>`}
          <div><a href="${urlFor(a)}"${isImage(a.mime) || a.mime === 'application/pdf' ? ' target="_blank" rel="noopener"' : ''}>${esc(a.filename)}</a><span class="muted">${size(a.size)} · ${esc(a.username ?? 'unknown')} · ${esc(a.created_at.slice(0, 10))}</span></div>
          <form method="post" action="/attachments/${a.id}/delete" data-confirm="Delete ${esc(a.filename)}?"><input type="hidden" name="back" value="${back}"><button class="danger sm" aria-label="Delete ${esc(a.filename)}">${icon('trash')}</button></form></li>`).join('')}</ul>` : ''}
        <label class="dropzone" data-upload data-space="${esc(space.key)}" data-${col.replace('_', '-')}="${owner[col]}"><input type="file" multiple hidden>${icon('download')}<span>Drop files here or <u>browse</u></span></label>
      </section><script src="/files.js"></script>`;
    },
    mount(app, { getSpace }) {
      const rawBody = express.raw({ type: () => true, limit: maxBytes });
      app.post('/attachments', rawBody, (req, res) => {
        const space = getSpace(String(req.query.space ?? ''));
        if (!space) return res.status(404).json({ error: 'No such space' });
        let pageId = null, issueId = null;
        if (req.query.page) { const p = db.prepare('SELECT id FROM pages WHERE id = ? AND space_id = ?').get(Number(req.query.page), space.id); if (!p) return res.status(404).json({ error: 'No such page' }); pageId = p.id; }
        if (req.query.issue) { const i = db.prepare('SELECT id FROM issues WHERE id = ? AND space_id = ?').get(Number(req.query.issue), space.id); if (!i) return res.status(404).json({ error: 'No such issue' }); issueId = i.id; }
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty file' });
        const filename = basename(String(req.query.name ?? 'file')).replace(/[\u0000-\u001f"\\/]/g, '').trim().slice(0, 120) || 'file';
        const mime = MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream';
        const stored = randomUUID();
        writeFileSync(join(root, stored), req.body);
        const id = Number(db.prepare('INSERT INTO attachments (space_id, page_id, issue_id, filename, mime, size, stored, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(space.id, pageId, issueId, filename, mime, req.body.length, stored, req.user.id).lastInsertRowid);
        const url = urlFor({ id, filename });
        res.json({ id, url, filename, image: isImage(mime), markdown: isImage(mime) ? `![${filename}](${url})` : `[${filename}](${url})` });
      });
      app.get('/files/:id/:name?', (req, res) => {
        const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
        const abs = a && join(root, a.stored);
        if (!a || !existsSync(abs)) return res.status(404).send('No such file');
        res.set({
          'Content-Type': a.mime,
          'Content-Disposition': `${INLINE.has(a.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          'Cache-Control': 'private, max-age=3600',
        });
        res.sendFile(abs);
      });
      app.post('/attachments/:id/delete', (req, res) => {
        const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
        if (!a) return res.status(404).send('No such file');
        remove([a]);
        const back = String(req.body.back ?? '');
        res.redirect(/^\/(p|i)\/\d+$/.test(back) ? back : '/');
      });
      // JSON errors for oversized uploads
      app.use('/attachments', (err, req, res, next) => (err?.type === 'entity.too.large' ? res.status(413).json({ error: `File is larger than ${Math.round(maxBytes / 1048576)} MB` }) : next(err)));
    },
  };
  return files;
}
