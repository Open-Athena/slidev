<!-- Open-Athena/slidev fork preamble — the original sli.dev README begins after the horizontal rule. -->

<p align="center">
  <a href="https://slidev.oa.dev" target="_blank">
    <img src="https://slidev.oa.dev/_og/1-open-athena-slidev.jpg" alt="Open-Athena/slidev — direct manipulation demo" width="720">
  </a>
</p>

<h3 align="center">
  <a href="https://slidev.oa.dev"><code>Open-Athena/slidev</code></a> — a fork of <a href="https://sli.dev">sli.dev</a>
</h3>

<p align="center">
  Adds <b>direct manipulation</b> for slide content: click any image to <b>drag</b>, <b>resize</b>, <b>rotate</b>, or <b>reorder</b>; double-click to <b>crop</b>.<br>
  <a href="https://slidev.oa.dev"><b>Live demo →</b></a> · <a href="https://slidev.oa.dev/_og/">slide gallery</a>
</p>

### What this fork adds

- 🖱️ **Drag / resize / rotate** any markdown image or embed; positions persist to `slides.coords.yaml`
- ✂️ **Crop** — double-click an image to enter crop mode
- 📐 **Snap-to-guides** during drag/resize against other slide elements (hold ⌘ to disable); ⇧ locks AR
- 📚 **Z-order shortcuts**: ⌘↑/⌘↓ forward/back · ⇧⌘↑/⇧⌘↓ to-front/back
- ↩️ **Undo / redo** (⌘Z / ⇧⌘Z), with a right-side **version-history drawer** that can restore any prior state
- 🌐 **Multi-tab live edits** — changes in one browser tab propagate to others via SSE
- 🖼️ **Draggable embeds**: `<Tweet>`, `<Youtube>`, `<BlueSky>` — see [slide 2](https://slidev.oa.dev/2)
- 🔍 **Pinch-zoom & pan** in slide view (trackpad / touch)
- 📤 **Per-slide OG cards** built into `slidev build` + a [thumbnail gallery](https://slidev.oa.dev/_og/)

<p align="center">
  <a href="https://slidev.oa.dev/2" target="_blank">
    <img src="https://slidev.oa.dev/_og/2-embeds.jpg" alt="Draggable Tweet, YouTube, and Bluesky embeds" width="640">
  </a>
</p>

State persists to **`<userRoot>/.slidev/state.db`** (SQLite, dev-server only — powers undo/redo, history, multi-tab sync) and **`<userRoot>/slides.coords.yaml`** (checked-in source of truth; flushed via the toolbar "Commit to YAML" button — orange dot when the DB is ahead). Production builds ship neither — published decks are read-only static HTML/JS.

### Installing this fork

Not published to npm — installs go through [`pkg.pr.new`], which auto-publishes a SHA-pinned preview of every fork package on each push to `main` (via the [`cr.yml`] workflow). Works with `npm` / `pnpm` / `yarn`, no `pnpm.overrides`, no manual version bumps:

```bash
# Pin to a specific commit SHA — see CR run summaries for the latest:
# https://github.com/Open-Athena/slidev/actions/workflows/cr.yml
SHA=<sha>
npm install https://pkg.pr.new/Open-Athena/slidev/@slidev/{cli,client,parser}@$SHA
```

(Brace expansion is bash / zsh; drop the braces and run the three URLs separately in fish / dash.)

All three packages are required: `@slidev/cli` (the build/dev CLI) depends on `@slidev/client` + `@slidev/parser` at exact upstream versions, so installing just the cli would silently pull the other two from upstream npm and lose the fork features. The fork pkgs keep their `@slidev/*` names, so `node_modules/@slidev/{cli,client,parser}` end up wired together correctly and themes (incl. [`oa-slidev-theme`]) keep working without changes.

`@slidev/types` is unchanged in this fork — pull it straight from upstream npm if needed.

[`pkg.pr.new`]: https://pkg.pr.new
[`cr.yml`]: https://github.com/Open-Athena/slidev/actions/workflows/cr.yml
[`oa-slidev-theme`]: https://github.com/Open-Athena/oa-slidev-theme

---

<!-- ⬇ Original sli.dev README continues from here. -->

<br>
<p align="center">
<a href="https://sli.dev" target="_blank">
<img src="https://sli.dev/logo-title.png" alt="Slidev" height="250" width="250"/>
</a>
</p>

<p align="center">
Presentation <b>slide</b>s for <b>dev</b>elopers 🧑‍💻👩‍💻👨‍💻
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@slidev/cli" target="__blank"><img src="https://img.shields.io/npm/v/@slidev/cli?color=2B90B6&label=" alt="NPM version"></a>
<a href="https://www.npmjs.com/package/@slidev/cli" target="__blank"><img alt="NPM Downloads" src="https://img.shields.io/npm/dm/@slidev/cli?color=349dbe&label="></a>
<a href="https://sli.dev/" target="__blank"><img src="https://img.shields.io/static/v1?label=&message=docs%20%26%20demos&color=45b8cd" alt="Docs & Demos"></a>
<a href="https://sli.dev/resources/theme-gallery" target="__blank"><img src="https://img.shields.io/static/v1?label=&message=themes&color=4ec5d4" alt="Themes"></a>
<br>
<a href="https://github.com/slidevjs/slidev/stargazers" target="__blank"><img alt="GitHub stars" src="https://img.shields.io/github/stars/slidevjs/slidev?style=social"></a>
</p>

<p align="center">
  <a href="https://twitter.com/antfu7/status/1389604687502995457">Video Preview</a> | <a href="https://sli.dev">Documentation</a>
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<img width="2000" height="0" alt="" aria-hidden><br>
<sub>Made possible by my <a href="https://github.com/sponsors/antfu">Sponsor Program 💖</a></sub><br>
<img width="2000" height="0" alt="" aria-hidden>
</td>
</tbody>
</table>
</div>

## Features

- 📝 [**Markdown-based**](https://sli.dev/guide/syntax) - focus on content and use your favorite editor
- 🧑‍💻 [**Developer Friendly**](https://sli.dev/guide/syntax#code-blocks) - built-in code highlighting, live coding, etc.
- 🎨 [**Themable**](https://sli.dev/resources/theme-gallery) - theme can be shared and used with npm packages
- 🌈 [**Stylish**](https://sli.dev/guide/syntax#embedded-styles) - on-demand utilities via [UnoCSS](https://github.com/unocss/unocss).
- 🤹 [**Interactive**](https://sli.dev/custom/directory-structure#components) - embedding Vue components seamlessly
- 🎙 [**Presenter Mode**](https://sli.dev/guide/ui#presenter-mode) - use another window, or even your phone to control your slides
- 🎨 [**Drawing**](https://sli.dev/features/drawing) - draw and annotate on your slides
- 🧮 [**LaTeX**](https://sli.dev/features/latex) - built-in LaTeX math equations support
- 📰 [**Diagrams**](https://sli.dev/guide/syntax#diagrams) - creates diagrams using textual descriptions with [Mermaid](https://mermaid.js.org/)
- 🌟 [**Icons**](https://sli.dev/features/icons) - access to icons from any icon set directly
- 💻 [**Editor**](https://sli.dev/guide/index#editor) - integrated editor, or the [VSCode extension](https://sli.dev/features/vscode-extension)
- 🎥 [**Recording**](https://sli.dev/features/recording) - built-in recording and camera view
- 📤 [**Portable**](https://sli.dev/guide/exporting) - export into PDF, PNGs, or PPTX
- ⚡️ [**Fast**](https://vitejs.dev) - instant reloading powered by [Vite](https://vitejs.dev)
- 🛠 [**Hackable**](https://sli.dev/custom/) - using Vite plugins, Vue components, or any npm packages

## Getting Started

### Try it Online ⚡️

[sli.dev/new](https://sli.dev/new)

[![](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://sli.dev/new)

### Init Project Locally

Install [Node.js >= 20.12.0](https://nodejs.org/) and run the following command:

```bash
npm init slidev
```

Documentation:
**[English](https://sli.dev)** | [中文文档](https://cn.sli.dev) | [Français](https://fr.sli.dev) | [Español](https://es.sli.dev) | [Русский](https://ru.sli.dev) | [Português-BR](https://br.sli.dev)

Discord: [chat.sli.dev](https://chat.sli.dev)

For a full example, you can check the [demo](https://github.com/slidevjs/slidev/blob/main/demo) folder, which is also the source file for [my previous talk](https://antfu.me/posts/composable-vue-vueday-2021).

## Tech Stack

- [Vite](https://vitejs.dev) - An extremely fast frontend tooling
- [Vue 3](https://v3.vuejs.org/) powered [Markdown](https://daringfireball.net/projects/markdown/syntax) - Focus on the content while having the power of HTML and Vue components whenever needed
- [UnoCSS](https://github.com/unocss/unocss) - On-demand utility-first CSS engine, style your slides at ease
- [Shiki](https://github.com/shikijs/shiki), [Monaco Editor](https://github.com/Microsoft/monaco-editor) - First-class code snippets support with live coding capability
- [RecordRTC](https://recordrtc.org) - Built-in recording and camera view
- [VueUse](https://vueuse.org) family - [`@vueuse/core`](https://github.com/vueuse/vueuse), [`@vueuse/motion`](https://github.com/vueuse/motion), etc.
- [Iconify](https://iconify.design/) - Icon sets collection.
- [Drauu](https://github.com/antfu/drauu) - Drawing and annotations support
- [KaTeX](https://katex.org/) - LaTeX math rendering.
- [Mermaid](https://mermaid-js.github.io/mermaid) - Textual Diagrams.

## Sponsors

This project is made possible by all the sponsors supporting my work:

<p align="center">
  <a href="https://github.com/sponsors/antfu">
    <img src='https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg' alt="Logos from Sponsors" />
  </a>
</p>

## License

MIT License © 2021 [Anthony Fu](https://github.com/antfu)
