# Headmatter / frontmatter writes: change only the touched key

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), 2026-10-18, fork `1c72b9ad`.

Ryan picked a QR URL form (the `n` / `n-slug` / `slug` hover toggle from `91e16861`), which writes the deck's `qr.url`. The write re-serialized the whole headmatter:

- `draggableImageTags: [Scrn]` → `[ Scrn ]`;
- `skipSlides: [1]` → a block list (`- 1`);
- a trailing comment's two-space gap was collapsed (`baseUrl: … # …`).

He had the file open in VS Code, so this surfaced as a save conflict. Every reformatted line became its own diff hunk, burying the one real change, `url: n`.

## Ask

- Frontmatter writes (QR URL form, `cols:` from resizable columns, and any other Edit-mode write) edit only the touched key's node and keep the rest byte-identical: flow vs. block style, quoting, comments and spacing. Use `yaml`'s `parseDocument` / `doc.setIn(path, value)` / `doc.toString()` (Document API, which keeps comments and flow style), or a targeted line splice. Never `parse` → `stringify`.
- Test: a fixture headmatter with flow sequences, inline comments with odd spacing and quoted strings. Set `qr.url`, and the diff must be exactly the one added or changed line.

## As built

**Two causes:**
1. `updateFrontmatterPatch` replaced a patched key's whole node: `qr: {…}` became a new block-style map, so `skipSlides: [1]` became `- 1`.
2. `prettifySlide` re-serialized the whole YAML document with `doc.toString()` on every save of the slide, including saves that only edited its content. That turned `[Scrn]` into `[ Scrn ]` and collapsed the comment gaps.

**Fixes:**
- **`patchNode`** (`node/utils.ts`):
  - an object patched onto an existing map updates only the keys that differ, recursively, and deletes keys absent from the patch;
  - an unchanged value is left alone;
  - `null` deletes.
- **`minimalFrontmatterYaml`** (`parser/src/core.ts`, used by `prettifySlide`):
  - If the document serializes the same as the original raw YAML did, the raw text is kept verbatim.
  - Otherwise `mergeEditedLines` diffs the two serializations line by line (LCS), and lines whose serialization didn't change keep their original bytes. This is the same helper the WYSIWYG editor uses, moved to `@slidev/parser/utils`.
  - It falls back to the plain serialization only when the original doesn't line up with its own re-serialization line for line (e.g. a multi-line flow sequence).
  - `frontmatterRaw` is updated after each write, and set from the side editor's raw text, so later edits diff against what's on disk.

**Tests:** `test/frontmatter-write.test.ts`, on a headmatter with flow sequences, a quoted title and an inline comment with a 3-space gap:
- adding `qr.url` adds exactly that one line;
- changing `qr.position` changes one line;
- adding / removing top-level keys touches one line each;
- a content-only save leaves the frontmatter byte-identical.

TFFP: all four fail with the old whole-document serialization.

Verified in Chrome: clicking a QR URL form in the deep-dive deck copy changed exactly `url: slug` → `url: n-slug`.

**Not fixed here:** the deck's `slides.md` still has the reformatting from the earlier write (`[ Scrn ]`, the block `skipSlides`, the comment gap). That's the deck's file to restore.
