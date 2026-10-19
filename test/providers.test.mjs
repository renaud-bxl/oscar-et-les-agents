import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { detectProviders, runAgent, MAX_AGENT_TIMEOUT_MS, isTrustedConnectorReadReceipt } from '../lib/providers.mjs';
import {Connectors,GMAIL_MCP_URL} from '../lib/connectors.mjs';
import {INHERITED_APPS,CLAUDE_READ_SERVICES,parseInheritedClaudeConnectors} from '../lib/connector-clients.mjs';
import {parseInheritedApps} from './connector-fixtures.mjs';
import {Atelier} from '../lib/orchestrator.mjs';

const claudeReadFixture=async()=>parseInheritedClaudeConnectors([{name:'claude.ai Gmail',source:'claudeai',scope:'claudeai',status:'connected',config:{type:'claudeai-proxy',url:GMAIL_MCP_URL,id:'official-gmail'},tools:[...CLAUDE_READ_SERVICES.gmail.tools.map(name=>({name,annotations:{readOnly:true}})),{name:'send_message',annotations:{}}]}]);

const fakeSource = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const provider = process.argv[1].endsWith('codex') ? 'codex' : 'claude';
if (args.includes('--version')) {
  console.log(provider === 'codex' ? 'codex-cli 0.162.0-alpha.17.2' : (process.env.FAKE_OLD ? '2.1.200' : '2.1.303 (Claude Code)'));
} else if (args.includes('--help')) {
  console.log(provider === 'codex' ? '--json --sandbox --color --skip-git-repo-check --output-schema' + (process.env.FAKE_NO_SEARCH ? '' : ' --search') : '--restricted --output-format --verbose --permission-mode "manual" "dontAsk" --permission-prompts --tools --allowedTools --strict-mcp-config --json-schema --input-format --no-session-persistence --setting-sources');
} else if (args.includes('status')) {
  if (provider === 'codex') console.error('Logged in using ChatGPT');
  else console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', neverExpose: 'sk-status-secret' }));
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  const respond = () => {
    const schemaIndex = args.indexOf('--output-schema');
    fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ provider, args, input, cwd: process.cwd(), apiKeysPresent: ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'].some(key => Boolean(process.env[key])), schema: schemaIndex >= 0 ? JSON.parse(fs.readFileSync(args[schemaIndex + 1], 'utf8')) : null }));
    const emit = value => console.log(JSON.stringify(value));
    const mode = process.env.FAKE_MODE || 'ok';
    if (mode === 'hang') {
      const worker = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.env.FAKE_PID + ".ready", "1"); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      fs.writeFileSync(process.env.FAKE_PID, String(worker.pid));
      setInterval(() => {}, 1000);
      return;
    }
    if (mode === 'malformed') { process.stdout.write('{"type":"result",secret-sk-NEVER-LEAK'); return; }
    if (mode === 'missing-terminal') { emit({ type: 'item.completed', item: { type: 'agent_message', text: 'Réponse partielle' } }); return; }
    if (mode === 'auth') {
      if (provider === 'codex') emit({ type: 'turn.failed', error: { message: 'OAuth token expired sk-NEVER-LEAK' } });
      else emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['OAuth token expired sk-NEVER-LEAK'] });
      process.exitCode = 1;
      return;
    }
    if (mode === 'exit-error') { console.error('rate limit 429 secret-sk-NEVER-LEAK'); process.exitCode = 1; return; }
    if (mode === 'permission') { emit({ type: 'result', subtype: 'success', result: 'Terminé', permission_denials: [{ tool_name: 'Write' }] }); return; }
    if (mode === 'connector-scope' || mode === 'connector-network') {
      const detail=mode==='connector-scope'?'Current action failed because this app connection is missing permissions or scopes required for this action. sk-NEVER-LEAK private@example.test':'upstream temporarily unavailable sk-NEVER-LEAK private@example.test';
      if(provider==='codex'){
        emit({ type: 'item.completed', item: {type:'mcp_tool_call',server:'codex_apps',tool:'gmail.list_labels',status:'failed',error:{message:detail}} });
        emit({ type: 'item.completed', item: {type:'agent_message',text:'Rapport terminé'} });
        emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
      }else{
        emit({type:'assistant',message:{content:[{type:'tool_use',id:'read-1',name:'mcp__claude_ai_Gmail__list_labels',input:{}}]}});
        emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-1',is_error:true,content:detail}]}});
        emit({type:'result',subtype:'success',result:'Rapport terminé'});
      }
      return;
    }
    if(mode==='connector-success'||mode==='connector-unrelated'){
      if(provider==='codex')emit({type:'item.completed',item:{type:'mcp_tool_call',server:'codex_apps',tool:mode==='connector-success'?'gmail.list_labels':'gmail.create_draft',status:'completed',result:{content:[{type:'text',text:'[]'}],isError:false}}});
      else{
        emit({type:'assistant',message:{content:[{type:'tool_use',id:'read-1',name:mode==='connector-success'?'mcp__claude_ai_Gmail__list_labels':'mcp__claude_ai_Gmail__create_draft',input:{}}]}});
        emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-1',is_error:false,content:'[]'}]}});
      }
    }
    if(mode==='connector-app-success'||mode==='connector-app-unrelated'){
      emit({type:'item.completed',item:{type:'mcp_tool_call',server:'codex_apps',tool:mode==='connector-app-success'?'files.read/list':'send',status:'completed',result:{content:[{type:'text',text:'[]'}],isError:false}}});
    }
    if(mode==='connector-identity')for(const event of JSON.parse(process.env.FAKE_CONNECTOR_EVENTS))emit(event);
    if(mode.startsWith('connector-receipt')){
      const reads=[['read-1','list_labels'],['read-1','list_labels'],['read-2','list_labels'],['read-3',provider==='codex'?'search_emails':'get_message']];
      for(const [id,name]of reads){
        if(provider==='codex')emit({type:'item.completed',item:{id,type:'mcp_tool_call',server:'codex_apps',tool:'gmail.'+name,arguments:{query:'PRIVATE-ARGUMENT',documentId:'PRIVATE-DOCUMENT'},status:'completed',result:{content:[{type:'text',text:'PRIVATE-PAYLOAD'}],isError:false}}});
        else{
          emit({type:'assistant',message:{content:[{type:'tool_use',id,name:'mcp__claude_ai_Gmail__'+name,input:{query:'PRIVATE-ARGUMENT',documentId:'PRIVATE-DOCUMENT'}}]}});
          const result={type:'user',message:{content:[{type:'tool_result',tool_use_id:id,is_error:false,content:'PRIVATE-PAYLOAD'}]}};emit(result);emit(result);
        }
      }
      if(provider==='codex')emit({type:'item.completed',item:{id:'unrelated',type:'mcp_tool_call',server:'codex_apps',tool:'gmail.create_draft',status:'completed',result:{content:[{type:'text',text:'PRIVATE-UNRELATED'}],isError:false}}});
      else{
        emit({type:'assistant',message:{content:[{type:'tool_use',id:'unrelated',name:'mcp__claude_ai_Gmail__create_draft',input:{}}]}});
        emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'unrelated',is_error:false,content:'PRIVATE-UNRELATED'}]}});
      }
      if(mode==='connector-receipt-quota'){
        if(provider==='codex')emit({type:'turn.failed',error:{message:'rate limit 429 PRIVATE-PAYLOAD'}});
        else emit({type:'result',subtype:'error_during_execution',is_error:true,errors:['rate limit 429 PRIVATE-PAYLOAD']});
        process.exitCode=1;return;
      }
      if(mode==='connector-receipt-error'){
        if(provider==='codex')emit({type:'item.completed',item:{id:'read-error',type:'mcp_tool_call',server:'codex_apps',tool:'gmail.list_labels',status:'failed',error:{message:'upstream temporarily unavailable PRIVATE-PAYLOAD'}}});
        else{
          emit({type:'assistant',message:{content:[{type:'tool_use',id:'read-error',name:'mcp__claude_ai_Gmail__list_labels',input:{}}]}});
          emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-error',is_error:true,content:'upstream temporarily unavailable PRIVATE-PAYLOAD'}]}});
        }
      }
      if(mode==='connector-receipt-no-terminal'){process.stdin.destroy();return;}
    }
    if (mode === 'unicode') {
      const content = Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Été 🌿'}}) + '\n' + JSON.stringify({type:'turn.completed',usage:{input_tokens:1}}));
      const offset = content.indexOf(Buffer.from('🌿')) + 2;
      process.stdout.write(content.subarray(0, offset));
      setTimeout(() => process.stdout.end(content.subarray(offset)), 15);
      return;
    }
    if (provider === 'codex') {
      emit({ type: 'thread.started', thread_id: 'fake-thread' });
      emit({ type: 'turn.started' });
      emit({ type: 'item.started', item: {type:'reasoning',text:'private thought never shown'} });
      emit({ type: 'item.started', item: {type:'web_search',query:'private query never shown'} });
      emit({ type: 'item.completed', item: {type:'agent_message',text:'Livrable prêt'} });
      emit({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
    } else {
      emit({ type: 'system', subtype: 'init' });
      emit({ type: 'assistant', message: {content:[{type:'thinking',thinking:'private thought never shown'},{type:'tool_use',name:'WebSearch',input:{query:'private query never shown'}},{type:'text',text:'Brouillon'}]} });
      emit({ type: 'result', subtype: 'success', result: 'Livrable Claude prêt', ...(args.includes('--json-schema') ? {structured_output:{answer:'structuré'}} : {}), usage: { input_tokens: 12, output_tokens: 6 } });
    }
  };
  if(provider==='claude'&&args.includes('--input-format')){
    let buffer='',responded=false;
    process.stdin.on('data',chunk=>{
      buffer+=chunk;let end;
      while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const frame=JSON.parse(line);
        if(frame.type==='control_request'){
          const response=frame.request.subtype==='initialize'?{}:{mcpServers:[{name:'claude.ai Gmail',source:'claudeai',scope:'claudeai',status:'connected',config:{type:'claudeai-proxy',url:'https://gmailmcp.googleapis.com/mcp/v1',id:'official-gmail'},tools:[...['get_message','get_thread','list_drafts','list_labels','search_threads'].map(name=>({name,annotations:{readOnly:true}})),{name:'send_message',annotations:{}}]}]};
          console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response}}));
        }else if(frame.type==='user'&&!responded){responded=true;input=frame.message.content;respond();}
      }
    });
  }else{process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',respond);}
}
`;

async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'oscar-provider-test-'));
  const bin = join(directory, 'bin');
  const cwd = join(directory, 'mission');
  await Promise.all([mkdir(bin), mkdir(cwd)]);
  await Promise.all(['codex', 'claude'].map(name => writeFile(join(bin, name), `#!${process.execPath}\n${fakeSource}`, { mode: 0o700 })));
  const keys = ['PATH', 'FAKE_CAPTURE', 'FAKE_MODE', 'FAKE_PID', 'FAKE_OLD', 'FAKE_NO_SEARCH', 'FAKE_CONNECTOR_EVENTS', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.PATH = bin;
  process.env.FAKE_CAPTURE = join(directory, 'capture.json');
  process.env.FAKE_PID = join(directory, 'worker.pid');
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_OLD;
  delete process.env.FAKE_NO_SEARCH;
  try {
    await fn({ cwd, directory, capture: async () => JSON.parse(await readFile(process.env.FAKE_CAPTURE, 'utf8')) });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test('détection : expose une connexion enregistrée sans certifier sa validité ni exposer les sorties', async () => {
  await fixture(async () => {
    const providers = await detectProviders();
    assert.deepEqual(providers.map(info => info.id), ['codex', 'claude']);
    for (const info of providers) {
      assert.equal(info.available, true);
      assert.equal(info.auth.loggedIn, true);
      assert.match(info.message, /validité.*confirmée/);
      assert.equal('binary' in info, false);
      assert.equal('help' in info, false);
    }
    assert.doesNotMatch(JSON.stringify(providers), /sk-status-secret/);
    assert.equal(providers.find(info => info.id === 'claude').auth.method, 'subscription');
  });
});

test('refuse Claude ancien avant toute mission', async () => {
  await fixture(async ({ cwd, directory }) => {
    process.env.FAKE_OLD = '1';
    await assert.rejects(runAgent({provider:'claude',cwd,prompt:'Mission'}), /mise à jour/);
    assert.equal((await readdir(directory)).includes('capture.json'), false);
  });
});

test('Codex : prompt stdin, configuration par défaut, sandbox, nettoyage du schéma et usage', async () => {
  await fixture(async ({ cwd, capture }) => {
    process.env.OPENAI_API_KEY = 'sk-NEVER-LEAK';
    process.env.CODEX_API_KEY = 'sk-NEVER-LEAK';
    const activities = [];
    const schema = {type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};
    const result = await runAgent({provider:'codex',cwd,prompt:'Une mission avec $() et `texte` littéraux.',schema,onActivity:value => activities.push(value)});
    assert.deepEqual(result, {text:'Livrable prêt',usage:{input_tokens:10,output_tokens:5}});
    const invocation = await capture();
    assert.equal(invocation.input, 'Une mission avec $() et `texte` littéraux.');
    assert.equal(invocation.cwd, await realpath(cwd));
    assert.equal(invocation.apiKeysPresent, false);
    assert.deepEqual(invocation.args.slice(0, 6), ['-a','never','--search','--disable','apps','exec']);
    assert.equal(invocation.args.at(-1), '-');
    assert.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], 'workspace-write');
    assert.deepEqual(invocation.schema, schema);
    assert.equal((await readdir(cwd)).some(file => file.startsWith('.oscar-schema-')), false);
    assert.doesNotMatch(invocation.args.join(' '), /--model|--ignore|bypass|danger-full/);
    assert.ok(activities.includes('Recherche sur le Web'));
    assert.doesNotMatch(activities.join(' '), /private|thought|query/);
  });
});

