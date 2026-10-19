import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import { access, lstat, realpath, readdir, open, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const TERMINAL = new Set(['completed', 'needs_review', 'failed', 'cancelled']);
const MAX_FILES = 500;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const LOGIN_URL = 'https://github.com/login/device';
const OWNER = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const REPO = /^[a-z\d][a-z\d._-]{0,99}$/i;
const EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.txt', '.md', '.pdf', '.csv', '.mp3', '.mp4', '.webm', '.wav', '.wasm', '.xml', '.webmanifest']);
const RUNTIME_EXTENSIONS = new Set(['.php', '.py', '.rb', '.sh', '.pl', '.cgi', '.asp', '.aspx', '.jsp', '.ts', '.tsx', '.jsx', '.vue', '.svelte']);
const DENIED_NAMES = new Set(['node_modules', 'rapports', 'reports', 'data', 'state.json', 'preferences.json', 'livraison.md', 'demonstration.md', 'package-lock.json', 'npm-shrinkwrap.json']);
const hash = value => createHash('sha256').update(value).digest('hex');
const error = (message, code = 'PUBLICATION_INVALID') => Object.assign(new Error(message), { code });
const abortError = () => error('La publication a été interrompue.', 'PUBLICATION_ABORTED');
const clone = value => structuredClone(value);
const safeName = name => !name.startsWith('.') && !/[\x00-\x1f\x7f\\]/.test(name) && !DENIED_NAMES.has(name.toLowerCase()) && !/(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?)(?:[._-]|$)/i.test(name);
const sensitiveFile = name => /(?:\.(?:pem|key|p12|pfx|kdbx|sqlite|sqlite3|db|log)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/i.test(name);
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

export function publishingEnvironment(source = process.env) {
  const env = { ...source, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' };
  for (const key of Object.keys(env)) {
    if (/(?:API_KEY|TOKEN|AUTH_TOKEN|OAUTH_TOKEN|PASSWORD|PASSWD|SECRET)$/i.test(key) || /^(?:GH_DEBUG|GH_REPO|GH_ENTERPRISE_HOST|GIT_TRACE.*|CURL_HOME|CURL_CA_BUNDLE|SSL_CERT_FILE|SSL_CERT_DIR|ALL_PROXY|FTP_PROXY|HTTPS?_PROXY|NO_PROXY)$/i.test(key)) delete env[key];
  }
  return env;
}

export async function findPublishingBinary(name, env = process.env) {
  if (!['gh', 'curl'].includes(name)) return null;
  const directories = [...new Set([...(env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean))];
  for (const directory of directories) {
    const file = path.join(directory, process.platform === 'win32' ? name + '.exe' : name);
    try { if ((await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) { await access(file, constants.X_OK); return file; } } catch { /* Try the next official CLI location. */ }
  }
  return null;
}

function relativeFolder(value) {
  if (value === undefined || value === '' || value === '.') return '';
  if (typeof value !== 'string' || value.length > 500 || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(part => !part || part === '..' || !safeName(part))) throw error('Choisissez un sous-dossier relatif de la mission.');
  return value;
}

function ftpOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('Les paramètres FTP sont incomplets.');
  const protocol = value.protocol ?? 'ftps';
  if (!['ftp', 'ftps'].includes(protocol)) throw error('Choisissez FTP ou FTPS.');
  const host = typeof value.host === 'string' ? value.host.trim().toLowerCase() : '';
  if (!host || host.length > 253 || !/^(?:[a-z\d](?:[a-z\d.-]*[a-z\d])?)$/i.test(host) || host.includes('..') || host.split('.').some(label => label.length > 63 || label.startsWith('-') || label.endsWith('-'))) throw error('Indiquez le nom du serveur FTP sans adresse web ni chemin.');
  const port = value.port === undefined || value.port === '' ? 21 : Number(value.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw error('Le port FTP doit être compris entre 1 et 65535.');
  const username = typeof value.username === 'string' ? value.username : '';
  const password = typeof value.password === 'string' ? value.password : '';
  if (!username || username.length > 256 || username.includes(':') || /[\x00-\x1f\x7f]/.test(username) || !password || password.length > 2048 || /[\x00-\x1f\x7f]/.test(password)) throw error('Indiquez un identifiant et un mot de passe FTP valides.');
  const directory = typeof value.directory === 'string' ? value.directory.trim() : '';
  if (directory.length > 500 || directory.includes('\\') || /[\x00-\x1f\x7f?#]/.test(directory) || directory.split('/').some(part => part === '..' || part === '.')) throw error('Le dossier distant FTP est invalide.');
  let publicUrl = null;
  if (value.publicUrl) {
    try {
      const url = new URL(value.publicUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.href.length > 1500) throw new Error();
      publicUrl = url.href;
    } catch { throw error('L’adresse publique doit commencer par https:// ou http://, sans identifiant.'); }
  }
  return { host, port, protocol, username, password, directory: '/' + directory.split('/').filter(Boolean).join('/'), publicUrl };
}

function githubOptions(body, user) {
  if (!user || !OWNER.test(user)) throw error('Connectez votre compte GitHub avant de préparer un dépôt.', 'PUBLICATION_AUTH');
  const repo = typeof body.repo === 'string' ? body.repo.trim() : '';
  const parts = repo.split('/');
  if (parts.length > 2 || !REPO.test(parts.at(-1)) || parts.at(-1).endsWith('.git') || (parts.length === 2 && parts[0].toLowerCase() !== user.toLowerCase())) throw error('Choisissez un nouveau nom de dépôt dans votre compte GitHub.');
  const visibility = body.visibility ?? 'private';
  if (!['private', 'public'].includes(visibility)) throw error('Choisissez un dépôt privé ou public.');
  return { repo: `${user}/${parts.at(-1)}`, visibility };
}

async function validDirectory(base, relative) {
  let current = base;
  for (const segment of relative.split('/').filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw error('Le dossier choisi doit être un vrai dossier de la mission.');
  }
  const real = await realpath(current);
  if (!inside(base, real)) throw error('Ce dossier est hors de la mission.');
  return real;
}

async function chooseRoot(base, entry, kind) {
  if (kind === 'github') {
    if (entry !== undefined) return validDirectory(base, relativeFolder(entry));
    for (const name of ['Livraison', 'livraison']) {
      try { return await validDirectory(base, name); } catch { /* The mission itself can also contain software or scripts. */ }
    }
    return base;
  }
  if (entry !== undefined) {
    const folder = await validDirectory(base, relativeFolder(entry));
    try { const info = await lstat(path.join(folder, 'index.html')); if (info.isFile() && !info.isSymbolicLink()) return folder; } catch { /* Report the missing entry below. */ }
    throw error('Le dossier à publier doit contenir un fichier index.html.');
  }
  for (const name of ['Livraison', 'livraison']) {
    try { const folder = await validDirectory(base, name); const info = await lstat(path.join(folder, 'index.html')); if (info.isFile() && !info.isSymbolicLink()) return folder; } catch { /* Try another static delivery. */ }
  }
  const candidates = [];
  let visited = 0;
  const walk = async (folder, depth = 0) => {
    if (++visited > 2000) throw error('Le dossier contient trop de sous-dossiers. Choisissez le dossier du site.');
    const entries = await readdir(folder, { withFileTypes: true });
    if (entries.some(item => item.name === 'index.html' && item.isFile())) candidates.push(folder);
    if (depth >= 5) return;
    for (const item of entries) if (item.isDirectory() && safeName(item.name)) await walk(path.join(folder, item.name), depth + 1);
  };
  await walk(base);
  if (candidates.length === 1) return candidates[0];
  throw error(candidates.length ? 'Plusieurs sites sont présents. Indiquez le sous-dossier à publier.' : 'Aucun site statique avec index.html n’a été trouvé dans cette mission.');
}

async function snapshot(baseDirectory, entry, kind) {
  const baseInfo = await lstat(baseDirectory);
  if (baseInfo.isSymbolicLink() || !baseInfo.isDirectory()) throw error('Le dossier de cette mission n’est pas accessible.');
  const base = await realpath(baseDirectory);
  const root = await chooseRoot(base, entry, kind);
  const files = []; let totalBytes = 0, visited = 0;
  const walk = async (folder, depth = 0) => {
    if (++visited > 2000 || depth > 20) throw error('Le dossier contient trop de sous-dossiers. Choisissez un dossier plus précis.');
    for (const item of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!safeName(item.name) || sensitiveFile(item.name)) continue;
      const file = path.join(folder, item.name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) { await walk(file, depth + 1); continue; }
      if (!info.isFile()) continue;
      const extension = path.extname(item.name).toLowerCase();
      if (kind === 'ftp' && (RUNTIME_EXTENSIONS.has(extension) || /^(?:server\.(?:js|mjs|cjs)|next\.config\.)/i.test(item.name))) throw error('FTP publie uniquement des sites statiques. Ce projet nécessite un serveur ou une compilation : préparez son dossier de site exporté, ou choisissez GitHub.');
      if (kind === 'ftp' && !EXTENSIONS.has(extension)) continue;
      if (files.length >= MAX_FILES || info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_BYTES) throw error('Publication limitée à 500 fichiers, 15 Mo par fichier et 50 Mo au total.');
      if (!inside(root, await realpath(file))) throw error('Un fichier est sorti du dossier à publier.');
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_BYTES) throw error('Le volume des fichiers à publier a changé. Préparez un nouvel aperçu.');
        const chunks = []; let length = 0;
        while (true) {
          const chunk = Buffer.alloc(64 * 1024);
          const result = await handle.read(chunk, 0, chunk.length, null);
          if (!result.bytesRead) break;
          length += result.bytesRead;
          if (length > MAX_FILE_BYTES || totalBytes + length > MAX_BYTES) throw error('Le volume des fichiers à publier a changé. Préparez un nouvel aperçu.');
          chunks.push(chunk.subarray(0, result.bytesRead));
        }
        bytes = Buffer.concat(chunks, length);
      } finally { await handle.close(); }
      if (bytes.length > MAX_FILE_BYTES || totalBytes + bytes.length > MAX_BYTES) throw error('Le volume des fichiers à publier a changé. Préparez un nouvel aperçu.');
      totalBytes += bytes.length;
      files.push({ path: path.relative(root, file).split(path.sep).join('/'), size: bytes.length, hash: hash(bytes), bytes });
    }
  };
  await walk(root);
  if (!files.length) throw error('Ce dossier ne contient aucun fichier publiable.');
  if (kind === 'ftp' && !files.some(file => file.path === 'index.html')) throw error('Le fichier index.html n’est plus présent. Préparez un nouvel aperçu.');
  return { root: path.relative(base, root).split(path.sep).join('/') || '.', files, totalBytes };
}

const configValue = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';

export class Publishing {
  constructor({ getMission, workDir, isActive = () => false, find = findPublishingBinary, run, spawnImpl = spawn, onChange = () => {}, env = process.env, now = Date.now, timeoutMs = 10 * 60000, loginTimeoutMs = 8 * 60000, killGraceMs = 500 } = {}) {
    this.getMission = getMission; this.workDir = workDir; this.isActive = isActive; this.find = find;
    this.run = run || ((command, args, options) => this.process(command, args, options));
    this.spawn = spawnImpl; this.onChange = onChange; this.env = publishingEnvironment(env); this.now = now;
    this.timeoutMs = timeoutMs; this.loginTimeoutMs = loginTimeoutMs; this.killGraceMs = killGraceMs; this.statusCheckedAt = -Infinity; this.authRevision = 0;
    this.github = { available: false, connected: false, user: null, status: 'idle', message: '' };
    this.ftp = { available: false }; this.previews = new Map(); this.jobs = new Map(); this.results = new Map(); this.children = new Set(); this.controllers = new Set(); this.pending = new Set(); this.terminations = new Set(); this.closed = false;
  }

  changed() { if (!this.closed) this.onChange(); }
  checkMission(id) {
    if (this.closed) throw error('Le bureau se ferme.');
    const mission = this.getMission?.(id);
    if (!mission) throw error('Mission inconnue.', 'PUBLICATION_NOT_FOUND');
    if (this.isActive(id) || !TERMINAL.has(mission.status)) throw error('Attendez la fin de cette mission avant de publier ses fichiers.', 'PUBLICATION_BUSY');
    return mission;
  }

  async identify(signal) {
    const gh = await this.find('gh');
    if (!gh) return { available: false, connected: false, user: null };
    try {
      const result = await this.run(gh, ['api', '--hostname', 'github.com', 'user', '--jq', '.login'], { capture: true, signal, timeoutMs: 15000 });
      const user = result.stdout?.trim();
      return { available: true, connected: result.code === 0 && OWNER.test(user ?? ''), user: result.code === 0 && OWNER.test(user ?? '') ? user : null };
    } catch { return { available: true, connected: false, user: null }; }
  }

  async state() {
    if (this.now() - this.statusCheckedAt < 10000) return { github: clone(this.github), ftp: clone(this.ftp) };
    if (!this.checking) this.checking = (async () => {
      const revision = this.authRevision;
      const [github, curl] = await Promise.all([this.loginJob ? Promise.resolve(null) : this.identify(), this.find('curl')]);
      if (github && revision === this.authRevision) this.github = { ...this.github, ...github, status: github.connected ? 'connected' : this.github.status === 'connected' ? 'idle' : this.github.status };
      this.ftp = { available: Boolean(curl) };
      this.statusCheckedAt = this.now();
      return { github: clone(this.github), ftp: clone(this.ftp) };
    })().finally(() => { this.checking = null; });
    return this.checking;
  }

  startGitHubLogin() {
    if (this.closed) throw error('Le bureau se ferme.');
    if (this.loginJob) return clone(this.github);
    this.authRevision++;
    const controller = new AbortController(); this.controllers.add(controller);
    this.github = { ...this.github, status: 'connecting', message: 'Confirmez la connexion GitHub dans votre navigateur.' };
    delete this.github.deviceCode; delete this.github.verificationUrl;
    const timer = setTimeout(() => controller.abort(), this.loginTimeoutMs); timer.unref?.();
    this.loginJob = Promise.resolve().then(async () => {
      const known = await this.identify(controller.signal);
      if (controller.signal.aborted) throw abortError();
      this.github = { ...this.github, ...known };
      if (!known.available) throw error('GitHub CLI n’est pas installé sur cet ordinateur.');
      if (!known.connected) {
        const gh = await this.find('gh');
        let pending = '';
        const result = await this.run(gh, ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https'], {
          input: '\n', signal: controller.signal, capture: false, timeoutMs: this.loginTimeoutMs,
          onOutput: chunk => {
            pending = (pending + chunk).slice(-4096);
            const code = pending.match(/(?:one.time code|device code|code)[^\r\n]*?\b([A-Z\d]{4}-[A-Z\d]{4})\b/i)?.[1];
            if (code && /^[A-Z\d]{4}-[A-Z\d]{4}$/.test(code)) {
              this.github.deviceCode = code; this.github.verificationUrl = LOGIN_URL; this.changed();
            }
          },
        });
        pending = '';
        if (result.code !== 0 || controller.signal.aborted) throw abortError();
        const authenticated = await this.identify(controller.signal);
        if (!authenticated.connected) throw error('Connexion non confirmée.');
        this.github = { ...this.github, ...authenticated };
      }
      this.github.status = 'connected'; this.github.message = 'Votre compte GitHub est connecté.';
    }).catch(() => {
      if (!this.closed) { this.github.connected = false; this.github.user = null; this.github.status = 'failed'; this.github.message = this.github.available ? 'La connexion GitHub n’a pas été confirmée. Réessayez dans le navigateur.' : 'GitHub CLI est absent. Installez l’outil officiel gh pour connecter votre compte.'; }
    }).finally(() => {
      clearTimeout(timer); this.controllers.delete(controller); delete this.github.deviceCode; delete this.github.verificationUrl; this.loginJob = null; this.changed();
    });
    this.changed();
    return clone(this.github);
  }

  async prepare(id, body) {
    this.checkMission(id);
    if (!body || !['github', 'ftp'].includes(body.kind)) throw error('Choisissez GitHub ou un serveur FTP.');
    const entry = typeof body.entry === 'string' && !body.entry.trim() ? undefined : body.entry;
    const data = await snapshot(this.workDir(id), entry, body.kind);
    let destination, credentials;
    if (body.kind === 'github') {
      const status = await this.identify();
      this.github = { ...this.github, ...status };
      if (!status.available) throw error('GitHub CLI est absent. Installez l’outil officiel gh pour publier un dépôt.');
      destination = githubOptions(body, status.user);
    } else {
      if (!await this.find('curl')) throw error('Le programme curl est absent. La publication FTP n’est pas disponible sur cet ordinateur.');
      credentials = ftpOptions(body.ftp);
      const { username, password, ...publicDestination } = credentials;
      destination = publicDestination;
    }
    this.checkMission(id);
    const manifest = { files: data.files.map(({ path, size }) => ({ path, size })), totalBytes: data.totalBytes, root: data.root, kind: body.kind, destination };
    const digest = hash(JSON.stringify({ id, ...manifest, hashes: data.files.map(file => file.hash), account: credentials ? hash(credentials.username) : destination.repo.split('/')[0] }));
    return { manifest: { ...manifest, digest }, files: data.files, credentials };
  }

  async preview(id, body) {
    const { manifest } = await this.prepare(id, body);
    if (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value);
    this.previews.set(id, { digest: manifest.digest, expires: this.now() + 10 * 60000 });
    return manifest;
  }

  get(id) {
    if (!this.getMission?.(id)) throw error('Mission inconnue.', 'PUBLICATION_NOT_FOUND');
    return clone(this.results.get(id) || { status: 'idle', message: 'Aucune publication pour cette mission.' });
  }

  async publish(id, body) {
    this.checkMission(id);
    if (this.jobs.has(id)) throw error('Une publication est déjà en cours pour cette mission.', 'PUBLICATION_BUSY');
    if (body?.confirmation !== true || typeof body.digest !== 'string') throw error('Confirmez l’aperçu avant de publier.');
    const preview = this.previews.get(id);
    if (!preview || preview.expires < this.now() || preview.digest !== body.digest) throw error('L’aperçu a expiré ou ne correspond pas. Préparez un nouvel aperçu.', 'PUBLICATION_CHANGED');
    const job = { controller: new AbortController(), id };
    this.jobs.set(id, job);
    let prepared;
    try {
      prepared = await this.prepare(id, body);
      if (prepared.manifest.digest !== preview.digest) throw error('Les fichiers ou la destination ont changé. Préparez un nouvel aperçu.', 'PUBLICATION_CHANGED');
      this.previews.delete(id);
      this.checkMission(id);
    } catch (cause) { this.jobs.delete(id); throw cause; }
    const { manifest } = prepared;
    const result = { id: randomUUID(), status: 'uploading', kind: manifest.kind, destination: manifest.destination, files: manifest.files.length, totalBytes: manifest.totalBytes, message: 'Publication des fichiers confirmés en cours.', startedAt: this.now(), url: null };
    this.results.set(id, result); this.controllers.add(job.controller);
    const timer = setTimeout(() => job.controller.abort(), this.timeoutMs); timer.unref?.();
    job.completion = Promise.resolve().then(async () => {
      const url = manifest.kind === 'github' ? await this.publishGitHub(prepared, job, result) : await this.publishFtp(prepared, job);
      if (job.controller.signal.aborted) throw abortError();
      Object.assign(result, { status: 'completed', message: manifest.kind === 'github' ? 'Les fichiers sont publiés dans votre nouveau dépôt GitHub. Le dépôt ne met pas le site en ligne automatiquement.' : 'Les fichiers ont été transférés vers le serveur. Vérifiez le site à son adresse publique.', url, finishedAt: this.now() });
    }).catch(() => {
      Object.assign(result, { status: 'failed', message: job.controller.signal.aborted ? 'La publication a été interrompue. Des fichiers ont peut-être déjà été transférés.' : manifest.kind === 'github' ? 'La publication GitHub a échoué. Un dépôt a peut-être été créé ; consultez votre compte avant de réessayer avec un nouveau nom.' : 'Le transfert FTP a échoué. Des fichiers ont peut-être déjà été transférés. Vérifiez le serveur et vos identifiants avant de réessayer.', finishedAt: this.now() });
    }).finally(() => {
      clearTimeout(timer); this.controllers.delete(job.controller); this.jobs.delete(id);
      prepared.credentials = null; prepared.files.length = 0; this.changed();
    });
    this.changed();
    return clone(result);
  }

  async api(gh, endpoint, body, signal, method = 'POST') {
    const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
    if (body !== undefined) args.push('--input', '-');
    const response = await this.run(gh, args, { input: body === undefined ? undefined : JSON.stringify(body), capture: true, signal, timeoutMs: 60000 });
    if (response.code !== 0) throw error('GitHub n’a pas confirmé cette étape.');
    try { return JSON.parse(response.stdout); } catch { throw error('La réponse GitHub est invalide.'); }
  }

  async publishGitHub({ manifest, files }, job, result) {
    const signal = job.controller.signal, gh = await this.find('gh');
    if (!gh || signal.aborted) throw abortError();
    const [owner, name] = manifest.destination.repo.split('/');
    // A new, initialized repository gives GitHub a parent commit; the next tree is exactly the approved manifest.
    const repository = await this.api(gh, 'user/repos', { name, private: manifest.destination.visibility === 'private', auto_init: true }, signal);
    const expected = `${owner}/${name}`;
    if (repository.full_name?.toLowerCase() !== expected.toLowerCase() || repository.private !== (manifest.destination.visibility === 'private') || !repository.default_branch || repository.default_branch.includes('..')) throw error('Le nouveau dépôt GitHub n’a pas été confirmé.');
    const url = `https://github.com/${expected}`;
    result.url = url; this.changed();
    const prefix = `repos/${expected}/git`;
    const reference = await this.api(gh, `${prefix}/ref/heads/${encodeURIComponent(repository.default_branch)}`, undefined, signal, 'GET');
    if (!/^[a-f\d]{40,64}$/i.test(reference.object?.sha ?? '')) throw error('La branche GitHub est indisponible.');
    const tree = [];
    for (const file of files) {
      const blob = await this.api(gh, `${prefix}/blobs`, { content: file.bytes.toString('base64'), encoding: 'base64' }, signal);
      if (!/^[a-f\d]{40,64}$/i.test(blob.sha ?? '')) throw error('Un fichier GitHub n’a pas été confirmé.');
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const built = await this.api(gh, `${prefix}/trees`, { tree }, signal);
    if (!/^[a-f\d]{40,64}$/i.test(built.sha ?? '')) throw error('L’arborescence GitHub n’a pas été confirmée.');
    const commit = await this.api(gh, `${prefix}/commits`, { message: 'Publication préparée avec Oscar et les Agents', tree: built.sha, parents: [reference.object.sha] }, signal);
    if (!/^[a-f\d]{40,64}$/i.test(commit.sha ?? '')) throw error('La version GitHub n’a pas été confirmée.');
    const updated = await this.api(gh, `${prefix}/refs/heads/${encodeURIComponent(repository.default_branch)}`, { sha: commit.sha, force: false }, signal, 'PATCH');
    if (updated.object?.sha !== commit.sha) throw error('La publication de la branche n’a pas été confirmée.');
    return url;
  }

  async publishFtp({ files, credentials }, job) {
    const binary = await this.find('curl');
    if (!binary || job.controller.signal.aborted) throw abortError();
    const staging = await mkdtemp(path.join(os.tmpdir(), 'oscar-publication-'));
    try {
      for (const file of files) {
        if (job.controller.signal.aborted) throw abortError();
        const target = path.join(staging, file.path);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, file.bytes, { mode: 0o600 });
        const remotePath = [...credentials.directory.split('/').filter(Boolean), ...file.path.split('/')].map(encodeURIComponent).join('/');
        // ftps means explicit TLS on the FTP port. No redirects, .curlrc, proxy or credential argv.
        const url = `ftp://${credentials.host}:${credentials.port}/${remotePath}`;
        const config = `url = ${configValue(url)}\nuser = ${configValue(credentials.username + ':' + credentials.password)}\n`;
        const args = ['--disable', '--config', '-', '--silent', '--show-error', '--fail', '--globoff', '--proto', '=ftp', '--proto-redir', '=ftp', '--max-redirs', '0', '--proxy', '', '--connect-timeout', '20', '--max-time', '120', '--ftp-skip-pasv-ip', '--ftp-create-dirs', '--upload-file', target];
        if (credentials.protocol === 'ftps') args.push('--ssl-reqd');
        const response = await this.run(binary, args, { input: config, capture: false, signal: job.controller.signal, timeoutMs: 125000 });
        if (response.code !== 0) throw error('Le serveur FTP n’a pas confirmé un transfert.');
      }
      return credentials.publicUrl;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }

  process(command, args, { input, signal, capture = false, onOutput, timeoutMs = 15000 } = {}) {
    if (this.closed || signal?.aborted) return Promise.reject(abortError());
    const pending = new Promise((resolve, reject) => {
      let child, output = '', size = 0, finished = false, failure;
      const terminate = () => { failure = abortError(); if (child) this.terminate(child); };
      const finish = (code, cause) => {
        if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', terminate); if (child) this.children.delete(child);
        if (cause || failure || this.closed) reject(failure || (this.closed ? abortError() : error('Le programme de publication n’a pas pu démarrer.')));
        else resolve({ code, stdout: output });
      };
      const timer = setTimeout(terminate, timeoutMs); timer.unref?.();
      try {
        child = this.spawn(command, args, { env: this.env, cwd: os.tmpdir(), shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
        this.children.add(child);
        signal?.addEventListener('abort', terminate, { once: true });
        for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
          if (onOutput) onOutput(chunk.toString('utf8'));
          if (capture && stream === child.stdout) {
            size += chunk.length;
            if (size > 1024 * 1024) { failure = error('La réponse du programme de publication est trop longue.'); this.terminate(child); }
            else output += chunk.toString('utf8');
          }
        });
        child.once('error', cause => finish(null, cause)); child.once('close', code => finish(code));
        child.stdin?.on('error', () => {}); child.stdin?.end(input);
        if (signal?.aborted) terminate();
      } catch (cause) { finish(null, cause); }
    });
    this.pending.add(pending); pending.finally(() => this.pending.delete(pending)).catch(() => {});
    return pending;
  }

  terminate(child) {
    if (child.oscarPublicationTermination) return;
    const send = signal => { try { if (process.platform !== 'win32' && Number.isInteger(child.pid)) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already gone. */ } };
    send('SIGTERM');
    const termination = new Promise(resolve => setTimeout(() => { send('SIGKILL'); resolve(); }, this.killGraceMs));
    child.oscarPublicationTermination = termination; this.terminations.add(termination); termination.finally(() => this.terminations.delete(termination));
  }

  async close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const child of this.children) this.terminate(child);
    await Promise.allSettled([this.loginJob, ...[...this.jobs.values()].map(job => job.completion), ...this.pending]);
    await Promise.allSettled([...this.terminations]);
    this.previews.clear();
  }
}
