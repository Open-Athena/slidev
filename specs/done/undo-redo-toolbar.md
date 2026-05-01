# Undo/redo toolbar + persistent history for v-drag edits

## Problem

Slidev edits made via `<v-drag>` (move, resize, crop, z-order) persist
immediately and irreversibly to `slides.coords.yaml`. The only safety net
today is per-element undo/redo stored in `useSessionStorage` at
`packages/client/composables/useDragElements.ts:397`, which:

1. **Dies with the tab.** Refresh, browser quit, even some HMR cycles → the
   undo buffer is gone. A user who accidentally drags an element off-screen
   and then reloads to inspect the damage has lost the prior position
   permanently.
2. **Is per-element.** No single "discard the last edit I made" affordance; a
   user has to first re-select the affected element, which is impossible if
   the element is now off-screen and they don't know its drag-id.
3. **Has no UI surface.** No toolbar button, no menu item, no visible
   indicator that undo is available. The only access is via keyboard
   shortcuts that aren't documented in the in-app shortcuts modal.
4. **Doesn't survive accidental persistence to `slides.coords.yaml`.** Even
   if you undo in the live tab, the bad position is already committed to
   disk; close the tab, reopen, and the undo buffer is empty again.

This is the proximate cause of the loss-of-work incident in `hccs/tf` slide
2: a mobile pinch was misinterpreted as a drag (see
`mobile-pinch-vs-drag-conflict.md`), bp + bb logos shifted to y ≈ -200, the
user reloaded the desktop tab, and sessionStorage was cleared on reload —
making recovery impossible.

## Existing context

- **`deck-state-storage.md`** stage 3 proposes a server-managed SQLite-backed
  state DB with persistent per-element history. This spec is the UX layer on
  top of that proposal. The toolbar work doesn't have to wait for the DB —
  promoting today's `useSessionStorage` to `useLocalStorage` (per-deck
  origin) is a quick win that survives tab close + refresh.
- **`v-drag-position-format.md`** documents the position string format and
  notes that undo/redo today is "session-scoped (sessionStorage), keyed by
  slide+dragId". That keying needs to widen.
- **`dragpos-persistence.md`** discusses single-source-of-truth for
  positions; this spec deliberately *separates* "live committed state" (in
  `slides.coords.yaml`) from "edit history" (in storage), so undo can roll
  back across already-saved-to-disk edits.

## Goals

1. Undo/redo survives tab close, browser refresh, and `slides.coords.yaml`
   writes.
2. There's an obvious, prominent way to access undo/redo — keyboard *and*
   visible toolbar buttons.
3. A single "undo" can revert any of the four edit types (move, resize,
   crop, z-order). No need to first select the element being undone.
4. Recoverable from accidental drags-off-screen even if the user can't see
   or click the affected element.

## Proposed UX

### Toolbar buttons

Slidev currently has two toolbar surfaces:

- **NavControls.vue** (the bottom-left bar in `play.vue` with prev / next /
  fullscreen / overview / etc.).
- **Presenter** (richer toolbar in presenter mode).

Add **Undo** + **Redo** buttons to `NavControls.vue` (visible to both
presenter *and* audience-facing public mode, since edits happen in either
once `editorEnabled` headmatter / a query param is set). Place them adjacent
to the existing edit-mode entry point, with:

- Disabled state when the corresponding stack is empty.
- Tooltip showing "Undo last [move|resize|crop|z-order] of `<dragId>` on
  slide N" with the affordance description (uses VueUse Tooltip / floating
  UI, matching the rest of the bar).
- Visible only when edit interactions are enabled (don't pollute the bar
  when the deck is in pure-playback mode).

Keyboard: `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` (already partly bound — make
sure they trigger the same handler the toolbar button does, and update
`packages/client/internals/Shortcuts.vue` so they're discoverable in the
shortcuts modal).

### Behavior

A single global undo stack (per deck, not per element). Each entry is:

```ts
type EditEntry = {
  ts: number
  slideNo: number
  dragId: string
  kind: 'move' | 'resize' | 'crop' | 'zorder'
  before: PosStr  // the full position string before the edit
  after: PosStr   // the full position string after the edit
}
```

Pushing to the stack happens on commit (drag end / resize end / crop apply).
Undo pops the top entry, writes `before` back to `slides.coords.yaml` (and
back to the in-memory state), and pushes onto a redo stack. Redo is the
mirror.

The stack also serves the per-element history view (see
`deck-state-storage.md` §element_history), so this is forward-compatible
with stage 3 of that spec — the data model is identical.

### Persistence

