import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,truncate} from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import {BrowserPreviews,BROWSER_PREVIEW_LIMITS} from '../lib/browser-preview.mjs';

async function fixture(t,options={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'oscar-browser-preview-'));
  const mission={id:'test-mission',status:'completed',files:[]};let active=false;
  const previews=new BrowserPreviews({getMission:id=>id===mission.id?mission:null,workDir:()=>directory,isActive:()=>active,...options});
  t.after(async()=>{await previews.close();await rm(directory,{recursive:true,force:true});});
  const file=async(relative,bytes)=>{await mkdir(path.dirname(path.join(directory,relative)),{recursive:true});await writeFile(path.join(directory,relative),bytes);mission.files.push({path:relative,size:Buffer.byteLength(bytes)});};
  return {directory,mission,previews,file,setActive:value=>{active=value;}};
}
function raw(url,{method='GET',target,host}={}){
  const parsed=new URL(url);return new Promise((resolve,reject)=>{
    const request=http.request({hostname:parsed.hostname,port:parsed.port,path:target||parsed.pathname,method,headers:host?{Host:host}:{}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString()}));});request.on('error',reject);request.end();
  });
}

test('isolated delivery serves immutable HTML, relative modules, styles, images and JSON with exact CSP and CORS',async t=>{
  const {previews,file}=await fixture(t);
  await file('index.html','ROOT PAGE');await file('Livraison/index.html','<!doctype html><link rel="stylesheet" href="assets/style.css"><script type="module" src="assets/game.mjs"></script>');
  await file('Livraison/assets/style.css','body{background:green}');await file('Livraison/assets/game.mjs','import "./helper.js";fetch("../levels.json");');await file('Livraison/assets/helper.js','export const answer=42;');await file('Livraison/levels.json','{"levels":[1,2]}');await file('Livraison/assets/chat drôle.svg','<svg xmlns="http://www.w3.org/2000/svg"/>');
  const preview=await previews.prepare('test-mission');assert.equal(preview.entry,'Livraison/index.html');assert.equal(preview.root,'Livraison');assert.equal(preview.count,6);assert.match(preview.url,/^http:\/\/127\.0\.0\.1:\d+\/[a-f\d]{64}\/index\.html$/u);
  const response=await fetch(preview.url);assert.equal(response.status,200);assert.match(await response.text(),/type="module"/u);const prefix=preview.url.slice(0,-10),csp=response.headers.get('content-security-policy');
  assert.match(csp,/sandbox allow-scripts(?:;|$)/u);assert(!csp.includes('allow-same-origin'));assert(csp.includes("default-src 'none'"));assert(csp.includes(`script-src 'unsafe-inline' ${prefix}`));assert(csp.includes(`connect-src ${prefix};`));
  for(const directive of ["frame-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'","worker-src 'none'"])assert(csp.includes(directive));
  assert(!/https:|\*|'self'|'unsafe-eval'/u.test(csp));assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const module=await fetch(new URL('assets/game.mjs',preview.url),{headers:{Origin:'null'}});assert.match(module.headers.get('content-type'),/^text\/javascript/u);assert.match(await module.text(),/helper/u);assert.equal(module.headers.get('access-control-allow-origin'),'*');
  const json=await fetch(new URL('levels.json?version=1',preview.url));assert.deepEqual(await json.json(),{levels:[1,2]});
  const image=await fetch(new URL('assets/chat drôle.svg',preview.url));assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/svg+xml');
  const head=await fetch(new URL('assets/style.css',preview.url),{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(Number(head.headers.get('content-length')),Buffer.byteLength('body{background:green}'));
});

test('an existing preview never rereads edited files and cannot expose unlisted or outside-root files',async t=>{
  const {previews,file,directory}=await fixture(t);await file('Livraison/index.html','ORIGINAL');await file('Livraison/app.js','ORIGINAL SCRIPT');await file('outside.json','PRIVATE OUTSIDE ROOT');
  await writeFile(path.join(directory,'Livraison','unlisted.json'),'UNLISTED');const preview=await previews.prepare('test-mission');
  await writeFile(path.join(directory,'Livraison','index.html'),'CHANGED');await rm(path.join(directory,'Livraison','app.js'));
  assert.equal(await(await fetch(preview.url)).text(),'ORIGINAL');assert.equal(await(await fetch(new URL('app.js',preview.url))).text(),'ORIGINAL SCRIPT');
  for(const target of [new URL('unlisted.json',preview.url),new URL('outside.json',preview.url),new URL('/api/state',preview.url),new URL('/index.html',preview.url)]){const response=await fetch(target);assert.equal(response.status,404);assert.equal(response.headers.get('access-control-allow-origin'),null);assert(!/PRIVATE|UNLISTED/u.test(await response.text()));}
  assert(!JSON.stringify(preview).includes(directory));assert(!JSON.stringify(preview).includes('ORIGINAL'));
});

test('a compiled dist is preferred to development sources and root resources are rebased only in HTML tags',async t=>{
  const{previews,file,mission,directory}=await fixture(t);
  await file('index.html','<!doctype html><script type="module" src="/src/main.tsx"></script>');
  const html='<!doctype html><html><head><link rel="stylesheet" href="/assets/game.css"></head><body><img src="/assets/pizza.svg"><script type="module" src="/assets/game.js?v=1"></script><script>const example=\'<img src="/not-a-real-resource.png">\';</script></body></html>';
  await file('dist/index.html',html);await file('dist/assets/game.js','console.error("Simulated game error");');await file('dist/assets/game.css','body{background:green}');await file('dist/assets/pizza.svg','<svg xmlns="http://www.w3.org/2000/svg"/>');await file('dist/manifest.webmanifest','{"name":"Temporary game"}');
  const prepared=await previews.prepare(mission.id),page=await(await fetch(prepared.url)).text(),prefix=prepared.url.slice(0,-10);
  assert.equal(prepared.entry,'dist/index.html');assert.equal(prepared.root,'dist');assert.equal(prepared.profile,'static-web-v1');assert.ok(page.startsWith('<!doctype html>'),'instrumentation must not force the page into quirks mode');
  for(const asset of['game.css','pizza.svg','game.js?v=1'])assert.ok(page.includes(prefix+'assets/'+asset));assert.ok(page.includes('src="/not-a-real-resource.png"'),'inline JavaScript is never rewritten');
  assert.equal((await fetch(new URL('assets/game.js?v=1',prepared.url))).status,200);assert.equal((await fetch(new URL('/assets/game.js',prepared.url))).status,404,'unscoped root paths never expose another snapshot');assert.equal(await readFile(path.join(directory,'dist/index.html'),'utf8'),html,'the user’s HTML is unchanged');
});

test('development sources and missing required resources explain why a game cannot run without starting a build',async t=>{
  const{previews,file,mission}=await fixture(t);await file('index.html','<!doctype html><script type="module" src="/src/main.tsx"></script>');await file('package.json','{"scripts":{"build":"never execute this command"}}');
  await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_BUILD_REQUIRED'});assert.equal(previews.server,null);
  await file('index.html','<!doctype html><script src="missing.js"></script>');await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_MISSING_ASSETS'});assert.equal(previews.server,null);
  await file('index.html','<!doctype html><main>Game</main><img src="missing.png"><img src="https://example.invalid/pizza.png">');const result=await previews.prepare(mission.id);assert.equal(result.warnings.length,2);assert.ok(result.warnings.every(message=>typeof message==='string'));assert.equal(mission.status,'completed');
});

test('the diagnostic bridge reports bounded messages only and cannot access parent accounts or commands',async t=>{
  const{previews,file,mission}=await fixture(t);await file('index.html','<!doctype html><html><head></head><body><canvas></canvas></body></html>');const result=await previews.prepare(mission.id),page=await(await fetch(result.url)).text(),script=page.match(/<script data-oscar-preview-diagnostics>([\s\S]*?)<\/script>/u)?.[1];assert.ok(script);
  const handlers=new Map(),posted=[],logged=[];const parent=new Proxy({postMessage:(data,target)=>posted.push({data,target})},{get(target,key){assert.equal(key,'postMessage','the bridge only posts text, never reads a parent API, DOM or account');return target[key];}}),window={parent,addEventListener:(kind,handler)=>handlers.set(kind,handler)},console={error:(...values)=>logged.push(values)};
  vm.runInNewContext(script,{window,console});handlers.get('error')({target:window,message:result.url.replace('index.html','game.js')+' failed'});handlers.get('unhandledrejection')({reason:new Error('Temporary rejection')});console.error('Temporary console error');handlers.get('securitypolicyviolation')({});handlers.get('DOMContentLoaded')();
  assert.deepEqual(posted.slice(0,5).map(item=>item.data.code),['runtime','promise','console','resource','ready']);assert.equal(logged.length,1);
  for(let i=0;i<50;i++)handlers.get('error')({target:window,message:'x'.repeat(1000)});assert.equal(posted.length,20);
  for(const{data,target}of posted){assert.equal(target,'*');assert.equal(Object.keys(data).length,5);assert.equal(data.type,'oscar-preview');assert.equal(data.profile,'static-web-v1');assert.ok(data.message.length<=512);assert(!data.message.includes(new URL(result.url).pathname.split('/')[1]));}
  for(const route of['/api/state','/api/connectors','/api/missions','/state.json','/preferences.json'])assert.equal((await fetch(new URL(route,result.url))).status,404);
});

test('binary assets retain every byte across read chunks and close removes the listening preview',async t=>{
  const {previews,file,mission}=await fixture(t),bytes=Buffer.alloc(2*64*1024+17);
  for(let index=0;index<bytes.length;index++)bytes[index]=(index*37)%256;
  await file('Livraison/index.html','<!doctype html><title>Jeu</title>');await file('Livraison/assets/texture.png',bytes);
  const preview=await previews.prepare(mission.id),url=new URL('assets/texture.png',preview.url),response=await fetch(url);
  assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),bytes.length);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes,'NUL, non-UTF8 bytes and final partial chunks are preserved');
  await previews.close();assert.equal(previews.snapshots.size,0);assert.equal(previews.server,null);assert.equal(previews.timer,null);await assert.rejects(fetch(url),TypeError,'closed previews cannot leave an asset server behind');
});

