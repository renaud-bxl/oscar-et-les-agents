import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PocketVoice, POCKET_FILES, POCKET_DOWNLOAD_BYTES, POCKET_VOICES, supportedPython, downloadPocketFile } from '../lib/pocket-voice.mjs';

async function until(condition) { for(let attempt=0;attempt<200;attempt++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Expected asynchronous condition did not settle'); }
const voiceError = () => Object.assign(new Error('Cancelled'), {code:'VOICE_CANCELLED'});
function wave() { const data=Buffer.alloc(200);data.write('RIFF');data.write('WAVEfmt ',8);return data; }
async function fixture(t, options={}) {
  const dataDir=await mkdtemp(path.join(tmpdir(),'oscar-pocket-test-'));
  const calls={prepare:0,download:0,workers:0,generated:[],closed:0};
  const data=Buffer.from('verified fixture');
  const files=[{path:'english/model.safetensors',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),url:'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/test/model.safetensors'}];
  const control={hold:false,waiting:null,fail:false};
  const workerFactory=()=>{
    calls.workers++;
    return {alive:true,async generate(task,{signal}={}){
      calls.generated.push({text:task.text,language:task.language,voiceId:task.voiceId});
      if(control.fail)throw new Error('NEVER_DISPLAY');
      if(control.hold)await new Promise((resolve,reject)=>{control.waiting=resolve;signal?.addEventListener('abort',()=>reject(voiceError()),{once:true});if(signal?.aborted)reject(voiceError());});
      if(signal?.aborted)throw voiceError();
      await writeFile(task.output,wave(),{flag:'wx'});return{ok:true};
    },async close(){this.alive=false;calls.closed++;}};
  };
  const instance=new PocketVoice({dataDir,platform:'darwin',findPythonImpl:async()=>options.noPython?null:'/fake/python3',files,
    prepareRuntimeImpl:async({runtimeDir})=>{calls.prepare++;await mkdir(path.join(runtimeDir,'bin'),{recursive:true});const python=path.join(runtimeDir,'bin/python');await writeFile(python,'fake',{mode:0o700});return python;},
    downloadImpl:async({target,onProgress})=>{calls.download++;await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);onProgress(data.length);},workerFactory,...options});
  await instance.ready;
  t.after(async()=>{await instance.close();await rm(dataDir,{recursive:true,force:true});});
  const install=async()=>{await instance.install({voiceId:'studio-oscar',confirmed:true});await instance.operation;};
  return{voice:instance,dataDir,calls,files,control,workerFactory,install};
}

test('studio catalogue has two shared multilingual presets and only twelve fixed public files',()=>{
  assert.deepEqual(POCKET_VOICES.map(row=>row.id),['studio-oscar','studio-zoe']);
  assert.equal(POCKET_FILES.length,12);assert.equal(POCKET_DOWNLOAD_BYTES,1197700249);
  assert.ok(POCKET_FILES.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)&&row.url.startsWith('https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/')));
  for(const version of ['Python 3.10.1','3.14.8'])assert.equal(supportedPython(version),true);
  for(const version of ['3.9.4','3.15.0','4.0.1','unknown'])assert.equal(supportedPython(version),false);
});

test('status never downloads and missing Python is an honest prerequisite',async t=>{
  const f=await fixture(t,{noPython:true});const state=await f.voice.state();
  assert.equal(state.status,'unsupported');assert.equal(state.available,false);assert.match(state.message,/Python/);
  assert.ok(state.voices.every(row=>row.group==='studio'&&row.recommended&&row.lang==='multilingual'&&!row.installed));
  assert.deepEqual(state.voices[0].languages,['fr','en','nl']);
  await assert.rejects(f.voice.install({voiceId:'studio-oscar',confirmed:true}),/Python/);
  await assert.rejects(f.voice.speak({voiceId:'studio-oscar',text:'Bonjour'}),/pas installé/);
  assert.equal(f.calls.prepare,0);assert.equal(f.calls.download,0);assert.equal(f.calls.workers,0);
});

