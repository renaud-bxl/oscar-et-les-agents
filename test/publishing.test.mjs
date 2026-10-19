import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Publishing, publishingEnvironment } from '../lib/publishing.mjs';
import { PublicationDialog } from '../public/publication-dialog.js';
import { translate } from '../public/i18n.js';

const until = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('État publication attendu non atteint.'); };
const ftp = { host: 'ftp.exemple.be', protocol: 'ftps', username: 'renaud', password: 'ONE-SHOT-SECRET', directory: '/public_html', publicUrl: 'https://exemple.be/' };
const sha = n => String(n).repeat(40);
function fixture(t, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscar-publishing-test-'));
  const delivery = path.join(root, 'Livraison'); mkdirSync(delivery);
  writeFileSync(path.join(delivery, 'index.html'), '<!doctype html><title>Mon site</title>');
  writeFileSync(path.join(delivery, 'style.css'), 'body{color:green}');
  const calls = [];
  const run = async (binary, args, opts = {}) => {
    calls.push({ binary, args, ...opts });
    if (args.includes('user')) return { code: 0, stdout: 'renaud\n' };
    if (args.includes('user/repos')) return { code: 0, stdout: JSON.stringify({ full_name: 'renaud/mon-site', private: true, default_branch: 'main' }) };
    const endpoint = args.find(value => value.startsWith('repos/'));
    if (endpoint?.endsWith('/ref/heads/main')) return { code: 0, stdout: JSON.stringify({ object: { sha: sha(1) } }) };
    if (endpoint?.endsWith('/blobs')) return { code: 0, stdout: JSON.stringify({ sha: sha(2) }) };
    if (endpoint?.endsWith('/trees')) return { code: 0, stdout: JSON.stringify({ sha: sha(3) }) };
    if (endpoint?.endsWith('/commits')) return { code: 0, stdout: JSON.stringify({ sha: sha(4) }) };
    if (endpoint?.endsWith('/refs/heads/main')) return { code: 0, stdout: JSON.stringify({ object: { sha: sha(4) } }) };
    return { code: 0, stdout: '' };
  };
  const publisher = new Publishing({ getMission: id => id === 'mission' ? { status: 'completed' } : null, workDir: () => root, find: async name => '/fake/' + name, run, ...options });
  t.after(async () => { await publisher.close(); rmSync(root, { recursive: true, force: true }); });
  return { publisher, root, delivery, calls, run };
}

test('aperçu : sélection Livraison, exclusions privées, liens ignorés et manifeste exact', async t => {
  const { publisher, root, delivery } = fixture(t);
  for (const folder of ['.git', 'node_modules', 'Rapports', 'data']) { mkdirSync(path.join(delivery, folder)); writeFileSync(path.join(delivery, folder, 'secret.js'), 'PRIVATE'); }
  for (const name of ['.env', '.env.production', 'state.json', 'Livraison.md', 'token.json', 'credentials.json', 'secret.txt', 'id_rsa.pem']) writeFileSync(path.join(delivery, name), 'PRIVATE');
  writeFileSync(path.join(root, 'outside.html'), 'PRIVATE'); symlinkSync(path.join(root, 'outside.html'), path.join(delivery, 'external.html'));
  const result = await publisher.preview('mission', { kind: 'ftp', entry: '', ftp });
  assert.equal(result.root, 'Livraison'); assert.equal(result.kind, 'ftp');
  assert.deepEqual(result.files.map(file => file.path), ['index.html', 'style.css']);
  assert.deepEqual([...result.exclusions.paths].sort(), ['.git/', 'node_modules/', 'Rapports/', 'data/', '.env', '.env.production', 'state.json', 'Livraison.md', 'token.json', 'credentials.json', 'secret.txt', 'id_rsa.pem', 'external.html'].sort());
  assert.equal(result.exclusions.count,13); assert.equal(result.exclusions.truncated,false); assert.match(result.exclusions.digest,/^[a-f\d]{64}$/);
  assert(!JSON.stringify(result).includes('PRIVATE')); assert(!JSON.stringify(result).includes('secret.js'));
  assert.equal(result.totalBytes, result.files.reduce((size, file) => size + file.size, 0));
  assert.match(result.digest, /^[a-f\d]{64}$/); assert(!JSON.stringify(result).includes('ONE-SHOT')); assert(!JSON.stringify(result).includes('renaud'));
  assert.deepEqual(result.destination, { host: 'ftp.exemple.be', port: 21, protocol: 'ftps', directory: '/public_html', publicUrl: 'https://exemple.be/' });
});

