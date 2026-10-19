import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Atelier } from '../lib/orchestrator.mjs';
import { Automations } from '../lib/automations.mjs';
import { createAtelierServer } from '../server.mjs';

const providers = [{ id:'codex', available:true, auth:{ loggedIn:true, method:'chatgpt' } }, { id:'claude', available:true, auth:{ loggedIn:true, method:'subscription' } }];
const reply = { title:'Un déjeuner à préparer', answer:'# Votre réponse\n\nUne proposition précise avec ses limites.' };
const review = { approved:true, feedback:'La réponse est proportionnée et explicite ses limites.' };
function setup(t, runner, options={}) {
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-direct-assistant-'));
  const engine=new Atelier({dataDir,runAgent:runner,providers:structuredClone(providers),...options});
  t.after(async()=>{for(const id of engine.runs.keys())engine.stop(id);await Promise.all([...engine.runs.keys()].map(id=>engine.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
  return engine;
}
async function httpSetup(t, options={}) {
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-direct-http-'));
  const app=await createAtelierServer({port:0,dataDir,providers:structuredClone(providers),...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const send=(body,extra={})=>fetch(base+'/api/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...extra},body:JSON.stringify(body)});
  return {app,base,send};
}

test('fermer une demande pendant la vérification du compte ne crée aucune mission tardive',async t=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});const waiting=new Promise(resolve=>{release=resolve;});let calls=0;
  const{app,base}=await httpSetup(t,{runner:async()=>{calls++;return{text:JSON.stringify(reply)};},connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async({client,name})=>{entered();await waiting;return{client,name,type:'gmail',source:'mcp',enabledTools:['read']};},close:async()=>{release();}})});
  const controller=new AbortController(),pending=fetch(base+'/api/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify({mode:'mail',prompt:'Fais le point.',provider:'codex',connectorName:'mail'}),signal:controller.signal}).catch(()=>{});
  await started;controller.abort();await pending;await new Promise(resolve=>setTimeout(resolve,20));release();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(app.engine.missions.size,0);assert.equal(calls,0);
});

test('une question directe utilise Zoé puis Oscar sans plan, spécialistes ou routine et conserve les vrais fichiers',async t=>{
  const calls=[];const engine=setup(t,async input=>{calls.push(input);return{text:JSON.stringify(input.schema.properties.answer?reply:review)};});
  const started=engine.start({prompt:'Aide-moi à préparer mon déjeuner.',provider:'codex'},{assistant:true,assistantMode:'free'});
  const done=await engine.wait(started.id);
  assert.equal(done.status,'completed');assert.equal(done.assistant,true);assert.equal(done.assistantMode,'free');assert.deepEqual(done.tasks,[]);assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.readOnly===true));assert.ok(calls.every(call=>call.connectorPlan===undefined));assert.ok(calls.every(call=>!call.schema.properties.tasks));
  assert.equal(readFileSync(path.join(engine.workDir(done.id),'Livraison.md'),'utf8'),reply.answer);
  assert.equal(readFileSync(path.join(engine.workDir(done.id),'Livraison','Reponse-Zoe.md'),'utf8'),reply.answer);
  assert.ok(done.events.some(e=>e.who==='Zoé'));assert.ok(done.events.some(e=>e.who==='Oscar'&&e.kind==='review'));assert.equal(engine.state().missions[0].assistant,true);
});

test('Oscar obtient une correction unique puis livre seulement après une nouvelle validation',async t=>{
  let checks=0,answers=0;const prompts=[];
  const engine=setup(t,async input=>{prompts.push(input.prompt);return{text:JSON.stringify(input.schema.properties.answer?{...reply,answer:++answers===1?'Premier résultat incomplet':'Réponse corrigée et sourcée'}:{approved:++checks===2,feedback:checks===1?'Précise les horaires et leur source.':'Les limites sont précisées.'})};});
  const started=engine.start({prompt:'Trouver une adresse publique.'},{assistant:true});const done=await engine.wait(started.id);
  assert.equal(done.status,'completed');assert.equal(answers,2);assert.equal(checks,2);assert.equal(done.assistantAttempt,2);assert.match(prompts[2],/Précise les horaires et leur source/);
  assert.equal(readFileSync(path.join(engine.workDir(done.id),'Livraison','Reponse-Zoe.md'),'utf8'),'Premier résultat incomplet');
  assert.equal(readFileSync(path.join(engine.workDir(done.id),'Livraison','Reponse-Zoe-corrigee.md'),'utf8'),'Réponse corrigée et sourcée');
});

test('deux refus conservent la réponse avec son avertissement et ne deviennent pas une réussite',async t=>{
  let calls=0;const engine=setup(t,async({schema})=>{calls++;return{text:JSON.stringify(schema.properties.answer?reply:{approved:false,feedback:'Les adresses ne sont pas étayées.'})};});
  const started=engine.start({prompt:'Des restaurants vérifiés.'},{assistant:true});const done=await engine.wait(started.id);
  assert.equal(calls,4);assert.equal(done.status,'needs_review');assert.match(done.result,/Les adresses ne sont pas étayées/);assert.match(readFileSync(path.join(engine.workDir(done.id),'Livraison.md'),'utf8'),/^# Réponse à vérifier/);
});

test('une erreur de contrôle conserve la réponse partielle avec un statut fidèle',async t=>{
  const engine=setup(t,async({schema})=>{if(schema.properties.approved)throw new Error('Le moteur est indisponible.');return{text:JSON.stringify(reply)};});
  const started=engine.start({prompt:'Une réponse utile.'},{assistant:true});const done=await engine.wait(started.id);
  assert.equal(done.status,'failed');assert.equal(done.result,reply.answer);assert.ok(done.files.some(file=>file.path==='Livraison/Reponse-Zoe.md'));assert.equal(done.finalReview,undefined);
});

test('les demandes directes partagent la limite de quatre missions et leur arrêt reste indépendant',async t=>{
  const startedSignals=[];const engine=setup(t,({signal})=>new Promise((_,reject)=>{startedSignals.push(signal);signal.addEventListener('abort',()=>reject(new Error('Arrêt demandé')),{once:true});}));
  const missions=Array.from({length:4},(_,i)=>engine.start({prompt:`Question ${i}`},{assistant:true}));
  assert.throws(()=>engine.start({prompt:'Une cinquième'},{assistant:true}),{code:'MISSION_CAPACITY'});
  await new Promise(resolve=>setImmediate(resolve));engine.stop(missions[0].id);assert.equal((await engine.wait(missions[0].id)).status,'cancelled');assert.equal(startedSignals[0].aborted,true);assert.equal(startedSignals[1].aborted,false);
});

test('assistant et le plan de lecture ne peuvent pas être activés dans le corps ordinaire de start',async t=>{
  const engine=setup(t,async()=>{throw new Error('Arrêt de test');});
  const started=engine.start({prompt:'Une mission normale',assistant:true,connectorPlan:{fake:true}});await engine.wait(started.id);
  assert.equal(started.assistant,undefined);assert.equal(engine.get(started.id).assistant,undefined);
});

test('la route libre ne demande aucun connecteur, ne crée aucune routine et utilise le moteur choisi',async t=>{
  let resolutions=0;const seen=[];const {app,send}=await httpSetup(t,{connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async()=>{resolutions++;throw new Error('Aucun connecteur ne doit être résolu.');},close:async()=>{}}),runner:async input=>{seen.push(input);return{text:JSON.stringify(input.schema.properties.answer?reply:review)};}});
  const response=await send({mode:'free',prompt:'Que puis-je préparer pour déjeuner ?',provider:'claude'});assert.equal(response.status,202,await response.clone().text());const started=await response.json();const done=await app.engine.wait(started.id);
  assert.equal(done.assistant,true);assert.equal(done.provider,'claude');assert.equal(done.status,'completed');assert.equal(resolutions,0);assert.equal(app.automations.state().automations.length,0);assert.equal(seen.length,2);assert.ok(seen.every(call=>call.connectorPlan===undefined&&call.readOnly));
  for(const bad of [{mode:'free',prompt:'Une question',provider:'claude',connectorName:'gmail'},{mode:'free',prompt:'Une question',provider:'claude',connectorPlan:{type:'gmail'}},{mode:'free',prompt:'Une question',provider:'demo'},{mode:'unknown',prompt:'Une question',provider:'codex'}])assert.equal((await send(bad)).status,400);
});

