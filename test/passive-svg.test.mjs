import test from 'node:test';
import assert from 'node:assert/strict';
import {isPassiveSvg} from '../lib/passive-svg.mjs';
const wrap=body=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">${body}</svg>`;
// Minimal anonymous fixture retaining the real blocked board's constructs.
const BOARD=wrap(`<title id="title">Planche de conception</title><desc id="description">Accueil &amp; pause</desc>
<defs><style>
text {font-family: 'Trebuchet MS', 'Avenir Next', sans-serif}
.petit {font-size:14px; fill:#506565}
.gras {font-weight:700;letter-spacing:1.6px}
</style><symbol id="scene" viewBox="0 0 900 600"><g id="mur"><path fill="#FFF2D8" d="M0 0H900V570H0Z"/></g><circle cx="450" cy="110" r="22"/></symbol>
<clipPath id="screen"><rect x="0" y="0" width="300" height="200" rx="12"/></clipPath></defs>
<g clip-path="url(#screen)" transform="translate(10 20) scale(0.5)"><use href="#scene" width="900" height="600"/></g>
<text x="20" y="240" class="petit">Trois au sol… <tspan class="gras">rejouer !</tspan></text>`);

test('accepts the passive CSS, symbols and existing local clip references of the blocked board',()=>{
  assert.equal(isPassiveSvg(BOARD),true);
  assert.equal(isPassiveSvg('<?xml version="1.0" encoding="UTF-8"?>\n<!-- dessin -->'+BOARD),true);
  assert.equal(isPassiveSvg(wrap('<rect width="10" height="10"/><text>Je t’aime &lt;3 &amp; bienvenue</text>')),true);
  assert.equal(isPassiveSvg(wrap('<style type="text/css">text{font-size:18px}</style><text>Bonjour</text>')),true);
});

test('supports literal paint fallbacks required by the shared game contract',()=>{
  for(const value of ['var(--game-accent,#62896d)','var( --game_accent , rgb(90, 120, 40) )','var(--Ink,currentColor)'])assert.equal(isPassiveSvg(wrap(`<rect width="10" height="10" fill="${value}"/>`)),true,value);
  assert.equal(isPassiveSvg(wrap('<style>.green {fill:var(--game-accent,#62896d);stroke:var(--ink,black)}</style><rect class="green" width="10" height="10"/>')),true);
  assert.equal(isPassiveSvg(wrap('<rect width="10" height="10" style="fill:var(--game-accent,#62896d);stroke-width:2"/>')),true);
});

test('accepts root-only literal palettes and passive hidden illustration states',()=>{
  const drawing=wrap(`<style>:root {--game-bg:#f5f3ed;--game-accent:#62896d;--Ink:rgb(40, 50, 60)}
  .alternate {display:none} .visible {display:inline}</style>
  <rect width="10" height="10" fill="var(--game-bg,#fff)"/>
  <g id="alternate" display="none"><circle r="5" fill="var(--game-accent,#62896d)"/></g>
  <g class="alternate"><path d="M0 0h10v10z"/></g><g display="inline" class="visible"><rect/></g>`);
  assert.equal(isPassiveSvg(drawing),true);
  assert.equal(isPassiveSvg(wrap('<style>:root {fill:red}</style><rect style="display:none"/>')),true);
  for(const body of [
    '<style>:root {--paint:url(#paint)}</style><rect id="paint"/>',
    '<style>:root {--paint:url(https://example.invalid/a.svg)}</style><rect/>',
    '<style>:root {--paint:var(--other,red)}</style><rect/>',
    '<style>:root {--paint:env(paint,red)}</style><rect/>',
    '<style>:root {--paint:expression(alert(1))}</style><rect/>',
    '<style>:root {--paint:attr(data-color)}</style><rect/>',
    '<style>:root {--paint:red !important}</style><rect/>',
    '<style>:root,rect {--paint:red}</style><rect/>',
    '<rect style="--paint:red"/>',
    '<style>:root:hover {--paint:red}</style><rect/>',
    '<style>:root {--paint:red;--'+'a'.repeat(65)+':red}</style><rect/>',
    '<rect display="contents"/>','<rect display="url(#a)"/>',
  ])assert.equal(isPassiveSvg(wrap(body)),false,body);
});

test('resolves only local existing IDs including forward references and bounded paint servers',()=>{
  assert.equal(isPassiveSvg(wrap('<use href="#drawing"/><defs><symbol id="drawing"><path d="M0 0h10v10z"/></symbol></defs>')),true);
  assert.equal(isPassiveSvg(wrap('<defs><linearGradient id="paint"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></linearGradient></defs><rect width="10" height="10" fill="url(\'#paint\')"/>')),true);
  for(const body of ['<use href="#absent"/>','<rect width="10" height="10" clip-path="url(#absent)"/>','<rect id="same"/><circle id="same"/>','<use/>'])assert.equal(isPassiveSvg(wrap(body)),false,body);
});

