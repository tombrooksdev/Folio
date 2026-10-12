// File attachments for pages and issues. Files live on disk (data/uploads), metadata in SQLite.
// Uploads are sent as a raw request body (no multipart parser needed): POST /attachments?space=KEY&page=ID&name=file.png
import { mkdirSync, rmSync, existsSync, createWriteStream, openSync, readSync, closeSync, chmodSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { wrap } from './util.js';
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

// The first bytes of an image or PDF must match its extension, so a renamed HTML file can never be served inline.
const startsWith = (b, sig, at = 0) => sig.every((x, i) => b[at + i] === x);
const SNIFF = {
  '.png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]),
  '.jpg': (b) => startsWith(b, [0xff, 0xd8, 0xff]), '.jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  '.gif': (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]),
  '.webp': (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  '.avif': (b) => startsWith(b, [0x66, 0x74, 0x79, 0x70], 4),
  '.pdf': (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
};
function head(path, n = 16) {
  const fd = openSync(path, 'r');
  try { const b = Buffer.alloc(n); const got = readSync(fd, b, 0, n, 0); return b.subarray(0, got); } finally { closeSync(fd); }
}

export function createFiles({ db, uploadDir, maxBytes = 25 * 1048576, maxStorageBytes = 2048 * 1048576 }) {
  const root = resolve(uploadDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // Tighten anything created by an older version (best effort; only touches our own uploads folder).
  try { chmodSync(root, 0o700); for (const name of readdirSync(root)) chmodSync(join(root, name), 0o600); } catch { /* not the owner */ }
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
      if ('task_id' in owner) return remove(db.prepare('SELECT * FROM attachments WHERE task_id = ?').all(owner.task_id));
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
    // Files on a task: a compact list for the Tasks detail pane. Uploading is done by the Tasks page script.
    taskPanel(task, back, { upload, canDelete }) {
      const rows = db.prepare('SELECT a.*, u.username FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.task_id = ? ORDER BY a.id').all(task.id);
      return `<section class="attachments t-files"><h3>Attachments <span class="count">${rows.length}</span></h3>
        ${rows.length ? `<ul class="file-list">${rows.map((a) => `<li>${isImage(a.mime) ? `<a class="thumb" href="${urlFor(a)}" target="_blank" rel="noopener"><img src="${urlFor(a)}" alt="" loading="lazy"></a>` : `<span class="file-ico">${icon('file')}</span>`}
          <div><a href="${urlFor(a)}"${isImage(a.mime) || a.mime === 'application/pdf' ? ' target="_blank" rel="noopener"' : ''}>${esc(a.filename)}</a><span class="muted">${size(a.size)} · ${esc(a.username ?? 'unknown')}</span></div>
          ${canDelete(a) ? `<form method="post" action="/attachments/${a.id}/delete" data-confirm="Delete ${esc(a.filename)}?"><input type="hidden" name="back" value="${esc(back)}"><button class="danger sm" aria-label="Delete ${esc(a.filename)}">${icon('trash')}</button></form>` : ''}</li>`).join('')}</ul>` : ''}
        ${upload ? `<label class="dropzone" data-task-upload="${task.id}"><input type="file" multiple hidden aria-label="Attach files to this task">${icon('download')}<span>Drop files here or <u>browse</u></span></label>` : ''}
      </section>`;
    },
    // Delete attachments that were never attached to anything (abandoned drafts) after a day.
    purgeOrphans() {
      remove(db.prepare("SELECT * FROM attachments WHERE page_id IS NULL AND issue_id IS NULL AND task_id IS NULL AND created_at < datetime('now', '-1 day')").all());
    },
    mount(app, ctx) {
      const { getSpace } = ctx;
      files.purgeOrphans();
      setInterval(() => files.purgeOrphans(), 864e5).unref();

      app.post('/attachments', wrap(async (req, res) => {
        // A file on a task has no space; the Tasks module says who may add to it (and hides it from everyone else).
        const taskId = req.query.task ? Number(req.query.task) : null;
        const taskRule = taskId ? ctx.taskFiles?.(req.user, taskId) : null;
        if (taskId && !taskRule) return res.status(404).json({ error: 'No such task' });
        if (taskId && !taskRule.upload) return res.status(403).json({ error: 'You cannot add files to this task' });
        if (taskId && db.prepare('SELECT COUNT(*) n FROM attachments WHERE task_id = ?').get(taskId).n >= 20) return res.status(400).json({ error: 'A task can have up to 20 files' });
        const space = taskId ? null : getSpace(String(req.query.space ?? ''));
        if (!taskId && !space) return res.status(404).json({ error: 'No such space' });
        let pageId = null, issueId = null;
        if (req.query.page) { const p = db.prepare('SELECT id FROM pages WHERE id = ? AND space_id = ?').get(Number(req.query.page), space.id); if (!p) return res.status(404).json({ error: 'No such page' }); pageId = p.id; }
        if (req.query.issue) { const i = db.prepare('SELECT id FROM issues WHERE id = ? AND space_id = ?').get(Number(req.query.issue), space.id); if (!i) return res.status(404).json({ error: 'No such issue' }); issueId = i.id; }
        const used = db.prepare('SELECT COALESCE(SUM(size), 0) n FROM attachments').get().n;
        const declared = Number(req.get('content-length') ?? 0);
        const tooBig = () => res.status(413).json({ error: `File is larger than ${Math.round(maxBytes / 1048576)} MB` });
        const full = () => res.status(413).json({ error: 'This Folio has reached its attachment storage limit' });
        if (declared > maxBytes) { req.resume(); return tooBig(); }
        if (used + declared > maxStorageBytes) { req.resume(); return full(); }

        const filename = basename(String(req.query.name ?? 'file')).replace(/[\u0000-\u001f"\\/]/g, '').trim().slice(0, 120) || 'file';
        const ext = extname(filename).toLowerCase();
        const mime = MIME[ext] ?? 'application/octet-stream';
        const stored = randomUUID();
        const path = join(root, stored);
        // Stream to disk with a byte counter instead of buffering the whole upload in memory.
        let size = 0, over = false;
        const counter = new Transform({
          transform(chunk, enc, cb) {
            size += chunk.length;
            if (size > maxBytes || used + size > maxStorageBytes) { over = true; return size > maxBytes * 4 ? cb(new Error('upload aborted')) : cb(); } // keep reading so the client gets a clean 413
            cb(null, chunk);
          },
        });
        try {
          await pipeline(req, counter, createWriteStream(path, { mode: 0o600, flags: 'wx' }));
        } catch (e) { rmSync(path, { force: true }); throw e; }
        if (over) { rmSync(path, { force: true }); return size > maxBytes ? tooBig() : full(); }
        if (!size) { rmSync(path, { force: true }); return res.status(400).json({ error: 'Empty file' }); }
        if (SNIFF[ext] && !SNIFF[ext](head(path))) { rmSync(path, { force: true }); return res.status(415).json({ error: `The contents of ${filename} do not match its type` }); }
        const id = Number(db.prepare('INSERT INTO attachments (space_id, page_id, issue_id, task_id, filename, mime, size, stored, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(space?.id ?? null, pageId, issueId, taskId, filename, mime, size, stored, req.user.id).lastInsertRowid);
        const url = urlFor({ id, filename });
        res.json({ id, url, filename, image: isImage(mime), markdown: isImage(mime) ? `![${filename}](${url})` : `[${filename}](${url})` });
      }));
      app.get('/files/:id/:name?', (req, res) => {
        const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
        const abs = a && join(root, a.stored);
        if (!a || !existsSync(abs)) return res.status(404).send('No such file');
        if (a.task_id && !ctx.taskFiles?.(req.user, a.task_id)) return res.status(404).send('No such file'); // a private task's files stay private
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
        if (a.task_id) {
          const rule = ctx.taskFiles?.(req.user, a.task_id);
          if (!rule) return res.status(404).send('No such file');
          if (a.uploaded_by !== req.user.id && !rule.edit) return res.status(403).send('Only the person who uploaded a file, or someone who can edit the task, can delete it');
        } else if (a.uploaded_by !== req.user.id && req.user.role !== 'admin') return res.status(403).send('Only the person who uploaded a file, or an administrator, can delete it');
        remove([a]);
        const back = String(req.body.back ?? '');
        res.redirect(/^\/(p|i)\/\d+$/.test(back) || /^\/tasks(?:[/?][^\r\n\\]*)?$/.test(back) ? back : '/');
      });
    },
  };
  return files;
}
