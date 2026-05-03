import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'

export const STATE_DB_RELPATH = join('.slidev', 'state.db')

const SCHEMA_VERSION = 1

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  slide_no     INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  undone_at    INTEGER,
  abandoned_at INTEGER,
  label        TEXT
);
CREATE INDEX IF NOT EXISTS events_by_slide_ts ON events(slide_no, ts);
CREATE INDEX IF NOT EXISTS events_active      ON events(undone_at, abandoned_at, ts);

CREATE TABLE IF NOT EXISTS element_state (
  slide_no        INTEGER NOT NULL,
  drag_id         TEXT NOT NULL,
  state           TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  source_event_id INTEGER REFERENCES events(id),
  PRIMARY KEY (slide_no, drag_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`

export function getStateDbPath(userRoot: string): string {
  return join(userRoot, STATE_DB_RELPATH)
}

export function openStateDb(userRoot: string): Database.Database {
  const path = getStateDbPath(userRoot)
  const dir = dirname(path)
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  const cur = (db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined)?.value
  if (!cur) {
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
  }
  else if (Number(cur) !== SCHEMA_VERSION) {
    // No migrations defined yet; this branch is the placeholder for future schema bumps.
    throw new Error(`[slidev/state] Unknown schema_version "${cur}" in ${path} (this build expects ${SCHEMA_VERSION})`)
  }

  return db
}
