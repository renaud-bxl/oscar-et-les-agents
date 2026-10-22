import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('dark application-wide important styles exclude the Word and Excel document subtrees',async()=>{
  const css=await readFile(new URL('../public/office-theme.css',import.meta.url),'utf8');
  const rules=[...css.replace(/\/\*[\s\S]*?\*\//gu,'').matchAll(/([^{}]+)\{([^{}]*)\}/gu)];
  const broad=rules.filter(([,selector,body])=>selector.includes('dialog')&&(
    selector.includes(':is(header,footer,section,article,form)')&&body.includes('background:transparent!important')||
    selector.includes(':is(h1,h2,h3,h4,h5,h6,p,')&&body.includes('color:var(--night-ink)!important')||
    selector.includes(':is(table,th,td,hr,fieldset)')&&body.includes('border-color:var(--night-line)!important')
  ));
  assert.equal(broad.length,3,'the three formerly destructive global rules remain identifiable');
  for(const[,selector]of broad){
    assert.match(selector,/:not\(:where\([^)]*\.office-word-page,\.office-word-page \*/u);
    assert.match(selector,/:not\(:where\([^)]*\.office-workbook-grid,\.office-workbook-grid \*/u);
  }
  assert.match(css,/dialog :is\(\.office-word-page,\.office-workbook-scroll\)\{color-scheme:light\}/u);
});

test('the PDF navigation label and its dark toolbar retain a readable measured contrast',async()=>{
  const css=await readFile(new URL('../public/office-theme.css',import.meta.url),'utf8');
  const toolbar=css.match(/dialog \.artifact-pdf-navigation\{([^}]+)\}/u)?.[1];
  assert.ok(toolbar);assert.match(toolbar,/background:var\(--night-surface\)!important/u);assert.match(toolbar,/color:var\(--night-ink\)!important/u);
  const ink=css.match(/--night-ink:#([a-f\d]{6})/iu)?.[1],paper=css.match(/--night-surface:#([a-f\d]{6})/iu)?.[1];
  const luminance=hex=>hex.match(/../gu).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  assert.ok((luminance(ink)+.05)/(luminance(paper)+.05)>=4.5);
});
