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
