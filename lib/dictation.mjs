import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { access, lstat, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { VoiceStorage } from './local-voice.mjs';

const PACK = 'whisper-small-systran-536b066-v1';
const REVISION = '536b0662742c02347bc0e980a01041f333bce120';
const WORKER = fileURLToPath(new URL('./dictation-worker.py', import.meta.url));
export const DICTATION_AUDIO_LIMIT = 8 * 1024 * 1024;
export const DICTATION_BODY_LIMIT = Math.ceil(DICTATION_AUDIO_LIMIT / 3) * 4 + 2048;
export const DICTATION_MAX_SECONDS = 90;
export const DICTATION_FILES = Object.freeze([
  ['config.json', 2370, 'b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828'],
  ['model.bin', 483546902, '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671'],
  ['tokenizer.json', 2203239, 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab'],
  ['vocabulary.txt', 459861, '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913'],
].map(([name, bytes, sha256]) => Object.freeze({ name, bytes, sha256, url: `https://huggingface.co/Systran/faster-whisper-small/resolve/${REVISION}/${name}` })));
export const DICTATION_DOWNLOAD_BYTES = DICTATION_FILES.reduce((sum, item) => sum + item.bytes, 0);
const fail = (message, code = 'DICTATION_INVALID') => Object.assign(new Error(message), { code });
const cancelled = () => fail('La dictée a été annulée.', 'DICTATION_CANCELLED');
const MIME = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/wave', 'audio/x-wav']);

export function dictationEnvironment(source = process.env, offline = false) {
  const env = { ...source, PYTHONUNBUFFERED: '1', PIP_NO_INPUT: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_CACHE_DIR: '1', PIP_CONFIG_FILE: '/dev/null', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1', OMP_NUM_THREADS: '4' };
  for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|CLIENT_SECRET|PASSWORD|PASSWD)$/iu.test(key) || ['PYTHONPATH', 'PYTHONHOME', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL'].includes(key)) delete env[key];
  if (offline) Object.assign(env, { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1' });
  return env;
}
function command(binary, args, { signal, timeout = 10000, capture = false } = {}) {
  return new Promise((resolve, reject) => execFile(binary, args, { signal, timeout, maxBuffer: 2 * 1024 * 1024, env: dictationEnvironment() }, (error, stdout) => error ? reject(signal?.aborted ? cancelled() : fail('La préparation du moteur de dictée a échoué. Vérifiez Python, la connexion et l’espace disponible.', 'DICTATION_RUNTIME')) : resolve(capture ? stdout : '')));
}
export function supportedDictationPython(version) {
  const match = String(version).match(/^(?:Python\s+)?3\.(\d+)(?:\.|\s|$)/u);
  return Boolean(match && Number(match[1]) >= 10 && Number(match[1]) <= 13);
}
export async function findDictationPython() {
  const candidates = [];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) for (const name of ['python3.12', 'python3.11', 'python3.13', 'python3.10', 'python3']) candidates.push(path.join(directory, name));
  candidates.push(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12'));
  for (const binary of new Set(candidates)) try { await access(binary, constants.X_OK); if (supportedDictationPython(await command(binary, ['--version'], { capture: true }))) return binary; } catch { /* Try another local interpreter without reading credentials. */ }
  return null;
}
async function prepareRuntime({ python, runtimeDir, signal }) {
  await command(python, ['-m', 'venv', runtimeDir], { signal, timeout: 120000 });
  const binary = path.join(runtimeDir, 'bin', 'python');
  await command(binary, ['-I', '-m', 'pip', 'install', '--only-binary=:all:', '--disable-pip-version-check', '--no-cache-dir', '--index-url', 'https://pypi.org/simple', 'faster-whisper==1.2.1', 'ctranslate2==4.8.3', 'av==16.1.0', 'onnxruntime==1.23.2', 'tokenizers==0.22.2', 'huggingface-hub==0.36.0', 'numpy==2.2.6', 'PyYAML==6.0.3', 'tqdm==4.67.1'], { signal, timeout: 15 * 60000 });
  return binary;
}
async function digest(file) {
  const hash = createHash('sha256'), handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); } finally { await handle.close(); }
}
export async function downloadDictationFile({ descriptor, target, signal, onProgress, fetchImpl = fetch }) {
  const temporary = `${target}.${randomUUID()}.part`;
  try {
    const response = await fetchImpl(descriptor.url, { signal, redirect: 'follow', headers: { 'User-Agent': 'OscarAgents-local-dictation/0.6.0 (+https://github.com/renaud-bxl/oscar-et-les-agents)' } });
    if (!response.ok || !response.body) throw fail('Le modèle public de dictée n’a pas pu être téléchargé.');
    if (Number(response.headers?.get?.('content-length') || descriptor.bytes) > descriptor.bytes) throw fail('La taille du modèle téléchargé est inattendue.');
    const handle = await open(temporary, 'wx', 0o600), hash = createHash('sha256'); let loaded = 0;
    try { for await (const chunk of response.body) { loaded += chunk.length; if (loaded > descriptor.bytes) throw fail('Le téléchargement dépasse la taille prévue.'); hash.update(chunk); await handle.writeFile(chunk); onProgress?.(loaded); } } finally { await handle.close(); }
    if (loaded !== descriptor.bytes || hash.digest('hex') !== descriptor.sha256) throw fail('Le modèle téléchargé n’a pas la signature attendue.');
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
export function validateDictationInput(body = {}) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['audio', 'mimeType', 'language'].includes(key)) || typeof body.audio !== 'string' || body.audio.length < 16 || body.audio.length > Math.ceil(DICTATION_AUDIO_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(body.audio) || body.audio.length % 4 !== 0 || typeof body.mimeType !== 'string' || body.mimeType.length > 120 || !MIME.has(body.mimeType.split(';')[0].trim().toLowerCase()) || !['fr', 'en', 'nl'].includes(body.language)) throw fail('Choisissez un enregistrement audio de 90 secondes maximum et une langue du bureau.');
  const audio = Buffer.from(body.audio, 'base64');
  if (audio.length < 12 || audio.length > DICTATION_AUDIO_LIMIT || audio.toString('base64') !== body.audio) throw fail('L’enregistrement audio est incomplet ou trop volumineux.');
  const mime = body.mimeType.split(';')[0].trim().toLowerCase();
  const container = audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE' ? 'wav' : audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? 'webm' : audio.toString('ascii', 0, 4) === 'OggS' ? 'ogg' : audio.toString('ascii', 4, 8) === 'ftyp' ? 'mp4' : null;
  if (!container || (container === 'wav' ? !['audio/wav', 'audio/wave', 'audio/x-wav'].includes(mime) : mime !== `audio/${container}`)) throw fail('Le format réel de cet enregistrement audio n’est pas accepté.');
  return { audio, language: body.language };
}
export function runDictationTask({ python, modelDirectory, audioPath, language, verify = false }, { signal, timeoutMs = 180000, spawnImpl = spawn } = {}) {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const child = spawnImpl(python, ['-I', '-u', WORKER], { shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: dictationEnvironment(process.env, true) });
    let result = '', settled = false, timedOut = false;
    const kill = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* Already exited. */ } } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs); timer.unref();
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', kill); error ? reject(signal?.aborted ? cancelled() : error) : resolve(value); };
    signal?.addEventListener('abort', kill, { once: true }); child.stderr?.resume(); child.stdin?.on('error', () => {});
    child.stdout?.setEncoding('utf8'); child.stdout?.on('data', chunk => { result += chunk; if (result.length > 24000) { kill(); finish(fail('La réponse de dictée est trop volumineuse.')); } });
    child.on('error', () => finish(fail('Le moteur local de dictée n’a pas démarré.', 'DICTATION_RUNTIME')));
    child.on('close', code => {
      if (signal?.aborted) { finish(cancelled()); return; }
      if (timedOut) { finish(fail('La transcription prend trop de temps. Essayez un message plus court.', 'DICTATION_TIMEOUT')); return; }
      try {
        const value = JSON.parse(result);
        if (code !== 0 || value.ok !== true || typeof value.text !== 'string' || value.text.length > 16000 || !Number.isFinite(value.duration) || value.duration < 0 || value.duration > DICTATION_MAX_SECONDS + 0.05 || value.language !== language) throw new Error('Invalid response');
        finish(null, { text: value.text.trim(), language, duration: value.duration });
      } catch { finish(fail('La dictée n’a pas pu être transcrite. Réessayez avec un enregistrement plus court et audible.', 'DICTATION_TRANSCRIBE')); }
    });
    if (signal?.aborted) kill(); else child.stdin.end(JSON.stringify({ modelDirectory, audioPath, language, verify }));
  });
}

