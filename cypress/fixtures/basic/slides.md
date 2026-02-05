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
