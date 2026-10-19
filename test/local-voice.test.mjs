import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename, symlink } from 'node:fs/promises';
import { LocalVoice, LOCAL_VOICES, downloadModel, validateVoiceArchive, validWave } from '../lib/local-voice.mjs';
import { createAtelierServer } from '../server.mjs';
import { setTimeout as delay } from 'node:timers/promises';

function wave(size = 200) { const buffer = Buffer.alloc(size); buffer.write('RIFF'); buffer.writeUInt32LE(size - 8, 4); buffer.write('WAVEfmt ', 8); return buffer; }
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(),'oscar-voice-test-'));
  const calls = { install: 0, download: 0, synthesize: 0 };
  const voice = new LocalVoice({
    dataDir, platform: 'darwin', arch: 'arm64', ...options,
    installRuntimeImpl: async ({runtimeDir}) => { calls.install++; await mkdir(path.join(runtimeDir,'node_modules/sherpa-onnx-node'),{recursive:true}); await writeFile(path.join(runtimeDir,'node_modules/sherpa-onnx-node/package.json'), JSON.stringify({version:'1.13.8'})); },
    downloadImpl: async ({target,onProgress,descriptor}) => { calls.download++; await writeFile(target,'fake model download'); onProgress(descriptor.bytes,descriptor.bytes); },
    extractImpl: async ({directory,descriptor}) => {
      const root=path.join(directory,descriptor.archive); await mkdir(path.join(root,'espeak-ng-data'),{recursive:true});
      await writeFile(path.join(root,'tokens.txt'),'a 0'); await writeFile(path.join(root,'model.int8.onnx'),'fake model'); await writeFile(path.join(root,'MODEL_CARD'),'Original model licence'); return root;
    },
    synthesizeImpl: async ({output,text}, {signal}) => { calls.synthesize++; if(options.wait) await options.wait(signal); if(text.includes('FAIL')) throw new Error('NEVER_DISPLAY'); await writeFile(output,wave(),{flag:'wx'}); },
  });
  await voice.ready;
  t.after(async()=>{ await voice.close(); await rm(dataDir,{recursive:true,force:true}); });
  return {voice,dataDir,calls};
}

test('local voice status and uninstalled synthesis never install or download anything', async t => {
  const f=await fixture(t); const state=await f.voice.state();
  assert.equal(state.status,'not_installed'); assert.equal(state.available,false); assert.equal(state.localOnly,true);
  assert.deepEqual(state.languages,['fr','en']); assert.equal(state.cacheMaxMB,32);
  assert.equal(LOCAL_VOICES.length,4); assert.ok(state.voices.every(voice=>!voice.installed && voice.license && voice.source.startsWith('https://')));
  await assert.rejects(f.voice.speak({text:'Bonjour',voiceId:'fr-siwis'}),/pas installée/);
  await assert.rejects(f.voice.install({voiceId:'fr-siwis'}),/Confirmez/);
  await assert.rejects(f.voice.install({voiceId:'fr-siwis',confirmed:true,url:'https://untrusted.invalid'}),/Confirmez/);
  assert.deepEqual(f.calls,{install:0,download:0,synthesize:0});
});

test('explicit installation verifies real audio before readiness and retains licences and shared voices', async t => {
  const f=await fixture(t);
  const initial=await f.voice.install({voiceId:'fr-jessica',confirmed:true});
  assert.equal(initial.status,'installing'); assert.equal(initial.progress.voiceId,'fr-jessica');
  await f.voice.operation; const state=await f.voice.state();
  assert.equal(state.status,'ready'); assert.equal(state.available,true); assert.equal(state.progress,null);
  assert.equal(state.voices.find(voice=>voice.id==='fr-jessica').installed,true);
  assert.equal(state.voices.find(voice=>voice.id==='fr-pierre').installed,true);
  assert.equal(state.voices.find(voice=>voice.id==='fr-siwis').installed,false);
  assert.equal(await readFile(path.join(f.voice.modelDir,'upmc','MODEL_CARD'),'utf8'),'Original model licence');
  await f.voice.install({voiceId:'fr-pierre',confirmed:true});
  assert.deepEqual(f.calls,{install:1,download:1,synthesize:1});
  const restored=new LocalVoice({dataDir:f.dataDir,platform:'darwin',arch:'arm64'}); await restored.ready;
  assert.equal((await restored.state()).status,'ready'); await restored.close();
});

