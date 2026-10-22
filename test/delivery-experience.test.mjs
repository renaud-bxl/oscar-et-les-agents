import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DeliveryPreview,ResultPreviewDialog,deliveryPreviewCandidate,deliveryPreviewEntries,isolatedPreviewUrl} from '../public/delivery-preview.js';
import {CompletionDialog} from '../public/completion-dialog.js';
import {createAtelierServer} from '../server.mjs';
import {Publishing} from '../lib/publishing.mjs';

const result=(values={})=>({id:'delivery-test',title:'Un jeu de test',prompt:'Créer un jeu local',provider:'codex',status:'completed',updatedAt:1000,tasks:[{id:'t1',status:'approved',attempt:1}],files:[{path:'Livraison/index.html',size:100}],workDirectory:'/temporary/test/travail',folderName:'2030-01-01 — Un jeu de test',result:'Résultat vérifié.',...values});
const previewUrl=`http://127.0.0.1:54321/${'a'.repeat(64)}/index.html`;

function installDom(t){
  const previous=globalThis.document,document={activeElement:null};
  class Element{
    constructor(tag,namespaceURI){this.tagName=tag.toUpperCase();this.namespaceURI=namespaceURI;this.nodeType=1;this.ownerDocument=document;this.children=[];this.attributes=new Map();this.handlers=new Map();this.dataset={};this.className='';this.hidden=false;this.open=false;this.disabled=false;this.isConnected=true;this._text='';if(tag==='iframe')this.contentWindow={};this.classList={toggle:(name,force)=>{const values=new Set(this.className.split(/\s+/u).filter(Boolean));if(force??!values.has(name))values.add(name);else values.delete(name);this.className=[...values].join(' ');}};}
    set textContent(value){this._text=String(value??'');this.children=[];}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){this._text='';for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.className=String(value);}
    getAttribute(name){return this.attributes.get(name)??null;}
    removeAttribute(name){this.attributes.delete(name);}
    set src(value){this.setAttribute('src',value);}get src(){return this.getAttribute('src')||'';}
    set href(value){this.setAttribute('href',value);}get href(){return this.getAttribute('href')||'';}
    addEventListener(name,handler){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(handler);}
    removeEventListener(name,handler){this.handlers.get(name)?.delete(handler);}
    async click(){if(this.disabled)return;await Promise.all([...this.handlers.get('click')||[]].map(handler=>handler({target:this})));}
    emit(name){for(const handler of this.handlers.get(name)||[])handler({target:this});}
    matches(selector){return selector[0]==='#'?this.id===selector.slice(1):selector[0]==='.'?this.className.split(/\s+/u).includes(selector.slice(1)):this.tagName.toLowerCase()===selector;}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    focus(){document.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;this.emit('close');}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;this.isConnected=false;}
  }
  document.createElement=tag=>new Element(tag);document.createElementNS=(namespaceURI,tag)=>new Element(tag,namespaceURI);document.body=document.createElement('body');globalThis.document=document;
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  return document;
}

test('the delivery chooses its assembled entry over source copies and keeps image previews separate',()=>{
  const files=[{path:'References/index.html'},{path:'Contributions/a/index.html'},{path:'Rapports/index.html'},{path:'reports/index.html'},{path:'reference/index.html'},{path:'tests/index.html'},{path:'t1/index.html'},{path:'index.html'},{path:'Livraison/index.html'}];
  assert.equal(deliveryPreviewCandidate(result({files})).file.path,'Livraison/index.html');
  assert.equal(deliveryPreviewCandidate(result({files:files.filter(file=>file.path!=='Livraison/index.html')})).file.path,'index.html');
  assert.equal(deliveryPreviewCandidate(result({files:[{path:'site-a/index.html'},{path:'site-b/index.html'},{path:'Livraison/affiche.png',size:12}]})),null,'Two independent sites must not be guessed from an image.');
  const image=deliveryPreviewCandidate(result({files:[{path:'References/photo.png',size:20},{path:'t1/source.svg',size:10},{path:'Livraison/affiche.png',size:12}]}));assert.equal(image.kind,'image');assert.equal(image.file.path,'Livraison/affiche.png');
  for(const bad of ['../index.html','/tmp/index.html','Livraison/../index.html','Livraison\\index.html','.secret/index.html'])assert.equal(deliveryPreviewCandidate(result({files:[{path:bad,size:10}]})),null);
  for(const entry of ['reports/index.html','reference/index.html'])assert.equal(deliveryPreviewCandidate(result({files:[{path:entry,size:10}]})),null);
  assert.equal(deliveryPreviewCandidate(result({files:[{path:'Livraison/empty.png',size:0},{path:'Livraison/huge.png',size:21*1024*1024}]})),null);
});

