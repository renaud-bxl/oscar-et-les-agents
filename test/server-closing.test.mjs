import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {createAtelierServer} from '../server.mjs';
import {Automations} from '../lib/automations.mjs';

const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const providers=[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}}];
for(const mode of ['mission','secretary'])test(`closing refuses a pending ${mode} before it can start and remains idempotent`,async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-closing-'));let calls=0;
 const app=await createAtelierServer({port:0,dataDir,providers,runner:async()=>{calls++;throw new Error('No external call');}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`,entered=gate(),release=gate(),closeEntered=gate(),closeRelease=gate();
 const originalClose=app.personalization.close.bind(app.personalization);
 app.personalization.close=async()=>{closeEntered.resolve();await closeRelease.promise;await originalClose();};
 t.after(async()=>{release.resolve();closeRelease.resolve();await app.close();rmSync(dataDir,{recursive:true,force:true});});
 let body,route;
 if(mode==='mission'){
  const item=await app.documents.import({name:'source.txt',base64:Buffer.from('A public source').toString('base64')});
  const read=app.documents.readItem.bind(app.documents);app.documents.readItem=async(...args)=>{entered.resolve();await release.promise;return read(...args);};
  route='/api/missions';body={prompt:'Read this example',provider:'codex',referenceIds:[item.id],requestId:'closing_mission_123'};
 }else{
  app.connectors.readPlan=async()=>{entered.resolve();await release.promise;return{client:'codex',name:'gmail',type:'gmail',enabledTools:[]};};
  route='/api/secretary';body={prompt:'Read my messages',provider:'codex',mode:'mail',connectorName:'gmail',requestId:'closing_secretary_123'};
 }
 const post=(url,data)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(data)});
 const request=post(route,body);await entered.promise;
 const closing=app.close();assert.equal(app.close(),closing);await closeEntered.promise;
 const refused=await post('/api/missions',{prompt:'A new request while closing',provider:'codex'});assert.equal(refused.status,409);assert.match((await refused.json()).error,/se ferme/);
 release.resolve();const response=await request;assert.equal(response.status,409);assert.match((await response.json()).error,/se ferme/);
 assert.equal(app.engine.missions.size,0);assert.equal(app.engine.runs.size,0);assert.equal(calls,0);
 closeRelease.resolve();await closing;
});

test('a routine whose connector fails during shutdown does not save a false configuration failure',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-closing-routine-')),entered=gate(),release=gate();let calls=0;
 class Engine extends EventEmitter{constructor(){super();this.dataDir=dataDir;this.providers=providers;this.logins={};}state(){return{providers,maxConcurrentMissions:4,activeMissions:[]};}get(){return null;}start(){calls++;return{id:'unexpected',status:'running'};}}
 const scheduler=new Automations({engine:new Engine(),dataDir,resolveConnectorPlan:async()=>{entered.resolve();await release.promise;throw new Error('Authorization no longer available');}});
 t.after(async()=>{release.resolve();await scheduler.close();rmSync(dataDir,{recursive:true,force:true});});
 const entry=scheduler.create({label:'Mail brief',prompt:'Prepare a summary of the messages.',provider:'codex',requiresConnector:true,connectorName:'gmail',schedule:{frequency:'daily',time:'02:00'},enabled:true});
 const running=scheduler.run(entry.id);const rejected=assert.rejects(running,/se ferme/);await entered.promise;const closing=scheduler.close();release.resolve();await rejected;await closing;
 assert.equal(calls,0);assert.equal(scheduler.get(entry.id).status,'scheduled');assert.equal(JSON.parse(readFileSync(path.join(dataDir,'automations.json'),'utf8')).automations[0].status,'scheduled');
});