test('one explicit pack install proves both presets in all three languages before readiness',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.voice.install({voiceId:'studio-oscar'}),/Confirmez/);
  await assert.rejects(f.voice.install({voiceId:'studio-oscar',confirmed:true,ref_audio:'/personal.wav'}),/Confirmez/);
  await f.install();const state=await f.voice.state();
  assert.equal(state.status,'ready');assert.ok(state.voices.every(row=>row.installed));
  assert.equal(f.calls.prepare,1);assert.equal(f.calls.download,1);assert.equal(f.calls.workers,1);
  assert.deepEqual(f.calls.generated.map(row=>[row.language,row.voiceId]),[['fr','studio-oscar'],['fr','studio-zoe'],['en','studio-oscar'],['en','studio-zoe'],['nl','studio-oscar'],['nl','studio-zoe']]);
  await f.voice.install({voiceId:'studio-zoe',confirmed:true});assert.equal(f.calls.download,1);
  assert.match(await readFile(path.join(f.voice.models,'SOURCES-ET-LICENCES.txt'),'utf8'),/CC0/);
  const restored=new PocketVoice({dataDir:f.dataDir,files:f.files,findPythonImpl:async()=>null});await restored.ready;
  assert.equal((await restored.state()).available,true);await restored.close();
});

test('a failed verification never becomes ready or leaks model diagnostics',async t=>{
  const f=await fixture(t);f.control.fail=true;await f.install();
  assert.equal((await f.voice.state()).status,'failed');assert.equal((await f.voice.state()).available,false);
  assert.ok(!JSON.stringify(await f.voice.state()).includes('NEVER_DISPLAY'));
  await assert.rejects(readFile(f.voice.marker),{code:'ENOENT'});
});

test('payloads never select a reference voice, local path, external model or fourth language',async t=>{
  const f=await fixture(t);await f.install();const count=f.calls.generated.length;
  for(const payload of [{voiceId:'../../private',text:'Bonjour'},{voiceId:'studio-oscar',text:'Bonjour',language:'de'},{voiceId:'studio-oscar',text:'a'.repeat(501)},{voiceId:'studio-oscar',text:'Bonjour',ref_audio:'/personal.wav'},{voiceId:'studio-oscar',text:'Bonjour',model:'external'}])await assert.rejects(f.voice.speak(payload));
  assert.equal(f.calls.generated.length,count);
  const a=await f.voice.speak({voiceId:'studio-oscar',text:'Bonjour',language:'fr',speed:0.9});
  const b=await f.voice.speak({voiceId:'studio-oscar',text:'Bonjour',language:'fr'});
  assert.equal(a.cached,false);assert.equal(b.cached,true);assert.equal(a.url,b.url);assert.equal(a.playbackRate,0.9);
  const nl=await f.voice.speak({voiceId:'studio-oscar',text:'Bonjour',language:'nl'});assert.notEqual(nl.url,a.url);
});

test('an aborted sentence releases the resident worker for the most recent character',async t=>{
  const f=await fixture(t);await f.install();f.control.hold=true;
  const controller=new AbortController();const old=f.voice.speak({voiceId:'studio-oscar',text:'Ancienne réplique'},{signal:controller.signal});
  const oldResult=assert.rejects(old,error=>error.code==='VOICE_CANCELLED');await until(()=>f.control.waiting);
  const next=f.voice.speak({voiceId:'studio-zoe',text:'Nouvelle réplique',language:'fr'});
  controller.abort();f.control.hold=false;
  await oldResult;const result=await next;
  assert.equal(result.voiceId,'studio-zoe');assert.equal(f.calls.workers,1);assert.equal(f.calls.generated.at(-1).text,'Nouvelle réplique');
});

