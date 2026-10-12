# Tasks: a To Do list inside Folio

**Status:** proposed. **Target:** v0.10.0. **Size:** large (three phases, each shippable on its own).

A calm personal and team to-do list in the style of Microsoft To Do, living beside the wiki and the Scrum board. Every task can have a **date**, a **length** (how long it will take) and a **person**.

## Why this, and why not just use issues?

Issues are for planned product work: they have sprints, points, workflows and keys. People also carry a lot of small work that does not belong in a sprint: "book the venue", "review Sam's page", "send the invoice". Today that lives in a notes app or a separate to-do tool. Tasks gives it a home that is:

- **Fast and light**: add a task in one line, tick it off in one click.
- **Dated and sized**: so a day can be planned realistically, not just listed.
- **Shared when it should be**: assign a task to a teammate, or share a whole list.
- **Connected**: a task can point at an issue or a page, and an issue or page can become a task.

It must **not** become a second issue tracker. No sprints, points, workflows, dependencies or time tracking.

## What it looks like

```
+-----------------------+---------------------------------------+---------------------------+
| Tasks                 | My Day                       Mon 12 Oct | Write the launch post     |
|                       |  3h 15m planned                         |                           |
|  My Day         4     |  + Add a task                           |  [ ] Draft outline   30m  |
|  Important      2     |                                         |  [ ] Pick screenshots     |
|  Planned        9     |  ( ) Write the launch post   * 1h 30m   |  + Add step               |
|  Assigned to me 3     |      Launch  - Today     @tom           |                           |
|  All tasks     21     |  ( ) Review Sam's page         30m      |  Add to My Day      [on]  |
|                       |      Docs  - Today          @tom        |  Due        Mon 12 Oct    |
|  Lists                |  ( ) Send invoice              15m      |  Remind me  09:00         |
|   Launch        6     |      Admin - Overdue 2d     @tom        |  Repeat     Never         |
|   Docs          4     |                                         |  Length     1h 30m        |
|   Admin         3     |  Suggestions                         v  |  Assigned to  @tom        |
|  + New list           |  Completed (5)                       v  |  Notes ...                |
+-----------------------+---------------------------------------+---------------------------+
```

Left: lists. Centre: tasks. Right: a detail pane that opens when you click a task, exactly like To Do.

## Core ideas (borrowed from Microsoft To Do)

### Smart lists

| List | Shows |
|---|---|
| **My Day** | Tasks you chose to do today, plus a **Suggestions** drawer (overdue tasks and tasks due soon) you can add with one click. Starts fresh each day. |
| **Important** | Starred tasks. |
| **Planned** | Every task with a due date, grouped Overdue, Today, Tomorrow, This week, Later. |
| **Assigned to me** | Tasks other people assigned to you, grouped by who assigned them. |
| **All tasks** | Everything you can see. |
| **Completed** | Search the history. |

### Your own lists

Create lists (`Launch`, `Docs`, `Admin`), reorder them, and group them. Each has a colour. A list is **private** (only you), **shared** with named people, or **team** (everyone who is a member).

### A task

| Field | Notes |
|---|---|
| **Title** | One line. |
| **Done** | Click the circle. It animates out into *Completed*. |
| **Important** | Star. |
| **My Day** | Plan it for today. |
| **Due date** | Date, with quick picks: Today, Tomorrow, Next week, Pick a date. |
| **Remind me** | A date and time. Shows in the bell and as a desktop alert. |
| **Repeat** | Daily, weekdays, weekly, monthly, yearly, or custom. Completing a repeating task creates the next one. |
| **Length** | How long it will take: 15m, 30m, 1h, 2h, half day, day, or any custom minutes. Used for the "planned" totals. |
| **Assigned to** | One person. Defaults to you. |
| **Steps** | A small checklist inside the task. Progress shows on the row (2 of 5). |
| **Notes** | Markdown, with `ENG-12` keys and `@mentions` working as everywhere else. |
| **Attachments** | The same attachment system pages and issues use. |
| **Link** | Optional pointer to an issue or a page. |

### Quick add (the part that makes it fast)

One input, with a few shortcuts that are parsed as you type and shown as chips before you press Enter:

```
Write the launch post  fri  ~1h30  @sam  !  #Launch
```

