import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createAtelierServer} from '../server.mjs';
import {updateBlockers} from '../lib/update-maintenance.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function office(t,{runner=async()=>({text:'Le projet livré contient un jeu local.'})}={}){
  const dataDir=await mkdtemp(path.join(await realpath(tmpdir()),'oscar-question-http-')),id=randomUUID(),folder=path.join(dataDir,'missions','2026-10-22 — Projet questions de contrôle'),work=path.join(folder,'travail'),stateFile=path.join(folder,'state.json');
  await mkdir(work,{recursive:true});await writeFile(path.join(work,'original.html'),'<!doctype html><title>Original conservé</title>');
  const item={id,title:'Projet questions de contrôle',prompt:'Créer un petit jeu local.',provider:'codex',locale:'fr',status:'completed',phase:'Livraison validée par Oscar',createdAt:Date.now(),updatedAt:Date.now(),events:[],result:'Le jeu local est conservé.',error:null,files:[{path:'original.html',size:58}],tasks:[{id:'t1',role:'code',agentName:'Sam',title:'Jeu local',status:'approved',attempt:1,report:'Le fichier existe.',review:{approved:true,feedback:'Contribution vérifiée.'}}],performance:{calls:[],totalDurationMs:5}};
  await writeFile(stateFile,JSON.stringify(item));
  let installs=0;
  const app=await createAtelierServer({dataDir,port:0,providers:[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}}],runner,
    updatesFactory:()=>({state:{status:'available',currentVersion:'0.6.17',latestVersion:'0.6.18'},check:async()=>({status:'available'}),install:async()=>{installs++;return{status:'restarting'};},close(){}})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`,route=`/api/missions/${id}/questions`;
  const rawPost=(url,body,extra={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...extra.headers},body:JSON.stringify(body),...(extra.signal?{signal:extra.signal}:{})});
  const post=async(url,body,extra={})=>{const response=await rawPost(url,body,extra);return{status:response.status,body:await response.json()};};
  const get=async url=>{const response=await fetch(base+url);return{status:response.status,body:await response.json()};};
  return{app,dataDir,id,work,stateFile,base,route,rawPost,post,get,installs:()=>installs};
}

test('HTTP Oscar questions reuse a running model request and never change mission state, files or performance',async t=>{
  const gate=deferred(),started=deferred(),calls=[];
  const fixture=await office(t,{runner:async input=>{calls.push(input);started.resolve();return gate.promise;}});t.after(()=>gate.resolve({text:'Réponse de fermeture.'}));
  const {app,id,route,post,get,dataDir,stateFile,work}=fixture,original=JSON.stringify(app.engine.missions.get(id)),stateBytes=await readFile(stateFile,'utf8'),fileBytes=await readFile(path.join(work,'original.html'),'utf8');
  const body={requestId:randomUUID(),question:'Où se trouve le résultat ? ',locale:'fr'},pending=post(route,body);await started.promise;
  assert.equal(app.questions.countActive,1);assert.equal(calls.length,1);assert.equal(calls[0].snapshotOnly,true);assert.equal(calls[0].readOnly,true);assert.equal(calls[0].timeoutMs,90000);assert.equal(calls[0].cwd,path.join(dataDir,'mission-questions'));assert.equal(calls[0].cwd.startsWith(work),false);
  const receipt=await get(route+'/'+body.requestId);assert.equal(receipt.status,202);assert.equal(receipt.body.status,'running');assert.equal(receipt.body.source,'model');assert.equal(Number.isFinite(receipt.body.asOf),true);
  const duplicate=post(route,body);assert.equal((await post(route,{...body,question:'Une autre question.'})).status,409);
  assert.equal((await post(route,{...body,requestId:randomUUID()})).body.code,'QUESTION_MISSION_BUSY');
  for(let index=0;index<3;index++)assert.equal((await get(route+'/'+body.requestId)).status,202);
  assert.equal(calls.length,1);gate.resolve({text:'Votre jeu est conservé dans les fichiers du projet. Je ne publie et ne modifie rien.'});
  const answer=await pending;assert.equal(answer.status,200);assert.equal(answer.body.status,'completed');assert.equal(answer.body.source,'model');assert.deepEqual((await duplicate).body,answer.body);
  assert.deepEqual((await get(route+'/'+body.requestId)).body,answer.body);assert.equal(calls.length,1);assert.equal(app.questions.countActive,0);
  assert.equal(JSON.stringify(app.engine.missions.get(id)),original);assert.equal(await readFile(stateFile,'utf8'),stateBytes);assert.equal(await readFile(path.join(work,'original.html'),'utf8'),fileBytes);
});

test('HTTP question routes reject unknown IDs, foreign origins, unexpected options and absent subscription auth without calling a model',async t=>{
  let calls=0;const {app,id,route,post,get,base}=await office(t,{runner:async()=>{calls++;return{text:'Should not run'};}}),body={requestId:randomUUID(),question:'Que reste-t-il à faire ?'};
  assert.equal((await get(route+'/'+randomUUID())).status,404);
  assert.equal((await post(`/api/missions/${randomUUID()}/questions`,body)).status,404);
  for(const invalid of [{...body,question:''},{...body,question:'x'.repeat(1001)},{...body,provider:'claude'},{...body,confirmed:true},{...body,requestId:'../../escape'}])assert.equal((await post(route,invalid)).status,400);
  assert.equal((await post(route+'?retry=1',body)).status,400);assert.equal((await get(route+'/'+body.requestId+'?retry=1')).status,400);
  assert.equal((await post(route,body,{headers:{Origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
  app.engine.providers[0].auth.loggedIn=false;
  const unavailable=await post(route,body);assert.equal(unavailable.status,400);assert.equal(unavailable.body.code,'QUESTION_CONNECTION');assert.equal(calls,0);assert.equal(app.questions.countActive,0);
  assert.equal(app.engine.missions.get(id).status,'completed');
});

test('a question survives a disconnected browser, retains its GET receipt and blocks updates as a detached model operation',async t=>{
  const started=deferred(),gate=deferred();let calls=0;
  const fixture=await office(t,{runner:async()=>{calls++;started.resolve();return gate.promise;}});t.after(()=>gate.resolve({text:'Réponse conservée.'}));
  const {app,route,rawPost,get,post,installs}=fixture,requestId=randomUUID(),controller=new AbortController();
  const pending=rawPost(route,{requestId,question:'Explique la livraison.'},{signal:controller.signal}).catch(error=>error);await started.promise;controller.abort();await pending;
  assert.equal(app.questions.countActive,1);assert.deepEqual(updateBlockers({questions:app.questions}),['requests']);
  assert.equal((await get(route+'/'+requestId)).status,202);assert.equal(calls,1);
  const blocked=await post('/api/updates/install',{version:'0.6.18',confirmed:true});assert.equal(blocked.status,409);assert.equal(installs(),0);assert.equal(app.maintenance.active,false);
  gate.resolve({text:'La livraison est enregistrée, sans nouvelle publication.'});
  for(let index=0;index<100&&app.questions.countActive;index++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(app.questions.countActive,0);assert.equal((await get(route+'/'+requestId)).status,200);assert.equal(calls,1);
  assert.equal((await post('/api/updates/install',{version:'0.6.18',confirmed:true})).status,202);assert.equal(installs(),1);
  assert.equal((await post(route,{requestId:randomUUID(),question:'Une nouvelle question.'})).status,409);assert.equal(calls,1);
});

test('server close aborts and awaits the question runner, preserving a terminal receipt outside the project',async t=>{
  const started=deferred(),aborted=deferred(),released=deferred();let stopped=false;
  const fixture=await office(t,{runner:async({signal})=>{started.resolve();signal.addEventListener('abort',()=>aborted.resolve(),{once:true});await released.promise;stopped=true;throw Object.assign(new Error('private runner diagnostic'),{code:'PROVIDER_CANCELLED'});}});t.after(()=>released.resolve());
  const {app,id,route,rawPost}=fixture,requestId=randomUUID(),pending=rawPost(route,{requestId,question:'Que fait Oscar ?'}).catch(error=>error);await started.promise;
  let closed=false;const closing=app.close().then(()=>{closed=true;});await aborted.promise;assert.equal(closed,false);assert.equal(stopped,false);assert.equal(app.questions.countActive,1);
  released.resolve();await closing;await pending;assert.equal(stopped,true);assert.equal(app.questions.countActive,0);
  const receipt=await app.questions.get(id,requestId);assert.equal(receipt.status,'failed');assert.equal(receipt.error.code,'QUESTION_CANCELLED');assert.equal(JSON.stringify(receipt).includes('private runner'),false);assert.equal(app.engine.missions.get(id).status,'completed');
});

test('Oscar question assets and the persistent accessible talk button are served without any model or account call',async t=>{
  let calls=0;const {base}=await office(t,{runner:async()=>{calls++;return{text:'Never'};}});
  for(const name of ['oscar-assistant.js','oscar-assistant.css','translations-oscar-assistant.js']){
    const response=await fetch(base+'/'+name);assert.equal(response.status,200,name);assert.ok((await response.text()).length>100);
  }
  const html=await(await fetch(base+'/')).text();assert.match(html,/<button[^>]*id="talk-oscar"[^>]*aria-label="Parler à Oscar"/u);assert.equal((html.match(/id="talk-oscar"/gu)||[]).length,1);assert.ok(html.includes('id="oscar-assistant-host"'));assert.equal(calls,0);
});