test('only inactive terminal missions can prepare a preview, including clearly partial failed deliveries',async t=>{
  const {previews,file,mission,setActive}=await fixture(t);await file('index.html','play');
  for(const status of ['planning','running','reviewing','assembling']){mission.status=status;await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_BUSY'});}
  assert.equal(previews.server,null,'refused work never starts a server');
  mission.status='completed';setActive(true);await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_BUSY'});setActive(false);
  await assert.rejects(previews.prepare('unknown'),{code:'BROWSER_PREVIEW_NOT_FOUND'});
  for(const status of ['completed','needs_review','failed','cancelled']){mission.status=status;assert.equal((await previews.prepare(mission.id)).entry,'index.html');assert.equal(mission.status,status,'preview never changes the outcome');}
});

test('entry selection prefers delivery then root, and requires a choice between genuinely separate sites',async t=>{
  const {previews,file,mission}=await fixture(t);await file('Contributions/a/index.html','PRIVATE');await file('Rapports/index.html','PRIVATE');await file('References/index.html','PRIVATE');
  await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_NO_ENTRY'});
  await file('site-a/index.html','A');assert.equal((await previews.prepare(mission.id)).root,'site-a');await file('site-b/index.html','B');
  await assert.rejects(previews.prepare(mission.id),err=>err.code==='BROWSER_PREVIEW_AMBIGUOUS'&&JSON.stringify(err.entries)===JSON.stringify(['site-a/index.html','site-b/index.html']));
  assert.equal((await previews.prepare(mission.id,{entry:'site-b/index.html'})).root,'site-b');
  await file('index.html','ROOT');assert.equal((await previews.prepare(mission.id)).root,'.');await file('Livraison/index.html','DELIVERY');assert.equal((await previews.prepare(mission.id)).root,'Livraison');
  for(const entry of ['site-a','site-a/../site-b/index.html','../index.html','/tmp/index.html','site-a\\index.html','References/index.html','site-a/other.html','site-a/index.html?x=1'])await assert.rejects(previews.prepare(mission.id,{entry}),{code:'BROWSER_PREVIEW_INVALID'});
});

test('named HTML pages require an explicit known choice and preserve their isolated immutable assets',async t=>{
  const{previews,file,mission,directory}=await fixture(t);
  const html='<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main>Question parlementaire</main><script src="layout.js"></script></body></html>';
  await file('Livraison/template.html',html);await file('Livraison/style.css','body{color:navy}');await file('Livraison/layout.js','console.log("Layout only");');await file('autre-secret.txt','OUTSIDE ROOT');
  await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_NO_ENTRY'});
  assert.equal(previews.server,null,'named HTML is never launched by automatic discovery');
  const result=await previews.prepare(mission.id,{entry:'Livraison/template.html'});
  assert.equal(result.entry,'Livraison/template.html');assert.equal(result.root,'Livraison');assert.equal(result.count,3);
  assert.match(result.url,/^http:\/\/127\.0\.0\.1:\d+\/[a-f\d]{64}\/template\.html$/u);
  const response=await fetch(result.url),page=await response.text();assert.equal(response.status,200);assert.match(page,/data-oscar-preview-diagnostics/u);assert.match(page,/Question parlementaire/u);
  const csp=response.headers.get('content-security-policy');assert.ok(csp.includes("sandbox allow-scripts"));assert.ok(!csp.includes('allow-same-origin'));assert.ok(csp.includes("frame-src 'none'"));assert.ok(csp.includes("form-action 'none'"));
  assert.equal(await(await fetch(new URL('style.css',result.url))).text(),'body{color:navy}');
  await writeFile(path.join(directory,'Livraison/template.html'),'CHANGED');await writeFile(path.join(directory,'Livraison/style.css'),'CHANGED');
  assert.equal(await readFile(path.join(directory,'Livraison/template.html'),'utf8'),'CHANGED');assert.match(await(await fetch(result.url)).text(),/Question parlementaire/u);assert.equal(await(await fetch(new URL('style.css',result.url))).text(),'body{color:navy}');
  for(const target of ['../autre-secret.txt','index.html','/api/state'])assert.equal((await fetch(new URL(target,result.url))).status,404,target);
  await file('Livraison/index.html','INDEX');const automatic=await previews.prepare(mission.id);assert.equal(automatic.entry,'Livraison/index.html');assert.equal(await(await fetch(automatic.url)).text(),'INDEX');
});

test('explicit HTML supports encoded page names and HTM without weakening file identity or resource checks',async t=>{
  const{previews,file,mission,directory,setActive}=await fixture(t);
  await file('Livraison/fiche modèle.HTML','<!doctype html><main>Modèle choisi</main>');await file('autre/page.htm','<!doctype html><main>Autre page</main>');
  const chosen=await previews.prepare(mission.id,{entry:'Livraison/fiche modèle.HTML'});assert.ok(chosen.url.endsWith('/fiche%20mod%C3%A8le.HTML'));assert.equal((await fetch(chosen.url)).status,200);
  const htm=await previews.prepare(mission.id,{entry:'autre/page.htm'});assert.ok(htm.url.endsWith('/page.htm'));assert.match(await(await fetch(htm.url)).text(),/Autre page/u);
  await file('Livraison/template.js','PRIVATE SCRIPT');await file('References/template.html','PRIVATE REFERENCE');await file('Livraison/secrets.html','PRIVATE SECRET');
  await writeFile(path.join(directory,'Livraison/unlisted.html'),'UNLISTED');
  for(const entry of ['Livraison/unlisted.html','Livraison/template.js','References/template.html','Livraison/secrets.html','Livraison/fiche%20mod%C3%A8le.HTML','../autre/page.htm','/autre/page.htm','Livraison/../autre/page.htm','autre/page.htm?x=1','autre/page.htm#fragment'])await assert.rejects(previews.prepare(mission.id,{entry}),{code:'BROWSER_PREVIEW_INVALID'});
  mission.files=mission.files.filter(file=>!['Livraison/template.js','References/template.html','Livraison/secrets.html'].includes(file.path));
  await file('Livraison/absent.html','<!doctype html><link rel="stylesheet" href="missing.css">');await assert.rejects(previews.prepare(mission.id,{entry:'Livraison/absent.html'}),{code:'BROWSER_PREVIEW_MISSING_ASSETS'});
  await file('Livraison/source.html','<!doctype html><script src="source.tsx"></script>');await assert.rejects(previews.prepare(mission.id,{entry:'Livraison/source.html'}),{code:'BROWSER_PREVIEW_BUILD_REQUIRED'});
  await symlink(path.join(directory,'Livraison/fiche modèle.HTML'),path.join(directory,'linked.html'));mission.files.push({path:'linked.html'});await assert.rejects(previews.prepare(mission.id,{entry:'linked.html'}),/lien/u);
  setActive(true);await assert.rejects(previews.prepare(mission.id,{entry:'autre/page.htm'}),{code:'BROWSER_PREVIEW_BUSY'});setActive(false);
});

test('symlink roots, symlink parents and symlink assets are refused before serving any bytes',async t=>{
  const {previews,file,directory,mission}=await fixture(t);await file('Livraison/index.html','play');await file('outside.js','PRIVATE');
  await symlink(path.join(directory,'outside.js'),path.join(directory,'Livraison','linked.js'));mission.files.push({path:'Livraison/linked.js'});await assert.rejects(previews.prepare(mission.id),/lien/u);assert.equal(previews.server,null);
  mission.files=mission.files.filter(file=>file.path!=='Livraison/linked.js');await symlink(path.join(directory,'Livraison'),path.join(directory,'alias'));mission.files.push({path:'alias/index.html'});await assert.rejects(previews.prepare(mission.id,{entry:'alias/index.html'}),/lien/u);
  const alias=directory+'-alias';await symlink(directory,alias);t.after(()=>rm(alias,{force:true}));previews.workDir=()=>alias;await assert.rejects(previews.prepare(mission.id),/dossier/u);
});

test('host rebinding, mutation methods, traversal and unknown tokens never receive delivery CORS or APIs',async t=>{
  const {previews,file,mission}=await fixture(t);await file('index.html','play');await file('levels.json','[]');await file('.env','PRIVATE');await file('token.json','PRIVATE');await file('state.json','PRIVATE');await file('game.py','PRIVATE');const preview=await previews.prepare(mission.id),parsed=new URL(preview.url),prefix=parsed.pathname.slice(0,-10);
  assert.equal(preview.count,2);
  for(const method of ['POST','PUT','DELETE','OPTIONS']){const response=await raw(preview.url,{method});assert.equal(response.status,405);assert.equal(response.headers['access-control-allow-origin'],undefined);assert.equal(response.headers.allow,'GET, HEAD');}
  for(const host of ['evil.example',`localhost:${parsed.port}`,'127.0.0.1:4850'])assert.equal((await raw(preview.url,{host})).status,421);
  for(const target of [`${prefix}../index.html`,`${prefix}%2e%2e/index.html`,`${prefix}%2findex.html`,`${prefix}%252e%252e/index.html`,`${prefix}..%5cindex.html`,`${prefix}%00index.html`,`${prefix}.env`,`${prefix}token.json`,`${prefix}state.json`,`${prefix}game.py`,`/${'0'.repeat(64)}/index.html`,`${prefix}%not-encoded`,`${prefix}api/state`]){const response=await raw(preview.url,{target});assert.equal(response.status,404,target);assert.equal(response.headers['access-control-allow-origin'],undefined);assert(!response.body.includes('PRIVATE'));}
});

test('snapshot limits bound known asset count, each file and combined content',async t=>{
  const {previews,file,directory,mission}=await fixture(t);await file('index.html','play');
  for(let index=0;index<200;index++)await file(`assets/${index}.js`,'');await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_LIMIT'});
  mission.files=[{path:'index.html'},{path:'huge.mp4'}];await file('huge.mp4','');await truncate(path.join(directory,'huge.mp4'),BROWSER_PREVIEW_LIMITS.fileBytes+1);await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_LIMIT'});
  mission.files=[{path:'index.html'}];for(let index=0;index<4;index++){await file(`large-${index}.mp4`,'');await truncate(path.join(directory,`large-${index}.mp4`),14*1024*1024);}
  await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_LIMIT'});assert.equal(previews.server,null);
});

test('four immutable snapshots at most survive concurrent preparation and expire after one hour',async t=>{
  let now=1700000000000;const {previews,file,mission}=await fixture(t,{now:()=>now});await file('index.html','play');const prepared=await Promise.all(Array.from({length:6},()=>previews.prepare(mission.id)));
  assert.equal(new Set(prepared.map(value=>value.url)).size,6);assert.equal(previews.snapshots.size,4);assert.equal((await fetch(prepared[0].url)).status,404);assert.equal((await fetch(prepared[1].url)).status,404);assert.equal((await fetch(prepared[5].url)).status,200);
  assert.equal(prepared[5].expiresAt,now+BROWSER_PREVIEW_LIMITS.ttlMs);now+=BROWSER_PREVIEW_LIMITS.ttlMs+1;assert.equal((await fetch(prepared[5].url)).status,404);assert.equal(previews.snapshots.size,0);
  await previews.close();assert.equal(previews.server,null);assert.equal(previews.timer,null);await assert.rejects(previews.prepare(mission.id),{code:'BROWSER_PREVIEW_CLOSED'});
});

test('closing a queued preparation cannot leave a listener or delivery in memory',async t=>{
  const {previews,file,mission}=await fixture(t);await file('index.html','play');const job=previews.prepare(mission.id),closed=previews.close();await assert.rejects(job,{code:'BROWSER_PREVIEW_CLOSED'});await closed;assert.equal(previews.server,null);assert.equal(previews.snapshots.size,0);
});