export class DictationService {
  constructor({ dataDir, platform = process.platform, arch = process.arch, findPythonImpl = findDictationPython, prepareRuntimeImpl = prepareRuntime, downloadImpl = downloadDictationFile, transcribeImpl = runDictationTask, files = DICTATION_FILES } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw fail('Le dossier du bureau est nécessaire.');
    Object.assign(this, { platform, arch, findPython: findPythonImpl, prepareRuntime: prepareRuntimeImpl, download: downloadImpl, run: transcribeImpl, files });
    this.storage = new VoiceStorage(dataDir, 'dictee-locale'); this.root = this.storage.root;
    this.runtimeDir = path.join(this.root, 'runtime'); this.models = path.join(this.root, 'modele'); this.temporary = path.join(this.root, 'temporaire'); this.marker = path.join(this.root, 'installation.json'); this.python = path.join(this.runtimeDir, 'bin', 'python');
    this.supported = ['darwin', 'linux'].includes(platform) && ['arm64', 'x64'].includes(arch); this.status = this.supported ? 'not_installed' : 'unsupported'; this.available = false; this.closed = false; this.ready = this.load();
  }
  async load() {
    if (!this.supported) return;
    try {
      const marker = JSON.parse((await this.storage.read(this.marker, 4096)).toString('utf8'));
      if (marker.pack !== PACK || marker.verified !== true) throw new Error('Unverified pack');
      await this.assertRuntime(); await this.assertModels({ hash: true }); await this.storage.directory(this.temporary);
      await this.clearAbandonedAudio(); this.available = true; this.status = 'ready';
    } catch { this.systemPython = await this.findPython(); if (!this.systemPython) this.status = 'unsupported'; }
  }
  async assertRuntime() {
    await this.runtimeFolders();
    await access(this.python, constants.X_OK);
  }
  async runtimeFolders() {
    await this.storage.directory(this.runtimeDir);
    for (const name of ['bin', 'lib']) {
      const directory = path.join(this.runtimeDir, name), info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) continue;
      await this.storage.directory(directory);
      if (name === 'lib') for (const child of await readdir(directory)) if (/^python3\.\d+$/u.test(child)) {
        const library = path.join(directory, child); await this.storage.directory(library);
        const site = path.join(library, 'site-packages');
        if (await lstat(site).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) await this.storage.directory(site);
      }
    }
  }
  async assertModels({ hash = false } = {}) {
    await this.storage.directory(this.models);
    for (const descriptor of this.files) { const file = path.join(this.models, descriptor.name), info = await this.storage.file(file); if (info.size !== descriptor.bytes || hash && await digest(file) !== descriptor.sha256) throw fail('Le modèle local de dictée est incomplet.'); }
  }
  async state() {
    await this.ready;
    return { provider: 'whisper-local', status: this.status, available: this.available, supported: this.supported && Boolean(this.available || this.systemPython), progress: this.progress ? { ...this.progress } : null, message: this.message || (this.status === 'unsupported' ? 'La dictée locale demande Python 3.10 à 3.13 sur macOS 13 ou Linux. La saisie au clavier reste disponible.' : 'Parlez à Oscar ou Zoé, puis relisez le texte avant de le transmettre. La transcription reste sur cet ordinateur.'), languages: ['fr', 'en', 'nl'], maxSeconds: DICTATION_MAX_SECONDS, maxAudioBytes: DICTATION_AUDIO_LIMIT, downloadMB: Math.ceil(DICTATION_DOWNLOAD_BYTES / 1000000), runtimeDownloadMB: 180, diskMB: 1100, localOnly: true, reviewRequired: true, requiresConfirmation: true, documentationUrl: 'https://github.com/SYSTRAN/faster-whisper', license: 'Whisper, faster-whisper et CTranslate2 : MIT. PyAV : BSD, bibliothèques FFmpeg LGPL.' };
  }
  async folders() { for (const directory of [this.root, this.runtimeDir, this.models, this.temporary]) await this.storage.directory(directory, { create: true }); }
  async clearAbandonedAudio() {
    await this.storage.directory(this.temporary);
    // Another local office may be using the same data directory. A live job
    // lasts at most three minutes; never remove its recent recording on load.
    for (const name of await readdir(this.temporary)) if (/^dictee-[a-f0-9-]{36}\.audio$/u.test(name)) {
      const file = path.join(this.temporary, name), info = await lstat(file).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink() && Date.now() - info.mtimeMs > 10 * 60000) await this.storage.remove(file);
    }
  }
  async atomic(file, value) {
    await this.storage.directory(path.dirname(file)); const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, value, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); } finally { await this.storage.remove(temporary).catch(() => {}); }
  }
  async install(body = {}) {
    await this.ready;
    if (!body || body.confirmed !== true || Object.keys(body).some(key => key !== 'confirmed')) throw fail('Confirmez le téléchargement du moteur local de dictée.');
    if (this.closed) throw cancelled();
    if (this.operation || this.active) throw fail('Le moteur de dictée est occupé.', 'DICTATION_BUSY');
    if (this.available) return this.state();
    if (!this.supported || !this.systemPython) throw fail('Python 3.10 à 3.13 est nécessaire. Installez-le puis relancez le bureau.', 'DICTATION_RUNTIME');
    this.status = 'installing'; this.message = null; this.progress = { phase: 'runtime', loaded: 0, total: DICTATION_DOWNLOAD_BYTES, percent: null };
    this.installController = new AbortController(); const controller = this.installController;
    const timer = setTimeout(() => controller.abort(), 25 * 60000); timer.unref();
    this.operation = Promise.resolve().then(async () => {
      await this.folders(); await this.runtimeFolders(); this.python = await this.prepareRuntime({ python: this.systemPython, runtimeDir: this.runtimeDir, signal: controller.signal });
      if (this.python !== path.join(this.runtimeDir, 'bin', 'python')) throw fail('Le moteur de dictée doit rester dans son dossier local.');
      await this.assertRuntime(); let completed = 0;
      for (const descriptor of this.files) {
        if (controller.signal.aborted) throw cancelled();
        this.progress.phase = 'download'; const target = path.join(this.models, descriptor.name), existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (existing?.isSymbolicLink() || existing && !existing.isFile()) throw fail('Le dossier du modèle ne peut pas contenir de liens.');
        if (!(existing && existing.size === descriptor.bytes && await digest(target) === descriptor.sha256)) await this.download({ descriptor, target, signal: controller.signal, onProgress: loaded => { this.progress.loaded = completed + loaded; this.progress.percent = Math.floor(this.progress.loaded / this.progress.total * 100); } });
        completed += descriptor.bytes; this.progress.loaded = completed;
      }
      this.progress.phase = 'verify'; this.progress.percent = null; await this.assertModels({ hash: true });
      const result = await this.run({ python: this.python, modelDirectory: await this.storage.expected(this.models), language: 'fr', verify: true }, { signal: controller.signal });
      if (result.text !== '' || result.duration !== 0) throw fail('Le test du moteur de dictée n’a pas abouti.');
      await this.atomic(path.join(this.models, 'SOURCES-ET-LICENCES.txt'), `Dictée locale : Whisper small multilingue\nPoids OpenAI Whisper, licence MIT : https://github.com/openai/whisper/blob/main/LICENSE\nConversion CTranslate2 publiée par SYSTRAN : https://huggingface.co/Systran/faster-whisper-small\nfaster-whisper 1.2.1, MIT : https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE\nCTranslate2 4.8.3, MIT : https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE\nPyAV 16.1.0, BSD ; bibliothèques FFmpeg LGPL : https://pyav.org/docs/stable/overview/installation.html\nAudio temporaire, supprimé après transcription ou annulation. Aucun service de transcription distant.\n\n${this.files.map(row => `${row.name}\n${row.url}\n${row.bytes} octets\nSHA-256 ${row.sha256}`).join('\n\n')}\n`);
      await this.atomic(this.marker, JSON.stringify({ pack: PACK, verified: true })); this.available = true; this.status = 'ready';
    }).catch(error => { this.available = false; this.status = this.closed ? 'not_installed' : 'failed'; this.message = error?.code === 'DICTATION_CANCELLED' ? 'Installation annulée. La saisie au clavier reste disponible.' : 'Le moteur de dictée n’a pas pu être installé et vérifié. Vérifiez Python, la connexion et l’espace disponible, puis réessayez.'; }).finally(() => { clearTimeout(timer); this.progress = null; this.installController = null; this.operation = null; });
    return this.state();
  }
  async transcribe(body, { signal } = {}) {
    const input = validateDictationInput(body); await this.ready;
    if (this.closed || signal?.aborted) throw cancelled();
    if (!this.available) throw fail('Installez volontairement le moteur local de dictée avant d’utiliser le micro.', 'DICTATION_NOT_INSTALLED');
    if (this.operation || this.active) throw fail('Une autre dictée est déjà en cours. Réessayez dans un instant.', 'DICTATION_BUSY');
    const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); this.active = controller;
    const audio = path.join(this.temporary, `dictee-${randomUUID()}.audio`);
    this.processing = (async () => {
      try {
        await this.assertRuntime(); await this.assertModels(); await this.storage.directory(this.temporary);
        if (signal?.aborted) controller.abort(); if (controller.signal.aborted) throw cancelled();
        await writeFile(audio, input.audio, { flag: 'wx', mode: 0o600 }); await this.storage.file(audio);
        const result = await this.run({ python: this.python, modelDirectory: await this.storage.expected(this.models), audioPath: await this.storage.expected(audio), language: input.language }, { signal: controller.signal });
        if (controller.signal.aborted) throw cancelled();
        if (!result.text) throw fail('Aucune parole claire détectée. Rapprochez-vous du micro ou saisissez votre demande.', 'DICTATION_NO_SPEECH');
        return { ...result, localOnly: true, reviewRequired: true };
      } finally { input.audio.fill(0); await this.storage.remove(audio).catch(() => {}); signal?.removeEventListener('abort', abort); this.active = null; }
    })();
    try { return await this.processing; } finally { this.processing = null; }
  }
  async close() { this.closed = true; this.installController?.abort(); this.active?.abort(); await this.operation; await this.processing?.catch(() => {}); }
}
