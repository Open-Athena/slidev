# v-drag Position Format Spec

This document specifies the position/size/crop encoding for v-drag elements, including the current format and potential future alternatives.

## Current Format (v1)

Comma-delimited numeric values:

```
Left,Top,Width,Height[,Rotate[,ZIndex[,CropTop,CropRight,CropBottom,CropLeft]]]
```

### Fields

| Index | Name       | Unit   | Default  | Description                           |
| ----- | ---------- | ------ | -------- | ------------------------------------- |
| 0     | Left       | px     | required | X position (left edge)                |
| 1     | Top        | px     | required | Y position (top edge)                 |
| 2     | Width      | px     | required | Element width                         |
| 3     | Height     | px/`_` | required | Element height, or `_`/`NaN` for auto |
| 4     | Rotate     | deg    | 0        | Rotation angle                        |
| 5     | ZIndex     | int    | 100      | Stack order                           |
| 6     | CropTop    | %      | 0        | Crop inset from top (0-100)           |
| 7     | CropRight  | %      | 0        | Crop inset from right (0-100)         |
| 8     | CropBottom | %      | 0        | Crop inset from bottom (0-100)        |
| 9     | CropLeft   | %      | 0        | Crop inset from left (0-100)          |

### Serialization Rules

- Trailing default values are omitted
- Only includes rotate if non-zero OR zIndex/crop needed
- Only includes zIndex if non-default OR crop needed
- Only includes crop if any value is non-zero
- For directive source, wrapped in `[]`: `[100,50,200,150]`

### Examples

```yaml
dragPos:
  simple: 100,50,200,150 # position + size only
  rotated: 100,50,200,150,45 # with 45° rotation
  layered: 100,50,200,150,0,150 # custom z-index (rot=0 required)
  cropped: 100,50,200,150,0,100,10,5,10,5 # 10% crop T/B, 5% L/R
  auto: 100,50,200,_ # auto-height
```

### Open Questions

**Crop units (% vs px)**:

- Current: percentage of element dimensions
- Pro %: Resolution-independent, survives resize, natural for `clip-path: inset()`
- Pro px: Consistent with position, more intuitive absolute values
- Decision: Keep % for now; it's more robust for responsive behavior

---

## Future Format Alternatives

### Option A: ImageMagick Geometry Style

```
WxH+X+Y[@rot][zN][cT-R-B-L]
```

**Examples:**

```yaml
dragPos:
  simple: 200x150+100+50 # WxH+X+Y
  rotated: 200x150+100+50@45 # with rotation
  auto: 200x_+100+50 # auto-height
  full: 200x150+100+50@45z150c10-5-10-5
```

**Crop shorthand** (CSS-like):

- `c10` → all sides 10%
- `c10-5` → TB=10%, LR=5%
- `c10-5-15-20` → T=10%, R=5%, B=15%, L=20%

**Pros:**

- Familiar ImageMagick convention
- Compact
- Natural default omission

**Cons:**

- W×H before X+Y (opposite of current L,T,W,H order)
- Mixing `x` and `+` delimiters

---

### Option B: Grouped Components

```
X+W,Y+H[@rot][zN][|cropT,R,B,L]
```

**Examples:**

```yaml
dragPos:
  simple: 100+200,50+150 # X+W, Y+H
  auto: 100+200,50 # omit +H for auto
  auto2: 100+200,50+_ # explicit auto
  full: 100+200,50+150@45z150|10,5,10,5
```

**Pros:**

- Groups related values (position+dimension per axis)
- Auto-height is natural (just omit)

**Cons:**

- Non-standard notation
- `+` overloaded (position and "plus width")

---

### Option C: Explicit Prefixes

```
[l<X>][t<Y>][w<W>][h<H>][r<rot>][z<N>][c<T>,<R>,<B>,<L>]
```

**Examples:**

```yaml
dragPos:
  simple: l100t50w200h150
  spaced: l100 t50 w200 h150 # spaces allowed
  rotated: l100t50w200h150r45
  auto: l100t50w200 # omit h for auto
  full: l100t50w200h150r45z150c10,5,10,5
```

**Pros:**

- Self-documenting
- Order-independent
- Clear what each value means

**Cons:**

- More verbose
- Parsing more complex

---

### Option D: JSON/Object Style

```yaml
dragPos:
  img1:
    pos: [100, 50]
    size: [200, 150]
    rotate: 45
    crop: [10, 5, 10, 5]
```

**Pros:**

- Most readable
- Natural for complex configs
- Easy to extend

**Cons:**

- Very verbose
- Overkill for simple cases
- Breaking change to frontmatter structure

---

## Recommendation

Keep current comma format for v1. It's:

- Simple to parse/serialize
- Already handles defaults well
- Working and tested

Consider Option A or C for v2 if users find current format unwieldy. Would need migration tooling for backwards compatibility.

---

## Related Features

### Pan in Crop Mode

The data model supports "panning" the visible region within a fixed frame:

- Crop values define which part of source is visible
- Moving all 4 crop values together = panning
- UI could offer a pan tool in crop mode (future enhancement)

### State Persistence

- **Undo/redo**: Session-scoped (sessionStorage), keyed by slide+dragId
- **Position persistence**: Already handled via frontmatter updates
- **Post-build editing**: Would require localStorage for static sites (future)