test('short text validation, cache reuse and bounded cleanup preserve privacy', async t => {
  const f=await fixture(t,{maxCacheFiles:2});
  await f.voice.install({voiceId:'fr-siwis',confirmed:true}); await f.voice.operation;
  for(const invalid of [{text:'',voiceId:'fr-siwis'},{text:'a'.repeat(501),voiceId:'fr-siwis'},{text:'Bonjour',voiceId:'fr-siwis',speed:1.3},{text:'Bonjour',voiceId:'fr-siwis',path:'/outside'}]) await assert.rejects(f.voice.speak(invalid));
  const a=await f.voice.speak({text:'Bonjour Renaud',voiceId:'fr-siwis'}); const b=await f.voice.speak({text:'Bonjour Renaud',voiceId:'fr-siwis'});
  assert.equal(a.cached,false); assert.equal(b.cached,true); assert.equal(a.url,b.url); assert.ok(!a.url.includes('Renaud'));
  const key=a.url.split('/').at(-1).replace('.wav',''); assert.ok(validWave(await f.voice.audio(key)));
  await f.voice.speak({text:'Deuxième phrase',voiceId:'fr-siwis'}); await f.voice.speak({text:'Troisième phrase',voiceId:'fr-siwis'});
  assert.equal((await readdir(f.voice.cacheDir)).length,2);
  await assert.rejects(f.voice.audio('../outside'),/introuvable/);
  const external=path.join(f.dataDir,'outside.wav'), fakeKey='f'.repeat(64); await writeFile(external,wave());
  await symlink(external,path.join(f.voice.cacheDir,`${fakeKey}.wav`)); await assert.rejects(f.voice.audio(fakeKey),/introuvable/);
});

