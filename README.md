# Folio

A small self-hosted wiki: spaces, nested pages, Markdown with live preview, full-text search, version history. One process, one SQLite file, no subscriptions.

## Run locally
Requires Node 22.5+.

    npm install
    npm start        # http://localhost:3000, first visit creates the admin account

## Host it
    docker compose up -d --build

Put it behind HTTPS (Caddy/nginx/Plesk) and set `FOLIO_SECURE_COOKIES=1` and `FOLIO_TRUST_PROXY=1`.

## Backup
Everything lives in `data/folio.db`. Back up with `sqlite3 data/folio.db ".backup backup.db"` (safe while running).

## Layout
- `src/db.js` schema, FTS5 search, tree helper
- `src/auth.js` scrypt passwords, hashed session tokens, login throttle
- `src/app.js` all routes (server-rendered)
- `src/render.js` Markdown → sanitised HTML, page layout
- `test/` run with `npm test`

## Roadmap ideas
Attachments/image upload, multiple users and roles, page moving/reordering, page templates, comments, a WYSIWYG editor.
