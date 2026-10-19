import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import { Connectors, CONNECTOR_CATALOG, connectorName, connectorUrl, connectorEnvironment, parseCodexConnectors, parseClaudeConnectors, GMAIL_MCP_URL, GMAIL_READ_TOOLS, CALENDAR_MCP_URL, CALENDAR_READ_TOOLS, isTrustedReadPlan } from '../lib/connectors.mjs';
import { disabledMcpArguments, readConnectorArguments,claudeReadConnectorArguments } from '../lib/providers.mjs';
import {INHERITED_APPS,CLAUDE_READ_SERVICES,parseInheritedApps,inheritedClaudeIdentity,parseInheritedClaudeConnectors,verifiedClaudeReadMetadata,inspectCodexApps,inspectClaudeConnectors} from '../lib/connector-clients.mjs';
import { createAtelierServer } from '../server.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'oscar-connectors-'));
  const rows = { codex: [], claude: [] };
  const calls = [];
  const configs = new Map();
  const controls = { loginHelp: true, loginCode: 0, listCode: 0, ...options.controls };
  const find = async client => options.missing === client ? null : `/fake/${client}`;
  const run = async (binary, args, settings) => {
    const client = path.basename(binary); calls.push({ client, args: [...args], settings });
    const withoutPlugins=args[0]==='--disable'&&args[1]==='plugins';if(withoutPlugins)args=args.slice(2);
    if (args[1] === 'list') return { code: controls.listCode, stdout: client === 'codex' ? JSON.stringify(rows.codex.filter(row=>!withoutPlugins||!row.plugin)) : rows.claude.map(row => `${row.name}: https://example.test/secret?token=NEVER_DISPLAY - ${row.status === 'connected' ? '✓ Connected' : '⚠ Needs authentication'}`).join('\n') };
    if (args.includes('--help')) return { code: controls.loginHelp ? 0 : 1, stdout: controls.loginHelp ? 'Usage: mcp login <name>' : '' };
    if (args[1] === 'get') return { code: 0, stdout: typeof configs.get(args[2])==='string'?configs.get(args[2]):JSON.stringify(configs.get(args[2]) || {}) };
    if (args[1] === 'add') {
      const name = client === 'codex' ? args[2] : args[6];
      rows[client].push({ name, auth_status: 'not_logged_in', status: 'needs_auth' });
      configs.set(name, { name, transport: { type: 'streamable_http', url: args.at(-1) } });
      return { code: 0, stdout: 'Ignored diagnostics: NEVER_DISPLAY' };
    }
    if (args[1] === 'login') {
      if (controls.waitLogin) await controls.waitLogin;
      const row = rows[client].find(row => row.name === args[2]);
      if (row && controls.loginCode === 0) { row.auth_status = 'o_auth'; row.status = 'connected'; }
      return { code: controls.loginCode, stdout: 'Authorization code: NEVER_DISPLAY' };
    }
    throw new Error('Unexpected fake client call');
  };
  const claudeInspector=options.claudeInspector||(async()=>parseInheritedClaudeConnectors(rows.claude.map(row=>configs.get(row.name)).filter(value=>value&&typeof value==='object')));
  const manager = new Connectors({ dataDir, find, run,appInspector:options.appInspector||(async()=>[]),claudeInspector });
  await manager.ready;
  t.after(async () => { await manager.close(); await rm(dataDir, { recursive: true, force: true }); });
  const settle = async () => { await Promise.all([...manager.active.values()].map(item => item.completion)); };
  return { manager, dataDir, rows, calls, configs, controls, settle };
}

test('connector names and addresses reject credentials, commands and ambiguous URLs', () => {
  assert.equal(connectorName('Higgsfield'), 'oscar-higgsfield');
  assert.equal(connectorName('oscar-mon-connecteur'), 'oscar-mon-connecteur');
  for (const input of ['a.b', '--help', 'a b', 'x;touch', '', 'équipe']) assert.throws(() => connectorName(input));
  assert.equal(connectorUrl('https://mcp.higgsfield.ai/mcp'), 'https://mcp.higgsfield.ai/mcp');
  assert.equal(connectorUrl('http://127.0.0.1:9999/mcp'), 'http://127.0.0.1:9999/mcp');
  for (const input of ['file:///tmp/mcp', 'https://user:secret@example.com/mcp', 'https://example.com/mcp?token=secret', 'https://example.com/#secret', 'http://example.com/mcp', 'https://example.com/\n']) assert.throws(() => connectorUrl(input));
});

test('official catalogue separates OAuth from providers that require prior configuration', () => {
  const higgsfield = CONNECTOR_CATALOG.find(item => item.id === 'higgsfield');
  assert.equal(higgsfield.url, 'https://mcp.higgsfield.ai/mcp');
  assert.equal(higgsfield.status, 'available'); assert.match(higgsfield.reason, /crédits/);
  for (const id of ['gmail', 'calendar', 'outlook']) { const entry = CONNECTOR_CATALOG.find(item => item.id === id); assert.equal(entry.status, 'prerequisites'); assert.equal(entry.alternativeUrl, 'https://chatgpt.com/plugins'); }
  assert.equal(CONNECTOR_CATALOG.find(item => item.id === 'calendar').url, 'https://calendarmcp.googleapis.com/mcp/v1');
});

test('status parsers expose only names and verified status, never arbitrary diagnostics or credentials', () => {
  const result = parseCodexConnectors(JSON.stringify([{ name: 'gmail', auth_status: 'o_auth', transport: { http_headers: { Authorization: 'NEVER_DISPLAY' } } }, { name: 'other', auth_status: 'not_logged_in' }]));
  assert.equal(result[0].status, 'authorized'); assert.equal(result[1].status, 'needs_auth');
  assert.ok(!JSON.stringify(result).includes('NEVER_DISPLAY'));
  const claude = parseClaudeConnectors('Checking MCP server health...\nmail: https://example.com/?token=NEVER_DISPLAY - ✓ Connected\nvideo: https://example.com/ - ⚠ Needs authentication');
  assert.equal(claude[0].status, 'connected'); assert.equal(claude[1].status, 'needs_auth'); assert.ok(!JSON.stringify(claude).includes('NEVER_DISPLAY'));
  assert.throws(() => parseCodexConnectors('NEVER_DISPLAY'), /liste/);
});

