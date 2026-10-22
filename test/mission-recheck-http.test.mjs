import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createAtelierServer} from '../server.mjs';
import {requestMissionRecovery} from '../public/mission-recovery.js';
import {CompletionDialog} from '../public/completion-dialog.js';
import {ResultPreviewDialog} from '../public/delivery-preview.js';

const mission=(values={})=>({id:'corrections-test',title:'Corrections conservées',prompt:'Relire le rapport local.',provider:'codex',status:'needs_review',updatedAt:1,tasks:[],files:[],recovery:{used:1,rechecksUsed:0,canResume:false,canRecheck:true},...values});

function installDom(t){
  const previous=globalThis.document,document={activeElement:null};
  class Element{
    constructor(tag,namespaceURI){this.tagName=tag.toUpperCase();this.namespaceURI=namespaceURI;this.nodeType=1;this.ownerDocument=document;this.children=[];this.attributes=new Map();this.handlers=new Map();this.dataset={};this.className='';this.hidden=false;this.open=false;this.disabled=false;this.isConnected=true;this._text='';this.classList={toggle:(name,force)=>{const classes=new Set(this.className.split(/\s+/u).filter(Boolean));if(force??!classes.has(name))classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');}};}
    set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){this._text='';for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.className=String(value);}getAttribute(name){return this.attributes.get(name)??null;}removeAttribute(name){this.attributes.delete(name);}
    addEventListener(name,handler){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(handler);}removeEventListener(name,handler){this.handlers.get(name)?.delete(handler);}
    async click(){if(this.disabled)return;await Promise.all([...this.handlers.get('click')||[]].map(handler=>handler({target:this})));}
    emit(name){for(const handler of this.handlers.get(name)||[])handler({target:this});}
    matches(selector){return selector[0]==='#'?this.id===selector.slice(1):selector[0]==='.'?this.className.split(/\s+/u).includes(selector.slice(1)):this.tagName.toLowerCase()===selector;}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    focus(){document.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;this.isConnected=false;}
  }
  document.createElement=tag=>new Element(tag);document.createElementNS=(namespaceURI,tag)=>new Element(tag,namespaceURI);document.body=document.createElement('body');globalThis.document=document;
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});return document;
}

test('the correction-review capability uses its own confirmed route without reopening the repair budget',async()=>{
  const item=mission(),calls=[];
  const accepted=await requestMissionRecovery(async(route,options)=>{calls.push({route,options});return{...item,status:'reviewing'};},item);
  assert.equal(accepted.id,item.id);assert.equal(calls.length,1);assert.equal(calls[0].route,'/api/missions/corrections-test/recheck');
  assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{confirmed:true});assert.equal(item.recovery.used,1);assert.equal(item.recovery.canResume,false);
  await assert.rejects(requestMissionRecovery(()=>assert.fail('No request without a capability'),mission({recovery:{used:1,rechecksUsed:1,canResume:false,canRecheck:false}})));
});

test('a lost correction-review response uses GET once and requires its own counter or an active same mission',async()=>{
  for(const current of[
    mission({status:'needs_review',recovery:{used:1,rechecksUsed:1,canResume:false,canRecheck:false}}),
    mission({status:'reviewing',recovery:{used:1,rechecksUsed:0,reason:'active',canResume:false,canRecheck:false}}),
  ]){
    const calls=[];const result=await requestMissionRecovery(async(route,options)=>{calls.push({route,options});if(options)throw new Error('Lost response');return current;},mission());
    assert.equal(result,current);assert.equal(calls.length,2);assert.equal(calls[0].route,'/api/missions/corrections-test/recheck');assert.equal(calls[1].route,'/api/missions/corrections-test');assert.equal(calls[1].options,undefined);
  }
  for(const current of[mission(),mission({recovery:{used:2,rechecksUsed:0,canRecheck:true}}),mission({id:'another-project',recovery:{used:1,rechecksUsed:1}}),null]){
    let posts=0,reads=0;await assert.rejects(requestMissionRecovery(async(_route,options)=>{if(options){posts++;throw new Error('Lost response');}reads++;return current;},mission()),/n’a pas pu être confirmée/u);assert.equal(posts,1);assert.equal(reads,1);
  }
  let calls=0;const rejected=Object.assign(new Error('Review no longer available'),{status:409});await assert.rejects(requestMissionRecovery(async()=>{calls++;throw rejected;},mission()),error=>error===rejected);assert.equal(calls,1);
});

