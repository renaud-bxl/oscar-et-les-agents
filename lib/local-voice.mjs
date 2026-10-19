import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const VERSION = '1.13.8';
const WORKER = fileURLToPath(new URL('./local-voice-worker.mjs', import.meta.url));
const AUDIO_LIMIT = 8 * 1024 * 1024;
const CACHE_BYTES = 32 * 1024 * 1024;
const CACHE_FILES = 100;
const voiceError = (message, code = 'VOICE_INVALID') => Object.assign(new Error(message), { code });
const GROUPS = Object.freeze({
  siwis: Object.freeze({ archive: 'vits-piper-fr_FR-siwis-medium-int8', bytes: 20914888, sha256: '3909cff9b3cfd4820c66aa13bf554315c82e34899c161f0b446ece372bc4b5ec', license: 'CC BY 4.0 · données SIWIS', source: 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD' }),
  upmc: Object.freeze({ archive: 'vits-piper-fr_FR-upmc-medium-int8', bytes: 22588190, sha256: 'ec4930dd3778e19e6ea2bc0d16c5a50a82f428ba7ee43dceab1df7efbaf9f1d3', license: 'CC BY-SA 4.0 · données UPMC', source: 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/upmc/medium/MODEL_CARD' }),
  alba: Object.freeze({ archive: 'vits-piper-en_GB-alba-medium-int8', bytes: 21104326, sha256: 'f7581d123ae977f64f3032bb247d4deeac8440e881d918d36fdd36d8f1030fb7', license: 'CC BY 4.0 · données Alba', source: 'https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/alba/medium/MODEL_CARD' }),
});
export const LOCAL_VOICES = Object.freeze([
  Object.freeze({ id: 'fr-siwis', name: 'Siwis · français', lang: 'fr', gender: 'female', group: 'siwis', sid: 0 }),
  Object.freeze({ id: 'fr-jessica', name: 'Jessica · français', lang: 'fr', gender: 'female', group: 'upmc', sid: 0 }),
  Object.freeze({ id: 'fr-pierre', name: 'Pierre · français', lang: 'fr', gender: 'male', group: 'upmc', sid: 1 }),
  Object.freeze({ id: 'en-alba', name: 'Alba · English', lang: 'en', gender: 'female', group: 'alba', sid: 0 }),
]);
const PUBLIC_NOTICE = 'Voix neuronales Piper calculées sur cet ordinateur après téléchargement volontaire. Aucun texte envoyé à un service vocal, aucune clé API ni voix clonée. Français et anglais disponibles ; les autres langues gardent les sous-titres. La qualité et la vitesse dépendent du modèle et de votre ordinateur.';

function subprocess(command, args, { signal, cwd, timeout = 120000, capture = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, signal, timeout, maxBuffer: 2 * 1024 * 1024, env }, (error, stdout) => error ? reject(voiceError('Une étape du moteur vocal local a échoué.')) : resolve(capture ? stdout : ''));
  });
}
function safeEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|CLIENT_SECRET|PASSWORD|PASSWD)$/i.test(key)) delete env[key];
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ''}`;
  return env;
}
async function installRuntime({ runtimeDir, signal, platform = process.platform, arch = process.arch }) {
  const scripts = [path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  let command, args;
  for (const script of scripts) if ((await stat(script).catch(() => null))?.isFile()) { command = process.execPath; args = [script]; break; }
  if (!command) for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const file = path.join(directory, 'npm');
    try { await access(file, constants.X_OK); command = file; args = []; break; } catch { /* Try the next local executable. */ }
  }
  if (!command) throw voiceError('Les outils de Node.js sont absents. Relancez l’installation du bureau.');
  await mkdir(runtimeDir, { recursive: true });
  await subprocess(command, [...args, '--prefix', runtimeDir, 'install', '--no-fund', '--no-audit', '--ignore-scripts', '--omit=optional', `sherpa-onnx-node@${VERSION}`, `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}@${VERSION}`], { signal, timeout: 10 * 60000, env: safeEnvironment() });
}

export async function downloadModel({ descriptor, target, signal, onProgress, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${descriptor.archive}.tar.bz2`, { signal, redirect: 'follow' });
  if (!response.ok || !response.body) throw voiceError('Le téléchargement officiel du modèle vocal a échoué.');
  if (Number(response.headers.get('content-length') || descriptor.bytes) > descriptor.bytes) throw voiceError('La taille du téléchargement vocal est inattendue.');
  const file = await open(target, 'wx', 0o600);
  const hash = createHash('sha256');
  let loaded = 0;
  try {
    for await (const chunk of response.body) {
      loaded += chunk.length;
      if (loaded > descriptor.bytes) throw voiceError('Le téléchargement vocal dépasse la taille attendue.');
      hash.update(chunk); await file.write(chunk);
      onProgress?.(loaded, descriptor.bytes);
    }
  } finally { await file.close(); }
  if (loaded !== descriptor.bytes || hash.digest('hex') !== descriptor.sha256) throw voiceError('Le modèle téléchargé n’a pas la signature attendue. Il n’a pas été installé.');
}

