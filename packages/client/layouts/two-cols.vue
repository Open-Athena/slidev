<!--
  Usage:

```md
---
layout: two-cols
---

# Left

This shows on the left

::right::

# Right

This shows on the right
```

The split defaults to equal columns; `cols: 40/60` in the frontmatter changes it (edit mode:
drag the boundary between the columns).

-->

<script setup lang="ts">
const props = defineProps({
  class: {
    type: String,
  },
  layoutClass: {
    type: String,
  },
})
</script>

<template>
  <div
    class="slidev-layout two-columns w-full h-full grid"
    :class="props.layoutClass"
    style="grid-template-columns: var(--slidev-cols, repeat(2, minmax(0, 1fr)))"
    data-slidev-cols
  >
    <div class="col-left" :class="props.class">
      <slot />
      <slot name="left" />
    </div>
    <div class="col-right" :class="props.class">
      <slot name="right" />
    </div>
  </div>
</template>
