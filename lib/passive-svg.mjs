const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_BYTES = 2 * 1024 * 1024, MAX_NODES = 5000, MAX_DEPTH = 64, MAX_EXPANDED = 50000;
const ELEMENTS = new Set('svg g defs symbol use clipPath mask linearGradient radialGradient stop pattern path rect circle ellipse line polyline polygon text tspan title desc style'.split(' '));
const DRAWING = new Set('path rect circle ellipse line polyline polygon text'.split(' '));
const ATTRIBUTES = new Set('id class role aria-label aria-labelledby aria-describedby xmlns type width height viewBox preserveAspectRatio x y dx dy x1 y1 x2 y2 cx cy r rx ry d points fill stroke color stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity transform clip-path clipPathUnits mask maskUnits maskContentUnits font-family font-size font-weight font-style letter-spacing word-spacing text-anchor dominant-baseline alignment-baseline textLength lengthAdjust vector-effect offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform href style'.split(' '));
const ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/u;
// A dot is legal in an XML ID but would start another CSS selector component.
const SELECTOR_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/u;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:px|em|rem|%|pt|pc|in|cm|mm)?$/iu;
const NUMERIC_ATTRS = new Set('width height x y dx dy x1 y1 x2 y2 cx cy r rx ry stroke-width stroke-miterlimit stroke-dashoffset opacity fill-opacity stroke-opacity font-size letter-spacing word-spacing textLength offset stop-opacity'.split(' '));
const CSS_PROPERTIES = new Set('fill stroke color stop-color font-family font-size font-weight font-style letter-spacing word-spacing text-anchor dominant-baseline alignment-baseline opacity fill-opacity stroke-opacity stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule clip-path mask stop-opacity vector-effect'.split(' '));
const ENUMS = {
  'stroke-linecap': /^(?:butt|round|square)$/u, 'stroke-linejoin': /^(?:miter|round|bevel)$/u,
  'fill-rule': /^(?:nonzero|evenodd)$/u, 'clip-rule': /^(?:nonzero|evenodd)$/u,
  'font-weight': /^(?:normal|bold|[1-9]00)$/u, 'font-style': /^(?:normal|italic|oblique)$/u,
  'text-anchor': /^(?:start|middle|end)$/u,
  'dominant-baseline': /^(?:auto|middle|central|alphabetic|hanging|text-before-edge|text-after-edge|ideographic|mathematical)$/u,
  'alignment-baseline': /^(?:auto|baseline|middle|central|alphabetic|hanging|before-edge|after-edge|text-before-edge|text-after-edge|ideographic|mathematical)$/u,
  'vector-effect': /^(?:none|non-scaling-stroke)$/u, lengthAdjust: /^(?:spacing|spacingAndGlyphs)$/u,
  gradientUnits: /^(?:userSpaceOnUse|objectBoundingBox)$/u, patternUnits: /^(?:userSpaceOnUse|objectBoundingBox)$/u,
  patternContentUnits: /^(?:userSpaceOnUse|objectBoundingBox)$/u, clipPathUnits: /^(?:userSpaceOnUse|objectBoundingBox)$/u,
  maskUnits: /^(?:userSpaceOnUse|objectBoundingBox)$/u, maskContentUnits: /^(?:userSpaceOnUse|objectBoundingBox)$/u,
  spreadMethod: /^(?:pad|reflect|repeat)$/u, role: /^(?:img|presentation)$/u,
};
const boundedNumber = value => NUMBER.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e7;
const length = value => { const match = LENGTH.exec(value); return Boolean(match && boundedNumber(match[1])); };
const numbers = value => value.trim().split(/[\s,]+/u).every(boundedNumber);
function xmlText(value) {
  let output = '', at = 0;
  for (let index = value.indexOf('&'); index >= 0; index = value.indexOf('&', at)) {
    output += value.slice(at, index); const end = value.indexOf(';', index + 1);
    if (end < 0 || end - index > 16) throw new Error('entity');
    const entity = value.slice(index + 1, end), named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) output += named[entity];
    else {
      if (!/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/u.test(entity)) throw new Error('entity');
      const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code < 32 || code >= 0x7f && code <= 0x9f || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff || code === 0xfffe || code === 0xffff) throw new Error('entity');
      output += String.fromCodePoint(code);
    }
    at = end + 1;
  }
  return output + value.slice(at);
}

