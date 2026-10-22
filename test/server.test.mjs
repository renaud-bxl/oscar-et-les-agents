import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, realpathSync, renameSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { request as httpRequest } from 'node:http';
import { createAtelierServer, resolveServerDataDirectory, openMissionDownload } from '../server.mjs';
import { createHandler } from '../mcp.mjs';
import { Publishing } from '../lib/publishing.mjs';
const until = async predicate => { for (let i=0;i<150;i++) { if(predicate())return; await new Promise(resolve=>setTimeout(resolve,10)); } throw new Error('État HTTP attendu non atteint.'); };

test('ouvrir un livrable valide son type, chaque parent et la requête locale avant toute application native', async t => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-native-file-'));
  const opened = [];
  const app = await createAtelierServer({ port: 0, dataDir, providers: [], demoDelay: 0, openFile: async file => opened.push(file) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const mission = app.engine.start({ provider: 'demo', prompt: 'Vérifier mes fichiers locaux' }); await app.engine.wait(mission.id);
  const workDir = app.engine.workDir(mission.id), nested = path.join(workDir, 'Livraison'); mkdirSync(nested, { recursive: true });
  const files = ['rapport.pdf', 'image.PNG', 'document.docx', 'tableau.xlsx', 'presentation.pptx', 'notes.md', 'donnees.json'];
  for (const file of files) writeFileSync(path.join(nested, file), file.endsWith('.pdf') ? '%PDF-1.4\n%%EOF' : 'Fichier de test');
  writeFileSync(path.join(nested, 'code.js'), 'Aucun code exécuté'); writeFileSync(path.join(nested, 'page.html'), '<p>Pas d’ouverture native</p>'); writeFileSync(path.join(nested, 'image.svg'), '<svg/>');
  symlinkSync(path.join(nested, 'rapport.pdf'), path.join(workDir, 'lien.pdf'));
  symlinkSync(nested, path.join(workDir, 'parent-lie'));
  const outside = path.join(dataDir, 'hors-mission.pdf'); writeFileSync(outside, '%PDF-1.4'); symlinkSync(outside, path.join(workDir, 'hors-mission.pdf'));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const route = `/api/missions/${mission.id}/open-file`;
  const post = (body, endpoint = route) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify(body) });
  for (const file of files) { const response = await post({ path: 'Livraison/' + file }); assert.equal(response.status, 200, file); assert.deepEqual(await response.json(), { ok: true }); }
  assert.deepEqual(opened, files.map(file => realpathSync(path.join(nested, file))));
  for (const file of ['Livraison/code.js', 'Livraison/page.html', 'Livraison/image.svg']) assert.equal((await post({ path: file })).status, 400);
  for (const file of ['../hors-mission.pdf', outside, 'lien.pdf', 'parent-lie/rapport.pdf', 'hors-mission.pdf', 'Livraison/../Livraison/rapport.pdf', 'Livraison\\rapport.pdf', 'Livraison/rapport.pdf\0']) assert.equal((await post({ path: file })).status, 403, file);
  assert.equal((await post({ path: 'Livraison/absent.pdf' })).status, 404);
  assert.equal((await post({ path: 'Livraison/rapport.pdf' }, '/api/missions/inconnue/open-file')).status, 404);
  const external = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://outside.invalid' }, body: JSON.stringify({ path: 'Livraison/rapport.pdf' }) }); assert.equal(external.status, 403);
  const noProof = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Livraison/rapport.pdf' }) }); assert.equal(noProof.status, 403);
  assert.equal(opened.length, files.length);
  const shell = await fetch(base + '/'); assert.match(shell.headers.get('Content-Security-Policy'), /frame-src blob:/); assert.match(shell.headers.get('Content-Security-Policy'), /object-src 'none'/);
});
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

