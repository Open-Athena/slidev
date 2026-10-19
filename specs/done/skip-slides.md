# Skippable slides: kept in the deck, hidden on demand

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), 2026-10-19. Ryan: "let's have an easy way to mark slides 'skipped' or hidden, for presentation mode. actually maybe for regular browsing too? I'm leery of awkwardness switching b/w full-screen presentation mode and chrome windows and other apps, while screen-sharing on zoom. so even in non-preso mode there should be a toggle about whether to show/hide 'hidden' slides."

Today `hide: true` / `disabled: true` remove a slide from the build entirely, which renumbers everything after it and can't be flipped live. What's wanted is a per-slide "skip" that stays in the deck and is honored or ignored with one toggle, in any mode.

## Ask

- **Mark:**
  - **frontmatter:** `skip: true` (name open; avoid overloading `hide`);
  - **Edit mode:** a "Skip slide" toggle (toolbar, overview context menu, and the ⇧T drawer). It writes the frontmatter with the minimal-write path (`cba52529`).
  - **Undoable:** like other edits.
- **Toggle "skip skipped slides":** one boolean, default on.
  - **Shown in:** the nav bar, the ⇧T drawer header, and presenter view.
  - **Hotkey:** suggest `⇧S`; it must not clash with existing shortcuts.
  - **Persisted:** `localStorage`, and synced presenter ↔ audience the way other nav state syncs.
  - **Works the same in play mode, presenter mode and plain browsing** (the screen-share case: a non-fullscreen Chrome window).
- **When on:**
  - next/prev (keys, clicks, swipe, presenter buttons) step over skipped slides;
  - the presenter's "next slide" preview shows the next non-skipped one;
  - `g` / goto and direct URLs still reach a skipped slide, so nothing is lost;
  - while viewing one, a small "skipped" badge shows in the nav bar.
- **Numbering stays stable.** Slide numbers, URLs (`/<n>-<slug>`), QR codes and OG cards don't change. The counter can read `14 / 50 · 3 skipped`.
- **Overview and drawer:** skipped slides show dimmed with a skip glyph, and their mark can be toggled there.
- **Export / PDF:** an option (default: exclude skipped).
- **Client API:** expose the toggle state (e.g. `skipSkipped` in `@slidev/client/state`) so a deck can register it in its own command palette. The disky deck's ⌘K already wraps the toolbar actions (`lib/slidevActions.ts`).

## Tests

On a fixture deck with slides 2 and 4 skipped:
- with the toggle on, → from 1 lands on 3, then 5; with it off, 1 → 2;
- `/4` loads slide 4 with the badge;
- toggling skip in Edit mode writes exactly one frontmatter line, and ⌘Z restores it byte for byte;
- the presenter's next preview skips;
- the counter reads `· 2 skipped`.

## As built

- **Mark:** frontmatter `skip: true` (`SlideInfo` type, vscode schema, `docs/features/skip-slides.md`, frontmatter list in `docs/custom/index.md`).
- **Toggle:** `skipSkipped` in `state/storage.ts` (LS `slidev-skip-skipped`, default on), synced through the shared nav state (`SharedState.skipSkipped`, sent / received in `setup/root.ts` under the same sync directions as `page`). `⇧S` (`toggle_skip_skipped`, no clash), a notice says what changed. Buttons in the nav bar (shown when the deck has skipped slides; presenter view uses the same bar) and the ⇧T drawer header; right-click menu items.
- **Stepping:** `neighborSlideNo` (`logic/skip.ts`) drives `nextRoute` / `prevRoute` / `hasNext` / `hasPrev` / `nextSlide` / `prevSlide` in `useNav`, so keys, clicks, swipes, the presenter's buttons and its next preview all skip. Print / export mode doesn't. `g`, URLs, overview and drawer still reach a skipped slide; from one, next goes to the next kept slide.
- **Display:** nav-bar counter `14 / 50 · 3 skipped`, a `skipped` badge on a skipped slide; overview cards dimmed with a skip glyph; drawer rows dimmed with a glyph, `aria-label` gains ", skipped".
- **Marking (dev, edit mode):** nav-bar button for the current slide, per-slide buttons in the overview and drawer (hover), right-click menu. `toggleSlideSkip` (`composables/useSlideSkip.ts`) POSTs `frontmatter: { skip: true | null }` and records a `skip` history event (frontmatter change), so ⌘Z / ⌘⇧Z work.
  - Server fix: a frontmatter-only POST didn't hot-update the slide's frontmatter (the POST patched `slide.frontmatter` before the hot update compared it), so the client never saw `skip`. The handler now flags the slide when the patch changes it (also affects other frontmatter-only edits, e.g. column `cols`).
- **Export:** `slidev export` leaves skipped slides out (`rangeWithoutSkipped`; an explicit `--range` is filtered too, all-skipped is an error); `--with-skipped` / `export.withSkipped` includes them. The browser exporter (`/export`) is unchanged.
- **Client API:** `skipSkipped` from `@slidev/client/state`, `toggleSkipSkipped` / `toggleSlideSkip` / `skippedCount` from `@slidev/client/composables/useSlideSkip`.
- **Tests:** `test/skip.test.ts` (stepping, export ranges), `test/frontmatter-write.test.ts` (add / remove a key round-trips byte for byte, with and without existing frontmatter); `cypress/e2e/examples/skip-slides.spec.ts` on fixture slides 36-40 (37, 39 skipped; 38 marked + ⌘Z): stepping, ⇧S, direct URL + badge, presenter next preview, counter, one-line write + byte-exact undo.
