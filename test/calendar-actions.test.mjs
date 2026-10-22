import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {CalendarActions,executeCalendarCreate as executeCalendarCreateRaw} from '../lib/calendar-actions.mjs';
import {Connectors,isTrustedReadPlan,isTrustedCalendarCreatePlan} from '../lib/connectors.mjs';
import {parseInheritedApps,INHERITED_APPS,verifiedCalendarCreateMetadata} from '../lib/connector-clients.mjs';

const app=INHERITED_APPS.calendar;
const NOW=Date.parse('2026-10-20T10:00:00Z');
const executeCalendarCreate=options=>executeCalendarCreateRaw({now:()=>NOW,...options});
const event={title:'Rendez-vous de vérification',startLocal:'2026-10-21T15:00',endLocal:'2026-10-21T16:00',timeZone:'Europe/Brussels',durationSource:'explicit',location:'Bureau',description:'Un rendez-vous sans invité.'};
const schema={type:'object',properties:{title:{type:'string'},attendees:{type:'array',items:{type:'string'}},start_time:{anyOf:[{type:'string'},{type:'null'}]},end_time:{anyOf:[{type:'string'},{type:'null'}]},timezone_str:{anyOf:[{type:'string'},{type:'null'}]}},required:['title','attendees']};
function metadata(){
  const summaries=[...app.tools.map(name=>({name,isEnabled:true,isReadOnly:true})),{name:'create_event',isEnabled:true,isReadOnly:false},{name:'delete_event',isEnabled:true,isReadOnly:false}];
  return{installed:{apps:[{id:app.id,enabled:true,callable:true},{id:'other-app',enabled:true,callable:true}]},details:{apps:[{id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:summaries}]},runtimeTools:summaries.map(tool=>({name:'google_calendar.'+tool.name,title:tool.name,inputSchema:tool.name==='create_event'?schema:{type:'object'},_meta:{connector_id:app.id},annotations:{readOnlyHint:tool.isReadOnly,destructiveHint:tool.name==='delete_event'}}))};
}
async function fixture(t,{execute,...options}={}){
  const dataDir=await mkdtemp(path.join(await realpath(tmpdir()),'oscar-calendar-actions-'));let snapshot=metadata();
  const connectors=new Connectors({dataDir,find:async()=>'/fake/codex',run:async()=>({code:0,stdout:'[]'}),appInspector:async()=>parseInheritedApps(snapshot),claudeInspector:async()=>[]});
  const actions=new CalendarActions({dataDir,connectors,now:()=>NOW,...(execute?{execute}:{}),...options});await actions.ready;
  t.after(async()=>{await actions.close();await connectors.close();await rm(dataDir,{recursive:true,force:true});});
  return{dataDir,connectors,actions,snapshot};
}
const finish=async actions=>{await Promise.allSettled([...actions.jobs.values()].map(job=>job.completion));};
function rpc(snapshot=metadata(),result={content:[],structuredContent:{result:{id:'event-created',summary:'Rendez-vous de vérification',htmlLink:'https://calendar.google.com/calendar/event?eid=fake'}}}){
  const requests=[],kills=[],spawns=[];
  const spawnImpl=(binary,args,options)=>{
    spawns.push({binary,args,options});
    assert.deepEqual(args.slice(0,2),['-c','model_reasoning_effort="medium"']);
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>kills.push(signal);let partial='';
    const reply=(request,result)=>queueMicrotask(()=>child.stdout.write(JSON.stringify({id:request.id,result})+'\n'));
    child.stdin=new Writable({write(chunk,_encoding,done){partial+=chunk.toString();let end;while((end=partial.indexOf('\n'))>=0){const request=JSON.parse(partial.slice(0,end));partial=partial.slice(end+1);requests.push(request);switch(request.method){
      case'initialize':reply(request,{});break;
      case'initialized':break;
      case'thread/start':reply(request,{thread:{id:'ephemeral-calendar-test'}});break;
      case'app/installed':reply(request,snapshot.installed);break;
      case'app/read':reply(request,snapshot.details);break;
      case'mcpServerStatus/list':reply(request,{data:[{name:'codex_apps',tools:Object.fromEntries(snapshot.runtimeTools.map(tool=>[tool.name,tool]))}],nextCursor:null});break;
      case'mcpServer/tool/call':if(result)reply(request,result);break;
      default:assert.fail('Unexpected official request: '+request.method);
    }}done();}});child.args=args;child.options=options;return child;
  };
  return{spawnImpl,requests,kills,spawns};
}

