import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Connectors} from '../lib/connectors.mjs';
import {CLAUDE_READ_SERVICES,parseInheritedClaudeConnectors} from '../lib/connector-clients.mjs';
import {createClaudeReadSession} from '../lib/claude-read-session.mjs';
import {runAgent,isTrustedConnectorReadReceipt} from '../lib/providers.mjs';

const descriptor=()=>({name:'claude.ai Gmail',source:'claudeai',scope:'claudeai',status:'connected',config:{type:'claudeai-proxy',url:CLAUDE_READ_SERVICES.gmail.url,id:'test-gmail'},tools:[...CLAUDE_READ_SERVICES.gmail.tools.map(name=>({name,annotations:{readOnly:true}})),{name:'send_message',annotations:{}},{name:'create_draft',annotations:{}}]});
async function planFixture(t){
  const directory=await mkdtemp(join(tmpdir(),'oscar-claude-session-'));
  const manager=new Connectors({dataDir:directory,find:async()=>'/fake/claude',run:async()=>({code:0,stdout:'claude.ai Gmail: ✔ Connected'}),claudeInspector:async()=>parseInheritedClaudeConnectors([descriptor()]),appInspector:async()=>[]});
  t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});
  return {directory,plan:await manager.readPlan({client:'claude',name:'claudeai-gmail'})};
}
function harness(t,plan,options={}){
  const writes=[],emitted=[],failures=[];
  const stdin=new Writable({write(chunk,encoding,callback){writes.push(JSON.parse(String(chunk)));callback();}});
  const session=createClaudeReadSession({plan,input:'Une lecture autorisée.',pollIntervalMs:0,...options});
  const push=event=>session.push(Buffer.from(JSON.stringify(event)+'\n'),chunk=>emitted.push(JSON.parse(String(chunk))));
  const reply=response=>push({type:'control_response',response:{subtype:'success',request_id:writes.filter(frame=>frame.type==='control_request').at(-1).request_id,response}});
  session.start(stdin,error=>failures.push(error));t.after(()=>session.dispose());
  return {session,stdin,writes,emitted,failures,push,reply};
}

