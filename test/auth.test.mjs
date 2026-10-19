import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {BrowserLogin} from '../lib/auth.mjs';
const wait=()=>new Promise(r=>setTimeout(r,10));
async function until(predicate){for(let i=0;i<150;i++){if(predicate())return;await wait();}throw new Error('Le faux programme ne s’est pas mis dans l’état attendu.');}
function fake({ignoreTerm=false}={}){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.signals=[];child.kill=signal=>{child.signals.push(signal);if(signal==='SIGKILL'||!ignoreTerm)child.emit('close',1,signal);};return child;}
test('la connexion navigateur utilise les CLI officiels sans capturer de jeton',async()=>{
 const child=fake(),calls=[],changes=[];let authenticated=false;
 const login=new BrowserLogin({find:async()=>'/fake/claude',spawnImpl:(...args)=>{calls.push(args);return child;},detect:async()=>[{id:'claude',available:true,auth:{loggedIn:authenticated,method:'subscription'}}],onChange:(state)=>changes.push(structuredClone(state))});
 await login.start('claude');await login.start('claude');
 await until(()=>calls.length===1);
 assert.equal(calls.length,1);assert.deepEqual(calls[0][1],['auth','login','--claudeai']);
 assert.deepEqual(calls[0][2].stdio,['ignore','pipe','pipe']);assert.equal(calls[0][2].detached,process.platform!=='win32');
 child.stdout.write('CONFIDENTIAL-LOGIN-OUTPUT');authenticated=true;child.emit('close',0);await wait();
 assert.equal(login.logins.claude.status,'connected');assert(!JSON.stringify(changes).includes('CONFIDENTIAL'));
 await login.close();
});
test('une connexion refusée ou annulée reste un échec explicite',async()=>{
 const child=fake();let started=false;const login=new BrowserLogin({find:async()=>'/fake/codex',spawnImpl:()=>{started=true;return child;},detect:async()=>[{id:'codex',available:true,auth:{loggedIn:false}}]});
 await login.start('codex');await until(()=>started);child.emit('close',1);await wait();assert.equal(login.logins.codex.status,'failed');
 await assert.rejects(login.start('autre'),/pas reconnu/);
 await login.close();
});

test('un abonnement déjà connecté est conservé sans ouvrir de navigateur ni installer',async()=>{
 let installations=0,spawned=0;
 const login=new BrowserLogin({detect:async()=>[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}}],install:async()=>installations++,spawnImpl:()=>spawned++});
 await login.start('codex');await until(()=>login.logins.codex.status==='connected');
 await login.setup('codex');await until(()=>login.logins.codex.status==='connected');
 assert.equal(installations,0);assert.equal(spawned,0);await login.close();
});

test('la préparation installe localement une seule fois puis connecte sans exposer les sorties npm ni OAuth',async()=>{
 let installed=false,authenticated=false;const installations=[],calls=[],changes=[],children=[];
 const login=new BrowserLogin({
  detect:async()=>[{id:'claude',available:installed,auth:{loggedIn:authenticated}}],find:async()=>'/fake/claude',
  install:async(options,deps)=>{installations.push(options);deps.log('CONFIDENTIAL-INSTALL-LOG');const result=await deps.interactive('/fake/npm',['install','--prefix','/fake/.tools'],{});assert.equal(result.code,0);installed=true;},
  spawnImpl:(...args)=>{calls.push(args);const child=fake();children.push(child);return child;},
  onChange:(logins,providers)=>changes.push(structuredClone({logins,providers})),
 });
 const first=await login.setup('claude');assert.equal(first.status,'installing');
 await login.setup('claude');await login.start('claude');await until(()=>calls.length===1);
 assert.equal(installations.length,1);assert.deepEqual(installations[0],{engine:'claude',skipLogin:true,noOpen:true});
 assert.equal(login.logins.claude.status,'installing');
 children[0].stdout.write('CONFIDENTIAL-NPM-OUTPUT');children[0].stderr.write('CONFIDENTIAL-NPM-ERROR');children[0].emit('close',0);
 await until(()=>calls.length===2);assert.equal(login.logins.claude.status,'connecting');assert.deepEqual(calls[1][1],['auth','login','--claudeai']);
 authenticated=true;children[1].stdout.write('CONFIDENTIAL-OAUTH-TOKEN');children[1].emit('close',0);
 await until(()=>login.logins.claude.status==='connected');assert.equal(calls.length,2);
 assert(!JSON.stringify(changes).includes('CONFIDENTIAL'));await login.close();
});

test('une mise à jour compatible conserve la session existante et ne réauthentifie pas',async()=>{
 let updated=false,installed=0,spawned=0;
 const login=new BrowserLogin({detect:async()=>[{id:'claude',available:updated,auth:{loggedIn:true,method:'subscription'}}],install:async()=>{installed++;updated=true;},spawnImpl:()=>spawned++});
 await login.setup('claude');await until(()=>login.logins.claude.status==='connected');
 assert.equal(installed,1);assert.equal(spawned,0);await login.close();
});

test('une installation échouée ou encore incompatible reste en échec sans révéler son erreur brute',async()=>{
 for(const throws of [true,false]){
  let spawned=0;
  const login=new BrowserLogin({detect:async()=>[{id:'codex',available:false}],install:async()=>{if(throws)throw new Error('CONFIDENTIAL-SECRET');},spawnImpl:()=>spawned++});
  await login.setup('codex');await until(()=>login.logins.codex.status==='failed');
  assert.equal(spawned,0);assert(!JSON.stringify(login.logins).includes('CONFIDENTIAL'));await login.close();
 }
});

