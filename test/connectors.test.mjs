import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connectors, CONNECTOR_CATALOG, connectorName, connectorUrl, connectorEnvironment, parseCodexConnectors, parseClaudeConnectors, GMAIL_MCP_URL, GMAIL_READ_TOOLS, CALENDAR_MCP_URL, CALENDAR_READ_TOOLS, isTrustedReadPlan } from '../lib/connectors.mjs';
import { disabledMcpArguments, readConnectorArguments } from '../lib/providers.mjs';
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
    if (args[1] === 'list') return { code: controls.listCode, stdout: client === 'codex' ? JSON.stringify(rows.codex) : rows.claude.map(row => `${row.name}: https://example.test/secret?token=NEVER_DISPLAY - ${row.status === 'connected' ? '✓ Connected' : '⚠ Needs authentication'}`).join('\n') };
    if (args.includes('--help')) return { code: controls.loginHelp ? 0 : 1, stdout: controls.loginHelp ? 'Usage: mcp login <name>' : '' };
    if (args[1] === 'get') return { code: 0, stdout: JSON.stringify(configs.get(args[2]) || {}) };
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
  const manager = new Connectors({ dataDir, find, run });
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
  const args = readConnectorArguments(plan); assert.ok(args.includes('mcp_servers."other-service".enabled=false')); assert.ok(args.includes('mcp_servers."gmail".enabled_tools=' + JSON.stringify(GMAIL_READ_TOOLS)));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(!JSON.stringify(args).includes('create_draft')); assert.ok(!JSON.stringify(args).includes('send')); assert.ok(Object.isFrozen(plan));
  assert.throws(() => readConnectorArguments({ ...plan }), /pas été vérifié/);
  f.configs.set('gmail', { name: 'gmail', transport: { type: 'streamable_http', url: 'https://unofficial.example.test/mcp' } });
  await assert.rejects(f.manager.readPlan({ client: 'codex', name: 'gmail' }), /serveur Gmail officiel/);
  f.configs.set('gmail', { name: 'gmail', transport: { type: 'streamable_http', url: GMAIL_MCP_URL, http_headers: { Authorization: 'NEVER_DISPLAY' } } });
  await assert.rejects(f.manager.readPlan({ client: 'codex', name: 'gmail' }), /sans en-tête/);
  f.rows.codex[0].auth_status = 'not_logged_in'; await assert.rejects(f.manager.readPlan({ client: 'codex', name: 'gmail' }), /autorisation Gmail/);
  await assert.rejects(f.manager.readPlan({ client: 'claude', name: 'gmail' }), /Codex/);
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
  assert.ok(args.includes('web_search="disabled"')); assert.ok(args.includes('mcp_servers."agenda".enabled_tools=' + JSON.stringify(CALENDAR_READ_TOOLS)));
  for (const name of ['mail', 'video', 'not-authorized']) assert.ok(args.includes(`mcp_servers.${JSON.stringify(name)}.enabled=false`));
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