test('the frame accepts only the isolated loopback result URL and never an external or credential URL',()=>{
  assert.equal(isolatedPreviewUrl(previewUrl),previewUrl);
  for(const url of ['https://evil.example/index.html','javascript:alert(1)','data:text/html,hello','//127.0.0.1:54321/index.html',previewUrl.replace('127.0.0.1','localhost'),previewUrl.replace('http:','https:'),previewUrl+'?token=secret',previewUrl+'#page',previewUrl.replace('127.0.0.1','user:password@127.0.0.1'),previewUrl.replace('/index.html','/../index.html'),previewUrl.replace('54321','65536')])assert.equal(isolatedPreviewUrl(url),null,url);
});

test('an image opens inline without a browser preview request and cleanup releases its source',async t=>{
  const document=installDom(t),container=document.createElement('div'),requests=[];
  const widget=new DeliveryPreview({container,request:async(...args)=>{requests.push(args);throw new Error('Unexpected request');}});
  await widget.open(result({status:'needs_review',files:[{path:'Livraison/affiche été.png',size:20}]}));
  const image=widget.body.querySelector('img');assert.ok(image);assert.match(image.src,/Livraison\/affiche%20%C3%A9t%C3%A9\.png$/u);assert.match(widget.note.textContent,/Aperçu partiel/u);assert.equal(requests.length,0);assert.equal(widget.link.hidden,true);
  widget.cleanup();assert.equal(image.getAttribute('src'),null);assert.equal(widget.body.children.length,0);widget.destroy();
});

test('an explicit game preview uses the isolated iframe and a late response cannot replace a newer result',async t=>{
  const document=installDom(t),container=document.createElement('div'),requests=[];let resolve;
  const widget=new DeliveryPreview({container,request:async(route,options)=>{requests.push({route,options});return new Promise(done=>{resolve=done;});}});
  assert.equal(requests.length,0);const pending=widget.open(result());assert.equal(requests.length,1);assert.equal(requests[0].options.method,'POST');assert.deepEqual(JSON.parse(requests[0].options.body),{entry:'Livraison/index.html'});
  resolve({url:previewUrl,root:'Livraison'});await pending;
  const frame=widget.body.querySelector('iframe');assert.ok(frame);assert.equal(frame.getAttribute('sandbox'),'allow-scripts');assert(!frame.getAttribute('sandbox').includes('same-origin'));assert.match(frame.getAttribute('allow'),/camera 'none'/u);assert.equal(frame.referrerPolicy,'no-referrer');assert.equal(widget.link.href,previewUrl);
  widget.cleanup();assert.equal(frame.src,'about:blank');assert.equal(widget.body.children.length,0);
  const late=widget.open(result());await widget.open(result({files:[{path:'Livraison/image.png',size:20}]}));resolve({url:previewUrl,root:'Livraison'});await late;assert.equal(widget.body.querySelector('iframe'),null);assert.ok(widget.body.querySelector('img'));widget.destroy();
});

test('a failed game with artwork but no HTML is explicitly an unfinished game, not an image delivery',async t=>{
  const document=installDom(t),container=document.createElement('div'),requests=[];
  const widget=new DeliveryPreview({container,request:async(...args)=>requests.push(args)}),item=result({status:'failed',executionMode:'local-game-team',error:'Le moteur a dépassé douze minutes.',files:[{path:'t3-design/decors.svg',size:100}]});const original=JSON.stringify(item);
  await widget.open(item);assert.equal(widget.root.hidden,false);assert.match(widget.title.textContent,/n’est pas encore prêt/u);assert.match(widget.status.textContent,/Aucun index\.html/u);assert.match(widget.status.textContent,/pas un jeu testable/u);assert.ok(widget.body.querySelector('img'));assert.equal(widget.body.querySelector('iframe'),null);assert.equal(requests.length,0);assert.equal(widget.controls.hidden,true);assert.equal(JSON.stringify(item),original);widget.destroy();
});

