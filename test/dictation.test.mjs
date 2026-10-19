import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { DictationService, DICTATION_AUDIO_LIMIT, DICTATION_BODY_LIMIT, DICTATION_FILES, validateDictationInput, supportedDictationPython, dictationEnvironment, downloadDictationFile, runDictationTask } from '../lib/dictation.mjs';
import { dictationText, recorderMimeType, microphoneError } from '../public/dictation-dialog.js';

const audio = Buffer.from('RIFF0000WAVEgeneric-audio');
const body = (language = 'fr') => ({ audio: audio.toString('base64'), mimeType: 'audio/wav', language });
const model = Buffer.from('generic-model-fixture');
const files = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'].map(name => ({ name, bytes: model.length, sha256: createHash('sha256').update(model).digest('hex') }));
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'oscar-dictation-test-')); const calls = [];
  const service = new DictationService({ dataDir, files, findPythonImpl: async () => '/fake/python3.12', prepareRuntimeImpl: async ({ runtimeDir }) => { calls.push('runtime'); await mkdir(path.join(runtimeDir, 'bin'), { recursive: true }); await mkdir(path.join(runtimeDir, 'lib/python3.12/site-packages'), { recursive: true }); const binary = path.join(runtimeDir, 'bin/python'); await writeFile(binary, 'fake runtime', { mode: 0o700 }); return binary; }, downloadImpl: async ({ target, onProgress }) => { calls.push('download'); await writeFile(target, model, { flag: 'wx' }); onProgress?.(model.length); }, transcribeImpl: async task => { calls.push(task.verify ? 'verify' : 'transcribe'); return { text: task.verify ? '' : 'Crée une application conviviale.', language: task.language, duration: task.verify ? 0 : 3 }; }, ...options });
  t.after(async () => { await service.close(); await rm(dataDir, { recursive: true, force: true }); }); return { service, dataDir, calls };
}
async function install(service) { await service.install({ confirmed: true }); await service.operation; assert.equal((await service.state()).available, true); }

