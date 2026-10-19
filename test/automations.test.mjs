import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {Automations,validateAutomationSchedule,nextAutomationRun,previewAutomationRuns} from '../lib/automations.mjs';
import {Atelier} from '../lib/orchestrator.mjs';
const local=(y,m,d,h=0,min=0)=>new Date(y,m-1,d,h,min).getTime();
const basic={label:'Ma veille',prompt:'Prépare une veille sourcée et un rapport local.',provider:'codex',schedule:{frequency:'daily',time:'02:00'},enabled:true};
class FakeEngine extends EventEmitter{
 constructor(dataDir){super();this.dataDir=dataDir;this.providers=[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}},{id:'claude',available:true,auth:{loggedIn:true,method:'subscription'}}];this.logins={};this.missions=new Map();this.calls=[];this.externalActive=0;}
 state(){return{providers:this.providers,logins:this.logins,maxConcurrentMissions:4,activeMissions:[...this.missions.values()].filter(m=>['planning','running','reviewing'].includes(m.status)).concat(Array.from({length:this.externalActive},()=>({status:'running'})))};}
 start(body,options){const m={id:'mission-'+(this.calls.length+1),status:'running'};this.calls.push({body,options});this.missions.set(m.id,m);this.emit('change');return structuredClone(m);}
 get(id){return this.missions.get(id);}
 finish(id,status='completed'){this.missions.get(id).status=status;this.emit('change');}
}
function fixture(t,options={}){const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-automations-'));let clock=local(2026,10,19,1);const engine=new FakeEngine(dataDir);const scheduler=new Automations({engine,dataDir,now:()=>clock,...options});t.after(async()=>{await scheduler.close();rmSync(dataDir,{recursive:true,force:true});});return{scheduler,engine,dataDir,setNow:value=>{clock=value;},now:()=>clock};}

test('calendrier local : quotidien, jours ouvrés, hebdomadaire et intervalle toujours futurs',()=>{
 assert.equal(nextAutomationRun({frequency:'daily',time:'02:00'},local(2026,10,19,1)),local(2026,10,19,2));
 assert.equal(nextAutomationRun({frequency:'daily',time:'02:00'},local(2026,10,19,2)),local(2026,10,20,2));
 assert.equal(nextAutomationRun({frequency:'weekdays',time:'09:30'},local(2026,10,23,10)),local(2026,10,26,9,30));
 assert.equal(nextAutomationRun({frequency:'weekly',time:'08:00',dayOfWeek:0},local(2026,10,19)),local(2026,10,25,8));
 assert.equal(nextAutomationRun({frequency:'interval',intervalMinutes:15},1000),901000);
 for(const schedule of [{frequency:'hourly'},{frequency:'daily',time:'24:00'},{frequency:'daily',time:'2:00'},{frequency:'weekly',dayOfWeek:7},{frequency:'interval',intervalMinutes:0},{frequency:'interval',intervalMinutes:10081}])assert.throws(()=>validateAutomationSchedule(schedule));
});
test('Europe/Brussels : changement d’heure sans doublon et intervalles conservés en temps écoulé',()=>{
 const moduleURL=new URL('../lib/automations.mjs',import.meta.url).href;
 const program=`import {nextAutomationRun} from ${JSON.stringify(moduleURL)};const next=(schedule,after)=>new Date(nextAutomationRun(schedule,Date.parse(after))).toISOString();console.log(JSON.stringify({spring:next({frequency:'daily',time:'02:30'},'2026-03-29T00:10:00Z'),autumn:next({frequency:'daily',time:'02:30'},'2026-10-25T00:10:00Z'),afterFirst:next({frequency:'daily',time:'02:30'},'2026-10-25T00:45:00Z'),weekend:next({frequency:'weekdays',time:'08:30'},'2026-03-27T10:00:00Z'),interval:next({frequency:'interval',intervalMinutes:15},'2026-10-25T00:55:00Z')}));`;
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program],{env:{...process.env,TZ:'Europe/Brussels'},encoding:'utf8'}));
 assert.deepEqual(result,{spring:'2026-03-29T01:30:00.000Z',autumn:'2026-10-25T00:30:00.000Z',afterFirst:'2026-10-26T01:30:00.000Z',weekend:'2026-03-30T06:30:00.000Z',interval:'2026-10-25T01:10:00.000Z'});
});
test('persistance privée, modification, pause ; la création ne lance aucune mission',async t=>{
 const{scheduler,engine,dataDir,now}=fixture(t);const created=scheduler.create(basic);assert.equal(engine.calls.length,0);assert.equal(created.nextRunAt,local(2026,10,19,2));assert.equal(statSync(path.join(dataDir,'automations.json')).mode&0o777,0o600);
 assert.equal(scheduler.update(created.id,{enabled:false}).nextRunAt,null);assert.equal(scheduler.update(created.id,{enabled:true,schedule:{frequency:'interval',intervalMinutes:30}}).nextRunAt,now()+1800000);
 const copy=scheduler.state();copy.automations[0].prompt='CHANGED';assert.equal(scheduler.get(created.id).prompt,basic.prompt);
 const restored=new Automations({engine,dataDir,now});assert.equal(restored.state().automations[0].id,created.id);await restored.close();assert.deepEqual(scheduler.remove(created.id),{ok:true});
});
test('réveil après plusieurs jours : une seule occurrence, jamais une rafale de rattrapage',async t=>{
 const{scheduler,engine,setNow}=fixture(t);const created=scheduler.create(basic);setNow(local(2026,10,24,15));await scheduler.tick();assert.equal(engine.calls.length,1);assert.equal(scheduler.get(created.id).nextRunAt,local(2026,10,25,2));await scheduler.tick();assert.equal(engine.calls.length,1);assert.equal(scheduler.get(created.id).lastMissionId,'mission-1');engine.finish('mission-1');assert.equal(scheduler.get(created.id).status,'completed');assert.match(scheduler.get(created.id).message,/livraison/);
});
test('aucun chevauchement ; pause préserve la mission actuelle et son résultat visible',async t=>{
 const{scheduler,engine,setNow}=fixture(t);const a=scheduler.create({...basic,schedule:{frequency:'interval',intervalMinutes:15}});setNow(local(2026,10,19,2));await scheduler.tick();await assert.rejects(scheduler.run(a.id),e=>e.code==='AUTOMATION_BUSY');setNow(local(2026,10,19,3));await scheduler.tick();assert.equal(engine.calls.length,1);assert.match(scheduler.get(a.id).message,/ignorée/);scheduler.update(a.id,{enabled:false});assert.equal(scheduler.get(a.id).status,'running');assert.throws(()=>scheduler.remove(a.id),/attendez/);engine.finish('mission-1','needs_review');assert.equal(scheduler.get(a.id).status,'failed');assert.match(scheduler.get(a.id).message,/vérification/);assert.equal(scheduler.get(a.id).nextRunAt,null);
});
test('capacité quatre, abonnement déconnecté et panne moteur restent explicites sans faux succès',async t=>{
 const{scheduler,engine}=fixture(t);const a=scheduler.create(basic);engine.externalActive=4;let r=await scheduler.run(a.id);assert.equal(r.status,'busy');assert.equal(r.lastMissionId,null);assert.equal(engine.calls.length,0);engine.externalActive=0;engine.providers[0].auth.loggedIn=false;r=await scheduler.run(a.id);assert.equal(r.status,'needs_connection');assert.equal(engine.calls.length,0);engine.providers[0].auth.loggedIn=true;engine.start=()=>{throw new Error('RAW-OAUTH-SECRET');};r=await scheduler.run(a.id);assert.equal(r.status,'failed');assert(!JSON.stringify(r).includes('RAW-OAUTH'));assert.equal(r.lastRunAt,null);
});
test('mail sans connecteur actif : configuration requise et aucune lecture prétendue',async t=>{
 const{scheduler,engine}=fixture(t);const a=scheduler.create({...basic,requiresConnector:true});const r=await scheduler.run(a.id);assert.equal(r.status,'needs_configuration');assert.match(r.message,/Choisissez un service de lecture compatible/);assert.equal(engine.calls.length,0);
});

