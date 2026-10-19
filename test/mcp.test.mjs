import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createHandler, handleRequest, main, normalizeServerURL } from '../mcp.mjs';

const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const tool = (name, args = {}) => rpc('tools/call', { name, arguments: args });
const options = (fetchImpl) => ({ fetchImpl, url: 'http://127.0.0.1:4850' });
const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });

test('initialize negotiates MCP versions and lists five honestly annotated tools', async () => {
  const handle = createHandler(options(() => { throw new Error('No network expected'); }));
  const initialized = await handle(rpc('initialize', { protocolVersion: '2024-11-05' }));
  assert.equal(initialized.result.protocolVersion, '2024-11-05');
  assert.deepEqual(initialized.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await handle(rpc('initialize', { protocolVersion: 'unknown' }))).result.protocolVersion, '2025-11-25');
  const { tools } = (await handle(rpc('tools/list'))).result;
  assert.equal(tools.length, 5);
  assert.equal(tools.find((entry) => entry.name === 'oscar_start_mission').annotations.openWorldHint, true);
  assert.equal(tools.find((entry) => entry.name === 'oscar_start_mission').inputSchema.properties.prompt.maxLength, 16000);
  assert.equal(tools.find((entry) => entry.name === 'oscar_stop_mission').annotations.readOnlyHint, false);
  assert.equal(tools.find((entry) => entry.name === 'oscar_status').annotations.readOnlyHint, true);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('local URL configuration rejects remote hosts, credentials, redirects bases and HTTPS', () => {
  assert.equal(normalizeServerURL('http://localhost:4851/'), 'http://localhost:4851');
  assert.equal(normalizeServerURL('http://127.0.0.2:4850'), 'http://127.0.0.2:4850');
  for (const value of ['https://localhost:4850', 'http://example.com', 'http://localhost.example.com', 'http://user:password@localhost', 'http://localhost/path', 'http://localhost/?token=x', 'file:///tmp/a', 'not a URL']) {
    assert.throws(() => normalizeServerURL(value), /ATELIER_URL/);
  }
});

test('tools map to API routes with local mutation headers and immediate mission results', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return jsonResponse({ id: 'mission-123', status: 'running' }); };
  const handle = createHandler(options(fetchImpl));
  const started = await handle(tool('oscar_start_mission', { prompt: 'Préparer une note', provider: 'demo' }));
  assert.equal(started.result.isError, undefined);
  assert.equal(JSON.parse(started.result.content[0].text).status, 'running');
  await handle(tool('oscar_status'));
  await handle(tool('oscar_read_mission', { missionId: 'mission-123' }));
  await handle(tool('oscar_stop_mission', { missionId: 'mission-123' }));
  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:4850/api/missions', 'http://127.0.0.1:4850/api/state',
    'http://127.0.0.1:4850/api/missions/mission-123', 'http://127.0.0.1:4850/api/missions/mission-123/stop',
  ]);
  assert.equal(calls[0].init.headers['X-Oscar-Client'], '1');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { prompt: 'Préparer une note', provider: 'demo' });
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[3].init.method, 'POST');
  assert.equal(calls[3].init.body, '{}');
});

test('invalid tool arguments cannot reach API or escape a mission', async () => {
  let count = 0;
  const handle = createHandler(options(async () => { count++; return jsonResponse({}); }));
  const requests = [
    tool('oscar_start_mission', { prompt: '  ', provider: 'demo' }),
    tool('oscar_start_mission', { prompt: 'x'.repeat(16001), provider: 'demo' }),
    tool('oscar_start_mission', { prompt: 'Hello', provider: 'remote' }),
    tool('oscar_status', { secret: true }),
    tool('oscar_read_mission', { missionId: '../other' }),
    tool('oscar_read_deliverable', { missionId: 'ok', path: '../secret' }),
    tool('oscar_read_deliverable', { missionId: 'ok', path: '/etc/passwd' }),
    tool('oscar_read_deliverable', { missionId: 'ok', path: 'dir\\secret' }),
    tool('oscar_read_deliverable', { missionId: 'ok', path: 'a/../../secret' }),
    tool('oscar_stop_mission', null),
  ];
  for (const request of requests) assert.equal((await handle(request)).result.isError, true);
  assert.equal(count, 0);
  const maximumLength = await handle(tool('oscar_start_mission', { prompt: 'x'.repeat(16000), provider: 'demo' }));
  assert.equal(maximumLength.result.isError, undefined);
  assert.equal(count, 1);
});