test('the completion offers corrections review separately and keeps a refused action visible',async t=>{
  installDom(t);const calls=[],dialog=new CompletionDialog({onResume:async item=>{calls.push(item.id);throw new Error('No review available');}});
  dialog.open(mission());const action=dialog.dialog.querySelectorAll('button').find(button=>button.textContent==='Faire relire les corrections');assert.ok(action);assert.equal(calls.length,0);assert.equal(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Reprendre avec Oscar'),false);
  await action.click();assert.deepEqual(calls,['corrections-test']);assert.equal(dialog.dialog.open,true);assert.equal(dialog.error.hidden,false);assert.match(dialog.error.textContent,/n’a pas abouti/u);
  dialog.close();dialog.open(mission({updatedAt:2,recovery:{used:1,rechecksUsed:1,canResume:false,canRecheck:false}}));assert.equal(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Faire relire les corrections'),false);
  dialog.close();dialog.open(mission({updatedAt:3,status:'completed'}));assert.equal(dialog.dialog.querySelectorAll('button').some(button=>button.textContent==='Faire relire les corrections'),false);dialog.destroy();
});

test('the result locks correction review during dispatch and exposes errors without a repeated request',async t=>{
  installDom(t);let calls=0,reject;const dialog=new ResultPreviewDialog({request:()=>assert.fail('No browser or model request'),onResume:async()=>{calls++;await new Promise((_,fail)=>{reject=fail;});}});
  await dialog.open(mission());assert.equal(dialog.resume.hidden,false);assert.equal(dialog.resume.textContent,'Faire relire les corrections');assert.equal(calls,0);
  const pending=dialog.resume.click();await Promise.resolve();assert.equal(dialog.resume.disabled,true);await dialog.resume.click();assert.equal(calls,1);reject(new Error('Les corrections doivent encore être vérifiées.'));await pending;
  assert.equal(dialog.dialog.open,true);assert.equal(dialog.error.hidden,false);assert.equal(dialog.error.textContent,'Les corrections doivent encore être vérifiées.');assert.equal(dialog.resume.disabled,false);assert.equal(calls,1);
  await dialog.open(mission({status:'completed'}));assert.equal(dialog.resume.hidden,true);await dialog.resume.click();assert.equal(calls,1);dialog.destroy();
});

test('a pending completion review cannot reopen a closed balance or replace another project',async t=>{
  installDom(t);const pending=new Map(),calls=[];const dialog=new CompletionDialog({onResume:item=>{calls.push(item.id);return new Promise((resolve,reject)=>pending.set(item.id,{resolve,reject}));}});
  const first=mission();dialog.open(first);const firstButton=dialog.recoveryButton,reviewA=firstButton.click();await Promise.resolve();assert.equal(dialog.dialog.open,true);assert.equal(firstButton.disabled,true);await firstButton.click();assert.deepEqual(calls,[first.id]);
  dialog.close();pending.get(first.id).reject(new Error('Response arrived after closing.'));await reviewA;assert.equal(dialog.dialog.open,false,'A failed request never reopens a dismissed balance.');
  dialog.open({...first,updatedAt:2});const nextA=dialog.recoveryButton.click();await Promise.resolve();dialog.close();const second=mission({id:'another-project',updatedAt:3});dialog.open(second);const reviewB=dialog.recoveryButton.click();await Promise.resolve();
  pending.get(first.id).reject(new Error('Old project failure.'));await nextA;assert.equal(dialog.mission.id,second.id);assert.equal(dialog.dialog.open,true);assert.equal(dialog.error.hidden,true);assert.equal(dialog.recoveryButton.disabled,true,'The old request cannot unlock another pending review.');
  pending.get(second.id).resolve(second);await reviewB;assert.equal(dialog.dialog.open,false);assert.deepEqual(calls,[first.id,first.id,second.id]);dialog.destroy();
});

test('a late native-folder error belongs only to its original result and cannot unlock another folder request',async t=>{
  installDom(t);const pending=new Map(),calls=[];const dialog=new ResultPreviewDialog({request:()=>assert.fail('No preview request for empty files'),onFolder:id=>{calls.push(id);return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}});
  await dialog.open(mission());const first=dialog.folder.click();await Promise.resolve();assert.equal(dialog.folder.disabled,true);await dialog.folder.click();assert.deepEqual(calls,['corrections-test']);dialog.close();await dialog.open(mission({id:'another-project'}));const second=dialog.folder.click();await Promise.resolve();
  pending.get('corrections-test').reject(new Error('Old folder unavailable.'));await first;assert.equal(dialog.mission.id,'another-project');assert.equal(dialog.error.hidden,true);assert.equal(dialog.folder.disabled,true);pending.get('another-project').resolve();await second;assert.equal(dialog.folder.disabled,false);assert.equal(dialog.dialog.open,true);dialog.destroy();
});

test('HTTP correction review requires its explicit action, consumes one durable review and never resets writing',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-http-recheck-')),id=randomUUID(),folder=path.join(dataDir,'missions','Corrections conservées'),work=path.join(folder,'travail'),taskDir=path.join(work,'t1-code');
  await mkdir(taskDir,{recursive:true});const corrected='# Rapport corrigé\nCette correction locale existe avant la relecture.';await writeFile(path.join(taskDir,'rapport.md'),corrected);await writeFile(path.join(work,'original.txt'),'Original conservé.');
  const seed={id,title:'Corrections conservées',prompt:'Créer un court rapport local.',provider:'codex',status:'needs_review',phase:'À revoir',createdAt:Date.now(),updatedAt:Date.now(),events:[],result:null,error:null,referenceIds:[],references:[],outputFormats:[],recovery:{used:1,rechecksUsed:0},files:[],tasks:[{id:'t1',role:'code',title:'Rapport corrigé',instruction:'Créer rapport.md',criteria:'Le rapport existe et est relu.',deliverables:['rapport.md'],dependsOn:[],status:'needs_review',attempt:2,report:'Le rapport local a été corrigé.',review:{approved:false,feedback:'Une correction était requise.'},recoveryWriteRemaining:0}]};
  await writeFile(path.join(folder,'state.json'),JSON.stringify(seed));
  let reviews=0,writes=0,release;const held=new Promise(resolve=>{release=resolve;});
  const app=await createAtelierServer({dataDir,port:0,providers:[{id:'codex',available:true}],runner:async input=>{
    if(input.schema?.properties.tasks)assert.fail('No replanning is permitted.');
    if(input.schema?.properties.reviews){reviews++;await held;const rows=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);return{text:JSON.stringify({reviews:rows.map(row=>({taskId:row.taskId,approved:true,feedback:'Fichier corrigé réellement présent dans ce test.'}))})};}
    if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Rapport de test vérifié.'})};
    if(path.basename(input.cwd)==='t1-code'){writes++;assert.fail('The exhausted creation budget must not be renewed.');}
    return{text:'# Résultat\nLe rapport corrigé reste dans t1-code/rapport.md.'};
  }});
  t.after(async()=>{release();await app.close();await rm(dataDir,{recursive:true,force:true});});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,route=`/api/missions/${id}/recheck`;
  const post=async(body,extra='',headers={})=>{const response=await fetch(base+route+extra,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
  const initial=app.engine.get(id);assert.equal(initial.recovery.canResume,false);assert.equal(initial.recovery.canRecheck,true);
  for(const body of[{}, {confirmed:false},{confirmed:'true'},{confirmed:true,provider:'claude'},{confirmed:true,resetBudget:true}])assert.equal((await post(body)).status,400);
  assert.equal((await post({confirmed:true},'?retry=1')).status,400);assert.equal((await post({confirmed:true},'',{Origin:'https://outside.invalid'})).status,403);
  const noClient=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})});assert.equal(noClient.status,403);assert.equal(reviews,0);assert.equal(writes,0);
  const before=initial.workDirectory,accepted=await post({confirmed:true});assert.equal(accepted.status,202);assert.equal(accepted.body.id,id);assert.equal(accepted.body.workDirectory,before);assert.equal(accepted.body.recovery.used,1);assert.equal(accepted.body.recovery.rechecksUsed,1);
  const duplicate=await post({confirmed:true});assert.equal(duplicate.status,409);assert.equal(duplicate.body.code,'MISSION_RECHECK_UNAVAILABLE');release();
  const done=await app.engine.wait(id);assert.equal(done.status,'completed',done.error);assert.equal(done.recovery.used,1);assert.equal(done.recovery.rechecksUsed,1);assert.equal(done.recovery.canRecheck,false);assert.equal(done.tasks[0].recoveryWriteRemaining,0);assert.equal(reviews,1);assert.equal(writes,0);
  assert.equal(await readFile(path.join(taskDir,'rapport.md'),'utf8'),corrected);assert.equal(await readFile(path.join(work,'original.txt'),'utf8'),'Original conservé.');
  const saved=JSON.parse(await readFile(path.join(folder,'state.json'),'utf8'));assert.equal(saved.recovery.rechecksUsed,1);assert.equal(saved.recovery.used,1);
  const previous=JSON.parse(await readFile(path.join(folder,'recovery','manual-recheck-1','previous-state.json'),'utf8'));assert.equal(previous.recovery.rechecksUsed,0);assert.equal(previous.tasks[0].recoveryWriteRemaining,0);
  const exhausted=await post({confirmed:true});assert.equal(exhausted.status,409);assert.equal(exhausted.body.code,'MISSION_RECHECK_LIMIT');assert.equal(reviews,1);assert.equal(writes,0);
});
