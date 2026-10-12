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

Wikis and issue trackers like Confluence and Jira are brilliant, and priced like it. Folio is the 20% of both that most small teams use 90% of the time:

- **Write things down** in spaces and nested pages, with Markdown, live preview, version history and instant search.
- **Plan and run sprints** with a backlog, a drag-and-drop board and story points.
- **Own it.** One Node process, one SQLite file, three runtime dependencies. Back it up by copying a file. Read the entire source in an afternoon.

## Design principles

Folio follows the conventions people already know from tools like Confluence and Jira, and leaves out what gets in the way:

- **Familiar first.** Spaces, page trees, templates, panels and version history; backlog, board, sprints, epics, sub-tasks, links and a Create button. The shortcuts match Jira's.
- **No configuration mazes.** No workflow editor, permission schemes, custom field screens or plugin marketplace. Three statuses, three issue types, three priorities. Everything works out of the box.
- **Fast.** Server-rendered pages, a few kilobytes of JavaScript, SQLite. Every page loads instantly, and nothing spins.
- **Yours.** One process, one data folder, no accounts with a vendor, no telemetry, no per-seat pricing.
- **Readable.** The whole codebase is small enough to understand in an afternoon.

## Features

**Wiki**
- Spaces with nested page trees and a Confluence-style sidebar (collapsible nodes, remembered per browser)
- Markdown editor with live preview, formatting toolbar, shortcuts, word count and unsaved-changes warning
- Version history with one-click restore
- Full-text search (SQLite FTS5, word-stem matching, highlighted snippets) and a <kbd>Ctrl</kbd>+<kbd>K</kbd> command palette
- Per-page "On this page" outline with scroll-spy, heading anchors, copy buttons on code blocks
- **Attachments**: drop files on a page, or paste and drop images straight into the editor; images embed inline
- **Page comments** with replies, and **move pages** between parents from the editor
- **Templates** (meeting notes, decision record, runbook and more), **panels** (`> [!WARNING]`), page **labels**, **starred** and **recently viewed** pages
- **Compare versions** with a line diff, and **draft autosave** so you never lose an edit
- Export any page as `.md`

**Scrum**
- A board and a backlog in every space
- Sprints: create, plan, start (1-4 weeks), complete (unfinished work returns to the backlog)
- Issues: story / bug / task, priority, story points, assignee, Markdown description, attachments, comments
- **Epics** with progress roll-up, and **labels**, filterable on the board, backlog and issue search
- **Sub-tasks**, **issue links** (blocks, relates to, duplicates) and a full **history** of every change
- **Swimlanes** on the board (group by assignee or epic)
- A **Create** button with an issue dialog, and Jira-style **keyboard shortcuts**
- **Issue search** by text, status, type, priority, assignee, epic, label and sprint
- Drag and drop to reorder, move between sprints, and change status
- Sprint progress with points done and days left, plus burndown, velocity and sprint history reports
- Jira-style layout: filters, status lozenges, issue-type icons, a two-column issue view with inline editing
- Issue keys like `ENG-12`

**Tasks**
- A quiet to-do list in the style of Microsoft To Do: **My Day** (with suggestions), **Important**, **Planned**, **Assigned to me**, **All tasks** and **Completed**
- Every task can have a **date**, a **length** and a **person**, plus steps, notes, a repeat rule, a reminder and a link to an issue or page
- **Quick add** understands one line: `Write the launch post fri ~1h30 @sam ! #Launch`
- Day totals ("3h 15m planned") that turn amber when a day is over your capacity
- Private, shared and team **lists**; assigning a task notifies the person and tells you when it is done
- A **week planner** where you drag a task onto a day to time-box it, and a calendar (`.ics`) export
- **Add to my tasks** on any issue or page, files on tasks, and drag to reorder a list

**GitHub (read-only)**
- Link a repository to a space and browse its commits, pull requests, branches and README
- Issue keys in commit messages and PR titles (`ENG-12`) link back to the issue
- A **Development** panel on each issue lists the pull requests and commits that mention it
- Folio never writes to GitHub, and never talks to anything but `api.github.com`

**Learning and onboarding**
- A built-in **Learn** area: seven short courses (26 lessons) with progress tracking
- A one-click **practice space** with sample pages, epics and a running sprint
- A **first-login tour**, a self-ticking **getting-started checklist** and dismissible hints
- **Notifications**: a bell, inbox, watching, `@mentions`, per-person settings, desktop alerts and an optional Slack / Teams / Discord webhook

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