test('rafraîchir confirme l’autre abonnement sans écraser la préparation en cours',async()=>{
 let release,installed=false;const changes=[];
 const login=new BrowserLogin({detect:async()=>[{id:'codex',available:installed,auth:{loggedIn:installed}},{id:'claude',available:true,auth:{loggedIn:true}}],install:()=>new Promise(resolve=>{release=()=>{installed=true;resolve();};}),onChange:(logins,providers)=>changes.push(structuredClone({logins,providers}))});
 await login.setup('codex');await until(()=>release);
 const providers=await login.refresh();
 assert.equal(providers.length,2);assert.equal(login.logins.codex.status,'installing');assert.equal(login.logins.claude.status,'connected');
 release();await until(()=>login.logins.codex.status==='connected');
 assert.equal(login.logins.claude.status,'connected');assert(changes.some(change=>change.providers?.length===2));await login.close();
});

test('un rafraîchissement lent ne remplace pas une détection plus récente',async()=>{
 let resolveOld,calls=0;
 const fresh=[{id:'codex',available:true,auth:{loggedIn:true}}];
 const login=new BrowserLogin({detect:()=>++calls===1?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve(fresh)});
 const refreshing=login.refresh();await until(()=>resolveOld);await login.start('codex');await until(()=>login.logins.codex?.status==='connected');
 resolveOld([{id:'codex',available:false,auth:{loggedIn:false}}]);const providers=await refreshing;
 assert.deepEqual(providers,fresh);assert.equal(login.logins.codex.status,'connected');await login.close();
});

test('les deux installations partagent une file tandis que chaque moteur garde son état',async()=>{
 const installed=new Set(),started=[],release=[];let active=0,peak=0;
 const login=new BrowserLogin({detect:async()=>['codex','claude'].map(id=>({id,available:installed.has(id),auth:{loggedIn:installed.has(id)}})),install:options=>new Promise(resolve=>{started.push(options.engine);active++;peak=Math.max(peak,active);release.push(()=>{active--;installed.add(options.engine);resolve();});})});
 await login.setup('codex');await login.setup('claude');await until(()=>started.length===1);
 assert.deepEqual(started,['codex']);assert.equal(login.logins.claude.status,'installing');release[0]();await until(()=>started.length===2);release[1]();
 await until(()=>login.logins.claude.status==='connected'&&login.logins.codex.status==='connected');assert.equal(peak,1);await login.close();
});

test('fermer arrête npm et son groupe avec escalade et ne lance jamais la connexion ensuite',async()=>{
 const child=fake({ignoreTerm:true});let calls=0;
 const login=new BrowserLogin({killGraceMs:5,detect:async()=>[{id:'codex',available:false}],install:async(options,deps)=>{await deps.interactive('/fake/npm',['install'],{});},spawnImpl:()=>{calls++;return child;}});
 await login.setup('codex');await until(()=>calls===1);await login.close();
 assert.deepEqual(child.signals,['SIGTERM','SIGKILL']);assert.equal(calls,1);assert.equal(login.children.size,0);assert.equal(login.jobs.size,0);
 await assert.rejects(login.start('codex'),/se ferme/);
});

test('le délai borne la connexion et force l’arrêt si le programme ignore SIGTERM',async()=>{
 const child=fake({ignoreTerm:true});
 const login=new BrowserLogin({timeoutMs:30,killGraceMs:5,detect:async()=>[{id:'codex',available:true,auth:{loggedIn:false}}],find:async()=>'/fake/codex',spawnImpl:()=>child});
 await login.start('codex');await until(()=>login.logins.codex.status==='failed');assert.match(login.logins.codex.message,/délai/);
 assert.deepEqual(child.signals,['SIGTERM','SIGKILL']);await login.close();
});

test('les processus de préparation ne reçoivent ni clés API ni jetons de remplacement',async()=>{
 const child=fake(),calls=[];let installed=false;
 const login=new BrowserLogin({
  installerDependencies:{env:{PATH:'/safe/bin',OPENAI_API_KEY:'CONFIDENTIAL-KEY',CODEX_ACCESS_TOKEN:'CONFIDENTIAL-TOKEN',ANTHROPIC_BASE_URL:'https://another-provider.invalid',ANTHROPIC_AUTH_TOKEN:'CONFIDENTIAL-TOKEN'}},
  detect:async()=>[{id:'codex',available:installed,auth:{loggedIn:installed,method:'chatgpt'}}],
  install:async(options,deps)=>{await deps.interactive('/fake/npm',['install'],{env:deps.env});installed=true;},
  spawnImpl:(...args)=>{calls.push(args);return child;},
 });
 await login.setup('codex');await until(()=>calls.length===1);
 const env=calls[0][2].env;
 for(const key of ['OPENAI_API_KEY','CODEX_ACCESS_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN'])assert.equal(env[key],undefined);
 assert(!JSON.stringify(env).includes('CONFIDENTIAL'));assert.equal(calls[0][2].shell,undefined);
 child.emit('close',0);await until(()=>login.logins.codex.status==='connected');await login.close();
});
