# Deployment plan

Not done yet — this is a plan for hosting fizzle publicly, Hydra-style: the site
serves the code, every sketch runs in the visitor's browser.

## Why this is mostly already true

`npm run build` produces a fully static `dist/`. The engine, editor, and TOP
pipeline are client-side, examples are inlined at build time (`import.meta.glob`
eager, [src/sidebar.js:8](src/sidebar.js#L8)), and share links are already
Hydra-shaped — deflate-compressed source in the URL hash,
[src/share.js](src/share.js).

Build weight, for reference:

| | size |
|---|---|
| vendor chunk (three + CodeMirror) | 1.7 MB, ~450 KB gzipped |
| `public/media/` (HDR + ship.obj) | 2.1 MB |
| everything else | ~200 KB |

## What breaks without the dev server

Both dev-only endpoints live in [vite.config.js](vite.config.js).

**`/api/sketches` — nothing to do.** [src/sidebar.js:24-59](src/sidebar.js#L24-L59)
already catches the failed fetch and falls back to localStorage, and the UI
labels which one is live ([src/sidebar.js:199](src/sidebar.js#L199)). Hosted
visitors get browser-local sketches instead of git-versioned files, which is
what you want on a public site anyway.

**`/api/gfont/:family` — needs a serverless function.** Google's css2 endpoint
only hands `.ttf` URLs to non-browser user agents; real browsers get woff2,
which opentype.js can't decompress. So the fetch has to happen off-browser.
Without it, `font('google:Inter')` hard-fails.

Poly Haven needs no work — `api.polyhaven.com` serves
`Access-Control-Allow-Origin: *`, so material downloads already work from the
browser ([src/polyhaven.js:10](src/polyhaven.js#L10)).

## Host: Vercel

The gfont proxy is the only thing forcing the choice. Vercel, Cloudflare Pages,
and Netlify are all fine and near-identical in shape; Vercel is the least
ceremony. Cloudflare equivalent is `functions/api/gfont/[family].js`.

If Google Fonts gets dropped from the hosted build instead, GitHub Pages works
with zero config and no function at all — `import.meta.env.BASE_URL` is already
used correctly in [src/media.js:61](src/media.js#L61), so a `/fizzle/` subpath
deploy works as-is.

## Steps

**1. `api/gfont/[family].js`** — port of the `gfontApi()` middleware at
[vite.config.js:83-118](vite.config.js#L83-L118). Same logic; the in-process
`Map` goes away (functions are stateless) and the CDN caches instead via
`Cache-Control`, which is the better cache anyway.

```js
export default async function handler(req, res) {
  const { family = '', weight: w = '' } = req.query;
  const weight = /^[1-9]00$/.test(w) ? w : '400';
  if (!/^[\w .+-]{1,60}$/.test(family)) return res.status(400).send('bad family name');

  const css = async (fam) => {
    const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam)}`, {
      headers: { 'User-Agent': 'curl/8' },
    });
    return r.ok ? r.text() : null;
  };
  // exact weight first; fonts missing that weight 404, so retry plain
  const text = (await css(`${family}:wght@${weight}`)) ?? (await css(family));
  const ttf = text?.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
  if (!ttf) return res.status(404).send(`no font "${family}" on Google Fonts`);

  res.setHeader('Content-Type', 'font/ttf');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(await (await fetch(ttf)).arrayBuffer()));
}
```

**2. `vercel.json`** — `cleanUrls: true` so `/docs` serves `docs.html` (the
build has two entries, see [vite.config.js:126-129](vite.config.js#L126-L129)).
Optionally immutable cache headers on `/assets/*`, which are content-hashed.

**3. Fix two dev-server-only error messages.** Both become false once hosted:

- [src/api.js:58-60](src/api.js#L58-L60) — "the Google Fonts proxy needs the dev
  server"; should report the upstream failure instead.
- `src/docs-content.md:64` — needs a sentence covering the hosted build, not
  just dev vs. static.

Total: roughly 60 lines.

## Optional, not blocking

- **Export sketches.** localStorage is a fragile home for someone's collection
  on a public site. An export-all-to-`.zip` button is cheap insurance, though
  share links cover most of the need.
- **Fix chunk splitting.** The 1.7 MB vendor chunk is named `polyhaven-*` —
  Rollup attributed shared vendor code to the wrong entry, so the docs page
  likely pulls all of three.js for nothing. A `manualChunks` tweak fixes it.
