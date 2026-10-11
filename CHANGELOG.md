# Changelog

All notable changes to Folio are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). While Folio is on `0.x`, minor versions may include breaking changes; they are always called out under **Changed** or **Removed**.

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/<your-username>/folio/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/<your-username>/folio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/<your-username>/folio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/<your-username>/folio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/<your-username>/folio/releases/tag/v0.1.0