test('Codex : utilise la configuration officielle live si le drapeau search est absent', async () => {
  await fixture(async ({ cwd, capture }) => {
    process.env.FAKE_NO_SEARCH = '1';
    await runAgent({provider:'codex',cwd,prompt:'Rechercher une source actuelle'});
    const invocation = await capture();
    assert.deepEqual(invocation.args.slice(0, 7), ['-a','never','-c','web_search="live"','--disable','apps','exec']);
  });
});
test('Codex inherited execution exposes only the selected read tools and keeps sandbox and approvals',async()=>{
 await fixture(async({cwd,capture})=>{
  process.env.FAKE_MODE='connector-success';
  const app=INHERITED_APPS.gmail,manager=new Connectors({dataDir:cwd,find:async()=>'/fake/codex',run:async()=>({code:0,stdout:'[]'}),appInspector:async()=>parseInheritedApps({installed:{apps:[{id:app.id,enabled:true,callable:true},{id:'other-plugin',enabled:true,callable:true}]},list:{data:[{id:app.id,isEnabled:true,isAccessible:true}]},details:{apps:[{id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:[...app.tools.map(name=>({name,isEnabled:true,isReadOnly:true})),{name:'send_email',isEnabled:true,isReadOnly:false}]}]}})});
  try{const connectorPlan=await manager.readPlan({name:app.name});await runAgent({provider:'codex',cwd,prompt:'Préparer un bilan local',connectorPlan,readOnly:true});const {args}=await capture();assert.equal(args[args.indexOf('-a')+1],'never');assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.ok(args.includes('apps._default.enabled=false'));assert.ok(args.includes('apps.other-plugin.enabled=false'));assert.ok(args.find(arg=>arg.startsWith(`apps.${app.id}.tools=`)).includes('"send_email"={enabled=false}'));assert.deepEqual(args.slice(2,6),['--disable','plugins','--enable','apps']);assert.ok(!args.includes('--search'));}
  finally{await manager.close();}
 });
});
test('Codex generic app execution preserves the captured tool identity and requires a successful authorized read',async()=>{
 await fixture(async({cwd,capture})=>{
  const id='installed-documents',manager=new Connectors({dataDir:cwd,find:async()=>'/fake/codex',run:async()=>({code:0,stdout:'[]'}),appInspector:async()=>parseInheritedApps({installed:{apps:[{id,runtimeName:'Documents',enabled:true,callable:true},{id:'other-app',enabled:true,callable:true}]},details:{apps:[{id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:[{name:'files.read/list',isEnabled:true,isReadOnly:true},{name:'send',isEnabled:true,isReadOnly:false}]}]}})});
  try{
   const connectorPlan=await manager.readPlan({name:`chatgpt-${id}`});process.env.FAKE_MODE='connector-app-success';const result=await runAgent({provider:'codex',cwd,prompt:'Préparer une synthèse locale',connectorPlan,readOnly:true});
   assert.ok(isTrustedConnectorReadReceipt(result.connectorReadReceipt));assert.deepEqual(result.connectorReadReceipt,{client:'codex',service:'app',name:`chatgpt-${id}`,displayName:'Documents',appId:id,successfulCalls:1,tools:[{name:'files.read/list',successfulCalls:1}]});
   const {args}=await capture();assert.ok(args.includes('apps.other-app.enabled=false'));assert.ok(args.includes(`apps.${id}.default_tools_enabled=false`));assert.ok(args.includes(`apps.${id}.destructive_enabled=false`));assert.ok(args.includes('web_search="disabled"'));const tools=args.find(value=>value.startsWith(`apps.${id}.tools=`));assert.ok(tools.includes('"files.read/list"={enabled=true,approval_mode="auto"}'));assert.ok(tools.includes('"send"={enabled=false}'));assert.ok(!args.includes('--search'));assert.equal(args[args.indexOf('--sandbox')+1],'read-only');
   process.env.FAKE_MODE='connector-app-unrelated';await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Préparer une synthèse locale',connectorPlan,readOnly:true}),cause=>cause.code==='CONNECTOR_NO_READ');
  }finally{await manager.close();}
 });
});
test('Codex read receipts require the exact raw server and declared tool, never an app namespace or homonymous suffix',async()=>{
 await fixture(async({cwd})=>{
  const app=INHERITED_APPS.gmail,manager=new Connectors({dataDir:cwd,find:async()=>'/fake/codex',run:async()=>({code:0,stdout:'[]'}),appInspector:async()=>parseInheritedApps({installed:{apps:[{id:app.id,enabled:true,callable:true}]},details:{apps:[{id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:app.tools.map(name=>({name,isEnabled:true,isReadOnly:true}))}]}})});
  try{
   const connectorPlan=await manager.readPlan({name:app.name});process.env.FAKE_MODE='connector-identity';
   const success={id:'read-1',type:'mcp_tool_call',server:'codex_apps',tool:'gmail.list_labels',status:'completed',result:{content:[]}};
   for(const item of [{...success,server:'other_service'},{...success,server:undefined},{...success,tool:'other_app.list_labels'},{...success,tool:'other_app__list_labels'},{...success,tool:'list_labels'},{...success,tool:'mcp__codex_apps__gmail__list_labels'}]){
    process.env.FAKE_CONNECTOR_EVENTS=JSON.stringify([{type:'item.completed',item}]);
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Lecture simulée',connectorPlan,readOnly:true}),cause=>cause.code==='CONNECTOR_NO_READ'&&cause.connectorReadReceipt===undefined);
   }
   process.env.FAKE_CONNECTOR_EVENTS=JSON.stringify([{type:'item.completed',item:{...success,result:undefined}}]);
   await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Lecture sans résultat',connectorPlan,readOnly:true}),cause=>cause.code==='CONNECTOR_UNAVAILABLE'&&cause.connectorReadReceipt===undefined);
   process.env.FAKE_CONNECTOR_EVENTS=JSON.stringify([{type:'item.completed',item:success}]);
   const result=await runAgent({provider:'codex',cwd,prompt:'Lecture exacte',connectorPlan,readOnly:true});
   assert.ok(isTrustedConnectorReadReceipt(result.connectorReadReceipt));assert.deepEqual(result.connectorReadReceipt.tools,[{name:'list_labels',successfulCalls:1}]);
   process.env.FAKE_CONNECTOR_EVENTS=JSON.stringify([{type:'item.completed',item:success},{type:'error',message:'unrecoverable connector failure PRIVATE-PAYLOAD'}]);
   await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Lecture interrompue par une erreur du flux',connectorPlan,readOnly:true}),cause=>cause.connectorReadReceipt===undefined&&!/PRIVATE/.test(cause.message));
  }finally{await manager.close();}
 });
});
test('Codex local MCP receipts bind the read to the selected server and exact tool',async()=>{
 await fixture(async({cwd})=>{
  const manager=new Connectors({dataDir:cwd,find:async()=>'/fake/codex',appInspector:async()=>[],run:async(binary,args)=>({code:0,stdout:args.includes('get')?JSON.stringify({name:'mail-selected',transport:{type:'streamable_http',url:GMAIL_MCP_URL}}):JSON.stringify([{name:'mail-selected',auth_status:'OAuth'},{name:'other',auth_status:'OAuth'}])})});
  try{
   const connectorPlan=await manager.readPlan({name:'mail-selected'});process.env.FAKE_MODE='connector-identity';
   const success={id:'read-1',type:'mcp_tool_call',server:'mail-selected',tool:'list_labels',status:'completed',result:{content:[]}};
   for(const item of [{...success,server:'other'},{...success,server:'codex_apps'},{...success,tool:'mail-selected.list_labels'}]){
    process.env.FAKE_CONNECTOR_EVENTS=JSON.stringify([{type:'item.completed',item}]);
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Lecture simulée',connectorPlan,readOnly:true}),cause=>cause.code==='CONNECTOR_NO_READ');
   }
   process.env.FAKE_CONNECTOR_EVENTS=JSON.stringify([{type:'item.completed',item:success}]);
   assert.ok(isTrustedConnectorReadReceipt((await runAgent({provider:'codex',cwd,prompt:'Lecture locale exacte',connectorPlan,readOnly:true})).connectorReadReceipt));
  }finally{await manager.close();}
 });
});
test('une permission de connecteur refusée reste un échec malgré la fin normale du tour, sans exposer le compte', async () => {
 await fixture(async ({cwd}) => {
  const app=INHERITED_APPS.gmail;
  const manager=new Connectors({dataDir:cwd,find:async()=>'/fake/codex',run:async()=>({code:0,stdout:'[]'}),appInspector:async()=>parseInheritedApps({installed:{apps:[{id:app.id,enabled:true,callable:true}]},details:{apps:[{id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:app.tools.map(name=>({name,isEnabled:true,isReadOnly:true}))}]}})});
  try {
   process.env.FAKE_MODE='connector-scope';
   const connectorPlan=await manager.readPlan({name:app.name});
   await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Lire les libellés',connectorPlan}), error=>error.code==='CONNECTOR_PERMISSIONS' && /autorisations nécessaires/.test(error.message) && !/NEVER-LEAK|private@/.test(error.message));
  } finally { await manager.close(); }
 });
});