test('a failed synthesis stays explicit and never exposes native diagnostics', async t => {
  const f=await fixture(t);
  await f.voice.install({voiceId:'fr-siwis',confirmed:true}); await f.voice.operation;
  await assert.rejects(f.voice.speak({text:'FAIL',voiceId:'fr-siwis'}),error=>!error.message.includes('NEVER_DISPLAY') && /sous-titres/.test(error.message));
  assert.equal(f.voice.speaking,null);
});
test('Piper cancellation removes partial audio, preserves an older cache and frees its lock',async t=>{
 const f=await fixture(t);await f.voice.install({voiceId:'fr-siwis',confirmed:true});await f.voice.operation;
 const prior=await f.voice.speak({voiceId:'fr-siwis',text:'Extrait déjà disponible.'});const saved=await readdir(f.voice.cacheDir);
 let began;const started=new Promise(resolve=>{began=resolve;});
 f.voice.synthesize=async({output},{signal})=>{await writeFile(output,'partial recording',{flag:'wx'});began();await new Promise((resolve,reject)=>{const abort=()=>reject(new Error('Cancelled'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});};
 const controller=new AbortController(),pending=f.voice.speak({voiceId:'fr-siwis',text:'Extrait annulé.'},{signal:controller.signal});await started;controller.abort();
 await assert.rejects(pending,{code:'VOICE_CANCELLED'});assert.equal(f.voice.speaking,null);assert.equal(f.voice.speechController,null);assert.deepEqual(await readdir(f.voice.cacheDir),saved);
 assert.equal((await f.voice.speak({voiceId:'fr-siwis',text:'Extrait déjà disponible.'})).url,prior.url);
 const alreadyStopped=new AbortController();alreadyStopped.abort();await assert.rejects(f.voice.speak({voiceId:'fr-siwis',text:'Extrait jamais lancé.'},{signal:alreadyStopped.signal}),{code:'VOICE_CANCELLED'});
});
test('native Piper cancellation waits for the worker and kills its process group', {skip:process.platform==='win32',timeout:10000},async t=>{
 const f=await fixture(t);await f.voice.install({voiceId:'fr-siwis',confirmed:true});await f.voice.operation;
 const pidFile=path.join(f.dataDir,'worker-pids.json');
 await writeFile(path.join(f.voice.runtimeDir,'node_modules/sherpa-onnx-node/index.js'),`const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');exports.OfflineTts=class{generate(){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({worker:process.pid,child:child.pid}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}};`);
 const native=new LocalVoice({dataDir:f.dataDir});t.after(()=>native.close());await native.ready;
 const controller=new AbortController(),pending=native.speak({voiceId:'fr-siwis',text:'Phrase bloquée pour le contrôle local.'},{signal:controller.signal});let pids;
 t.after(()=>{controller.abort();for(const pid of Object.values(pids||{}))try{process.kill(pid,'SIGKILL');}catch{}});
 for(let i=0;i<200&&!pids;i++){try{pids=JSON.parse(await readFile(pidFile,'utf8'));}catch{await delay(10);}}
 assert.ok(pids?.worker&&pids?.child,'The isolated fixture worker must start.');controller.abort();await assert.rejects(pending,{code:'VOICE_CANCELLED'});
 const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
 for(let i=0;i<200&&Object.values(pids).some(alive);i++)await delay(10);
 assert.equal(alive(pids.worker),false);assert.equal(alive(pids.child),false);assert.equal(native.speaking,null);assert.deepEqual((await readdir(native.cacheDir)).filter(name=>name.startsWith('.audio-')),[]);
});

test('Piper refuses an outside cache for reads, synthesis and cleanup',async t=>{
  const f=await fixture(t,{maxCacheFiles:0});await f.voice.install({voiceId:'fr-siwis',confirmed:true});await f.voice.operation;
  const outside=path.join(f.dataDir,'private'),hash='a'.repeat(64),file=path.join(outside,hash+'.wav');
  await mkdir(outside);await writeFile(file,wave());await rm(f.voice.cacheDir,{recursive:true});await symlink(outside,f.voice.cacheDir);
  const count=f.calls.synthesize;
  await assert.rejects(f.voice.audio(hash),{code:'VOICE_AUDIO_NOT_FOUND'});
  await assert.rejects(f.voice.pruneCache());
  await assert.rejects(f.voice.speak({voiceId:'fr-siwis',text:'Outside cache'}));
  assert.equal(f.calls.synthesize,count);assert.deepEqual(await readFile(file),wave());
});

for(const relative of ['.','modeles','modeles/siwis','runtime','runtime/node_modules','runtime/node_modules/sherpa-onnx-node'])test(`Piper rejects replaced ${relative} directories before native synthesis`,async t=>{
  const f=await fixture(t);await f.voice.install({voiceId:'fr-siwis',confirmed:true});await f.voice.operation;
  const directory=path.join(f.voice.root,relative),outside=path.join(f.dataDir,'redirected');
  await rename(directory,outside);await symlink(outside,directory);const count=f.calls.synthesize;
  await assert.rejects(f.voice.speak({voiceId:'fr-siwis',text:'Changed folder'}));
  assert.equal(f.calls.synthesize,count);
});

test('Piper keeps its initial parent anchor and refuses oversized or linked audio files',async t=>{
  const f=await fixture(t);await f.voice.install({voiceId:'fr-siwis',confirmed:true});await f.voice.operation;
  const hash='b'.repeat(64);await writeFile(path.join(f.voice.cacheDir,hash+'.wav'),wave(8*1024*1024+1));
  await assert.rejects(f.voice.audio(hash),{code:'VOICE_AUDIO_NOT_FOUND'});
  const retained=f.dataDir+'-retained';await rename(f.dataDir,retained);await symlink(retained,f.dataDir);
  t.after(()=>rm(retained,{recursive:true,force:true}));const count=f.calls.synthesize;
  await assert.rejects(f.voice.audio(hash),{code:'VOICE_AUDIO_NOT_FOUND'});
  await assert.rejects(f.voice.speak({voiceId:'fr-siwis',text:'Changed parent'}));assert.equal(f.calls.synthesize,count);
});

test('archives reject traversal and links and downloads verify size and published digest', async t => {
  assert.equal(validateVoiceArchive('model-int8/\nmodel-int8/a.onnx\n','drwxr-xr-x data\n-rw-r--r-- data\n','model-int8'),'model-int8');
  for(const [names,details] of [['../outside\n','-rw-r--r-- data'],['model-int8/link\n','lrwxr-xr-x data'],['/absolute\n','-rw-r--r-- data'],['model-int8/a\nsecond/file\n','-rw-r--r-- data\n-rw-r--r-- data']]) assert.throws(()=>validateVoiceArchive(names,details,'model-int8'));
  const directory=await mkdtemp(path.join(tmpdir(),'oscar-download-test-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const data=Buffer.from('published model bytes'), descriptor={archive:'official-model',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  let request;
  const fetchImpl=async url=>{request=url;return new Response(data);};
  await downloadModel({descriptor,target:path.join(directory,'verified'),fetchImpl});
  assert.match(request,/^https:\/\/github.com\/k2-fsa\/sherpa-onnx\/releases\/download\/tts-models\//);
  await assert.rejects(downloadModel({descriptor:{...descriptor,sha256:'0'.repeat(64)},target:path.join(directory,'invalid'),fetchImpl}),/signature/);
  await assert.rejects(downloadModel({descriptor:{...descriptor,bytes:1},target:path.join(directory,'large'),fetchImpl}),/taille/);
});

test('voice routes keep local JSON guards, do not install on GET and serve only bounded audio', async t => {
  const f=await fixture(t);
  const app=await createAtelierServer({port:0,dataDir:f.dataDir,providers:[],voiceFactory:()=>f.voice});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve)); t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const post=(url,body,headers={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/api/voice')).status,200); assert.equal(f.calls.install,0);
  assert.equal((await post('/api/voice/install',{voiceId:'fr-siwis',confirmed:true},{Origin:'https://external.invalid'})).status,403);
  assert.equal((await fetch(base+'/api/voice/install',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await post('/api/voice/install',{voiceId:'fr-siwis',confirmed:false})).status,400);
  assert.equal((await post('/api/voice/install',{voiceId:'fr-siwis',confirmed:true})).status,202); await f.voice.operation;
  const spoken=await post('/api/voice/synthesize',{voiceId:'fr-siwis',text:'Bonjour'}); assert.equal(spoken.status,200);
  const {url}=await spoken.json(), audio=await fetch(base+url); assert.equal(audio.headers.get('content-type'),'audio/wav'); assert.ok(validWave(Buffer.from(await audio.arrayBuffer())));
  assert.equal((await fetch(base+'/api/voice/audio/'+'0'.repeat(64)+'.wav')).status,404);
});
