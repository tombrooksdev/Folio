# Changelog

All notable changes to Folio are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). While Folio is on `0.x`, minor versions may include breaking changes; they are always called out under **Changed** or **Removed**.

## [Unreleased]

Nothing yet.

## [0.10.0] - 2026-10-12

**Tasks**: a calm personal and team to-do list, beside the wiki and the board. Built from [docs/specs/tasks.md](docs/specs/tasks.md), all three phases.

### Added
- **Tasks** in the sidebar (and <kbd>G</kbd> then <kbd>T</kbd>), with smart lists: **My Day** (fresh each day, with **Suggestions** for overdue and due-soon tasks), **Important**, **Planned** (Overdue, Today, Tomorrow, This week, Later), **Assigned to me**, **All tasks** and a searchable **Completed**.
- Your own **lists** with colours, folders and ordering. A list is private (not even administrators can read it), shared with named people (edit or view) or a team list. Viewers can read shared and team lists but not change them.
- Every task can have a **due date**, a **length**, a **person**, **steps**, Markdown **notes** (issue keys and `@mentions` work), a **repeat** rule, a personal **reminder** and a **link** to an issue or page. **Add to my tasks** appears on every issue and page.
- **Quick add**: one line such as `Write the launch post fri ~1h30 @sam ! #Launch`, with the understood parts shown as you type. The server reads the line itself, so it behaves the same without JavaScript.
- **Day totals** ("3h 15m planned") in My Day and Planned, turning amber with an "Over budget" label when a day passes your **daily capacity** (6 hours by default, set per person on the Account page).
- **Assigning**: the person is notified and sees the task in Assigned to me; they can use their own My Day and reminder; you are told when they finish it.
- **Repeating tasks**: completing one creates the next on the right date (weekdays skip weekends, month ends are clamped).
- **Reminders** (a timer that sends each one once and survives restarts) and a **morning summary** at 08:00 local time, using the bell and desktop alerts. Four new switches in Notification settings.
- A **week planner**: drag a task onto a day to give it a start time, and its length becomes the block height. Every task also has a plain Schedule button, so dragging is optional.
- **Calendar export** (`/tasks/export.ics`) of dated tasks.
- Keyboard shortcuts on Tasks pages: <kbd>N</kbd> new, <kbd>Space</kbd> done, <kbd>D</kbd> due date, <kbd>M</kbd> My Day, <kbd>I</kbd> important, <kbd>Esc</kbd> close.
- A **Tasks** Learn course (three lessons), a step in the tour, and a first-use hint.

### Notes
- Dates are plain dates and reminders are stored in UTC. The browser's time zone is sent in a small `tz` cookie, so "today", reminders and the morning summary follow where you are.
- Not in this release: file attachments on tasks (the attachment tables belong to spaces; see the roadmap).

## [0.9.4] - 2026-10-12

Licensing and notices.

### Added
- `THIRD-PARTY-NOTICES.md`: trademark disclaimer, font and dependency licences, and what the installers bundle.
- `public/fonts/OFL.txt`: the SIL Open Font License text and copyright lines for the bundled fonts, as the licence requires.

### Changed
- README wording and package keywords no longer lean on the Jira and Confluence names; a non-affiliation note was added.
- Installers and packages now include the notices file.

## [0.9.3] - 2026-10-12

Windows fixes.

### Fixed
- **Styles, scripts, fonts and images did not load on Windows.** Folio built file paths from a URL's `pathname`, which gives `/C:/Program Files/...` on Windows, so the static folder was never found. Paths now use `fileURLToPath`.
- **`folio.cmd`**: the `backup` and `reset-password` commands were wired up wrongly and `config` ran into them.

### Changed
- **Folio opens in its own app window** (Microsoft Edge or Chrome without tabs or address bar) from the desktop and Start menu shortcuts; the default browser is used if neither is installed.
- The installer now creates the desktop shortcut by default.

## [0.9.2] - 2026-10-12

A quieter, more ordinary-looking interface.

### Changed
- **Headings in the app are plain sans-serif.** The serif face stays for the wordmark and for the pages you write, so documents still read like documents while screens like Spaces, Learn and Settings look like a tool.
- **Squarer corners and flatter surfaces**: smaller radii on buttons, inputs, menus, cards and callouts; tags are rectangular instead of pills; no lifting cards or sliding rows; rows only change colour on hover.
- **Plain lists instead of tiles**: the Spaces list, the Learn courses and the space keys are simple rows, and the page-level "eyebrow" captions above titles are gone.
- **Denser type**: a 14 px base and smaller page titles.
- **Calmer onboarding**: the getting-started checklist is a plain box, the "continue learning" block is a quiet row with an accent edge, tips are neutral grey, and the empty-state illustrations are removed.
- **No entrance animations** on pages and articles; only menus and dialogs animate.
- Page metadata on documents (updated, author, comments) is ordinary small text instead of capitalised labels.
- Shorter, plainer wording on the Learn and onboarding screens.

## [0.9.1] - 2026-10-12

A tidier, calmer interface.