test('client processes keep their normal config homes and discard API credentials', () => {
  const source = { HOME: '/normal/home', CODEX_HOME: '/normal/codex', CLAUDE_CONFIG_DIR: '/normal/claude', OPENAI_API_KEY: 'NEVER_DISPLAY', ANTHROPIC_API_KEY: 'NEVER_DISPLAY', CLAUDECODE: 'nested', MCP_CLIENT_SECRET: 'NEVER_DISPLAY' };
  const env = connectorEnvironment(source);
  for (const key of ['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) assert.equal(env[key], source[key]);
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDECODE', 'MCP_CLIENT_SECRET']) assert.equal(env[key], undefined);
});

test('reading status never installs, adds or logs in to a connector', async t => {
  const f = await fixture(t, { missing: 'claude' });
  const state = await f.manager.state(); assert.equal(state.clients.claude.available, false);
  assert.equal(state.missionAccess, 'handoff_only'); assert.equal(state.scope, 'user');
  assert.ok(f.calls.every(call => call.args[1] === 'list'));
});

test('Claude discovery has time to check remote connectors without changing the client or account',async t=>{
  const f=await fixture(t);
  f.rows.claude.push({name:'claude.ai Google Drive',status:'connected'});
  const original=f.manager.run;
  f.manager.run=async(binary,args,settings)=>{
    if(binary==='/fake/claude'&&args[1]==='list'&&settings.timeoutMs<30000)throw new Error('remote health checks exceeded ten seconds');
    return original(binary,args,settings);
  };
  const state=await f.manager.state();
  assert.equal(state.clients.claude.status,'available');
  assert.equal(state.connections.find(row=>row.client==='claude').displayName,'Google Drive');
  const claude=f.calls.find(call=>call.client==='claude'&&call.args[1]==='list');
  assert.equal(claude.settings.cwd,f.dataDir);assert.equal(claude.settings.env.HOME,process.env.HOME);
  assert.equal(claude.settings.timeoutMs,30000);
  assert.equal(f.calls.find(call=>call.client==='codex').settings.timeoutMs,10000);
  assert.ok(f.calls.every(call=>!['add','login'].includes(call.args[1])));
});

test('progressive metadata snapshots show an available account while another client is still checking',async t=>{
  const f=await fixture(t);f.rows.codex.push({name:'notes',auth_status:'o_auth'});f.rows.claude.push({name:'claude.ai Google Drive',status:'connected'});
  let release,claudeCalls=0;const gate=new Promise(resolve=>{release=resolve;});
  const original=f.manager.run;
  f.manager.run=async(binary,args,settings)=>{if(binary==='/fake/claude'&&args[1]==='list'){claudeCalls++;await gate;}return original(binary,args,settings);};
  try{
    const first=await f.manager.state({wait:false});assert.equal(first.clients.claude.status,'checking');
    await new Promise(resolve=>setImmediate(resolve));
    const during=await f.manager.state({wait:false});assert.equal(during.connections.some(row=>row.name==='notes'),true);assert.equal(during.clients.claude.status,'checking');assert.equal(claudeCalls,1);
    release();const complete=await f.manager.state();assert.equal(complete.clients.claude.status,'available');assert.equal(complete.connections.some(row=>row.displayName==='Google Drive'),true);assert.equal(claudeCalls,1);
  }finally{release();await f.manager.checking;}
});

test('a failing executable lookup completes a progressive check without leaking diagnostics or rejecting in the background',async t=>{
  const f=await fixture(t);f.manager.find=async()=>{throw new Error('SECRET-PATH-DIAGNOSTIC');};
  await f.manager.state({wait:false});
  const state=await f.manager.state();
  assert.equal(state.clients.codex.status,'failed');assert.equal(state.clients.claude.status,'failed');
  assert.equal(JSON.stringify(state).includes('SECRET'),false);assert.equal(f.manager.inspections.size,0);
});

test('a failed refresh retains service names as unverified and never retains their read permission',async t=>{
  const f=await fixture(t,{appInspector:async()=>parseInheritedApps(appMetadata())});
  const first=await f.manager.state();assert.equal(first.connections.find(row=>row.name==='chatgpt-gmail').readOnlyAutomation.available,true);
  f.controls.listCode=1;
  const failed=await f.manager.state({refresh:true}),gmail=failed.connections.find(row=>row.name==='chatgpt-gmail');
  assert.equal(failed.clients.codex.status,'failed');assert.equal(gmail.status,'unverified');assert.equal(gmail.stale,true);assert.equal(gmail.readOnlyAutomation.available,false);assert.equal(Object.hasOwn(gmail,'enabledTools'),false);
  await assert.rejects(f.manager.readPlan({name:'chatgpt-gmail'}),cause=>cause.code==='CONNECTOR_AUTH');
  f.controls.listCode=0;const restored=await f.manager.state({refresh:true}),live=restored.connections.find(row=>row.name==='chatgpt-gmail');assert.equal(live.status,'authorized');assert.equal(live.stale,undefined);assert.equal(live.readOnlyAutomation.available,true);
});

test('setup reserves a name and uses official Codex add without replacing account settings', async t => {
  const f = await fixture(t);
  const job = await f.manager.setup({ client: 'codex', connectorId: 'higgsfield', name: 'video' });
  assert.equal(job.status, 'configuring'); await f.settle();
  const add = f.calls.find(call => call.args[1] === 'add');
  assert.deepEqual(add.args, ['mcp', 'add', 'oscar-video', '--url', 'https://mcp.higgsfield.ai/mcp']);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'connectors.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.connections[0]).sort(), ['client', 'connectorId', 'name', 'url']);
  assert.deepEqual(f.manager.disabledNames(), ['oscar-video']);
  const state = await f.manager.state(); assert.equal(state.connections[0].status, 'needs_auth'); assert.ok(!JSON.stringify(state).includes('NEVER_DISPLAY'));
});

test('Claude setup explicitly uses user scope and never weakens its agent restrictions', async t => {
  const f = await fixture(t);
  await f.manager.setup({ client: 'claude', connectorId: 'custom', name: 'notes', url: 'https://notes.example.test/mcp' }); await f.settle();
  assert.deepEqual(f.calls.find(call => call.args[1] === 'add').args, ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'oscar-notes', 'https://notes.example.test/mcp']);
});

test('a duplicate name is refused before any client configuration is changed', async t => {
  const f = await fixture(t); f.rows.codex.push({ name: 'oscar-video', auth_status: 'o_auth' });
  await f.manager.setup({ client: 'codex', connectorId: 'higgsfield', name: 'video' }); await f.settle();
  assert.ok(!f.calls.some(call => call.args[1] === 'add')); assert.match((await f.manager.state()).jobs[0].message, /Aucune configuration existante/);
});

test('prerequisites and unexpected secret parameters never launch a client mutation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.setup({ client: 'codex', connectorId: 'gmail' }), /projet Google/);
  await assert.rejects(f.manager.setup({ client: 'codex', connectorId: 'higgsfield', password: 'NEVER_DISPLAY' }), /secret/);
  await assert.rejects(f.manager.auth({ client: 'codex', name: 'unmanaged' }), /Ajoutez/);
  assert.equal(f.calls.length, 0);
});

test('opening OAuth is not reported as an authenticated connection', async t => {
  const f = await fixture(t);
  await f.manager.setup({ client: 'codex', connectorId: 'higgsfield' }); await f.settle();
  let finish; f.controls.waitLogin = new Promise(resolve => { finish = resolve; });
  const job = await f.manager.auth({ client: 'codex', name: 'oscar-higgsfield' }); assert.equal(job.status, 'authorizing');
  const state = await f.manager.state({ refresh: true }); assert.equal(state.connections[0].status, 'needs_auth');
  await assert.rejects(f.manager.auth({ client: 'codex', name: 'oscar-higgsfield' }), /déjà/);
  finish(); await f.settle(); assert.equal((await f.manager.state()).connections[0].status, 'authorized');
});

