---
# This fork defaults slide URLs to the `n-slug` canonical form (e.g. `/5-page-5`).
# The upstream nav specs in `basic.spec.ts` assert plain `/5`-style URLs, so pin this
# fixture deck to the `n` form.
publish:
  canonicalForm: n
---

# Page 1

Hello World

---

# Page 2

```html
<style>
p {
  color: red;
}
</style>
```

`<p>` should have a green border, but no red text

<style>
p {
  border: 1px solid green;
}
</style>

---
src: sub/page1.md
---

This will be ignored

---
src: sub/page2.md
background: https://sli.dev/demo-cover.png
---

---

# Page 5

```html
<div>{{$slidev.nav.currentPage}}</div>
```

Current Page: {{$slidev.nav.currentPage}}

---

# Page 6

<v-clicks>

- A
- B
- C

</v-clicks>

<v-clicks>

1. C
2. B
3. A

</v-clicks>

---

# Page 7

$$
\begin{aligned}
\frac{D \boldsymbol{v}}{D t}=&-\frac{1}{\rho} \operatorname{grad} p+\frac{\mu}{\rho} \Delta \boldsymbol{v}+\frac{\lambda+\mu}{\rho} \operatorname{grad} \Theta+\frac{\Theta}{\rho} \operatorname{grad}(\lambda+\mu) \\
&+\frac{1}{\rho} \operatorname{grad}(\boldsymbol{v} \cdot \operatorname{grad} \mu)+\frac{1}{\rho} \operatorname{rot}(\boldsymbol{v} \times \operatorname{grad} \mu)-\frac{1}{\rho} \boldsymbol{v} \Delta \mu+\boldsymbol{g}
\end{aligned}
$$

---
layout: two-cols
---

::right::

# Right

<b>Right</b>

:: default ::

# Left

Left

---

# Page 9

<div class="cy-content">
  <div v-click="3">A</div>
  <div v-click="2">B</div>
  <div v-click="1">C</div>
  <div v-click.hide="4">D</div>
  <v-click hide><div>E</div></v-click>
</div>

---

# Page 10

<div class="cy-content-hide">
  <div v-click-hide>A</div>
  <div v-click-hide>B</div>
  <div v-click>C</div>
  <div v-click-hide>D</div>
</div>

---

# Page 11

<div class="cy-depth">
<v-clicks depth="3">

- A
  - B
    - C
    - D
  - E
  - F
    - G
    - H
- I

</v-clicks>

<v-clicks>

- J
- K
- L

</v-clicks>
</div>

---

# Page 12

<v-clicks>
  <ul><li>A</li><li>B</li></ul>
</v-clicks>

<wrap-in-clicks>
  <ul><li>A</li><li>B</li></ul>
</wrap-in-clicks>

<wrap-in-clicks>

- A
- B

</wrap-in-clicks>

---

# Page 13

<div class="cy-wrapdecorate">
<wrap-in-clicks-decorate>
  <li>E</li>
  <li>F</li>
</wrap-in-clicks-decorate>

(the next is kept for a future patch but not animating the nesting)

<wrap-in-component-in-clicks>
  <li>step i</li>
  <li>step j</li>
</wrap-in-component-in-clicks>
</div>

---
dragPos:
  box1: 100,100,100,100
  box2: 250,100,150,100
  box3: 450,100,100,150
  box4: 100,300,200,80
---

# Page 14 - v-drag Resize & Position Tests

<div v-drag="'box1'" class="cy-drag-box bg-red-500" data-testid="box1">100x100</div>
<div v-drag="'box2'" class="cy-drag-box bg-blue-500" data-testid="box2">150x100</div>
<div v-drag="'box3'" class="cy-drag-box bg-green-500" data-testid="box3">100x150</div>
<div v-drag="'box4'" class="cy-drag-box bg-yellow-500" data-testid="box4">200x80</div>

<style>
.cy-drag-box {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  border-radius: 4px;
}
</style>

---
dragPos:
  stack-a: 100,200,150,150,0,100
  stack-b: 300,200,150,150,0,101
  stack-c: 500,200,150,150,0,102
---

# Page 15 - v-drag Z-Order Tests

Click boxes to select, use toolbar buttons to change z-order

<div v-drag="'stack-a'" class="cy-stack-box bg-red-500" data-testid="stack-a">A (z:100)</div>
<div v-drag="'stack-b'" class="cy-stack-box bg-blue-500" data-testid="stack-b">B (z:101)</div>
<div v-drag="'stack-c'" class="cy-stack-box bg-green-500" data-testid="stack-c">C (z:102)</div>

<style>
.cy-stack-box {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 24px;
  border-radius: 8px;
  border: 3px solid white;
}
</style>

---
dragPos:
  link-box: 300,200,200,100
---

# Page 16 - v-drag Link Detection Test

<a href="https://example.com" data-testid="link-wrapper">
  <div v-drag="'link-box'" class="cy-link-box bg-purple-500" data-testid="link-box">
    Linked Element
  </div>
</a>

<style>
.cy-link-box {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  border-radius: 8px;
}
</style>

