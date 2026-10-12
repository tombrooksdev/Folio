# Changelog

All notable changes to Folio are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). While Folio is on `0.x`, minor versions may include breaking changes; they are always called out under **Changed** or **Removed**.

## [Unreleased]

Nothing yet.

## [0.8.0] - 2026-10-12

A training area, a first-login tour, and notifications.

### Added
- **Learn**: a built-in training area with six short courses (23 lessons): getting started, docs and knowledge, planning and running a sprint, connecting GitHub, notifications, and running Folio. Progress is tracked per person, and lessons use the same panels and Markdown as the rest of the app.
- **Practice space**: one click creates a safe space with sample pages, epics and a running sprint to experiment in, and one click removes it again.
- **First-login tour**: new people get a short spotlight walkthrough of the sidebar, Create button, search, notifications, help and themes. Skip it any time and replay it from the Help menu.
- **Getting-started checklist** on the home page that ticks itself off from real activity (take the tour, create a space, page and issue, start a sprint, add a teammate).
- **Hints**: small dismissible tips on the board, backlog and editor, shown once per person.
- **Help menu** (`?` in the top bar): Learn, replay the tour, keyboard shortcuts and What's new.
- **Notifications**: a bell with an unread count, a dropdown of recent items, a full inbox (All / Unread), and mark-as-read. People are told about new pages, new issues, issues assigned to them, `@mentions`, sprints starting and completing, and changes and comments on pages and issues they watch.
- **Watching**: you watch what you create, edit, comment on or are assigned, and can Watch or Unwatch any page or issue.
- **Notification settings**: switch each type on or off per person, and enable browser desktop alerts.
- **@mentions** in pages, issues and comments, highlighted in the text.
- **Team webhook**: set `FOLIO_WEBHOOK_URL` to post new pages, new issues and sprint events to Slack, Mattermost, Discord or Microsoft Teams (and `FOLIO_PUBLIC_URL` to include links).
- New tests for notifications, watching, preferences, the training area, the checklist, hints and the practice space.

### Changed
- A "Learn" link sits beside Home in the sidebar.
- Quick edits made by dragging cards or changing a field also notify watchers; rapid successive edits to the same item are combined into one notification.

## [0.7.0] - 2026-10-12

Installers for Windows and Linux.

### Added
- **Windows installer** (`Folio-Setup-x.y.z.exe`): installs to Program Files with a private Node.js, Start menu and desktop shortcuts, an optional Windows service that starts with Windows, an optional firewall rule for network access, and an uninstaller that keeps your data in `C:\ProgramData\Folio`. Supports silent install (`/S`).
- **Windows portable zip** with a "Start Folio" launcher that runs quietly and opens your browser.
- **Debian/Ubuntu/Raspberry Pi OS packages** (`.deb`, amd64 and arm64) that set up a hardened systemd service, a `folio` system user and `/etc/folio/folio.env`.
- **Linux tarball** (x64 and arm64) with `install.sh`, or run in place without installing.
- `folio` command line on Linux and Windows: `start`, `add-user`, `backup`, `config`, and `stop` / `open` on Windows.
- `FOLIO_HOST` setting to choose which address Folio listens on.
- `npm run package` and a release workflow that builds everything, verifies the Node.js download against its published checksum, and attaches checksums to the GitHub release when a `v*` tag is pushed.
- [Installation guide](docs/INSTALL.md).

### Changed
- The server prints a clear message if the port is already in use, and shuts down cleanly on SIGTERM.
- The SQLite "experimental" warning is hidden when started through the `folio` command.

## [0.6.0] - 2026-10-12

Closer to Jira and Confluence, without the bloat.