test('Claude inherits one verified account connector under restricted dontAsk with five exact read permissions',async()=>{
 await fixture(async({cwd,capture})=>{
  process.env.FAKE_MODE='connector-success';
  const manager=new Connectors({dataDir:cwd,find:async()=>'/fake/claude',appInspector:async()=>[],claudeInspector:claudeReadFixture,run:async(binary,args)=>({code:0,stdout:args[1]==='list'?`claude.ai Gmail: ${GMAIL_MCP_URL} - ✓ Connected\nother: https://example.test - ✓ Connected`:`Source: claude.ai\nURL: ${GMAIL_MCP_URL}`})});
  try{const connectorPlan=await manager.readPlan({client:'claude',name:'claudeai-gmail'});await runAgent({provider:'claude',cwd,prompt:'Préparer un bilan local',connectorPlan});const {args}=await capture();assert.ok(args.includes('--restricted'));assert.equal(args.includes('--strict-mcp-config'),false);assert.equal(args[args.indexOf('--permission-mode')+1],'dontAsk');const allowed=args[args.indexOf('--allowedTools')+1].split(',');assert.equal(allowed.filter(tool=>tool.startsWith('mcp__')).length,5);assert.ok(!allowed.some(tool=>/Bash|Agent|WebFetch|WebSearch|send|create_draft/.test(tool)));const settings=JSON.parse(args[args.indexOf('--settings')+1]);assert.deepEqual(settings.deniedMcpServers,[{serverName:'other'}]);}
  finally{await manager.close();}
 });
});