test('une routine avec service sélectionné est programmée, sans prétendre avoir vérifié ou lu le compte',async t=>{
 let resolutions=0;const{scheduler,engine,dataDir,now}=fixture(t,{resolveConnectorPlan:async()=>{resolutions++;throw new Error('Aucune lecture à la création');}});
 const entry=scheduler.create({...basic,requiresConnector:true,connectorName:'chatgpt-gmail'});assert.equal(entry.status,'scheduled');assert.match(entry.message,/seront vérifiés au prochain horaire/);assert.equal(resolutions,0);assert.equal(engine.calls.length,0);
 assert.equal(scheduler.update(entry.id,{label:'Mon point Gmail'}).status,'scheduled');assert.equal(resolutions,0);
 const copy=new Automations({engine,dataDir,now,resolveConnectorPlan:()=>{throw new Error();}});assert.equal(copy.get(entry.id).status,'scheduled');await copy.close();
 const paused=scheduler.update(entry.id,{enabled:false});assert.equal(paused.status,'paused');assert.equal(paused.nextRunAt,null);assert.match(paused.message,/en pause/);
 const missing=scheduler.create({...basic,requiresConnector:true,enabled:false});assert.equal(missing.status,'paused');assert.equal(scheduler.update(missing.id,{enabled:true}).status,'needs_configuration');
 const withoutResolver=new Automations({engine,dataDir,now});assert.equal(withoutResolver.get(entry.id).status,'paused');assert.equal(withoutResolver.get(missing.id).status,'needs_configuration');await withoutResolver.close();
});