**Stage 1 (quick win, ship soon):** Move from `useSessionStorage` to
`useLocalStorage`, keyed by `${origin}:${userRoot}:dragHistory`. Cap the
stack at e.g. 200 entries with FIFO eviction on overflow. Bound with a date
TTL too (e.g. 30 days) so old decks don't bloat localStorage. This survives
tab close + refresh; it doesn't survive `localStorage.clear()` or
cross-machine, but it's a 10× improvement at a fraction of the cost of
stage 2.

**Stage 2 (server-side, follows `deck-state-storage.md` stage 3):** Move
the stack to the server's `.slidev/state.db` once that lands. Then it
survives across machines (anyone with the repo gets the history) and across
browsers.

### "Undo last drag I just did" from anywhere

Even if the affected element is off-screen and the user can't click it, the
toolbar undo button should still work because the stack is global per
deck, not per element. This is a key acceptance criterion driven by the
incident: a user who misclicks should be able to recover *without first
having to find the element they misclicked.*

## Acceptance

- After a v-drag move that scrolls an element off-screen, clicking the
  toolbar Undo button restores it, even if the user has already refreshed
  the browser tab.
- After a v-drag resize, Undo restores the prior dimensions; a follow-up
  Redo re-applies them.
- Undo and Redo buttons appear in the bottom-left toolbar in both public
  and presenter modes when editing is enabled, with disabled state when
  the corresponding stack is empty, and tooltips describing the next
  pending action.
- `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` trigger the same handlers; both are
  listed in the shortcuts modal.
- LocalStorage stack persists across refresh; capped at 200 entries; older
  than 30 days are GC'd on init.
- A test deck with 5 sequential edits can be undone all the way to the
  pre-edit state and redone forward.

## Out of scope

- Branching history / non-linear redo.
- Cross-tab live sync (deferred to `deck-state-storage.md` stage 3).
- Snapshot-and-label workflow (also deferred to stage 3 — the durable
  log there subsumes labels for free).

## Implementation notes (Stage 1 landed)

- New module `packages/client/composables/useDragHistory.ts` owns the
  deck-global stack + a `(slideNo, dragId) → state` registry that mounted
  drag elements register into via `registerHistoryState`. Storage key is
  `slidev-drag-history:${origin}${pathname-without-slide-num}` so two decks
  on the same origin don't collide. Stacks GC stale entries (>30 days) on
  load and cap at 200 with FIFO eviction.
- `useDragElements.ts:saveSnapshot()` now takes an `EditKind` arg
  (`'move' | 'resize' | 'rotate' | 'crop' | 'zorder'`) and pushes a
  single-element entry. `state.undo()` / `state.redo()` are thin
  fire-and-forget delegations to the global module. The old per-element
  `useSessionStorage` history is gone.
- Group commits (the directive's `commit()`, `GroupDragControl.vue`'s drag
  + rotate handlers) call `pushGroupEdit(slideNo, kind, items[])` so a
  multi-element group edit is one atomic stack entry. One Cmd+Z reverts
  the whole group.
- Pinch-abort / pointercancel paths use `discardTopMatching(slideNo,
  dragIds[])` — pops the top entry only if it matches the same `(slideNo,
  dragIds)` set. This generalizes the previous single-element
  `discardSnapshot()` so it works for both single and group commits.
- Cmd+Z / Cmd+Shift+Z are registered globally inside
  `logic/shortcuts.ts:registerShortcuts()` (gated by the same `enabled`
  signal as other shortcuts). The duplicate handlers inside
  `DragControl.vue` and `GroupDragControl.vue` were removed.
- Toolbar Undo/Redo buttons live in `NavControls.vue` next to the slide
  overview button. Their `title` reactively reflects the top-of-stack
  description (e.g. "Undo move of `demo-card-a` on slide 14 (⌘Z)" or
  "Undo move of 2 elements on slide 14 (⌘Z)" for group edits) and they
  pick up the existing `disabled` styling when their stack is empty.
- Cross-slide undo: if the entry's `slideNo` ≠ current, the global
  `undo()` calls `nav.go(slideNo)` first, waits a tick + 50 ms for
  remount, then applies. Verified via Chrome MCP — drag on slide 14,
  navigate to 13, click Undo from the bar → slidev navigates back to
  14 and restores the position.
- `Shortcuts.vue` modal: this fork doesn't ship one (only
  `setup/shortcuts.ts` and a hover-discoverable bar). Adding a modal is
  separate scope.

## Stage 2 (deferred)

Server-side `.slidev/state.db` storage with cross-machine sync, kicking
in once `deck-state-storage.md` Stage 3 lands. Today's localStorage stack
is per-origin / per-browser; it survives refresh + close-and-reopen but
not cross-machine.