test('les téléchargements refusent les liens internes, parents liés, chemins cachés et requêtes externes', async t => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-download-files-'));
  const app = await createAtelierServer({ port: 0, dataDir, providers: [], demoDelay: 0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const mission = app.engine.start({ prompt: 'Tester les téléchargements sans moteur', provider: 'demo' }); await app.engine.wait(mission.id);
  const workDir = app.engine.workDir(mission.id), nested = path.join(workDir, 'Livraison'); mkdirSync(nested, { recursive: true });
  writeFileSync(path.join(workDir, '.confidentiel.txt'), 'NE PAS LIRE');
  writeFileSync(path.join(nested, 'notes.txt'), 'Un vrai livrable');
  symlinkSync(path.join(workDir, '.confidentiel.txt'), path.join(workDir, 'secret-visible.txt'));
  symlinkSync(path.join(nested, 'notes.txt'), path.join(workDir, 'notes-liees.txt'));
  symlinkSync(nested, path.join(workDir, 'livraison-liee'));
  const base = `http://127.0.0.1:${app.server.address().port}`, route = `/api/missions/${mission.id}/files/`;
  for (const file of ['secret-visible.txt', 'notes-liees.txt', 'livraison-liee/notes.txt', '.confidentiel.txt', 'Livraison/../.confidentiel.txt', 'Livraison\\notes.txt', 'Livraison/notes.txt\0', 'Livraison//notes.txt', 'Livraison/ notes.txt', 'C:/confidentiel.txt', 'x'.repeat(1001)]) {
    const response = await fetch(base + route + encodeURIComponent(file));
    assert.equal(response.status, 403, file);
    assert.ok(!(await response.text()).includes('NE PAS LIRE'), file);
  }
  assert.equal((await fetch(base + route + 'Livraison')).status, 403);
  assert.equal((await fetch(base + route + 'Livraison/absent.txt')).status, 404);
  assert.equal((await fetch(base + '/api/missions/inconnue/files/Livraison/notes.txt')).status, 404);
  assert.equal((await fetch(base + route + 'Livraison/notes.txt', { headers: { Origin: 'https://autre.invalid' } })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = httpRequest(base + route + 'Livraison/notes.txt', { headers: { Host: 'autre.invalid' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHost, 403);
  const valid = await fetch(base + route + 'Livraison/notes.txt', { headers: { Origin: base } }); assert.equal(valid.status, 200); assert.equal(await valid.text(), 'Un vrai livrable');
});

test('les téléchargements préservent les octets et restent inertes, bornés à la taille ouverte et attachés au fichier vérifié', async t => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-download-bytes-'));
  const app = await createAtelierServer({ port: 0, dataDir, providers: [], demoDelay: 0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const mission = app.engine.start({ prompt: 'Télécharger un fichier binaire intact', provider: 'demo' }); await app.engine.wait(mission.id);
  const workDir = app.engine.workDir(mission.id), base = `http://127.0.0.1:${app.server.address().port}`, route = `/api/missions/${mission.id}/files/`;
  const binary = Buffer.alloc(2 * 1024 * 1024 + 257); for (let i = 0; i < binary.length; i++) binary[i] = i % 256;
  const files = [['archive.bin', binary, 'application/octet-stream'], ['page.HTML', Buffer.from('<script>alert(1)</script>'), 'text/html; charset=utf-8'], ['dessin.svg', Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml'], ['vide.txt', Buffer.alloc(0), 'text/plain; charset=utf-8']];
  for (const [name, bytes, mime] of files) {
    writeFileSync(path.join(workDir, name), bytes);
    const response = await fetch(base + route + encodeURIComponent(name));
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('content-type'), mime, name); assert.equal(response.headers.get('content-length'), String(bytes.length), name);
    assert.match(response.headers.get('content-disposition'), /^attachment;/); assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'"); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, name);
  }
  const opened = await openMissionDownload(workDir, 'archive.bin');
  t.after(() => opened.handle.close());
  renameSync(path.join(workDir, 'archive.bin'), path.join(workDir, 'original.bin'));
  writeFileSync(path.join(workDir, 'archive.bin'), 'Un fichier remplacé après le contrôle');
  appendFileSync(path.join(workDir, 'original.bin'), 'Un ajout après le contrôle');
  assert.equal(opened.size, binary.length);
  const chunks = []; for await (const chunk of opened.handle.createReadStream({ start: 0, end: opened.size - 1 })) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), binary);
});

test('le dossier par défaut est dans Documents et les anciens chemins explicites restent compatibles', () => {
  assert.equal(resolveServerDataDirectory({}), path.join(os.homedir(), 'Documents', 'Oscar et les agents'));
  const temporaryRoot = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
  assert.equal(resolveServerDataDirectory({ ATELIER_DATA_DIR: '/tmp/ancien-dossier' }), path.join(temporaryRoot, 'ancien-dossier'));
  assert.equal(resolveServerDataDirectory({ ATELIER_DATA_DIR: '/tmp/ancien-dossier', OSCAR_DATA_DIR: '/tmp/nouveau-dossier' }), path.join(temporaryRoot, 'nouveau-dossier'));
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

test('HTTP prépare le moteur manquant une fois et rafraîchit l’autre abonnement sans écraser les états',async t=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-setup-http-'));
  let installed=false,release,installCalls=0;const changes=[];
  const detection=()=>[{id:'codex',name:'Codex',available:installed,auth:{loggedIn:installed,method:'chatgpt'}},{id:'claude',name:'Claude',available:true,auth:{loggedIn:true,method:'subscription'}}];
  const app=await createAtelierServer({port:0,dataDir,providers:detection(),detect:async()=>detection(),
    installer:async(options,deps)=>{
      installCalls++;
      assert.deepEqual(options,{engine:'codex',skipLogin:true,noOpen:true});
      assert.equal(deps.root,path.resolve(import.meta.dirname,'..'));assert.equal(deps.env.OSCAR_DATA_DIR,dataDir);
      assert.equal(typeof deps.interactive,'function');assert.equal(typeof deps.capture,'function');
      deps.log('CONFIDENTIAL-NPM-LOG');
      await new Promise(resolve=>{release=()=>{installed=true;resolve();};});
    },
    runner:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Arrêt demandé')),{once:true})),
  });
  app.engine.on('change',snapshot=>changes.push(snapshot));
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const post=(route,body={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body)});
  const setup=await post('/api/providers/codex/setup');assert.equal(setup.status,202);assert.equal((await setup.json()).status,'installing');
  await until(()=>release);assert.equal((await post('/api/providers/codex/setup')).status,202);assert.equal((await post('/api/providers/codex/login')).status,202);assert.equal(installCalls,1);
  const refresh=await post('/api/providers/refresh');assert.equal(refresh.status,200);const refreshed=await refresh.json();
  assert.equal(refreshed.logins.codex.status,'installing');assert.equal(refreshed.logins.claude.status,'connected');assert.equal(refreshed.providers.find(p=>p.id==='claude').auth.loggedIn,true);
  assert.equal((await post('/api/missions',{prompt:'Attendre Codex',provider:'codex'})).status,409);
  const other=await post('/api/missions',{prompt:'Une mission indépendante Claude',provider:'claude'});assert.equal(other.status,202);
  assert.equal((await post('/api/providers/claude/setup')).status,409);assert.equal((await post('/api/providers/claude/login')).status,409);
  assert.equal((await post('/api/providers/refresh')).status,200);
  release();await until(()=>app.engine.logins.codex.status==='connected');
  assert.equal(app.engine.logins.claude.status,'connected');assert.equal(app.engine.providers.find(p=>p.id==='codex').available,true);
  assert.equal((await post('/api/providers/codex/setup')).status,202);await until(()=>app.engine.logins.codex.status==='connected');assert.equal(installCalls,1);
  assert.equal(changes.some(snapshot=>snapshot.logins.codex?.status==='installing'),true);assert.equal(changes.some(snapshot=>snapshot.logins.codex?.status==='connected'),true);
  assert(!JSON.stringify(changes).includes('CONFIDENTIAL'));
  assert.equal(app.engine.state().activeMissions.length,1);
});

test('HTTP refresh et setup gardent les restrictions locales et une erreur de détection ne devient pas une connexion',async t=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-refresh-http-'));
  const app=await createAtelierServer({port:0,dataDir,providers:[],detect:async()=>{throw new Error('CONFIDENTIAL-DETECTION-ERROR');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const route of ['/api/providers/refresh','/api/providers/codex/setup']){
    const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://un-autre-site.invalid'},body:'{}'});assert.equal(response.status,403);
    const missing=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(missing.status,403);
  }
  const refresh=await fetch(base+'/api/providers/refresh',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:'{}'});
  assert.equal(refresh.status,400);assert(!JSON.stringify(await refresh.json()).includes('CONFIDENTIAL'));
  const setup=await fetch(base+'/api/providers/codex/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:'{}'});assert.equal(setup.status,202);
  await until(()=>app.engine.logins.codex.status==='failed');assert(!JSON.stringify(app.engine.state()).includes('CONFIDENTIAL'));
  assert.equal((await fetch(base+'/api/providers/autre/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:'{}'})).status,404);
});

test('les nouveaux modules de bienvenue et ambiance sont servis localement sans élargir les fichiers publics',async t=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-static-guide-'));
  const app=await createAtelierServer({port:0,dataDir,providers:[]});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const filename of ['welcome-guide.js','welcome-guide.css','ambience.js']){
    const response=await fetch(base+'/'+filename);assert.equal(response.status,200,filename);assert.match(response.headers.get('content-type'),filename.endsWith('.css')?/text\/css/:/text\/javascript/);
  }
  assert.equal((await fetch(base+'/lib/auth.mjs')).status,404);
  assert.equal((await fetch(base+'/scripts/install.mjs')).status,404);
});

test('HTTP publication : aperçu exact, confirmation, modification refusée puis transfert sans secret exposé', async t => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-publish-http-')); const uploads = []; let probes = 0;
  const app = await createAtelierServer({ port: 0, dataDir, providers: [], demoDelay: 0,
    publishingFactory: options => new Publishing({ ...options, find: async name => '/mock/' + name, run: async (binary, args, opts) => {
      if (args.includes('user')) { probes++; return { code: 0, stdout: 'renaud' }; }
      uploads.push({ binary, args, input: opts.input }); return { code: 0 };
    } }),
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, body = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify(body) });
  const capabilities = await fetch(base + '/api/publishing').then(response => response.json());
  assert.equal(capabilities.github.user, 'renaud'); assert.equal(capabilities.ftp.available, true);
  await fetch(base + '/api/publishing'); assert.equal(probes, 1);
  const login = await post('/api/publishing/github/login'); assert.equal(login.status, 202);
  await until(() => !app.publishing.loginJob); assert.equal(app.publishing.github.status, 'connected');
  const mission = app.engine.start({ prompt: 'Site à publier', provider: 'demo' }); await app.engine.wait(mission.id);
  const site = path.join(app.engine.workDir(mission.id), 'index.html'); writeFileSync(site, '<title>Site confirmé</title>');
  const route = `/api/missions/${mission.id}/publication`;
  assert.equal((await fetch(base + route).then(response => response.json())).status, 'idle');
  const body = { kind: 'ftp', ftp: { host: 'ftp.exemple.be', username: 'compte-prive', password: 'HTTP-PASSWORD-SECRET', directory: '/site', publicUrl: 'https://exemple.be/' } };
  let previewResponse = await post(route + '/preview', body); assert.equal(previewResponse.status, 200);
  let preview = await previewResponse.json(); assert.deepEqual(preview.files.map(file => file.path), ['index.html']);
  assert(!JSON.stringify(preview).includes('HTTP-PASSWORD')); assert(!JSON.stringify(preview).includes('compte-prive'));
  assert.equal((await post(route, { ...body, digest: preview.digest })).status, 400);
  writeFileSync(site, '<title>Site changé</title>');
  assert.equal((await post(route, { ...body, confirmation: true, digest: preview.digest })).status, 409); assert.equal(uploads.length, 0);
  preview = await post(route + '/preview', body).then(response => response.json());
  const publication = await post(route, { ...body, confirmation: true, digest: preview.digest }); assert.equal(publication.status, 202);
  await until(() => app.publishing.get(mission.id).status === 'completed');
  const result = await fetch(base + route).then(response => response.json()); assert.equal(result.url, 'https://exemple.be/');
  assert.equal(result.kind, 'ftp'); assert.equal(uploads.length, 1); assert(uploads[0].input.includes('HTTP-PASSWORD-SECRET')); assert(!uploads[0].args.join(' ').includes('HTTP-PASSWORD'));
  assert(!JSON.stringify(result).includes('HTTP-PASSWORD')); assert(!JSON.stringify(app.engine.state()).includes('HTTP-PASSWORD'));
  assert.equal((await post('/api/missions/inconnue/publication/preview', body)).status, 404);
});

test('HTTP publication : mission active et requêtes externes refusées, code backend non public', async t => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-publish-protected-'));
  const app = await createAtelierServer({ port: 0, dataDir, providers: [{ id: 'codex', available: true }],
    runner: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Arrêt demandé')), { once: true })),
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const mission = app.engine.start({ prompt: 'Une mission qui travaille encore', provider: 'codex' });
  const previewRoute = `/api/missions/${mission.id}/publication/preview`;
  for (const route of [previewRoute, `/api/missions/${mission.id}/publication`, '/api/publishing/github/login']) {
    assert.equal((await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://autre.invalid' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  }
  const active = await fetch(base + previewRoute, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify({ kind: 'github', repo: 'projet' }) });
  assert.equal(active.status, 409); assert.match((await active.json()).error, /fin de cette mission/);
  assert.equal((await fetch(base + '/lib/publishing.mjs')).status, 404);
});
