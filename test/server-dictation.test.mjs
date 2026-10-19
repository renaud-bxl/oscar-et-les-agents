import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAtelierServer} from '../server.mjs';
import {DICTATION_AUDIO_LIMIT} from '../lib/dictation.mjs';

async function setup(t,transcribe){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-dictation-http-')),calls=[];
  const service={ready:Promise.resolve(),state:async()=>({status:'ready',available:true}),install:async body=>{calls.push(['install',body]);return{status:'installing'};},transcribe:async(body,options)=>{calls.push(['transcribe',body]);return transcribe?transcribe(body,options):{text:'Une idée à relire.'};},close:async()=>{calls.push(['close']);}};
  const app=await createAtelierServer({port:0,dataDir,providers:[],dictationFactory:()=>service});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const post=(route,body,options={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...options.headers},body:JSON.stringify(body),...options});
  return{base,calls,post,app};
}

test('dictation HTTP stays local, reports readiness without installing and allows only its bounded upload envelope',async t=>{
  const{base,calls,post}=await setup(t);
  assert.equal((await fetch(base+'/api/dictation')).status,200);assert.deepEqual(calls,[]);
  const blocked=await fetch(base+'/api/dictation/install',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:'{"confirmed":true}'});assert.equal(blocked.status,403);assert.deepEqual(calls,[]);
  const audio=Buffer.alloc(DICTATION_AUDIO_LIMIT).toString('base64');
  const result=await post('/api/dictation/transcribe',{audio,mimeType:'audio/wav',language:'fr'});assert.equal(result.status,200);assert.equal((await result.json()).text,'Une idée à relire.');assert.equal(calls.length,1);
  assert.equal((await post('/api/dictation/transcribe',{audio:audio+'X'.repeat(4096),mimeType:'audio/wav',language:'fr'})).status,413);assert.equal(calls.length,1);
  assert.equal((await post('/api/dictation/install',{audio})).status,413);assert.equal(calls.length,1);
  for(const name of ['dictation-dialog.js','dictation-dialog.css'])assert.equal((await fetch(base+'/'+name)).status,200);
  assert.equal((await fetch(base+'/dictation-worker.py')).status,404);
});

test('closing the dictation HTTP request cancels transcription and errors preserve safe actionable codes',async t=>{
  let started,aborted=false;const ready=new Promise(resolve=>{started=resolve;});
  const{post,base}=await setup(t,async(body,{signal})=>{if(body.audio==='silence')throw Object.assign(new Error('Aucune parole détectée.'),{code:'DICTATION_NO_SPEECH'});started();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('Dictée annulée.'),{code:'DICTATION_CANCELLED'}));},{once:true});});});
  const silence=await post('/api/dictation/transcribe',{audio:'silence',mimeType:'audio/wav',language:'fr'});assert.equal(silence.status,400);assert.equal((await silence.json()).code,'DICTATION_NO_SPEECH');
  const controller=new AbortController();const pending=fetch(base+'/api/dictation/transcribe',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:'{"audio":"fixture","mimeType":"audio/wav","language":"fr"}',signal:controller.signal}).catch(()=>{});
  await ready;controller.abort();await pending;
  for(let i=0;i<100&&!aborted;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(aborted,true);
});