test('calendar creation requires canonical owner, declared write action and exact runtime schema while read plans stay read-only',async t=>{
  const f=await fixture(t),rows=parseInheritedApps(f.snapshot),row=rows.find(row=>row.type==='calendar');assert.equal(row.calendarCreate.available,true);assert.equal(verifiedCalendarCreateMetadata({...row}),null);
  const read=await f.connectors.readPlan({name:app.name}),write=await f.connectors.calendarCreatePlan({client:'codex',name:app.name});
  assert(isTrustedReadPlan(read));assert(!isTrustedCalendarCreatePlan(read));assert(isTrustedCalendarCreatePlan(write));assert(!isTrustedReadPlan(write));assert(!isTrustedCalendarCreatePlan({...write}));assert(!read.enabledTools.includes('create_event'));assert.equal(write.executionTool,'google_calendar.create_event');assert(Object.isFrozen(write));
  for(const change of [m=>{m.runtimeTools.find(tool=>tool.title==='create_event')._meta.connector_id='other-app';},m=>{m.runtimeTools.find(tool=>tool.title==='create_event').annotations.readOnlyHint=true;},m=>{m.details.apps[0].toolSummaries.find(tool=>tool.name==='create_event').isEnabled=false;},m=>{m.runtimeTools.find(tool=>tool.title==='create_event').inputSchema={type:'object'};},m=>{m.runtimeTools.push({...m.runtimeTools.find(tool=>tool.title==='create_event')});}]){const m=structuredClone(metadata());change(m);assert.equal(parseInheritedApps(m).find(row=>row.type==='calendar').calendarCreate.available,false);}
  await assert.rejects(f.connectors.calendarCreatePlan({client:'claude',name:app.name}),cause=>cause.code==='CALENDAR_UNAVAILABLE');
});

test('preview never executes and confirmed concurrent clicks plus reload converge on one durable receipt',async t=>{
  let calls=0;const f=await fixture(t,{execute:async options=>{calls++;await options.onDispatch();return{eventId:'unique-event'};}});
  const preview=await f.actions.preview({client:'codex',name:app.name,event});assert.equal(calls,0);assert(preview.requiresConfirmation);assert.match(preview.confirmationToken,/^[a-f\d]{64}$/u);
  const confirmation={previewId:preview.previewId,confirmationToken:preview.confirmationToken,requestId:'confirmed_request_123'};
  const receipts=await Promise.all(Array.from({length:12},()=>f.actions.confirm(confirmation)));assert.equal(new Set(receipts.map(row=>row.id)).size,1);await finish(f.actions);const done=f.actions.get(receipts[0].id);assert.equal(done.status,'completed');assert.equal(calls,1);assert(!Object.hasOwn(done,'confirmationHash'));assert(!Object.hasOwn(done,'requestId'));
  const saved=JSON.parse(await readFile(path.join(f.dataDir,'calendar-actions',done.id+'.json'),'utf8'));assert.equal(saved.status,'completed');assert.equal(saved.result.eventId,'unique-event');
  const reloaded=new CalendarActions({dataDir:f.dataDir,connectors:f.connectors,execute:async()=>assert.fail('An acknowledged action must never replay')});await reloaded.ready;t.after(()=>reloaded.close());assert.equal((await reloaded.confirm(confirmation)).id,done.id);
});