test('aperçu FTP : images AVIF et audio OGG sont inclus sans lire les fichiers exclus', async t => {
  const { publisher, delivery, calls } = fixture(t);
  mkdirSync(path.join(delivery,'assets'));
  writeFileSync(path.join(delivery,'assets','hero.avif'),Buffer.from([0,1,2,3]));
  writeFileSync(path.join(delivery,'assets','ambience.ogg'),Buffer.from([79,103,103,83]));
  writeFileSync(path.join(delivery,'source.psd'),'UNSUPPORTED-PRIVATE-CONTENT');
  writeFileSync(path.join(delivery,'.env'),'FIRST-PRIVATE-CONTENT');
  const body={kind:'ftp',ftp},first=await publisher.preview('mission',body);
  assert.deepEqual(first.files.map(file=>file.path),['assets/ambience.ogg','assets/hero.avif','index.html','style.css']);
  assert.deepEqual(first.exclusions.paths,['.env','source.psd']);
  writeFileSync(path.join(delivery,'.env'),'CHANGED-PRIVATE-CONTENT');
  const second=await publisher.preview('mission',body);
  assert.equal(first.digest,second.digest);assert(!JSON.stringify(second).includes('PRIVATE-CONTENT'));assert.equal(calls.length,0);
});

test('une exclusion ajoutée ou renommée hors de la liste bornée exige un nouvel aperçu', async t => {
  const { publisher, delivery, calls } = fixture(t);
  const body={kind:'ftp',ftp},before=await publisher.preview('mission',body);
  writeFileSync(path.join(delivery,'.env'),'PRIVATE');
  await assert.rejects(publisher.publish('mission',{...body,confirmation:true,digest:before.digest}),/ont changé/);
  for(let index=0;index<150;index++)writeFileSync(path.join(delivery,`.ignored-${String(index).padStart(3,'0')}`),'PRIVATE');
  const first=await publisher.preview('mission',body);
  assert.equal(first.exclusions.count,151);assert.equal(first.exclusions.paths.length,100);assert.equal(first.exclusions.truncated,true);
  renameSync(path.join(delivery,'.ignored-149'),path.join(delivery,'.ignored-999'));
  await assert.rejects(publisher.publish('mission',{...body,confirmation:true,digest:first.digest}),/ont changé/);
  const second=await publisher.preview('mission',body);
  assert.deepEqual(first.exclusions.paths,second.exclusions.paths);assert.equal(first.exclusions.count,second.exclusions.count);assert.notEqual(first.exclusions.digest,second.exclusions.digest);assert.notEqual(first.digest,second.digest);assert.equal(calls.length,0);
});

