---
relates:
  - features/draggable
  - features/side-editor
tags: [editor]
description: |
  Edit slide text in place, as rich text or raw markdown, and have it saved back to your slides source.
---

# In-App Text Editing

In the dev server, slide text can be edited right on the slide. Edits are written back to the slide's markdown, so the source stays the single source of truth.

1. Turn on edit mode: press `e`, or click the <carbon-pen class="inline-icon-btn"/> pen in the navigation bar. Editable blocks show a dashed outline on hover.
2. Double-click a heading, paragraph, list item or table cell.
3. Type. `Enter` saves, `Shift+Enter` adds a line break, `Esc` cancels, and clicking elsewhere saves.

## Rich text and raw markdown

When a block's markdown can be reproduced exactly from what's rendered (plain text, **bold**, *italic*, `code`, links, ~~strikethrough~~), it's edited in place as rich text: `⌘B` / `⌘I` work, and the edit is converted back to markdown on save.

Anything else (inline components, icons, math, HTML entities, escaped characters) opens a raw markdown box over the block instead. Hold `⌥` / `Alt` while double-clicking to get the raw box for any block.

Only the block's text is replaced; list markers, heading levels, blockquote markers and indentation are kept. Nested list items are separate blocks.

## Lists

In a list item, the editing keys work on the list's structure. Each key rewrites only the lines involved, and editing continues in the resulting item:

| Key | Effect |
|---|---|
| `Enter` | Split the item at the caret. At the end, this adds a new item below; on an empty item, it removes the item and stops editing. |
| `Backspace` at the start | Merge the item into the one above. |
| `Tab` / `⇧Tab` | Indent / outdent the item, with its nested list. |
| `⌥↑` / `⌥↓` | Move the item, with its nested list, up / down. |

Ordered lists numbered 1, 2, 3… are renumbered as items come and go (lazy `1.` `1.` numbering is left as is), and new task items start unchecked.

## WYSIWYG (prototype)

With `wysiwyg: true` in the headmatter (or a slide's frontmatter), double-clicking edits the whole run of markdown blocks around the click (headings, paragraphs, lists, blockquotes and tables, up to any HTML or component) in a [Milkdown](https://milkdown.dev) editor, which provides lists, formatting shortcuts and markdown input rules. `⌘Enter` or clicking away saves, and `Esc` cancels.

The editor only opens when its serialization of the unedited text lines up with the source line for line, and a save keeps every line you didn't change byte for byte, so the editor's normalizations (escaping `&` or `~`, padding tables) never rewrite untouched text. Otherwise, or with `⌥` held, editing falls back to the single block.

## Undo

Each saved edit is a step in the deck's edit history: `⌘Z` / `⌘⇧Z` undo and redo it, and it's listed in the history drawer (`h`).

## Limits

- Dev server only: a built deck has no source to write to.
- Text inside custom components, raw HTML blocks and code blocks isn't editable this way; use the [integrated editor](./side-editor).
- Pasting inserts plain text.
