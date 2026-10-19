import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Automations} from '../lib/automations.mjs';
import {createAtelierServer} from '../server.mjs';
import {AutomationsDialog} from '../public/automations-dialog.js';
import {SecretaryDialog} from '../public/secretary-dialog.js';
import {DraftStorage} from '../public/draft-storage.js';
import {translate} from '../public/i18n.js';

const basic={label:'Routine de test',prompt:'Un rapport local.',provider:'codex',schedule:{frequency:'interval',intervalMinutes:60},enabled:true};
class Engine extends EventEmitter {
 constructor(dataDir){super();this.dataDir=dataDir;this.calls=[];this.missions=new Map();}
 state(){return{providers:[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}}],maxConcurrentMissions:4,activeMissions:[...this.missions.values()].filter(m=>m.status==='running')};}
 get(id){return this.missions.get(id);}
 start(body,options){assert.ok(body.prompt.length<=16000);const mission={id:'fake-'+(this.calls.length+1),status:'running'};this.calls.push({body,options});this.missions.set(mission.id,mission);return mission;}
}
function fixture(t,options={}){
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-automation-receipt-')),engine=new Engine(dataDir);let now=Date.parse('2026-10-19T09:00:00Z');
 const scheduler=new Automations({engine,now:()=>now,...options});
 t.after(async()=>{await scheduler.close();rmSync(dataDir,{recursive:true,force:true});});return{scheduler,engine,dataDir,advance:ms=>{now+=ms;},now:()=>now};
}

test('une réponse perdue se rejoue sans doublon, connexion ou nouveau départ, même après reprise et modification',async t=>{
 let checks=0;const f=fixture(t,{resolveConnectorPlan:async()=>{checks++;throw new Error('Aucun compte pendant un enregistrement');}});
 const body={...basic,requestId:'routine_retry_123',requiresConnector:true,connectorName:'gmail'};
 const first=f.scheduler.create(body);assert.equal(f.scheduler.create(body).id,first.id);assert.equal(checks,0);assert.equal(f.engine.calls.length,0);
 assert.equal(f.scheduler.lookupRequest(body.requestId).automation.id,first.id);
 assert.throws(()=>f.scheduler.create({...body,prompt:'Un autre contexte.'}),e=>e.code==='AUTOMATION_REQUEST_CHANGED');
 f.scheduler.update(first.id,{enabled:false,prompt:'Un brief modifié après réception.'});
 const restored=new Automations({engine:f.engine,dataDir:f.dataDir,now:f.now});t.after(()=>restored.close());
 const replay=restored.create(body);assert.equal(replay.id,first.id);assert.equal(replay.enabled,false);assert.equal(replay.prompt,'Un brief modifié après réception.');
 assert.equal(restored.entries.size,1);assert.equal(checks,0);assert.equal(f.engine.calls.length,0);
 assert.equal(restored.lookupRequest('unknown_request'),null);
 for(const id of ['',12345678,'../routine','x'.repeat(101)])assert.throws(()=>restored.lookupRequest(id));
});

test('un reçu ne subsiste pas après une erreur atomique de sauvegarde ; la compatibilité sans reçu reste explicite',t=>{
 const{scheduler}=fixture(t);const save=scheduler.save.bind(scheduler);
 scheduler.save=()=>{throw new Error('Échec disque simulé');};
 assert.throws(()=>scheduler.create({...basic,requestId:'routine_write_123'}),/Échec disque/);assert.equal(scheduler.lookupRequest('routine_write_123'),null);assert.equal(scheduler.entries.size,0);
 scheduler.save=save;const first=scheduler.create({...basic,requestId:'routine_write_123'});assert.equal(scheduler.create({...basic,requestId:'routine_write_123'}).id,first.id);
 assert.notEqual(scheduler.create(basic).id,scheduler.create(basic).id);
 for(const requestId of [null,12345678,'short','x'.repeat(101)])assert.throws(()=>scheduler.create({...basic,requestId}));
});