test('l’aperçu affiche les exclusions avant confirmation sans traduire les chemins', async t => {
  const original=globalThis.document;t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
  globalThis.document={createElement:()=>({attributes:new Map(),setAttribute(name,value){this.attributes.set(name,value);}})};
  const list=()=>({items:[],replaceChildren(...items){this.items=items;}});
  let preview={kind:'ftp',destination:{protocol:'ftps',host:'ftp.exemple.be',port:21,directory:'/public_html'},files:[{path:'index.html'}],totalBytes:42,exclusions:{paths:['data/','.env'],count:151,truncated:true}};
  const dialog=Object.assign(Object.create(PublicationDialog.prototype),{epoch:1,missionId:'mission',error:{},target:{},list:list(),excludedList:list(),exclusions:{hidden:true},excludedLimit:{hidden:true},review:{hidden:true},confirm:{focus(){}},body:()=>({kind:'ftp',ftp}),request:async()=>preview,updateControls(){},showError(message){assert.fail(message);}});
  await dialog.inspectFiles();
  assert.equal(dialog.review.hidden,false);assert.equal(dialog.confirm.disabled,false);assert.equal(dialog.exclusions.hidden,false);assert.equal(dialog.excludedLimit.hidden,false);
  assert.deepEqual(dialog.excludedList.items.map(item=>item.textContent),['data/','.env']);
  for(const item of [...dialog.list.items,...dialog.excludedList.items])assert.equal(item.attributes.get('data-no-translate'),'');
  for(const source of ['Éléments exclus de cet envoi','Ces éléments ne seront pas envoyés. Si votre site en dépend, préparez une livraison adaptée avant de publier.','La liste des exclusions est limitée aux 100 premiers éléments.'])for(const locale of ['en','nl'])assert.notEqual(translate(source,locale),source);
  preview={...preview,exclusions:{paths:[],count:0,truncated:false}};await dialog.inspectFiles();
  assert.equal(dialog.exclusions.hidden,true);assert.equal(dialog.excludedLimit.hidden,true);assert.deepEqual(dialog.excludedList.items,[]);
});

test('aperçu : mission active, choix ambigu, traversée et liens racine sont refusés', async t => {
  const { publisher, root, delivery } = fixture(t);
  publisher.isActive = () => true; await assert.rejects(publisher.preview('mission', { kind: 'ftp', ftp }), /fin de cette mission/);
  assert.equal(publisher.get('mission').status, 'idle');
  publisher.isActive = () => false;
  await assert.rejects(publisher.preview('inconnue', { kind: 'ftp', ftp }), /Mission inconnue/);
  await assert.rejects(publisher.preview('mission', { kind: 'ftp', entry: '../', ftp }), /sous-dossier/);
  symlinkSync(delivery, path.join(root, 'raccourci'));
  await assert.rejects(publisher.preview('mission', { kind: 'ftp', entry: 'raccourci', ftp }), /vrai dossier/);
  rmSync(delivery, { recursive: true });
  for (const name of ['site-a', 'site-b']) { mkdirSync(path.join(root, name)); writeFileSync(path.join(root, name, 'index.html'), 'site'); }
  await assert.rejects(publisher.preview('mission', { kind: 'ftp', ftp }), /Plusieurs sites/);
  assert.equal((await publisher.preview('mission', { kind: 'ftp', entry: 'site-b', ftp })).root, 'site-b');
});

test('aperçu : limite de volume et programmes manquants donnent des erreurs utiles', async t => {
  const { publisher, delivery } = fixture(t);
  writeFileSync(path.join(delivery, 'enorme.mp4'), Buffer.alloc(15 * 1024 * 1024 + 1));
  await assert.rejects(publisher.preview('mission', { kind: 'ftp', ftp }), /500 fichiers/);
  rmSync(path.join(delivery, 'enorme.mp4'));
  publisher.find = async () => null;
  assert.deepEqual((await publisher.state()).ftp, { available: false });
  await assert.rejects(publisher.preview('mission', { kind: 'ftp', ftp }), /curl est absent/);
  await assert.rejects(publisher.preview('mission', { kind: 'github', repo: 'mon-site' }), /GitHub CLI est absent/);
});

test('validation FTP : aucune URL, protocole ou injection de config ne devient une commande', async t => {
  const { publisher } = fixture(t);
  for (const invalid of [{ host: 'ftp://serveur/' }, { host: 'server:21' }, { host: '-option' }, { port: 0 }, { port: 65536 }, { port: '21;bad' }, { protocol: 'sftp' }, { username: 'user:pass' }, { password: 'bad\nurl = ftp://autre' }, { directory: '../public' }, { publicUrl: 'https://u:p@exemple.be' }, { publicUrl: 'javascript:bad' }]) {
    await assert.rejects(publisher.preview('mission', { kind: 'ftp', ftp: { ...ftp, ...invalid } }), /FTP|FTPS|port|adresse publique/);
  }
});

