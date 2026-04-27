# Deck State Storage: Splitting Human Content from Machine State

The single `slides.md` file is mixing two very different kinds of data — markdown an author hand-edits and machine-managed state (drag positions, crop, z-order, future history). That mixing is the root of three pain points: IDE-autosave-vs-server-edit races, opaque diffs full of `dragPos: 459,35,260,400,0,1000` lines, and a fragile "edit history lives in `sessionStorage`" undo experience that disappears with the tab. This spec scopes a staged migration toward more durable, less brittle state storage.

## Problem statement

Today, when an author drags an element in the browser, the dev server text-edits `slides.md`'s frontmatter to update `dragPos`. That round-trip is brittle:

- **IDE racing the server.** The author has `slides.md` open in VS Code/Cursor with autosave on. The dev server writes a frontmatter line; VS Code sees the disk change and reloads its buffer; the author types something and saves; either edit can clobber the other depending on timing. The user has hit this multiple times.
- **Diffs full of binary-ish coords.** A 30-element slide can show 30+ lines of `tweet-X: 459,35,260,400,0,1000` in a PR, drowning the actual content edits.
- **Undo is in-tab only.** `useSessionStorage` for the per-element history (`useDragElements.ts:397`) dies on tab close, browser refresh, or even (sometimes) HMR.
- **No "commit" affordance.** Drags persist immediately and irreversibly to the file. There's no way to experiment with a layout, decide it's worse, and revert without manually recalling old positions.

These get worse as decks grow and as more drag-managed media (the new `draggableImages` plugin, future image-picker spec) generate more state.

## Three changes, increasingly invasive

The three ideas the user raised are listed in order of disruption: extract coords first (smallest), per-slide files next, SQLite-backed state last (biggest). Each is independently valuable; they compose.

### 1. Coords in a separate file (small, ships first)

Move all `dragPos` (and future drag-managed state — z-order, rotation, crop) out of `slides.md` frontmatter into a sibling file:

```
demo/starter/
  slides.md            # human-edited markdown only
  slides.coords.yaml   # machine-managed; written by dev server; gitignored? maybe
```

Format:

```yaml
# slides.coords.yaml
slides:
  - no: 7
    drag:
      tweet-1390115482657726468: { x: 459, y: 35, w: 260, h: 400, rotate: 0, z: 1000 }
      yt-dQw4w9WgXcQ: { x: 109, y: 75, w: 371, h: 205, rotate: 0, z: 1, lockAR: true }
      img-logo-square: { x: 639, y: 145, w: 140, h: 140, rotate: 0, z: 1000 }
```

(The schema also lets us drop the cryptic positional tuple `459,35,260,400,0,1000` for explicit named keys, finally.)

#### Benefits
- Human-edited diffs stop including coord noise.
- IDE autosave on `slides.md` no longer races the server (different file).
- `slides.coords.yaml` can be `.gitignore`d for solo decks (positions are personal preference) or committed for shared decks.

#### Costs
- Requires migrating the parser to read both files and merge.
- Backward compat: support both `slides.md` frontmatter `dragPos` AND `slides.coords.yaml`, with the latter winning. Existing decks keep working.
- Need a one-shot `slidev migrate-coords` CLI to extract existing frontmatter into the new file and clean up `slides.md`.

#### Open questions
- Tracked vs ignored by default? Both are defensible — leaning toward tracked (so collaborators see consistent layout) with a per-deck override.
- One file per deck or one file per slide? Keeping it as one file mirrors how `dragPos` was already grouped under each slide; per-slide files are deferable to change #2 below.

### 2. Per-slide source files (medium, ships next)

Allow (eventually default) factoring `slides.md` into one file per slide:

```
demo/starter/
  slides/
    00-headmatter.yaml
    01-welcome.md
    02-table-of-contents.md
    07-components.md
    ...
  slides.md            # optional: a manifest / single-file fallback
```

Two reasonable conventions for the file naming:
- **Numeric prefix** (`07-components.md`) — slide order is encoded in filename. Renumbering renames files.
- **Slug-only** (`components.md`) — order lives in the manifest. Renaming a file doesn't reorder.

Slug-only with an explicit manifest is more git-friendly (a reorder is a 1-line manifest change, not a mass rename). Numeric prefixes are more "obvious" without the manifest.

#### Benefits
- Drastically smaller diffs per change.
- Multiple authors / agents can edit different slides without merge conflicts on a single 5K-line file.
- LLM context windows fit individual slides comfortably.
- IDE doesn't have to keep the entire deck warm in one buffer.
- Pairs naturally with #1 — `slides/07-components.md` becomes purely human content; coords live in `slides.coords.yaml`.

