import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAtelierServer} from '../server.mjs';
import {validateCalendarEvent} from '../lib/calendar-intent.mjs';

const reference=Date.parse('2026-10-20T08:00:00Z'),receiptId='10000000-0000-4000-8000-000000000001';
const event=()=>({title:'Vérification fictive',startLocal:'2099-11-04T16:00',endLocal:'2099-11-04T16:30',timeZone:'Europe/Brussels',durationSource:'explicit'});
async function setup(t){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-server-calendar-')),calls={preview:[],confirm:[],get:[],setup:[],auth:[],login:[],closed:0,models:0},jobs=[],active=new Set();let settings;
  const connectors={ready:Promise.resolve(),active,disabledNames:()=>[],state:async()=>({connections:[]}),setup:async body=>{calls.setup.push(body);return{status:'configured'};},auth:async body=>{calls.auth.push(body);return{status:'configured'};},close:async()=>{}};
  const calendar={ready:Promise.resolve(),activeJobs:jobs,state:()=>({activeJobs:jobs}),preview:async body=>{calls.preview.push(body);await settings.assertProvider(body.client);return{previewId:receiptId,confirmationToken:'a'.repeat(64),event:validateCalendarEvent(body.event,{now:reference}),client:body.client,name:body.name,requiresConfirmation:true};},confirm:async body=>{calls.confirm.push(body);return{id:receiptId,status:'pending',message:'Simulation uniquement.'};},get:id=>{calls.get.push(id);if(id!==receiptId)throw Object.assign(new Error('Le reçu de l’agenda est introuvable.'),{code:'CALENDAR_NOT_FOUND'});return{id,status:'completed',result:{eventId:'synthetic-event'}};},close:async()=>{calls.closed++;}};
  const app=await createAtelierServer({port:0,dataDir,providers:[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}},{id:'claude',available:true,auth:{loggedIn:true,method:'subscription'}}],connectorsFactory:()=>connectors,calendarFactory:value=>{settings=value;return calendar;},loginFactory:()=>({start:async client=>{calls.login.push(client);return{status:'connecting'};},setup:async client=>{calls.login.push(client);return{status:'installed'};},close:async()=>{}}),runner:async()=>{calls.models++;throw new Error('No model calls permitted');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`,send=(route,body={},headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});
  return{app,base,send,calls,jobs,active,calendar,settings};
}

test('calendar interpretation is local, uses absolute dates and rejects unknown input and timezones',async t=>{
  const{base,send,calls}=await setup(t);
  const response=await send('/api/calendar/interpret',{prompt:'Réunion 2099-11-04 à 16h pendant 30 minutes',timeZone:'Europe/Brussels'});assert.equal(response.status,200);const draft=await response.json();
  assert.equal(draft.title,'Réunion');assert.equal(draft.startLocal,'2099-11-04T16:00');assert.equal(draft.endLocal,'2099-11-04T16:30');assert.equal(draft.durationSource,'explicit');assert.equal(draft.needsConfirmation,true);
  for(const body of [{prompt:'Dentiste demain à 16h',timeZone:'Europe/Unknown'},{prompt:'Dentiste demain à 16h',timeZone:'Europe/Brussels',now:0},{prompt:'',timeZone:'Europe/Brussels'},{prompt:'x'.repeat(12001),timeZone:'Europe/Brussels'}]){const result=await send('/api/calendar/interpret',body);assert.equal(result.status,400);assert.equal((await result.json()).code,'CALENDAR_INVALID');}
  for(const file of ['calendar-event-dialog.js','calendar-event-dialog.css','translations-calendar.js'])assert.equal((await fetch(base+'/'+file)).status,200,file);
  assert.equal(calls.models,0);assert.deepEqual(calls.preview,[]);assert.deepEqual(calls.confirm,[]);
});

test('calendar preview and confirmation are separate protected routes, with no action during interpretation',async t=>{
  const{send,calls}=await setup(t),body={client:'codex',name:'chatgpt-calendar',event:event()};
  const preview=await send('/api/calendar/preview',body);assert.equal(preview.status,200);const data=await preview.json();assert.equal(data.requiresConfirmation,true);assert.equal(data.event.start,'2099-11-04T16:00:00+01:00');assert.equal(calls.preview.length,1);assert.deepEqual(calls.confirm,[]);
  const confirmation={previewId:data.previewId,confirmationToken:data.confirmationToken,requestId:'synthetic-request'};const result=await send('/api/calendar/confirm',confirmation);assert.equal(result.status,200);assert.equal((await result.json()).status,'pending');assert.deepEqual(calls.confirm,[confirmation]);assert.equal(calls.models,0);
});

test('calendar routes require same-origin local JSON before touching any action service',async t=>{
  const{base,send,calls}=await setup(t),body={client:'codex',name:'chatgpt-calendar',event:event()};
  for(const route of ['/api/calendar/interpret','/api/calendar/preview','/api/calendar/confirm']){
    assert.equal((await send(route,body,{Origin:'https://outside.invalid'})).status,403);
    assert.equal((await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
    assert.equal((await fetch(base+route,{method:'POST',headers:{'Content-Type':'text/plain','X-Oscar-Client':'1'},body:JSON.stringify(body)})).status,403);
  }
  assert.deepEqual(calls.preview,[]);assert.deepEqual(calls.confirm,[]);assert.equal(calls.models,0);
});

test('provider guard rejects unavailable, logged-out or API clients and connector/login preparation',async t=>{
  const{app,send,calls,active,settings}=await setup(t),provider=app.engine.providers.find(row=>row.id==='codex'),body={client:'codex',name:'chatgpt-calendar',event:event()};
  for(const auth of [{loggedIn:false,method:'chatgpt'},{loggedIn:true,method:'api'}]){provider.auth=auth;const result=await send('/api/calendar/preview',body);assert.equal(result.status,400);assert.equal((await result.json()).code,'CALENDAR_CONNECTION');}
  provider.auth={loggedIn:true,method:'chatgpt'};provider.available=false;assert.equal((await send('/api/calendar/preview',body)).status,400);provider.available=true;
  await assert.rejects(settings.assertProvider('other'),{code:'CALENDAR_CONNECTION'});
  active.add('codex');assert.equal((await send('/api/calendar/preview',body)).status,409);active.clear();
  app.engine.logins={codex:{status:'connecting'}};assert.equal((await send('/api/calendar/preview',body)).status,409);app.engine.logins={codex:{status:'installing'}};assert.equal((await send('/api/calendar/preview',body)).status,409);app.engine.logins={};
  assert.equal((await send('/api/calendar/preview',body)).status,200);assert.equal(calls.models,0);assert.deepEqual(calls.confirm,[]);
});

test('active calendar jobs preserve the provider connection and are visible in state',async t=>{
  const{base,send,calls,jobs}=await setup(t);jobs.push({id:receiptId,client:'codex',status:'creating'});
  const state=await fetch(base+'/api/state').then(response=>response.json());assert.deepEqual(state.calendar.activeJobs,jobs);
  for(const route of ['/api/connectors/setup','/api/connectors/auth'])assert.equal((await send(route,{client:'codex'})).status,409);
  for(const route of ['/api/providers/codex/login','/api/providers/codex/setup'])assert.equal((await send(route)).status,409);
  assert.deepEqual(calls.setup,[]);assert.deepEqual(calls.auth,[]);assert.deepEqual(calls.login,[]);
  assert.equal((await send('/api/connectors/setup',{client:'claude'})).status,202);assert.deepEqual(calls.setup,[{client:'claude'}]);assert.equal(calls.models,0);
});

test('receipt lookup is read-only, rejects extra queries, maps unknown receipts to 404 and closes cleanly',async t=>{
  const{app,base,calls}=await setup(t);
  const receipt=await fetch(base+'/api/calendar/receipts/'+receiptId);assert.equal(receipt.status,200);assert.equal((await receipt.json()).status,'completed');
  assert.equal((await fetch(base+'/api/calendar/receipts/10000000-0000-4000-8000-000000000002')).status,404);
  const previous=calls.get.length;assert.equal((await fetch(base+'/api/calendar/receipts/'+receiptId+'?include=private')).status,400);assert.equal(calls.get.length,previous);
  assert.equal((await fetch(base+'/api/calendar/receipts/'+receiptId,{headers:{Origin:'https://outside.invalid'}})).status,403);
  assert.deepEqual(calls.confirm,[]);assert.equal(calls.models,0);await app.close();assert.equal(calls.closed,1);
});