test('confirmation obligatoire : contenu, destination, expiration et concurrence invalident le digest', async t => {
  let now = 0;
  const { publisher, delivery, calls } = fixture(t, { now: () => now });
  const body = { kind: 'ftp', ftp };
  let preview = await publisher.preview('mission', body);
  await assert.rejects(publisher.publish('mission', { ...body, digest: preview.digest }), /Confirmez/);
  writeFileSync(path.join(delivery, 'style.css'), 'body{color:blue}');
  await assert.rejects(publisher.publish('mission', { ...body, confirmation: true, digest: preview.digest }), /ont changé/);
  preview = await publisher.preview('mission', body);
  await assert.rejects(publisher.publish('mission', { ...body, ftp: { ...ftp, host: 'autre.be' }, confirmation: true, digest: preview.digest }), /ont changé/);
  now = 11 * 60000;
  await assert.rejects(publisher.publish('mission', { ...body, confirmation: true, digest: preview.digest }), /expiré/);
  assert.equal(calls.length, 0);
});

test('FTP utilise stdin privé, TLS, aucune redirection et des copies immuables nettoyées', async t => {
  const { publisher, delivery } = fixture(t);
  const uploads = []; let release;
  publisher.run = async (binary, args, opts) => {
    const source = args[args.indexOf('--upload-file') + 1];
    assert(!args.join(' ').includes(ftp.password)); assert(!args.join(' ').includes(ftp.username));
    assert.equal(args[0], '--disable'); assert(args.includes('--ssl-reqd')); assert(!args.includes('--location'));
    assert(args.includes('--ftp-create-dirs')); assert.equal(args[args.indexOf('--config') + 1], '-');
    assert(opts.input.includes('user = "renaud:ONE-SHOT-SECRET"'));
    assert(opts.input.includes('url = "ftp://ftp.exemple.be:21/public_html/'));
    assert(existsSync(source)); uploads.push({ source, text: readFileSync(source, 'utf8') });
    if (!release) await new Promise(resolve => { release = resolve; });
    return { code: 0 };
  };
  const body = { kind: 'ftp', ftp };
  const preview = await publisher.preview('mission', body);
  const started = await publisher.publish('mission', { ...body, confirmation: true, digest: preview.digest });
  assert.equal(started.status, 'uploading'); await until(() => release);
  await assert.rejects(publisher.publish('mission', { ...body, confirmation: true, digest: preview.digest }), /déjà en cours/);
  writeFileSync(path.join(delivery, 'style.css'), 'CHANGED AFTER CONFIRMATION'); release();
  await until(() => publisher.get('mission').status === 'completed');
  assert.equal(publisher.get('mission').url, 'https://exemple.be/');
  assert.equal(uploads.length, 2); assert(uploads.some(file => file.text === 'body{color:green}'));
  for (const file of uploads) assert(!existsSync(file.source));
  assert(!JSON.stringify(publisher.get('mission')).includes('ONE-SHOT')); assert(!JSON.stringify(publisher.results).includes('ONE-SHOT'));
});

test('publication GitHub crée un nouveau dépôt privé et un arbre exactement confirmé sans git local', async t => {
  const { publisher, calls, root } = fixture(t);
  const body = { kind: 'github', repo: 'mon-site' };
  const preview = await publisher.preview('mission', body);
  assert.deepEqual(preview.destination, { repo: 'renaud/mon-site', visibility: 'private' });
  const started = await publisher.publish('mission', { ...body, confirmation: true, digest: preview.digest }); assert.equal(started.status, 'uploading');
  await until(() => publisher.get('mission').status === 'completed');
  assert.equal(publisher.get('mission').url, 'https://github.com/renaud/mon-site');
  const creation = calls.find(call => call.args.includes('user/repos'));
  assert.deepEqual(JSON.parse(creation.input), { name: 'mon-site', private: true, auto_init: true });
  const tree = calls.find(call => call.args.some(arg => arg.endsWith('/trees')));
  assert.deepEqual(JSON.parse(tree.input).tree.map(file => file.path), preview.files.map(file => file.path));
  assert(calls.filter(call => call.args.includes('--input')).every(call => call.args.at(-1) === '-'));
  assert(!existsSync(path.join(root, '.git')));
  assert.match(publisher.get('mission').message, /ne met pas le site en ligne automatiquement/);
});