test('multiple entry points are explicitly selectable and a completion preview does not execute before a click',async t=>{
  const document=installDom(t),container=document.createElement('div'),requests=[];const widget=new DeliveryPreview({container,request:async(route,options)=>{requests.push({route,body:JSON.parse(options.body)});return{url:previewUrl,root:'site-b'};}}),item=result({status:'failed',files:[{path:'site-a/index.html',size:100},{path:'site-b/index.html',size:100}]});
  assert.equal(deliveryPreviewCandidate(item),null);assert.equal(deliveryPreviewEntries(item).length,2);await widget.open(item);assert.equal(widget.chooser.hidden,false);assert.equal(requests.length,0);widget.entrySelect.value='site-b/index.html';await widget.chooseButton.click();await Promise.resolve();assert.equal(requests[0].body.entry,'site-b/index.html');assert.ok(widget.frame);assert.match(widget.frame.title,/non validé/u);
  widget.cleanup();requests.length=0;await widget.open(result(),{deferBrowser:true});assert.equal(requests.length,0);assert.equal(widget.frame,null);await widget.body.querySelector('button').click();await Promise.resolve();assert.equal(requests.length,1);widget.destroy();
});

test('preview input and screen-size controls are voluntary and diagnostic messages cannot invoke actions',async t=>{
  const document=installDom(t),handlers=new Map();document.defaultView={addEventListener:(kind,fn)=>handlers.set(kind,fn),removeEventListener:(kind,fn)=>{if(handlers.get(kind)===fn)handlers.delete(kind);}};let now=1000;const requests=[],container=document.createElement('div'),widget=new DeliveryPreview({container,now:()=>now,request:async(...args)=>{requests.push(args);return{url:previewUrl,root:'Livraison'};}}),item=result({status:'failed'});const original=JSON.stringify(item);await widget.open(item);const frame=widget.frame;
  assert.equal(frame.tabIndex,0);assert.notEqual(document.activeElement,frame);await widget.focusButton.click();assert.equal(document.activeElement,frame);widget.sizeSelect.value='phone';widget.sizeSelect.emit('change');assert.equal(widget.root.dataset.size,'phone');await widget.expandButton.click();assert.equal(widget.expandButton.getAttribute('aria-expanded'),'true');assert.ok(widget.root.className.includes('delivery-preview-expanded'));
  const data={type:'oscar-preview',profile:'static-web-v1',kind:'error',code:'runtime',message:'<img src=x onerror="publish()">'};const deliver=(overrides={})=>handlers.get('message')?.({source:frame.contentWindow,origin:'null',data,...overrides});
  deliver({source:{}});deliver({origin:'http://127.0.0.1:4850'});deliver({data:{...data,command:'repair'}});deliver({data:{...data,profile:'account-service'}});deliver({data:{...data,message:'x'.repeat(513)}});assert.equal(widget.diagnosticCount,0);
  deliver();assert.equal(widget.diagnosticCount,1);assert.equal(widget.diagnosticList.querySelector('img'),null);assert.equal(widget.diagnosticList.textContent,data.message);deliver();assert.equal(widget.diagnosticCount,1,'duplicate messages do not flood the UI');
  for(let i=0;i<50;i++){now+=100;deliver({data:{...data,message:'Temporary failure '+i}});}assert.equal(widget.diagnosticList.children.length,20);assert.equal(requests.length,1);assert.equal(JSON.stringify(item),original,'project messages cannot approve or resume a mission');
  widget.destroy();assert.equal(handlers.size,0);assert.equal(frame.src,'about:blank');
});

test('a recoverable failure offers an explicit resume and partial test without claiming approval',async t=>{
  installDom(t);const resumed=[],viewed=[],options=[];const dialog=new CompletionDialog({onResume:item=>resumed.push(item.id),onView:item=>viewed.push(item.id),createPreview:(container,item,settings)=>{options.push(settings);return{destroy(){}};}});
  dialog.open(result({status:'failed',recovery:{canResume:false}}));assert.equal(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Reprendre avec Oscar'),false);assert.ok(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Tester l’aperçu partiel ↗'));assert.deepEqual(options[0],{deferBrowser:true});assert.equal(viewed.length,0);assert.equal(resumed.length,0);
  dialog.close();dialog.open(result({status:'failed',updatedAt:2000,recovery:{canResume:true}}));await dialog.dialog.querySelectorAll('button').find(button=>button.textContent==='Reprendre avec Oscar').click();assert.deepEqual(resumed,['delivery-test']);assert.equal(viewed.length,0);
  dialog.open(result({status:'completed',recovery:{canResume:true}}));assert.equal(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Reprendre avec Oscar'),false);dialog.destroy();
});