test('deliverable reads preserve text and encode subpaths, including spaces and Unicode', async () => {
  let fetchedURL;
  const response = await handleRequest(tool('oscar_read_deliverable', { missionId: 'm1', path: 'rédaction/ma note.md' }), options(async (url) => {
    fetchedURL = url;
    return jsonResponse({ path: 'rédaction/ma note.md', content: '# Texte\nUne note.' });
  }));
  assert.equal(fetchedURL, 'http://127.0.0.1:4850/api/missions/m1/files/r%C3%A9daction/ma%20note.md');
  assert.equal(response.result.content[0].text, '# Texte\nUne note.');
  const plain = await handleRequest(tool('oscar_read_deliverable', { missionId: 'm1', path: 'note.txt' }), options(async () => new Response('Bonjour\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
  assert.equal(plain.result.content[0].text, 'Bonjour\n');
});

test('deliverables reject binary and oversize responses and measure UTF-8 bytes', async () => {
  const request = tool('oscar_read_deliverable', { missionId: 'm1', path: 'note.txt' });
  for (const makeResponse of [
    () => jsonResponse({ content: 'é'.repeat(140000) }),
    () => jsonResponse({ content: 'A\0B' }),
    () => new Response('image', { headers: { 'Content-Type': 'image/png' } }),
    () => new Response('a'.repeat(2 * 1024 * 1024 + 1)),
    () => new Response(Uint8Array.of(0xff, 0xfe), { headers: { 'Content-Type': 'text/plain' } }),
  ]) {
    const response = await handleRequest(request, options(async () => makeResponse()));
    assert.equal(response.result.isError, true);
  }
  const exact = await handleRequest(request, options(async () => jsonResponse({ content: 'é'.repeat(131072) })));
  assert.equal(exact.result.isError, undefined);
});

test('API failures return safe French tool errors without stack traces', async () => {
  const failed = await handleRequest(tool('oscar_status'), options(async () => { throw new Error('private connection data'); }));
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /Impossible de joindre/);
  assert.doesNotMatch(failed.result.content[0].text, /private connection data|stack/);
  const missing = await handleRequest(tool('oscar_read_mission', { missionId: 'missing' }), options(async () => jsonResponse({ error: 'Mission introuvable.' }, { status: 404 })));
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /404.*Mission introuvable/);
  const timedOut = await handleRequest(tool('oscar_status'), options(async () => { throw new DOMException('timeout', 'TimeoutError'); }));
  assert.match(timedOut.result.content[0].text, /délai prévu/);
});

test('protocol rejects unknown methods, tools and malformed JSON-RPC', async () => {
  assert.equal((await handleRequest(rpc('unknown'), options())).error.code, -32601);
  assert.equal((await handleRequest(tool('unknown'), options())).error.code, -32602);
  for (const request of [[], null, { jsonrpc: '1.0', id: 1, method: 'ping' }, rpc('ping', []), { jsonrpc: '2.0', id: {}, method: 'ping' }]) {
    assert.equal((await handleRequest(request, options())).error.code, -32600);
  }
});

test('stdio emits only one-line protocol responses and ignores notifications', async () => {
  let stdout = '';
  let stderr = '';
  const output = new Writable({ write(chunk, _encoding, next) { stdout += chunk.toString(); next(); } });
  const errorOutput = new Writable({ write(chunk, _encoding, next) { stderr += chunk.toString(); next(); } });
  const input = Readable.from([
    '{broken\n',
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    `${JSON.stringify(rpc('ping', {}, 'ping-1'))}\n`,
    `${JSON.stringify(tool('oscar_status'))}\n`,
  ]);
  await main({ input, output, errorOutput, ...options(async () => jsonResponse({ status: 'ready' })) });
  const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].error.code, -32700);
  assert.deepEqual(lines[1], { jsonrpc: '2.0', id: 'ping-1', result: {} });
  assert.equal(JSON.parse(lines[2].result.content[0].text).status, 'ready');
  assert.equal(stderr, '');
});
