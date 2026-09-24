// A labeled block is a sketch inside the sketch:
//
//   kirb: {
//     bg('#200')
//     sphere().out()
//   }
//   sketch('kirb').edge().out()
//
// A label means nothing at run time, so the source is rewritten before it's
// evaluated: `kirb: {` becomes `__sketch("kirb", () => {` and the matching
// brace becomes `});`. Both edits stay on the lines they were on, so an error
// still points at the line the sketch has. It is valid JavaScript before the
// rewrite as well as after, which is the point: the editor's parser, and
// everything that reads its tree, sees ordinary statements in there.

import { javascriptLanguage } from '@codemirror/lang-javascript';

// every label on a block, outermost first: { name, from, open, close }
export function blockLabels(src) {
  const out = [];
  javascriptLanguage.parser.parse(src).iterate({
    enter(n) {
      if (n.name !== 'LabeledStatement') return;
      const label = n.node.firstChild;
      const block = n.node.lastChild;
      // only label + block: a label on a loop stays a label. And only a block
      // that closes, or the rewrite would wrap whatever the parser guessed at.
      if (label?.name !== 'Label' || block?.name !== 'Block' || block.lastChild?.name !== '}') return;
      out.push({ name: src.slice(label.from, label.to), from: label.from, colon: label.to, open: block.from, close: block.to - 1 });
    },
  });
  return out;
}

export function rewriteBlocks(src) {
  if (!/[\w$]\s*:\s*\{/.test(src)) return src; // nearly every sketch: nothing to find
  const edits = [];
  for (const b of blockLabels(src)) {
    // whatever sat between the label and its brace (a newline, a comment) stays
    const between = src.slice(b.colon, b.open).replace(':', '');
    edits.push([b.from, b.open + 1, `__sketch(${JSON.stringify(b.name)}, () =>${between || ' '}{`]);
    edits.push([b.close, b.close + 1, '});']);
  }
  edits.sort((x, y) => y[0] - x[0]);
  let out = src;
  for (const [from, to, text] of edits) out = out.slice(0, from) + text + out.slice(to);
  return out;
}