test('the completion balance preserves partial outcomes, folder access and explicit publish controls',async t=>{
  const document=installDom(t),folders=[],files=[],published=[],viewed=[];
  const dialog=new CompletionDialog({onFolder:async id=>folders.push(id),onFile:async(item,file)=>files.push([item.id,file.path]),onPublish:async item=>published.push(item.id),onView:async item=>viewed.push(item.id)});
  for(const status of ['failed','needs_review','cancelled']){
    dialog.open(result({status,error:status==='failed'?'Simulated failure':undefined}));assert.equal(dialog.dialog.open,true);assert.equal(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Publier le projet ↗'),false);assert(!dialog.dialog.querySelector('#completion-title').textContent.includes('prêt'));
    await dialog.folderButton.click();assert.equal(dialog.dialog.open,true,'Opening Finder must leave the balance available.');assert.match(dialog.error.textContent,/dossier a été ouvert/u);dialog.close();
  }
  assert.equal(folders.length,3);dialog.open(result());assert.equal(published.length,0);assert.equal(viewed.length,0);
  await dialog.dialog.querySelector('.completion-file').click();assert.deepEqual(files,[['delivery-test','Livraison/index.html']]);assert.equal(dialog.dialog.open,false);
  dialog.open(result());await dialog.dialog.querySelector('.completion-action-primary').click();assert.deepEqual(viewed,['delivery-test']);assert.equal(dialog.dialog.open,false);
  dialog.open(result());await dialog.dialog.querySelectorAll('button').find(button=>button.textContent==='Publier le projet ↗').click();assert.deepEqual(published,['delivery-test']);
  dialog.open(result({provider:'demo'}));assert.equal(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Publier le projet ↗'),false);dialog.destroy();
});

test('a result dialog keeps the checked project root for a later explicit publish and folder errors stay visible',async t=>{
  const document=installDom(t),published=[];let failFolder=false;
  const dialog=new ResultPreviewDialog({request:async()=>({url:previewUrl,root:'Livraison'}),onFolder:async()=>{if(failFolder)throw new Error('Folder unavailable');},onPublish:(item,root)=>published.push({id:item.id,root})});
  await dialog.open(result());assert.equal(dialog.dialog.open,true);assert.equal(dialog.publish.hidden,false);assert.equal(published.length,0);await dialog.folder.click();assert.equal(dialog.dialog.open,true);
  failFolder=true;await dialog.folder.click();assert.equal(dialog.error.hidden,false);assert.equal(dialog.error.textContent,'Folder unavailable');assert.equal(dialog.dialog.open,true);
  await dialog.publish.click();assert.deepEqual(published,[{id:'delivery-test',root:'Livraison'}]);assert.equal(dialog.dialog.open,false);
  for(const status of ['failed','needs_review','cancelled']){await dialog.open(result({status}));assert.equal(dialog.publish.hidden,true);assert.match(dialog.preview.note.textContent,/Aperçu partiel/u);dialog.close();}
  dialog.destroy();assert.equal(document.body.querySelector('dialog'),null);
});

test('a refused resume stays visible in the preview and cannot be dispatched twice while waiting',async t=>{
  installDom(t);let reject,calls=0;const dialog=new ResultPreviewDialog({request:async()=>({url:previewUrl,root:'Livraison'}),onFolder:async()=>{},onResume:async()=>{calls++;await new Promise((_,fail)=>{reject=fail;});}});
  await dialog.open(result({status:'failed',recovery:{canResume:true}}));const pending=dialog.resume.click();await Promise.resolve();assert.equal(dialog.resume.disabled,true);await dialog.resume.click();assert.equal(calls,1);reject(new Error('La reprise est indisponible.'));await pending;
  assert.equal(dialog.dialog.open,true);assert.equal(dialog.error.hidden,false);assert.equal(dialog.error.textContent,'La reprise est indisponible.');assert.equal(dialog.resume.disabled,false);
  await dialog.open(result({status:'failed',recovery:{canResume:false}}));assert.equal(dialog.resume.hidden,true);await dialog.resume.click();assert.equal(calls,1);dialog.destroy();
});

async function serverFixture(t){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-delivery-experience-')),calls={models:0,processes:[],folders:[],files:[]};
  const app=await createAtelierServer({port:0,dataDir,providers:[],runner:async()=>{calls.models++;throw new Error('No model call permitted');},openFolder:async directory=>calls.folders.push(directory),openFile:async file=>calls.files.push(file),publishingFactory:options=>new Publishing({...options,find:async name=>'/fake/'+name,run:async(...args)=>{calls.processes.push(args);throw new Error('No external process permitted');}})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const item=result({id:'delivery-injected',createdAt:Date.now(),events:[],performance:{calls:[]},files:[{path:'Livraison/index.html',size:50},{path:'Livraison/game.js',size:30},{path:'Livraison/notes.txt',size:10}]});app.engine.missions.set(item.id,item);
  const directory=app.engine.workDir(item.id);await mkdir(path.join(directory,'Livraison'),{recursive:true});await writeFile(path.join(directory,'Livraison','index.html'),'<!doctype html><script src="game.js"></script>');await writeFile(path.join(directory,'Livraison','game.js'),'document.body.dataset.playable="yes"');await writeFile(path.join(directory,'Livraison','notes.txt'),'Test delivery notes');
  const base=`http://127.0.0.1:${app.server.address().port}`,post=(route,body={},headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});
  return{app,item,base,post,calls,directory};
}

test('delivery API previews and opens only the selected local mission without invoking a model or publishing',async t=>{
  const{app,item,base,post,calls,directory}=await serverFixture(t),route=`/api/missions/${item.id}`;
  for(const status of ['completed','needs_review','failed','cancelled']){
    item.status=status;const response=await post(route+'/browser-preview',{entry:'Livraison/index.html'});assert.equal(response.status,200);const prepared=await response.json();assert.equal(prepared.root,'Livraison');assert.ok(isolatedPreviewUrl(prepared.url));const page=await fetch(prepared.url);assert.equal(page.status,200);assert.match(await page.text(),/game\.js/u);assert.equal(item.status,status);
  }
  item.status='running';assert.equal((await post(route+'/browser-preview')).status,409);item.status='completed';app.engine.runs.set(item.id,{});assert.equal((await post(route+'/browser-preview')).status,409);app.engine.runs.delete(item.id);
  assert.equal((await post(route+'/browser-preview',{entry:'../index.html'})).status,400);assert.equal((await post(route+'/browser-preview',{entry:'Livraison/index.html',publish:true})).status,400);
  assert.equal((await post(route+'/browser-preview',{entry:'Livraison/index.html'},{Origin:'https://outside.invalid'})).status,403);
  assert.equal((await fetch(base+route+'/browser-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await post('/api/missions/unknown/browser-preview')).status,404);
  assert.equal((await post(route+'/open-folder')).status,200);assert.deepEqual(calls.folders,[directory]);assert.equal((await post(route+'/open-file',{path:'Livraison/notes.txt'})).status,200);assert.deepEqual(calls.files,[await realpath(path.join(directory,'Livraison','notes.txt'))]);
  const download=await fetch(base+route+'/files/Livraison/notes.txt');assert.equal(await download.text(),'Test delivery notes');assert.match(download.headers.get('content-disposition'),/^attachment;/u);
  const shell=await fetch(base+'/'),html=await shell.text();for(const id of ['delivery-progress-host','delivery-folder-card','delivery-panel-preview','delivery-view-result','delivery-folder-path','open-work-folder'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(shell.headers.get('content-security-policy'),/frame-src blob: http:\/\/127\.0\.0\.1:\*/u);
  for(const asset of ['delivery-preview.js','delivery-progress.js','delivery-experience.css','translations-delivery-preview.js','translations-delivery-progress.js'])assert.equal((await fetch(base+'/'+asset)).status,200,asset);
  assert.equal(calls.models,0);assert.deepEqual(calls.processes,[]);assert.equal(app.publishing.jobs.size,0);
});

test('publication preparation is reserved to completed deliveries, including its direct API route',async t=>{
  const{item,post,calls}=await serverFixture(t),route=`/api/missions/${item.id}/publication/preview`,body={kind:'ftp',entry:'Livraison',ftp:{host:'ftp.example.invalid',protocol:'ftps',username:'test-user',password:'synthetic-test',directory:'/public_html'}};
  for(const status of ['needs_review','failed','cancelled','running']){item.status=status;assert.equal((await post(route,body)).status,409,status);}
  item.status='completed';const response=await post(route,body);assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.root,'Livraison');
  for(const status of ['needs_review','failed','cancelled']){item.status=status;assert.equal((await post(route.replace('/preview',''),{...body,confirmation:true,digest:preview.digest})).status,409,status);}
  assert.equal(calls.models,0);assert.deepEqual(calls.processes,[]);
});