for(const provider of ['codex','claude']){
 test(`${provider}: trusted read receipts count successful calls without account content or duplicate events`,async()=>{
  await fixture(async({cwd})=>{
   const app=INHERITED_APPS.gmail;
   const manager=new Connectors({dataDir:cwd,find:async()=>`/fake/${provider}`,claudeInspector:claudeReadFixture,
    run:async(binary,args)=>({code:0,stdout:provider==='codex'?'[]':args[1]==='list'?`claude.ai Gmail: ${GMAIL_MCP_URL} - ✓ Connected`:`Source: claude.ai\nURL: ${GMAIL_MCP_URL}`}),
    appInspector:async()=>provider==='codex'?parseInheritedApps({installed:{apps:[{id:app.id,enabled:true,callable:true}]},details:{apps:[{id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:app.tools.map(name=>({name,isEnabled:true,isReadOnly:true}))}]}}):[]});
   try{
    const name=provider==='codex'?app.name:'claudeai-gmail',connectorPlan=await manager.readPlan({client:provider,name});
    process.env.FAKE_MODE='connector-receipt';const output=await runAgent({provider,cwd,prompt:'Lire en privé',connectorPlan,readOnly:true}),receipt=output.connectorReadReceipt;
    assert.ok(isTrustedConnectorReadReceipt(receipt));assert.deepEqual(receipt,{client:provider,service:'gmail',name,displayName:'Gmail',...(provider==='codex'?{appId:app.id}:{}),successfulCalls:3,tools:[{name:'list_labels',successfulCalls:2},{name:provider==='codex'?'search_emails':'get_message',successfulCalls:1}]});
    assert.ok(Object.isFrozen(receipt));assert.ok(Object.isFrozen(receipt.tools));assert.ok(receipt.tools.every(Object.isFrozen));assert.throws(()=>receipt.tools.push({name:'send',successfulCalls:1}),TypeError);assert.throws(()=>{receipt.tools[0].successfulCalls=100;},TypeError);
    assert.equal(isTrustedConnectorReadReceipt({...receipt}),false);assert.equal(isTrustedConnectorReadReceipt(JSON.parse(JSON.stringify(receipt))),false);assert.equal(isTrustedConnectorReadReceipt(Object.create(receipt)),false);assert.ok(!/PRIVATE|read-1|read-2|read-3|documentId|query|content|arguments/.test(JSON.stringify(receipt)));
    const another=await runAgent({provider,cwd,prompt:'Nouvelle réponse',connectorPlan,readOnly:true});assert.notEqual(another.connectorReadReceipt,receipt);assert.equal(another.connectorReadReceipt.successfulCalls,3);
    for(const mode of ['connector-receipt-quota','connector-receipt-error','connector-receipt-no-terminal']){
     process.env.FAKE_MODE=mode;await assert.rejects(runAgent({provider,cwd,prompt:'Lecture non validée',connectorPlan,readOnly:true}),cause=>cause.connectorReadReceipt===undefined&&!/PRIVATE/.test(cause.message));
    }
   }finally{await manager.close();}
  });
 });
}
test('ordinary model responses do not create or authenticate connector read receipts',async()=>{
 await fixture(async({cwd})=>{
  const output=await runAgent({provider:'codex',cwd,prompt:'Question publique'});assert.equal(Object.hasOwn(output,'connectorReadReceipt'),false);assert.equal(isTrustedConnectorReadReceipt({client:'codex',service:'gmail',successfulCalls:1,tools:[{name:'list_labels',successfulCalls:1}]}),false);
  for(const value of [null,undefined,'receipt',1,true])assert.equal(isTrustedConnectorReadReceipt(value),false);
 });
});

