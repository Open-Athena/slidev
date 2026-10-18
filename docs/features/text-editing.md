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

## Undo

Each saved edit is a step in the deck's edit history: `⌘Z` / `⌘⇧Z` undo and redo it, and it's listed in the history drawer (`h`).

## Limits

- Dev server only: a built deck has no source to write to.
- Text inside custom components, raw HTML blocks and code blocks isn't editable this way; use the [integrated editor](./side-editor).
- Pasting inserts plain text.
