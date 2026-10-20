import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceService } from '../lib/voice-service.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAtelierServer } from '../server.mjs';

function fixture() {
  const calls = [];
  const piper = {
    state: async () => ({ status: 'ready', available: true, runtimeDownloadMB: 35, cacheMaxMB: 32, voices: [{ id: 'fr-pierre', lang: 'fr', installed: true }], licenseNotice: 'Piper licence' }),
    voice: id => { if (id !== 'fr-pierre') throw Error('Unknown voice'); return { id, lang: 'fr' }; },
    install: async body => calls.push(['install-piper', body]),
    speak: async body => { calls.push(['piper', body]); return { url: '/legacy.wav' }; },
    audio: async key => { calls.push(['audio-piper', key]); return Buffer.from('legacy'); },
    close: async () => calls.push(['close-piper']),
  };
  const studio = {
    state: async () => ({ status: 'not_installed', available: false, runtimeDownloadMB: 700, cacheMaxMB: 32, voices: ['studio-oscar-paul-v2', 'studio-zoe'].map(id => ({ id, languages: ['fr', 'en', 'nl'], installed: false })), licenseNotice: 'Studio licence' }),
    install: async body => calls.push(['install-studio', body]),
    speak: async body => { calls.push(['studio', body]); return { url: '/studio.wav' }; },
    audio: async key => { calls.push(['audio-studio', key]); if (key.startsWith('b')) throw Error('Missing studio audio'); return Buffer.from('studio'); },
    close: async () => calls.push(['close-studio']),
  };
  return { service: new VoiceService({ piper, studio }), calls, studio, piper };
}

test('studio catalogue advertises two conversational identities without installing them or losing legacy voices', async () => {
  const { service, calls } = fixture(); const state = await service.state();
  assert.deepEqual(state.speakers, ['oscar', 'zoe']);
  assert.deepEqual(state.languages, ['fr', 'en', 'nl']);
  assert.equal(state.voices.filter(voice => voice.recommended).length, 2);
  assert.equal(state.voices.find(voice => voice.id === 'fr-pierre').installed, true);
  assert.equal(state.available, true); assert.deepEqual(calls, []);
});

test('versioned preview links match Paul and Vera and never point at retired voice samples', async () => {
  const {service,studio}=fixture();
  studio.state=async()=>({status:'ready',available:true,voices:['studio-oscar-paul-v2','studio-oscar-2','studio-zoe','studio-zoe-vera-v2'].map(id=>({id,installed:true}))});
  const state=await service.state();
  for(const [id,file] of [['studio-oscar-paul-v2','oscar-paul-v2'],['studio-oscar-2','oscar-2'],['studio-zoe','zoe'],['studio-zoe-vera-v2','zoe-vera-v2']]){
    assert.deepEqual(state.voices.find(row=>row.id===id).previewUrls,Object.fromEntries(['fr','en','nl'].map(language=>[language,`/voice-preview-${file}-${language}.wav`])));
  }
});

test('voice installation requires confirmation, known identity and no arbitrary download options', async () => {
  const { service, calls } = fixture();
  for (const body of [{ voiceId: 'studio-oscar-paul-v2' }, { voiceId: 'unknown', confirmed: true }, { voiceId: 'studio-oscar-paul-v2', confirmed: true, url: 'https://untrusted.invalid' }]) await assert.rejects(service.install(body));
  assert.deepEqual(calls, []);
  await service.install({ voiceId: 'studio-zoe', confirmed: true });
  assert.deepEqual(calls, [['install-studio', { voiceId: 'studio-zoe', confirmed: true }]]);
});

test('a shared installation reports its actual progress even when an old voice is already usable', async () => {
  const { service, studio } = fixture(); const state = await studio.state();
  studio.state = async () => ({ ...state, status: 'installing', progress: { phase: 'download', percent: 27 }, message: 'Téléchargement' });
  const combined = await service.state();
  assert.equal(combined.status, 'installing'); assert.equal(combined.progress.percent, 27);
  await assert.rejects(service.install({ voiceId: 'fr-pierre', confirmed: true }), /cours/);
});

test('explicit language reaches the conversational model and cannot accidentally select a French legacy voice for Dutch', async () => {
  const { service, calls } = fixture();
  await service.speak({ voiceId: 'studio-oscar-paul-v2', text: 'Goedemorgen!', language: 'nl' });
  await service.speak({ voiceId: 'fr-pierre', text: 'Bonjour.', language: 'fr' });
  assert.deepEqual(calls, [['studio', { voiceId: 'studio-oscar-paul-v2', text: 'Goedemorgen!', language: 'nl' }], ['piper', { voiceId: 'fr-pierre', text: 'Bonjour.' }]]);
  for (const body of [{ voiceId: 'fr-pierre', text: 'Hallo', language: 'nl' }, { voiceId: 'studio-oscar-paul-v2', text: 'Hello', language: 'xx' }, { voiceId: 'studio-oscar-paul-v2', text: 'Hello', reference: '/private/file.wav' }]) await assert.rejects(service.speak(body));
  assert.equal(calls.length, 2);
});

test('audio lookup stays within the two managed caches and closing releases both runtimes', async () => {
  const { service, calls } = fixture();
  assert.equal((await service.audio('a'.repeat(64))).toString(), 'studio');
  assert.equal((await service.audio('b'.repeat(64))).toString(), 'legacy');
  await assert.rejects(service.audio('../private.wav'));
  await service.close();
  assert.ok(calls.some(([name]) => name === 'close-studio'));
  assert.ok(calls.some(([name]) => name === 'close-piper'));
});
test('request cancellation reaches both Studio and optional Piper engines', async () => {
  const {service,piper,studio}=fixture(),controller=new AbortController(),signals=[];
  piper.speak=async(body,options)=>{signals.push(options.signal);};studio.speak=piper.speak;
  await service.speak({voiceId:'studio-oscar-paul-v2',text:'Bonjour.',language:'fr'},{signal:controller.signal});
  await service.speak({voiceId:'fr-pierre',text:'Bonjour.',language:'fr'},{signal:controller.signal});
  assert.deepEqual(signals,[controller.signal,controller.signal]);
});

test('closing a speech request aborts its local generation without closing the office server', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'oscar-voice-abort-'));
  let began, cancelled; const started = new Promise(resolve => { began = resolve; });
  const stopped = new Promise(resolve => { cancelled = resolve; });
  const voice = {
    state: async () => ({ status: 'ready' }), close: async () => {},
    speak: (body, { signal }) => new Promise((resolve, reject) => {
      began();
      signal.addEventListener('abort', () => { cancelled(); reject(new Error('Lecture arrêtée.')); }, { once: true });
    }),
  };
  const app = await createAtelierServer({ port: 0, dataDir, providers: [], voiceFactory: () => voice });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`, controller = new AbortController();
  const request = fetch(base + '/api/voice/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify({ voiceId: 'studio-oscar-paul-v2', text: 'Bonjour.', language: 'fr' }), signal: controller.signal });
  await started; controller.abort(); await assert.rejects(request, error => error.name === 'AbortError');
  let timer;
  await Promise.race([stopped, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Generation was not cancelled.')), 2000); })]).finally(() => clearTimeout(timer));
  assert.equal((await fetch(base + '/api/state')).status, 200);
});