---
dragPos:
  click-outside-box: 400,300,150,100
---

# Page 17 - v-drag Click Outside Test

Click the box to select, then click elsewhere to deselect

<div v-drag="'click-outside-box'" class="cy-outside-box bg-orange-500" data-testid="click-outside-box">
  Click Me
</div>

<style>
.cy-outside-box {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  border-radius: 8px;
}
</style>

---
dragPos:
  snap-target: 480,270,120,80
  snap-mover: 100,100,100,80
---

# Page 18 - v-drag Snap Alignment Tests

<div v-drag="'snap-target'" class="cy-snap-box bg-teal-500" data-testid="snap-target">Target</div>
<div v-drag="'snap-mover'" class="cy-snap-box bg-pink-500" data-testid="snap-mover">Mover</div>

<style>
.cy-snap-box {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  border-radius: 8px;
}
</style>

---

# Page 19

<div class="cy-animation-presets">
  <div v-click.fade.up>fade-up</div>
  <div v-click.scale>scale</div>
  <div v-click.none>none</div>
</div>

---
clickAnimation: fade down
---

# Page 20

<div class="cy-animation-frontmatter">
  <div v-click>from-frontmatter</div>
</div>

---
clickAnimation: foo
---

# Page 21

<div class="cy-animation-hierarchy">
  <div v-click>frontmatter-invalid-foo</div>
  <div v-click.fade.right>modifier-overrides-frontmatter</div>
  <div v-click.none>modifier-none-overrides-frontmatter</div>
  <div v-click.scale>modifier-scale-overrides-frontmatter</div>
</div>

---

# Page 17

<div class="cy-code-in-vclick">
<v-click>

```ts {*}
const answer = 42
```

</v-click>
</div>

---
layout: iframe
url: about:blank
---

---

# Page 24

<!-- `v-drag.flow` images in a two-column grid, like a theme's `two-cols` (`.col { position: relative }`),
letterboxed by `object-fit: contain`. Page 24 is last so earlier specs' page numbers don't move. -->
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 300px">
  <div style="position: relative; display: flex; flex-direction: column; padding-left: 20px; border-left: 1px solid #ccc">
    <img v-drag.flow="'flow-a'" data-testid="flow-a" src="/wide.svg" style="width: 100%; height: 200px; object-fit: contain">
    <div data-testid="flow-caption">caption</div>
  </div>
  <div style="position: relative">
    <img v-drag.flow="'flow-b'" data-testid="flow-b" src="/wide.svg" style="width: 100%; height: 200px; object-fit: contain">
  </div>
</div>

---

# Page 25

Some **bold** text to edit.

- first item
- second item
  - nested item

| Key | Value |
|---|---|
| a | one |

---
layout: two-cols
---

# Page 26

Left column

::right::

Right column

---

# Page 27

<div class="grid gap-4" style="grid-template-columns: 1fr 1fr">
<div>Left cell</div>
<div>Right cell</div>
</div>

---

# Page 28

<div class="grid gap-4" style="grid-template-columns: 1fr 1fr" data-testid="clamp-grid">
<div data-testid="clamp-left">Text in the left column, which an image enlarged in the right column must not squeeze.</div>
<div><img v-drag.flow="'colimg'" src="/wide.svg" style="width: 160px" data-testid="clamp-img"></div>
</div>

---

# Page 29

- alpha
- beta
  - beta one
- gamma

1. one
2. two
3. three

- [ ] todo
- [x] done

---
wysiwyg: true
---

# Page 30

Intro with Q&A and ~1 day.

- one
- two

<div class="cy-note">An HTML block</div>

After the HTML.

---

# Page 31

<div class="grid gap-4" style="grid-template-columns: 1fr 1fr">
<div>Left cell</div>
<div>Right cell</div>
</div>

---
dragPos:
  cp-box: 100,100,100,100
---

# Page 32

<div v-drag="'cp-box'" class="bg-red-500" data-testid="cp-box">copy me</div>

---

# Page 33

Paste target.

---

# Page 34

<!-- A collage of class-sized absolute images (`object-fit` from a slide `<style>`): selecting one
must not change what's visible. -->
<div class="fit-collage">
<img v-drag.flow="'fit-cover'" data-testid="fit-cover" class="fit-cover" src="/quadrants.svg">
<img v-drag.flow="'fit-contain'" data-testid="fit-contain" class="fit-contain" src="/quadrants.svg">
<img v-drag.flow="'fit-fill'" data-testid="fit-fill" class="fit-fill" src="/quadrants.svg">
</div>

<style>
.fit-collage { position: absolute; left: 60px; top: 110px; width: 800px; height: 380px; }
.fit-collage img { position: absolute; object-fit: cover; margin: 0; }
.fit-cover { left: 0; top: 50%; width: 43%; height: 50%; object-position: 0 25%; }
.fit-contain { left: 60%; top: 0; width: 23%; height: 55%; object-fit: contain !important; background: #2a2725; }
.fit-collage img.fit-fill { left: 62%; top: 65%; width: 160px; height: 90px; object-fit: fill; }
</style>