test('Mails et Agenda gardent l’identité du plan existant résolu côté serveur et refusent le mauvais service',async t=>{
  const plans=[],calls=[];const {app,send}=await httpSetup(t,{connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async({client,name})=>{const value=Object.freeze({client,name,type:name==='mail'?'gmail':'calendar',source:'mcp',enabledTools:['read']});plans.push(value);return value;},close:async()=>{}}),runner:async input=>{calls.push(input);return{text:JSON.stringify(input.schema.properties.answer?reply:review)};}});
  for(const [mode,connectorName]of [['mail','mail'],['calendar','agenda']]){const response=await send({mode,prompt:'Préparer une synthèse locale.',provider:'codex',connectorName});assert.equal(response.status,202);const started=await response.json();await app.engine.wait(started.id);assert.equal(app.engine.get(started.id).status,'completed');assert.equal(calls.at(-1).connectorPlan,undefined,'Oscar vérifie la réponse locale sans accès au compte');assert.equal(calls.at(-2).connectorPlan,plans.at(-1));}
  const count=calls.length;assert.equal((await send({mode:'mail',prompt:'Lire les messages.',provider:'codex',connectorName:'agenda'})).status,400);assert.equal(calls.length,count);assert.equal(app.automations.state().automations.length,0);
  assert.equal((await send({mode:'mail',prompt:'Lire les messages.',provider:'codex'})).status,400);
});