| Token | Meaning |
|---|---|
| `today`, `tomorrow`, `fri`, `next week`, `12 oct`, `+3d` | Due date |
| `~30m`, `~1h30`, `~2h`, `~1d` | Length |
| `@name` | Assign to someone |
| `!` | Important |
| `#List` | Put it in a list |
| `*` | Add to My Day |

The same parser powers the input everywhere, so there is one thing to learn.

## Dates, length and people: how they work together

- **Totals**: My Day and each day in Planned show the total length ("3h 15m planned"). A day over a configurable budget (default 6h) turns amber, so overcommitting is visible before it happens.
- **Assigning**: assigning a task puts it in the other person's **Assigned to me** and notifies them. They can add it to *their* My Day and set *their own* reminder without changing yours. The assigner sees who finished it.
- **Overdue** is its own group in Planned and a count on the list, never silent.
- **Time boxing (phase 3)**: drag a task onto a Week view to give it a start time. Its length becomes the block height. Optional, and never required.

## Scope, and what we will not build

**In:** lists and smart lists, tasks with the fields above, steps, repeat, reminders, assignment, sharing, quick add, keyboard shortcuts, notifications, export to a calendar file (`.ics`).

**Out (to keep it light):** time tracking, Gantt or dependencies (use issues), priorities beyond the star, custom fields, automation rules, email reminders, a separate mobile app (the page is responsive), and per-task permissions.

## Data model

```sql
CREATE TABLE task_lists (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hue INTEGER NOT NULL DEFAULT 0,            -- 0-11, same colour system as spaces
  visibility TEXT NOT NULL DEFAULT 'private' -- 'private' | 'shared' | 'team'
    CHECK (visibility IN ('private','shared','team')),
  position REAL NOT NULL DEFAULT 0,
  group_name TEXT,                           -- optional folder for the sidebar
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE task_list_members (             -- only used when visibility = 'shared'
  list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (list_id, user_id)
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  important INTEGER NOT NULL DEFAULT 0,
  due_on TEXT,                               -- 'YYYY-MM-DD'
  remind_at TEXT,                            -- UTC timestamp
  repeat_rule TEXT,                          -- 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'every:N:day|week|month'
  estimate_min INTEGER CHECK (estimate_min IS NULL OR estimate_min BETWEEN 1 AND 6000),
  start_at TEXT,                             -- phase 3: time-boxed start
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  link_issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
  link_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX tasks_assignee ON tasks(assignee_id, completed_at, due_on);
CREATE INDEX tasks_list ON tasks(list_id, completed_at, position);
CREATE TABLE task_steps (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0
);
-- "My Day" is per person per day, so the same task can be on your day and not on a teammate's
CREATE TABLE task_my_day (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                         -- 'YYYY-MM-DD' in the person's day
  PRIMARY KEY (user_id, task_id, day)
);
-- reminders can be personal too (assignee sets their own)
CREATE TABLE task_reminders (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (task_id, user_id)
);
```

`tasks.remind_at` is dropped in favour of `task_reminders` before building; it is shown above only to name the concept.

Existing databases are upgraded in place with `CREATE TABLE IF NOT EXISTS`, like every other table.

## Pages and routes

| Route | Purpose |
|---|---|
| `GET /tasks` | Redirects to My Day |
| `GET /tasks/my-day`, `/important`, `/planned`, `/assigned`, `/all`, `/completed` | Smart lists |
| `GET /tasks/lists/:id` | A list |
| `POST /tasks` | Create (the quick-add parser runs in the browser and on the server) |
| `POST /tasks/:id` | Update any field (inline edits; returns JSON for the detail pane) |
| `POST /tasks/:id/complete` | Complete or reopen (creates the next occurrence if repeating) |
| `POST /tasks/:id/steps`, `/steps/:sid` | Add, tick, edit, delete a step |
| `POST /tasks/:id/my-day` | Add or remove from your day |
| `POST /tasks/lists`, `/tasks/lists/:id`, `/tasks/lists/:id/share` | Manage lists |
| `GET /tasks/export.ics` | Dated tasks as a calendar file |

All writes follow the existing rules: members and administrators write, viewers read, CSRF checks apply.

## Roles and visibility