test('une reprise à la limite de cent routines conserve le reçu et ne consomme pas une autre place',t=>{
 const{scheduler}=fixture(t);const body={...basic,requestId:'routine_full_123'},first=scheduler.create(body);
 for(let i=1;i<100;i++)scheduler.create({...basic,label:'Routine '+i});
 assert.equal(scheduler.create(body).id,first.id);assert.equal(scheduler.entries.size,100);assert.throws(()=>scheduler.create({...basic,requestId:'routine_new_123'}),/100/);
});

test('une suppression garde un reçu sans contenu pendant sept jours, même après redémarrage, sans résurrection',t=>{
 const f=fixture(t),body={...basic,requestId:'routine_deleted_123'},first=f.scheduler.create(body);
 f.scheduler.remove(first.id);const deleted=f.scheduler.lookupRequest(body.requestId);assert.equal(deleted.status,'deleted');assert.equal(deleted.requestId,body.requestId);
 assert.throws(()=>f.scheduler.create(body),e=>e.code==='AUTOMATION_REQUEST_DELETED');assert.throws(()=>f.scheduler.create({...body,prompt:'Autre intention.'}),e=>e.code==='AUTOMATION_REQUEST_DELETED');
 const saved=JSON.parse(readFileSync(path.join(f.dataDir,'automations.json'),'utf8'));assert.equal(saved.automations.length,0);assert.deepEqual(Object.keys(saved.deletedRequests[0]).sort(),['expiresAt','fingerprint','id']);
 const restored=new Automations({engine:f.engine,dataDir:f.dataDir,now:f.now});t.after(()=>restored.close());assert.equal(restored.lookupRequest(body.requestId).status,'deleted');assert.throws(()=>restored.create(body),e=>e.code==='AUTOMATION_REQUEST_DELETED');
 f.advance(7*24*60*60*1000+1);assert.equal(restored.lookupRequest(body.requestId),null);
 const expired=new Automations({engine:f.engine,dataDir:f.dataDir,now:f.now});t.after(()=>expired.close());assert.equal(expired.deletedRequests.size,0,'Le chargement purge les reçus expirés');
 const next=restored.create(body);assert.notEqual(next.id,first.id);assert.equal(restored.deletedRequests.size,0);assert.equal(f.engine.calls.length,0);
});

test('une suppression non enregistrée restaure la routine et son reçu accepté ; le registre reste borné',t=>{
 const f=fixture(t),body={...basic,requestId:'routine_delete_fail'},first=f.scheduler.create(body),file=path.join(f.dataDir,'automations.json'),before=readFileSync(file,'utf8');
 const save=f.scheduler.save.bind(f.scheduler);f.scheduler.save=()=>{throw new Error('Suppression disque refusée');};
 assert.throws(()=>f.scheduler.remove(first.id),/disque/);assert.equal(f.scheduler.lookupRequest(body.requestId).status,'accepted');assert.equal(f.scheduler.deletedRequests.size,0);assert.equal(readFileSync(file,'utf8'),before);
 f.scheduler.save=save;
 for(let i=0;i<1000;i++)f.scheduler.deletedRequests.set('deleted_'+String(i).padStart(4,'0'),{id:'deleted_'+String(i).padStart(4,'0'),fingerprint:'a'.repeat(64),expiresAt:f.now()+7*24*60*60*1000});
 f.scheduler.save();assert.throws(()=>f.scheduler.remove(first.id),/registre.*plein/);assert.equal(f.scheduler.get(first.id).id,first.id);assert.equal(f.scheduler.deletedRequests.size,1000);
 f.advance(7*24*60*60*1000+1);f.scheduler.remove(first.id);assert.equal(f.scheduler.deletedRequests.size,1);
});

