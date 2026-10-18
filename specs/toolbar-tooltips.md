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
