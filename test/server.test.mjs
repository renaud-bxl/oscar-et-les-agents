import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAtelierServer, resolveServerDataDirectory } from '../server.mjs';
import { createHandler } from '../mcp.mjs';
test('HTTP et MCP : mission simulée, livraison et protection des fichiers', async t => {
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-http-'));
  const app=await createAtelierServer({port:0,dataDir,providers:[],demoDelay:0,runner:()=>{throw new Error('Pas d’IA en démonstration');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const status=await fetch(base+'/api/state');assert.equal(status.status,200);assert.deepEqual((await status.json()).missions,[]);
  const denied=await fetch(base+'/api/missions',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://un-autre-site.invalid'},body:JSON.stringify({prompt:'x',provider:'demo'})});assert.equal(denied.status,403);
  const noOrigin=await fetch(base+'/api/missions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noOrigin.status,403);
  const mcp=createHandler({url:base});
  const start=await mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'oscar_start_mission',arguments:{prompt:'Découvrir Oscar',provider:'demo'}}});
  assert(!start.result.isError);const mission=JSON.parse(start.result.content[0].text);await app.engine.wait(mission.id);
  const done=await fetch(base+'/api/missions/'+mission.id).then(r=>r.json());assert.equal(done.status,'completed');
  const output=await mcp({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'oscar_read_deliverable',arguments:{missionId:mission.id,path:'Demonstration.md'}}});assert(output.result.content[0].text.includes('entièrement simulé'));
  const f=await fetch(base+`/api/missions/${mission.id}/files/Demonstration.md`);assert(f.headers.get('content-disposition').startsWith('attachment'));assert(f.headers.get('content-security-policy').includes('sandbox'));
  const outside=path.join(dataDir,'private.txt');writeFileSync(outside,'NE PAS LIRE');
  symlinkSync(outside,path.join(app.engine.workDir(mission.id),'sortie.txt'));
  const symlink=await fetch(base+`/api/missions/${mission.id}/files/sortie.txt`);assert.equal(symlink.status,403);
  const traversal=await fetch(base+`/api/missions/${mission.id}/files/..%2F..%2Fprivate.txt`);assert.equal(traversal.status,403);
  const nullBody=await fetch(base+'/api/missions',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:'null'});assert.equal(nullBody.status,400);
});

test('le dossier par défaut est dans Documents et les anciens chemins explicites restent compatibles', () => {
  assert.equal(resolveServerDataDirectory({}), path.join(os.homedir(), 'Documents', 'Oscar et les agents'));
  assert.equal(resolveServerDataDirectory({ ATELIER_DATA_DIR: '/tmp/ancien-dossier' }), '/tmp/ancien-dossier');
  assert.equal(resolveServerDataDirectory({ ATELIER_DATA_DIR: '/tmp/ancien-dossier', OSCAR_DATA_DIR: '/tmp/nouveau-dossier' }), '/tmp/nouveau-dossier');
});

test('HTTP autorise quatre missions et réserve chaque connexion à son propre moteur', async t => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-parallel-http-'));
  const loginCalls = [];
  const app = await createAtelierServer({
    port: 0, dataDir,
    providers: [{ id: 'codex', available: true }, { id: 'claude', available: true }],
    runner: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Arrêt demandé')), { once: true })),
    loginFactory: () => ({ start: async provider => { loginCalls.push(provider); return { status: 'connecting' }; }, close() {} }),
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, body = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify(body) });
  const first = await post('/api/missions', { prompt: 'Projet Codex', provider: 'codex' });
  assert.equal(first.status, 202);
  assert.equal((await post('/api/providers/codex/login')).status, 409);
  assert.equal((await post('/api/providers/claude/login')).status, 202);
  assert.deepEqual(loginCalls, ['claude']);
  const created = [await first.json()];
  for (let index = 0; index < 3; index++) {
    const response = await post('/api/missions', { prompt: `Autre projet ${index + 1}`, provider: 'claude' });
    assert.equal(response.status, 202);
    created.push(await response.json());
  }
  assert.equal((await post('/api/providers/claude/login')).status, 409);
  const full = await post('/api/missions', { prompt: 'Un projet en trop', provider: 'codex' });
  assert.equal(full.status, 409);
  assert.match((await full.json()).error, /Quatre missions/);
  const state = await fetch(base + '/api/state').then(response => response.json());
  assert.equal(state.activeMissions.length, 4);
  assert.equal(state.maxConcurrentMissions, 4);
  assert.equal(state.active.id, created[3].id);
  const stopped = await post(`/api/missions/${created[1].id}/stop`);
  assert.equal(stopped.status, 200);
  await app.engine.wait(created[1].id);
  assert.equal(app.engine.state().activeMissions.length, 3);
  assert.ok(created.filter((_, index) => index !== 1).every(mission => app.engine.get(mission.id).status === 'planning'));
});

test('ouvrir le dossier utilise uniquement le dossier de données et exige une requête locale', async t => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-open-folder-'));
  const opened = [];
  const app = await createAtelierServer({ port: 0, dataDir, providers: [], openFolder: async folder => { opened.push(folder); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const denied = await fetch(base + '/api/open-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403);
  assert.deepEqual(opened, []);
  const response = await fetch(base + '/api/open-data', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify({ path: '/an/unrelated/folder' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(opened, [dataDir]);
  assert.equal(app.engine.demoDelay, 1800);
});