#### Costs
- Larger parser change than #1.
- `slidev export --format markdown` should still produce a single concatenated file for backward compat.
- Build-time perf: many small files → many file watches. Probably negligible at <1k slides.
- Headmatter has to live somewhere — either a top-of-deck `headmatter.yaml` or a `slides.config.ts`.

#### Migration
- Existing `slides.md` continues to work unmodified.
- New decks scaffolded by `slidev create` use the split format.
- `slidev split-slides` CLI splits a monolithic `slides.md` into per-slide files.

### 3. SQLite-backed deck state (big, ships when 1+2 prove valuable)

Introduce a Git-untracked `.slidev/state.db` (SQLite via `better-sqlite3` or similar) that the dev server owns and the browser talks to via a thin API. Holds:

- **Per-element drag state** (current values; "live" version of what `slides.coords.yaml` stores at rest).
- **Per-element history**: every change appended with `{ ts, user, snapshot }`. Undo/redo crosses tab/session/refresh boundaries. Old snapshots GC'd by age + count.
- **Pending vs committed state**: drag immediately writes to "pending"; an explicit "commit" (button or shortcut) flushes pending → `slides.coords.yaml` and clears the pending queue. `slides.coords.yaml` becomes the durable, Git-tracked snapshot; `.db` is the working scratchpad.
- **Snapshot/restore**: `slidev state snapshot --label "before redesign"` saves a labeled point; `slidev state restore <label>` rolls back. Cheap because the `.db` already has every change.
- **Cross-deck shared state** (future): a global `~/.slidev/state.db` for things like recent decks, last-opened slide per deck, picker recents.

Schema sketch:

```sql
CREATE TABLE element_state (
  slide_no INTEGER,
  drag_id TEXT,
  field TEXT,        -- 'x', 'y', 'w', 'h', 'rotate', 'z', 'cropTop', ...
  value TEXT,
  updated_at INTEGER,
  PRIMARY KEY (slide_no, drag_id, field)
);

CREATE TABLE element_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slide_no INTEGER,
  drag_id TEXT,
  snapshot TEXT,     -- JSON of full element state at that point
  ts INTEGER,
  source TEXT        -- 'drag', 'resize', 'crop', 'undo', 'restore', ...
);

CREATE TABLE labels (
  name TEXT PRIMARY KEY,
  ts INTEGER,
  description TEXT
);
```

#### Benefits
- Undo/redo persists across tabs, sessions, restarts.
- "Commit" semantics decouple in-progress experimentation from the source-controlled state.
- Easy snapshot/restore — a real safety net for big layout changes.
- Server is the single source of truth for live state; eliminates IDE vs. server races on `slides.coords.yaml` (the file is only written on commit).
- Future telemetry/analytics (e.g., "which slides did I rewrite most often") cheap to add.

#### Costs
- Real persistence layer to design, migrate, and version.
- A real API surface (REST or RPC over the existing dev-middleware) — needs care around concurrent clients.
- More moving parts when something goes wrong: now the source of truth depends on a `.db` that the user can't directly read/edit.

#### Open questions
- Do we ever need the `.db` to be portable across machines (e.g., share-by-SSH'ing the deck)? Probably no — state.db is a working scratchpad; commit it to the YAML if you want it portable.
- How does this interact with multiple browser tabs open on the same deck? Server-side state means they stay in sync; need to think about pending/commit semantics in that case.
- Do we expose the history through a UI (e.g., a sidebar timeline)? Out of initial scope, but the data model supports it.

## Suggested staging

1. **Now** — Land #1 (coords in `slides.coords.yaml`). Smallest user-visible change, eliminates the most-felt pain point (autosave races + diff noise).
2. **Next** — Land #2 (per-slide files), with the migration CLI and the manifest format. Most of the parser work for splitting falls out of having #1 already in place (coords already external).
3. **After 1+2 settle** — Evaluate #3 against the lived experience. By then we'll know whether the file-based approach is enough or whether the lack of "commit" + cross-session undo is biting hard enough to justify a real DB.

Each step is reversible: #1 can be undone by re-merging the YAML back into frontmatter; #2 by concatenating per-slide files. #3 is the only one with real lock-in, which is part of why it's last.

## Adjacent ideas / non-goals

- **Realtime collaborative editing.** Out of scope. The split-file design happens to make this less painful in the future (multiple authors editing different slides) but real conflict-free collaboration is a separate, much bigger project.
- **Replacing markdown with a richer format.** No. Markdown stays the human surface; this spec is purely about how machine-managed state is persisted alongside it.
- **A general-purpose CMS.** No. This is about Slidev decks; the patterns may generalize but we're not designing for that.
