import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') {
    // Private by default: the database holds password hashes and every page. SQLite gives the -wal/-shm files the same mode.
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, '', { flag: 'a', mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not the owner (e.g. a mounted volume): leave it */ }
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') for (const ext of ['-wal', '-shm']) try { chmodSync(file + ext, 0o600); } catch { /* not there yet, or not ours */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE CHECK (key NOT GLOB '*[^A-Z0-9-]*'),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS pages_space ON pages(space_id, parent_id);
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      edited_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS versions_page ON versions(page_id, id DESC);
    CREATE TABLE IF NOT EXISTS sprints (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','active','closed')),
      weeks INTEGER NOT NULL DEFAULT 2,
      started_at TEXT,
      ends_at TEXT,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      num INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'story' CHECK (type IN ('story','bug','task')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
      points INTEGER,
      sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      rank REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (space_id, num)
    );
    CREATE INDEX IF NOT EXISTS issues_space ON issues(space_id, sprint_id, status, rank);
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- Every change to a sprint's scope or completed points, so burndown and history can be replayed.
    CREATE TABLE IF NOT EXISTS sprint_log (
      id INTEGER PRIMARY KEY,
      sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
      issue_id INTEGER,
      scope_delta INTEGER NOT NULL DEFAULT 0,
      done_delta INTEGER NOT NULL DEFAULT 0,
      initial INTEGER NOT NULL DEFAULT 0,
      at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS sprint_log_sprint ON sprint_log(sprint_id, at);
    -- Issues that were not finished when a sprint closed (they move back to the backlog).
    CREATE TABLE IF NOT EXISTS sprint_carry (
      sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
      issue_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      points INTEGER,
      PRIMARY KEY (sprint_id, issue_id)
    );
    CREATE TABLE IF NOT EXISTS epics (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS issue_labels (
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      PRIMARY KEY (issue_id, label)
    );
    CREATE INDEX IF NOT EXISTS issue_labels_label ON issue_labels(label);
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      stored TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS attachments_owner ON attachments(page_id, issue_id);
    CREATE TABLE IF NOT EXISTS page_comments (
      id INTEGER PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS page_comments_page ON page_comments(page_id, id);
    CREATE TABLE IF NOT EXISTS issue_links (
      id INTEGER PRIMARY KEY,
      from_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('blocks','relates','duplicates')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (from_id, to_id, type)
    );
    CREATE TABLE IF NOT EXISTS issue_events (
      id INTEGER PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS issue_events_issue ON issue_events(issue_id, id);
    CREATE TABLE IF NOT EXISTS page_labels (
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      PRIMARY KEY (page_id, label)
    );
    CREATE INDEX IF NOT EXISTS page_labels_label ON page_labels(label);
    CREATE TABLE IF NOT EXISTS page_stars (
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (page_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS page_views (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, page_id)
    );
    -- Small per-user state: finished the tour, dismissed hints, completed lessons, notification preferences.
    CREATE TABLE IF NOT EXISTS user_flags (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '1',
      at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS watchers (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('issue','page')),
      ref_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, ref_id)
    );
    CREATE INDEX IF NOT EXISTS watchers_ref ON watchers(kind, ref_id);
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ref TEXT,
      text TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read_at, id DESC);
    -- Tasks: a personal and team to-do list (lists, tasks, steps, a per-day "My Day" and per-person reminders).
    CREATE TABLE IF NOT EXISTS task_lists (
      id INTEGER PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      hue INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','team')),
      position REAL NOT NULL DEFAULT 0,
      group_name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS task_lists_owner ON task_lists(owner_id, position);
    CREATE TABLE IF NOT EXISTS task_list_members (
      list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      can_edit INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (list_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      important INTEGER NOT NULL DEFAULT 0,
      due_on TEXT,
      repeat_rule TEXT,
      estimate_min INTEGER CHECK (estimate_min IS NULL OR estimate_min BETWEEN 1 AND 6000),
      start_at TEXT,
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      link_issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
      link_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assignee_id, completed_at, due_on);
    CREATE INDEX IF NOT EXISTS tasks_list ON tasks(list_id, completed_at, position);
    CREATE TABLE IF NOT EXISTS task_steps (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS task_steps_task ON task_steps(task_id, position);
    CREATE TABLE IF NOT EXISTS task_my_day (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      PRIMARY KEY (user_id, task_id, day)
    );
    CREATE TABLE IF NOT EXISTS task_reminders (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      remind_at TEXT NOT NULL,
      sent_at TEXT,
      PRIMARY KEY (task_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS task_reminders_due ON task_reminders(sent_at, remind_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      title, body, content='pages', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
      INSERT INTO pages_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO pages_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
  `);
  // Columns added after v0.4: older databases are upgraded in place.
  addColumn(db, 'issues', 'epic_id', 'INTEGER REFERENCES epics(id) ON DELETE SET NULL');
  addColumn(db, 'users', 'role', "TEXT NOT NULL DEFAULT 'member'");
  // Databases from before roles existed: the first user becomes the administrator.
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase ON users (username COLLATE NOCASE)'); } catch { /* existing look-alike accounts: keep working, the app also checks case-insensitively */ }
  addColumn(db, 'issues', 'parent_id', 'INTEGER REFERENCES issues(id) ON DELETE SET NULL');
  addColumn(db, 'spaces', 'github_repo', 'TEXT');
  // Sprints that were started before burndown tracking existed get a starting snapshot from their current issues.
  db.exec(`
    INSERT INTO sprint_log (sprint_id, issue_id, scope_delta, done_delta, initial, at)
    SELECT s.id, i.id, COALESCE(i.points, 0), CASE WHEN i.status = 'done' THEN COALESCE(i.points, 0) ELSE 0 END, 1, s.started_at
    FROM sprints s JOIN issues i ON i.sprint_id = s.id
    WHERE s.state = 'active' AND NOT EXISTS (SELECT 1 FROM sprint_log l WHERE l.sprint_id = s.id)`);
  return db;
}

function addColumn(db, table, column, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Run fn inside a transaction; roll back on throw.
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function buildTree(pages) {
  const byParent = new Map();
  for (const p of pages) {
    const k = p.parent_id ?? 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(p);
  }
  const walk = (pid) =>
    (byParent.get(pid) ?? [])
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => ({ ...p, children: walk(p.id) }));
  return walk(0);
}

// Turn a FTS5 user query into a safe prefix-match query.
export function ftsQuery(q) {
  const terms = q.match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.map((t) => `"${t}"*`).join(' ');
}