export function validateVoiceArchive(names, details, archive) {
  const entries = String(names).split(/\r?\n/).filter(Boolean);
  const roots = new Set(entries.map(name => name.split('/')[0]));
  const accepted = new Set([archive, archive.replace(/-int8$/, '')]);
  if (!entries.length || entries.length > 5000 || roots.size !== 1 || !accepted.has([...roots][0]) || entries.some(name => /[\x00-\x1f\x7f\\]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..'))) throw voiceError('L’archive vocale contient un chemin inattendu.');
  const kinds = String(details).split(/\r?\n/).filter(Boolean);
  if (kinds.length !== entries.length || kinds.some(line => !/^[-d]/.test(line))) throw voiceError('Les liens et fichiers spéciaux ne sont pas acceptés dans un modèle vocal.');
  return [...roots][0];
}

async function extractModel({ archiveFile, directory, descriptor, signal }) {
  const settings = { signal, capture: true };
  const names = await subprocess('tar', ['-tjf', archiveFile], settings);
  const details = await subprocess('tar', ['-tvjf', archiveFile], settings);
  const root = validateVoiceArchive(names, details, descriptor.archive);
  await subprocess('tar', ['-xjf', archiveFile, '-C', directory], { signal });
  return path.join(directory, root);
}

export async function validateVoiceModel(directory) {
  const root = await realpath(directory);
  if ((await lstat(directory)).isSymbolicLink()) throw voiceError('Le dossier du modèle vocal ne peut pas être un lien.');
  const files = await readdir(root);
  const models = files.filter(file => file.endsWith('.onnx'));
  if (models.length !== 1) throw voiceError('Le modèle vocal est incomplet.');
  for (const file of [models[0], 'tokens.txt', 'espeak-ng-data']) {
    const full = path.join(root, file), info = await lstat(full);
    if (info.isSymbolicLink() || !(await realpath(full)).startsWith(root + path.sep) || (file === 'espeak-ng-data' ? !info.isDirectory() : !info.isFile())) throw voiceError('Le modèle vocal contient un fichier inattendu.');
  }
  return { model: path.join(root, models[0]), tokens: path.join(root, 'tokens.txt'), dataDir: path.join(root, 'espeak-ng-data') };
}

export function validWave(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 44 && buffer.length <= AUDIO_LIMIT && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
}

async function synthesizeInChild(task, { signal, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [], { silent: true, env: safeEnvironment(), execArgv: ['--max-old-space-size=768'] });
    let done = false, succeeded = false;
    child.stdout?.resume(); child.stderr?.resume();
    const stop = () => { child.kill('SIGKILL'); };
    const timer = setTimeout(stop, timeout);
    const finish = error => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      error ? reject(voiceError('La synthèse vocale locale n’a pas abouti. Les sous-titres restent disponibles.')) : resolve();
    };
    child.on('message', message => { succeeded = message?.ok === true; });
    child.on('error', finish);
    child.on('exit', code => finish(code === 0 && succeeded && !signal?.aborted ? null : new Error('Voice failed')));
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop(); else child.send(task);
  });
}

