// The docs page as markup: prose from docs-content.md plus the reference
// generated from docs.js. No DOM, so the build can run it in node and ship the
// page already rendered (search engines read it without running anything);
// docs-page.js then swaps each `pre.ex-src` for a live editor.

import { configSections, infoHtml, GLOBALS, METHODS, GLOBAL_CONFIG, METHOD_CONFIG } from './docs.js';

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');

export function inline(s) {
  // protect code spans so bold/link markup inside them stays literal
  const spans = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\x00${spans.push(c) - 1}\x00`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${spans[i]}</code>`);
}

const FENCE = /^\s*```/;

// The first heading is the page's title, so it's the h1.
function markdown(md) {
  const lines = md.split('\n');
  const out = [];
  let titled = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // a fence written under a list item is indented; it's still a code block,
    // and the block's own indentation is what's left after that one is taken off
    const fence = line.match(/^(\s*)```(\S*)\s*(.*)$/);
    if (fence) {
      const [, indent, lang, flags] = fence;
      const codeLines = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) codeLines.push(lines[i++]);
      i++; // closing fence
      const code = esc(codeLines.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n'));
      // ```js — a live editor; ```js static — a snippet that can't run here
      // (it names files only you have), so it renders as plain code
      if (lang === 'js' && !flags.includes('static')) {
        out.push(`<pre class="ex-src"${flags.includes('autorun') ? ' data-autorun' : ''}>${code}</pre>`);
      } else {
        out.push(`<pre class="static">${code}</pre>`);
      }
      continue;
    }

    const h = line.match(/^(#{2,3}) (.+)$/);
    if (h) {
      const tag = h[1].length === 3 ? 'h3' : titled ? 'h2' : 'h1';
      titled = true;
      out.push(`<${tag} id="${slug(h[2])}">${inline(h[2])}</${tag}>`);
      i++;
      continue;
    }

    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      let t = '<table>';
      rows.forEach((r, ri) => {
        if (ri === 1 && /^[\s|:-]+$/.test(r)) return; // header separator
        const tag = ri === 0 ? 'th' : 'td';
        t += `<tr>${cells(r).map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
      });
      out.push(t + '</table>');
      continue;
    }

    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && !FENCE.test(lines[i])
             && (/^- /.test(lines[i]) || /^ {2,}\S/.test(lines[i]))) {
        if (/^- /.test(lines[i])) items.push(inline(lines[i].slice(2)));
        else if (items.length) items[items.length - 1] += ' ' + inline(lines[i].trim());
        i++;
      }
      out.push(`<ul>${items.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      continue;
    }

    // paragraph: gather until a blank line or a new block form
    const para = [];
    while (i < lines.length && lines[i].trim()
           && !FENCE.test(lines[i]) && !/^(#{2,3} |\| |- )/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// --- reference (generated from docs.js so it can't drift) ------------------

function reference() {
  let out = '<h2 id="reference">reference</h2>';
  out += `<p>${inline(
    'The full API, straight from the table that powers autocomplete. ' +
    'The same text pops up in the app on `ctrl + hover`.'
  )}</p>`;
  out += '<input id="ref-search" type="search" placeholder="filter… (name, signature, or description)">';

  const groups = [
    ['globals', GLOBALS, GLOBAL_CONFIG],
    ['chain methods', METHODS, METHOD_CONFIG],
  ];
  for (const [title, table, config] of groups) {
    out += `<h3 id="${slug(`ref ${title}`)}">${title}</h3><table class="ref">`;
    for (const [name, [sig, info]] of Object.entries(table)) {
      out += `<tr data-name="${attr(name)}"><td><code class="ref-sig">${esc(sig)}</code></td><td>${infoHtml(info)}`;
      // the keys the signature is too short to list, so the page and the
      // completion popup describe the same call
      const sections = configSections(config[name]);
      if (sections) {
        out += '<div class="ref-keys">';
        for (const [section, list] of sections) out += `<span>${esc(section)}</span><code>${esc(list.join(' '))}</code>`;
        out += '</div>';
      }
      out += '</td></tr>';
    }
    out += '</table>';
  }
  return out;
}

// body goes after the byline in #content; toc fills #toc-links
export function renderDocs(md) {
  const body = markdown(md) + '\n' + reference();
  const toc = [...body.matchAll(/<h[12] id="([^"]+)">(.*?)<\/h[12]>/g)]
    .map(([, id, text]) => `<a href="#${id}">${text.replace(/<[^>]+>/g, '')}</a>`)
    .join('');
  return { body, toc };
}
