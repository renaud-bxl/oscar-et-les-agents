import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {buildInstallLocation,quoteInstallPath,installLocationPath,InstallLocationGuide,INSTALL_LOCATION_URL,INSTALL_LOCATION_REPOSITORY} from '../docs/install-location.js';

test('default installation remains the documented quick command, while a data choice is never added implicitly',()=>{
 const quick=buildInstallLocation();assert.equal(quick.command,`curl -fsSL ${INSTALL_LOCATION_URL} | sh -s -- --engine codex`);assert.equal(quick.softwareDirectory,'');assert.equal(quick.dataDirectory,'');assert.match(quick.assistant,/Conserve le dossier de données déjà configuré/u);assert(quick.assistant.includes(INSTALL_LOCATION_REPOSITORY));
 for(const engine of['codex','claude','both'])assert(buildInstallLocation({engine}).command.endsWith('--engine '+engine));assert(!buildInstallLocation({softwareDirectory:'/Volumes/Mon SSD/Oscar/Logiciel'}).command.includes('--data-dir'));
});

test('shell-parsed arguments preserve apostrophes, spaces, dollar expressions, quotes and backticks as literal path bytes',t=>{
 const temporary=mkdtempSync(path.join(os.tmpdir(),'oscar-install-quote-'));t.after(()=>rmSync(temporary,{recursive:true,force:true}));const marker=path.join(temporary,'must-not-exist');
 const software=`/Volumes/Mon SSD/Oscar/L'équipe $(touch ${marker}); echo "texte" \`touch ${marker}\``,data='/Volumes/Mon SSD/Oscar/Données & archives';
 const generated=buildInstallLocation({engine:'both',softwareDirectory:software,dataDirectory:data,platform:'linux'});assert(generated.command.startsWith(`curl -fsSL ${INSTALL_LOCATION_URL} | sh -s -- `));
 const args=generated.command.split(' | sh -s -- ')[1],parsed=execFileSync('/bin/sh',['-c',`set -- ${args}; printf '%s\\0' "$@"`]).toString().split('\0').slice(0,-1);assert.deepEqual(parsed,['--engine','both','--dir',software,'--data-dir',data]);assert.equal(existsSync(marker),false);assert(generated.assistant.includes(JSON.stringify(software)));assert(generated.assistant.includes(JSON.stringify(data)));assert.match(generated.assistant,/valeurs littérales/u);
 assert.equal(execFileSync('/bin/sh',['-c',`set -- ${quoteInstallPath("/Volumes/SSD/C'est ici")}; printf '%s' "$1"`]).toString(),"/Volumes/SSD/C'est ici");
});

test('invalid paths and controls never produce an executable command',()=>{
 for(const value of ['~/Oscar','$HOME/Oscar','C:\\Oscar','relative/path','/','/Volumes/SSD','/usr/local/Oscar','/Volumes/SSD/../Oscar','/Volumes//SSD/Oscar',' /Volumes/SSD/Oscar','/Volumes/SSD/Oscar ',`/Volumes/SSD/Oscar\nwhoami`,`/Volumes/SSD/Oscar\r`, `/Volumes/SSD/Oscar\t`,`/Volumes/SSD/Oscar\u2028`,`/Volumes/SSD/Oscar\u202e`])assert.throws(()=>buildInstallLocation({softwareDirectory:value}),{code:'INSTALL_LOCATION_INVALID'},value);
 for(const value of ['\n','\0','\u0085'])assert.throws(()=>quoteInstallPath(value));
 assert.throws(()=>buildInstallLocation({engine:'codex; echo bad'}));assert.throws(()=>buildInstallLocation({engine:null}));assert.throws(()=>buildInstallLocation({platform:'unknown'}));assert.equal(installLocationPath('/Volumes/SSD/Oscar///'),'/Volumes/SSD/Oscar');
});

test('software and heavy data use separate folders and the guide does not claim an automatic migration',()=>{
 for(const [softwareDirectory,dataDirectory] of [['/Volumes/SSD/Oscar','/Volumes/SSD/Oscar'],['/Volumes/SSD/Oscar','/Volumes/SSD/Oscar/Data'],['/Volumes/SSD/Oscar/App','/Volumes/SSD/Oscar']])assert.throws(()=>buildInstallLocation({softwareDirectory,dataDirectory}),/deux dossiers distincts/u);
 const result=buildInstallLocation({softwareDirectory:'/Volumes/SSD/Oscar/App',dataDirectory:'/Volumes/SSD/Oscar/Data'});assert(result.command.includes("--dir '/Volumes/SSD/Oscar/App' --data-dir '/Volumes/SSD/Oscar/Data'"));assert.match(result.assistant,/Ne déplace ni ne supprime les missions existantes automatiquement/u);
 const windows=buildInstallLocation({platform:'windows'});assert.equal(windows.command,null);assert.match(windows.assistant,/Windows.*vérifie d’abord la méthode compatible/u);
});