test('une autorisation refusée reste à configurer au redémarrage, et la pause reste prioritaire',async t=>{
 const{scheduler,engine,dataDir,now}=fixture(t,{resolveConnectorPlan:async()=>{throw new Error('PRIVATE-SCOPE');}});const entry=scheduler.create({...basic,requiresConnector:true,connectorName:'gmail'});const failed=await scheduler.run(entry.id);assert.equal(failed.status,'needs_configuration');assert.match(failed.message,/n’est pas disponible/);assert.doesNotMatch(failed.message,/PRIVATE-SCOPE/);assert.equal(engine.calls.length,0);
 const restored=new Automations({engine,dataDir,now,resolveConnectorPlan:async()=>{throw new Error();}});assert.equal(restored.get(entry.id).status,'needs_configuration');assert.match(restored.get(entry.id).message,/n’est pas disponible/);assert.equal(restored.update(entry.id,{enabled:false}).status,'paused');await restored.close();
});

test('trois horaires se préparent côté serveur sans enregistrer, vérifier un compte ni lancer une mission',async t=>{
 let resolutions=0;const{scheduler,engine,now}=fixture(t,{resolveConnectorPlan:async()=>{resolutions++;throw new Error();}});
 const result=scheduler.preview({schedule:{frequency:'interval',intervalMinutes:60}});assert.deepEqual(result.nextRuns,[now()+3600000,now()+7200000,now()+10800000]);assert.equal(result.generatedAt,now());assert.equal(result.timezone,scheduler.timezone);assert.equal(scheduler.entries.size,0);assert.equal(engine.calls.length,0);assert.equal(resolutions,0);
 for(const input of [{},{schedule:{}},{schedule:{frequency:'daily',time:'25:00'}},{schedule:{frequency:'daily',time:'02:00',url:'https://external.invalid'}},{schedule:{frequency:'daily'},provider:'claude'},{schedule:{frequency:'daily'},confirmed:true},[]])assert.throws(()=>scheduler.preview(input));
});