| Epic | Code (GitHub) |
|---|---|
| ![Epic](docs/screenshots/epic.png) | ![Code](docs/screenshots/code.png) |

| Learn (training area) | Notifications |
|---|---|
| ![Learn](docs/screenshots/learn.png) | ![Notifications](docs/screenshots/notifications.png) |

| Swimlanes | Compare versions |
|---|---|
| ![Swimlanes](docs/screenshots/swimlanes.png) | ![Diff](docs/screenshots/diff.png) |

| Account menu | Themes |
|---|---|
| ![Account menu](docs/screenshots/menu-account.png) | ![Theme picker](docs/screenshots/menu-themes.png) |

| Notification settings | People (administrators) |
|---|---|
| ![Notification settings](docs/screenshots/notification-settings.png) | ![People](docs/screenshots/people.png) |

| Home with the getting-started checklist | Full width with the sidebar hidden |
|---|---|
| ![Home](docs/screenshots/home.png) | ![Sidebar hidden](docs/screenshots/sidebar-collapsed.png) |

### Themes

Pick one from the palette icon in the top bar. Your choice is remembered in your browser.

| tombrooks.dev dark | Midnight |
|---|---|
| ![tombrooks dark](docs/screenshots/theme-tombrooks-dark.png) | ![Midnight](docs/screenshots/theme-midnight.png) |

| Sage | Dracula |
|---|---|
| ![Sage](docs/screenshots/theme-sage.png) | ![Dracula](docs/screenshots/theme-dracula.png) |

Also included: Paper, Blush, Solarized, Forest, Nord and High contrast.

## Install

