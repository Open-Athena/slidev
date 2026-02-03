---
tags: [layout]
description: |
  Move, resize, rotate, and crop elements by dragging them with the mouse.
---

# Draggable Elements

Draggable elements give you the ability to move, resize, rotate, and crop elements by dragging them with the mouse. This is useful for creating floating elements in your slides.

## Auto-Draggable Images

You can make all markdown images (`![](...)`) draggable by default, similar to Google Slides:

```yaml
---
draggableImages: true
---
```

When enabled, every image in your slides becomes draggable without needing explicit `v-drag` attributes. Positions are automatically stored in the frontmatter.

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