test('la route vérifie abonnement, préparation concurrente et protections locales avant tout départ',async t=>{
  let resolutions=0,calls=0;let app;const fixture=await httpSetup(t,{runner:async()=>{calls++;throw new Error('Aucun départ attendu');},connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async({client,name})=>{resolutions++;app.engine.logins.codex={status:'connecting'};return{client,name,type:'gmail',enabledTools:['read']};},close:async()=>{}})});app=fixture.app;
  const free={mode:'free',prompt:'Une question publique.',provider:'codex'};
  assert.equal((await fixture.send(free,{Origin:'https://external.invalid'})).status,403);assert.equal(calls,0);
  app.engine.providers[0].auth.method='api';assert.equal((await fixture.send(free)).status,400);app.engine.providers[0].auth.method='chatgpt';
  app.engine.logins.codex={status:'installing'};assert.equal((await fixture.send(free)).status,409);app.engine.logins={};
  assert.equal((await fixture.send({mode:'mail',prompt:'Lire les messages.',provider:'codex',connectorName:'mail'})).status,409);assert.equal(resolutions,1);assert.equal(calls,0);assert.equal(app.engine.missions.size,0);
});

test('seul Programmer crée une vraie routine Zoé qui utilise ensuite son parcours direct',async t=>{
  const engine=setup(t,async({schema})=>({text:JSON.stringify(schema.properties.answer?reply:review)}));const automations=new Automations({engine});t.after(()=>automations.close());
  const routine=automations.create({label:'Zoé — Une idée du matin',prompt:'Proposer une idée de repas.',provider:'codex',assistant:true,assistantMode:'free',schedule:{frequency:'daily',time:'08:00'}});
  const launched=await automations.run(routine.id);const done=await engine.wait(launched.lastMissionId);assert.equal(done.assistant,true);assert.deepEqual(done.tasks,[]);assert.equal(done.status,'completed');assert.equal(automations.state().automations.length,1);
  assert.throws(()=>automations.create({label:'Mails',prompt:'Un point mails.',provider:'codex',assistant:true,assistantMode:'mail',schedule:{frequency:'daily',time:'08:00'}}));
});