| | |
|---|---|
| **Windows** | Download `Folio-Setup-x.y.z.exe` from the [releases](https://github.com/tombrooksdev/Folio/releases) and run it. |
| **Debian / Ubuntu / Raspberry Pi** | `sudo apt install ./folio_x.y.z_amd64.deb` (or `_arm64.deb`) |
| **Other Linux** | Unpack `folio-x.y.z-linux-x64.tar.gz` and run `sudo ./install.sh` |
| **Docker** | `docker compose up -d --build` |

No separate Node.js install is needed for the installers. Full guide, including portable mode, settings and upgrades: [docs/INSTALL.md](docs/INSTALL.md).

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/tombrooksdev/Folio.git
cd Folio
docker compose up -d --build
```

Open <http://localhost:3000>. The first visit asks you to create the administrator account. Do that straight away, or set `FOLIO_SETUP_TOKEN` first (see [Security](#security)).

The Compose file publishes Folio on this machine only (`127.0.0.1`). To reach it from other devices, put an HTTPS reverse proxy in front of it (see [Deploying](#deploying)).

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
| `NODE_ENV` | `production` in Docker | In production, cookies are `Secure` by default (plain-HTTP `localhost` still works). |
| `FOLIO_SECURE_COOKIES` | on in production, otherwise off | `1` forces `Secure` cookies; `0` allows plain HTTP on a trusted network. |
| `FOLIO_SETUP_TOKEN` | *(none)* | If set, the first-run setup page asks for this token. |
| `FOLIO_DISABLE_SETUP` | `0` | `1` turns the web setup page off; create the first user with `folio add-user`. |
| `FOLIO_HOST` | `0.0.0.0` | Address to listen on (`127.0.0.1` = this machine only). |
| `FOLIO_TRUST_PROXY` | `0` | Set to `1` when behind a reverse proxy so the real client IP is used for login throttling. |
| `FOLIO_UPLOAD_DIR` | `./data/uploads` (`/data/uploads` in Docker) | Where attachments are stored. |
| `FOLIO_MAX_UPLOAD_MB` | `25` | Largest attachment, in megabytes. |
| `FOLIO_MAX_STORAGE_MB` | `2048` | Total attachment storage cap. |
| `FOLIO_ALLOW_REMOTE_IMAGES` | `0` | `1` allows `https://` images from other sites in pages (they reveal who views a page). |
| `FOLIO_WEBHOOK_URL` | *(none)* | Optional Slack / Mattermost / Discord / Teams incoming-webhook URL. New pages, new issues and sprint events are posted there. |
| `FOLIO_PUBLIC_URL` | *(none)* | The address people use to reach Folio (for example `https://wiki.example.com`): webhook messages link to it, and the cross-site check accepts it. |
| `FOLIO_GITHUB_TOKEN` | *(none)* | Optional GitHub token. Public repos work without one; add it for private repos or to lift the 60 requests/hour limit. A fine-grained, read-only token is enough. |

## Deploying

Run Folio behind a reverse proxy that terminates HTTPS, then set `FOLIO_TRUST_PROXY=1` (and `FOLIO_SECURE_COOKIES=1` if `NODE_ENV` is not `production`). Only enable `FOLIO_TRUST_PROXY` behind a proxy that overwrites `X-Forwarded-For`, otherwise people could fake their address to dodge the login limit.

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

The first account is created in the browser and is an **administrator**. Everyone else is added by an administrator, either on the **People** page (avatar menu, *Account*, *Manage people*) or from the command line:

```bash
# Docker
docker compose exec folio node scripts/add-user.js alice --role member

# Node
npm run add-user -- alice --role member
npm run reset-password -- alice      # new password, and signs them out everywhere
```

You are asked for the password (input hidden); it must be at least 10 characters.

| Role | Can |
|---|---|
| **Viewer** | Read everything. Change nothing (except their own notification settings and account). |
| **Member** | Create and edit pages, issues, sprints and epics; comment; delete their own uploads and comments. |
| **Administrator** | Everything a member can, plus manage people and roles, link GitHub repositories, and delete anyone's attachments or comments. |

Anyone can change their own password and sign out other sessions from **Account**.

## Backup and restore

Pages, history, sprints, issues and users are in one SQLite file (`data/folio.db`). Attachments are files in `data/uploads/`. The `data/` folder is the only thing you need to keep.

```bash
# Consistent backup, safe while Folio is running
npm run backup -- my-backup.db
# Docker
docker compose exec folio node scripts/backup.js /data/backup-$(date +%F).db
```

`npm run backup` writes the database copy and an `.uploads` folder next to it.

**Restore:** stop Folio, replace `data/folio.db` with your backup (and delete any `folio.db-wal` / `folio.db-shm` files next to it), put the attachments back in `data/uploads/`, then start it again.

## Using the Scrum board

1. Open a space and choose **Backlog** in the sidebar.
2. **Create issues** with the quick-add box under any list, or the full form for points, assignee and description.
3. **Create a sprint**, drag issues into it, then press **Start sprint** and choose a length.
4. Work from the **Board**. Drag cards between *To do*, *In progress* and *Done*.
5. When you are finished, **Complete sprint**. Done work stays with the sprint; everything else goes back to the backlog.

A space can have one active sprint at a time.

## Linking GitHub

1. Open a space and choose **Code** in the sidebar.
2. Enter `owner/repository` (a full `https://github.com/...` URL also works) and press **Link repository**.
3. Browse **Commits**, **Pull requests**, **Branches** and the **README**.

Use your space key in commit messages, branch names or PR titles, for example `ENG-12 Add email verification`. Folio links those keys back to the issue and lists the activity in the issue's **Development** panel. Responses are cached for five minutes. Set `FOLIO_GITHUB_TOKEN` for private repositories.

## Notifications

The bell in the top bar shows what happened since you last looked: new pages, new issues, issues assigned to you, `@mentions`, sprints starting and completing, and changes or comments on anything you **watch**. You watch what you create, edit, comment on or are assigned, and can **Watch** or **Unwatch** any page or issue. Choose what you hear about, and turn on browser desktop alerts, in **Notification settings**. Rapid edits to the same item are combined into one notification, and you are never notified about your own actions.

To post team events (new pages, new issues, sprints) to a chat channel, set `FOLIO_WEBHOOK_URL` to a Slack, Mattermost, Discord or Teams incoming-webhook URL, and `FOLIO_PUBLIC_URL` so the messages include links.

## Learning Folio

New people get a short **tour** the first time they sign in (replay it from the `?` help menu). The **Learn** area has six courses and a one-click **practice space** with sample pages and a running sprint. The home page shows a **getting-started checklist** that ticks itself off. Lessons are Markdown files in `src/learn/`, so you can edit them or add your own.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>C</kbd> | Create an issue |
| <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> | Search every page |
| <kbd>E</kbd> | Edit the current page or issue |
| <kbd>G</kbd> then <kbd>H</kbd> / <kbd>B</kbd> / <kbd>L</kbd> / <kbd>I</kbd> | Go to home / board / backlog / issue search |
| <kbd>[</kbd> | Show or hide the sidebar |
| <kbd>?</kbd> | Show all shortcuts |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save (in the editor) |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> / <kbd>Ctrl</kbd>+<kbd>I</kbd> | Bold / italic (in the editor) |
| <kbd>Esc</kbd> | Close the palette or theme menu |

## Project layout

```
src/
  server.js     entry point and environment configuration
  app.js        auth, spaces, pages, history, templates, labels, stars, search
  board.js      sprints, issues, backlog, board, swimlanes, issue search
  epics.js      epics and their progress
  issues.js     shared issue queries, HTML fragments and change history
  reports.js    burndown, velocity and sprint history
  files.js      attachments (upload, safe serving, cleanup)
  comments.js   page comments
  github.js     read-only GitHub client and routes
  notify.js     notifications, watching, @mentions, preferences, webhook
  learn.js      training area, checklist, hints, practice space, per-user flags
  learn/        the lessons (Markdown) and course index
  templates.js  built-in page templates
  diff.js       line diff for comparing versions
  db.js         schema, migrations, search index
  auth.js       scrypt passwords, sessions, roles, password and username rules
  util.js       safe request-field helpers, async wrapper, rate limiter
  render.js     Markdown to sanitised HTML, layout, icons
public/         CSS (themes live here), client JavaScript, bundled fonts
scripts/        add-user and backup
packaging/      Windows installer, Linux packages and the build script
docs/           installation guide and screenshots
test/           integration tests (node:test)
```

The stack is deliberately plain: Express, server-rendered HTML, a little vanilla JavaScript, SQLite. There is no build step and no front-end framework.

## Adding a theme

Themes are sets of CSS variables.

1. Copy any `:root[data-theme=...]` block in `public/style.css`, rename it and change the colours.
2. Add one line to the `THEMES` array in `public/app.js` with the id, display name and three swatch colours.

## Security

Folio was audited and hardened in v0.9.0. In short:

- **Accounts:** scrypt password hashing (10+ characters, common passwords refused), per-address and per-username login limits, constant-time handling of unknown users, rotating sessions, a hard limit on password length, and **Account** pages to change your password and revoke sessions.
- **Roles:** administrator, member and read-only viewer (see [Managing users](#managing-users)).
- **First run:** the setup page can be protected with `FOLIO_SETUP_TOKEN` or turned off with `FOLIO_DISABLE_SETUP=1`, and only one request can ever create the first administrator.
- **Transport:** `Secure` cookies with the `__Host-` prefix and HSTS in production; the Docker Compose file listens on this machine only.
- **Browser protections:** a strict Content Security Policy (no inline script or style, no remote images by default), `nosniff`, framing and permissions headers, `Cache-Control: no-store` on signed-in pages, and cross-site request checks (`Sec-Fetch-Site`, `Origin`).
- **Content:** Markdown is sanitised: no scripts, no form fields except read-only task checkboxes, no tracking images, and external links open with `noopener noreferrer nofollow`.
- **Uploads:** streamed to disk with size and storage limits, randomly named, checked against their extension, and only images and PDFs display inline. Abandoned uploads are purged after a day.
- **Data at rest:** the database, attachments and backups are readable by their owner only.
- **GitHub:** read-only, and restricted to `/repos/...` on `api.github.com`.
- **Errors:** never show stack traces or file paths.

Not included yet: two-factor sign-in, per-space permissions, and soft-delete for pages. See [SECURITY.md](SECURITY.md) for how to report a vulnerability privately and how to run Folio safely.

## Changelog

See [CHANGELOG.md](CHANGELOG.md), also shown in the app at `/changelog` (click the version in the sidebar footer). Folio follows [Semantic Versioning](https://semver.org/).

## Roadmap

See [ROADMAP.md](ROADMAP.md) for what is planned next, and the [Tasks specification](docs/specs/tasks.md) for how Tasks was designed.

Ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Designed and built by [Tom Brooks](https://tombrooks.dev). Typography: [DM Serif Display](https://fonts.google.com/specimen/DM+Serif+Display), [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/), all under the SIL Open Font License and bundled with the app.

## Trademarks and third-party notices

Folio is an independent project, not affiliated with or endorsed by Atlassian. Jira and Confluence are trademarks of Atlassian Corporation Plc, named here only to describe what Folio resembles. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for font and dependency licences.

## License

[MIT](LICENSE) © Tom Brooks