class Element{
 constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes=new Map();this.listeners=new Map();this.dataset={};this.value='';}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 addEventListener(name,action){this.listeners.set(name,action);}
 removeEventListener(name){this.listeners.delete(name);}
 focus(){this.ownerDocument.activeElement=this;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}
 set innerHTML(value){throw new Error('No HTML interpolation is permitted');}
}
function fixture(options={}){const document={createElement:tag=>new Element(tag,document)},container=new Element('div',document),guide=new InstallLocationGuide({container,...options});return{document,container,guide};}
const nodes=element=>[element,...element.children.flatMap(nodes)];

test('the optional guide has only three labelled fields and generates text without touching the quick installer',()=>{
 const {guide,container}=fixture();assert.equal(guide.root.tagName,'DETAILS');assert.equal(nodes(container).filter(item=>['INPUT','SELECT','TEXTAREA'].includes(item.tagName)).length,3);for(const input of[guide.engine,guide.software,guide.data])assert(input.attributes.has('aria-labelledby'));assert.equal(guide.status.attributes.get('role'),'status');assert.equal(guide.error.attributes.get('role'),'alert');assert.equal(guide.root.open,undefined);
 guide.software.value='/Volumes/Mon SSD/Oscar/Logiciel';guide.data.value='/Volumes/Mon SSD/Oscar/Donnees';guide.engine.value='claude';guide.engine.listeners.get('change')();assert.match(guide.command.value.textContent,/--engine claude/u);assert.equal(guide.error.hidden,true);assert.equal(guide.command.button.disabled,false);guide.software.value='../../wrong';guide.software.listeners.get('input')();assert.equal(guide.error.hidden,false);assert.equal(guide.command.value.textContent,'');assert.equal(guide.command.button.disabled,true);guide.destroy();assert.equal(container.children.length,0);
});

test('copy is voluntary, handles refusal and warns when choices changed during clipboard permission',async()=>{
 const writes=[];let finish;const{guide}=fixture({clipboard:{writeText:value=>{writes.push(value);return new Promise(resolve=>{finish=resolve;});}}});assert.equal(writes.length,0);const pending=guide.copy('command');assert.equal(writes.length,1);guide.engine.value='claude';guide.refresh();finish();await pending;assert.match(guide.status.textContent,/choix ont changé/u);assert.equal(guide.command.button.disabled,false);assert.match(guide.command.value.textContent,/--engine claude/u);
 guide.clipboard={writeText:async()=>{throw Error('Denied');}};await guide.copy('assistant');assert.equal(guide.status.dataset.state,'error');assert.equal(guide.document.activeElement,guide.assistant.value);
 guide.clipboard={writeText:async value=>{writes.push(value);}};await guide.copy('assistant');assert.equal(guide.status.dataset.state,'success');assert.equal(writes.at(-1),guide.current.assistant);guide.destroy();await guide.copy('command');assert.equal(writes.length,2);
});

test('a Windows selection hides the POSIX command and platform changes preserve typed paths',()=>{
 let platform='macos';const{guide}=fixture({getPlatform:()=>platform});guide.data.value='/Volumes/SSD/Oscar/Data';guide.refresh();platform='windows';guide.refresh();assert.equal(guide.command.section.hidden,true);assert.equal(guide.command.button.disabled,true);assert.equal(guide.assistant.button.disabled,false);assert.equal(guide.windows.hidden,false);platform='linux';guide.refresh();assert.equal(guide.data.value,'/Volumes/SSD/Oscar/Data');assert.equal(guide.command.section.hidden,false);assert.match(guide.command.value.textContent,/--data-dir/u);guide.destroy();
});

test('the generator has no network, execution or browser storage surface',()=>{
 const source=readFileSync(new URL('../docs/install-location.js',import.meta.url),'utf8');for(const forbidden of[/\bfetch\s*\(/u,/\bXMLHttpRequest\b/u,/\b(?:localStorage|sessionStorage)\b/u,/\.innerHTML\s*=/u,/\beval\s*\(/u,/\bnew Function\s*\(/u])assert(!forbidden.test(source),String(forbidden));
});
