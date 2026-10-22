import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureContributionPackage,CONTRIBUTION_PACKAGE_LIMITS,isComponentVerificationPackage} from '../lib/contribution-package.mjs';

function capture(files,deliverables=['index.html'],options={}){
  const reads=[];
  const result=captureContributionPackage({deliverables,...options,listFiles:directory=>Object.keys(files).filter(file=>(file.includes('/')?file.slice(0,file.lastIndexOf('/')):'.')===directory),readFile:relative=>{
    reads.push(relative);const value=files[relative];if(value===undefined)return null;
    const bytes=Buffer.from(value);return{bytes,hash:createHash('sha256').update(bytes).digest('hex')};
  }});
  return{...result,reads};
}
const game={
  'index.html':'<!doctype html><link rel="stylesheet" href="style.css"><script type="module" src="src/game.js"></script><img src="assets/background.png">',
  'README.md':'Guide du jeu, pas une preuve de tests exécutés.',
  'manifest.json':'{"icon":"assets/alt.svg"}',
  'verification.md':'Vérifications statiques seulement dans ce scénario.',
  'regles.md':'Trois chutes : fin de partie.',
  'style.css':'@font-face{font-family:local;src:url("fonts/local.woff2")}body{background-image:url("assets/background.png")}',
  'src/game.js':'import {tick} from "./physics.js"; const img={src:"../assets/player.svg"}; fetch("./constants.json");const sound=new Audio("../audio/catch.wav");',
  'src/physics.js':'export function tick() { return 1; }',
  'src/constants.json':'{"lives":3}',
  'assets/player.svg':'<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>',
  'assets/background.png':'Image fixture bytes, not a rendered image.',
  'assets/alt.svg':'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
  'fonts/local.woff2':'Font fixture bytes.',
  'audio/catch.wav':'Audio fixture bytes.',
};
export const packageGameFiles=game;

test('five declared game files capture their nine actual HTML, CSS, module, JSON and media dependencies',()=>{
  const deliverables=['index.html','README.md','manifest.json','verification.md','regles.md'],result=capture(game,deliverables);
  assert.deepEqual(result.issues,[]);assert.equal(result.snapshots.length,14);
  assert.deepEqual(new Set(result.snapshots.map(file=>file.path)),new Set(Object.keys(game)));
  for(const file of result.snapshots)assert.equal(file.hash,createHash('sha256').update(game[file.path]).digest('hex'));
  assert.equal(result.reads.length,14,'Each file is inspected once, even when referenced by several files.');
});

test('references resolve relative to each module and CSS file while root URLs stay inside the contribution',()=>{
  const result=capture({'index.html':'<script src="nested/main.js?version=1"></script>','nested/main.js':'import "../shared.js";const icon={src:"/assets/icon%20a.svg#face"};','shared.js':'const style={file:"css/theme.css"};','css/theme.css':'body{background:url(../assets/icon%20a.svg#face)}','assets/icon a.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>'});
  assert.deepEqual(result.issues,[]);assert.deepEqual(new Set(result.snapshots.map(file=>file.path)),new Set(['index.html','nested/main.js','shared.js','css/theme.css','assets/icon a.svg']));
});

test('module cycles and repeated images terminate without duplicate copies',()=>{
  const result=capture({'index.html':'<script src="a.js"></script><img src="icon.svg"><img src="icon.svg">','a.js':'import "./b.js";','b.js':'import "./a.js";','icon.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>'});
  assert.deepEqual(result.issues,[]);assert.equal(result.snapshots.length,4);assert.equal(result.reads.length,4);
});

test('a bounded literal asset directory supplies template-named sprites without executing the JavaScript expression',()=>{
  const files={'index.html':'<script type="module" src="js/renderer.js"></script>',
    'js/renderer.js':'const ASSETS=Object.fromEntries(["building","woman","catcher","objects"].map(name=>[name,new URL(`../assets/${name}.svg`,import.meta.url).href]));',
    ...Object.fromEntries(['building','woman','catcher','objects'].map(name=>[`assets/${name}.svg`,'<svg xmlns="http://www.w3.org/2000/svg"/>'])),
    'assets/token.json':'A private file must not become an asset.','assets/not-an-image.txt':'Other source file.'};
  const result=capture(files);assert.deepEqual(result.issues,[]);assert.equal(result.snapshots.length,6);
  assert.ok(result.snapshots.every(file=>!file.path.includes('token')&&!file.path.endsWith('.txt')));
});

test('a CSS or module contribution may reference another colleague’s future resource without claiming a complete HTML package',()=>{
  const result=capture({'theme.css':'body{background:url(assets/future.svg)}'},['theme.css']);
  assert.deepEqual(result.issues,[]);assert.deepEqual(result.snapshots.map(file=>file.path),['theme.css']);
  const complete=capture({'index.html':'<link rel="stylesheet" href="theme.css">','theme.css':'body{background:url(assets/future.svg)}'});
  assert.ok(complete.issues.some(issue=>issue.includes('assets/future.svg')));
});

