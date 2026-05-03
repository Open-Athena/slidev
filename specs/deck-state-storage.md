# Deck State Storage: Splitting Human Content from Machine State

The single `slides.md` file is mixing two very different kinds of data — markdown an author hand-edits and machine-managed state (drag positions, crop, z-order, future history). That mixing is the root of three pain points: IDE-autosave-vs-server-edit races, opaque diffs full of `dragPos: 459,35,260,400,0,1000` lines, and a fragile "edit history lives in `sessionStorage`" undo experience that disappears with the tab. This spec scopes a staged migration toward more durable, less brittle state storage.

## Status

- **Stage 1 (coords sidecar file)** — shipped (notes below).
- **Stage 2 (per-slide source files)** — deferred indefinitely. Stage 1 alone resolved the IDE-autosave-vs-server-write race for `dragPos`, which was the most felt pain. The diff-noise + per-author conflict cases are real but not yet biting; revisit if they do.
- **Stage 3 (SQLite event-sourced state)** — actively in progress; redesigned around an event log (see below). Skipping Stage 2 because the DB is what unlocks the next set of UX wins (cross-session undo, commit semantics, version-history drawer) and per-slide files don't compose with the DB the way they compose with the YAML sidecar.

### Stage 1 notes (shipped)

Stage 1 (coords in a separate file) is implemented as `<userRoot>/slides.coords.yaml`. Notes on what shipped:

- **Format**: kept the existing positional-tuple string (`"459,35,260,400,0,1000,20,17,17,20"`) instead of switching to structured named keys. The format change is independently valuable but non-trivial (touches the client-side `useDragElements.ts` parser and the writeback path); deferred to a follow-up. File layout:
  ```yaml
  "7":
    tweet-1390115482657726468: 700,165,262,286,0,1000
    yt-dQw4w9WgXcQ: 321,266,278,156,0,1
  ```
- **Read path**: `loadCoords` runs in `resolveOptions` (initial load) and in the dev `loadData` callback (HMR reload). The merged coords win over inline `dragPos`.
- **Write path**: `loaders.ts` POST handler intercepts `body.frontmatter.dragPos`, routes to `saveCoordsForSlide` (atomic full-file rewrite via `writeFile`), strips the `dragPos` key from the slide's source frontmatter, and clears the YAML doc entirely if frontmatter is now empty (so `slides.md` ends up with no `---{}---` block).
- **No file watcher**: `slides.coords.yaml` is intentionally not added to `data.watchFiles`. The dev server is the sole writer; external edits require a server restart. This avoids a force-HMR-all-slides loop on every drag write.
- **Backward compat**: existing decks with inline `dragPos` keep working unchanged. The first drag in any slide silently migrates that slide's coords into the sidecar file. No explicit migration CLI; it's organic.
- **Side effect**: this also fixes a pre-existing crash in `loaders.ts` where `getModuleById` could return undefined and crash `invalidateModule` when `skipHmr: true` arrived before the slide module was loaded.

Files: `packages/slidev/node/coords.ts` (new, all helpers), `packages/slidev/node/options.ts` (initial-load merge), `packages/slidev/node/cli.ts` (HMR-reload merge), `packages/slidev/node/vite/loaders.ts` (POST interception + frontmatter cleanup).

Stages 2 (per-slide source files) and 3 (SQLite-backed state) are still on deck; see below.

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

### 3. SQLite-backed event-sourced state (next)

Introduce `<userRoot>/.slidev/state.db` (SQLite via `better-sqlite3`) — gitignored, sibling to the existing `og-cache/`. The dev server owns it; browser clients talk to it via a thin REST API on the existing dev-middleware.

**Model: event sourcing.** Two layers:

- **`events` is the source of truth** — append-only log of every drag/resize/crop/z-order/restore edit, each with `before` and `after` JSON payloads. Conceptually identical to the in-memory `EditEntry` shape we already have in `packages/client/composables/useDragHistory.ts` — replaces the localStorage stack entirely. Undo "undoes" by setting `undone_at`, not by deleting.
- **`element_state` is a materialized view** — current values per element, derivable from `events` but kept in a table for O(1) slide-load reads. Updated atomically (same transaction) as each event INSERT.

