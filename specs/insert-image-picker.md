# Insert Image / Media Picker

Let an author insert images (and other media) into the current slide from anywhere on disk via the Slidev web UI. The chosen file is copied into the deck's `public/` directory and a markdown image link is inserted into the slide source — so the slide becomes self-contained / portable, independent of the picker user's local paths.

## Motivation

Today the only ways to add an image to a slide are:

1. Edit `slides.md` directly and reference an existing path (`![](./images/foo.png)` or a remote URL).
2. Drop a remote URL (works, but requires hosting elsewhere first; offline-hostile).

Neither makes it easy to grab "the screenshot I just took on my desktop" or "the diagram in my Downloads folder" while you're iterating in the browser preview. Authors today reach for the terminal, `cp` into `public/`, and paste a markdown line — context-switch overhead per image, repeated dozens of times during a deck's life.

A built-in picker that handles the copy-and-insert in one motion fits how slides actually get built.

## UX

### Trigger

Two complementary entry points, both invoking the same picker:

- **Shortcut**: `i` (or `Cmd+i`) opens the picker dialog when not in an input. Wired into `setup/shortcuts.ts` alongside `goto`/`overview`.
- **Drag-and-drop**: drop one or more files onto a slide in the slide view (anywhere over `#slide-container`). Bypasses the dialog — files are processed and inserted in drop order.

(Future: clipboard paste — `Cmd+V` while focused on a slide — would land here too. Out of initial scope; covered in *Follow-ups*.)

### Picker dialog

When triggered via shortcut, show a dialog with:

- A native OS file picker (`<input type="file" accept="image/*,video/*" multiple>`) as the primary affordance.
- A short hint about the destination (`Will be copied to <deck>/public/<subdir>/`).
- Optional: a small preview/thumbnail strip showing files chosen but not yet inserted, with a "Cancel" / "Insert N file(s)" button to commit.

For the first cut, "Cancel" / "Insert" is fine — no need to render a recent-files list, dir browser, or tag system. The OS picker is good enough to start.

### Insertion

For each chosen file:

1. POST file contents to a Vite dev-middleware endpoint (`/__slidev/upload`, only registered in dev mode). Server writes to `public/<subdir>/<safe-name>`.
2. Server responds with the public URL (`/<subdir>/<safe-name>`).
3. Client inserts a markdown line into the current slide's source via the existing slide-source patch mechanism (the same one `dragPos` writeback uses — see `useDragElementsUpdater`). The line is appended to the end of the current slide block, e.g.:

   ```md
   ![](./images/screenshot-2026-04-26.png)
   ```

   With `draggableImages: true` already in headmatter, the inserted image immediately becomes a draggable v-drag element.

The user sees the new image appear on the current slide, ready to be repositioned with the existing drag/resize machinery.

## Scope of changes

### A. Server: upload endpoint

A new Vite middleware in `packages/slidev/node/vite/upload.ts` (or extend an existing `vite.ts` setup):

- Route: `POST /__slidev/upload`
- Body: `multipart/form-data` with one or more files.
- Behavior:
  - Resolve destination dir: `<userRoot>/public/<subdir>/`. Default `subdir = images` (configurable via headmatter `uploadDir: 'media/2026-04'` or similar).
  - `mkdir -p` the destination.
  - Generate safe filename (see *Naming*).
  - Write file, return `{ url, path, bytes }` per file.
- Dev-only — guard registration on `command === 'serve'` so this never ships in built decks.
- No auth. Slidev's dev server is already only meant to be reachable on trusted networks (the existing `--remote` flag is the user's opt-in to that).

### B. Naming & conflict handling

- Sanitize the original filename: lowercase, replace whitespace and most non-ASCII with `-`, strip path separators, collapse runs of `-`, cap at ~64 chars.
- If a file with the same sanitized name already exists, append a short content hash: `screenshot.png` → `screenshot-a3f2.png`.
- Never overwrite. The point is to make the deck a stable archive of what was inserted.

### C. Client: picker dialog

A new `packages/client/internals/InsertImageDialog.vue`, modeled on `Goto.vue`:

- Visibility ref `showInsertDialog` in `state/storage.ts`.
- Mounted at the same level as `<Goto />` in the play/slide views.
- Renders the file `<input>`, handles the upload POST, fires the slide-source patch on success.

### D. Client: drag-and-drop handler

A `useFileDrop` composable mounted on the slide container:

- Listens for `dragover` / `drop` events.
- Filters to image/video MIME types (configurable).
- Routes through the same upload + insert pipeline as the dialog.
- Visual feedback: a dashed outline over the slide container while dragging.

### E. Slide-source patch

Extend the existing source-patch helpers (the ones that write `dragPos` back to frontmatter) with an "append line to slide N" operation:

- Locate the slide block by `no` in the slides parser tree.
- Append the new markdown line just before the slide's terminating `---` (or end-of-file).
- Preserve surrounding blank-line conventions used by the rest of the slide.

Reuse whatever atomic-write / debounce machinery `dragPos` uses today to avoid clobbering concurrent edits.

### F. Headmatter knobs

```yaml
# slides.md headmatter
insert:
  dir: images           # default; resolved relative to public/
  acceptedTypes: ['image/*', 'video/*']
  maxBytes: 50_000_000  # 50 MB cap; reject larger and surface error in dialog
```

All optional; sensible defaults work out of the box.

## Non-goals (initial cut)

- **Remote URLs** as a picker source. (Authors can already paste those into `slides.md`; the picker's value-add is the on-disk → in-deck copy.)
- **Image editing** (crop, rotate, annotate) beyond what the existing v-drag UI offers.
- **Per-slide subdirs** (e.g. `public/slide-7/foo.png`). Single shared dir is simpler and avoids churn when slides are reordered.
- **Asset cleanup** when an image is removed from `slides.md`. Track manually for now; sweep tool is a separate future feature.

## Follow-ups

- **Clipboard paste**: `Cmd+V` over the slide container — same pipeline. The browser exposes pasted images as `File` objects via the `clipboard.read()` API or `paste` event. Only blockers are permissions UX and naming (no original filename).
- **Asset usage scan**: a `slidev assets` CLI subcommand that lists `public/` files and which slides reference them; flags orphans.
- **Sweep / GC**: opt-in `slidev assets prune` that removes unreferenced files (with `--dry-run` default).
- **Picker destination override**: a one-shot "Save to..." dropdown in the dialog for choosing among recent subdirs (deck-author's mental model: "this whole section's images go in `public/q1-screenshots/`").
- **PDF / SVG handling**: probably just fine through the same pipeline (they're files); insertion line might want to be `<embed>` or `<img>` depending on type.

## Open questions

1. **Default subdir name** — `images/`, `assets/`, `media/`, root of `public/`? `images/` keeps things tidy without being too verbose; arguably the cleanest default.
2. **Insertion position** — append to end of slide vs. attempt to insert at cursor position in the (likely-not-open) slide source? End-of-slide is dramatically simpler and matches how a user would type a new image line manually.
3. **`dragPos` for inserted images** — should we auto-write a `dragPos` entry too (centered, half-slide-width)? Or rely on `draggableImages: true` to position them in document flow until first interacted with? Latter is simpler; matches existing behavior for unpositioned draggable images.
