# fizzle

A livecoding environment for visual art with a 3D pipeline: geometry →
transform → noise displacement → instancing → lit render, plus shader-pass
texture ops over the result — all on a fullscreen canvas behind a live code
editor.

```js
sphere({ radius: 1.2, res: 96 })
  .pos(0, t => Math.sin(t), 0)          // any number can be a fn of time
  .noise({ amp: 0.4, freq: 2, octaves: 4, speed: 0.5 })
  .instance(60, (x, i) => x.pos(Math.cos(i), 0, Math.sin(i)))
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.5 })
  .out()

scene().kaleido(6).bloom({ threshold: 0.6 }).out()
```

Chains read left to right; nothing appears until `.out()`. Re-running a sketch
replaces the previous one — the code on screen is always what you see. Every
numeric parameter also takes `t => ...` — or an audio/tempo signal — so
animation uses the same syntax as static values.

## Install

Needs Node 18+ and a WebGL2 browser (Chrome/Edge for the optional local-font
and audio-output-device features).

```sh
npm install
npm run dev   # then open http://localhost:5173
```

Run it from the dev server rather than a static build: the dev server is what
saves your sketches to `sketches/user/` as plain `.js` files (so the folder
commits to git like any other source) and what proxies Google Fonts. Without
it, sketches fall back to localStorage and `font:` lookups are limited.

## Docs

**Interactive docs live at [/docs.html](http://localhost:5173/docs.html)** —
the "docs & reference ↗" link in the sidebar. Every example there is a live
editor running on a real engine in a preview panel, alongside a searchable
reference for the whole API. That's the place to learn what the operators do;
this README stays a starting point.

In the editor itself, autocomplete knows the entire API and carries signatures
and doc lines, and `ctrl + hover` on any name pops the same docs.

## Keys

`ctrl + enter` run · `ctrl + .` pause/play · `ctrl + h` hide/show editor ·
`ctrl + p` sidebar · `ctrl + hover` docs for a command · drag to orbit, scroll
to zoom.

## Project layout

- [src/engine.js](src/engine.js) — renderer, scene/patch lifecycle, frame loop, sketch eval
- [src/api.js](src/api.js) — the chainable operator API
- [src/textures.js](src/textures.js) — texture shader passes, graph evaluation, feedback
- [src/noise.js](src/noise.js) — GLSL simplex fbm + shader injection
- [src/editor.js](src/editor.js) — CodeMirror overlay, keybindings, completions
- [src/docs.js](src/docs.js) — API docs table → autocomplete + ctrl+hover tooltips
- [src/docs-page.js](src/docs-page.js) + [src/docs-content.md](src/docs-content.md) — the interactive docs page ([docs.html](docs.html))
- [src/sidebar.js](src/sidebar.js) — settings + sketch palette
- [vite.config.js](vite.config.js) — dev-server API for `sketches/user/`
- [api/gfont/[family].js](api/gfont/[family].js) — the same Google Fonts proxy as a serverless function, for the hosted build
- [sketches/examples/](sketches/examples/) — bundled example sketches

## License

fizzle is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0-only) — see [LICENSE](LICENSE).

In plain terms: you can use it, study it, share it, and modify it freely. Make
whatever visuals you like with it and sell them — your work is yours, the
license doesn't touch it. The one condition is on the *code*: if you distribute
a modified version, or run one as a network service, you have to make your
source available under the same license. That's deliberate — it keeps fizzle
open for artists and hobbyists while stopping anyone from quietly rolling it
into a closed, proprietary product.