test('expired, changed or forged confirmations never execute; new payload requires a new preview',async t=>{
  let clock=0,calls=0;const f=await fixture(t,{now:()=>clock,execute:async()=>{calls++;return{eventId:'never'};}}),preview=await f.actions.preview({client:'codex',name:app.name,event});
  await assert.rejects(f.actions.confirm({previewId:preview.previewId,confirmationToken:'0'.repeat(64),requestId:'forged_request_123'}),cause=>cause.code==='CALENDAR_CHANGED');
  clock=600001;await assert.rejects(f.actions.confirm({previewId:preview.previewId,confirmationToken:preview.confirmationToken,requestId:'expired_request_123'}),cause=>cause.code==='CALENDAR_CHANGED');assert.equal(calls,0);
  await assert.rejects(f.actions.preview({client:'codex',name:app.name,event:{...event,attendees:['unapproved@example.test']}}));
});

test('an interrupted dispatch is durable uncertainty, never a successful event and never automatically replayed',async t=>{
  let calls=0;const f=await fixture(t,{execute:async options=>{calls++;await options.onDispatch();throw Object.assign(new Error('PRIVATE_PROVIDER_DIAGNOSTIC'),{dispatched:true});}}),preview=await f.actions.preview({client:'codex',name:app.name,event});
  const body={previewId:preview.previewId,confirmationToken:preview.confirmationToken,requestId:'uncertain_request_123'},receipt=await f.actions.confirm(body);await finish(f.actions);assert.equal(f.actions.get(receipt.id).status,'uncertain');assert.doesNotMatch(JSON.stringify(f.actions.get(receipt.id)),/PRIVATE_PROVIDER/);await f.actions.confirm(body);assert.equal(calls,1);
  const file=path.join(f.dataDir,'calendar-actions',receipt.id+'.json'),record=JSON.parse(await readFile(file,'utf8'));record.status='creating';await writeFile(file,JSON.stringify(record));
  const resumed=new CalendarActions({dataDir:f.dataDir,connectors:f.connectors,execute:async()=>assert.fail('A restart must not send')});await resumed.ready;t.after(()=>resumed.close());assert.equal(resumed.get(receipt.id).status,'uncertain');assert.equal((await resumed.confirm(body)).status,'uncertain');
});

test('official direct transport revalidates within an ephemeral thread and sends only one exact invitation-free create call',async t=>{
  const f=await fixture(t),plan=await f.connectors.calendarCreatePlan({client:'codex',name:app.name}),wire=rpc();let dispatches=0;
  const preview=await f.actions.preview({client:'codex',name:app.name,event});
  const env={HOME:'/unchanged',CODEX_HOME:'/unchanged/codex'};
  const result=await executeCalendarCreate({binary:'/fake/codex',cwd:f.dataDir,env,plan,event:preview.event,spawnImpl:wire.spawnImpl,onDispatch:async()=>{dispatches++;}});
  assert.equal(wire.spawns.length,1);assert.equal(wire.spawns[0].options.env,env);assert.equal(wire.spawns[0].options.cwd,f.dataDir);
  const args=wire.spawns[0].args;assert.deepEqual(args.slice(2,8),['--disable','plugins','--enable','apps','-c','web_search="disabled"']);assert.ok(args.includes('apps._default.enabled=false'));assert.ok(args.includes('app-server'));assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(result.eventId,'event-created');assert.equal(dispatches,1);const calls=wire.requests.filter(row=>row.method==='mcpServer/tool/call');assert.equal(calls.length,1);assert.equal(calls[0].params.server,'codex_apps');assert.equal(calls[0].params.tool,'google_calendar.create_event');
  assert.deepEqual(calls[0].params.arguments,{calendar_id:'primary',title:event.title,attendees:[],start_time:preview.event.start,end_time:preview.event.end,timezone_str:'Europe/Brussels',location:event.location,description:event.description,add_google_meet:false,self_attendance:'omit',event_type:'default',guests_can_modify:false,reminders:{use_default:false,overrides:[]}});
  assert.equal(wire.requests.find(row=>row.method==='thread/start').params.ephemeral,true);assert(!wire.requests.some(row=>row.method==='turn/start'));assert(wire.kills.includes('SIGTERM'));
});