async function gmailReceipt(cwd){
 const app=INHERITED_APPS.gmail,manager=new Connectors({dataDir:cwd,find:async()=>'/fake/codex',run:async()=>({code:0,stdout:'[]'}),appInspector:async()=>parseInheritedApps({installed:{apps:[{id:app.id,enabled:true,callable:true}]},details:{apps:[{id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:app.tools.map(name=>({name,isReadOnly:true,isEnabled:true}))}]}})});
 try{const plan=await manager.readPlan({name:app.name});process.env.FAKE_MODE='connector-receipt';const output=await runAgent({provider:'codex',cwd,prompt:'Lecture simulée pour le contrôle interne',connectorPlan:plan,readOnly:true});return {plan,receipt:output.connectorReadReceipt};}finally{await manager.close();}
}
async function assertNoSavedReceipt(app,id){
 const serialized=[JSON.stringify(app.get(id)),JSON.stringify(app.state())];
 const readTree=async directory=>{for(const item of await readdir(directory,{withFileTypes:true})){const file=join(directory,item.name);if(item.isDirectory())await readTree(file);else serialized.push(await readFile(file,'utf8'));}};
 await readTree(app.missionDir(id));assert.doesNotMatch(serialized.join('\n'),/connectorReadReceipt|successfulCalls|CONSTAT TECHNIQUE|PRIVATE-(?:ARGUMENT|DOCUMENT|PAYLOAD)/);
}
test('Atelier passes a real stream receipt to Oscar without passing account access or saving the receipt',async()=>{
 await fixture(async({cwd,directory})=>{
  const {plan,receipt}=await gmailReceipt(cwd),calls=[],states=[];
  const app=new Atelier({dataDir:join(directory,'atelier'),providers:[{id:'codex',available:true}],runAgent:async options=>{
   calls.push(options);if(options.schema?.properties.answer){assert.equal(options.connectorPlan,plan);return {text:JSON.stringify({title:'Réponse simulée',answer:'Une synthèse locale, avec ses limites.'}),connectorReadReceipt:receipt};}
   assert.equal(options.connectorPlan,undefined);assert.match(options.prompt,/CONSTAT TECHNIQUE DU BUREAU/);assert.ok(options.prompt.includes(JSON.stringify(receipt)));assert.match(options.prompt,/jamais un nombre de messages ou de documents/);assert.match(options.prompt,/ne certifie ni les faits.*ni leur fraîcheur/);return {text:JSON.stringify({approved:true,feedback:'Réponse utile et limites explicites.'})};
  }});app.on('change',state=>states.push(JSON.stringify(state)));
  const mission=app.start({provider:'codex',prompt:'Fais une synthèse de mon service.'},{assistant:true,assistantMode:'service',connectorPlan:plan}),done=await app.wait(mission.id);
  assert.equal(done.status,'completed');assert.equal(calls.length,2);assert.doesNotMatch(states.join('\n'),/connectorReadReceipt|successfulCalls|CONSTAT TECHNIQUE/);await assertNoSavedReceipt(app,mission.id);
 });
});
test('Atelier clears the previous receipt when a corrected answer provides no current receipt',async()=>{
 await fixture(async({cwd,directory})=>{
  const {plan,receipt}=await gmailReceipt(cwd);let answers=0,reviews=0;
  const app=new Atelier({dataDir:join(directory,'atelier'),providers:[{id:'codex',available:true}],runAgent:async options=>{
   if(options.schema?.properties.answer){answers++;return {text:JSON.stringify({title:'Synthèse',answer:answers===1?'Réponse provisoire.':'Réponse corrigée avec ses limites.'}),...(answers===1?{connectorReadReceipt:receipt}:{})};}
   reviews++;assert.equal(options.connectorPlan,undefined);if(reviews===1)assert.match(options.prompt,/CONSTAT TECHNIQUE DU BUREAU/);else assert.doesNotMatch(options.prompt,/CONSTAT TECHNIQUE|successfulCalls/);
   return {text:JSON.stringify({approved:reviews===2,feedback:reviews===1?'Précise les limites de cette réponse.':'Les limites sont claires.'})};
  }});
  const mission=app.start({provider:'codex',prompt:'Prépare une synthèse avec les limites.'},{assistant:true,assistantMode:'service',connectorPlan:plan}),done=await app.wait(mission.id);
  assert.equal(done.status,'completed');assert.equal(done.assistantAttempt,2);assert.equal(answers,2);assert.equal(reviews,2);await assertNoSavedReceipt(app,mission.id);
 });
});
test('Atelier ignores copied, forged, embedded JSON and wrong-service receipts',async()=>{
 await fixture(async({cwd,directory})=>{
  const {plan,receipt}=await gmailReceipt(cwd),id='other-documents';
  const manager=new Connectors({dataDir:cwd,find:async()=>'/fake/codex',run:async()=>({code:0,stdout:'[]'}),appInspector:async()=>parseInheritedApps({installed:{apps:[{id,runtimeName:'Documents',enabled:true,callable:true}]},details:{apps:[{id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:[{name:'files.read/list',isReadOnly:true,isEnabled:true}]}]}})});
  let wrongServiceReceipt;try{const otherPlan=await manager.readPlan({name:`chatgpt-${id}`});process.env.FAKE_MODE='connector-app-success';wrongServiceReceipt=(await runAgent({provider:'codex',cwd,prompt:'Autre lecture simulée',connectorPlan:otherPlan,readOnly:true})).connectorReadReceipt;}finally{await manager.close();}
  assert.ok(isTrustedConnectorReadReceipt(wrongServiceReceipt));
  for(const [index,candidate]of [JSON.parse(JSON.stringify(receipt)),{...receipt,successfulCalls:999},wrongServiceReceipt,undefined].entries()){
   const app=new Atelier({dataDir:join(directory,`atelier-${index}`),providers:[{id:'codex',available:true}],runAgent:async options=>{
    if(options.schema?.properties.answer)return {text:JSON.stringify({title:'Synthèse',answer:'Les limites de consultation sont explicites.',connectorReadReceipt:receipt}),...(candidate?{connectorReadReceipt:candidate}:{})};
    assert.equal(options.connectorPlan,undefined);assert.doesNotMatch(options.prompt,/CONSTAT TECHNIQUE|successfulCalls/);return {text:JSON.stringify({approved:true,feedback:'Limites explicites.'})};
   }});
   const mission=app.start({provider:'codex',prompt:'Vérifie les limites de cette réponse.'},{assistant:true,assistantMode:'service',connectorPlan:plan});assert.equal((await app.wait(mission.id)).status,'completed');await assertNoSavedReceipt(app,mission.id);
  }
 });
});