test('le budget du brief inclut les gardes avant création et modification, sans perdre les anciennes routines',async t=>{
 let checks=0;const f=fixture(t,{resolveConnectorPlan:async()=>{checks++;return{client:'codex',name:'gmail',type:'gmail',source:'chatgpt',appId:'a'.repeat(100),enabledTools:['read']};}});
 assert.throws(()=>f.scheduler.create({...basic,prompt:'a'.repeat(16000),requiresConnector:true,connectorName:'gmail'}),/consignes de lecture/);assert.equal(f.scheduler.entries.size,0);assert.equal(checks,0);
 const first=f.scheduler.create({...basic,prompt:'a'.repeat(14800),requiresConnector:true,connectorName:'gmail'});await f.scheduler.run(first.id);assert.equal(f.engine.calls.length,1);assert.ok(f.engine.calls[0].body.prompt.length<=16000);
 assert.throws(()=>f.scheduler.update(first.id,{prompt:'b'.repeat(16000)}),/consignes de lecture/);assert.equal(f.scheduler.get(first.id).prompt.length,14800);
 const file=path.join(f.dataDir,'automations.json'),saved=JSON.parse(readFileSync(file,'utf8'));saved.automations[0].prompt='a'.repeat(16000);saved.automations[0].status='scheduled';saved.automations[0].lastMissionId=null;writeFileSync(file,JSON.stringify(saved));
 const restored=new Automations({engine:f.engine,dataDir:f.dataDir,now:f.now,resolveConnectorPlan:()=>{throw new Error('Aucune lecture du compte');}});t.after(()=>restored.close());
 assert.equal(restored.entries.size,1);assert.equal(restored.storageError,undefined);assert.equal((await restored.run(first.id)).status,'needs_configuration');assert.equal(f.engine.calls.length,1);
 assert.equal(restored.update(first.id,{enabled:false}).enabled,false);
});

test('le reçu HTTP de routine est strict, durable et ne lance ni modèle ni vérification de compte',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-automation-http-'));let calls=0,reads=0;
 const options={port:0,dataDir,providers:[],runner:async()=>{calls++;throw new Error('Aucun modèle');},connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async()=>{reads++;throw new Error('Aucun compte');},close:async()=>{}})};
 let app=await createAtelierServer(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 const post=async body=>fetch(`http://127.0.0.1:${app.server.address().port}/api/automations`,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body)});
 const body={...basic,requiresConnector:true,connectorName:'gmail',requestId:'routine_http_123'};
 const first=await(await post(body)).json();assert.equal((await post(body)).status,201);assert.equal((await post({...body,schedule:{frequency:'daily',time:'10:00'}})).status,409);
 await app.close();app=await createAtelierServer(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const receipt=await(await fetch(base+'/api/automation-requests/'+body.requestId)).json();assert.equal(receipt.automation.id,first.id);assert.equal(receipt.status,'accepted');
 for(const suffix of ['/routine_unknown_123','/short','/routine_http_123?extra=1'])assert.equal((await fetch(base+'/api/automation-requests'+suffix)).status,suffix.includes('unknown')?404:400);
 assert.equal((await fetch(base+'/api/automation-requests/'+body.requestId,{headers:{Origin:'https://outside.invalid'}})).status,403);
 assert.equal(app.automations.entries.size,1);assert.equal(calls,0);assert.equal(reads,0);
 app.automations.remove(first.id);const removed=await(await fetch(base+'/api/automation-requests/'+body.requestId)).json();assert.equal(removed.status,'deleted');assert.equal((await post(body)).status,409);assert.equal(app.automations.entries.size,0);
});

function drafts(){const memory=new Map();return{memory,store:new DraftStorage({scope:'recovery-test',storage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)}})};}