test('changed runtime identity prevents a write and tool errors/response loss cannot become creation success',async t=>{
  const f=await fixture(t),plan=await f.connectors.calendarCreatePlan({client:'codex',name:app.name}),preview=await f.actions.preview({client:'codex',name:app.name,event});
  const changed=metadata();changed.runtimeTools.find(tool=>tool.title==='create_event').name='unexpected.create_event';const first=rpc(changed);await assert.rejects(executeCalendarCreate({binary:'/fake/codex',cwd:f.dataDir,plan,event:preview.event,spawnImpl:first.spawnImpl}),cause=>cause.code==='CALENDAR_UNAVAILABLE'&&!cause.dispatched);assert(!first.requests.some(row=>row.method==='mcpServer/tool/call'));
  const denied=rpc(metadata(),{isError:true,content:[{type:'text',text:'Missing permissions or scopes required for this action PRIVATE_ERROR'}]});await assert.rejects(executeCalendarCreate({binary:'/fake/codex',cwd:f.dataDir,plan,event:preview.event,spawnImpl:denied.spawnImpl}),cause=>cause.code==='CALENDAR_PERMISSIONS'&&cause.dispatched&&!cause.message.includes('PRIVATE'));
  const noReceipt=rpc(metadata(),{content:[{type:'text',text:'No event receipt'}]});await assert.rejects(executeCalendarCreate({binary:'/fake/codex',cwd:f.dataDir,plan,event:preview.event,spawnImpl:noReceipt.spawnImpl}),cause=>cause.code==='CALENDAR_UNCERTAIN');
  const lost=rpc(metadata(),null);await assert.rejects(executeCalendarCreate({binary:'/fake/codex',cwd:f.dataDir,plan,event:preview.event,spawnImpl:lost.spawnImpl,timeoutMs:25}),cause=>cause.code==='CALENDAR_UNCERTAIN');assert.equal(lost.requests.filter(row=>row.method==='mcpServer/tool/call').length,1);
});

test('provider verification precedes preview, confirmation and dispatch, and close cancels active operations',async t=>{
  let checks=0,closed=false;const f=await fixture(t,{assertProvider:async client=>{assert.equal(client,'codex');checks++;if(closed)throw new Error('not connected');},execute:async options=>{await options.onDispatch();if(!options.signal.aborted)await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));throw Object.assign(new Error('cancelled'),{dispatched:true});}});
  const p=await f.actions.preview({client:'codex',name:app.name,event}),receipt=await f.actions.confirm({previewId:p.previewId,confirmationToken:p.confirmationToken,requestId:'close_request_123'});while(f.actions.get(receipt.id).status!=='creating')await new Promise(resolve=>setImmediate(resolve));assert(checks>=4);assert.equal(f.actions.activeJobs.length,1);await f.actions.close();assert.equal(f.actions.activeJobs.length,0);assert.equal(f.actions.get(receipt.id).status,'uncertain');
  const other=await fixture(t,{assertProvider:async()=>{throw new Error('missing subscription');},execute:async()=>assert.fail('no call')});await assert.rejects(other.actions.preview({client:'codex',name:app.name,event}));
});

test('receipt symlinks and malformed records fail before any account operation',async t=>{
  const f=await fixture(t),outside=path.join(f.dataDir,'outside');await mkdir(outside);const id='01234567-0123-0123-0123-012345678901';await symlink(path.join(outside,'private.json'),path.join(f.dataDir,'calendar-actions',id+'.json'));
  const resumed=new CalendarActions({dataDir:f.dataDir,connectors:f.connectors,execute:async()=>assert.fail('no account operation')});await assert.rejects(resumed.ready,/invalide/u);await resumed.close();
});