const ATTACKS=[
  '<script>alert(1)</script><rect/>','<foreignObject><div>HTML</div></foreignObject><rect/>',
  '<image href="data:image/png;base64,AAAA"/><rect/>','<image href="#local"/><rect id="local"/>',
  '<rect onload="alert(1)"/>','<rect ONLOAD="alert(1)"/>','<rect onfocusin="alert(1)"/>',
  '<animate attributeName="href" to="https://example.invalid"/><rect/>','<set attributeName="fill" to="red"/><rect/>',
  '<a href="https://example.invalid"><rect/></a>','<iframe/><rect/>','<use href="https://example.invalid/a.svg#x"/>',
  '<use href="//example.invalid/x.svg#x"/>','<use href="data:image/svg+xml,x"/>','<use href="javascript:alert(1)"/>',
  '<use href="jav&#10;ascript:alert(1)"/>','<use href="&#x68;ttps://example.invalid/a.svg#x"/>',
  '<rect fill="url(https://example.invalid/x.svg#x)"/>','<rect fill="url(//example.invalid/x.svg#x)"/>',
  '<rect style="fill:u&#114;l(https://example.invalid/x.svg#x)"/>','<style>rect {fill:u/**/rl(https://example.invalid/x.svg)}</style><rect/>',
  '<style>@import "https://example.invalid/a.css";</style><rect/>','<style>@font-face{font-family:test;src:url(https://example.invalid/font)}</style><rect/>',
  '<style>rect{fill:u\\72l(https://example.invalid/x.svg)}</style><rect/>','<rect style="fill:expression(alert(1))"/>',
  '<style>rect{background-image:url(https://example.invalid)}</style><rect/>','<rect style="behavior:url(x.htc)"/>',
  '<rect fill="var(--paint)"/>','<rect fill="var(--paint,url(#local))"/><rect id="local"/>',
  '<rect fill="var(--paint,var(--other,#fff))"/>','<rect fill="var(--paint,url(https://example.invalid))"/>',
  '<rect width="var(--size,10)"/>','<style>rect{--paint:red;fill:var(--paint,#fff)}</style><rect/>',
  '<rect fill="env(paint,red)"/>','<rect style="fill:attr(data-paint)"/>',
  '<g xmlns="http://www.w3.org/1999/xhtml"><rect/></g>','<g xml:base="https://example.invalid"><rect/></g>',
  '<g xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#x"/></g><rect id="x"/>',
  '<x:rect xmlns:x="http://www.w3.org/2000/svg"/>','<style type="text/javascript">rect{fill:red}</style><rect/>',
  '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private/example">]><text>&x;</text>',
  '<?xml-stylesheet href="https://example.invalid/a.css"?><rect/>','<![CDATA[<script/>]]><rect/>',
  '<text>&unknown;</text>','<text>&#0;</text>','<text>&#xD800;</text>','<text>bad]]></text>',
  '<rect width="10"width="20"/>','<rect width="10" width="20"/>','<g><rect/></svg>','<!-- malformed ---><rect/>',
];
test('rejects active content, all imaging, namespaces, external references and CSS obfuscation',()=>{
  for(const body of ATTACKS)assert.equal(isPassiveSvg(wrap(body)),false,body);
});

test('rejects cycles and exponential local-reference expansion',()=>{
  assert.equal(isPassiveSvg(wrap('<g id="a"><use href="#a"/></g><rect/>')),false);
  assert.equal(isPassiveSvg(wrap('<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/><rect/>')),false);
  const chain=['<g id="n0"><rect width="10" height="10"/></g>'];
  for(let index=1;index<=17;index++)chain.push(`<g id="n${index}"><use href="#n${index-1}"/><use href="#n${index-1}"/></g>`);
  assert.equal(isPassiveSvg(wrap('<defs>'+chain.join('')+'</defs><use href="#n17"/>')),false);
  assert.equal(isPassiveSvg(wrap('<style>:root {fill:url(#paint)}</style><defs><pattern id="paint"><rect/></pattern></defs><rect/>')),false,'Root paint still participates in the inherited reference cycle check.');
  assert.equal(isPassiveSvg(wrap('<g id="hidden" display="none"><use href="#hidden"/></g><rect/>')),false,'Hidden content is still checked for reference cycles.');
  assert.equal(isPassiveSvg(wrap('<defs display="none">'+chain.join('')+'</defs><use href="#n17"/>')),false,'Hidden content does not bypass the expansion limit.');
});

test('fails closed for malformed roots, declarations, dimensions and resource limits',()=>{
  for(const source of [null,{},'', '<svg><rect/></svg>',BOARD+BOARD,'<?xml version="1.0" encoding="ISO-8859-1"?>'+BOARD,'<!DOCTYPE svg>'+BOARD,wrap('<rect d="M1e999 0"/>'),wrap('<rect/>'.repeat(5000)),wrap('<g>'.repeat(65)+'<rect/>'+'</g>'.repeat(65)),wrap('<text>'+ 'é'.repeat(1024*1024)+'</text>'),wrap('<rect width="'+ '1'.repeat(131073)+'"/>')])assert.equal(isPassiveSvg(source),false);
});
