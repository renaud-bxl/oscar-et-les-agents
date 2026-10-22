import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../docs/install-page.js',import.meta.url),'utf8');
const installer='https://raw.githubusercontent.com/renaud-bxl/oscar-et-les-agents/main/install.sh';

class Element{
  constructor(){this.textContent='';this.hidden=false;this.disabled=false;this.dataset={};this.listeners=new Map();}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  querySelector(){return this.label??=new Element();}
  focus(){this.focused=true;}
}
function fixture({copy=async()=>{}}={}){
  const elements=new Map(),selection={engine:'codex',platform:'macos'},writes=[];
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  element('install-form').querySelector=selector=>({value:selector.includes('name="engine"')?selection.engine:selection.platform});
  element('assistant-prompt').textContent='Installe et lance Oscar et les Agents : https://github.com/renaud-bxl/oscar-et-les-agents. Demande-moi le disque souhaité.';
  const document={getElementById:element};
  vm.runInNewContext(source,{document,isSecureContext:true,navigator:{clipboard:{writeText:async text=>{writes.push(text);await copy(text);}}}});
  const change=(engine,platform='macos')=>{Object.assign(selection,{engine,platform});element('install-form').listeners.get('change')();};
  return{element,selection,writes,change};
}

test('the public quick command keeps disk selection in the terminal for all engines and copies only on a click',async()=>{
  const f=fixture();assert.equal(f.writes.length,0);
  for(const engine of['codex','claude','both']){
    f.change(engine);assert.equal(f.element('install-command').textContent,`curl -fsSL ${installer} | sh -s -- --engine ${engine}`);
    assert.equal(f.element('command-section').hidden,false);assert.equal(f.element('copy-command').disabled,false);
    assert.match(f.element('terminal-help').textContent,/choix du disque.*Terminal/u);
    assert.match(f.element('copy-status').textContent,/ne détecte pas vos disques/u);
    await f.element('copy-command').listeners.get('click')();
    assert.equal(f.writes.at(-1),f.element('install-command').textContent);
    assert.match(f.element('copy-status').textContent,/choisissez votre disque.*confirmez les dossiers/u);
  }
  assert.equal(f.writes.length,3);
});

test('unsupported Windows hides the whole terminal path and clipboard refusal keeps a usable manual fallback',async()=>{
  const f=fixture({copy:async()=>{throw new Error('Denied');}});
  f.change('both','windows');assert.equal(f.element('command-section').hidden,true);assert.equal(f.element('windows-note').hidden,false);
  await f.element('copy-command').listeners.get('click')();assert.equal(f.writes.length,0);
  f.change('both','linux');assert.equal(f.element('windows-note').hidden,true);assert.equal(f.element('command-section').hidden,false);
  await f.element('copy-command').listeners.get('click')();assert.equal(f.element('copy-status').dataset.state,'error');assert.equal(f.element('install-command').focused,true);
  assert.equal(f.element('copy-command').disabled,false);assert.match(f.element('terminal-help').textContent,/Sur Linux/u);
});

test('the visible installation flow explains named disks before the advanced path builder and requests no disk access from the web page',()=>{
  const html=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
  const diskStep=html.indexOf('id="install-disk-step"'),advanced=html.indexOf('data-install-location');
  assert.ok(diskStep>0&&diskStep<advanced);assert.match(html,/disques montés.*leur nom/u);assert.match(html,/logiciel<\/strong> et <strong>missions et données/u);
  assert.match(html,/ce site ne peut pas la détecter/u);assert.ok(html.includes(installer));
  for(const forbidden of[/\bfetch\s*\(/u,/\bshowDirectoryPicker\s*\(/u,/\bXMLHttpRequest\b/u,/\b(?:localStorage|sessionStorage)\b/u,/\beval\s*\(/u])assert.ok(!forbidden.test(source));
});
