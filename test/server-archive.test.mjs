import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { request } from 'node:http';
import { createAtelierServer } from '../server.mjs';
const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('La requête ne s’est pas arrêtée.'); };

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'oscar-archive-http-'));
  const app = await createAtelierServer({ port: 0, dataDir, providers: [], demoDelay: 0, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const mission = app.engine.start({ provider: 'demo', prompt: 'Exporter le projet de démonstration' }); await app.engine.wait(mission.id);
  return { app, mission, root: app.engine.workDir(mission.id), base: `http://127.0.0.1:${app.server.address().port}` };
}

test('HTTP archive : livraison binaire, exclusions déclarées et protections Host/Origin', async t => {
  const { app, mission, root, base } = await fixture(t), route = `/api/missions/${mission.id}/archive`;
  await mkdir(path.join(root, 'Créations')); await writeFile(path.join(root, 'Créations', 'Affiche été.bin'), Buffer.from([0, 255, 42])); await writeFile(path.join(root, '.env'), 'NE PAS LIRE');
  const response = await fetch(base + route, { headers: { Origin: base } }); assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip'); assert.match(response.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''.+\.zip$/);
  assert.equal(decodeURIComponent(response.headers.get('content-disposition').split("UTF-8''")[1]), `${mission.folderName}.zip`);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  assert.equal(response.headers.get('x-oscar-archive-excluded'), '1'); assert(Number(response.headers.get('x-oscar-archive-files')) >= 2);
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(Number(response.headers.get('content-length')), bytes.length); assert.equal(bytes.readUInt32LE(0), 0x04034b50); assert(bytes.includes(Buffer.from('Créations/Affiche été.bin'))); assert(!bytes.includes(Buffer.from('NE PAS LIRE')));
  assert.equal((await fetch(base + route, { headers: { Origin: 'https://autre.invalid' } })).status, 403);
  const deniedHost = await new Promise((resolve, reject) => { const req = request(base + route, { headers: { Host: 'autre.invalid' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); }); assert.equal(deniedHost, 403);
  assert.equal((await fetch(base + '/api/missions/inconnue/archive')).status, 404);
  await symlink(path.join(root, 'Demonstration.md'), path.join(root, 'lien.txt')); assert.equal((await fetch(base + route)).status, 403);
  app.engine.providers = [{ id: 'codex', available: true, auth: { loggedIn: true } }];
  app.engine.runAgent = ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Arrêt demandé')), { once: true }));
  const running = app.engine.start({ provider: 'codex', prompt: 'Autre test' });
  assert.equal((await fetch(base + `/api/missions/${running.id}/archive`)).status, 409); app.engine.stop(running.id); await app.engine.wait(running.id);
});

test('HTTP archive : un départ parallèle est refusé et le départ du client annule la préparation', async t => {
  const { app, mission, base } = await fixture(t), route = `/api/missions/${mission.id}/archive`, build = app.archives.create.bind(app.archives);
  let entered, observedSignal; const started = new Promise(resolve => { entered = resolve; });
  app.archives.create = async (directory, { signal }) => {
    observedSignal = signal; entered();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('annulé'), { code: 'ARCHIVE_ABORTED' })), { once: true }));
    return build(directory, { signal });
  };
  const controller = new AbortController(), first = fetch(base + route, { signal: controller.signal }); const firstOutcome = first.catch(error => error);
  await started; assert.equal((await fetch(base + route)).status, 409); controller.abort(); await firstOutcome; await until(() => observedSignal.aborted);
  app.archives.create = build;
  await new Promise(setImmediate);
  const retried = await fetch(base + route); assert.equal(retried.status, 200); await retried.arrayBuffer();
});