test('le formulaire de routine conserve son reçu après réponse perdue et erreur de lookup, sans second POST',async t=>{
 const{scheduler}=fixture(t),{store,memory}=drafts();let posts=0,failLookups=[503,400];
 const dialog=Object.assign(Object.create(AutomationsDialog.prototype),{opened:true,epoch:1,busy:false,loadSequence:0,labelInput:{value:basic.label},prompt:{value:basic.prompt},topic:{value:''},provider:{value:'codex'},draftMessage:{},clearDraftButton:{},draftStore:store,updateForm(){},renderList(){},showError(){},showNotice(){},resetForm(){},refresh:async()=>{},request:async(url,options)=>{
  if(options?.method==='POST'){posts++;scheduler.create(JSON.parse(options.body));throw new Error('Réponse perdue simulée');}
  if(failLookups.length)throw Object.assign(new Error('Indisponible'),{status:failLookups.shift()});
  return scheduler.lookupRequest(url.split('/').at(-1));
 }});
 await dialog.saveNewRoutine(basic);assert.equal(posts,1);assert.ok(dialog.pendingRequest);assert.ok(store.read('routine').requestId);
 const saved=[...memory.values()].join('');assert.ok(!saved.includes('connectorName'));assert.ok(!saved.includes('intervalMinutes'));
 await dialog.saveNewRoutine();assert.equal(posts,1);assert.ok(dialog.pendingRequest);
 await dialog.saveNewRoutine();assert.equal(posts,1);assert.ok(dialog.pendingRequest);assert.ok(store.read('routine').requestId);
 await dialog.saveNewRoutine();assert.equal(posts,1);assert.equal(dialog.pendingRequest,null);assert.equal(store.read('routine'),null);assert.equal(scheduler.entries.size,1);
});

test('Programmer possède un reçu distinct des demandes directes et se retrouve après rechargement sans compte ni horaire',async t=>{
 const{scheduler}=fixture(t),{store,memory}=drafts();let posts=0;
 const dialog=Object.assign(Object.create(SecretaryDialog.prototype),{epoch:1,draftStore:store,mode:'free',prompt:{value:basic.prompt},client:{value:'codex'},draftMessage:{},notice:{},refresh:async()=>{},poll(){},request:async(url,options)=>{
  if(options?.method==='POST'){posts++;scheduler.create(JSON.parse(options.body));throw new Error('Réponse perdue simulée');}
  return scheduler.lookupRequest(url.split('/').at(-1));
 }});
 const controller=new AbortController();await assert.rejects(dialog.programRoutine({...basic,assistant:true,assistantMode:'free'},{controller,epoch:1}),/perdue/);
 assert.equal(posts,1);assert.ok(dialog.pendingRoutine);assert.equal(dialog.pendingRequest,undefined);
 const draft=store.read('secretary');assert.equal(draft.requestKind,'routine');assert.ok(draft.requestId&&draft.requestHash);
 const raw=[...memory.values()].join('');assert.ok(!raw.includes('connectorName'));assert.ok(!raw.includes('intervalMinutes'));
 const restored=Object.assign(Object.create(SecretaryDialog.prototype),{epoch:1,draftStore:store,mode:'mail',drafts:{},prompt:{},client:{},draftMessage:{},notice:{},refresh:async()=>{},poll(){},request:dialog.request});
 restored.restoreDraft();assert.ok(restored.pendingRoutine);assert.equal(restored.pendingRequest,undefined);
 await restored.programRoutine(undefined,{controller:new AbortController(),epoch:1});assert.equal(posts,1);assert.equal(scheduler.entries.size,1);assert.equal(restored.pendingRoutine,null);assert.equal(store.read('secretary'),null);
});

test('les nouveaux messages de reprise et de longueur ont leurs traductions',()=>{
 for(const message of ['Cette routine a été supprimée. Commencez une nouvelle demande pour en créer une autre.','Le registre des routines supprimées est plein. Attendez l’expiration de ses reçus avant de supprimer une autre routine.','Le brief de cette routine est trop long avec les consignes de lecture. Raccourcissez-le avant de l’enregistrer.','L’identifiant de reprise de cette routine n’est pas valide.','Cette demande de routine a changé. Commencez une nouvelle demande pour utiliser ce contexte.','Cette demande de routine attend sa confirmation. Retrouvez-la ou commencez une nouvelle demande.','Aucune routine acceptée n’a été retrouvée. Commencez une nouvelle demande pour choisir son rythme et son service.'])for(const locale of ['en','nl'])assert.notEqual(translate(message,locale),message);
});