### Added
- **Create** button in the top bar, like Jira's: a dialog for new issues (space, type, summary, description, priority, assignee, "Create another") with a confirmation toast, plus quick links to create a page or a space.
- **Sub-tasks**: add them from the parent issue, see progress on the parent, and a parent chip on cards and rows.
- **Issue links**: blocks / is blocked by / relates to / duplicates / is duplicated by, shown on both issues.
- **Issue history**: every change to status, assignee, priority, points, sprint, epic, labels, summary and description is recorded. The Activity section has All / Comments / History tabs.
- **Issue keys become links** everywhere Markdown is rendered (`ENG-12`), except inside code or existing links.
- **Swimlanes** on the board: group by assignee or epic, with collapsible lanes.
- **Panels** in Markdown, like Confluence's info and warning macros: `> [!INFO]`, `[!NOTE]`, `[!TIP]`, `[!SUCCESS]`, `[!WARNING]`.
- **Page templates** and a "Create page" gallery: meeting notes, decision record, product requirements, retrospective, runbook, how-to guide, or blank.
- **Compare versions**: a line diff between any saved version and the current page.
- **Page labels**, with a page listing per label.
- **Starred pages** and a **Recently viewed** list on the home page.
- **Draft autosave** in the editor: unsaved work is kept in the browser and offered back after a crash or accidental navigation.
- **Keyboard shortcuts**: `C` create issue, `/` search, `E` edit, `G` then `H` / `B` / `L` / `I` to navigate, `[` toggle the sidebar, `?` for help.
- Parent issue picker on the issue form.

### Changed
- "Create page" in the sidebar and "Child page" open the template gallery.
- Pages and issues expose an edit shortcut target to the keyboard handler.

### Fixed
- Cards and rows no longer nest links when showing parent keys.

## [0.5.0] - 2026-10-12

Epics and labels, attachments and page comments, and a read-only GitHub integration.

### Added
- **Epics**: group issues under a larger goal. An epics panel on the backlog shows progress per epic and filters the backlog when clicked; each epic has its own page with progress, description and issues, and can be marked done or deleted.
- **Labels** on issues (comma separated, lower-cased, de-duplicated), shown on cards and rows and editable inline.
- **Issue search** per space: filter by text or key, status, type, priority, assignee, epic, label and sprint.
- Board filters for epic and label alongside search and assignee.
- **Attachments** on pages and issues: drop zones, upload from the editor toolbar, and paste or drop images straight into Markdown. Images embed inline; other files list with size, uploader and date. Files are stored in `data/uploads` and are served safely (only images and PDFs display inline; everything else, including HTML and SVG, downloads).
- **Page comments** with one level of replies, Markdown support, and delete for your own comments.
- **Move pages**: choose a parent page when editing; moving a page under its own descendants is prevented.
- **GitHub integration** (read-only): link a repository to a space and browse its commits, pull requests, branches and README. Issue keys in commit messages and PR titles link back to the issue, and each issue gets a **Development** panel listing pull requests and commits that mention its key.
- Sidebar links for **Issues** and **Code**.
- Configuration: `FOLIO_UPLOAD_DIR`, `FOLIO_MAX_UPLOAD_MB` and `FOLIO_GITHUB_TOKEN`.
- Regression tests for epics, labels, attachments, comments, page moves and GitHub (with the GitHub API stubbed).

### Changed
- `npm run backup` also copies the attachments folder.
- Databases from earlier versions are upgraded in place on start-up; no manual migration is needed.

### Security
- Uploaded filenames are stripped of path components, uploads are size-limited, and file responses carry `nosniff` and a locked-down Content Security Policy.
- The GitHub integration only ever contacts `api.github.com` for the linked repository, and everything it returns is escaped before display.

## [0.4.0] - 2026-10-12

Sprint reporting, a Jira-style Scrum UI and a full-width layout.

