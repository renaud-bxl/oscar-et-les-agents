import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {createAtelierServer} from '../server.mjs';
import {MissionRequests} from '../lib/mission-requests.mjs';
import {translate} from '../public/i18n.js';
const providers=[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}},{id:'claude',available:true,auth:{loggedIn:true,method:'subscription'}}];
async function setup(t,options={}){
 const dataDir=options.dataDir||mkdtempSync(path.join(os.tmpdir(),'oscar-mission-request-'));let calls=0;
 const app=await createAtelierServer({port:0,dataDir,providers:structuredClone(providers),runner:async()=>{calls++;throw new Error('Arrêt simulé sans appel externe');},demoDelay:0,...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 let closed=false;const close=async()=>{if(!closed){closed=true;await app.close();}};t.after(async()=>{await close();if(!options.keepDirectory)rmSync(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`,send=(body,options={})=>fetch(base+'/api/missions',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body),...options});
 return{app,dataDir,base,send,close,calls:()=>calls};
}
const body={prompt:'Une mission à lancer une seule fois.',provider:'codex',requestId:'mission_request_123'};

test('retrouver un reçu est une lecture sans moteur, sans fichiers ni nouvelle mission',async t=>{
 const{app,base,send,calls}=await setup(t),lookup=(id,options)=>fetch(base+'/api/mission-requests/'+id,options);
 assert.equal((await lookup(body.requestId)).status,404);assert.equal(calls(),0);
 const first=await(await send(body)).json();await app.engine.wait(first.id);app.engine.providers=[];
 app.documents.readItem=async()=>{throw new Error('Une reprise ne relit pas les exemples');};
 const response=await lookup(body.requestId);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const found=await response.json();assert.equal(found.status,'accepted');assert.equal(found.mission.id,first.id);assert.equal(found.mission.status,'failed');assert.equal(calls(),1);assert.equal(app.engine.missions.size,1);
 assert.equal((await lookup('short')).status,400);assert.equal((await lookup(body.requestId+'?provider=claude')).status,400);assert.equal((await lookup(body.requestId,{headers:{Origin:'https://external.invalid'}})).status,403);assert.equal(calls(),1);
});

test('le reçu en précontrôle reste en vérification et ne démarre pas un second travail',async t=>{
 const{app,base,send,calls}=await setup(t),reference=await app.documents.import({name:'Exemple.md',base64:Buffer.from('Exemple local').toString('base64')});
 const original=app.documents.readItem.bind(app.documents);let entered,release;const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
 app.documents.readItem=async(...args)=>{entered();await waiting;return original(...args);};
 const pending=send({...body,referenceIds:[reference.id]});await started;
 const response=await fetch(base+'/api/mission-requests/'+body.requestId);assert.equal(response.status,202);assert.deepEqual(await response.json(),{status:'checking'});assert.equal(calls(),0);assert.equal(app.engine.missions.size,0);
 release();const first=await(await pending).json();await app.engine.wait(first.id);
 const found=await(await fetch(base+'/api/mission-requests/'+body.requestId)).json();assert.equal(found.mission.id,first.id);assert.equal(calls(),1);assert.equal(app.engine.missions.size,1);
});

test('réessayer la même mission retrouve son état terminal sans quota ni revalidation du moteur',async t=>{
 const{app,send,calls}=await setup(t);const first=await(await send({requestId:body.requestId,prompt:'  '+body.prompt+'  '})).json();await app.engine.wait(first.id);assert.equal(app.engine.get(first.id).status,'failed');assert.equal(calls(),1);
 app.engine.providers=[];app.engine.logins.codex={status:'connecting'};app.connectors.active.set('codex',{controller:new AbortController(),completion:Promise.resolve()});
 const retry=await send({...body,locale:'fr',references:[],referenceIds:[],outputFormats:[],templateId:null,templateRevision:null});assert.equal(retry.status,202);assert.equal((await retry.json()).id,first.id);assert.equal(calls(),1);assert.equal(app.engine.missions.size,1);
 const saved=JSON.parse(readFileSync(path.join(app.engine.missionDir(first.id),'state.json'),'utf8'));assert.equal(saved.missionRequest.id,body.requestId);assert.match(saved.missionRequest.fingerprint,/^[a-f0-9]{64}$/u);assert.equal(saved.secretaryRequest,undefined);
});

test('toutes les composantes du contenu canonique refusent une collision avant de lire les exemples',async t=>{
 const{app,send,calls}=await setup(t);const first=await(await send(body)).json();await app.engine.wait(first.id);let reads=0;app.documents.readItem=async()=>{reads++;throw new Error('Aucune lecture attendue');};
 for(const update of [{prompt:'Une autre mission'},{provider:'claude'},{referenceIds:['a'.repeat(24)]},{references:[{id:'a'.repeat(24),revision:'b'.repeat(64)}]},{outputFormats:['pdf']},{templateId:'a'.repeat(24)},{templateId:'a'.repeat(24),templateRevision:'b'.repeat(64)},{locale:'nl'}])assert.equal((await send({...body,...update})).status,409,JSON.stringify(update));
 assert.equal(reads,0);assert.equal(calls(),1);assert.equal(app.engine.missions.size,1);
});

test('le verrou précède l’attente sur les références et une modification ultérieure du fichier ne relance rien',async t=>{
 const{app,send,calls}=await setup(t);const reference=await app.documents.import({name:'Exemple.md',base64:Buffer.from('Source initiale').toString('base64')});const original=app.documents.readItem.bind(app.documents);let entered,release,reads=0;const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
 app.documents.readItem=async(...args)=>{reads++;if(reads===1){entered();await waiting;}return original(...args);};
 const input={...body,references:[{revision:reference.revision,id:reference.id}],locale:'nl'};
 const first=send(input);await started;const second=send({requestId:body.requestId,locale:'nl',references:[{id:reference.id,revision:reference.revision}],provider:'codex',prompt:body.prompt});const collision=await send({...input,prompt:'Un autre brief'});assert.equal(collision.status,409);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(reads,1);release();
 const a=await(await first).json(),b=await(await second).json();assert.equal(a.id,b.id);await app.engine.wait(a.id);assert.equal(calls(),1);
 writeFileSync(path.join(app.documents.directory,reference.name),'Source modifiée par la personne');const before=reads;const retry=await send(input);assert.equal(retry.status,202);assert.equal((await retry.json()).id,a.id);assert.equal(reads,before);assert.equal(calls(),1);
});

test('une requête fermée pendant le précontrôle ne démarre pas tardivement et libère sa clé',async t=>{
 const{app,send,calls}=await setup(t);const reference=await app.documents.import({name:'Exemple.md',base64:Buffer.from('Source').toString('base64')});const original=app.documents.readItem.bind(app.documents);let entered,release,reads=0;const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
 app.documents.readItem=async(...args)=>{if(++reads===1){entered();await waiting;}return original(...args);};const input={...body,referenceIds:[reference.id]};
 const controller=new AbortController(),pending=send(input,{signal:controller.signal}).catch(()=>{});await started;controller.abort();await pending;await new Promise(resolve=>setTimeout(resolve,15));release();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(app.engine.missions.size,0);assert.equal(calls(),0);
 const result=await send(input);assert.equal(result.status,202);const mission=await result.json();await app.engine.wait(mission.id);assert.equal(calls(),1);assert.equal(app.engine.missions.size,1);
});

test('un changement de préparation du moteur pendant le précontrôle bloque le départ puis permet de réessayer',async t=>{
 const{app,send,calls}=await setup(t);const reference=await app.documents.import({name:'Exemple.md',base64:Buffer.from('Source').toString('base64')}),original=app.documents.readItem.bind(app.documents);let once=true;app.documents.readItem=async(...args)=>{if(once){once=false;app.engine.logins.codex={status:'installing'};}return original(...args);};
 const input={...body,referenceIds:[reference.id]};assert.equal((await send(input)).status,409);assert.equal(calls(),0);assert.equal(app.engine.missions.size,0);app.engine.logins={};const response=await send(input);assert.equal(response.status,202);await app.engine.wait((await response.json()).id);assert.equal(calls(),1);
});

test('le reçu est durable avant le premier modèle et se retrouve après un redémarrage sans fournisseur',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-mission-durable-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let calls=0;
 const first=await setup(t,{dataDir,keepDirectory:true,runner:async({cwd})=>{calls++;const saved=JSON.parse(readFileSync(path.join(cwd,'..','state.json'),'utf8'));assert.equal(saved.missionRequest.id,body.requestId);throw new Error('Modèle simulé');}});const mission=await(await first.send(body)).json();await first.app.engine.wait(mission.id);await first.close();
 const second=await setup(t,{dataDir,keepDirectory:true,providers:[],runner:async()=>{calls++;throw new Error('Ne doit pas redémarrer');}});second.app.documents.readItem=async()=>{throw new Error('Aucun précontrôle supplémentaire attendu');};const retry=await second.send(body);assert.equal(retry.status,202);assert.equal((await retry.json()).id,mission.id);assert.equal(calls,1);await second.close();
});

test('une vraie panne de première écriture ne laisse ni place bloquée, ni reçu, ni appel modèle',async t=>{
 const{app,send,calls,dataDir}=await setup(t);const save=app.engine.save;let once=true;app.engine.save=function(mission){if(once){once=false;mkdirSync(path.join(this.missionDir(mission.id),'state.json.tmp'),{mode:0o700});}return save.call(this,mission);};
 assert.equal((await send(body)).status,400);assert.equal(app.engine.missions.size,0);assert.equal(app.engine.runs.size,0);assert.equal(calls(),0);const folders=readdirSync(path.join(dataDir,'missions'));assert.equal(folders.length,1);assert.equal(statSync(path.join(dataDir,'missions',folders[0])).mode&0o777,0o700);
 app.engine.save=save;const response=await send(body);assert.equal(response.status,202);await app.engine.wait((await response.json()).id);assert.equal(calls(),1);assert.equal(app.engine.missions.size,1);
});

test('sans clé deux appels créent deux missions, avec clé la démo reste unique et n’appelle aucun modèle',async t=>{
 const{app,send,calls}=await setup(t);const input={prompt:'Une démo séparée',provider:'demo'};const a=await(await send(input)).json(),b=await(await send(input)).json();await Promise.all([app.engine.wait(a.id),app.engine.wait(b.id)]);assert.notEqual(a.id,b.id);assert.equal(a.missionRequest,undefined);
 const one=await(await send({...input,requestId:'demo_request_123'})).json();await app.engine.wait(one.id);const two=await(await send({...input,requestId:'demo_request_123'})).json();assert.equal(one.id,two.id);assert.equal(calls(),0);assert.equal(app.engine.missions.size,3);
});

test('les capacités, reçus internes et identifiants invalides sont refusés avant tout départ HTTP',async t=>{
 const{app,send,calls}=await setup(t);
 for(const requestId of ['short','../../private','x'.repeat(101),123,null])assert.equal((await send({...body,requestId})).status,400);
 for(const key of ['missionRequest','secretaryRequest','connectorPlan','assistant','assistantMode','enabledTools','url'])assert.equal((await send({...body,[key]:{id:body.requestId,fingerprint:'a'.repeat(64)}})).status,400,key);
 assert.throws(()=>app.engine.start({prompt:'Un reçu invalide',provider:'codex'},{missionRequest:{id:body.requestId,fingerprint:'a'.repeat(64),enabledTools:['send']}}));
 assert.throws(()=>app.engine.start({prompt:'Un reçu Oscar dans Zoé',provider:'codex'},{assistant:true,missionRequest:{id:body.requestId,fingerprint:'a'.repeat(64)}}));assert.equal(app.engine.missions.size,0);assert.equal(calls(),0);
 assert.equal((await send({...body,extra:'x'.repeat(100001)})).status,413);
});

test('les reçus Oscar et Zoé restent dans deux espaces indépendants',async t=>{
 const{app,send,base,calls}=await setup(t);const zoe=await fetch(base+'/api/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify({prompt:body.prompt,provider:'codex',mode:'free',requestId:body.requestId})});const a=await zoe.json();await app.engine.wait(a.id);const b=await(await send(body)).json();await app.engine.wait(b.id);assert.notEqual(a.id,b.id);assert.equal(app.engine.get(a.id).missionRequest,undefined);assert.equal(app.engine.get(b.id).secretaryRequest,undefined);assert.equal(calls(),2);
});

test('le registre borne les vérifications et le cache, puis retrouve un reçu évincé dans les missions persistées',()=>{
 const missions=new Map(),engine={missions,get:id=>missions.get(id)},registry=new MissionRequests({engine,maxPending:2,maxCached:2}),fingerprint='a'.repeat(64);
 const first=registry.begin('request_one',fingerprint),second=registry.begin('request_two',fingerprint);assert.equal(registry.pending.size,2);assert.ok(registry.begin('request_one',fingerprint).wait);assert.throws(()=>registry.begin('request_three',fingerprint),error=>error.code==='MISSION_REQUEST_RETRY');assert.throws(()=>registry.begin('request_one','b'.repeat(64)),error=>error.code==='MISSION_REQUEST_CHANGED');first.finish();second.finish();assert.equal(registry.pending.size,0);
 for(let index=0;index<3;index++){const id='request_'+index,mission={id:'mission_'+index,missionRequest:{id,fingerprint}};missions.set(mission.id,mission);registry.remember(id,{missionId:mission.id,fingerprint});}assert.equal(registry.receipts.size,2);assert.equal(registry.begin('request_0',fingerprint).mission.id,'mission_0');assert.equal(registry.receipts.size,2);
});

test('les explications de reprise des missions existent dans les trois langues du bureau',()=>{
 const messages=['Cette mission a changé depuis sa première validation. Lancez une nouvelle mission pour poursuivre.','La mission précédente ne peut plus être retrouvée. Vérifiez l’historique avant de la relancer.','Une mission différente utilise déjà cet identifiant. Attendez sa confirmation avant de réessayer.','Le bureau vérifie déjà plusieurs missions. Réessayez dans quelques instants.','L’identifiant de reprise de cette mission n’est pas valide.','L’identifiant interne de cette mission n’est pas valide.','Un paramètre de cette mission n’est pas reconnu. Utilisez les champs proposés dans le bureau.','La mission précédente n’a pas été lancée. Vous pouvez réessayer avec votre formulaire conservé.','Écris une mission entre 1 et 16 000 caractères.','Choisis un moteur disponible.'];for(const message of messages)for(const locale of ['en','nl'])assert.notEqual(translate(message,locale),message,`${locale}: ${message}`);
});
