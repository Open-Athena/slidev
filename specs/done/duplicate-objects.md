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

## As built

- **⌘D:** duplicates the selection. **⌘C / ⌘V:** ⌘C copies the selection's markdown (also to the system clipboard); ⌘V pastes on the current slide, which can be another slide. Both live in `composables/useCopyPaste.ts`, with the pure logic in `composables/element-copy.ts` (`test/element-copy.test.ts`).
  - ⌘V only acts when the clipboard still holds what ⌘C wrote. Image files and URLs still go to the existing paste-image handler.
  - Copies are offset by 16 px, plus another 16 per repeated paste; a paste on another slide keeps the original's position. Copies end up selected.
- **Copies are appended at the end of the slide, not right after the original.** This deviates from the spec. Auto ids (`img-x`, `img-x-2`, `cmp-…`) are numbered in order of appearance, so inserting a copy before other same-source elements would renumber them, and their saved positions would follow the wrong element.
  - The copy's id comes from the markup (`autoBaseId`): `img-<basename>` / `cmp-<kebab-tag>`, continuing the sequence. A basename can end in digits (`…-0813`), which the id alone can't tell from a counter.
  - Hand-written ids (`v-drag="'box'"`, `pos="note"`) are renamed `box-copy`, `box-copy-2`, ….
- **Undo:** one `text` history event carries both the inserted lines and the copies' positions (items with `before: null`), instead of a new `insert` kind. One ⌘Z removes the copy. The client's state cache is seeded so the copy mounts in place.
  - Positions are not written to frontmatter `dragPos`: that path migrates a slide's inline `dragPos` to `slides.coords.yaml`, as a side effect.
- **Finding elements:** elements without a `markdownSource` (from HTML: `draggableImages: all`, `draggableComponents`) are located in the slide by `findElement` (nth occurrence for numbered auto ids). The same matcher fixed ⌫ / ⌦, which silently skipped these elements. Delete removes the markup, and the line if nothing else is on it, as one undoable edit.
- **Toolbar, not context menu:** the selection toolbar under a selected object now always shows **Duplicate (⌘D)** and **Delete (⌫)** (plus the link / Reset AR controls when they apply). The context menu isn't used, because right-clicking an image now opens the browser's own menu (copy address / open / save), at Ryan's request.
- **Absolutely positioned, class-styled images:** the copy's position comes from the history state, so it renders offset from the original, not on top of it.

**Tests:** `cypress/e2e/examples/copy-paste.spec.ts` (stubbed clipboard, synthetic paste):
- ⌘D on slide 14 appends `box1-copy` (exact line), positioned at +16 px in the state, with the copy selected; ⌘Z restores the source.
- ⌘C, in-app navigation to slide 15, then ⌘V pastes `box1-copy` there at the original position.

The fixture deck has no `draggableImages`, so the `<img>` / `![]()` paths are covered by unit tests and were verified in Chrome on the deep-dive deck:
- duplicate via the toolbar → `…-0813-2` at +16 px, selected;
- toolbar delete → source byte-identical;
- ⌦ / ⌘Z on an HTML image restores byte for byte.
