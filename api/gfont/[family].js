// Google Fonts proxy for the hosted build: GET /api/gfont/:family?weight=700
// -> raw .ttf bytes. Same job as the gfontApi() middleware in vite.config.js,
// which serves this route under `npm run dev`.
//
// Needed because Google's css2 endpoint only serves .ttf URLs to non-browser
// user agents — real browsers get woff2, which opentype.js can't decompress.
//
// The dev middleware memoizes in a Map; a function instance is stateless and
// short-lived, so the CDN caches instead via Cache-Control.

export default async function handler(req, res) {
  try {
    const family = String(req.query.family ?? '');
    const w = String(req.query.weight ?? '');
    const weight = /^[1-9]00$/.test(w) ? w : '400';
    if (!/^[\w .+-]{1,60}$/.test(family)) return res.status(400).send('bad family name');

    const css = async (fam) => {
      const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam)}`, {
        headers: { 'User-Agent': 'curl/8' },
      });
      return r.ok ? r.text() : null;
    };
    // exact weight first; fonts missing that weight 400 out, so retry plain
    const text = (await css(`${family}:wght@${weight}`)) ?? (await css(family));
    const ttf = text?.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!ttf) return res.status(404).send(`no font "${family}" on Google Fonts`);

    const font = await fetch(ttf);
    if (!font.ok) return res.status(502).send(`Google Fonts returned ${font.status} for "${family}"`);

    res.setHeader('Content-Type', 'font/ttf');
    // the URL fully determines the bytes, so this is safe to pin
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(await font.arrayBuffer()));
  } catch (e) {
    res.status(500).send(String(e));
  }
}