test('une ancienne routine Gmail ou Agenda utilise directement Zoé et ne perd aucun appel dans une planification',async t=>{
  const calls=[];const engine=setup(t,async input=>{calls.push(input);return{text:JSON.stringify(input.schema.properties.answer?reply:review)};});
  const automations=new Automations({engine,resolveConnectorPlan:async({client,name})=>({client,name,type:name,enabledTools:['read']})});t.after(()=>automations.close());
  for(const type of ['gmail','calendar']){
    const entry=automations.create({label:'Ancienne routine '+type,prompt:'Prépare un point de lecture.',provider:'codex',requiresConnector:true,connectorName:type,schedule:{frequency:'daily',time:'08:00'}});
    assert.equal(entry.assistant,undefined);const launched=await automations.run(entry.id),done=await engine.wait(launched.lastMissionId);
    assert.equal(done.assistant,true);assert.equal(done.assistantMode,type==='gmail'?'mail':'calendar');assert.equal(done.status,'completed');assert.deepEqual(done.tasks,[]);
    assert.equal(calls.at(-2).connectorPlan.type,type);assert.equal(calls.at(-1).connectorPlan,undefined);assert.ok(!calls.at(-2).schema.properties.tasks);
  }
});

test('une réponse HTTP perdue se récupère avec le même identifiant sans consommer un deuxième travail',async t=>{
 let calls=0;const {app,send}=await httpSetup(t,{runner:async({schema})=>{calls++;return{text:JSON.stringify(schema.properties.answer?reply:review)};}});
 const body={mode:'free',prompt:'Une question publique.',provider:'codex',requestId:'request_12345678'};
 const first=await(await send(body)).json();await app.engine.wait(first.id);
 app.engine.providers[0].auth.loggedIn=false;
 const retry=await send(body);assert.equal(retry.status,202);assert.equal((await retry.json()).id,first.id);assert.equal(app.engine.missions.size,1);assert.equal(calls,2);
 const collision=await send({...body,prompt:'Un autre contenu'});assert.equal(collision.status,409);assert.equal(calls,2);
 assert.deepEqual(Object.keys(app.engine.get(first.id).secretaryRequest).sort(),['fingerprint','id']);
});

test('le verrou de requête précède la vérification du service : deux clics simultanés ne lancent qu’une lecture',async t=>{
 let entered,release,resolutions=0,calls=0;const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
 const {app,send}=await httpSetup(t,{runner:async({schema})=>{calls++;return{text:JSON.stringify(schema.properties.answer?reply:review)};},connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async({client,name})=>{resolutions++;entered();await waiting;return{client,name,type:'gmail',enabledTools:['read']};},close:async()=>{release();}})});
 const body={mode:'mail',prompt:'Préparer un point messages.',provider:'codex',connectorName:'mail',requestId:'request_parallel_123'};
 const first=send(body);await started;const second=send(body),changed=await send({...body,provider:'claude'});assert.equal(changed.status,409);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(resolutions,1);release();
 const [one,two]=await Promise.all([first,second]);assert.equal(one.status,202);assert.equal(two.status,202);const a=await one.json(),b=await two.json();assert.equal(a.id,b.id);await app.engine.wait(a.id);assert.equal(calls,2);assert.equal(app.engine.missions.size,1);
});

test('la quittance de requête est écrite avant l’appel modèle et survit au redémarrage',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-secretary-receipt-'));let calls=0,firstApp,secondApp;
 t.after(async()=>{if(firstApp)await firstApp.close();if(secondApp)await secondApp.close();rmSync(dataDir,{recursive:true,force:true});});
 const start=async()=>{const app=await createAtelierServer({port:0,dataDir,providers:structuredClone(providers),runner:async({schema,cwd})=>{calls++;const persisted=JSON.parse(readFileSync(path.join(cwd,'..','state.json'),'utf8'));assert.equal(persisted.secretaryRequest.id,'request_durable_123');return{text:JSON.stringify(schema.properties.answer?reply:review)};}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return app;};
 const post=(app,body)=>fetch(`http://127.0.0.1:${app.server.address().port}/api/secretary`,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body)});
 const body={mode:'free',prompt:'Une demande récupérable.',provider:'codex',requestId:'request_durable_123'};
 firstApp=await start();const first=await(await post(firstApp,body)).json();await firstApp.engine.wait(first.id);assert.equal(calls,2);await firstApp.close();firstApp=null;
 secondApp=await start();const response=await post(secondApp,body);assert.equal(response.status,202);assert.equal((await response.json()).id,first.id);assert.equal(calls,2);
});

