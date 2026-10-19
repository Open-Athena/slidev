# Edit mode: add / remove / reorder list items, and a WYSIWYG block editor

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), 2026-10-18, on fork `1c72b9ad`.

Ryan, on the Outline slide: "each `<li>` is a separate field? no way to add/rm `<li>`s?" Then: "is there a decent WYSIWYG MD rich text editor widget we can use here, and on save/blur it compiles into whatever fmt the BE needs?"

Today (`specs/done/in-app-text-editing.md`), each heading, paragraph, list item and table cell is its own `contentEditable` block. Enter saves, and splitting or merging blocks is listed under future work. So a list can't grow or shrink in place; the only way is the side editor.

## Approach: decide this first

**A. Extend the current per-block editor with list structure ops.** Smallest change, and it keeps the byte-exact source splicing that already works.

| Key | Action |
|---|---|
| Enter at the end of an item | save it, insert a sibling item below (same marker, indent and task box), and start editing it |
| Enter mid-text | split the item in two |
| Enter on an empty item | remove it and stop editing (the "exit list" convention) |
| Backspace at the start of an empty item | delete it, then edit the previous item at its end |
| Backspace at the start of a non-empty item | merge it into the previous item |
| Tab / ⇧Tab | indent / outdent: re-nest under the previous sibling, rewriting indentation in the source |
| ⌥↑ / ⌥↓ | move the item, with its nested list, up / down |

**B. A WYSIWYG editor over a block group.** On double-click, open a ProseMirror-based editor over the whole enclosing *region*: the list, or the run of plain markdown blocks between HTML / component / `::slot::` boundaries. It gives list ops, bold / italic / code / links, and a formatting toolbar for free. On save or blur, serialize the region back to markdown and splice it into the region's source line range.

Candidates:

| Editor | Fit |
|---|---|
| **Milkdown** | Recommended. ProseMirror plus remark, markdown-native: parses with remark and serializes with remark-stringify, so its output options can match the source's style (`-` bullets, `*` emphasis, fence style, list indent). Framework-agnostic core, Vue usage documented, plugin-based (GFM, history, clipboard). |
| Tiptap + its markdown extension | Bigger ecosystem and nice UX. Markdown round-tripping is an add-on, historically lossier than Milkdown's remark pipeline. |
| prosemirror-markdown | The bare layer under both. The most control and the most work. |
| MDXEditor / Lexical / BlockNote | React-first, and Lexical's or BlockNote's markdown export is lossy. Poor fit for a Vue client. |

**The real risk with B is round-trip fidelity, not the widget.** Slidev markdown carries raw HTML, Vue components, `v-click` / `v-mark` attributes, `::left::` slots, `{…}` classes, MDC syntax and `<!-- notes -->`, none of which a markdown WYSIWYG models. Rules:

- Only open B on a region made purely of markdown the editor's schema covers: paragraphs, headings, lists, task lists, emphasis, code, links, images, tables. Anything else stays on today's per-block path, or falls back to the raw-markdown box.
- **No-op round trip must be byte-identical.** On open, serialize the unedited doc. If that doesn't equal the source region byte for byte, don't open B for that region, and log which construct didn't round-trip. That way the serializer's normalizations (`*` → `-`, escaping, reflow, renumbering) can never silently rewrite text the user didn't touch.
- **Minimal diff on save:** splice only the changed top-level blocks back. Blocks the user didn't touch keep their original bytes, even if the serializer would print them differently.
- One history event per editor session (open → save), with byte-exact undo like today's `text` events.

**Recommendation:** ship A now; it is small, and lists are the immediate need. Prototype B with Milkdown behind a flag (`editor: { wysiwyg: true }`), using the fidelity gate above. Grow B's region set only as its round trips prove exact on real decks. This deck is a good corpus: run the no-op round trip over every region of `~/c/oa/disky-deep-dive/slides.md` and report how many qualify.

## Tests

- For each op in A: a Cypress fixture with nested and ordered lists and a task list, asserting the exact rewritten markdown lines, then ⌘Z restoring the source byte for byte.
- For B, if prototyped:
  - the no-op round trip over a fixture corpus is byte-identical for every region B accepts;
  - regions containing HTML / components / slots are refused;
  - editing one list item rewrites only that item's lines.