This is standard event sourcing — the right pattern for our case because edits are already discrete, named operations (the `EditKind` union: `'move' | 'resize' | 'rotate' | 'crop' | 'zorder'`), and a Google-Docs-style version-history picker falls out for free. SQLite's WAL mode handles single-writer/multi-reader cleanly; no need for `cr-sqlite` (CRDTs, multi-user) or `sqlite_session` (generic table-diffing) at this stage. Both remain forward-compatible upgrades if collaborative editing ever becomes a goal.

#### Schema

```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,                 -- ms since epoch
  slide_no    INTEGER NOT NULL,
  kind        TEXT NOT NULL,                    -- 'move' | 'resize' | 'rotate' | 'crop' | 'zorder' | 'restore' | 'hydrate'
  payload     TEXT NOT NULL,                    -- JSON: {items:[{drag_id, before, after}]}
  undone_at   INTEGER,                          -- nullable; non-null = logically reverted
  label       TEXT                              -- nullable; named snapshot
);
CREATE INDEX events_by_slide_ts ON events(slide_no, ts);
CREATE INDEX events_active      ON events(undone_at, ts);

CREATE TABLE element_state (
  slide_no        INTEGER NOT NULL,
  drag_id         TEXT NOT NULL,
  state           TEXT NOT NULL,                -- JSON: {x0, y0, width, height, rotate, zIndex, lockAR?, crop?}
  updated_at      INTEGER NOT NULL,
  source_event_id INTEGER REFERENCES events(id),
  PRIMARY KEY (slide_no, drag_id)
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- e.g. ('schema_version', '1'), ('last_yaml_commit_event_id', '<id>')
```

#### Endpoints (extend existing `/__slidev/...` middleware)

- `GET /__slidev/state` — full `element_state`, for cold-start client hydration. Returns `{ [slideNo]: { [dragId]: state } }`.
- `POST /__slidev/state/edit` — body `{slideNo, kind, items:[{dragId, before, after}]}`. Inserts an event row + upserts `element_state` rows in one transaction; returns the new `eventId`. Replaces today's `dragPos`-frontmatter POST path.
- `POST /__slidev/state/undo` and `/redo` — body `{eventId?}` (default = topmost active event for undo / topmost undone for redo). Toggles `undone_at`, recomputes affected `element_state` rows by replaying the active event chain for the involved `(slide_no, drag_id)` keys, returns the affected rows so the client can apply them in place.
- `POST /__slidev/state/commit-yaml` — flushes the entire `element_state` to `slides.coords.yaml` (atomic rewrite, same path as today), updates `meta.last_yaml_commit_event_id`. Returns `{committed_event_id, dirty: false}`.
- `GET /__slidev/state/events?slide=<n>&since=<id>&limit=<n>` — paged feed for the version-history drawer.

#### Lifecycle

**Cold-start hydration.** On dev-server boot, if `state.db` is empty (fresh clone or after `rm`), seed `element_state` from `slides.coords.yaml` (the existing loader already merges that file). Insert one synthetic `kind='hydrate'` event with `label='hydrate-from-yaml'` so the timeline shows a clear origin.

**Drag → DB.** The client's existing edit pipeline (`useDragHistory.pushEdit` / `pushGroupEdit`) is repointed: instead of writing to localStorage, it `POST`s to `/__slidev/state/edit` and updates the in-memory store from the response. The localStorage stack goes away entirely (no more 200-entry cap, no TTL, no deck-scoped key).