test('dictation never installs from metadata or an attempted transcription', async t => {
  const { service, calls } = await fixture(t); assert.equal((await service.state()).status, 'not_installed'); assert.equal((await service.state()).available, false);
  await assert.rejects(service.transcribe(body()), { code: 'DICTATION_NOT_INSTALLED' }); await assert.rejects(service.install({ confirmed: false })); await assert.rejects(service.install({ confirmed: true, url: 'https://example.com' })); assert.deepEqual(calls, []);
});
test('installation verifies the model, preserves sources and reuses it across restarts', async t => {
  const { service, dataDir, calls } = await fixture(t); await install(service); assert.deepEqual(calls, ['runtime', 'download', 'download', 'download', 'download', 'verify']);
  assert.match(await readFile(path.join(service.models, 'SOURCES-ET-LICENCES.txt'), 'utf8'), /Whisper/); await service.install({ confirmed: true }); assert.equal(calls.length, 6);
  const other = new DictationService({ dataDir, files, findPythonImpl: async () => { throw new Error('No lookup for an installed runtime'); } }); t.after(() => other.close()); assert.equal((await other.state()).available, true);
});
test('a modified or incomplete downloaded model never becomes ready', async t => {
  const { service } = await fixture(t, { downloadImpl: async ({ target }) => writeFile(target, Buffer.alloc(model.length, 0)) }); await service.install({ confirmed: true }); await service.operation; const state = await service.state(); assert.equal(state.status, 'failed'); assert.equal(state.available, false); await assert.rejects(readFile(service.marker));
});
test('transcription returns reviewable text and always removes the temporary recording', async t => {
  const { service } = await fixture(t); await install(service); const result = await service.transcribe(body('nl')); assert.equal(result.localOnly, true); assert.equal(result.reviewRequired, true); assert.equal(result.language, 'nl'); assert.equal(result.text, 'Crée une application conviviale.'); assert.deepEqual(await readdir(service.temporary), []);
});
test('a second office preserves a live recording while removing old crash leftovers', async t => {
  const { service, dataDir } = await fixture(t); await install(service);
  const live = 'dictee-00000000-0000-0000-0000-000000000001.audio', stale = 'dictee-00000000-0000-0000-0000-000000000002.audio';
  await writeFile(path.join(service.temporary, live), audio); await writeFile(path.join(service.temporary, stale), audio); const past = new Date(Date.now() - 11 * 60000); await utimes(path.join(service.temporary, stale), past, past);
  const other = new DictationService({ dataDir, files }); t.after(() => other.close()); assert.equal((await other.state()).available, true); assert.deepEqual(await readdir(service.temporary), [live]);
});
test('an engine failure does not retain a recording or mark the engine uninstalled', async t => {
  const { service } = await fixture(t); await install(service); service.run = async () => { throw new Error('test failure'); }; await assert.rejects(service.transcribe(body())); assert.deepEqual(await readdir(service.temporary), []); assert.equal((await service.state()).available, true);
});
test('silence reports a useful error and removes its recording', async t => {
  const { service } = await fixture(t); await install(service); service.run = async () => ({ text: '', duration: 4, language: 'fr' }); await assert.rejects(service.transcribe(body()), { code: 'DICTATION_NO_SPEECH' }); assert.deepEqual(await readdir(service.temporary), []);
});
test('cancellation interrupts local transcription; another request cannot overlap', async t => {
  const { service } = await fixture(t); await install(service); let entered; const began = new Promise(resolve => { entered = resolve; }); let aborted = false;
  service.run = (task, { signal }) => new Promise((resolve, reject) => { entered(); signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('Cancelled'), { code: 'DICTATION_CANCELLED' })); }, { once: true }); });
  const controller = new AbortController(), pending = service.transcribe(body(), { signal: controller.signal }); await began; await assert.rejects(service.transcribe(body()), { code: 'DICTATION_BUSY' }); controller.abort(); await assert.rejects(pending, { code: 'DICTATION_CANCELLED' }); assert.equal(aborted, true); assert.deepEqual(await readdir(service.temporary), []);
});
test('closing the service cancels its recording and rejects later work', async t => {
  const { service } = await fixture(t); await install(service); await service.close(); await assert.rejects(service.transcribe(body()), { code: 'DICTATION_CANCELLED' });
});
test('runtime and recording folders cannot escape through symbolic links', async t => {
  const { service, dataDir } = await fixture(t); await install(service); const foreign = path.join(dataDir, 'foreign'); await mkdir(foreign); await rm(service.temporary, { recursive: true }); await symlink(foreign, service.temporary); await assert.rejects(service.transcribe(body())); assert.deepEqual(await readdir(foreign), []);
});
test('a symlink planted in an unfinished runtime is rejected before installation commands', async t => {
  const { service, dataDir, calls } = await fixture(t); await service.ready; const foreign = path.join(dataDir, 'foreign'); await mkdir(foreign); await mkdir(service.runtimeDir, { recursive: true }); await symlink(foreign, path.join(service.runtimeDir, 'bin')); await service.install({ confirmed: true }); await service.operation; assert.equal((await service.state()).status, 'failed'); assert.deepEqual(calls, []); assert.deepEqual(await readdir(foreign), []);
});
test('input rejects paths, unsupported media, invalid base64 and oversized recordings', () => {
  assert.equal(validateDictationInput(body()).language, 'fr');
  for (const invalid of [{ ...body(), audioPath: '/etc/passwd' }, { ...body(), language: 'de' }, { ...body(), mimeType: 'text/html' }, { ...body(), audio: 'AAAA!!!!AAAA!!!!' }, { ...body(), audio: 'AB=='.repeat(4) }, { ...body(), audio: Buffer.alloc(DICTATION_AUDIO_LIMIT + 1).toString('base64') }, { ...body(), audio: '' }, { ...body(), mimeType: 'audio/mp4' }, { ...body(), mimeType: 'audio/webm', audio: Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:10\nhttp://127.0.0.1/private').toString('base64') }, { ...body(), audio: Buffer.from('concat:file:///etc/passwd').toString('base64') }]) assert.throws(() => validateDictationInput(invalid), { code: 'DICTATION_INVALID' });
  assert.ok(DICTATION_BODY_LIMIT > Buffer.alloc(DICTATION_AUDIO_LIMIT).toString('base64').length);
});
test('pinned public models have bounded lengths, immutable revisions and SHA-256 identities', () => { assert.equal(DICTATION_FILES.length, 4); for (const file of DICTATION_FILES) { assert.match(file.url, /\/resolve\/[a-f0-9]{40}\//u); assert.match(file.sha256, /^[a-f0-9]{64}$/u); assert.ok(file.bytes > 0 && file.bytes < 500000000); } });
test('the isolated runtime strips tokens and refuses unsupported Python versions', () => {
  for (const version of ['Python 3.10.2', 'Python 3.11.9', 'Python 3.12.1', 'Python 3.13.4']) assert.equal(supportedDictationPython(version), true);
  for (const version of ['Python 2.7', 'Python 3.9.6', 'Python 3.14.0', 'bad']) assert.equal(supportedDictationPython(version), false);
  const env = dictationEnvironment({ PATH: '/usr/bin', HOME: '/home/user', HF_TOKEN: 'secret', OPENAI_API_KEY: 'secret', PYTHONPATH: '/wrong', PIP_INDEX_URL: 'https://wrong' }, true); assert.equal(env.HOME, '/home/user'); assert.equal(env.HF_TOKEN, undefined); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.PYTHONPATH, undefined); assert.equal(env.PIP_INDEX_URL, undefined); assert.equal(env.HF_HUB_OFFLINE, '1');
});
test('downloads reject wrong hashes, extra bytes and failures without leaving partial files', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oscar-dictation-download-')); t.after(() => rm(directory, { recursive: true, force: true })); const descriptor = { url: 'https://example.com/model', bytes: 3, sha256: createHash('sha256').update('abc').digest('hex') };
  for (const content of ['abd', 'abcd', 'a']) { await assert.rejects(downloadDictationFile({ descriptor, target: path.join(directory, 'model'), fetchImpl: async () => new Response(content) })); assert.deepEqual(await readdir(directory), []); }
  await downloadDictationFile({ descriptor, target: path.join(directory, 'model'), fetchImpl: async () => new Response('abc') }); assert.equal(await readFile(path.join(directory, 'model'), 'utf8'), 'abc');
});
function fakeWorker(response, { delay = 0 } = {}) { return () => { const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; }; child.stdin.on('finish', () => setTimeout(() => { child.stdout.end(JSON.stringify(response)); child.emit('close', 0); }, delay)); return child; }; }
test('worker output is validated and cancellation terminates the child', async () => {
  const task = { python: '/fake', modelDirectory: '/model', audioPath: '/recording', language: 'fr' };
  assert.deepEqual(await runDictationTask(task, { spawnImpl: fakeWorker({ ok: true, text: ' Bonjour ', language: 'fr', duration: 2 }) }), { text: 'Bonjour', language: 'fr', duration: 2 });
  await assert.rejects(runDictationTask(task, { spawnImpl: fakeWorker({ ok: true, text: 'text', language: 'fr', duration: 91 }) }), { code: 'DICTATION_TRANSCRIBE' });
  const controller = new AbortController(), pending = runDictationTask(task, { signal: controller.signal, spawnImpl: fakeWorker({ ok: true, text: 'x', language: 'fr', duration: 1 }, { delay: 20 }) }); controller.abort(); await assert.rejects(pending, { code: 'DICTATION_CANCELLED' });
});
test('a timed out or dead worker returns an actionable failure', async () => {
  const task = { python: '/fake', modelDirectory: '/model', audioPath: '/recording', language: 'fr' };
  await assert.rejects(runDictationTask(task, { timeoutMs: 5, spawnImpl: fakeWorker({ ok: true, text: 'late', language: 'fr', duration: 1 }, { delay: 20 }) }), { code: 'DICTATION_TIMEOUT' });
  await assert.rejects(runDictationTask(task, { spawnImpl: () => { const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; queueMicrotask(() => child.emit('close', 1)); return child; } }), { code: 'DICTATION_TRANSCRIBE' });
});
test('the microphone helper supports browser formats and useful translated recovery', () => {
  assert.equal(recorderMimeType({ isTypeSupported: type => type === 'audio/mp4' }), 'audio/mp4'); assert.equal(recorderMimeType({ isTypeSupported: () => false }), ''); assert.match(microphoneError({ name: 'NotAllowedError' }), /refusé/u); assert.match(microphoneError({ name: 'NotFoundError' }), /Aucun micro/u);
  for (const locale of ['en', 'nl']) for (const source of ['Confiez votre idée à voix haute', 'Utiliser ce texte', 'La transcription prend trop de temps. Essayez un message plus court.', microphoneError({ name: 'NotAllowedError' })]) assert.notEqual(dictationText(source, locale), source);
});
