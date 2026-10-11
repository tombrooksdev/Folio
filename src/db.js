import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
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
  return db;
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
