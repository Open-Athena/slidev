import type Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

// Returns null when `better-sqlite3` can't be loaded. It's an optionalDependency, so a
// consumer's install may skip it (e.g. pnpm 11 ignores native build scripts unless
// allow-listed). The dev state plugin treats null as "feature off": it stops serving
// `/__slidev/state`, and the client's probe falls back to `LocalStateClient`. Lazy import
// also keeps `better-sqlite3` off the hot path of `slidev build`/`export`, which never
// open the DB.
export async function openStateDb(userRoot: string): Promise<Database.Database | null> {
  let DatabaseCtor: typeof Database
  try {
    DatabaseCtor = (await import('better-sqlite3')).default
  }
  catch (e) {
    console.warn(
      `[slidev/state] better-sqlite3 unavailable — SQLite-backed deck state (undo/redo `
      + `history, version drawer, multi-tab sync) is disabled; drag positions still persist `
      + `via slides.coords.yaml. ${(e as Error).message}`,
    )
    return null
  }

  const path = getStateDbPath(userRoot)
  const dir = dirname(path)
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })

  const db = new DatabaseCtor(path)
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