test('older Claude clients give an explicit interactive authorization step', async t => {
  const f = await fixture(t);
  await f.manager.setup({ client: 'claude', connectorId: 'higgsfield' }); await f.settle();
  f.controls.loginHelp = false;
  await f.manager.auth({ client: 'claude', name: 'oscar-higgsfield' }); await f.settle();
  const job = (await f.manager.state()).jobs.at(-1); assert.equal(job.status, 'needs_auth'); assert.match(job.message, /\/mcp/);
  assert.ok(!f.calls.some(call => call.args[1] === 'login' && !call.args.includes('--help')));
});

test('handoff preserves personal text and requires review before mail or credit use', async t => {
  const f = await fixture(t);
  await f.manager.setup({ client: 'codex', connectorId: 'higgsfield' }); await f.settle();
  const count = f.calls.length;
  const result = await f.manager.handoff({ client: 'codex', name: 'oscar-higgsfield', prompt: 'Renaud — mon idée personnelle' });
  assert.ok(result.prompt.startsWith('Renaud — mon idée personnelle')); assert.match(result.prompt, /confirmation avant toute génération/); assert.match(result.prompt, /confirmation avant tout envoi/); assert.equal(f.calls.length, count);
  const plugin = await f.manager.handoff({ client: 'chatgpt', connectorId: 'gmail', prompt: 'Préparer des réponses locales' });
  assert.equal(plugin.url, 'https://chatgpt.com/plugins'); assert.match(plugin.instructions, /ne prouve pas une autorisation/);
  f.rows.codex.push({ name: 'gmail-existant', auth_status: 'o_auth' }); await f.manager.state({ refresh: true });
  const existing = await f.manager.handoff({ client: 'codex', name: 'gmail-existant', prompt: 'Mon compte déjà connecté' });
  assert.equal(existing.name, 'gmail-existant'); assert.match(existing.instructions, /session interactive/);
});

test('registry reload keeps exclusions without reading any external credential file', async t => {
  const f = await fixture(t);
  await f.manager.setup({ client: 'codex', connectorId: 'higgsfield' }); await f.settle();
  const restored = new Connectors({ dataDir: f.dataDir, find: async () => null }); await restored.ready;
  assert.deepEqual(restored.disabledNames(), ['oscar-higgsfield']); await restored.close();
  await writeFile(path.join(f.dataDir, 'connectors.json'), JSON.stringify({ connections: [{ client: 'codex', name: 'a.enabled=true', url: 'https://example.test/mcp' }] }));
  const malformed = new Connectors({ dataDir: f.dataDir }); await assert.rejects(malformed.ready, /nom invalide/); await malformed.close();
});

test('Gmail read plans verify the official URL and OAuth, and only allow five read tools', async t => {
  const f = await fixture(t);
  f.rows.codex.push({ name: 'gmail', auth_status: 'o_auth' }, { name: 'other-service', auth_status: 'o_auth' });
  f.configs.set('gmail', { name: 'gmail', transport: { type: 'streamable_http', url: GMAIL_MCP_URL } });
  const plan = await f.manager.readPlan({ client: 'codex', name: 'gmail' });
  assert.equal(isTrustedReadPlan(plan), true); assert.equal(plan.type, 'gmail'); assert.deepEqual(plan.enabledTools, GMAIL_READ_TOOLS); assert.deepEqual(plan.disabledServers, ['other-service']);
  const args = readConnectorArguments(plan); assert.ok(args.includes('mcp_servers.other-service.enabled=false')); assert.ok(args.includes('mcp_servers.gmail.enabled_tools=' + JSON.stringify(GMAIL_READ_TOOLS)));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(!JSON.stringify(args).includes('create_draft')); assert.ok(!JSON.stringify(args).includes('send')); assert.ok(Object.isFrozen(plan));
  assert.throws(() => readConnectorArguments({ ...plan }), /pas été vérifié/);
  f.configs.set('gmail', { name: 'gmail', transport: { type: 'streamable_http', url: 'https://unofficial.example.test/mcp' } });
  await assert.rejects(f.manager.readPlan({ client: 'codex', name: 'gmail' }), /serveur Gmail officiel/);
  f.configs.set('gmail', { name: 'gmail', transport: { type: 'streamable_http', url: GMAIL_MCP_URL, http_headers: { Authorization: 'NEVER_DISPLAY' } } });
  await assert.rejects(f.manager.readPlan({ client: 'codex', name: 'gmail' }), /sans en-tête/);
  f.rows.codex[0].auth_status = 'not_logged_in'; await assert.rejects(f.manager.readPlan({ client: 'codex', name: 'gmail' }), cause=>cause.code==='CONNECTOR_AUTH');
  await assert.rejects(f.manager.readPlan({ client: 'claude', name: 'gmail' }), /autorisation/);
});

