# Deployment plan

Hosting fizzle publicly: the site serves the code, every sketch runs in the
visitor's browser. The code side is done — what's left is pressing the button
on an account.

## Why this is mostly already true

`npm run build` produces a fully static `dist/`. The engine, editor, and texture
pipeline are client-side, examples are inlined at build time (`import.meta.glob`
eager, [src/sidebar.js:8](../src/sidebar.js#L8)), and share links are
self-contained — deflate-compressed source in the URL hash,
[src/share.js](../src/share.js).

Build weight, for reference:

| | eager | gzipped |
|---|---|---|
| `three-*` (core) | 725 KB | 185 KB |
| `codemirror-*` | 500 KB | 167 KB |
| `polyhaven-*` (shared app source + three addons) | 518 KB | 167 KB |
| per-page entry | ~58 KB | ~21 KB |

Plus `public/media/` (HDR + ship.obj) at 2.1 MB, fetched only by the sketches
that use them, and the `.exr`/`.fbx`/`.obj` loaders, which stay dynamic.

## What breaks without the dev server

Both dev-only endpoints live in [vite.config.js](../vite.config.js).

**`/api/sketches` — nothing to do.** [src/sidebar.js:24-59](../src/sidebar.js#L24-L59)
already catches the failed fetch and falls back to localStorage, and the UI
labels which one is live ([src/sidebar.js:199](../src/sidebar.js#L199)). Hosted
visitors get browser-local sketches instead of git-versioned files, which is
what you want on a public site anyway.

**`/api/gfont/:family` — needs a serverless function.** Google's css2 endpoint
only hands `.ttf` URLs to non-browser user agents; real browsers get woff2,
which opentype.js can't decompress. So the fetch has to happen off-browser.
Without it, `font('google:Inter')` hard-fails.

Poly Haven needs no work — `api.polyhaven.com` serves
`Access-Control-Allow-Origin: *`, so material downloads already work from the
browser ([src/polyhaven.js:10](../src/polyhaven.js#L10)).

## Host: Vercel

The gfont proxy is the only thing forcing the choice. Vercel, Cloudflare Pages,
and Netlify are all fine and near-identical in shape; Vercel is the least
ceremony. Cloudflare equivalent is `functions/api/gfont/[family].js`.

If Google Fonts gets dropped from the hosted build instead, GitHub Pages works
with zero config and no function at all — `import.meta.env.BASE_URL` is already
used correctly in [src/media.js:61](../src/media.js#L61), so a `/fizzle/` subpath
deploy works as-is.

## Done

- **[api/gfont/[family].js](api/gfont/[family].js)** — port of the `gfontApi()`
  middleware at [vite.config.js:83-118](../vite.config.js#L83-L118). Same logic;
  the in-process `Map` is gone (functions are stateless) and the CDN caches
  instead via `Cache-Control: immutable`, which is the better cache anyway.
  Verified against the live Google endpoint: `Inter`/700 returns a 326 KB TTF,
  an unknown family 404s, a malformed one 400s.
- **[vercel.json](../vercel.json)** — `cleanUrls` so `/docs` serves `docs.html`
  (the build has two entries, [vite.config.js:126-129](../vite.config.js#L126-L129)),
  plus immutable cache headers on the content-hashed `/assets/*`.
- **Dev-server-only error messages**, both false once hosted:
  [src/api.js:56-63](../src/api.js#L56-L63) now names the missing proxy rather
  than the missing dev server, and `src/docs-content.md` covers all three cases
  (dev server / hosted / bare static build) for both sketch storage and fonts.
- **Chunk splitting.** `three` core and `codemirror` are their own chunks now
  ([vite.config.js:130-143](../vite.config.js#L130-L143)). Before, Rollup put both
  plus our shared app source into one 1.7 MB chunk named after whichever module
  pulled it in, so editing any shared module re-hashed all of three.js in every
  visitor's cache. Eager bytes are unchanged; only the cache granularity is.
  The addons under `three/examples/` are deliberately excluded so the `.exr`,
  `.fbx` and `.obj` loaders stay dynamically imported. (The residual
  `polyhaven-*` chunk is still misnamed — it's the shared app source, and it is
  genuinely shared, so the name is cosmetic.)

## Live

**[fizzle.glossing.dev](https://fizzle.glossing.dev)**, as its own Vercel
project importing `glossings/fizzle`. Not a route inside `glossing-website` —
that's an Astro site, this is Vite plus a serverless function, and a subdomain
keeps the two deploying independently. Vite preset auto-detected, nothing
configured; `api/` is picked up as a function by convention, no `functions`
block needed.

The zone is on Cloudflare, not Vercel's nameservers, so the subdomain `CNAME`
Vercel asks for has to be added by hand there — it will not appear on its own.
It must be **unproxied / DNS-only**; proxying breaks Vercel's domain
verification and TLS issuance. The per-project target Vercel hands you is not
the one `www` uses — that one points at glossing-website.

Leave the zone where it is. Moving it onto Vercel's nameservers would buy
automatic records for Vercel subdomains and little else, while coupling DNS to
the host — leaving Vercel later becomes a zone migration rather than a
two-record edit. If it ever does move, migrate the zone as its own change,
never alongside a deploy: two moving parts at once makes propagation problems
unattributable.

Post-deploy checks, for whenever the host changes again: `/docs` (not
`/docs.html`) loads and its previews render, and `/api/gfont/Inter?weight=700`
returns a TTF — then a sketch with `text3d('x', { font: 'google:Inter' })`,
where the font swaps in a frame or two after the mesh appears.

Still to do: add the URL to the GitHub repo's About field.

## Optional, not blocking

- **Export sketches.** localStorage is a fragile home for someone's collection
  on a public site. An export-all-to-`.zip` button is cheap insurance, though
  share links cover most of the need.
- **A hosted-only nudge.** The hosted sidebar could say "sketches live in this
  browser — copy a share link to keep one" next to the localStorage label,
  since that's the one real surprise for a visitor who doesn't read docs.