export class LocalVoice {
  constructor({ dataDir, platform = process.platform, arch = process.arch, installRuntimeImpl = installRuntime, downloadImpl = downloadModel, extractImpl = extractModel, synthesizeImpl = synthesizeInChild, maxCacheBytes = CACHE_BYTES, maxCacheFiles = CACHE_FILES } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw voiceError('Le dossier du bureau est nécessaire.');
    Object.assign(this, { platform, arch, installRuntime: installRuntimeImpl, download: downloadImpl, extract: extractImpl, synthesize: synthesizeImpl, maxCacheBytes, maxCacheFiles });
    this.root = path.join(path.resolve(dataDir), 'voix-locales');
    this.runtimeDir = path.join(this.root, 'runtime'); this.cacheDir = path.join(this.root, 'cache'); this.modelDir = path.join(this.root, 'modeles');
    this.manifestFile = path.join(this.root, 'installation.json'); this.installed = new Set(); this.closed = false;
    this.supported = ['darwin', 'linux'].includes(platform) && ['arm64', 'x64'].includes(arch);
    this.status = this.supported ? 'not_installed' : 'unsupported'; this.progress = null;
    this.ready = this.load();
  }
  async load() {
    let manifest;
    try {
      const text = await readFile(this.manifestFile, 'utf8');
      if (text.length > 10000) return;
      manifest = JSON.parse(text);
    } catch { return; }
    if (manifest?.version !== VERSION || !Array.isArray(manifest.groups)) return;
    for (const group of manifest.groups.filter(group => Object.hasOwn(GROUPS, group))) {
      try { await validateVoiceModel(path.join(this.modelDir, group)); await this.assertRuntime(); this.installed.add(group); } catch { /* A partial installation is never ready. */ }
    }
    if (this.installed.size && this.supported) this.status = 'ready';
    await this.pruneCache().catch(() => {});
  }
  async assertRuntime() {
    const file = path.join(this.runtimeDir, 'node_modules', 'sherpa-onnx-node', 'package.json');
    const text = await readFile(file, 'utf8');
    if (text.length > 10000 || JSON.parse(text).version !== VERSION) throw voiceError('Le moteur vocal local est incomplet.');
  }
  async state() {
    await this.ready;
    return { provider: 'piper-local', status: this.status, available: this.supported && this.installed.size > 0, message: this.failure || PUBLIC_NOTICE, progress: this.progress ? { ...this.progress } : null, voices: LOCAL_VOICES.map(({ group, sid, ...voice }) => ({ ...voice, installed: this.installed.has(group), downloadMB: Math.ceil(GROUPS[group].bytes / 1000000), license: GROUPS[group].license, source: GROUPS[group].source })), runtimeDownloadMB: 35, requiresConfirmation: true, localOnly: true, cacheMaxMB: Math.ceil(this.maxCacheBytes / 1024 / 1024), languages: ['fr', 'en'], documentationUrl: 'https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_offline_tts.html', licenseNotice: 'Sherpa ONNX : Apache 2.0. Modèles Piper : voir chaque fiche. Prononciation eSpeak NG : GPL 3 ou ultérieure ; sources https://github.com/espeak-ng/espeak-ng. Les notices des modèles sont conservées dans leur dossier.' };
  }
  voice(id) {
    const voice = LOCAL_VOICES.find(voice => voice.id === id);
    if (!voice) throw voiceError('Choisissez une voix locale proposée.');
    return voice;
  }
  async secureFolders() {
    for (const directory of [this.root, this.runtimeDir, this.modelDir, this.cacheDir]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await lstat(directory)).isSymbolicLink()) throw voiceError('Le dossier vocal ne peut pas être un lien.');
    }
  }
  async save() {
    const temporary = path.join(this.root, `.installation-${randomUUID()}.json`);
    await writeFile(temporary, JSON.stringify({ version: VERSION, groups: [...this.installed] }), { flag: 'wx', mode: 0o600 });
    await rename(temporary, this.manifestFile);
  }
  async install(body = {}) {
    await this.ready;
    if (!this.supported) throw voiceError('Le moteur vocal local est proposé sur macOS et Linux, avec processeur Intel ou Apple Silicon.');
    if (this.closed) throw voiceError('Le bureau se ferme.');
    if (body.confirmed !== true || Object.keys(body).some(key => !['voiceId', 'confirmed'].includes(key))) throw voiceError('Confirmez le téléchargement volontaire de cette voix avant de continuer.');
    const voice = this.voice(body.voiceId);
    if (this.operation || this.speaking) throw voiceError('Le moteur vocal est déjà occupé. Réessayez dans un instant.', 'VOICE_BUSY');
    if (this.installed.has(voice.group)) return this.state();
    const controller = new AbortController(); this.controller = controller;
    this.status = 'installing'; this.failure = null;
    this.progress = { phase: 'runtime', voiceId: voice.id, loaded: 0, total: GROUPS[voice.group].bytes, percent: null };
    this.operation = Promise.resolve().then(async () => {
      const timer = setTimeout(() => controller.abort(), 20 * 60000); timer.unref();
      this.installTimer = timer;
      await this.secureFolders();
      await this.installRuntime({ runtimeDir: this.runtimeDir, signal: controller.signal, platform: this.platform, arch: this.arch });
      await this.assertRuntime();
      const temporary = path.join(this.root, `.telechargement-${randomUUID()}`);
      await mkdir(temporary, { mode: 0o700 });
      try {
        const descriptor = GROUPS[voice.group], archiveFile = path.join(temporary, 'modele.tar.bz2');
        this.progress.phase = 'download'; this.progress.percent = 0;
        await this.download({ descriptor, target: archiveFile, signal: controller.signal, onProgress: (loaded, total) => { this.progress.loaded = loaded; this.progress.total = total; this.progress.percent = Math.floor(loaded / total * 100); } });
        this.progress.phase = 'extract'; this.progress.percent = null;
        const extracted = await this.extract({ archiveFile, directory: temporary, descriptor, signal: controller.signal });
        if (!(await realpath(extracted)).startsWith(await realpath(temporary) + path.sep)) throw voiceError('Le modèle vocal est hors du dossier de téléchargement.');
        await validateVoiceModel(extracted);
        this.progress.phase = 'verify';
        const preview = path.join(temporary, 'verification.wav');
        await this.synthesize({ runtimeDir: this.runtimeDir, modelDir: extracted, sid: voice.sid, text: voice.lang === 'fr' ? 'Bonjour. Votre bureau est prêt.' : 'Hello. Your office is ready.', speed: 1, output: preview }, { signal: controller.signal });
        if (!validWave(await readFile(preview))) throw voiceError('Le moteur vocal n’a pas produit de son valide.');
        const destination = path.join(this.modelDir, voice.group);
        await rm(destination, { recursive: true, force: true });
        await rename(extracted, destination);
        this.installed.add(voice.group); await this.save(); this.status = 'ready';
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }).catch(() => { this.status = 'failed'; this.failure = 'La voix locale n’a pas pu être installée ou vérifiée. Aucun texte n’a été envoyé à un service vocal. Les sous-titres restent disponibles ; vous pouvez réessayer.'; }).finally(() => { clearTimeout(this.installTimer); this.installTimer = null; this.progress = null; this.operation = null; this.controller = null; });
    return this.state();
  }
  async speak(body = {}) {
    await this.ready;
    if (this.closed) throw voiceError('Le bureau se ferme.');
    if (Object.keys(body).some(key => !['text', 'voiceId', 'speed'].includes(key))) throw voiceError('Les options vocales sont invalides.');
    const voice = this.voice(body.voiceId), speed = body.speed ?? 1;
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.text) || typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.8 || speed > 1.2) throw voiceError('Utilisez un texte de 1 à 500 caractères et une vitesse entre 0,8 et 1,2.');
    if (!this.supported || !this.installed.has(voice.group)) throw voiceError('Cette voix n’est pas installée. Les sous-titres restent disponibles ; téléchargez la voix dans les réglages pour l’écouter.', 'VOICE_NOT_INSTALLED');
    if (this.operation || this.speaking) throw voiceError('Le moteur vocal est déjà occupé. Réessayez dans un instant.', 'VOICE_BUSY');
    const key = createHash('sha256').update(JSON.stringify([VERSION, GROUPS[voice.group].sha256, voice.id, body.text, speed])).digest('hex');
    const output = path.join(this.cacheDir, `${key}.wav`), url = `/api/voice/audio/${key}.wav`;
    try { await this.audio(key); return { url, voiceId: voice.id, cached: true }; } catch { /* Generate only after explicit speech request. */ }
    const controller = new AbortController(); this.speechController = controller;
    this.speaking = Promise.resolve().then(async () => {
      await this.secureFolders(); await this.assertRuntime(); await validateVoiceModel(path.join(this.modelDir, voice.group));
      const temporary = path.join(this.cacheDir, `.audio-${randomUUID()}.wav`);
      try {
        await this.synthesize({ runtimeDir: this.runtimeDir, modelDir: path.join(this.modelDir, voice.group), sid: voice.sid, text: body.text, speed, output: temporary }, { signal: controller.signal });
        if (!validWave(await readFile(temporary))) throw voiceError('La synthèse vocale locale n’a pas produit de son valide.');
        await rename(temporary, output); await this.pruneCache();
      } finally { await rm(temporary, { force: true }); }
      return { url, voiceId: voice.id, cached: false };
    }).catch(() => { throw voiceError('La synthèse vocale locale n’a pas abouti. Les sous-titres restent disponibles.'); }).finally(() => { this.speaking = null; this.speechController = null; });
    return this.speaking;
  }
  async audio(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw voiceError('Son introuvable.', 'VOICE_AUDIO_NOT_FOUND');
    try {
      const file = path.join(this.cacheDir, `${key}.wav`), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > AUDIO_LIMIT || !(await realpath(file)).startsWith(await realpath(this.cacheDir) + path.sep)) throw new Error('Invalid audio');
      const buffer = await readFile(file);
      if (!validWave(buffer)) throw new Error('Invalid wave');
      return buffer;
    } catch { throw voiceError('Son introuvable.', 'VOICE_AUDIO_NOT_FOUND'); }
  }
  async pruneCache() {
    const files = [];
    for (const name of await readdir(this.cacheDir).catch(() => [])) if (/^[a-f0-9]{64}\.wav$/.test(name)) {
      const full = path.join(this.cacheDir, name), info = await lstat(full).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink()) files.push({ full, size: info.size, modified: info.mtimeMs });
    }
    files.sort((a, b) => b.modified - a.modified);
    let bytes = 0;
    for (let index = 0; index < files.length; index++) { bytes += files[index].size; if (index >= this.maxCacheFiles || bytes > this.maxCacheBytes) await rm(files[index].full, { force: true }); }
  }
  async close() {
    this.closed = true; this.controller?.abort(); this.speechController?.abort();
    await Promise.allSettled([this.operation, this.speaking].filter(Boolean));
  }
}
