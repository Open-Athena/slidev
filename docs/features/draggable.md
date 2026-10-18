---
tags: [layout]
description: |
  Move, resize, rotate, and crop elements by dragging them with the mouse.
---

# Draggable Elements

Draggable elements give you the ability to move, resize, rotate, and crop elements by dragging them with the mouse. This is useful for creating floating elements in your slides.

## Edit Mode

Editing is off by default, so clicks during a talk (or on a published deck) can't select or move anything, and links and embeds inside draggable elements stay clickable. Press `e`, or click the <carbon-pen class="inline-icon-btn"/> pen in the navigation bar, to toggle it. Text is editable in edit mode too (see [In-App Text Editing](./text-editing)). The setting is remembered per browser and synced across tabs, so the presenter and audience windows agree. Undo / redo (`⌘Z` / `⌘⇧Z`), image insert (`i`), paste and file drop only work in edit mode.

## Resizable Columns

In edit mode, hover the gap between two grid columns and drag the handle to change the split. Release saves it, double-click resets to equal columns, and `⌘Z` undoes it. The split snaps to ⅓, φ (0.382 / 0.618), ½ and ⅔; hold `⌘` to place it freely.

- **Layouts**: a layout opts in by marking its grid `data-slidev-cols` and reading its columns from `--slidev-cols` (`grid-template-columns: var(--slidev-cols, 1fr 1fr)`). The split is saved to the slide's frontmatter, e.g. `cols: 40/60`. The built-in `two-cols` and `two-cols-header` layouts opt in.
- **HTML grids in the slide's markdown** (`<div class="grid" style="grid-template-columns: 1fr 1.45fr">`, or a `grid-cols-*` class): the drag rewrites the tag's inline `grid-template-columns`, keeping its other styles. Grids with fixed or `auto` tracks, or columns set in a stylesheet, aren't resizable.

## Auto-Draggable Images

You can make all markdown images (`![](...)`) draggable by default, similar to Google Slides:

```yaml
---
draggableImages: true
---
```

When enabled, every image in your slides becomes draggable without needing explicit `v-drag` attributes. Positions are automatically stored in the frontmatter.

To also cover raw HTML `<img>` tags, and components that render a single image, use `all`:

```yaml
---
draggableImages: all
draggableImageTags: [Scrn] # optional: components whose root element is an image
---
```

Under `all`, images keep their place in the layout ([flow layout](#flow-layout)), so images in columns and grids stay put until you move them.

## Flow Layout

By default, a draggable element is taken out of the layout and positioned on the slide (`position: absolute`). That's right for free-floating elements, but an image in a grid cell or a column would leave its slot, letting its neighbors reflow into the space.

With flow layout, the element keeps its slot:

- Before you edit it, it renders exactly as authored.
- Moving shifts it visually (`position: relative`) without moving its neighbors.
- Resizing resizes its slot.
- Selecting a letterboxed image (`object-fit: contain`, as many themes give column images) fits the box to the image's pixels, so cropping clips the picture rather than the empty bands.

Enable it per element, per slide, or for the whole deck:

```md
<img v-drag.flow="'chart'" src="/chart.png">

<v-drag flow pos="note">…</v-drag>

---

dragLayout: flow # this slide; or under `defaults:` in the headmatter for every slide
---
```

Elements their author already positioned (e.g. `class="absolute right-8"`) keep absolute positioning either way. Positions are stored in slide coordinates in both modes.

## Directive Usage

### Data from the frontmatter

```md
---
dragPos:
  square: Left,Top,Width,Height,Rotate,ZIndex,CropTop,CropRight,CropBottom,CropLeft
---

<img v-drag="'square'" src="https://sli.dev/logo.png">
```

Only `Left,Top,Width,Height` are required. The optional parameters are:

- `Rotate`: Rotation angle in degrees (default: 0)
- `ZIndex`: Stack order (default: 100)
- `CropTop,CropRight,CropBottom,CropLeft`: Crop percentages from each edge (default: 0)

### Data from the directive value

::: warning
Slidev uses regex to update the position value in the slide content. If you encounter problems, please use the frontmatter to define the values instead.
:::

```md
<img v-drag="[Left,Top,Width,Height,Rotate]" src="https://sli.dev/logo.png">
```

## Component Usage

### Data from the frontmatter

```md
---
dragPos:
  foo: Left,Top,Width,Height,Rotate
---

<v-drag pos="foo" text-3xl>
  <div class="i-carbon:arrow-up" />
  Use the `v-drag` component to have a draggable container!
</v-drag>
```

### Data from props

```md
<v-drag pos="Left,Top,Width,Height,Rotate" text-3xl>
  <div class="i-carbon:arrow-up" />
  Use the `v-drag` component to have a draggable container!
</v-drag>
```

## Create a Draggable Element

When you create a new draggable element, you don't need to specify the position value (but you need to specify the position name if you want to use the frontmatter). Slidev will automatically generate the initial position value for you.

## Automatic Height

You can set `Height` to `NaN` (in directive) or `_` (in component props) to make the height of the draggable element automatically adjust to its content.

## Controls

### Selection and Movement

- **Click** a draggable element to select it. A selection box with resize handles appears.
- **Click and drag** to move the element immediately (no need to select first).
- Use **arrow keys** to nudge the selected element.
- Hold **Shift** while dragging or resizing to preserve aspect ratio.
- **Click outside** the element to deselect it.

### Rotation

A circular **rotation handle** appears above selected elements (Google Slides style). Drag it to rotate:

- The handle snaps to common angles (0°, 45°, 90°, etc.) when close.
- A stem connects the handle to the element for visual clarity.

### Z-Order (Layering)

When an element is selected, z-order buttons appear in the toolbar:

- **Bring Forward**: Increases the element's z-index, moving it above other elements.
- **Send Backward**: Decreases the element's z-index, moving it below other elements.

### Crop Mode

**Double-click** a selected element to enter crop mode. In crop mode:

- The full image is shown faded, with the kept region displayed at full brightness.
- Drag the **L-shaped corner handles** or **pill-shaped edge handles** to adjust the crop.
- Press **Enter** or click the **Done** button to apply the crop.
- Press **Escape** to cancel and revert any changes.

Crop values are stored as percentages from each edge (0-100%) in the position string.

### Link Detection

If a draggable element wraps a link (`<a>` tag), clicking the element selects it instead of following the link. A floating button appears showing the link URL, allowing you to open the link when needed.

## Draggable Arrow

The `<v-drag-arrow>` component creates a draggable arrow element. Simply use it like this:

```md
<v-drag-arrow />
```

And you will get a draggable arrow element. Other props are the same as [the `Arrow` component](/builtin/components#arrow).