/** A deliberately small SVG/XML subset. It validates, never rewrites or renders.
 * Photos, embedded images, active content, external resources and indirect CSS
 * values remain excluded. Browser sanitization and CSP are separate defenses. */
export function isPassiveSvg(source) {
  if (typeof source !== 'string' || !source.length || Buffer.byteLength(source, 'utf8') > MAX_BYTES) return false;
  try {
    for (const char of source) { const code = char.codePointAt(0); if (code < 32 && ![9, 10, 13].includes(code) || code >= 0x7f && code <= 0x9f || code >= 0xd800 && code <= 0xdfff || code === 0xfffe || code === 0xffff) return false; }
    let at = source.charCodeAt(0) === 0xfeff ? 1 : 0, drawing = false, root = null, styleBytes = 0;
    const nodes = [], stack = [], ids = new Map(), references = [];
    const whitespace = () => { while (/[\t\n\r ]/u.test(source[at] || '') && at < source.length) at++; };
    const name = () => { const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(source.slice(at)); if (!match) throw new Error('name'); at += match[0].length; return match[0]; };
    function reference(value, node, property = null, selectors = null) {
      if (!value.startsWith('#') || !ID.test(value.slice(1))) throw new Error('reference');
      if (references.length >= 20000) throw new Error('references');
      references.push({ node, id: value.slice(1), property, selectors });
    }
    const literalPaint = value => /^(?:none|currentColor|transparent|[a-zA-Z]{1,24}|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))$/u.test(value) || /^rgba?\([0-9.,%\s+-]+\)$/iu.test(value);
    function paint(value, node, key, selectors) {
      if (literalPaint(value)) return true;
      if (!/^url\(/iu.test(value) || !value.endsWith(')')) return false;
      let inner = value.slice(4, -1).trim();
      if (["'", '"'].includes(inner[0])) { if (inner.at(-1) !== inner[0]) return false; inner = inner.slice(1, -1); }
      reference(inner, node, key, selectors); return true;
    }
    function property(key, raw, node, selectors = null) {
      const value = raw.trim();
      if (!value || value.length > 131072 || /[\\@<>]|\/\*|\*\/|(?:expression|env|attr)\s*\(/iu.test(value)) return false;
      if (value.includes('var(')) {
        const variable = /^var\(\s*--[A-Za-z_][A-Za-z0-9_-]{0,63}\s*,\s*([^{};]+)\s*\)$/u.exec(value);
        return ['fill', 'stroke', 'color'].includes(key) && Boolean(variable && literalPaint(variable[1].trim()));
      }
      if (['color', 'stop-color'].includes(key)) return literalPaint(value);
      if (['fill', 'stroke'].includes(key)) return paint(value, node, key, selectors);
      if (['clip-path', 'mask'].includes(key)) return value === 'none' || /^url\(/iu.test(value) && paint(value, node, key, selectors);
      if (NUMERIC_ATTRS.has(key)) return length(value);
      if (key === 'font-family') return value.length <= 512 && /^(?:[A-Za-z][A-Za-z0-9 -]*|'[A-Za-z][A-Za-z0-9 -]*'|"[A-Za-z][A-Za-z0-9 -]*")(?:\s*,\s*(?:[A-Za-z][A-Za-z0-9 -]*|'[A-Za-z][A-Za-z0-9 -]*'|"[A-Za-z][A-Za-z0-9 -]*"))*$/u.test(value);
      if (key === 'stroke-dasharray') return value === 'none' || numbers(value);
      return Boolean(ENUMS[key]?.test(value));
    }
    function declarations(text, node, selectors = null) {
      if (/[\\@{}<>]|\/\*|\*\/|&/u.test(text)) return false;
      const entries = text.split(';'); if (entries.length > 65) return false;
      for (const entry of entries) {
        if (!entry.trim()) continue; const colon = entry.indexOf(':'); if (colon < 1) return false;
        const key = entry.slice(0, colon).trim().toLowerCase();
        if (!CSS_PROPERTIES.has(key) || !property(key, entry.slice(colon + 1), node, selectors)) return false;
      }
      return true;
    }
    function css(text, node) {
      styleBytes += text.length; if (styleBytes > 65536 || /[\\@<>]|\/\*|\*\/|&/u.test(text)) return false;
      let offset = 0, rules = 0;
      while (offset < text.length) {
        if (!text.slice(offset).trim()) break;
        const open = text.indexOf('{', offset), close = text.indexOf('}', open + 1); if (open < 0 || close < 0 || ++rules > 256) return false;
        const selectors = text.slice(offset, open).trim().split(',').map(value => value.trim()); if (selectors.length > 32) return false;
        for (const selector of selectors) {
          const value = selector.trim();
          if (value === '*') continue;
          if (/^[.#]/u.test(value)) { if (!SELECTOR_TOKEN.test(value.slice(1))) return false; }
          else if (!ELEMENTS.has(value)) return false;
        }
        if (!declarations(text.slice(open + 1, close), node, selectors)) return false;
        offset = close + 1;
      }
      return true;
    }
    function attribute(key, raw, node) {
      const value = xmlText(raw);
      if (key.includes(':') || !ATTRIBUTES.has(key) || /^on/iu.test(key)) return false;
      if (key === 'xmlns') return node === 0 && raw === SVG_NS;
      if (key === 'type') return nodes[node].tag === 'style' && value === 'text/css';
      if (key === 'id') { if (!ID.test(value) || ids.has(value)) return false; ids.set(value, node); nodes[node].id = value; return true; }
      if (key === 'class') { nodes[node].classes = value.trim().split(/\s+/u); return nodes[node].classes.every(item => ID.test(item)); }
      if (['aria-labelledby', 'aria-describedby'].includes(key)) { for (const id of value.trim().split(/\s+/u)) reference('#' + id, node); return true; }
      if (key === 'aria-label') return value.length <= 2048;
      if (key === 'href') { if (nodes[node].tag !== 'use') return false; reference(value, node); return true; }
      if (key === 'style') return declarations(value, node);
      if (key === 'd') {
        if (!/^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\-\s]+$/u.test(value)) return false;
        for (const match of value.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/giu)) if (!boundedNumber(match[0])) return false;
        return true;
      }
      if (key === 'points') return numbers(value) && value.trim().split(/[\s,]+/u).length % 2 === 0;
      if (key === 'viewBox') return numbers(value) && value.trim().split(/[\s,]+/u).length === 4;
      if (['transform', 'gradientTransform', 'patternTransform'].includes(key)) {
        const rest = value.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*([0-9.eE+,\s-]+)\s*\)/gu, (all, args) => numbers(args) ? '' : '!');
        return !rest.trim();
      }
      if (key === 'preserveAspectRatio') return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/u.test(value);
      return property(key, value, node);
    }
    if (source.startsWith('<?xml', at)) {
      const declaration = /^<\?xml\s+version=(["'])1\.0\1(?:\s+encoding=(["'])[Uu][Tt][Ff]-8\2)?(?:\s+standalone=(["'])(?:yes|no)\3)?\s*\?>/u.exec(source.slice(at));
      if (!declaration) return false; at += declaration[0].length;
    }
    while (at < source.length) {
      if (source.startsWith('<!--', at)) { const end = source.indexOf('-->', at + 4), comment = source.slice(at + 4, end); if (end < 0 || comment.includes('--') || comment.endsWith('-')) return false; at = end + 3; continue; }
      if (source[at] !== '<') {
        const end = source.indexOf('<', at), stop = end < 0 ? source.length : end, raw = source.slice(at, stop); at = stop;
        if (!stack.length) { if (raw.trim()) return false; }
        else { if (raw.includes(']]>')) return false; const current = nodes[stack.at(-1)]; if (current.tag === 'style') current.css += raw; else xmlText(raw); }
        continue;
      }
      if (source.startsWith('</', at)) {
        at += 2; const closing = name(); whitespace(); if (source[at++] !== '>' || !stack.length) return false;
        const current = nodes[stack.pop()]; if (current.tag !== closing) return false;
        if (closing === 'style' && !css(current.css, current.index)) return false;
        continue;
      }
      if (source.startsWith('<!', at) || source.startsWith('<?', at)) return false;
      at++; const tag = name(); if (!ELEMENTS.has(tag) || tag === 'svg' && nodes.length || nodes.length >= MAX_NODES || stack.length >= MAX_DEPTH) return false;
      if (stack.length && ['style', 'title', 'desc'].includes(nodes[stack.at(-1)].tag)) return false;
      if (!stack.length && (root !== null || tag !== 'svg')) return false;
      const index = nodes.length, node = { index, tag, children: [], css: '', id: null, classes: [] }; nodes.push(node);
      if (stack.length) nodes[stack.at(-1)].children.push(index); else root = index;
      if (DRAWING.has(tag)) drawing = true;
      const keys = new Set(); let selfClosing = false;
      while (at < source.length) {
        const before = at; whitespace(); const spaced = at > before;
        if (source.startsWith('/>', at)) { at += 2; selfClosing = true; break; }
        if (source[at] === '>') { at++; break; }
        if (!spaced || keys.size >= 64) return false;
        const key = name(); if (keys.has(key)) return false; keys.add(key); whitespace(); if (source[at++] !== '=') return false; whitespace();
        const quote = source[at++]; if (!['"', "'"].includes(quote)) return false;
        const end = source.indexOf(quote, at); if (end < 0 || end - at > 131072) return false; const raw = source.slice(at, end); at = end + 1;
        if (raw.includes('<') || !attribute(key, raw, index)) return false;
      }
      if (index === 0 && !keys.has('xmlns') || tag === 'use' && !keys.has('href')) return false;
      if (!selfClosing) stack.push(index);
    }
    if (stack.length || root !== 0 || !drawing) return false;
    // CSS belongs to its targets, not the <style> element. Include every
    // potentially inherited fill/stroke reference, even when another rule may
    // override it. This intentionally conservative subset needs no full CSS
    // cascade to reject recursive paint servers through groups or <use>.
    const xmlChildren = nodes.map(node => [...node.children]);
    const edges = nodes.map(node => new Set(node.children));
    let styleWork = 0, referenceEdges = 0;
    const matches = (node, selector) => {
      if (++styleWork > 200000) throw new Error('style-work');
      if (selector === '*') return true;
      if (selector[0] === '#') return node.id === selector.slice(1);
      if (selector[0] === '.') return node.classes.includes(selector.slice(1));
      return node.tag === selector;
    };
    const addEdge = (from, target) => {
      if (++referenceEdges > MAX_EXPANDED) throw new Error('reference-edges');
      edges[from].add(target);
    };
    for (const ref of references) {
      if (!ids.has(ref.id)) return false;
      const target = ids.get(ref.id);
      const targets = ref.selectors ? nodes.filter(node => ref.selectors.some(selector => matches(node, selector))).map(node => node.index) : [ref.node];
      for (const from of targets) {
        addEdge(from, target);
        if (ref.property === 'fill' || ref.property === 'stroke') {
          const pending = [...xmlChildren[from]];
          while (pending.length) {
            const child = pending.pop();
            addEdge(child, target); pending.push(...xmlChildren[child]);
          }
        }
      }
    }
    for (const node of nodes) node.children = [...edges[node.index]];
    // Count shared subtrees with memoization; reject cycles and exponential use
    // chains rather than asking the browser to discover their rendering cost.
    const visiting = new Set(), costs = new Map();
    function cost(index) {
      if (visiting.has(index)) throw new Error('cycle'); if (costs.has(index)) return costs.get(index);
      visiting.add(index); let total = 1;
      for (const child of nodes[index].children) { total += cost(child); if (total > MAX_EXPANDED) throw new Error('expansion'); }
      visiting.delete(index); costs.set(index, total); return total;
    }
    return cost(root) <= MAX_EXPANDED;
  } catch { return false; }
}