**Undo/redo.** The Cmd+Z / toolbar buttons issue `/__slidev/state/undo` and `/redo`. Cross-slide undo still works (the client's "navigate to slide first" wrapper stays).

**Commit → YAML.** Drags **no longer** auto-write `slides.coords.yaml`. The YAML becomes a snapshot artifact, written only when the user (or an auto-flush rule) hits commit. `slides.coords.yaml` remains the portable, Git-trackable form.

#### "Commit" UI

- Add a new IconButton in `NavControls.vue` next to the existing Undo/Redo controls — hollow when DB matches YAML, filled with a dot when there are uncommitted edits. Tooltip: "Commit N edits to `slides.coords.yaml` (since last commit)".
- Slash command alias for power users.
- Optional auto-flush settings (off by default): "auto-commit on slide change", "auto-commit on idle (Ns)". Both implemented client-side as POSTs.
- Initial implementation: manual only. Auto-flush options are a follow-up.

#### Version-history drawer (the "Google Docs picker" analogue)

A side panel listing events in reverse-chronological order, grouped by `kind` and a short summary derived from `payload` (e.g. "Moved 3 elements on slide 14 · 2 min ago"). Click an event → preview state-at-that-event in the slide canvas (read-only ghost overlay). "Restore to here" inserts a synthetic `kind='restore'` event whose `payload` snapshots the current `element_state` and `after`-snapshots the historical state — so the restore itself is undoable.

This is **deferred to Stage 3b**; Stage 3a is the DB + endpoints + commit button, which is enough to get the persistence wins and the cross-session undo.

#### Sub-phases

- **3a (this PR)** — schema, dev-middleware endpoints, client hydration, repoint history pipeline at the DB, "commit" button. localStorage history removed. Deck behavior is a strict superset of today (drag still works; undo now persists; YAML only written on commit).
- **3b** — version-history drawer UI.
- **3c** — `slidev state snapshot --label "before redesign"` and `slidev state restore <label>` CLIs (uses `events.label`).

#### Benefits
- Undo/redo persists across tabs, sessions, restarts, machine reboots.
- "Commit" semantics decouple in-progress experimentation from the source-controlled state — no more accidental "I dragged five things, committed the file, then realized that was a worse layout" regret.
- Easy snapshot/restore via labeled events — a real safety net for big layout changes.
- Server is the sole writer of `slides.coords.yaml`, only at commit time → IDE-vs-server races on the YAML disappear.
- Drawer falls out of the schema for free; no extra tables.

#### Costs
- Real persistence layer to design, migrate, and version (a `meta.schema_version` row + a small migration runner).
- New API surface, with multi-tab considerations (see open questions).
- One more file in `.slidev/` to be aware of when something looks weird; failure mode is "delete `state.db`, redrag the affected slide, recommit".
- Net code: removes the localStorage history module, adds a server-side state module + endpoints + a small client store.

#### Open questions
- **Multiple tabs on the same deck.** The DB is server-owned, so reads stay in sync, but a write from tab A doesn't push to tab B. v1: poll-on-focus, or skip and accept "last writer wins per element" until WS lands. Probably fine because users rarely have two tabs on the same deck open.
- **Event-log growth.** Append-only; KB-scale per deck even after months of editing. Add periodic compaction events that supersede prior history if it ever feels heavy. Not a v1 concern.
- **Restore semantics.** Restore inserts a new event rather than truncating history → linear timeline, cleaner mental model. Tradeoff: restoring repeatedly produces clutter. Acceptable for v1.
- **Cross-deck shared state.** A global `~/.slidev/state.db` for "recent decks", picker history, etc. — out of Stage 3 scope.
- **Portability.** The `.db` is gitignored scratch; `slides.coords.yaml` remains the portable form. If the user wants to share their working state, they commit. No need to ever version `state.db`.

## Suggested staging

1. **Shipped** — #1 (coords in `slides.coords.yaml`). Eliminated the most-felt pain (autosave races + diff noise).
2. **Skipping for now** — #2 (per-slide files). Reconsider only if diff size or multi-author conflicts start hurting.
3. **In progress** — #3 (event-sourced DB). Sub-phases 3a → 3b → 3c above.

Each step is reversible: #1 by re-merging the YAML back into frontmatter; #2 (if ever shipped) by concatenating per-slide files; #3 by exporting `state.db` to YAML, deleting the DB, and reverting the client to the localStorage path. #3 has the most lock-in, which is part of why it lands incrementally and ships behind a feature flag during 3a.

## Adjacent ideas / non-goals

- **Realtime collaborative editing.** Out of scope. The split-file design happens to make this less painful in the future (multiple authors editing different slides) but real conflict-free collaboration is a separate, much bigger project.
- **Replacing markdown with a richer format.** No. Markdown stays the human surface; this spec is purely about how machine-managed state is persisted alongside it.
- **A general-purpose CMS.** No. This is about Slidev decks; the patterns may generalize but we're not designing for that.