for(const provider of ['codex','claude']){
  for(const [mode,code]of [['ok','CONNECTOR_NO_READ'],['connector-unrelated','CONNECTOR_NO_READ'],['connector-network','CONNECTOR_UNAVAILABLE'],['connector-scope','CONNECTOR_PERMISSIONS']]){
    test(`${provider}: a connector report requires a confirmed allowed read (${mode})`,async()=>{
      await fixture(async({cwd})=>{
        const app=INHERITED_APPS.gmail;
        const manager=new Connectors({dataDir:cwd,find:async()=>`/fake/${provider}`,claudeInspector:claudeReadFixture,
          run:async(binary,args)=>({code:0,stdout:provider==='codex'?'[]':args[1]==='list'?`claude.ai Gmail: ${GMAIL_MCP_URL} - ✓ Connected`:`Source: claude.ai\nURL: ${GMAIL_MCP_URL}`}),
          appInspector:async()=>provider==='codex'?parseInheritedApps({installed:{apps:[{id:app.id,enabled:true,callable:true}]},details:{apps:[{id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:app.tools.map(name=>({name,isEnabled:true,isReadOnly:true}))}]}}):[]});
        try{
          process.env.FAKE_MODE=mode;
          const connectorPlan=await manager.readPlan({client:provider,name:provider==='codex'?app.name:'claudeai-gmail'});
          await assert.rejects(runAgent({provider,cwd,prompt:'Préparer un relevé de messages',connectorPlan,readOnly:true}),cause=>cause.code===code&&!/NEVER-LEAK|private@/.test(cause.message));
        }finally{await manager.close();}
      });
    });
  }
}

