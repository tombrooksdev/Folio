<div align="center">

# folio<span>.</span>

**A self-hosted wiki and Scrum board in one small app. Your docs, your sprints, your server, no subscription.**

[![License: MIT](https://img.shields.io/badge/license-MIT-c44a1f.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-161513.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/runtime%20deps-3-161513.svg)](package.json)
[![Docker](https://img.shields.io/badge/docker-ready-c44a1f.svg)](docker-compose.yml)

Built by [tombrooks.dev](https://tombrooks.dev)

![Folio sprint board](docs/screenshots/board.png)

</div>

---

## Why Folio?

Confluence and Jira are brilliant, and priced like it. Folio is the 20% of both that most small teams use 90% of the time:

- **Write things down** in spaces and nested pages, with Markdown, live preview, version history and instant search.
- **Plan and run sprints** with a backlog, a drag-and-drop board and story points.
- **Own it.** One Node process, one SQLite file, three runtime dependencies. Back it up by copying a file. Read the entire source in an afternoon.

## Features

**Wiki**
- Spaces with nested page trees and a Confluence-style sidebar (collapsible nodes, remembered per browser)
- Markdown editor with live preview, formatting toolbar, shortcuts, word count and unsaved-changes warning
- Version history with one-click restore
- Full-text search (SQLite FTS5, word-stem matching, highlighted snippets) and a <kbd>Ctrl</kbd>+<kbd>K</kbd> command palette
- Per-page "On this page" outline with scroll-spy, heading anchors, copy buttons on code blocks
- Export any page as `.md`

**Scrum**
- A board and a backlog in every space
- Sprints: create, plan, start (1-4 weeks), complete (unfinished work returns to the backlog)
- Issues: story / bug / task, priority, story points, assignee, Markdown description, comments
- Drag and drop to reorder, move between sprints, and change status
- Sprint progress with points done and days left, plus burndown, velocity and sprint history reports
- Jira-style layout: filters, status lozenges, issue-type icons, a two-column issue view with inline editing
- Issue keys like `ENG-12`

**Make it yours**
- **11 built-in themes** (5 light, 6 dark), defaulting to the tombrooks.dev palette
- Respects `prefers-reduced-motion`; keyboard accessible; a high-contrast theme is included
- Fonts are bundled, so the app makes zero external requests

**Operations**
- Docker image and Compose file with a health check
- Hashed passwords (scrypt) and session tokens, login throttling, CSRF origin checks, a strict Content Security Policy, and sanitised Markdown
- `npm run backup` and `npm run add-user`

## Screenshots

| Wiki article | Editor |
|---|---|
| ![Article](docs/screenshots/article.png) | ![Editor](docs/screenshots/editor.png) |

| Backlog | Issue |
|---|---|
| ![Backlog](docs/screenshots/backlog.png) | ![Issue](docs/screenshots/issue.png) |

| Velocity and sprint history | Sprint burndown |
|---|---|
| ![Reports](docs/screenshots/reports.png) | ![Sprint report](docs/screenshots/sprint-report.png) |

| Home |
|---|
| ![Home](docs/screenshots/home.png) |

### Themes

Pick one from the palette icon in the top bar. Your choice is remembered in your browser.

| tombrooks.dev dark | Midnight |
|---|---|
| ![tombrooks dark](docs/screenshots/theme-tombrooks-dark.png) | ![Midnight](docs/screenshots/theme-midnight.png) |

| Sage | Dracula |
|---|---|
| ![Sage](docs/screenshots/theme-sage.png) | ![Dracula](docs/screenshots/theme-dracula.png) |

Also included: Paper, Blush, Solarized, Forest, Nord and High contrast.

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/tombrooksdev/Folio.git
cd folio
docker compose up -d --build
```

Open <http://localhost:3000>. The first visit asks you to create the administrator account.

Your data lives in `./data/folio.db`, which is mounted into the container, so it survives rebuilds and upgrades. The container restarts automatically after a reboot.

### Node

Requires **Node.js 22.5 or newer** (Folio uses the built-in `node:sqlite` module, so there is nothing native to compile).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # restart on file changes
npm test           # run the test suite
```

## Configuration

Folio is configured with environment variables.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to listen on. |
| `FOLIO_DB` | `./data/folio.db` (`/data/folio.db` in Docker) | Path to the SQLite database. |
| `FOLIO_SECURE_COOKIES` | `0` | Set to `1` when served over HTTPS so cookies are marked `Secure`. |
| `FOLIO_TRUST_PROXY` | `0` | Set to `1` when behind a reverse proxy so the real client IP is used for login throttling. |

## Deploying

Run Folio behind a reverse proxy that terminates HTTPS, then set `FOLIO_SECURE_COOKIES=1` and `FOLIO_TRUST_PROXY=1`.

**Caddy** (automatic HTTPS):

```caddyfile
wiki.example.com {
    reverse_proxy localhost:3000
}
```

**nginx**:

```nginx
server {
    server_name wiki.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> Folio has no built-in TLS. Do not expose it to the internet over plain HTTP.

## Managing users

The first account is created in the browser. To add more people:

```bash
# Docker
docker compose exec folio node scripts/add-user.js alice

# Node
npm run add-user -- alice
```

You will be prompted for a password (or set `FOLIO_PASSWORD`). All users currently have equal access to every space.

## Backup and restore

Everything, including pages, history, sprints, issues and users, is in one SQLite file.

```bash
# Consistent backup, safe while Folio is running
npm run backup -- my-backup.db
# Docker
docker compose exec folio node scripts/backup.js /data/backup-$(date +%F).db
```

**Restore:** stop Folio, replace `data/folio.db` with your backup (and delete any `folio.db-wal` / `folio.db-shm` files next to it), then start it again.

## Using the Scrum board

1. Open a space and choose **Backlog** in the sidebar.
2. **Create issues** with the quick-add box under any list, or the full form for points, assignee and description.
3. **Create a sprint**, drag issues into it, then press **Start sprint** and choose a length.
4. Work from the **Board**. Drag cards between *To do*, *In progress* and *Done*.
5. When you are finished, **Complete sprint**. Done work stays with the sprint; everything else goes back to the backlog.

A space can have one active sprint at a time.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Search every page |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save (in the editor) |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> / <kbd>Ctrl</kbd>+<kbd>I</kbd> | Bold / italic (in the editor) |
| <kbd>Esc</kbd> | Close the palette or theme menu |

## Project layout

```
src/
  server.js    entry point and env config
  app.js       auth, spaces, pages, history, search routes
  board.js     sprints, issues, backlog and board routes
  db.js        schema, FTS5 triggers, helpers
  auth.js      scrypt passwords, sessions, login throttle
  render.js    Markdown -> sanitised HTML, layout, icons
public/        CSS (themes live here), client JS, bundled fonts
scripts/       add-user and backup
test/          integration tests (node:test)
```

The stack is deliberately plain: Express, server-rendered HTML, a little vanilla JavaScript, SQLite. There is no build step and no front-end framework.

## Adding a theme

Themes are sets of CSS variables.

1. Copy any `:root[data-theme=...]` block in `public/style.css`, rename it and change the colours.
2. Add one line to the `THEMES` array in `public/app.js` with the id, display name and three swatch colours.

## Security

- Passwords are hashed with scrypt; session tokens are random and stored only as SHA-256 hashes.
- Cookies are `HttpOnly` and `SameSite=Lax` (add `Secure` with `FOLIO_SECURE_COOKIES=1`).
- State-changing requests from a different origin are rejected.
- A strict Content Security Policy blocks inline scripts and styles.
- Markdown is sanitised, so pasted HTML cannot run scripts.
- Login attempts are throttled per IP.

Not included yet: two-factor auth, per-space permissions and audit logs. Please report vulnerabilities privately rather than in a public issue.

## Changelog

See [CHANGELOG.md](CHANGELOG.md), also shown in the app at `/changelog` (click the version in the sidebar footer). Folio follows [Semantic Versioning](https://semver.org/).

## Roadmap

- [ ] File and image attachments
- [ ] Roles and per-space permissions
- [ ] Issue search and filters
- [ ] Move and reorder pages in the tree
- [ ] Page templates
- [ ] REST API and webhooks

Ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Designed and built by [Tom Brooks](https://tombrooks.dev). Typography: [DM Serif Display](https://fonts.google.com/specimen/DM+Serif+Display), [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/), all under the SIL Open Font License and bundled with the app.

## License

[MIT](LICENSE) © Tom Brooks
