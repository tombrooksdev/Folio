# Roadmap

What is planned next for Folio, roughly in order. Sizes: **S** a day or two, **M** about a week, **L** more than a week. Nothing here is a promise; priorities change with what people actually use. Ideas and votes are welcome in the issues.

## Shipped: Tasks (v0.10.0)

A Microsoft To Do style task list, built in. Every task can have a **date**, a **length** and a **person**. All three phases of the [specification](docs/specs/tasks.md) shipped together: the list, sharing and assigning, and the week planner.

Still to do for Tasks:

| Item | Size | Notes |
|---|---|---|
| Attachments on tasks | S | The attachment tables are keyed to a space; they need to allow a task as an owner |
| Reorder tasks by dragging | S | Tasks keep the order they were added in |
| Browser-level tests for the page script | S | The server and the parser are tested; the page script is checked by hand |

## Soon

| Feature | Size | Why |
|---|---|---|
| Soft delete and a recycle bin for pages and issues | M | A mistaken delete should be recoverable (left over from the security audit) |
| Two-factor sign-in (TOTP) | M | The strongest protection for administrator accounts |
| Reorder pages in the tree by dragging | S | Alphabetical is not always the right order |
| Page templates you can create and edit | S | The built-in ones are a start; teams want their own |
| Notifications by email (optional SMTP) | M | For people who live in their inbox, off by default |
| @mentions picker and richer comments | S | Type `@` and choose a person |

## Later

| Feature | Size | Notes |
|---|---|---|
| Per-space permissions | L | Only if the three roles prove too coarse. Folio deliberately avoids permission schemes. |
| REST API and personal access tokens | L | Read and write pages and issues from scripts |
| Webhooks per space | M | The single team webhook covers most needs today |
| Roadmap view for epics | M | A simple timeline, not a Gantt chart |
| Page restrictions | M | Lock a page to named people |
| Import from Confluence and Jira exports | L | The way in for teams switching over |
| Real-time collaborative editing | L | Presence first, then live cursors |

## Principles that decide what is built

1. **Familiar over novel.** If Jira, Confluence or To Do already taught people how it works, copy the idea.
2. **Fewer settings.** A feature that needs a configuration screen has to earn it.
3. **One data folder.** Everything stays in one SQLite file plus uploads, so backups stay trivial.
4. **Private by default.** New data is visible to as few people as makes sense.
5. **Fast and small.** Server-rendered pages, little JavaScript, no build step, few dependencies.

## Recently shipped

See the [changelog](CHANGELOG.md). Highlights: Tasks (0.10.0), security hardening and roles (0.9.0), the Learn area, tour and notifications (0.8.0), Windows and Linux installers (0.7.0), sub-tasks, issue links and swimlanes (0.6.0), epics, attachments and GitHub (0.5.0).
