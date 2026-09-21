// What a piece of a sketch needs from the rest of it. A chain that says
// noise({ speed }) only works where `speed` exists, so a snippet cut from it
// carries `const speed = ...` along, and an insert that meets a sketch already
// declaring `speed` has to say so instead of landing a second `const`.
//
// Top level only, and by name: a selection that shadows a name is read as not
// needing it. That errs toward carrying less, which the save window shows and
// lets you put right by hand.

import { javascriptLanguage } from '@codemirror/lang-javascript';

const DECLS = new Set(['VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration']);
const PATTERNS = new Set(['ArrayPattern', 'ObjectPattern', 'PatternProperty']);

const parse = (src) => javascriptLanguage.parser.parse(src);
const kids = (node) => {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};

// The names a declaration binds: its own patterns, not the params of whatever
// function it is initialised with.
function boundNames(src, node, out = []) {
  for (const c of kids(node)) {
    if (c.name === 'VariableDefinition') out.push(src.slice(c.from, c.to));
    else if (c.name === 'PatternProperty') {
      const inner = kids(c);
      // { a } binds a; { a: b } and { a: [b] } bind what's on the right
      if (inner.length === 1) out.push(src.slice(inner[0].from, inner[0].to));
      else boundNames(src, c, out);
    } else if (PATTERNS.has(c.name)) boundNames(src, c, out);
  }
  return out;
}

export function topLevelDecls(src, tree = parse(src)) {
  return kids(tree.topNode)
    .filter((n) => DECLS.has(n.name))
    .map((n) => ({ names: boundNames(src, n), from: n.from, to: n.to, code: src.slice(n.from, n.to) }));
}

// Names read, and names bound, anywhere inside [from, to).
function namesIn(src, tree, from, to) {
  const reads = new Set();
  const binds = new Set();
  tree.iterate({
    from,
    to,
    enter(n) {
      if (n.from < from || n.to > to) return;
      if (n.name === 'VariableName') reads.add(src.slice(n.from, n.to));
      else if (n.name === 'VariableDefinition') binds.add(src.slice(n.from, n.to));
      // { speed } reads speed
      else if (n.name === 'PropertyDefinition' && n.node.parent?.name === 'Property'
        && !n.node.nextSibling && !n.node.prevSibling) reads.add(src.slice(n.from, n.to));
    },
  });
  return { reads, binds };
}

// The declarations outside [from, to) that the code inside it leans on, and
// the ones *they* lean on, in the order the sketch has them.
export function carriesFor(src, from, to) {
  const tree = parse(src);
  const outside = topLevelDecls(src, tree).filter((d) => d.to <= from || d.from >= to);
  const { reads, binds } = namesIn(src, tree, from, to);
  const wanted = new Set([...reads].filter((n) => !binds.has(n)));
  const carried = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const d of outside) {
      if (carried.has(d) || !d.names.some((n) => wanted.has(n))) continue;
      carried.add(d);
      grew = true;
      const inner = namesIn(src, tree, d.from, d.to);
      for (const n of inner.reads) if (!inner.binds.has(n)) wanted.add(n);
    }
  }
  return outside.filter((d) => carried.has(d)).map(({ names, code }) => ({ names, code }));
}

const squash = (s) => s.replace(/\s+/g, ' ').replace(/;$/, '').trim();

// Nothing but declarations and comments, and nothing the parser choked on.
function onlyDecls(src) {
  const tree = parse(src);
  let ok = true;
  tree.iterate({ enter(n) { if (n.type.isError) ok = false; } });
  return ok && kids(tree.topNode).every((n) => DECLS.has(n.name) || /Comment$/.test(n.name));
}

// A snippet is the declarations it brought along, a blank line, then the code
// that was selected. Split on the blank lines rather than by parsing the whole:
// a selection cut from the middle of a chain starts with a dot, and
// `const tt = text()\n\n.comp(tt)` parses as one statement. The longest run of
// paragraphs that are purely declarations is what came along; a snippet that is
// declarations all the way down is just its body.
export function splitNeeds(code) {
  let cut = 0;
  for (const m of code.matchAll(/\n[ \t]*\n/g)) {
    if (!onlyDecls(code.slice(0, m.index))) break;
    cut = m.index + m[0].length;
  }
  const body = code.slice(cut);
  return body.trim() ? { needs: code.slice(0, cut).trim(), body } : { needs: '', body: code };
}

// Where declarations go when the body lands at `pos`: above the top-level
// statement `pos` is inside (and the comment sitting on top of it), so a chain
// dropped into the middle of another, or into a callback, doesn't take its
// `const` in there with it. Between statements that's the line `pos` is on.
export function slotFor(doc, pos) {
  const lineStart = (at) => doc.lastIndexOf('\n', at - 1) + 1;
  const holder = kids(parse(doc).topNode).find((n) => !/Comment$/.test(n.name) && n.from < pos && pos <= n.to);
  let at = lineStart(holder ? holder.from : pos);
  while (at > 0) {
    const prev = lineStart(at - 1);
    if (!/^[ \t]*\/\//.test(doc.slice(prev, at))) break;
    at = prev;
  }
  return at;
}

// A snippet about to land in `doc`. A declaration the sketch already has word
// for word is left out (it would be a redeclaration, and it's the same thing);
// one that differs stays in, and its names come back as `clashes`.
export function planInsert(code, doc) {
  const have = topLevelDecls(doc);
  const clashes = [];
  let { needs, body } = splitNeeds(code);
  for (const d of topLevelDecls(needs).reverse()) {
    const twin = have.find((h) => h.names.some((n) => d.names.includes(n)));
    if (!twin) continue;
    if (squash(twin.code) === squash(d.code)) {
      needs = needs.slice(0, d.from) + needs.slice(d.to).replace(/^[ \t]*\n/, '');
    } else clashes.unshift(...d.names.filter((n) => twin.names.includes(n)));
  }
  // declarations in the body itself land where it does, so they're only
  // checked, unless that's all the body is and the sketch has every one
  if (!/^\s*\./.test(body)) {
    const mine = topLevelDecls(body);
    const twins = mine.map((d) => have.find((h) => h.names.some((n) => d.names.includes(n))));
    if (mine.length && onlyDecls(body) && mine.every((d, i) => twins[i] && squash(twins[i].code) === squash(d.code))) body = '';
    else mine.forEach((d, i) => { if (twins[i]) clashes.push(...d.names.filter((n) => twins[i].names.includes(n))); });
  }
  return { needs: needs.trim(), body: body.replace(/^\n+|\s+$/g, ''), clashes };
}
