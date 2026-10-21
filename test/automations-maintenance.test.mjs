import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Automations} from '../lib/automations.mjs';

const deferred=()=>{let resolve;const promise=new Promise(accept=>{resolve=accept;});return{promise,resolve};};
const basic={label:'Veille locale de test',prompt:'Prépare un résumé local.',provider:'codex',schedule:{frequency:'interval',intervalMinutes:15},enabled:true};
function fixture(t,{resolveConnectorPlan}={}){
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-update-routines-')),engine=new EventEmitter();let now=Date.parse('2026-10-21T10:00:00Z'),maintenance=false;
  Object.assign(engine,{dataDir,calls:[],missions:new Map(),state:()=>({providers:[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}}],logins:{},maxConcurrentMissions:4,activeMissions:[]}),get:id=>engine.missions.get(id),start:(body,options)=>{const mission={id:`mission-${engine.calls.length+1}`,status:'running'};engine.calls.push({body,options});engine.missions.set(mission.id,mission);return mission;}});
  const scheduler=new Automations({engine,dataDir,now:()=>now,isMaintenance:()=>maintenance,resolveConnectorPlan});
  t.after(async()=>{await scheduler.close();rmSync(dataDir,{recursive:true,force:true});});
  return{scheduler,engine,file:path.join(dataDir,'automations.json'),setMaintenance:value=>{maintenance=value;},setNow:value=>{now=value;}};
}

test('maintenance skips due routine ticks without rewriting schedules or launching a model',async t=>{
  const f=fixture(t),entry=f.scheduler.create(basic),before=readFileSync(f.file,'utf8');
  f.setNow(entry.nextRunAt+60000);f.setMaintenance(true);
  await f.scheduler.tick();await f.scheduler.tick();
  assert.equal(f.engine.calls.length,0);assert.equal(f.scheduler.get(entry.id).nextRunAt,entry.nextRunAt);assert.equal(readFileSync(f.file,'utf8'),before);
  await assert.rejects(f.scheduler.run(entry.id));
  assert.equal(f.engine.calls.length,0);assert.equal(readFileSync(f.file,'utf8'),before);
  f.setMaintenance(false);await f.scheduler.tick();assert.equal(f.engine.calls.length,1);
  await f.scheduler.tick();assert.equal(f.engine.calls.length,1,'Resuming never creates duplicate catch-up missions.');
});

test('maintenance beginning during connector discovery prevents the pending account routine from starting',async t=>{
  const entered=deferred(),answer=deferred();
  const f=fixture(t,{resolveConnectorPlan:()=>{entered.resolve();return answer.promise;}});
  const entry=f.scheduler.create({...basic,requiresConnector:true,connectorName:'gmail'}),running=f.scheduler.run(entry.id);
  await entered.promise;assert.equal(f.scheduler.pending.size,1);assert.equal(f.scheduler.launching.size,1);
  f.setMaintenance(true);answer.resolve({client:'codex',name:'gmail',type:'gmail',enabledTools:['search']});
  await assert.rejects(running);
  assert.equal(f.engine.calls.length,0);assert.equal(f.scheduler.launching.size,0);assert.notEqual(f.scheduler.get(entry.id).status,'running');
});
