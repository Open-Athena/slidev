# Toolbar tooltips: fast, styled, and showing each control's hotkey

From the disky deep-dive deck. The nav bar's buttons (`internals/NavControls.vue` → `internals/IconButton.vue`) label themselves with the native `title` attribute: "Show slide overview", "Go to next slide", and so on. Native tooltips take about a second to appear, can't be styled (OS chrome, tiny text, wrong theme), and don't say which key does the same thing. Ryan: "TTs like this should appear sooner and show hotkeys".

## Proposal

- `IconButton` renders a real tooltip instead of `title`. Keep `aria-label` (and the `.sr-only` text) for accessibility. Options:
  - floating-vue, which the client already depends on (`DrawingControls.vue` uses its `Dropdown`); or
  - a small `<Tooltip>` built on `@floating-ui/vue`.
  
  Behavior: about 150 ms open delay, instant when moving between toolbar buttons (a shared delay group), and it follows the deck's light/dark theme.
- Each tooltip shows the control's shortcut as `<kbd>` chips: "Show slide overview  `o` `` ` ``", "Next slide  `→` `space`", "Toggle dark  `d`", "Go to…  `g`". Take the keys from the same table that binds them (`setup/shortcuts.ts`), via each shortcut's `name`, so they can't drift. That means:
  - `IconButton` takes an optional `shortcut` (a shortcut name);
  - a `formatShortcut(name)` helper renders the key combination.
- Longer term, the toolbar actions and their hotkeys belong in one action registry. That's use-kbd's model (`~/c/js/use-kbd/specs/framework-agnostic-core.md`): `use-kbd/core` + `use-kbd/vue` would give Slidev
  - editable bindings,
  - a ⌘K omnibar over actions and slides (the deep-dive deck mounts use-kbd's React omnibar in an island today),
  - and these tooltips from the same source.
  
  Don't block on that. Write the tooltip and `formatShortcut` so they can later read from a registry.

## Tests

- **Rendering:** hovering a nav button shows the tooltip within 300 ms, with the label and the key chips from `shortcuts.ts`. Rebinding a shortcut in `shortcuts.ts` changes the chip.
- **Accessibility:** `aria-label` is present, and there's no native `title` (so the two tooltips don't stack).

## As built

- **Tooltip** (`internals/IconButton.vue`):
  - A small teleported tooltip rather than floating-vue: the client's floating-vue is installed for Twoslash with its own container, so a plain fixed-position element was simpler.
  - It opens after 150 ms, or at once within 400 ms of another tooltip closing (`logic/tooltip-group.ts`, module state shared by every button).
  - It's placed above the button (below near the top of the window) and clamped inside the window.
  - The label is followed by `<kbd>` chips.
  - The button has `aria-label` and the `.sr-only` text, and no `title`.
  - `inheritAttrs: false` with `v-bind="$attrs"`, since the component now has two root nodes.
- **Keys:**
  - `ShortcutOptions` gains an optional `display: string[]` (key combinations as shown, e.g. `['o', '`']`), set on every base shortcut in `setup/shortcuts.ts`. The `key` refs can't be read back into names.
  - `registerShortcuts` registers each named shortcut's `display`, including shortcuts from user setups that pass one, plus the hard-coded `f` / `h` / `y` / ⌘Z / ⇧⌘Z, in `logic/shortcut-display.ts`.
  - `IconButton`'s `shortcut` prop (a name, or several) renders them through `formatShortcut`.
- **Nav bar:**
  - fullscreen `f`;
  - previous `←` `⇧ space`; next `→` `space`;
  - overview `o` `` ` ``;
  - Edit `e`;
  - undo `⌘Z`, redo `⇧⌘Z`;
  - history `h`;
  - dark `d`.

  The `(e)` / `(h)` / `(⌘Z)` suffixes are gone from the labels.
- **Not done:** the use-kbd action registry and omnibar (the longer-term direction, still valid).
- **Tests:**
  - `test/shortcut-display.test.ts`: combination, dedup, and re-registering replaces.
  - `cypress/e2e/examples/toolbar-tooltips.spec.ts`:
    - hovering the overview button shows "Show slide overview" with `o` `` ` `` within 300 ms, and the button has no native `title`;
    - moving straight on to Next shows its tooltip within 140 ms. This failed while the delay group's state was per-instance: an `eslint --fix` had merged the plain `<script>` block into `<script setup>`. Hence the separate module.