function appMetadata(){
  return {installed:{apps:[...Object.values(INHERITED_APPS).map(app=>({id:app.id,runtimeName:app.displayName,enabled:true,callable:true})),{id:'other-plugin',runtimeName:'Autre plugin',enabled:true,callable:true}]},list:{data:Object.values(INHERITED_APPS).map(app=>({id:app.id,isAccessible:true,isEnabled:true,name:app.displayName}))},details:{apps:Object.values(INHERITED_APPS).map(app=>({id:app.id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:[...app.tools.map(name=>({name,isReadOnly:true,isEnabled:true})),{name:'send_email',isReadOnly:false,isEnabled:true},{name:'new_unknown_reader',isReadOnly:true,isEnabled:true}]}))}};
}
test('inherited ChatGPT access joins canonical identity, callable authorization and exact enabled read tools',()=>{
 const snapshot=appMetadata(),rows=parseInheritedApps(snapshot),gmail=rows.find(row=>row.name==='chatgpt-gmail');
 assert.equal(gmail.source,'chatgpt');assert.equal(gmail.status,'authorized');assert.deepEqual(gmail.enabledTools,INHERITED_APPS.gmail.tools);assert.equal(gmail.readOnlyAutomation.available,true);
 assert.ok(gmail.disabledTools.includes('send_email'));assert.ok(gmail.disabledTools.includes('new_unknown_reader'));
 const other=rows.find(row=>row.appId==='other-plugin');assert.equal(other.displayName,'Autre plugin');assert.equal(other.inherited,true);assert.equal(other.readOnlyAutomation.available,false);
 snapshot.installed.apps[0].callable=false;assert.equal(parseInheritedApps(snapshot).find(row=>row.name==='chatgpt-gmail').readOnlyAutomation.available,false);
 snapshot.installed.apps[0].callable=true;snapshot.details.apps[0].distributionChannel='CUSTOM';assert.equal(parseInheritedApps(snapshot).find(row=>row.name==='chatgpt-gmail').readOnlyAutomation.available,false);
 snapshot.details.apps[0].distributionChannel='DEFAULT_OAI_CATALOG';snapshot.details.apps[0].toolSummaries[0].isReadOnly=false;assert.equal(parseInheritedApps(snapshot).find(row=>row.name==='chatgpt-gmail').enabledTools.includes('search_emails'),false);
 snapshot.details.apps[0].id='a-fake-gmail-id';assert.equal(parseInheritedApps(snapshot).find(row=>row.name==='chatgpt-gmail').readOnlyAutomation.available,false);
});
function genericAppMetadata(){
 const id='connector_'+ 'a'.repeat(80);
 return {installed:{apps:[{id,runtimeName:'Documents partagés',enabled:true,callable:true},{id:'other-app',enabled:true,callable:true}]},details:{apps:[{id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:[{name:'search',isReadOnly:true,isEnabled:true},{name:'files.read/list',isReadOnly:true,isEnabled:true},{name:'send',isReadOnly:false,isEnabled:true},{name:'blocked',isReadOnly:true,isEnabled:true,disabledReason:'Unavailable'},{name:'disabled',isReadOnly:true,isEnabled:false},{name:'unknown',isEnabled:true},{name:'unsafe\"={enabled=true}',isReadOnly:true,isEnabled:true}]}]}};
}
test('all installed official apps expose only bounded, active read tools and cannot inherit identity from a name',()=>{
 const snapshot=genericAppMetadata(),id=snapshot.installed.apps[0].id;
 const connection=value=>parseInheritedApps(value).find(row=>row.appId===id);
 const row=connection(snapshot);assert.equal(row.type,'app');assert.equal(row.displayName,'Documents partagés');assert.equal(row.readOnlyAutomation.service,'app');assert.deepEqual(row.enabledTools,['search','files.read/list']);assert.deepEqual(row.disabledTools,['send','blocked','disabled','unknown']);assert.deepEqual(row.disabledApps,['other-app']);
 for(const mutate of [value=>{value.installed.apps[0].id='different-id';},value=>{value.installed.apps[0].enabled=false;},value=>{value.installed.apps[0].callable=false;},value=>{value.details.apps[0].id='different-id';},value=>{value.details.apps[0].distributionChannel='CUSTOM';},value=>{delete value.details.apps[0].distributionChannel;},value=>{value.details.apps[0].toolSummaries=Array.from({length:201},()=>({name:'search',isReadOnly:true,isEnabled:true}));}]){
  const changed=structuredClone(snapshot);mutate(changed);assert.equal(Boolean(connection(changed)?.readOnlyAutomation.available),false);
 }
 const duplicate=structuredClone(snapshot);duplicate.installed.apps.push({...duplicate.installed.apps[0]});assert.equal(parseInheritedApps(duplicate).filter(row=>row.appId===id).length,1);
 duplicate.installed.apps.push({...duplicate.installed.apps[0],callable:false});assert.equal(connection(duplicate).readOnlyAutomation.available,false);
 const contradictory=structuredClone(snapshot);contradictory.details.apps[0].toolSummaries.push({name:'search',isReadOnly:false,isEnabled:true});assert.deepEqual(connection(contradictory).enabledTools,['files.read/list']);
 const directory=structuredClone(snapshot);directory.installed.apps=[];assert.equal(parseInheritedApps(directory).length,0);
 const spoof=structuredClone(snapshot);spoof.installed.apps[0].runtimeName='Gmail';assert.equal(connection(spoof).type,'app');assert.equal(connection(spoof).appId,id);
});
test('generic app plans capture exact identity and immutable read permissions while HTTP copies remain untrusted',async t=>{
 const snapshot=genericAppMetadata(),id=snapshot.installed.apps[0].id,name=`chatgpt-${id}`;
 const f=await fixture(t,{appInspector:async()=>parseInheritedApps(snapshot)});f.rows.codex.push({name:'other-mcp',auth_status:'o_auth'});
 const state=await f.manager.state();assert.deepEqual(state.connections.find(row=>row.name===name).readOnlyAutomation,{available:true,service:'app'});assert.equal(state.connections.some(row=>Object.hasOwn(row,'enabledTools')),false);
 const plan=await f.manager.readPlan({client:'codex',name});assert.equal(plan.type,'app');assert.equal(plan.appId,id);assert.equal(plan.displayName,'Documents partagés');assert.ok(isTrustedReadPlan(plan));assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.enabledTools));assert.ok(Object.isFrozen(plan.disabledTools));assert.ok(Object.isFrozen(plan.disabledApps));
 const before=readConnectorArguments(plan);assert.ok(before.includes('apps.other-app.enabled=false'));assert.ok(before.includes('web_search="disabled"'));assert.ok(before.includes('mcp_servers={"other-mcp"={enabled=false}}'));
 const toolConfig=before.find(value=>value.startsWith(`apps.${id}.tools=`));assert.ok(toolConfig.includes('"files.read/list"={enabled=true,approval_mode="auto"}'));assert.ok(toolConfig.includes('"send"={enabled=false}'));assert.ok(!toolConfig.includes('unsafe'));
 snapshot.details.apps[0].toolSummaries[0].isReadOnly=false;assert.deepEqual(readConnectorArguments(plan),before);
 assert.throws(()=>plan.enabledTools.push('send'),TypeError);assert.throws(()=>readConnectorArguments({...plan}),/pas été vérifié/);assert.throws(()=>readConnectorArguments({...plan,appId:'forged',enabledTools:['send']}),/pas été vérifié/);
 const newer=await f.manager.readPlan({client:'codex',name});assert.deepEqual(newer.enabledTools,['files.read/list']);snapshot.installed.apps[0].callable=false;await assert.rejects(f.manager.readPlan({client:'codex',name}),cause=>cause.code==='CONNECTOR_AUTH');
 assert.ok(f.calls.every(call=>!['add','login'].includes(call.args[1])));
});
test('refresh publishes each client atomically and revokes old app reads if metadata fails',async t=>{
 const snapshot=appMetadata(),f=await fixture(t,{appInspector:async()=>parseInheritedApps(snapshot)});await f.manager.state();
 let release;const gate=new Promise(resolve=>{release=resolve;});f.rows.codex.push({name:'new-mcp',auth_status:'o_auth'});
 f.manager.appInspector=async()=>{await gate;throw new Error('SECRET');};
 try{
  await f.manager.state({refresh:true,wait:false});await new Promise(resolve=>setImmediate(resolve));const pending=await f.manager.state({wait:false});
  assert.equal(pending.clients.codex.status,'checking');assert.equal(pending.connections.find(row=>row.name==='chatgpt-gmail').readOnlyAutomation.available,true);assert.equal(pending.connections.some(row=>row.name==='new-mcp'),false);
  release();await f.manager.checking;const failed=await f.manager.state();assert.equal(failed.connections.some(row=>row.name==='new-mcp'),true);const gmail=failed.connections.find(row=>row.name==='chatgpt-gmail');assert.equal(gmail.status,'unverified');assert.equal(gmail.stale,true);assert.equal(gmail.readOnlyAutomation.available,false);assert.equal(JSON.stringify(failed).includes('SECRET'),false);
  await assert.rejects(f.manager.readPlan({name:'chatgpt-gmail'}),cause=>cause.code==='CONNECTOR_AUTH');
 }finally{release();await f.manager.checking;}
});
test('ChatGPT plans are revalidated, isolate every other app and never add a server or copy credentials',async t=>{
 const snapshot=appMetadata();let probes=0;const f=await fixture(t,{appInspector:async()=>{probes++;return parseInheritedApps(snapshot);}});f.rows.codex.push({name:'another-mcp',auth_status:'o_auth'},{name:'node_repl',auth_status:'o_auth'},{name:'code-review',plugin:true,auth_status:'o_auth'});
 const state=await f.manager.state();assert.equal(state.connections.find(row=>row.name==='chatgpt-gmail').readOnlyAutomation.available,true);assert.equal(state.connections.some(row=>Object.hasOwn(row,'enabledTools')),false);
 const plan=await f.manager.readPlan({client:'codex',name:'chatgpt-gmail'});assert.equal(plan.source,'chatgpt');assert.equal(isTrustedReadPlan(plan),true);assert.ok(probes>=2);
 const args=readConnectorArguments(plan),key=`apps.${INHERITED_APPS.gmail.id}`;
 for(const setting of ['apps._default.enabled=false',`${key}.default_tools_enabled=false`,'apps.other-plugin.enabled=false','mcp_servers={"another-mcp"={enabled=false}}'])assert.ok(args.includes(setting),setting);
 const toolTable=args.find(arg=>arg.startsWith(`${key}.tools=`));assert.ok(toolTable.includes('"send_email"={enabled=false}'));assert.ok(toolTable.includes('"read_email"={enabled=true,approval_mode="auto"}'));assert.deepEqual(plan.disabledServers,['another-mcp']);assert.ok(!args.some(arg=>arg.includes('mcp_servers."')),'CLI dotted keys must not contain literal JSON quotes');
 assert.throws(()=>readConnectorArguments({...plan}),/pas été vérifié/);assert.ok(!f.calls.some(call=>['add','login'].includes(call.args[1])));
 const handoff=await f.manager.handoff({client:'codex',name:'chatgpt-other-plugin',prompt:'Mon brief conservé'});assert.ok(handoff.prompt.startsWith('Mon brief conservé'));assert.match(handoff.prompt,/app:\/\/other-plugin/);assert.equal(handoff.missionAccess,'handoff_only');
 snapshot.installed.apps[0].callable=false;await assert.rejects(f.manager.readPlan({client:'codex',name:'chatgpt-gmail'}),/autorisation/);
});
test('routine reads never treat a directory-only app or failed metadata probe as connected',async t=>{
 const snapshot=appMetadata();snapshot.installed.apps=[];const f=await fixture(t,{appInspector:async()=>parseInheritedApps(snapshot)});const state=await f.manager.state();assert.equal(state.connections.find(row=>row.name==='chatgpt-gmail').status,'needs_auth');await assert.rejects(f.manager.readPlan({name:'chatgpt-gmail'}),/autorisation/);
 f.manager.appInspector=async()=>{throw new Error('SECRET-OAUTH-DIAGNOSTIC');};const failed=await f.manager.state({refresh:true});assert.ok(failed.connections.filter(row=>row.source==='chatgpt').every(row=>row.status==='unverified'&&row.stale&&row.readOnlyAutomation.available===false));assert.equal(JSON.stringify(failed).includes('SECRET'),false);
});
function claudeMetadata(type='gmail',overrides={}){
 const service=CLAUDE_READ_SERVICES[type];
 return {name:{gmail:'claude.ai Gmail',calendar:'claude.ai Google Calendar',drive:'claude.ai Google Drive'}[type],status:'connected',scope:'claudeai',source:'claudeai',config:{type:'claudeai-proxy',url:service.url,id:`official-${type}`},tools:[...service.tools.map(name=>({name,annotations:{readOnly:true}})),{name:{gmail:'send_message',calendar:'create_event',drive:'update_file'}[type],annotations:{readOnly:true}},{name:{gmail:'create_draft',calendar:'delete_event',drive:'trash_file'}[type],annotations:{}}],...overrides};
}
test('existing Claude account connectors require connected state, inherited provenance, exact official URL and fixed read tools',async t=>{
 const f=await fixture(t);f.rows.claude.push({name:'claude.ai Gmail',status:'connected'},{name:'claude.ai Google Calendar',status:'connected'});
 f.configs.set('claude.ai Gmail',claudeMetadata());
 f.configs.set('claude.ai Google Calendar',claudeMetadata('calendar'));
 const state=await f.manager.state(),gmail=state.connections.find(row=>row.name==='claudeai-gmail');assert.equal(gmail.source,'claude.ai');assert.equal(gmail.readOnlyAutomation.available,true);
 const plan=await f.manager.readPlan({client:'claude',name:'claudeai-gmail'});assert.equal(plan.client,'claude');assert.equal(isTrustedReadPlan(plan),true);const options=claudeReadConnectorArguments(plan);assert.deepEqual(options.allowed,GMAIL_READ_TOOLS.map(tool=>`mcp__claude_ai_Gmail__${tool}`));assert.ok(!options.allowed.some(tool=>/send|create|modify/.test(tool)));assert.throws(()=>claudeReadConnectorArguments({...plan}),/pas été vérifié/);
 const parsed=JSON.parse(options.args[1]);assert.deepEqual(parsed.allowedMcpServers,[{serverUrl:GMAIL_MCP_URL}]);assert.equal(parsed.permissions.defaultMode,'dontAsk');assert.deepEqual(parsed.deniedMcpServers,[{serverName:'claude.ai Google Calendar'}]);assert.ok(parsed.permissions.deny.includes('mcp__claude_ai_Gmail__send_message'));assert.ok(parsed.permissions.deny.includes('mcp__claude_ai_Gmail__create_draft'));assert.ok(parsed.permissions.deny.includes('mcp__claude_ai_Google_Calendar__*'));
 f.configs.set('claude.ai Gmail',claudeMetadata('gmail',{config:{type:'claudeai-proxy',id:'official-gmail',url:'https://opaque.claude.example/secret'}}));const unverified=await f.manager.state({refresh:true});assert.equal(unverified.connections.find(row=>row.name==='claudeai-gmail').status,'unverified');await assert.rejects(f.manager.readPlan({client:'claude',name:'claudeai-gmail'}),/autorisation/);
 assert.equal(inheritedClaudeIdentity('claude.ai Gmail',`Source: user\nURL: ${GMAIL_MCP_URL}`),null);assert.equal(inheritedClaudeIdentity('custom Gmail',`Source: claude.ai\nURL: ${GMAIL_MCP_URL}`),null);
 assert.ok(!f.calls.some(call=>['add','login'].includes(call.args[1])));
});
test('Claude metadata requires canonical provenance and never infers read authority from names or annotations',()=>{
 const valid=claudeMetadata(),rows=parseInheritedClaudeConnectors([valid]),row=rows[0];
 assert.equal(row.readOnlyAutomation.available,true);assert.deepEqual(row.enabledTools,GMAIL_READ_TOOLS);assert.ok(row.disabledTools.includes('send_message'));assert.equal(verifiedClaudeReadMetadata({...row}),null);assert.equal(verifiedClaudeReadMetadata(JSON.parse(JSON.stringify(row))),null);
 for(const mutate of [
  value=>{value.source='user';},value=>{value.scope='user';},value=>{delete value.source;},value=>{value.status='pending';},value=>{value.status='needs-auth';},
  value=>{value.config.type='http';},value=>{value.config.url+='?token=NEVER_DISPLAY';},value=>{value.config.url='https://gmail.example.test/mcp/v1';},value=>{value.config.headers={Authorization:'NEVER_DISPLAY'};},value=>{delete value.config.id;},
  value=>{value.tools.shift();},value=>{value.tools[0].annotations.readOnly=false;},value=>{value.tools[0].annotations.destructive=true;},value=>{value.tools.push({name:'get_message',annotations:{}});},value=>{value.tools.push({name:'unsafe(tool)',annotations:{readOnly:true}});},
 ]){const changed=structuredClone(valid);mutate(changed);assert.equal(inheritedClaudeIdentity(changed),null);assert.ok(parseInheritedClaudeConnectors([changed]).every(item=>item.readOnlyAutomation.available===false));assert.ok(!JSON.stringify(parseInheritedClaudeConnectors([changed])).includes('NEVER_DISPLAY'));}
 const renamed=claudeMetadata('gmail',{name:'claude.ai Courrier'});assert.equal(parseInheritedClaudeConnectors([renamed])[0].readOnlyAutomation.available,true);
 assert.ok(parseInheritedClaudeConnectors([valid,renamed]).every(item=>!item.readOnlyAutomation.available));
 const unknown=claudeMetadata('gmail',{name:'claude.ai Notes',config:{type:'claudeai-proxy',url:'https://notes.example.test/mcp',id:'opaque-notes'}}),unsupported=parseInheritedClaudeConnectors([unknown])[0];assert.equal(unsupported.status,'connected');assert.equal(unsupported.readOnlyAutomation.available,false);assert.match(unsupported.reason,/Aucun accès automatique/);
});
function claudeProtocolFixture(handle){
 const requests=[],kills=[],spawns=[];let child;
 const spawnImpl=(binary,args,options)=>{
  spawns.push({binary,args,options});child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=kind=>{kills.push(kind);queueMicrotask(()=>child.emit('close',0));};
  const emit=value=>queueMicrotask(()=>child.stdout.write(JSON.stringify(value)+'\n'));
  child.stdin=new Writable({write(chunk,encoding,callback){const request=JSON.parse(chunk.toString());requests.push(request);handle?.(request,emit);callback();}});return child;
 };
 return {requests,kills,spawns,spawnImpl,get child(){return child;}};
}
test('Claude control discovery sends only initialize/status, waits for a complete snapshot and refuses incoming actions',async()=>{
 let statuses=0;
 const f=claudeProtocolFixture((request,emit)=>{
  if(request.type!=='control_request')return;
  if(request.request.subtype==='initialize')emit({type:'control_request',request_id:'untrusted-action',request:{subtype:'can_use_tool',tool_name:'send_message',input:{secret:'NEVER_DISPLAY'}}});
  const response=request.request.subtype==='initialize'?{}:{mcpServers:++statuses===1?[claudeMetadata('gmail',{status:'pending'})]:[claudeMetadata(),claudeMetadata('calendar')]};
  emit({type:'control_response',response:{subtype:'success',request_id:request.request_id,response}});
 });
 const env={HOME:'/normal/home',CLAUDE_CONFIG_DIR:'/normal/claude'};
 const rows=await inspectClaudeConnectors({binary:'/fake/claude',cwd:'/local/data',env,spawnImpl:f.spawnImpl,expectedRuntimeNames:['claude.ai Gmail','claude.ai Google Calendar'],pollIntervalMs:0,timeoutMs:1000});
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.readOnlyAutomation.available));assert.ok(statuses>=3);assert.deepEqual(f.requests.filter(row=>row.type==='control_request').map(row=>row.request.subtype),['initialize','mcp_status','mcp_status','mcp_status']);
 assert.equal(f.requests.find(row=>row.type==='control_response').response.subtype,'error');assert.ok(f.requests.every(row=>!['user','assistant'].includes(row.type)));assert.ok(f.kills.includes('SIGTERM'));
 const spawn=f.spawns[0];assert.equal(spawn.options.env,env);assert.equal(spawn.options.cwd,'/local/data');for(const flag of ['--restricted','--no-session-persistence','--no-chrome'])assert.ok(spawn.args.includes(flag));assert.equal(spawn.args[spawn.args.indexOf('--tools')+1],'');assert.equal(spawn.args[spawn.args.indexOf('--permission-mode')+1],'dontAsk');
 assert.deepEqual(JSON.parse(spawn.args[spawn.args.indexOf('--settings')+1]).allowedMcpServers,[{serverUrl:GMAIL_MCP_URL},{serverUrl:CALENDAR_MCP_URL},{serverUrl:CLAUDE_READ_SERVICES.drive.url}]);assert.ok(!JSON.stringify(rows).includes('NEVER_DISPLAY'));
});
test('Claude Drive selects only reviewed file reads and denies every account mutation and the other inherited services',async t=>{
 const f=await fixture(t);f.rows.claude.push({name:'claude.ai Google Drive',status:'connected'},{name:'claude.ai Gmail',status:'connected'});f.configs.set('claude.ai Google Drive',claudeMetadata('drive'));f.configs.set('claude.ai Gmail',claudeMetadata());
 const plan=await f.manager.readPlan({client:'claude',name:'claudeai-drive'}),options=claudeReadConnectorArguments(plan),settings=JSON.parse(options.args[1]);assert.equal(plan.type,'drive');assert.equal(plan.url,CLAUDE_READ_SERVICES.drive.url);assert.deepEqual(plan.enabledTools,['get_file_metadata','list_recent_files','read_file_content','search_files']);assert.ok(!options.allowed.some(name=>/update|create|share|trash|download/.test(name)));assert.ok(settings.permissions.deny.includes('mcp__claude_ai_Google_Drive__update_file'));assert.ok(settings.permissions.deny.includes('mcp__claude_ai_Google_Drive__trash_file'));assert.deepEqual(settings.allowedMcpServers,[{serverUrl:CLAUDE_READ_SERVICES.drive.url}]);assert.deepEqual(settings.deniedMcpServers,[{serverName:'claude.ai Gmail'}]);
});
test('Claude metadata timeout, cancellation and unexpected model messages fail closed and stop only their probe',async()=>{
 const keepAlive=setTimeout(()=>{},2000);
 try{
  const silent=claudeProtocolFixture();await assert.rejects(inspectClaudeConnectors({binary:'/fake/claude',spawnImpl:silent.spawnImpl,timeoutMs:15}),cause=>cause.code==='CONNECTOR_PROBE');assert.ok(silent.kills.includes('SIGTERM'));
  const aborted=new AbortController(),cancelled=claudeProtocolFixture();const operation=inspectClaudeConnectors({binary:'/fake/claude',spawnImpl:cancelled.spawnImpl,signal:aborted.signal,timeoutMs:1000});aborted.abort();await assert.rejects(operation,cause=>cause.code==='CONNECTOR_PROBE');assert.ok(cancelled.kills.includes('SIGTERM'));
  for(const type of ['user','assistant','result']){const unexpected=claudeProtocolFixture((request,emit)=>emit({type,message:'NEVER_DISPLAY'}));await assert.rejects(inspectClaudeConnectors({binary:'/fake/claude',spawnImpl:unexpected.spawnImpl,timeoutMs:1000}),cause=>cause.code==='CONNECTOR_PROBE'&&!cause.message.includes('NEVER_DISPLAY'));assert.ok(unexpected.kills.includes('SIGTERM'));}
 }finally{clearTimeout(keepAlive);}
});
test('a failed Claude metadata refresh keeps names but revokes the exact in-memory read proof',async t=>{
 const f=await fixture(t);f.rows.claude.push({name:'claude.ai Gmail',status:'connected'});f.configs.set('claude.ai Gmail',claudeMetadata());assert.equal((await f.manager.state()).connections.find(row=>row.name==='claudeai-gmail').readOnlyAutomation.available,true);
 f.manager.claudeInspector=async()=>{throw new Error('SECRET-CONFIG-DIAGNOSTIC');};const state=await f.manager.state({refresh:true}),gmail=state.connections.find(row=>row.name==='claudeai-gmail');assert.equal(gmail.status,'unverified');assert.equal(gmail.readOnlyAutomation.available,false);assert.ok(!JSON.stringify(state).includes('SECRET'));await assert.rejects(f.manager.readPlan({client:'claude',name:'claudeai-gmail'}),cause=>cause.code==='CONNECTOR_AUTH');
});
test('inherited discovery uses metadata-only RPC, refuses incoming actions and stops its dedicated process',async()=>{
 const snapshot=appMetadata(),requests=[],kills=[];let child;
 const spawnImpl=()=>{
  child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=kind=>{kills.push(kind);queueMicrotask(()=>child.emit('close',0));};
  child.stdin=new Writable({write(chunk,encoding,callback){const value=JSON.parse(chunk.toString());requests.push(value);if(value.method&&value.id!==undefined){const result=value.method==='initialize'?{}:value.method==='app/installed'?snapshot.installed:value.method==='app/list'?snapshot.list:snapshot.details;queueMicrotask(()=>child.stdout.write(JSON.stringify({id:value.id,result})+'\n'));if(value.method==='initialize')queueMicrotask(()=>child.stdout.write(JSON.stringify({id:'incoming-action',method:'item/tool/call',params:{secret:'NEVER_DISPLAY'}})+'\n'));}callback();}});return child;
 };
 const rows=await inspectCodexApps({binary:'/fake/codex',spawnImpl,timeoutMs:1000});assert.equal(rows.find(row=>row.name==='chatgpt-gmail').readOnlyAutomation.available,true);
 assert.deepEqual(requests.filter(row=>row.method).map(row=>row.method),['initialize','initialized','app/installed','app/read']);assert.equal(requests.find(row=>row.id==='incoming-action').error.code,-32601);assert.ok(kills.includes('SIGTERM'));
 assert.deepEqual(requests.find(row=>row.method==='app/read').params,{appIds:snapshot.installed.apps.map(app=>app.id),includeTools:true});
});
test('official app discovery reads every unique installed identity in batches of at most 100 without a directory lookup',async()=>{
 const apps=Array.from({length:205},(_,index)=>({id:`installed-${index}`,runtimeName:`Service ${index}`,enabled:true,callable:true}));
 const requests=[],kills=[],spawnImpl=()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=kind=>{kills.push(kind);queueMicrotask(()=>child.emit('close',0));};
  child.stdin=new Writable({write(chunk,encoding,callback){
   const request=JSON.parse(chunk.toString());requests.push(request);
   if(request.id!==undefined){
    const result=request.method==='initialize'?{}:request.method==='app/installed'?{apps:[...apps,apps[0],{id:'_default'},{id:'unsafe.id'}]}:{apps:request.params.appIds.map(id=>({id,distributionChannel:'DEFAULT_OAI_CATALOG',toolSummaries:[{name:'read',isReadOnly:true,isEnabled:true}]}))};
    queueMicrotask(()=>child.stdout.write(JSON.stringify({id:request.id,result})+'\n'));
   }callback();
  }});return child;
 };
 const rows=await inspectCodexApps({binary:'/fake/codex',spawnImpl,timeoutMs:1000}),reads=requests.filter(request=>request.method==='app/read');
 assert.equal(rows.length,205);assert.ok(rows.every(row=>row.readOnlyAutomation.available&&row.type==='app'));assert.deepEqual(reads.map(request=>request.params.appIds.length),[100,100,5]);assert.deepEqual(reads.flatMap(request=>request.params.appIds),apps.map(app=>app.id));assert.ok(reads.every(request=>request.params.includeTools===true));assert.ok(requests.every(request=>['initialize','initialized','app/installed','app/read'].includes(request.method)));assert.ok(kills.includes('SIGTERM'));
});
test('a timed-out metadata client is stopped and never exposes its diagnostics',async()=>{
 const kills=[];const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=kind=>kills.push(kind);return child;};
 const keepAlive=setTimeout(()=>{},1000);try{await assert.rejects(inspectCodexApps({binary:'/fake/codex',spawnImpl,timeoutMs:15}),cause=>cause.code==='CONNECTOR_PROBE'&&!cause.message.includes('SECRET'));assert.ok(kills.includes('SIGTERM'));}finally{clearTimeout(keepAlive);}
});
test('connector polling caches metadata for sixty seconds while explicit refresh and read plans revalidate',async t=>{
 let clock=0,probes=0;const f=await fixture(t,{appInspector:async()=>{probes++;return parseInheritedApps(appMetadata());}});f.manager.now=()=>clock;await f.manager.state();clock=10000;await f.manager.state();assert.equal(probes,1);clock=60001;await f.manager.state();assert.equal(probes,2);await f.manager.state({refresh:true});assert.equal(probes,3);await f.manager.readPlan({name:'chatgpt-gmail'});assert.equal(probes,4);
 const claude=parseClaudeConnectors('claude.ai Google Drive: https://example.test/secret?token=PRIVATE - ✓ Connected');assert.equal(claude[0].source,'claude.ai');assert.equal(claude[0].displayName,'Google Drive');assert.equal(JSON.stringify(claude).includes('PRIVATE'),false);
});