test('Codex : décode les caractères multioctets et accepte une dernière ligne sans saut', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'unicode';
    const result = await runAgent({provider:'codex',cwd,prompt:'Mission',readOnly:true});
    assert.equal(result.text, 'Été 🌿');
  });
});

test('Claude : limite les outils, refuse les prompts de permission et restitue le résultat structuré', async () => {
  await fixture(async ({ cwd, capture }) => {
    process.env.ANTHROPIC_API_KEY = 'sk-NEVER-LEAK';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'secret';
    const activities = [];
    const result = await runAgent({provider:'claude',cwd,prompt:'Mission',readOnly:true,schema:{type:'object'},onActivity:value => activities.push(value)});
    assert.equal(result.text, '{"answer":"structuré"}');
    const invocation = await capture();
    assert.equal(invocation.apiKeysPresent, false);
    assert.ok(invocation.args.includes('--restricted'));
    assert.equal(invocation.args[invocation.args.indexOf('--permission-mode')+1], 'manual');
    assert.equal(invocation.args[invocation.args.indexOf('--permission-prompts')+1], 'none');
    const tools = invocation.args[invocation.args.indexOf('--tools')+1].split(',');
    assert.deepEqual(tools, ['Read','Glob','Grep','WebSearch','WebFetch']);
    assert.doesNotMatch(invocation.args.join(' '), /--model|Bash|Agent|bypass|skip-permissions/);
    assert.ok(activities.includes('Recherche sur le Web'));
    assert.doesNotMatch(activities.join(' '), /private|thought|query/);
  });
});