### Added
- **Reports** page per space with a velocity chart (committed vs completed points, average of the last three sprints) and sprint history.
- **Burndown chart** on the board (collapsible) and on a per-sprint report, with an ideal line, remaining-work line and scope changes made mid-sprint.
- **Sprint report** page: committed, scope change, completed and remaining points, plus lists of completed and not-completed issues.
- Issue view in a two-column Jira layout: description and activity on the left, a **Details** panel on the right with inline editing of status, assignee, type, priority, story points and sprint.
- Board filters: search the board, filter by assignee avatar, "Only my issues" and "Clear filters".
- Backlog: collapsible sprint sections, per-status issue counts, an inline "Create issue" row with a type picker, and a "Create sprint" button.
- "Readable width" toggle on wiki pages (remembered per browser).
- In-app changelog at `/changelog`, rendered from this file.
- Regression tests for reports and inline field edits.

### Changed
- Wiki pages and the board now use the full width beside the sidebar instead of a narrow centred column.
- Agile screens restyled to follow Jira conventions: coloured square issue-type icons, priority chevrons, uppercase status lozenges, round points badges, per-user avatar colours, grey column headers and compact cards.
- Completing a sprint now takes you to its report instead of the backlog.
- App version is read from `package.json`.

### Fixed
- Editor and board scripts no longer share global names, which had silently disabled the theme picker, command palette and sidebar toggles on the edit page.

## [0.3.0] - 2026-10-12

Scrum boards, tombrooks.dev branding and themes.

### Added
- **Scrum board** in every space: backlog, sprints (create, start for 1-4 weeks, complete), issues (story, bug, task) with priority, story points, assignee, Markdown description and comments, drag-and-drop ordering and status changes, issue keys such as `ENG-12`.
- **tombrooks.dev branding**: cream, ink and auburn palette; DM Serif Display, Plus Jakarta Sans and JetBrains Mono, all bundled; the `folio.` wordmark.
- **11 themes** with a picker in the top bar: tombrooks.dev, Paper, Sage, Blush, Solarized (light) and tombrooks.dev Dark, Midnight, Forest, Dracula, Nord, High contrast (dark). The choice is remembered per browser.
- Confluence-style sidebar on every page: Home, all spaces, and the current space expanded into Board, Backlog, Reports and a collapsible page tree.
- `npm run add-user` and `npm run backup` scripts.
- `/healthz` endpoint and a Docker health check.
- README, MIT licence, CONTRIBUTING guide and a GitHub Actions workflow (tests and Docker build).

### Changed
- Visual design reworked to a flat, editorial style with hairline borders and restrained motion.
- Static assets are no longer cached aggressively so updates show immediately; fonts are cached for a year.

### Removed
- Gradient hero, glowing shapes and the previous Inter and Fraunces fonts.

## [0.2.0] - 2026-10-12

Design system and editing experience.

### Added
- Command palette (`Ctrl`+`K`) with live search results.
- Per-page "On this page" outline with scroll-spy, heading anchors and copy buttons on code blocks.
- Editor toolbar, keyboard shortcuts (`Ctrl`+`S`, `Ctrl`+`B`, `Ctrl`+`I`), word count and reading time, and an unsaved-changes warning.
- Reading-progress bar, light/dark switch and view transitions between pages.
- `/search.json` endpoint.

### Changed
- Pages, search, history and empty states redesigned.

### Fixed
- The page title input used an inline style that the Content Security Policy blocked.

## [0.1.0] - 2026-10-12

First release: a self-hosted wiki.

### Added
- Spaces with nested pages and Markdown rendering (sanitised).
- Live Markdown preview while editing.
- Version history with restore.
- Full-text search (SQLite FTS5 with word-stem matching).
- Export any page as Markdown.
- Single-admin setup, scrypt password hashing, hashed session tokens, login throttling, CSRF origin checks and a strict Content Security Policy.
- Docker image and Compose file; data stored in one SQLite file.

[Unreleased]: https://github.com/tombrooksdev/Folio/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/tombrooksdev/Folio/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/tombrooksdev/Folio/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tombrooksdev/Folio/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/tombrooksdev/Folio/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tombrooksdev/Folio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tombrooksdev/Folio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tombrooksdev/Folio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tombrooksdev/Folio/releases/tag/v0.1.0