test('une panne de première sauvegarde ne laisse ni place occupée, ni appel modèle, ni faux reçu',async t=>{
 let calls=0;const {app,send}=await httpSetup(t,{runner:async({schema})=>{calls++;return{text:JSON.stringify(schema.properties.answer?reply:review)};}});
 const original=app.engine.save;app.engine.save=()=>{throw new Error('Disque momentanément indisponible');};
 const body={mode:'free',prompt:'La demande à conserver.',provider:'codex',requestId:'request_disk_123'};
 assert.equal((await send(body)).status,400);assert.equal(app.engine.missions.size,0);assert.equal(app.engine.runs.size,0);assert.equal(calls,0);assert.equal(app.engine.state().activeMissions.length,0);
 app.engine.save=original;const retry=await send(body);assert.equal(retry.status,202);const mission=await retry.json();await app.engine.wait(mission.id);assert.equal(calls,2);assert.equal(app.engine.missions.size,1);
});

test('une vraie erreur de disque pendant le premier état conserve les autres missions et les données partielles privées',async t=>{
 let calls=0;const engine=setup(t,async({schema})=>{calls++;return{text:JSON.stringify(schema.properties.answer?reply:review)};});
 const save=engine.save;let interrupted=false;engine.save=function(mission){if(!interrupted){interrupted=true;mkdirSync(path.join(this.missionDir(mission.id),'state.json.tmp'),{mode:0o700});}return save.call(this,mission);};
 assert.throws(()=>engine.start({prompt:'Une demande avec erreur de disque.',provider:'codex'},{assistant:true,secretaryRequest:{id:'request_private_disk',fingerprint:'a'.repeat(64)}}));
 assert.equal(engine.runs.size,0);assert.equal(engine.missions.size,0);assert.equal(calls,0);
 const folders=(await import('node:fs')).readdirSync(path.join(engine.dataDir,'missions'));assert.equal(folders.length,1);assert.equal(statSync(path.join(engine.dataDir,'missions',folders[0])).mode&0o777,0o700);assert.equal(statSync(path.join(engine.dataDir,'missions',folders[0],'state.json.tmp')).mode&0o777,0o700);
 engine.save=save;const next=engine.start({prompt:'Une autre demande peut encore démarrer.',provider:'codex'},{assistant:true});assert.equal((await engine.wait(next.id)).status,'completed');assert.equal(calls,2);
});

test('annuler avant le départ libère le verrou : la même demande peut être réessayée une fois',async t=>{
 let entered,release,resolutions=0,calls=0;const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
 const{app,base,send}=await httpSetup(t,{runner:async({schema})=>{calls++;return{text:JSON.stringify(schema.properties.answer?reply:review)};},connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async({client,name})=>{if(++resolutions===1){entered();await waiting;}return{client,name,type:'gmail',enabledTools:['read']};},close:async()=>release()})});
 const body={mode:'mail',prompt:'Une synthèse de lecture simulée.',provider:'codex',connectorName:'mail',requestId:'request_abort_retry'};
 const controller=new AbortController(),pending=fetch(base+'/api/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body),signal:controller.signal}).catch(()=>{});await started;controller.abort();await pending;await new Promise(resolve=>setTimeout(resolve,15));release();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(app.engine.missions.size,0);assert.equal(calls,0);
 const response=await send(body);assert.equal(response.status,202);const mission=await response.json();await app.engine.wait(mission.id);assert.equal(app.engine.missions.size,1);assert.equal(calls,2);assert.equal(resolutions,2);
});