test('a known component rendering bench may test missing-image fallbacks without owning the designers’ future sprites',()=>{
  const task={role:'code',title:'Développer le rendu Canvas',instruction:'Créer un module de rendu avec des formes de repli.',deliverables:['js/renderer.js','tests/rendu.html']};
  assert.equal(isComponentVerificationPackage(task),true);
  const result=capture({'js/renderer.js':'const image=new URL("../assets/building.svg",import.meta.url);export function draw(){return "fallback";}',
    'tests/rendu.html':'<script type="module">import {draw} from "../js/renderer.js";draw();</script>'},task.deliverables,{componentVerification:isComponentVerificationPackage(task)});
  assert.deepEqual(result.issues,[]);assert.deepEqual(new Set(result.snapshots.map(file=>file.path)),new Set(task.deliverables));
});

test('a tests folder alone never exempts an application or its integration from complete package validation',()=>{
  const module={role:'code',title:'Développer le rendu',instruction:'Créer le composant de rendu.'};
  for(const deliverables of [['tests/index.html','js/renderer.js'],['tests/jeu.html','js/renderer.js'],['tests/rendu.html'],['index.html','js/renderer.js','tests/rendu.html']])assert.equal(isComponentVerificationPackage({...module,deliverables}),false,deliverables.join(','));
  for(const role of ['analyse','recherche','redaction'])assert.equal(isComponentVerificationPackage({...module,role,deliverables:['js/renderer.js','tests/rendu.html']}),false,role);
  assert.equal(isComponentVerificationPackage({...module,title:'Assembler le jeu complet',deliverables:['js/renderer.js','tests/rendu.html']}),false);
  for(const entry of ['index.html','tests/index.html','tests/jeu.html']){
    const task={...module,deliverables:[entry,'js/renderer.js']},result=capture({[entry]:'<script src="/js/renderer.js"></script>','js/renderer.js':'const image=new URL("../assets/building.svg",import.meta.url);'},task.deliverables,{componentVerification:isComponentVerificationPackage(task)});
    assert.ok(result.issues.some(issue=>issue.includes('assets/building.svg')),entry);
  }
});

test('a missing referenced script or style prevents a favorable model from treating the package as complete',()=>{
  const result=capture({'index.html':'<script src="missing.js"></script><link rel="stylesheet" href="missing.css">'});
  assert.equal(result.issues.length,2);assert.ok(result.issues.some(issue=>issue.includes('missing.js')));assert.ok(result.issues.some(issue=>issue.includes('missing.css')));
});

test('remote and embedded resources are not fetched or converted into filesystem paths',()=>{
  const result=capture({'index.html':'<img src="https://example.test/image.png"><img src="data:image/png;base64,AA"><img src="blob:fixture"><script src="//example.test/code.js"></script>'});
  assert.deepEqual(result.reads,['index.html']);assert.equal(result.snapshots.length,1);
});

test('traversal, private source folders, hidden files and credential names are never passed to the filesystem reader',()=>{
  for(const resource of ['../outside.js','%2e%2e/outside.js','Contributions/t1-code/private.js','References/example.json','.env.json','credentials.json','assets/token.json','private\\file.js']){
    const result=capture({'index.html':`<script src="${resource}"></script>`});
    assert.deepEqual(result.reads,['index.html'],resource);assert.ok(result.issues.length,resource);
  }
});

test('literal filenames in manifest arrays are included when present without treating quoted UI prose as missing files',()=>{
  const result=capture({'index.html':'<script src="game.js"></script>','game.js':'const assets=["icon.svg"]; const message="missing-example.html";','icon.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>'});
  assert.deepEqual(result.issues,[]);assert.deepEqual(new Set(result.snapshots.map(file=>file.path)),new Set(['index.html','game.js','icon.svg']));
});

test('a missing optional literal cannot hide a later required import of the same file',()=>{
  const result=capture({'index.html':'<script src="first.js"></script><script src="second.js"></script>','first.js':'const message="missing.js";','second.js':'import "./missing.js";'});
  assert.ok(result.issues.some(issue=>issue.includes('missing.js')));
});

test('file count, package bytes and source inspection size remain bounded',()=>{
  const files={'index.html':Array.from({length:201},(_,index)=>`<script src="script-${index}.js"></script>`).join('')};
  for(let index=0;index<201;index++)files[`script-${index}.js`]='// A bounded fixture.';
  const count=capture(files);assert.ok(count.issues.some(issue=>issue.includes('200 fichiers')));assert.ok(count.snapshots.length<=CONTRIBUTION_PACKAGE_LIMITS.files);
  const bytes=captureContributionPackage({deliverables:['large.png'],readFile:()=>({bytes:{length:CONTRIBUTION_PACKAGE_LIMITS.bytes+1},hash:'not-loaded'})});
  assert.ok(bytes.issues.some(issue=>issue.includes('50 Mo')));assert.equal(bytes.snapshots.length,0);
  const source=captureContributionPackage({deliverables:['large.js'],readFile:()=>({bytes:{length:CONTRIBUTION_PACKAGE_LIMITS.textBytes+1,toString(){throw Error('The oversized source must not be parsed.');}},hash:'test-hash'})});
  assert.ok(source.issues.some(issue=>issue.includes('2 Mo')));
});