for (const provider of ['codex', 'claude']) {
  test(`${provider} : transforme un OAuth expiré en erreur de reconnexion sans fuite`, async () => {
    await fixture(async ({ cwd }) => {
      process.env.FAKE_MODE = 'auth';
      await assert.rejects(runAgent({provider,cwd,prompt:'Mission'}), error => /connexion expirée/.test(error.message) && !/NEVER-LEAK/.test(error.message));
    });
  });
}

test('refuse les JSON tronqués et nettoie le schéma même en échec', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'malformed';
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission',schema:{type:'object'}}), error => /JSON invalide ou incomplet/.test(error.message) && !/NEVER-LEAK/.test(error.message));
    assert.equal((await readdir(cwd)).length, 0);
  });
});

test('une réponse sans événement terminal ne devient jamais un succès', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'missing-terminal';
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission'}), /confirmation finale/);
  });
});

test('un processus en échec reste un échec, même sans événement JSON', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'exit-error';
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission'}), error => /limite d’utilisation/.test(error.message) && !/NEVER-LEAK/.test(error.message));
  });
});

test('une écriture refusée par Claude ne valide pas le livrable', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'permission';
    await assert.rejects(runAgent({provider:'claude',cwd,prompt:'Mission'}), /permissions autorisées/);
  });
});

test('un signal déjà annulé ne lance pas de CLI', async () => {
  await fixture(async ({ cwd, directory }) => {
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission',signal:AbortSignal.abort()}), {name:'AbortError'});
    assert.equal((await readdir(directory)).includes('capture.json'), false);
  });
});

test('annulation : termine le processus dédié et son descendant, puis nettoie le schéma', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'hang';
    const controller = new AbortController();
    const run = runAgent({provider:'codex',cwd,prompt:'Mission',schema:{type:'object'},signal:controller.signal});
    // Attach the rejection handler before cancelling to avoid an unhandled rejection.
    const rejected = assert.rejects(run, {name:'AbortError'});
    let workerPid;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await readFile(`${process.env.FAKE_PID}.ready`, 'utf8');
        workerPid = Number(await readFile(process.env.FAKE_PID, 'utf8'));
        break;
      } catch { await delay(20); }
    }
    assert.ok(workerPid, 'Le faux moteur a démarré son descendant.');
    controller.abort();
    await rejected;
    let alive = true;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { process.kill(workerPid, 0); await delay(20); } catch { alive = false; break; }
    }
    assert.equal(alive, false, 'Le descendant reçoit aussi la terminaison.');
    assert.equal((await readdir(cwd)).length, 0);
  });
});

test('le délai maximal est de douze minutes et un délai court arrête le faux moteur sans perdre ses fichiers', async () => {
  assert.equal(MAX_AGENT_TIMEOUT_MS, 12 * 60 * 1000);
  await fixture(async ({ cwd }) => {
    for (const timeoutMs of [0, -1, Infinity, MAX_AGENT_TIMEOUT_MS + 1]) await assert.rejects(runAgent({ provider: 'codex', cwd, prompt: 'Mission', timeoutMs }), /12 minutes/);
    await writeFile(join(cwd, 'resultat-partiel.txt'), 'À conserver');
    process.env.FAKE_MODE = 'hang';
    await assert.rejects(runAgent({ provider: 'codex', cwd, prompt: 'Mission', schema: { type: 'object' }, timeoutMs: 600 }), error => error.name === 'TimeoutError' && /600 ms/.test(error.message) && !/quatre minutes/.test(error.message));
    assert.equal(await readFile(join(cwd, 'resultat-partiel.txt'), 'utf8'), 'À conserver');
    assert.equal((await readdir(cwd)).some(file => file.startsWith('.oscar-schema-')), false);
    let workerPid;
    try { workerPid = Number(await readFile(process.env.FAKE_PID, 'utf8')); } catch { /* A deadline during CLI startup need not create a descendant. */ }
    if (workerPid) {
      let alive = true;
      for (let attempt = 0; attempt < 100; attempt++) { try { process.kill(workerPid, 0); await delay(20); } catch { alive = false; break; } }
      assert.equal(alive, false, 'Le descendant est arrêté après le délai.');
    }
  });
});