test('the short queue is bounded and gives newer pending sentences priority',async t=>{
  const f=await fixture(t);await f.install();f.control.hold=true;
  const active=f.voice.speak({voiceId:'studio-oscar',text:'Active'});await until(()=>f.control.waiting);
  const pending=[1,2,3,4].map(number=>f.voice.speak({voiceId:'studio-zoe',text:'Queue '+number}));
  let superseded=false;pending[0].catch(error=>{superseded=error.code==='VOICE_SUPERSEDED';});
  const outcomes=Promise.allSettled(pending);await until(()=>f.voice.queue.length===3&&superseded);assert.equal(f.voice.queue.length,3);
  f.control.hold=false;f.control.waiting();await active;const results=await outcomes;
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.code,'VOICE_SUPERSEDED');assert.ok(results.slice(1).every(row=>row.status==='fulfilled'));
  assert.deepEqual(f.calls.generated.slice(-3).map(row=>row.text),['Queue 4','Queue 3','Queue 2']);
});

test('cache bounds and symbolic links cannot expose other local audio',async t=>{
  const f=await fixture(t,{maxCacheFiles:2});await f.install();
  for(const text of ['un','deux','trois'])await f.voice.speak({voiceId:'studio-oscar',text});
  assert.equal((await readdir(f.voice.cacheDir)).length,2);
  const outside=path.join(f.dataDir,'outside.wav');await writeFile(outside,wave());const hash='f'.repeat(64);await symlink(outside,path.join(f.voice.cacheDir,hash+'.wav'));
  await assert.rejects(f.voice.audio(hash),/introuvable/);await assert.rejects(f.voice.audio('../outside'),/introuvable/);
});

test('a replaced studio cache cannot expose, overwrite or prune an outside WAV',async t=>{
  const f=await fixture(t,{maxCacheFiles:0});await f.install();
  const outside=path.join(f.dataDir,'private'),hash='a'.repeat(64),file=path.join(outside,hash+'.wav');
  await mkdir(outside);await writeFile(file,wave());await rm(f.voice.cacheDir,{recursive:true});await symlink(outside,f.voice.cacheDir);
  const count=f.calls.generated.length;
  await assert.rejects(f.voice.audio(hash),{code:'VOICE_AUDIO_NOT_FOUND'});
  await assert.rejects(f.voice.prune());
  await assert.rejects(f.voice.speak({voiceId:'studio-oscar',text:'Outside cache'}));
  assert.equal(f.calls.generated.length,count);assert.deepEqual(await readFile(file),wave());
});

for(const relative of ['.','modeles','modeles/english','runtime','runtime/bin','runtime/lib','runtime/lib/python3.14/site-packages'])test(`studio rejects replaced ${relative} directories before using its resident worker`,async t=>{
  const f=await fixture(t);await f.install();
  const directory=path.join(f.voice.root,relative);await mkdir(directory,{recursive:true});
  const outside=path.join(f.dataDir,'redirected');await rename(directory,outside);await symlink(outside,directory);
  const count=f.calls.generated.length;
  await assert.rejects(f.voice.speak({voiceId:'studio-oscar',text:'Changed folder'}));
  assert.equal(f.calls.generated.length,count);
  if(relative==='.')await assert.rejects(f.voice.audio('a'.repeat(64)),{code:'VOICE_AUDIO_NOT_FOUND'});
});

test('studio keeps its initial data directory anchor after the parent is replaced',async t=>{
  const f=await fixture(t);await f.install();
  const retained=f.dataDir+'-retained';await rename(f.dataDir,retained);await symlink(retained,f.dataDir);
  t.after(()=>rm(retained,{recursive:true,force:true}));
  const count=f.calls.generated.length;
  await assert.rejects(f.voice.speak({voiceId:'studio-oscar',text:'Changed parent'}));
  await assert.rejects(f.voice.audio('a'.repeat(64)),{code:'VOICE_AUDIO_NOT_FOUND'});
  assert.equal(f.calls.generated.length,count);
});

test('studio supports the normal venv interpreter symlink but refuses oversized audio',async t=>{
  const f=await fixture(t);await f.install();
  const interpreter=path.join(f.dataDir,'python3');await rename(f.voice.python,interpreter);await symlink(interpreter,f.voice.python);
  assert.equal((await f.voice.speak({voiceId:'studio-oscar',text:'Normal venv'})).cached,false);
  const hash='b'.repeat(64);await writeFile(path.join(f.voice.cacheDir,hash+'.wav'),Buffer.alloc(8*1024*1024+1));
  await assert.rejects(f.voice.audio(hash),{code:'VOICE_AUDIO_NOT_FOUND'});
});

