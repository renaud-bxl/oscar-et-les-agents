import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { access, lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { validWave, VoiceStorage } from './local-voice.mjs';

const VERSION = '3.3.0';
const PACK = 'pocket-3.3.0-fr24-en6-nl6-v1';
const EXTRA_PACK = 'pocket-3.3.0-charles-alba-v1';
const WORKER = fileURLToPath(new URL('./pocket-voice-worker.py', import.meta.url));
const HUB = 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/';
const MODEL_FR = '8843db76457a91db32077edf8dfcd1c0e3e755fd';
const MODEL_EN = 'e7205b6ee50e654a5ea19f0e9df2b0813b05e921';
const TOKEN_EN = '00eac05ed3d16bdc3f6b5d598874019c34a89214';
const EMBEDDINGS = '4e1e0a3e611c51c0b4ed8174fc10f32a54644303';
// Published LFS SHA-256 values, pinned to the releases used by pocket-tts 3.3.0.
const asset = (variant, file, revision, bytes, sha256, source = file) => Object.freeze({ path: `${variant}/${file}`, url: `${HUB}${revision}/languages/${variant}/${source}`, bytes, sha256 });
export const POCKET_FILES = Object.freeze([
  asset('french_24l', 'model.safetensors', MODEL_FR, 672178676, 'c91c2a29178419111d67f271c71c36de8e71290555f481c42b9023540106062d'),
  asset('french_24l', 'tokenizer.json', MODEL_FR, 246403, '6211acffe9cb95172f71f0051f18e26ea305b2b32ea00b331ee976551c70887f'),
  asset('french_24l', 'oscar.safetensors', EMBEDDINGS, 24780120, 'bed698f4b08cb20b3746b7bec71781bd10291d0f41d2e6584126a4fd60a0a206', 'embeddings/marius.safetensors'),
  asset('french_24l', 'zoe.safetensors', EMBEDDINGS, 33037664, '84768f1e3b8b3690ba0135df2ba692e09dd5df5095715ade7bf19a9ebbe3a303', 'embeddings/estelle.safetensors'),
  asset('english', 'model.safetensors', MODEL_EN, 219029196, '916ccd2686e9311cb40054893a3c4284393d658825ffc714a276f3e9b152344f'),
  asset('english', 'tokenizer.json', TOKEN_EN, 245020, 'f498428e1eafee50492f7be13dc9bfafcfc12e508cd0eb1b01c92ecd5d8c6687'),
  asset('english', 'oscar.safetensors', EMBEDDINGS, 6195000, 'b05946f39371f8853902b0486231f2d401c8a9570da9978329120d4ecfd009e9', 'embeddings/marius.safetensors'),
  asset('english', 'zoe.safetensors', EMBEDDINGS, 8259384, '62bcdb95745e71c60259974ac8547557fa23cece479bf6cc88d68cb84a970cdc', 'embeddings/estelle.safetensors'),
  asset('dutch', 'model.safetensors', EMBEDDINGS, 219029196, '0de1e5b074458de1330a264d0de39649a51eedf001cc30d181b80c7b0d00e61d'),
  asset('dutch', 'tokenizer.json', EMBEDDINGS, 245206, 'e6f610b98c427641b4ab0e1024dca7843e3d6b620871a14b204932e42c5a1736'),
  asset('dutch', 'oscar.safetensors', EMBEDDINGS, 6195000, '77276d0dceb69c02ed90903ccf5fbf51f0dab0832869b0f3d44966fc434e6a72', 'embeddings/marius.safetensors'),
  asset('dutch', 'zoe.safetensors', EMBEDDINGS, 8259384, '90a8b4c756d273dcedee890c2133c88f7385f96080be7c040ae19d6b50bdafef', 'embeddings/estelle.safetensors'),
]);
export const POCKET_DOWNLOAD_BYTES = POCKET_FILES.reduce((sum, row) => sum + row.bytes, 0);
// Additional published presets share the existing language models and runtime.
export const POCKET_EXTRA_FILES = Object.freeze([
  asset('french_24l', 'charles.safetensors', EMBEDDINGS, 24780120, '1147b4fea3e2491cd22b51500e7980e1bce1a85e5d7697b9d29e1d9d85da10e8', 'embeddings/charles.safetensors'),
  asset('french_24l', 'alba.safetensors', EMBEDDINGS, 24780120, 'db8f2e7e1af5abbc28f6a19965037a0c00b4c0f769fd72f914dc552ff3cab642', 'embeddings/alba.safetensors'),
  asset('english', 'charles.safetensors', EMBEDDINGS, 6195000, 'f6c03e29e9b17708f24ef3aaab0af92d9c11565c0997ee8c8271cacc72cfe53a', 'embeddings/charles.safetensors'),
  asset('english', 'alba.safetensors', EMBEDDINGS, 6195000, 'd291428b416d6c36a1de7835e51dbe1e334b75e5af512bb18dd23a1047fe8f3b', 'embeddings/alba.safetensors'),
  asset('dutch', 'charles.safetensors', EMBEDDINGS, 6195000, '3f2d34b928fe1422455a52e518c6f2d2572a6f556c4ea24615d10beffff3517d', 'embeddings/charles.safetensors'),
  asset('dutch', 'alba.safetensors', EMBEDDINGS, 6195000, 'f13840d3c6ebafc4d0f93f4b5cee08760f0491f171ccde013ac73b7506a88762', 'embeddings/alba.safetensors'),
]);
export const POCKET_EXTRA_DOWNLOAD_BYTES = POCKET_EXTRA_FILES.reduce((sum, row) => sum + row.bytes, 0);
export const POCKET_VOICES = Object.freeze([
  Object.freeze({ id: 'studio-oscar', name: 'Oscar · Marius', character: 'oscar', gender: 'male', preset: 'Marius', previewKey: 'studio-oscar', additional: false }),
  Object.freeze({ id: 'studio-oscar-2', name: 'Oscar · Charles', character: 'oscar', gender: 'male', preset: 'Charles', previewKey: 'studio-oscar-2', additional: true }),
  Object.freeze({ id: 'studio-zoe', name: 'Zoé · Estelle', character: 'zoe', gender: 'female', preset: 'Estelle', previewKey: 'studio-zoe', additional: false }),
  Object.freeze({ id: 'studio-zoe-2', name: 'Zoé · Alba', character: 'zoe', gender: 'female', preset: 'Alba', previewKey: 'studio-zoe-2', additional: true }),
]);
const failure = (message, code = 'VOICE_INVALID') => Object.assign(new Error(message), { code });
const cancelled = () => failure('Cette réplique a été interrompue.', 'VOICE_CANCELLED');
const clone = value => structuredClone(value);
const NOTICE = 'Deux choix de voix pour Oscar et deux pour Zoé, en français, anglais et néerlandais. Pack de base d’environ 1,2 Go, plus Python et ses dépendances ; complément Charles et Alba d’environ 75 Mo. Téléchargements volontaires uniquement. La première réplique peut demander un chargement ; les modèles restent ensuite en mémoire. Les voix sont des presets publiés par Kyutai, sans import de voix personnelle ; aucun texte envoyé à un service vocal.';

function environment(source = process.env, offline = false) {
  const env = { ...source, PYTHONUNBUFFERED: '1', PIP_NO_INPUT: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_CACHE_DIR: '1', PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1' };
  for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|CLIENT_SECRET|PASSWORD|PASSWD)$/i.test(key) || ['PYTHONPATH', 'PYTHONHOME', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL'].includes(key)) delete env[key];
  if (offline) Object.assign(env, { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' });
  return env;
}
function command(binary, args, { signal, timeout = 10000, capture = false, env = environment() } = {}) {
  return new Promise((resolve, reject) => execFile(binary, args, { signal, timeout, maxBuffer: 3 * 1024 * 1024, env }, (error, stdout) => error ? reject(failure('La préparation du moteur de conversation local a échoué.')) : resolve(capture ? stdout : '')));
}
export function supportedPython(version) { const match = String(version).match(/^(?:Python\s+)?(\d+)\.(\d+)/); return Boolean(match && Number(match[1]) === 3 && Number(match[2]) >= 10 && Number(match[2]) <= 14); }
async function findPython() {
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const binary = path.join(directory, 'python3');
    try { await access(binary, constants.X_OK); const version = await command(binary, ['--version'], { capture: true }); if (supportedPython(version)) return binary; } catch { /* Another local Python may be compatible. */ }
  }
  return null;
}
async function prepareRuntime({ python, runtimeDir, signal, platform }) {
  await command(python, ['-m', 'venv', runtimeDir], { signal, timeout: 120000 });
  const binary = path.join(runtimeDir, 'bin', 'python');
  const common = ['-I', '-m', 'pip', 'install', '--only-binary=:all:', '--disable-pip-version-check', '--no-cache-dir'];
  if (platform === 'linux') await command(binary, [...common, '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==2.14.1'], { signal, timeout: 15 * 60000 });
  await command(binary, [...common, '--index-url', 'https://pypi.org/simple', 'pocket-tts==3.3.0', 'torch==2.14.1'], { signal, timeout: 15 * 60000 });
  return binary;
}
async function digest(file) { const hash = createHash('sha256'), handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); } finally { await handle.close(); } }
export async function downloadPocketFile({ descriptor, target, signal, onProgress, fetchImpl = fetch }) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.part`;
  try {
    const response = await fetchImpl(descriptor.url, { signal, redirect: 'follow', headers: { 'User-Agent': 'Oscar-local-voices/0.5.0' } });
    if (!response.ok || !response.body) throw failure('Le modèle public n’a pas pu être téléchargé.');
    const handle = await open(temporary, 'wx', 0o600), hash = createHash('sha256'); let loaded = 0;
    try {
      for await (const chunk of response.body) {
        loaded += chunk.length; if (loaded > descriptor.bytes) throw failure('Le téléchargement vocal dépasse la taille attendue.');
        hash.update(chunk); await handle.writeFile(chunk); onProgress?.(loaded);
      }
    } finally { await handle.close(); }
    if (loaded !== descriptor.bytes || hash.digest('hex') !== descriptor.sha256) throw failure('La signature du fichier vocal n’est pas celle publiée par le fournisseur.');
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

export class PocketWorker {
  constructor({ python, spawnImpl = spawn, timeoutMs = 120000 } = {}) {
    this.timeoutMs = timeoutMs; this.alive = true; this.pending = null; this.buffer = '';
    this.child = spawnImpl(python, ['-I', '-u', WORKER], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: environment(process.env, true) });
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.ready.catch(() => {});
    this.readyTimer = setTimeout(() => this.fail(), 30000); this.readyTimer.unref();
    this.child.stderr?.resume();
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', chunk => {
      this.buffer += chunk;
      if (this.buffer.length > 64000) { this.fail(); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        let value; try { value = JSON.parse(line); } catch { this.fail(); return; }
        if (value.ready === true) { clearTimeout(this.readyTimer); this.readyResolve(); }
        else if (this.pending && value.id === this.pending.id) {
          const pending = this.pending; this.pending = null;
          value.cancelled ? pending.finish(cancelled()) : value.ok === true ? pending.finish(null, value) : pending.finish(failure('La voix locale n’a pas produit cette réplique. Les sous-titres restent disponibles.'));
        }
      }
    });
    this.child.on('error', () => this.fail()); this.child.on('exit', () => this.fail());
    this.child.stdin?.on('error', () => this.fail());
  }
  async generate(task, { signal } = {}) {
    await this.ready;
    if (signal?.aborted) throw cancelled();
    if (!this.alive || this.pending) throw failure('Le moteur de conversation n’est pas disponible.');
    return new Promise((resolve, reject) => {
      const id = randomUUID(); let killTimer;
      const timer = setTimeout(() => this.fail(), this.timeoutMs); timer.unref();
      const abort = () => { this.send({ type: 'cancel', id }); killTimer = setTimeout(() => this.fail(), 2000); killTimer.unref(); };
      const finish = (error, value) => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); error ? reject(signal?.aborted ? cancelled() : error) : resolve(value); };
      this.pending = { id, finish };
      signal?.addEventListener('abort', abort, { once: true });
      this.send({ type: 'speak', id, ...task });
      if (signal?.aborted) abort();
    });
  }
  send(value) { if (this.alive && this.child.stdin?.writable) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  fail() {
    if (!this.alive) return; this.alive = false; clearTimeout(this.readyTimer);
    const error = failure('Le moteur de conversation local s’est arrêté. Les sous-titres restent disponibles.');
    this.readyReject(error); const pending = this.pending; this.pending = null; pending?.finish(error);
    this.child.kill('SIGKILL');
  }
  async close() { this.fail(); }
}

export class PocketVoice {
  constructor({ dataDir, platform = process.platform, findPythonImpl = findPython, prepareRuntimeImpl = prepareRuntime, downloadImpl = downloadPocketFile, workerFactory = options => new PocketWorker(options), files = POCKET_FILES, extraFiles = POCKET_EXTRA_FILES, maxCacheFiles = 100, maxCacheBytes = 32 * 1024 * 1024, idleMs = 5 * 60000 } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw failure('Le dossier du bureau est nécessaire.');
    Object.assign(this, { platform, findPython: findPythonImpl, prepareRuntime: prepareRuntimeImpl, download: downloadImpl, workerFactory, files, extraFiles, maxCacheFiles, maxCacheBytes, idleMs });
    this.storage = new VoiceStorage(dataDir, 'voix-conversation'); this.root = this.storage.root; this.runtimeDir = path.join(this.root, 'runtime'); this.models = path.join(this.root, 'modeles'); this.cacheDir = path.join(this.root, 'cache'); this.marker = path.join(this.root, 'installation.json');
    this.python = path.join(this.runtimeDir, 'bin', 'python'); this.status = 'not_installed'; this.installed = false; this.extraInstalled = false; this.progress = null; this.queue = []; this.requestSequence = 0; this.closed = false;
    this.ready = this.load();
  }
  async load() {
    this.supported = ['darwin', 'linux'].includes(this.platform);
    try {
      const marker = JSON.parse((await this.storage.read(this.marker, 10000)).toString('utf8'));
      if (marker.pack === PACK && marker.verified === true) {
        await this.assertRuntime(); await this.validateFiles(); this.installed = true; this.status = 'ready'; await this.prune().catch(() => {});
        if (marker.extraPack === EXTRA_PACK && marker.extraVerified === true) try { await this.validateFiles(true); this.extraInstalled = true; } catch { /* Missing optional presets do not disable the original pair. */ }
      }
    } catch { /* Partial and unverified downloads remain unavailable. */ }
    if (!this.installed && this.supported) this.systemPython = await this.findPython();
    if (!this.supported || (!this.installed && !this.systemPython)) this.status = 'unsupported';
  }
  async validateFiles(additional = false) {
    for (const directory of [this.models, this.cacheDir]) await this.storage.directory(directory);
    const files = additional ? [...this.files, ...this.extraFiles] : this.files;
    for (const row of files) {
      const info = await this.storage.file(path.join(this.models, row.path));
      if (info.size !== row.bytes) throw failure('Le pack vocal est incomplet.');
    }
    for (const variant of new Set(files.map(row => path.dirname(row.path)))) {
      const config = path.join(this.models, variant, 'local-config.yaml');
      if (await lstat(config).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) await this.storage.file(config);
    }
  }
  async runtimeFolders() {
    await this.storage.directory(this.runtimeDir);
    // A venv's Python executable normally links to the system interpreter;
    // its directories, including the import path, must remain local.
    for (const name of ['bin', 'lib']) {
      const directory = path.join(this.runtimeDir, name), info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) continue;
      await this.storage.directory(directory);
      if (name === 'lib') for (const version of await readdir(directory)) if (/^python\d+\.\d+$/.test(version)) {
        const library = path.join(directory, version); await this.storage.directory(library);
        const site = path.join(library, 'site-packages');
        if (await lstat(site).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) await this.storage.directory(site);
      }
    }
  }
  async assertRuntime() {
    await this.runtimeFolders();
    if (this.python !== path.join(this.runtimeDir, 'bin', 'python')) throw failure('Le moteur de conversation n’est pas disponible.');
    await this.storage.directory(path.dirname(this.python)); await access(this.python, constants.X_OK);
  }
  async state() {
    await this.ready;
    const supported = this.supported && Boolean(this.installed || this.systemPython);
    const extraMB = Math.ceil(POCKET_EXTRA_DOWNLOAD_BYTES / 1000000);
    return {
      provider: 'pocket-local', status: this.status, available: this.installed, supported,
      message: this.message || (this.status === 'unsupported' ? 'Les voix de conversation demandent Python 3.10 à 3.14 sur macOS ou Linux. Préparez Python sur cet ordinateur, puis relancez le bureau. Aucune clé API nécessaire.' : NOTICE),
      progress: this.progress ? { ...this.progress } : null, installationError: this.installationError || null,
      voices: POCKET_VOICES.map(voice => ({
        ...voice, installed: this.installed && (!voice.additional || this.extraInstalled), supported,
        lang: 'multilingual', languages: ['fr', 'en', 'nl'], group: 'studio', installationGroup: voice.additional ? 'studio-extra' : 'studio-base', recommended: true,
        downloadMB: Math.ceil((voice.additional ? POCKET_EXTRA_DOWNLOAD_BYTES + (this.installed ? 0 : POCKET_DOWNLOAD_BYTES) : POCKET_DOWNLOAD_BYTES) / 1000000),
        runtimeDownloadMB: this.installed ? 0 : 230,
        installationMB: voice.additional && this.installed ? extraMB : 2200 + (voice.additional ? extraMB : 0),
        diskMB: voice.additional && this.installed ? extraMB : 2200 + (voice.additional ? extraMB : 0),
        fileCount: voice.additional ? this.extraFiles.length + (this.installed ? 0 : this.files.length) : this.files.length,
        license: voice.additional ? 'Code MIT · modèle et presets Charles et Alba CC BY 4.0' : 'Code MIT · modèle CC BY 4.0 · presets Marius et Estelle CC0',
        source: 'https://huggingface.co/kyutai/tts-voices',
      })),
      runtimeDownloadMB: this.installed ? 0 : 230, downloadMB: Math.ceil(POCKET_DOWNLOAD_BYTES / 1000000), diskMB: 2200,
      requiresConfirmation: true, localOnly: true, languages: ['fr', 'en', 'nl'], cacheMaxMB: Math.ceil(this.maxCacheBytes / 1024 / 1024),
      documentationUrl: 'https://github.com/kyutai-labs/pocket-tts',
      licenseNotice: 'Pocket TTS 3.3.0 : code MIT ; poids publics sans clonage : CC BY 4.0, Kyutai. Marius provient des dons de voix et Estelle des enregistrements Kyutai : CC0. Charles (VCTK p254) et Alba MacKenna sont proposés sous CC BY 4.0 avec attribution. Aucun échantillon personnel ni voix de célébrité. Sources et attributions conservées dans le dossier du pack.',
    };
  }
  async folders() {
    for (const directory of [this.root, this.runtimeDir, this.models, this.cacheDir]) await this.storage.directory(directory, { create: true });
    await this.runtimeFolders();
  }
  async install(body = {}) {
    await this.ready;
    if (body.confirmed !== true || Object.keys(body).some(key => !['voiceId', 'confirmed'].includes(key)) || !POCKET_VOICES.some(row => row.id === body.voiceId)) throw failure('Confirmez le téléchargement du pack de voix de conversation.');
    if (this.closed) throw failure('Le bureau se ferme.');
    if (this.operation || this.active || this.queue.length) throw failure('Le moteur vocal est occupé.', 'VOICE_BUSY');
    const additional = POCKET_VOICES.find(row => row.id === body.voiceId).additional;
    if (this.installed && (!additional || this.extraInstalled)) return this.state();
    if (!this.supported || (!this.installed && !this.systemPython)) throw failure('Python 3.10 à 3.14 est nécessaire. Préparez Python puis relancez le bureau.');
    const groups = [...(!this.installed ? [false] : []), ...(additional ? [true] : [])];
    const required = groups.flatMap(extra => extra ? this.extraFiles : this.files);
    const total = required.reduce((sum, row) => sum + row.bytes, 0);
    this.status = 'installing'; this.message = null; this.installationError = null;
    this.progress = { phase: this.installed ? 'download' : 'runtime', voiceId: body.voiceId, installationGroup: additional ? 'studio-extra' : 'studio-base', loaded: 0, total, fileCount: required.length, percent: null };
    const controller = new AbortController(); this.installController = controller;
    const timer = setTimeout(() => controller.abort(), 30 * 60000); timer.unref();
    this.operation = Promise.resolve().then(async () => {
      await this.folders();
      if (!this.installed) this.python = await this.prepareRuntime({ python: this.systemPython, runtimeDir: this.runtimeDir, signal: controller.signal, platform: this.platform });
      await this.assertRuntime();
      let completed = 0;
      for (const extra of groups) {
        if (extra) await this.validateFiles();
        for (const descriptor of extra ? this.extraFiles : this.files) {
          if (controller.signal.aborted) throw cancelled();
          this.progress.phase = 'download'; this.progress.percent = Math.floor(completed / total * 100);
          const target = path.join(this.models, descriptor.path);
          await this.storage.directory(path.dirname(target), { create: true });
          const existing = await lstat(target).catch(() => null);
          if (!(existing?.isFile() && !existing.isSymbolicLink() && existing.size === descriptor.bytes && await digest(target) === descriptor.sha256)) {
            await this.download({ descriptor, target, signal: controller.signal, onProgress: loaded => { this.progress.loaded = completed + loaded; this.progress.percent = Math.floor(this.progress.loaded / total * 100); } });
          }
          completed += descriptor.bytes; this.progress.loaded = completed;
        }
        await this.validateFiles(extra); this.progress.phase = 'verify'; this.progress.percent = null;
        await this.writeSources(extra);
        await this.verifyVoices(extra, controller.signal);
        await this.saveMarker(extra || this.extraInstalled);
        this.installed = true; if (extra) this.extraInstalled = true;
      }
      this.status = 'ready'; this.armIdle();
    }).catch(async () => {
      this.status = this.installed ? 'ready' : 'failed';
      this.message = this.installed ? 'Le complément Charles et Alba n’a pas pu être installé et vérifié. Les voix Marius et Estelle restent disponibles ; vous pouvez réessayer.' : 'Le pack de conversation n’a pas pu être installé et vérifié. Les sous-titres restent disponibles. Vérifiez Python, la connexion et l’espace disque, puis réessayez.';
      this.installationError = this.message; await this.workerInstance?.close(); this.workerInstance = null;
    }).finally(() => { clearTimeout(timer); this.progress = null; this.operation = null; this.installController = null; });
    return this.state();
  }
  async saveMarker(extra) {
    await this.storage.directory(this.root);
    const temporary = `${this.marker}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ pack: PACK, verified: true, ...(extra ? { extraPack: EXTRA_PACK, extraVerified: true } : {}) }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.marker);
    } finally { await this.storage.remove(temporary).catch(() => {}); }
  }
  async writeSources(extra) {
    await this.storage.directory(this.models);
    const attribution = extra ? '\nCharles : VCTK p254, CC BY 4.0. CSTR VCTK Corpus, University of Edinburgh.\nhttps://datashare.ed.ac.uk/handle/10283/3443\nhttps://huggingface.co/kyutai/tts-voices/blob/main/vctk/p254_023_enhanced.wav\nAlba MacKenna : casual, CC BY 4.0.\nhttps://huggingface.co/kyutai/tts-voices/blob/main/alba-mackenna/casual.wav\nLicence : https://creativecommons.org/licenses/by/4.0/\nLes embeddings sont fournis par Kyutai ; aucun enregistrement personnel ajouté.\n' : '';
    const files = extra ? [...this.files, ...this.extraFiles] : this.files;
    await writeFile(path.join(this.models, 'SOURCES-ET-LICENCES.txt'), `Pocket TTS ${VERSION}\nCode MIT : https://github.com/kyutai-labs/pocket-tts/blob/main/LICENSE\nPoids CC BY 4.0 : https://huggingface.co/kyutai/pocket-tts-without-voice-cloning\nPresets Marius (don Selfie), Estelle (enregistrement Kyutai developpeuse-3), CC0 : https://huggingface.co/kyutai/tts-voices\n${attribution}\nAucune voix personnelle importée. Aucun module de clonage téléchargé.\n\n${files.map(row => `${row.path}\n${row.url}\nSHA-256 ${row.sha256}`).join('\n\n')}\n`, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, mode: 0o600 });
  }
  async verifyVoices(extra, signal) {
    const checks = { fr: 'Bonjour. Votre bureau est prêt.', en: 'Hello. Your office is ready.', nl: 'Hallo. Je kantoor is klaar.' };
    for (const [language, text] of Object.entries(checks)) for (const voice of POCKET_VOICES.filter(row => row.additional === extra)) {
      if (signal.aborted) throw cancelled();
      const output = path.join(this.cacheDir, `.verification-${randomUUID()}.wav`);
      try { await (await this.worker(voice.id)).generate({ pack: await this.storage.expected(this.models), output: await this.storage.expected(output), language, voiceId: voice.id, text }, { signal }); if (!validWave(await this.storage.read(output))) throw failure('Le pack n’a pas produit de son valide.'); }
      finally { await this.storage.remove(output).catch(() => {}); }
    }
  }
  async worker(voiceId) {
    await this.assertRuntime(); await this.validateFiles(POCKET_VOICES.some(row => row.id === voiceId && row.additional));
    clearTimeout(this.idleTimer);
    if (!this.workerInstance || this.workerInstance.alive === false) this.workerInstance = this.workerFactory({ python: this.python });
    return this.workerInstance;
  }
  armIdle() { clearTimeout(this.idleTimer); if (this.closed) return; this.idleTimer = setTimeout(async () => { const old = this.workerInstance; this.workerInstance = null; await old?.close(); }, this.idleMs); this.idleTimer.unref(); }
  async speak(body = {}, { signal } = {}) {
    await this.ready;
    const language = body.language ?? 'fr', speed = body.speed ?? 1;
    if (this.closed || signal?.aborted) throw cancelled();
    if (Object.keys(body).some(key => !['text', 'voiceId', 'language', 'speed'].includes(key)) || !POCKET_VOICES.some(row => row.id === body.voiceId) || !['fr', 'en', 'nl'].includes(language) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.text) || typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.8 || speed > 1.2) throw failure('Choisissez une voix, une langue et un texte de 1 à 500 caractères.');
    const additional = POCKET_VOICES.find(row => row.id === body.voiceId).additional;
    if (!this.installed || (additional && !this.extraInstalled)) throw failure('Le pack de conversation n’est pas installé. Téléchargez-le volontairement dans les réglages.', 'VOICE_NOT_INSTALLED');
    if (this.operation) throw failure('Le moteur vocal est occupé.', 'VOICE_BUSY');
    const sequence = ++this.requestSequence;
    const key = createHash('sha256').update(JSON.stringify([PACK, body.voiceId, language, body.text])).digest('hex');
    const url = `/api/voice/audio/${key}.wav`;
    await this.validateFiles(additional); await this.assertRuntime();
    try { await this.audio(key); return { url, voiceId: body.voiceId, language, cached: true, playbackRate: speed }; } catch { /* Queue bounded local synthesis. */ }
    if (this.operation) throw failure('Le moteur vocal est occupé.', 'VOICE_BUSY');
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const job = { key, url, sequence, voiceId: body.voiceId, language, text: body.text, speed, controller, resolve, reject };
      job.abort = () => {
        controller.abort();
        const position = this.queue.indexOf(job);
        if (position !== -1) { this.queue.splice(position, 1); signal?.removeEventListener('abort', job.abort); reject(cancelled()); }
      };
      job.cleanup = () => signal?.removeEventListener('abort', job.abort);
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job); this.queue.sort((a, b) => b.sequence - a.sequence);
      if (this.queue.length > 3) { const stale = this.queue.pop(); stale.cleanup(); stale.reject(failure('Une réplique plus récente a remplacé cette demande.', 'VOICE_SUPERSEDED')); }
      if (signal?.aborted) job.abort();
      if (!this.active) this.processing = this.pump();
    });
  }
  async pump() {
    if (this.active || !this.queue.length || this.closed) return;
    const job = this.queue.shift(); this.active = job;
    const temporary = path.join(this.cacheDir, `.audio-${randomUUID()}.wav`);
    try {
      if (job.controller.signal.aborted) throw cancelled();
      await (await this.worker(job.voiceId)).generate({ pack: await this.storage.expected(this.models), output: await this.storage.expected(temporary), voiceId: job.voiceId, language: job.language, text: job.text }, { signal: job.controller.signal });
      if (job.controller.signal.aborted) throw cancelled();
      if (!validWave(await this.storage.read(temporary))) throw failure('La voix n’a pas produit de son valide.');
      await this.storage.directory(this.cacheDir);
      await rename(temporary, path.join(this.cacheDir, `${job.key}.wav`)); await this.prune();
      job.resolve({ url: job.url, voiceId: job.voiceId, language: job.language, cached: false, playbackRate: job.speed });
    } catch (error) { job.reject(error?.code === 'VOICE_CANCELLED' ? cancelled() : failure('Cette réplique n’a pas pu être lue. Les sous-titres restent disponibles.')); }
    finally { await this.storage.remove(temporary).catch(() => {}); job.cleanup(); this.active = null; if (this.queue.length) this.processing = this.pump(); else this.armIdle(); }
  }
  async audio(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw failure('Son introuvable.', 'VOICE_AUDIO_NOT_FOUND');
    try {
      const value = await this.storage.read(path.join(this.cacheDir, `${key}.wav`)); if (!validWave(value)) throw new Error('Invalid wave'); return value;
    } catch { throw failure('Son introuvable.', 'VOICE_AUDIO_NOT_FOUND'); }
  }
  async prune() {
    await this.storage.directory(this.cacheDir);
    const files = [];
    for (const name of await readdir(this.cacheDir).catch(() => [])) if (/^[a-f0-9]{64}\.wav$/.test(name)) {
      const full = path.join(this.cacheDir, name), info = await lstat(full).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink()) files.push({ full, size: info.size, modified: info.mtimeMs });
    }
    files.sort((a, b) => b.modified - a.modified); let bytes = 0, count = 0;
    for (const file of files) if (count >= this.maxCacheFiles || bytes + file.size > this.maxCacheBytes) await this.storage.remove(file.full); else { bytes += file.size; count++; }
  }
  async close() {
    this.closed = true; clearTimeout(this.idleTimer); this.installController?.abort(); this.active?.controller.abort();
    for (const job of this.queue.splice(0)) { job.cleanup(); job.reject(cancelled()); }
    await this.workerInstance?.close(); this.workerInstance = null; await this.operation; await this.processing;
  }
}