test('l’aperçu des routines existantes conserve leur prochain passage futur et ignore les dates manquées',async t=>{
 const{scheduler,setNow,now}=fixture(t);const entry=scheduler.create({...basic,schedule:{frequency:'interval',intervalMinutes:60}}),anchor=entry.nextRunAt;setNow(now()+1800000);assert.deepEqual(scheduler.state().automations[0].nextRuns,[anchor,anchor+3600000,anchor+7200000]);
 setNow(anchor+5*3600000);assert.deepEqual(scheduler.state().automations[0].nextRuns,[now()+3600000,now()+7200000,now()+10800000]);assert.equal(scheduler.get(entry.id).nextRunAt,anchor,'Un aperçu ne modifie pas la programmation');scheduler.update(entry.id,{enabled:false});assert.deepEqual(scheduler.state().automations[0].nextRuns,[]);
 assert.deepEqual(previewAutomationRuns({frequency:'daily',time:'02:00'},local(2026,10,19,3)),[local(2026,10,20,2),local(2026,10,21,2),local(2026,10,22,2)]);
 assert.deepEqual(previewAutomationRuns({frequency:'interval',intervalMinutes:60},now(),1e300),[now()+3600000,now()+7200000,now()+10800000]);
});
test('seul le plan Gmail résolu est transmis en mémoire ; aucun outil HTTP ou plan persisté',async t=>{
 const plan={client:'codex',name:'gmail',url:'https://gmailmcp.googleapis.com/mcp/v1',enabledTools:['get_message','get_thread','list_drafts','list_labels','search_threads']},requests=[];
 const{scheduler,engine,dataDir}=fixture(t,{resolveConnectorPlan:async value=>{requests.push(value);return plan;}});const a=scheduler.create({...basic,requiresConnector:true,connectorName:'gmail',connectorPlan:{enabledTools:['send_message']},enabledTools:['send_message']});await scheduler.run(a.id);assert.deepEqual(requests,[{client:'codex',name:'gmail'}]);assert.equal(engine.calls[0].options.connectorPlan,plan);const saved=readFileSync(path.join(dataDir,'automations.json'),'utf8');assert(!saved.includes('enabledTools'));assert(!saved.includes('send_message'));assert(!saved.includes('gmailmcp.googleapis.com'));engine.finish('mission-1');await scheduler.run(a.id);assert.equal(requests.length,2);
});
test('modification pendant une vérification de connecteur empêche tout ancien lancement',async t=>{
 let release;const{scheduler,engine}=fixture(t,{resolveConnectorPlan:()=>new Promise(resolve=>{release=resolve;})});const a=scheduler.create({...basic,requiresConnector:true,connectorName:'gmail'});const running=scheduler.run(a.id);await assert.rejects(scheduler.run(a.id),/déjà une mission/);scheduler.update(a.id,{enabled:false});release({client:'codex',name:'gmail',enabledTools:[]});await running;assert.equal(engine.calls.length,0);assert.equal(scheduler.get(a.id).enabled,false);scheduler.resolveConnectorPlan=async()=>{throw new Error('PRIVATE-TOKEN');};const r=await scheduler.run(a.id);assert.equal(r.status,'needs_configuration');assert(!JSON.stringify(r).includes('PRIVATE'));assert.equal(engine.calls.length,0);
});
test('un lancement sans identifiant reste récupérable au redémarrage',async t=>{
 const{scheduler,engine,dataDir,now}=fixture(t);const a=scheduler.create(basic),file=path.join(dataDir,'automations.json'),saved=JSON.parse(readFileSync(file,'utf8'));saved.automations[0].status='running';saved.automations[0].lastMissionId=null;writeFileSync(file,JSON.stringify(saved));const restored=new Automations({engine,dataDir,now});assert.equal(restored.get(a.id).status,'failed');await restored.run(a.id);assert.equal(engine.calls.length,1);await restored.close();
});
test('fichier invalide : aucun lancement, aucune erreur sensible et données préservées',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-invalid-auto-')),file=path.join(dataDir,'automations.json');writeFileSync(file,'INVALID PRIVATE DATA');const engine=new FakeEngine(dataDir),scheduler=new Automations({engine,dataDir});t.after(async()=>{await scheduler.close();rmSync(dataDir,{recursive:true,force:true});});await scheduler.tick();assert.equal(engine.calls.length,0);assert.throws(()=>scheduler.create(basic),/fichier/);assert.equal(readFileSync(file,'utf8'),'INVALID PRIVATE DATA');assert(!JSON.stringify(scheduler.state()).includes('PRIVATE'));
});
test('horloge injectable : démarrage unique, fermeture enlève le rappel local',async t=>{
 const callbacks=[],cleared=[];const{scheduler}=fixture(t,{setTimer:(fn,delay)=>{callbacks.push({fn,delay});return{unref(){}};},clearTimer:id=>cleared.push(id)});scheduler.start();scheduler.start();await new Promise(resolve=>setImmediate(resolve));assert.equal(callbacks.length,1);assert.equal(callbacks[0].delay,15000);await scheduler.close();assert.equal(cleared.length,1);await callbacks[0].fn();assert.equal(callbacks.length,1);
});
test('plan interne : le runner garde son objet de confiance, le corps HTTP et la sauvegarde ne le transportent pas',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-plan-test-')),calls=[];const engine=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:async opts=>{calls.push(opts);throw new Error('Fin du test avant modèle');}});t.after(()=>rmSync(dataDir,{recursive:true,force:true}));const external=engine.start({prompt:'Test HTTP',provider:'codex',connectorPlan:{name:'evil'}});await engine.wait(external.id);assert.equal(calls[0].connectorPlan,undefined);const plan={client:'codex',name:'gmail',enabledTools:['get_message']},internal=engine.start({prompt:'Test interne',provider:'codex'},{connectorPlan:plan});await engine.wait(internal.id);assert.equal(calls[1].connectorPlan,plan);const saved=readFileSync(path.join(engine.missionDir(internal.id),'state.json'),'utf8');assert(!saved.includes('connectorPlan'));assert(!saved.includes('get_message'));
});