test('studio refuses a redirected generated configuration before reusing a warm worker',async t=>{
  const f=await fixture(t);await f.install();
  const outside=path.join(f.dataDir,'private.yml');await writeFile(outside,'PRIVATE DATA');
  await symlink(outside,path.join(f.voice.models,'english','local-config.yaml'));
  const count=f.calls.generated.length;
  await assert.rejects(f.voice.speak({voiceId:'studio-oscar',text:'Unsafe config'}));
  assert.equal(f.calls.generated.length,count);assert.equal(await readFile(outside,'utf8'),'PRIVATE DATA');
});

test('Python worker independently refuses linked output, configuration and model parents without downloading',t=>{
  const script=String.raw`
import json, pathlib, runpy, sys, tempfile, types
worker=runpy.run_path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix="oscar-worker-guard-") as temporary:
    root=pathlib.Path(temporary).resolve()
    pack=root/"modeles"; variant=pack/"english"; cache=root/"cache"
    variant.mkdir(parents=True); cache.mkdir()
    outside=root/"private"; outside.write_bytes(b"PRIVATE DATA")
    linked=cache/"linked.wav"; linked.symlink_to(outside)
    try: worker["new_wave_file"](linked,pack); raise AssertionError("Linked output accepted")
    except FileExistsError: pass
    with worker["new_wave_file"](cache/"valid.wav",pack) as output: output.write(b"fixture")
    (root/"cache-saved").mkdir(); cache.rename(root/"old-cache"); cache.symlink_to(root/"cache-saved")
    try: worker["new_wave_file"](cache/"outside.wav",pack); raise AssertionError("Linked cache accepted")
    except ValueError: pass
    package=root/"package"; (package/"config").mkdir(parents=True)
    (package/"config/english.yaml").write_text("fixture")
    pocket=types.ModuleType("pocket_tts"); pocket.__file__=str(package/"__init__.py")
    pocket.TTSModel=types.SimpleNamespace(load_model=lambda **kwargs:types.SimpleNamespace())
    yaml=types.ModuleType("yaml")
    yaml.safe_load=lambda _: {"flow_lm":{"lookup_table":{}}}
    yaml.safe_dump=lambda _: "SAFE CONFIGURATION"
    sys.modules["pocket_tts"]=pocket; sys.modules["yaml"]=yaml
    config=variant/"local-config.yaml"; config.symlink_to(outside)
    try: worker["model_for"]("en",pack); raise AssertionError("Linked configuration accepted")
    except OSError: pass
    assert outside.read_bytes()==b"PRIVATE DATA"
    variant.rename(root/"old-english"); variant.symlink_to(root/"old-english")
    try: worker["local_path"](variant); raise AssertionError("Linked model parent accepted")
    except ValueError: pass
print(json.dumps({"protected":True}))
`;
  const result=spawnSync('python3',['-I','-c',script,fileURLToPath(new URL('../lib/pocket-voice-worker.py',import.meta.url))],{encoding:'utf8',timeout:10000,maxBuffer:100000});
  if(result.error?.code==='ENOENT'){t.skip('Python is optional; unavailable on this test host');return;}
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{protected:true});
});

test('public model downloads enforce exact size and SHA256, removing incomplete parts',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'oscar-pocket-download-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const data=Buffer.from('verified public file'),descriptor={url:'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/fixed/model.safetensors',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  const fetchImpl=async()=>new Response(data);
  await downloadPocketFile({descriptor,target:path.join(directory,'ok'),fetchImpl});
  await assert.rejects(downloadPocketFile({descriptor:{...descriptor,sha256:'0'.repeat(64)},target:path.join(directory,'bad'),fetchImpl}),/signature/);
  assert.deepEqual(await readdir(directory),['ok']);
});