- A private list is visible to its owner only (administrators cannot read private lists).
- Assigning a task in a shared or team list is allowed to anyone who can edit that list.
- A task assigned to someone from a private list is copied into **Assigned to me** for them and the list stays private to the owner.
- Viewers can see shared and team lists but not change them.

## Notifications

New kinds, using the existing bell, preferences, coalescing and desktop alerts:

| Kind | When |
|---|---|
| `task_assigned` | Someone assigns you a task |
| `task_reminder` | A reminder you set is due |
| `task_due` | Daily digest at 08:00 local: "3 due today, 1 overdue" |
| `task_done` | Something you assigned was completed |

A small server timer (every minute, unref'd) sends due reminders. It stores `sent_at` so a restart never double-sends. All kinds are switchable in Notification settings.

## Interface notes

- **Layout**: three columns as above; the detail pane collapses to a drawer on narrow screens.
- **Completing**: the circle fills, the row strikes through and slides into *Completed* (respects reduced motion).
- **Keyboard**: `N` new task, `Enter` add, `Space` complete, `D` due date, `M` My Day, `I` important, `Esc` close the pane, `G` then `T` go to Tasks.
- **Theme**: uses the existing tokens and themes; nothing new to design per theme.
- **Empty states** teach: My Day explains it resets daily and offers Suggestions.
- **Accessibility**: real checkboxes and buttons, labelled controls, focus management when the pane opens, no information by colour alone.

## Phases

### Phase 1: the list that works (M)

- Lists, tasks, steps, important, due date, My Day, completed.
- Smart lists: My Day, Important, Planned, All, Completed.
- Quick add with date, `!`, `#List`, `*`.
- Detail pane. Sidebar entry and counts. Keyboard shortcuts.
- Tests for each route, date grouping, and the parser.

### Phase 2: together (M)

- **Length** field, `~30m` token, day totals and the over-budget warning.
- **Assign to a person**, `@name` token, **Assigned to me**, notifications.
- Shared and team lists.
- Repeat rules and reminders (timer, bell, desktop alerts).
- Link a task to an issue or page; "Add to my tasks" on issues and pages.

### Phase 3: planning (S to M)

- Week view with time boxing by dragging (start time, length becomes block height).
- `.ics` export.
- Optional daily capacity per person.
- Learn lessons, tour mention, README and changelog.

## Acceptance criteria

- [ ] I can add a task with a due date and a length in one line, and see it in Planned and My Day with the length totalled.
- [ ] I can assign a task to a teammate; it appears in their **Assigned to me**, they are notified, and I can see when they finish it.
- [ ] My Day starts empty each day, offers my overdue and due-soon tasks as suggestions, and shows total planned time.
- [ ] Completing a repeating task creates the next one on the right date (weekdays skip weekends; month ends are handled).
- [ ] A private list is invisible to everyone else, including administrators.
- [ ] A viewer cannot create, change or complete tasks.
- [ ] Every control is keyboard reachable and has an accessible name; the page passes the existing accessibility audit.
- [ ] Reminders are sent once, survive a restart, and respect the person's notification settings.
- [ ] Old databases upgrade with no manual steps; existing tests still pass.

## Test plan

- **Unit**: quick-add parser (dates, lengths, people, lists, edge cases), repeat calculation, day grouping and totals.
- **Integration**: every route as admin, member and viewer; list visibility; assignment and notification flow; completion creating the next occurrence; reminder sending and `sent_at`.
- **Client (jsdom)**: quick add chips, completing animation hooks, detail pane open/close, keyboard shortcuts.
- **Security**: another user's private list and task ids return 404, not 403; length, title and notes limits; step and task counts are capped per list.

## Open questions

1. **Time zones.** Dates are stored as plain dates and reminders in UTC. Should each person have a time zone setting, or do we use the browser's? (Recommendation: the browser's, sent with each request.)
2. **One assignee or several?** To Do allows one. Recommendation: one, to keep ownership clear.
3. **Daily capacity.** One team-wide default, or per person? (Recommendation: per person, in Account.)
4. **Should a completed issue offer to close its linked task?** (Recommendation: no; keep the two systems separate.)
5. **Naming.** "Tasks" or "To Do"? (Recommendation: "Tasks", which does not clash with the Done column.)