test('seul un reçu interne valide peut être persisté, aucun plan de lecture HTTP ne passe avec requestId',async t=>{
 let calls=0;const {app,send}=await httpSetup(t,{runner:async()=>{calls++;throw new Error('Aucun départ attendu');}});
 const body={mode:'free',prompt:'Une demande publique.',provider:'codex',requestId:'request_valid_123'};
 for(const requestId of ['short','../outside','x'.repeat(101),123,null])assert.equal((await send({...body,requestId})).status,400);
 for(const key of ['connectorPlan','secretaryRequest','enabledTools','url'])assert.equal((await send({...body,[key]:{id:'request_internal',fingerprint:'a'.repeat(64)}})).status,400);
 assert.throws(()=>app.engine.start({prompt:'Un reçu invalide.'},{assistant:true,secretaryRequest:{id:'request_valid_123',fingerprint:'a'.repeat(64),tools:['send']}}));
 const external=app.engine.start({prompt:'Le reçu HTTP est ignoré.',provider:'codex',secretaryRequest:{id:'request_valid_123',fingerprint:'a'.repeat(64)}},{assistant:true});await app.engine.wait(external.id);assert.equal(app.engine.get(external.id).secretaryRequest,undefined);assert.equal(calls,1);
});

test('Mes services transmet le plan Drive confirmé uniquement à Zoé et reprend sans nouvel appel',async t=>{
 const name='chatgpt-connector_'+ 'a'.repeat(80),plan=Object.freeze({client:'codex',name,type:'app',source:'chatgpt',appId:'connector_drive_example',displayName:'Google Drive',enabledTools:Object.freeze(['search_files'])}),calls=[];
 const{app,send}=await httpSetup(t,{connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async()=>plan,close:async()=>{}}),runner:async input=>{calls.push(input);return{text:JSON.stringify(input.schema.properties.answer?reply:review)};}});
 const body={mode:'service',prompt:'Retrouve le document utile dans le service choisi.',provider:'codex',connectorName:name,requestId:'service_request_12345678'};
 const response=await send(body);assert.equal(response.status,202,await response.clone().text());const started=await response.json(),done=await app.engine.wait(started.id);
 assert.equal(done.status,'completed');assert.equal(done.assistantMode,'service');assert.deepEqual(done.tasks,[]);assert.equal(calls.length,2);assert.equal(calls[0].connectorPlan,plan);assert.equal(calls[1].connectorPlan,undefined);assert.ok(calls.every(call=>call.readOnly));assert.match(calls[0].prompt,/app:\/\/connector_drive_example/);
 assert.equal(app.automations.state().automations.length,0);const replay=await send(body);assert.equal((await replay.json()).id,started.id);assert.equal(calls.length,2);
 for(const bad of [{...body,mode:'mail'},{...body,mode:'calendar'},{...body,mode:'free'},{...body,connectorName:'a'.repeat(121)},{...body,enabledTools:['send']},{...body,connectorPlan:{...plan}}])assert.equal((await send({...bad,requestId:undefined})).status,400);
 assert.equal(calls.length,2);
});

test('une routine Mes services réutilise Drive en lecture, survit au rechargement et ne se lance pas à sa création',async t=>{
 const name='chatgpt-connector_'+ 'b'.repeat(80),plan=Object.freeze({client:'codex',name,type:'app',source:'chatgpt',appId:'connector_drive_example',displayName:'Google Drive',enabledTools:Object.freeze(['search_files'])}),calls=[];
 const engine=setup(t,async input=>{calls.push(input);return{text:JSON.stringify(input.schema.properties.answer?reply:review)};});
 const scheduler=new Automations({engine,dataDir:engine.dataDir,resolveConnectorPlan:async()=>plan});t.after(()=>scheduler.close());
 const created=scheduler.create({label:'Point documents',prompt:'Prépare une synthèse des fichiers utiles.',provider:'codex',assistant:true,assistantMode:'service',requiresConnector:true,connectorName:name,schedule:{frequency:'daily',time:'09:15'}});
 assert.equal(calls.length,0);const restored=new Automations({engine,dataDir:engine.dataDir,resolveConnectorPlan:async()=>plan});t.after(()=>restored.close());assert.equal(restored.get(created.id).assistantMode,'service');assert.equal(restored.get(created.id).connectorName,name);assert.equal(restored.get(created.id).schedule.time,'09:15');
 const launched=await restored.run(created.id),done=await engine.wait(launched.lastMissionId);assert.equal(done.status,'completed');assert.equal(done.assistantMode,'service');assert.equal(calls[0].connectorPlan,plan);assert.equal(calls[1].connectorPlan,undefined);assert.equal(calls.length,2);
});
