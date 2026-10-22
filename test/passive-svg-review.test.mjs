import test from 'node:test';
import assert from 'node:assert/strict';
import {isPassiveSvg} from '../lib/passive-svg.mjs';

const wrap=body=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`;

test('CSS paint references cannot hide a local rendering cycle behind a global or class rule',()=>{
  for(const body of[
    '<style>rect{fill:url(#p)}</style><defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1"/></pattern></defs><rect width="10" height="10"/>',
    '<style>.paint{fill:url(#p)}</style><defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect class="paint" width="1" height="1"/></pattern></defs><rect class="paint" width="10" height="10"/>',
    '<style>svg{fill:url(#p)}</style><defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1"/></pattern></defs><rect width="10" height="10"/>',
    '<style>.paint{fill:url(#p)}</style><g class="paint"><defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1"/></pattern></defs><rect width="10" height="10"/></g>',
    '<style>.paint{fill:url(#p)}</style><defs><symbol id="tile"><rect width="1" height="1"/></symbol><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><use class="paint" href="#tile" width="1" height="1"/></pattern></defs><rect width="10" height="10" fill="url(#p)"/>',
    '<style>.paint.part{fill:url(#p)}</style><defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect class="paint part" width="1" height="1"/></pattern></defs><rect width="10" height="10" fill="url(#p)"/>',
    '<style>#piece.paint{fill:url(#p)}</style><defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect id="piece" class="paint" width="1" height="1"/></pattern></defs><rect width="10" height="10" fill="url(#p)"/>',
  ])assert.equal(isPassiveSvg(wrap(body)),false);
  assert.equal(isPassiveSvg(wrap('<style>.clipped{clip-path:url(#clip)}</style><defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs><rect class="clipped" width="10" height="10"/>')),true);
});

test('shared palette fallbacks remain useful without admitting URL indirection or encoded active content',()=>{
  assert.equal(isPassiveSvg(wrap('<style>.piece{fill:var(--game-accent,#62896d);stroke:var(--game-text,#253449)}</style><rect class="piece" width="10" height="10"/>')),true);
  for(const body of[
    '<rect style="fill:&#x75;rl(https://example.invalid/x.svg)"/>',
    '<rect fill="var(--game-accent,#62896d) url(https://example.invalid/x.svg)"/>',
    '<rect/><style>@namespace x url(https://example.invalid);x|rect{fill:red}</style>',
    '<rect/><?xml-stylesheet href="https://example.invalid/style.css"?>',
    '<rect xmlns="http://www.w3.org/1999/xhtml"/>',
  ])assert.equal(isPassiveSvg(wrap(body)),false,body);
  assert.equal(isPassiveSvg(wrap('<rect aria-label="&quot; onload=&quot;alert(1)" width="1" height="1"/>')),true,'Encoded quotes remain literal XML attribute text.');
});