test('Calendar selection verifies the official service, never authorizes writes and is refreshed before each run', async t => {
  const f = await fixture(t);
  f.rows.codex.push({ name: 'agenda', auth_status: 'o_auth' }, { name: 'mail', auth_status: 'o_auth' }, { name: 'video', auth_status: 'o_auth' }, { name: 'not-authorized', auth_status: 'not_logged_in' });
  f.rows.claude.push({ name: 'agenda', status: 'connected' });
  f.configs.set('agenda', { name: 'agenda', transport: { type: 'streamable_http', url: CALENDAR_MCP_URL } });
  f.configs.set('mail', { name: 'mail', transport: { type: 'streamable_http', url: GMAIL_MCP_URL } });
  f.configs.set('video', { name: 'video', transport: { type: 'streamable_http', url: 'https://mcp.higgsfield.ai/mcp' }, ignoredSecret: 'NEVER_DISPLAY' });
  const state = await f.manager.state();
  const connection = name => state.connections.find(row => row.client === 'codex' && row.name === name);
  assert.deepEqual(connection('agenda').readOnlyAutomation, { available: true, service: 'calendar' });
  assert.deepEqual(connection('mail').readOnlyAutomation, { available: true, service: 'gmail' });
  for (const name of ['video', 'not-authorized']) assert.deepEqual(connection(name).readOnlyAutomation, { available: false, service: null });
  assert.equal(state.connections.find(row => row.client === 'claude').readOnlyAutomation.available, false);
  assert.ok(!JSON.stringify(state).includes('NEVER_DISPLAY'));
  assert.ok(!f.calls.some(call => ['add', 'login'].includes(call.args[1])));
  const plan = await f.manager.readPlan({ name: 'agenda' });
  assert.equal(plan.type, 'calendar'); assert.equal(plan.url, CALENDAR_MCP_URL); assert.deepEqual(plan.enabledTools, ['get_event', 'list_calendars', 'list_events', 'search_events']);
  assert.deepEqual(plan.enabledTools, CALENDAR_READ_TOOLS); assert.ok(isTrustedReadPlan(plan));
  const args = readConnectorArguments(plan);
  assert.ok(args.includes('web_search="disabled"')); assert.ok(args.includes('mcp_servers.agenda.enabled_tools=' + JSON.stringify(CALENDAR_READ_TOOLS)));
  for (const name of ['mail', 'video', 'not-authorized']) assert.ok(args.includes(`mcp_servers.${name}.enabled=false`));
  for (const tool of ['create_event', 'update_event', 'delete_event', 'respond_to_event', 'suggest_time']) assert.ok(!JSON.stringify(args).includes(tool));
  assert.throws(() => readConnectorArguments({ ...plan, type: 'gmail' }), /pas été vérifié/);
  for (const transport of [
    { type: 'streamable_http', url: CALENDAR_MCP_URL + '?token=NEVER_DISPLAY' },
    { type: 'streamable_http', url: 'https://calendar.example.test/mcp/v1' },
    { type: 'streamable_http', url: CALENDAR_MCP_URL, env_http_headers: { Authorization: 'NEVER_DISPLAY' } },
    { type: 'stdio', url: CALENDAR_MCP_URL },
  ]) {
    f.configs.set('agenda', { name: 'agenda', transport });
    await assert.rejects(f.manager.readPlan({ name: 'agenda' }), /serveur Gmail officiel ou Google Agenda officiel/);
  }
  f.configs.set('agenda', { name: 'agenda', transport: { type: 'streamable_http', url: CALENDAR_MCP_URL } });
  f.rows.codex[0].auth_status = 'not_logged_in';
  await assert.rejects(f.manager.readPlan({ name: 'agenda' }), /autorisation/);
  const refreshed = await f.manager.state({ refresh: true });
  assert.equal(refreshed.connections.find(row => row.client === 'codex' && row.name === 'agenda').readOnlyAutomation.available, false);
});

