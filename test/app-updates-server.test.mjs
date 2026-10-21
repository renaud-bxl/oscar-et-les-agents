import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { request as httpRequest } from 'node:http';
import { createAtelierServer } from '../server.mjs';

async function office(t, { install = async () => ({ status:'restarting' }) } = {}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-update-http-'));
  const calls={check:0,install:0};let options;
  const app=await createAtelierServer({port:0,dataDir,providers:[],demoDelay:20000,updatesFactory:input=>{
    options=input;return {state:{status:'available',currentVersion:'0.6.10',latestVersion:'0.6.11'},check:async()=>{calls.check++;return {status:'available'};},install:async value=>{calls.install++;return install(value);},close(){}};
  }});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const post=(route,body={},headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});
  return{app,base,post,calls,options};
}

test('updates expose versions without downloads and validate local explicit confirmation',async t=>{
  const {base,post,calls,options}=await office(t);
  assert.equal(options.autoCheck,false);
  assert.equal(options.requestShutdown,undefined);
  assert.equal((await (await fetch(base+'/api/updates')).json()).latestVersion,'0.6.11');
  assert.equal((await (await fetch(base+'/api/state')).json()).updates.status,'available');
  assert.deepEqual(calls,{check:0,install:0});
  const foreign=await post('/api/updates/check',{}, {Origin:'https://example.com'});assert.equal(foreign.status,403);
  for(const value of [{version:'0.6.11'},{version:'0.6.11',confirmed:false},{version:'0.6.11',confirmed:true,url:'https://example.com'}])assert.equal((await post('/api/updates/install',value)).status,400);
  assert.equal((await post('/api/updates/check',{url:'https://example.com'})).status,400);
  assert.deepEqual(calls,{check:0,install:0});
  assert.equal((await post('/api/updates/check')).status,200);assert.equal(calls.check,1);
});

test('a working mission prevents update before download or shutdown',async t=>{
  const {app,post,calls}=await office(t);
  app.engine.start({provider:'demo',prompt:'Mission fictive de contrôle du verrou.'});
  const response=await post('/api/updates/install',{version:'0.6.11',confirmed:true});
  assert.equal(response.status,409);assert.equal(calls.install,0);assert.equal(app.maintenance.active,false);
  assert.equal(app.engine.runs.size,1);
});

test('failed preparation releases maintenance; successful reservation rejects new work',async t=>{
  let fail=true;
  const {app,base,post}=await office(t,{install:async()=>{if(fail)throw Object.assign(new Error('Contrôle simulé interrompu.'),{code:'UPDATE_INVALID'});return{status:'restarting'};}});
  assert.equal((await post('/api/updates/install',{version:'0.6.11',confirmed:true})).status,400);
  assert.equal(app.maintenance.active,false);
  fail=false;assert.equal((await post('/api/updates/install',{version:'0.6.11',confirmed:true})).status,202);
  assert.equal(app.maintenance.active,true);
  assert.equal((await post('/api/missions',{prompt:'Aucune mission ne doit partir.',provider:'demo'})).status,409);
  assert.equal((await post('/api/updates/install',{version:'0.6.11',confirmed:true})).status,409);
  assert.equal((await fetch(base+'/api/state')).status,200);
  assert.equal(app.engine.runs.size,0);
});

test('an unfinished request body already reserves the existing operation against updates',async t=>{
  const {app,base,post,calls}=await office(t);
  const body=JSON.stringify({prompt:'Cette demande reste fictive.',provider:'demo'});
  const pending=httpRequest(base+'/api/missions',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Oscar-Client':'1'}});
  pending.on('error',()=>{});pending.write(body.slice(0,10));
  t.after(()=>pending.destroy());
  for(let attempt=0;attempt<100&&!app.maintenance.requests.size;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(app.maintenance.requests.size,1);
  const response=await post('/api/updates/install',{version:'0.6.11',confirmed:true});
  assert.equal(response.status,409);assert.equal(calls.install,0);
  pending.destroy();
});
