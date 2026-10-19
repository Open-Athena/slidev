// Module state that survives Vite re-instantiating its module. A slide edit HMR-updates that
// slide's frontmatter module, and Vite stamps every module that imports it, transitively (through
// `#slidev/slides` → `useNav`), with a new `?t=`. The re-fetched slide then imports its builtin
// components (`<Youtube>`, `<Tweet>`, `<VDrag>`) at those new URLs, and so gets fresh copies of
// `useDragElements` / `useDragHistory` with empty state, beside the copies the rest of the app
// still uses. Keeping the state in `import.meta.hot.data` (one object per module path, across its
// versions) makes the copies share it. In a build there's no HMR and no copies.

export function hmrShared<T>(hot: { data: Record<string, any> } | undefined, key: string, init: () => T): T {
  if (!hot)
    return init()
  return (hot.data[key] ??= init()) as T
}