test('une erreur de sauvegarde avant le départ ne lance rien et ne reste pas annoncée en cours',async t=>{
 const{scheduler,engine}=fixture(t);const a=scheduler.create(basic);scheduler.save=()=>{throw new Error('Disque indisponible');};await assert.rejects(scheduler.run(a.id),/Disque/);assert.equal(engine.calls.length,0);assert.equal(scheduler.get(a.id).status,'failed');assert.match(scheduler.get(a.id).message,/Aucune nouvelle mission/);
});
test('une routine Claude réutilise uniquement le plan de son propre client et garde les résultats locaux',async t=>{
 const requests=[],plan={client:'claude',type:'calendar',source:'claude.ai',name:'claudeai-calendar',runtimeName:'claude.ai Google Calendar',enabledTools:['get_event','list_events']};
 const {scheduler,engine}=fixture(t,{resolveConnectorPlan:async value=>{requests.push(value);return plan;}});const entry=scheduler.create({...basic,provider:'claude',requiresConnector:true,connectorName:plan.name});const running=await scheduler.run(entry.id);
 assert.equal(running.status,'running');assert.deepEqual(requests,[{client:'claude',name:plan.name}]);assert.equal(engine.calls[0].options.connectorPlan,plan);assert.equal(engine.calls[0].body.provider,'claude');assert.match(engine.calls[0].body.prompt,/compte Claude/);assert.match(engine.calls[0].body.prompt,/ne modifie aucun événement/);
 engine.finish(running.lastMissionId);scheduler.resolveConnectorPlan=async()=>({...plan,client:'codex'});const denied=await scheduler.run(entry.id);assert.equal(denied.status,'needs_configuration');assert.equal(engine.calls.length,1);
});