### Changed
- **Top bar**: icons are one consistent size and perfectly aligned, the notification badge no longer covers the bell, and Sign out moved into a new **account menu** (your avatar) with Account, Notification settings, Manage people (administrators) and Sign out.
- All header menus (Create, notifications, help, themes, account) share one look and behave the same: one open at a time, `Esc` or a click elsewhere closes them, and focus returns to the button.
- **Less shouting**: section labels, sidebar headings, form labels and stat captions are now normal sentence-case text instead of small monospaced capitals. Page titles are slightly smaller.
- **Notification settings** use proper on/off switches, with a confirmation after saving.
- Toggle buttons (Readable width and other pressed states) now show when they are on.
- The search box in the header shows the `/` shortcut and collapses to an icon on narrow screens; the Create button does the same.
- The tour has a new step for the account menu, and the Learn lessons describe the new header.

### Added
- `ROADMAP.md` and a full specification for the next feature, **Tasks**: a Microsoft To Do style list where every task can have a date, a length and a person (`docs/specs/tasks.md`).

### Fixed
- The search palette input and the "create epic" button had no accessible name, and the editor page had no heading for screen readers.
- Several controls are checked by an accessibility audit across 25 pages (names, labels, duplicate ids, missing targets): no problems remain.

## [0.9.0] - 2026-10-12

Security hardening, following a full audit of v0.5.0. All 16 findings are addressed (see the notes at the end of this entry). **Check "Changed" before upgrading.**

### Added
- **Roles**: administrator, member and read-only viewer. Viewers can read everything and change nothing; only administrators manage people and link GitHub repositories; attachments and comments can be deleted by their owner or an administrator. Existing installs promote the first user to administrator automatically.
- **Account** page: change your password (which signs out your other sessions) and sign out other sessions. **People** page for administrators to add people and change roles.
- `npm run reset-password` / `folio reset-password`, and `--role` on `add-user`.
- `FOLIO_SETUP_TOKEN` and `FOLIO_DISABLE_SETUP` to protect or turn off the first-run setup page; setup can now create only one administrator even under concurrent requests.
- `FOLIO_MAX_STORAGE_MB` (total attachment storage cap) and `FOLIO_ALLOW_REMOTE_IMAGES`.
- `SECURITY.md`, Dependabot configuration, and `npm audit` in CI.
- Security regression tests for every finding.

### Changed
- **Passwords must be at least 10 characters** (up to 1,024), common passwords are refused, and usernames are limited to 2 to 32 letters, numbers, dots, dashes and underscores and are unique ignoring case. Existing accounts keep working.
- **Remote images (`https://...`) in pages no longer display** unless `FOLIO_ALLOW_REMOTE_IMAGES=1`; they let any author track who views a page. Uploaded images are unaffected.
- Markdown can no longer contain form fields (only read-only task checkboxes), and external links open with `noopener noreferrer nofollow`.
- `NODE_ENV=production` (set in the Docker image) turns on `Secure` cookies with the `__Host-` prefix and HSTS by default. Plain-HTTP `localhost` still works; for plain HTTP on another address set `FOLIO_SECURE_COOKIES=0`.
- The Docker Compose file now publishes Folio on `127.0.0.1` only. Put an HTTPS reverse proxy in front to reach it from elsewhere.
- Login is throttled per address and per username, takes the same time for unknown users, and uses asynchronous password hashing.
- The database, attachments and backups are created readable only by their owner (`0600`/`0700`); the Linux service uses `UMask=0077`.
- Uploads are streamed to disk instead of buffered in memory, rate limited, checked against their file extension, and abandoned uploads are deleted after a day.
- A stricter Content Security Policy, plus `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cache-Control: no-store` on signed-in pages; cross-site requests are refused using `Sec-Fetch-Site` and `Origin`.
- The Docker base image and GitHub Actions are pinned by digest or commit.

### Fixed
- The GitHub integration could be pointed at other `api.github.com` paths with `../`. Repository names are now validated strictly and only `/repos/...` is ever requested.
- Stack traces and file paths could be sent to the browser, and repeated or malformed form fields caused server errors. Errors now show a generic message and all form fields are treated as text.
- Expired sessions were never deleted; they are now removed at start-up and hourly.
- The issue search built part of its SQL from the space key; it now uses a bound parameter, and space keys are constrained in the schema.
- A failing GitHub response could crash an async handler; handlers are now wrapped and errors reach the central error page.

### Audit notes
Fixed: F01 to F14 and F16. Partly fixed: F06 (roles and ownership checks are in; pages are still hard-deleted, with no recycle bin), F13 (`Sec-Fetch-Site` and `Origin` checks are in; there is no per-session CSRF token), F15 (workflow permissions, pinned actions and image, Dependabot and `npm audit` are in; the Express 5 and newer `marked` upgrades are left for a separate, tested change).

## [0.8.1] - 2026-10-12

### Fixed
- Hiding the sidebar no longer breaks the page layout. The content used to collapse into a zero-width column; it now takes the full width (keeping the "On this page" outline on wide screens). A regression test covers the layout rules.

### Changed
- README: notifications, the training area and installation are documented, the project layout lists every module, and the screenshots are refreshed.

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

[Unreleased]: https://github.com/tombrooksdev/Folio/compare/v0.9.2...HEAD
[0.9.2]: https://github.com/tombrooksdev/Folio/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/tombrooksdev/Folio/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/tombrooksdev/Folio/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/tombrooksdev/Folio/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/tombrooksdev/Folio/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/tombrooksdev/Folio/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tombrooksdev/Folio/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/tombrooksdev/Folio/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tombrooksdev/Folio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tombrooksdev/Folio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tombrooksdev/Folio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tombrooksdev/Folio/releases/tag/v0.1.0
