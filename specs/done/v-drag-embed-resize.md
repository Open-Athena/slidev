# v-drag: Support resizing for embedded content (iframes, components)

## Problem

The `v-drag` directive works well for images - elements can be dragged and resized interactively in the slide editor. However, for embedded content like `<Youtube>`, `<Tweet>`, or arbitrary iframes, resizing doesn't work the same way:

- Images scale naturally via width/height attributes
- Iframes/embeds either:
  - Don't resize at all
  - Resize the container but not the content
  - Require CSS transforms which can be blurry

## Desired Behavior

When `v-drag` is applied to non-image elements (directly or via wrapper div), resizing should "just work":

```html
<!-- Direct on component (if possible) -->
<Youtube v-drag="'video1'" id="xrio-BsgkqU" />

<!-- Or wrapped -->
<div v-drag="'video1'">
  <Youtube id="xrio-BsgkqU" />
</div>
```

## Proposed Approach

Detect element type and apply appropriate resize strategy:

### For iframes / embeds:
1. Store original aspect ratio on first render
2. On resize, update iframe `width`/`height` attributes directly
3. Maintain aspect ratio (with optional shift-drag to unlock)

### For arbitrary wrapped content:
1. Use CSS `transform: scale()` as fallback
2. Optionally, try to find and resize inner iframe/video elements

### For `<Youtube>` / `<Tweet>` components specifically:
1. These components accept `width`/`height` props
2. v-drag could update these props reactively
3. May require component-level integration or a wrapper component

## Implementation Notes

- The drag position persistence (`dragPos` in frontmatter) already stores x, y, width, height
- Need to hook into the resize handler to detect element type
- Consider a `resize-mode` option: `'scale'` | `'dimensions'` | `'auto'`

## Alternatives Considered

1. **CSS transform only**: Simple but blurry at non-1x scales
2. **Wrapper component**: `<Draggable><Youtube /></Draggable>` - more explicit but verbose
3. **Do nothing**: Users manually set dimensions, no interactive resize

## Open Questions

- Should aspect ratio lock be the default for video content?
- How to handle Tweet embeds which have dynamic height based on content?
- Should this be opt-in via a modifier like `v-drag.resizable`?

## Status

Done. `<VDrag>` wraps embeds (Tweet, Youtube, …) with body drag plus resize and rotate handles; `[data-drag-positioned] iframe.youtube` fills its box; Tweet height is passed through the transform chain so its iframe fills the drag wrapper.