test('GitHub refuse autres comptes, dépôt existant et panne sans fuite de sortie', async t => {
  const { publisher } = fixture(t);
  await assert.rejects(publisher.preview('mission', { kind: 'github', repo: 'autre/mon-site' }), /votre compte/);
  await assert.rejects(publisher.preview('mission', { kind: 'github', repo: '--flag' }), /nouveau nom/);
  const original = publisher.run;
  publisher.run = async (binary, args, opts) => args.includes('user/repos') ? { code: 1, stdout: 'TOKEN-RAW-SECRET déjà existant' } : original(binary, args, opts);
  const body = { kind: 'github', repo: 'mon-site' }; const preview = await publisher.preview('mission', body);
  await publisher.publish('mission', { ...body, confirmation: true, digest: preview.digest });
  await until(() => publisher.get('mission').status === 'failed');
  assert(!JSON.stringify(publisher.get('mission')).includes('TOKEN-RAW'));
  assert.match(publisher.get('mission').message, /peut-être été créé/);
});

test('connexion navigateur GitHub dédupliquée : seul le code appareil officiel est exposé', async t => {
  let authenticated = false, release, logins = 0;
  const { publisher } = fixture(t);
  publisher.run = async (binary, args, opts) => {
    if (args.includes('user')) return { code: authenticated ? 0 : 1, stdout: authenticated ? 'renaud\n' : '' };
    assert.deepEqual(args, ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https']);
    logins++; opts.onOutput('RAW-AUTH-SECRET First copy your one-time code: ABCD-1234\nhttps://evil.invalid/\n');
    await new Promise(resolve => { release = resolve; }); authenticated = true; return { code: 0 };
  };
  assert.equal(publisher.startGitHubLogin().status, 'connecting');
  await until(() => release);
  assert.equal(publisher.startGitHubLogin().status, 'connecting');
  const connecting = await publisher.state();
  assert.equal(connecting.github.deviceCode, 'ABCD-1234'); assert.equal(connecting.github.verificationUrl, 'https://github.com/login/device');
  assert(!JSON.stringify(connecting).includes('RAW-AUTH')); assert(!JSON.stringify(connecting).includes('evil.invalid')); assert.equal(logins, 1);
  release(); await until(() => publisher.github.status === 'connected');
  assert.equal(publisher.github.user, 'renaud'); assert.equal(publisher.github.deviceCode, undefined);
  publisher.startGitHubLogin(); await until(() => publisher.github.status === 'connected' && !publisher.loginJob); assert.equal(logins, 1);
});

test('processus sans shell, secrets environnement retirés, arrêt tue seulement son groupe', async t => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  const signals = []; child.kill = signal => { signals.push(signal); if (signal === 'SIGKILL') child.emit('close', 1); };
  let options;
  const { publisher } = fixture(t, { run: undefined, killGraceMs: 5, spawnImpl: (binary, args, opts) => { options = opts; return child; }, env: { PATH: '/usr/bin', GH_TOKEN: 'PRIVATE', GITHUB_TOKEN: 'PRIVATE', OPENAI_API_KEY: 'PRIVATE', FTP_PASSWORD: 'PRIVATE', GH_DEBUG: 'api' } });
  const pending = publisher.process('/fake/curl', ['--config', '-'], { input: 'user = "u:ONE-SHOT"\n', timeoutMs: 10000 });
  child.stdout.write('NO-RAW-LOG'); child.stderr.write('PASSWORD=NEVER-EXPOSE');
  await publisher.close(); await assert.rejects(pending, /interrompue/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']); assert.equal(options.shell, false); assert.equal(options.detached, process.platform !== 'win32');
  assert.equal(options.env.GH_TOKEN, undefined); assert.equal(options.env.GITHUB_TOKEN, undefined); assert.equal(options.env.FTP_PASSWORD, undefined); assert.equal(options.env.OPENAI_API_KEY, undefined);
  assert(!JSON.stringify(publisher.github).includes('NEVER-EXPOSE'));
  assert.equal(publishingEnvironment({ GH_ENTERPRISE_TOKEN: 'secret', http_proxy: 'bad' }).GH_ENTERPRISE_TOKEN, undefined);
});

test('GitHub accepte un logiciel sans index tandis que FTP exige un export statique', async t => {
  const { publisher, root, delivery } = fixture(t);
  rmSync(delivery, { recursive: true });
  writeFileSync(path.join(root, 'script.py'), 'print("Bonjour")');
  writeFileSync(path.join(root, 'README.md'), '# Mon logiciel');
  writeFileSync(path.join(root, 'id_ed25519'), 'PRIVATE KEY');
  const preview = await publisher.preview('mission', { kind: 'github', repo: 'mon-site' });
  assert.equal(preview.root, '.'); assert.deepEqual(preview.files.map(file => file.path), ['README.md', 'script.py']);
  await assert.rejects(publisher.preview('mission', { kind: 'ftp', ftp }), /index.html/);
  writeFileSync(path.join(root, 'index.html'), '<title>Server app</title>');
  await assert.rejects(publisher.preview('mission', { kind: 'ftp', ftp }), /uniquement des sites statiques/);
});

test('le polling connexion réutilise sa détection dix secondes et ne remplace pas un login récent', async t => {
  let now = 0, probes = 0;
  const { publisher } = fixture(t, { now: () => now });
  publisher.run = async () => { probes++; return { code: 0, stdout: 'renaud' }; };
  assert.equal((await publisher.state()).github.connected, true);
  for (let index = 0; index < 5; index++) { now += 1000; await publisher.state(); }
  assert.equal(probes, 1); now = 10001; await publisher.state(); assert.equal(probes, 2);
});

test('un transfert échoué n’annonce aucun succès et sa copie temporaire est supprimée', async t => {
  const { publisher } = fixture(t); let source;
  publisher.run = async (binary, args) => { source = args[args.indexOf('--upload-file') + 1]; return { code: 67, stdout: 'PRIVATE PASSWORD=ONE-SHOT-SECRET' }; };
  const body = { kind: 'ftp', ftp: { ...ftp, protocol: 'ftp' } };
  const preview = await publisher.preview('mission', body);
  await publisher.publish('mission', { ...body, confirmation: true, digest: preview.digest });
  await until(() => publisher.get('mission').status === 'failed');
  assert.equal(publisher.get('mission').url, null); assert(!existsSync(source));
  assert.match(publisher.get('mission').message, /peut-être déjà/); assert(!JSON.stringify(publisher.get('mission')).includes('ONE-SHOT'));
});

test('une sortie tronquée ou excessive ne devient pas un succès ni un message sensible', async t => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { child.emit('close', 1); };
  const { publisher } = fixture(t, { run: undefined, killGraceMs: 1, spawnImpl: () => child });
  const pending = publisher.process('/fake/gh', ['api'], { capture: true });
  child.stdout.write('SECRET-OUTPUT'.repeat(100000));
  await assert.rejects(pending, cause => /trop longue/.test(cause.message) && !cause.message.includes('SECRET'));
});

test('un signal annulé pendant le lancement arrête immédiatement le nouveau processus', async t => {
  const controller = new AbortController(); const signals = [];
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = signal => { signals.push(signal); child.emit('close', 1); };
  const { publisher } = fixture(t, { run: undefined, killGraceMs: 1, spawnImpl: () => { controller.abort(); return child; } });
  await assert.rejects(publisher.process('/fake/gh', ['api'], { signal: controller.signal }), /interrompue/);
  assert.equal(signals[0], 'SIGTERM');
});