test('only application-owned exclusions become normal Codex configuration overrides', () => {
  assert.deepEqual(disabledMcpArguments(['oscar-video', 'oscar-video']), ['-c', 'mcp_servers.oscar-video.enabled=false']);
  for (const input of [['gmail'], ['oscar-a.enabled=true'], ['oscar-a"'], 'oscar-a']) assert.throws(() => disabledMcpArguments(input), /invalide/);
});

test('subprocess output is discarded for authorization and timeouts stop the process', async t => {
  const f = await fixture(t);
  const hidden = await f.manager.process(process.execPath, ['-e', 'process.stdout.write("NEVER_DISPLAY");process.stderr.write("NEVER_DISPLAY")'], { capture: false, timeoutMs: 1000 });
  assert.equal(hidden.stdout, ''); assert.equal(hidden.code, 0);
  await assert.rejects(f.manager.process(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { capture: false, timeoutMs: 40 }), /interrompue/);
});

test('local connector routes protect changes and prevent a mission starting during authorization', async t => {
  const f = await fixture(t);
  const opened = [], automationCalls = [];
  const app = await createAtelierServer({ port: 0, dataDir: f.dataDir, providers: [], demoDelay: 0, openFolder: async folder => opened.push(folder), connectorsFactory: () => f.manager, automationFactory: () => ({ start() {}, close() {}, state() { return { automations: [] }; }, create(body) { automationCalls.push(['create', body]); return { id: 'planned' }; }, update(id, body) { automationCalls.push(['update', id, body]); return { id, ...body }; }, remove(id) { automationCalls.push(['remove', id]); return { ok: true }; }, async run(id) { automationCalls.push(['run', id]); return { id, status: 'running' }; } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/connectors')).status, 200);
  const denied = await fetch(base + '/api/connectors/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(denied.status, 403);
  const setup = await post('/api/connectors/setup', { client: 'codex', connectorId: 'higgsfield' }); assert.equal(setup.status, 202); await f.settle();
  let finish; f.controls.waitLogin = new Promise(resolve => { finish = resolve; });
  assert.equal((await post('/api/connectors/auth', { client: 'codex', name: 'oscar-higgsfield' })).status, 202);
  assert.equal((await post('/api/missions', { provider: 'codex', prompt: 'Test sans modèle' })).status, 409);
  finish(); await f.settle();
  const handoff = await post('/api/connectors/handoff', { client: 'chatgpt', connectorId: 'gmail', prompt: 'Mon brief' }); assert.equal(handoff.status, 200); assert.equal((await handoff.json()).missionAccess, 'handoff_only');
  const snapshot = await post('/api/connectors/refresh', {}); assert.equal(snapshot.status, 200); assert.ok(!JSON.stringify(await snapshot.json()).includes('NEVER_DISPLAY'));
  const mission = await (await post('/api/missions', { provider: 'demo', prompt: 'Mon dossier local' })).json(); await app.engine.wait(mission.id);
  assert.equal((await post(`/api/missions/${mission.id}/open-folder`, { path: '/outside' })).status, 200);
  assert.deepEqual(opened, [app.engine.workDir(mission.id)]);
  assert.equal((await post('/api/missions/unknown/open-folder', {})).status, 404);
  assert.equal((await fetch(base + `/api/missions/${mission.id}/open-folder`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://outside.invalid' }, body: '{}' })).status, 403);
  assert.equal(opened.length, 1);
  for (const method of ['PATCH', 'DELETE']) {
    const blocked = await fetch(base + '/api/automations/planned', { method, headers: { 'Content-Type': 'application/json', Origin: 'https://outside.invalid' }, body: '{}' }); assert.equal(blocked.status, 403);
    const accepted = await fetch(base + '/api/automations/planned', { method, headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: '{}' }); assert.equal(accepted.status, 200);
  }
  assert.equal((await post('/api/automations', { label: 'Example' })).status, 201);
  assert.equal((await post('/api/automations/planned/run', {})).status, 202);
  assert.equal((await post('/api/automations/planned/pause', {})).status, 200);
  assert.equal(automationCalls.length, 5);
});
