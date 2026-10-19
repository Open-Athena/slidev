# Edit mode: duplicate / copy-paste slide objects

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), 2026-10-18. Ryan, right-clicking a selected image on the Space Gremlin slide: "no way to dup this img IA'ly?"

The Edit-mode delete flow (`specs/delete-and-insert-flow.md`, Stage 1) can remove an object, but nothing creates one from an existing one.

## Ask

- **⌘D** on a selected object (image, `v-drag` element, component) duplicates it:
  - Insert a copy of its source lines right after the original's, located the way delete locates them (`sliceLineRange` / `findLineRun`).
  - Give the copy a fresh `dragId` (e.g. a `-2` suffix, or the next free one).
  - Offset it by +16px, +16px, then select it.
  - Record one `kind: 'insert'` event, so ⌘Z removes the copy (the inverse of delete's splice).
- **⌘C / ⌘V** with an object selected (not text-editing) copy its source lines plus its `element_state`.
  - Paste on the current slide, or on another slide after navigating there; same `dragId` and offset rules as ⌘D.
  - Pasting an image file from the system clipboard keeps today's behavior: copy into `public/images/`, insert `![]()`.
- **Menu entries:** the Edit-mode context menu (or the selection toolbar) gets "Duplicate ⌘D" and "Delete ⌫". Today's custom context menu shows only the slide-level items (editor, drawing, overview, presenter, fullscreen).
- **Absolutely positioned / class-styled images** (like the deck's `.sg-collage img`): the copy carries the same class, so it would sit exactly on top of the original. Give it an inline `element_state` at the offset position, so it's visibly a separate object.

## Tests

On a fixture slide with an `<img>`, a `![]()` and a `<v-drag>`:
- ⌘D produces the exact expected source lines, and ⌘Z restores the file byte for byte.
- ⌘C, then navigating to another slide and pressing ⌘V, inserts there.
- The duplicated `dragId`s are unique.