test('the same Claude process must confirm its selected identity and every tool before it receives a prompt',async t=>{
  const {plan}=await planFixture(t),h=harness(t,plan);
  assert.deepEqual(h.writes.map(frame=>frame.request?.subtype),['initialize']);
  h.reply({});assert.deepEqual(h.writes.map(frame=>frame.request?.subtype),['initialize','mcp_status']);
  h.reply({mcpServers:[descriptor()]});
  assert.deepEqual(h.writes.map(frame=>frame.type),['control_request','control_request','user']);assert.equal(h.writes[2].message.content,'Une lecture autorisée.');assert.equal(h.stdin.writableEnded,false);
  assert.equal(h.emitted.length,0);
  h.push({type:'assistant',message:{content:[{type:'tool_use',name:'mcp__claude_ai_Gmail__list_labels',id:'read-1',input:{}}]}});
  h.push({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-1',is_error:false,content:'PRIVATE'}]}});
  h.push({type:'result',subtype:'success',result:'Lecture vérifiée.'});
  assert.deepEqual(h.emitted.map(event=>event.type),['assistant','user','result']);assert.equal(h.stdin.writableEnded,true);
  h.session.finish();assert.equal(h.failures.length,0);
});

test('Claude waits through an empty or pending discovery without ever submitting the prompt early',async t=>{
  const {plan}=await planFixture(t),h=harness(t,plan);h.reply({});h.reply({mcpServers:[]});assert.ok(!h.writes.some(frame=>frame.type==='user'));
  await delay(5);h.reply({mcpServers:[{...descriptor(),status:'pending'}]});assert.ok(!h.writes.some(frame=>frame.type==='user'));
  await delay(5);h.reply({mcpServers:[descriptor()]});assert.equal(h.writes.filter(frame=>frame.type==='user').length,1);
});

test('a different identity, missing read annotation, changed tool set or extra reconnectable service fails before any prompt',async t=>{
  const {plan}=await planFixture(t);
  const mutations=[
    server=>{server.config.id='different-gmail';},server=>{server.config.url+='?token=PRIVATE';},server=>{server.source='user';},server=>{server.scope='user';},server=>{server.config.type='http';},server=>{server.tools[0].annotations.readOnly=false;},server=>{server.tools.push({name:'new_action',annotations:{readOnly:true}});},server=>{server.status='needs-auth';},
  ];
  for(const mutate of mutations){const changed=descriptor();mutate(changed);const h=harness(t,plan);h.reply({});assert.throws(()=>h.reply({mcpServers:[changed]}),cause=>cause.code==='CONNECTOR_UNAVAILABLE'&&!cause.message.includes('PRIVATE'));assert.ok(!h.writes.some(frame=>frame.type==='user'));}
  for(const status of ['connected','pending','failed','needs-auth']){const h=harness(t,plan);h.reply({});assert.throws(()=>h.reply({mcpServers:[descriptor(),{name:'other',status}]}),cause=>cause.code==='CONNECTOR_UNAVAILABLE');assert.ok(!h.writes.some(frame=>frame.type==='user'));}
  const disabled=harness(t,plan);disabled.reply({});disabled.reply({mcpServers:[descriptor(),{name:'other',status:'disabled'}]});assert.equal(disabled.writes.filter(frame=>frame.type==='user').length,1);
  assert.throws(()=>createClaudeReadSession({plan:{...plan},input:'Forged.'}),cause=>cause.code==='CONNECTOR_UNAVAILABLE');
});

test('unexpected actions, model output and control errors cannot authorize a Claude read session',async t=>{
  const {plan}=await planFixture(t);
  for(const event of [{type:'control_request',request_id:'write-request',request:{subtype:'can_use_tool',tool_name:'send_message'}},{type:'assistant',message:{content:[]}},{type:'user',message:{content:[]}},{type:'result',subtype:'success'},{type:'control_response',response:{subtype:'error',request_id:'oscar_read_1',error:'PRIVATE'}}]){
    const h=harness(t,plan);assert.throws(()=>h.push(event),cause=>cause.code==='CONNECTOR_UNAVAILABLE'&&!cause.message.includes('PRIVATE'));assert.ok(!h.writes.some(frame=>frame.type==='user'));
    if(event.type==='control_request')assert.equal(h.writes.at(-1).response.subtype,'error');
  }
});

test('preflight has its own short deadline and cancellation prevents a later metadata response from submitting a prompt',async t=>{
  const {plan}=await planFixture(t),timed=harness(t,plan,{preflightTimeoutMs:10});await delay(25);assert.equal(timed.failures.length,1);assert.equal(timed.failures[0].code,'CONNECTOR_UNAVAILABLE');timed.reply({});await delay(5);assert.deepEqual(timed.writes.map(frame=>frame.request?.subtype),['initialize']);assert.ok(!timed.writes.some(frame=>frame.type==='user'));
  const cancelled=harness(t,plan);cancelled.reply({});cancelled.session.dispose();cancelled.push({type:'control_response',response:{subtype:'success',request_id:'oscar_read_2',response:{mcpServers:[descriptor()]}}});await delay(5);assert.ok(!cancelled.writes.some(frame=>frame.type==='user'));
});

const cliSource=String.raw`
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const args=process.argv.slice(2);
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(args.includes('--version'))console.log('2.1.303');
else if(args.includes('--help'))console.log('--restricted --output-format --verbose --permission-mode --tools --allowedTools --strict-mcp-config --permission-prompts');
else{
  let buffer='',started=false;
  const trace={args,enableToolSearch:process.env.ENABLE_TOOL_SEARCH,types:[],userCount:0};
  const save=()=>fs.writeFileSync(process.env.CLAUDE_TEST_TRACE,JSON.stringify(trace));
  const server=JSON.parse(process.env.CLAUDE_TEST_DESCRIPTOR);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;const frame=JSON.parse(line);trace.types.push(frame.type==='control_request'?frame.request.subtype:frame.type);save();
    if(frame.type==='control_request'){
      if(frame.request.subtype==='mcp_status'&&process.env.CLAUDE_TEST_MODE==='pending'){
        if(!started){started=true;const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});trace.workerPid=child.pid;save();}
        emit({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{mcpServers:[{...server,status:'pending'}]}}});
      }else emit({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:frame.request.subtype==='initialize'?{}:{mcpServers:[server]}}});
    }else if(frame.type==='user'){
      trace.userCount++;save();
      emit({type:'system',subtype:'init',tools:['Read','mcp__claude_ai_Gmail__list_labels'],mcp_servers:[{name:'claude.ai Gmail',status:'connected'}]});
      emit({type:'assistant',message:{content:[{type:'tool_use',id:'read-1',name:'mcp__claude_ai_Gmail__list_labels',input:{}}]}});
      emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-1',is_error:false,content:'PRIVATE-ACCOUNT-CONTENT'}]}});
      emit({type:'result',subtype:'success',result:'Lecture contrôlée.',usage:{input_tokens:1,output_tokens:1}});
    }
  }});
}
`;
async function cliFixture(t){
  const setup=await planFixture(t),bin=join(setup.directory,'bin');await mkdir(bin);await writeFile(join(bin,'claude'),`#!${process.execPath}\n${cliSource}`,{mode:0o700});
  const keys=['PATH','ENABLE_TOOL_SEARCH','CLAUDE_TEST_TRACE','CLAUDE_TEST_DESCRIPTOR','CLAUDE_TEST_MODE'];const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  process.env.PATH=bin;process.env.ENABLE_TOOL_SEARCH='true';process.env.CLAUDE_TEST_TRACE=join(setup.directory,'trace.json');process.env.CLAUDE_TEST_DESCRIPTOR=JSON.stringify(descriptor());delete process.env.CLAUDE_TEST_MODE;
  t.after(()=>{for(const key of keys)if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];});
  return {...setup,trace:async()=>JSON.parse(await readFile(process.env.CLAUDE_TEST_TRACE,'utf8'))};
}

test('the runAgent bridge preserves successful read receipts and changes tool loading only in the selected Claude session',async t=>{
  const f=await cliFixture(t);const result=await runAgent({provider:'claude',cwd:f.directory,prompt:'Vérifier un accès.',connectorPlan:f.plan,readOnly:true});
  assert.equal(result.text,'Lecture contrôlée.');assert.ok(isTrustedConnectorReadReceipt(result.connectorReadReceipt));assert.deepEqual(result.connectorReadReceipt.tools,[{name:'list_labels',successfulCalls:1}]);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  const trace=await f.trace();assert.deepEqual(trace.types,['initialize','mcp_status','user']);assert.equal(trace.userCount,1);assert.equal(trace.enableToolSearch,'false');assert.equal(process.env.ENABLE_TOOL_SEARCH,'true');for(const flag of ['--input-format','--no-session-persistence','--no-chrome','--disable-slash-commands'])assert.ok(trace.args.includes(flag));assert.equal(trace.args[trace.args.indexOf('--setting-sources')+1],'');
});

test('cancelling Claude during preflight kills its process group and sends no user frame or account request',async t=>{
  const f=await cliFixture(t),controller=new AbortController();process.env.CLAUDE_TEST_MODE='pending';const operation=runAgent({provider:'claude',cwd:f.directory,prompt:'Ne part pas avant preuve.',connectorPlan:f.plan,signal:controller.signal});
  let trace;for(let attempt=0;attempt<100;attempt++){try{trace=await f.trace();if(trace.workerPid)break;}catch{}await delay(20);}
  assert.ok(trace?.workerPid);controller.abort();await assert.rejects(operation,cause=>cause.name==='AbortError');assert.equal((await f.trace()).userCount,0);
  let alive=true;for(let attempt=0;attempt<40;attempt++){try{process.kill(trace.workerPid,0);}catch{alive=false;break;}await delay(25);}assert.equal(alive,false);
});
