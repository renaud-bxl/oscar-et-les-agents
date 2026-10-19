import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReadStream, existsSync, statSync, realpathSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { Atelier } from './lib/orchestrator.mjs';
import { detectProviders, runAgent, findBinary } from './lib/providers.mjs';
import { BrowserLogin } from './lib/auth.mjs';
import { runInstaller } from './scripts/install.mjs';
import { Publishing } from './lib/publishing.mjs';
import { Connectors } from './lib/connectors.mjs';
import { Automations } from './lib/automations.mjs';
import { VoiceService } from './lib/voice-service.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.wav': 'audio/wav' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const NATIVE_FILE_TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.txt', '.md', '.json', '.csv', '.log']);
const fileError = (message, code) => Object.assign(new Error(message), { code });

export function resolveNativeMissionFile(workDirectory, relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 1000 || path.isAbsolute(relative) || /[\x00-\x1f\x7f\\:]/.test(relative) || relative.split('/').some(part => !part || part.startsWith('.') || part !== part.trim())) throw fileError('Ce fichier est hors du dossier de la mission.', 'MISSION_FILE_FORBIDDEN');
  if (!NATIVE_FILE_TYPES.has(path.extname(relative).toLowerCase())) throw fileError('Ce type de fichier ne peut pas être ouvert automatiquement. Téléchargez-le pour le consulter avec un outil adapté.', 'MISSION_FILE_TYPE');
  try {
    if (lstatSync(workDirectory).isSymbolicLink()) throw fileError('Ce dossier n’est pas accessible.', 'MISSION_FILE_FORBIDDEN');
    const root = realpathSync(workDirectory);
    let current = root;
    const parts = relative.split('/');
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      const info = lstatSync(current);
      if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw fileError('Ce fichier ou son dossier n’est pas accessible.', 'MISSION_FILE_FORBIDDEN');
    }
    const real = realpathSync(current);
    if (!real.startsWith(root + path.sep)) throw fileError('Ce fichier est hors du dossier de la mission.', 'MISSION_FILE_FORBIDDEN');
    return real;
  } catch (cause) {
    if (cause.code?.startsWith('MISSION_FILE_')) throw cause;
    if (cause.code === 'ENOENT') throw fileError('Ce fichier est introuvable dans la mission.', 'MISSION_FILE_NOT_FOUND');
    throw fileError('Ce fichier n’est pas accessible dans la mission.', 'MISSION_FILE_FORBIDDEN');
  }
}
export function resolveServerDataDirectory(env = process.env) {
  return path.resolve(env.OSCAR_DATA_DIR || env.ATELIER_DATA_DIR || path.join(os.homedir(), 'Documents', 'Oscar et les agents'));
}
function openDataFolder(folder) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise((resolve, reject) => {
    execFile(command, [folder], error => error ? reject(new Error('Impossible d’ouvrir le dossier des livrables sur cet ordinateur.')) : resolve());
  });
}
function openNativeFile(file) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise((resolve, reject) => {
    execFile(command, [file], error => error ? reject(new Error('Impossible d’ouvrir ce fichier dans son application sur cet ordinateur.')) : resolve());
  });
}
export async function createAtelierServer({ port = 4850, dataDir = resolveServerDataDirectory(), providers, runner = runAgent, demoDelay = 1800, openFolder = openDataFolder, openFile = openNativeFile, detect = detectProviders, installer = runInstaller, loginFactory = options => new BrowserLogin(options), publishingFactory = options => new Publishing(options), connectorsFactory = options => new Connectors(options), automationFactory = options => new Automations(options), voiceFactory = options => new VoiceService(options) } = {}) {
  let engine;
  const connectors = connectorsFactory({ dataDir, find: findBinary, onChange: () => engine?.emit('change', engine.state()) });
  await connectors.ready;
  engine = new Atelier({ dataDir, runAgent: options => runner({ ...options, disabledMcpNames: connectors.disabledNames('codex') }), providers: providers ?? await detect(), demoDelay });
  const automations = automationFactory({ engine, dataDir: engine.dataDir, resolveConnectorPlan: options => connectors.readPlan(options) });
  const voice = voiceFactory({ dataDir: engine.dataDir });
  await voice.ready;
  const login = loginFactory({ detect, install: installer, installerDependencies: { root: ROOT, env: { ...process.env, OSCAR_DATA_DIR: engine.dataDir } }, onChange: (logins, updated) => {
    engine.logins = logins;
    if (updated) engine.providers = updated;
    engine.emit('change', engine.state());
  } });
  const publishing = publishingFactory({ getMission: id => engine.get(id), workDir: id => engine.workDir(id), isActive: id => engine.runs.has(id), onChange: () => engine.emit('change', engine.state()) });
  const clients = new Set();
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const push = state => { const event = `event: state\ndata: ${JSON.stringify(state)}\n\n`; for (const c of clients) if (!c.destroyed) c.write(event); };
  engine.on('change', push);
  const heartbeat = setInterval(() => { for (const c of clients) c.write(': heartbeat\n\n'); }, 20000);
  heartbeat.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const actualPort = server.address()?.port ?? port;
    const allowedHosts = new Set([...hosts, `localhost:${actualPort}`, `127.0.0.1:${actualPort}`]);
    const allowedOrigins = new Set([...origins, `http://localhost:${actualPort}`, `http://127.0.0.1:${actualPort}`]);
    if (!allowedHosts.has(req.headers.host) || (req.headers.origin && !allowedOrigins.has(req.headers.origin))) { json(res, 403, { error: 'Cette requête ne vient pas de L’Atelier.' }); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`event: state\ndata: ${JSON.stringify(engine.state())}\n\n`);
        clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (pathname === '/api/state' && req.method === 'GET') { json(res, 200, engine.state()); return; }
      if (pathname === '/api/connectors' && req.method === 'GET') { json(res, 200, await connectors.state()); return; }
      if (pathname === '/api/automations' && req.method === 'GET') { json(res, 200, automations.state()); return; }
      if (pathname === '/api/voice' && req.method === 'GET') { json(res, 200, await voice.state()); return; }
      const audioRoute = pathname.match(/^\/api\/voice\/audio\/([a-f0-9]{64})\.wav$/);
      if (audioRoute && req.method === 'GET') {
        const audio = await voice.audio(audioRoute[1]);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'" }); res.end(audio); return;
      }
      if (pathname === '/api/publishing' && req.method === 'GET') { json(res, 200, await publishing.state()); return; }
      const publicationRoute = pathname.match(/^\/api\/missions\/([^/]+)\/publication(?:\/(preview))?$/);
      if (publicationRoute && !publicationRoute[2] && req.method === 'GET') { json(res, 200, publishing.get(publicationRoute[1])); return; }
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json') || (!req.headers.origin && req.headers['x-oscar-client'] !== '1')) { json(res, 403, { error: 'Requête locale JSON attendue.' }); return; }
        const parts = []; let size = 0;
        for await (const part of req) {
          size += part.length;
          if (size > 100000) { json(res, 413, { error: 'La demande est trop longue.' }); return; }
          parts.push(part);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { json(res, 400, { error: 'La demande JSON est invalide.' }); return; }
        if (!body || typeof body !== 'object' || Array.isArray(body)) { json(res, 400, { error: 'La demande doit être un objet JSON.' }); return; }
        if (pathname === '/api/automations' && req.method === 'POST') { json(res, 201, automations.create(body)); return; }
        const automationRoute = pathname.match(/^\/api\/automations\/([^/]+)(?:\/(run|pause))?$/);
        if (automationRoute) {
          const [, id, action] = automationRoute;
          if (!action && req.method === 'DELETE') { json(res, 200, automations.remove(id)); return; }
          if (!action && ['POST', 'PATCH'].includes(req.method)) { json(res, 200, automations.update(id, body)); return; }
          if (action === 'run' && req.method === 'POST') { json(res, 202, await automations.run(id)); return; }
          if (action === 'pause' && req.method === 'POST') { json(res, 200, automations.update(id, { enabled: false })); return; }
        }
        if (req.method !== 'POST') { json(res, 404, { error: 'Action inconnue.' }); return; }
        if (pathname === '/api/voice/install') { json(res, 202, await voice.install(body)); return; }
        if (pathname === '/api/voice/synthesize') {
          const controller = new AbortController();
          const disconnected = () => { if (!res.writableEnded) controller.abort(); };
          res.once('close', disconnected);
          try { const clip = await voice.speak(body, { signal: controller.signal }); if (!res.destroyed) json(res, 200, clip); }
          finally { res.off('close', disconnected); }
          return;
        }
        if (pathname === '/api/connectors/refresh') { json(res, 200, await connectors.state({ refresh: true })); return; }
        if (pathname === '/api/connectors/handoff') { json(res, 200, await connectors.handoff(body)); return; }
        if (pathname === '/api/connectors/setup' || pathname === '/api/connectors/auth') {
          if (engine.state().activeMissions.some(mission => mission.provider === body.client)) { json(res, 409, { error: 'Terminez les missions qui utilisent ce moteur avant de modifier ses connecteurs.' }); return; }
          json(res, 202, await (pathname.endsWith('/setup') ? connectors.setup(body) : connectors.auth(body))); return;
        }
        if (pathname === '/api/publishing/github/login') { json(res, 202, publishing.startGitHubLogin()); return; }
        if (publicationRoute) {
          const result = await (publicationRoute[2] ? publishing.preview(publicationRoute[1], body) : publishing.publish(publicationRoute[1], body));
          json(res, publicationRoute[2] ? 200 : 202, result); return;
        }
        if (pathname === '/api/providers/refresh') {
          if (typeof login.refresh === 'function') await login.refresh();
          else { engine.providers = await detect(); engine.emit('change', engine.state()); }
          json(res, 200, engine.state()); return;
        }
        const loginRoute = pathname.match(/^\/api\/providers\/(codex|claude)\/(login|setup)$/);
        if (loginRoute) {
          if (engine.state().activeMissions.some(mission => mission.provider === loginRoute[1])) { json(res, 409, { error: 'Terminez les missions qui utilisent ce moteur avant de modifier sa connexion.' }); return; }
          json(res, 202, await (loginRoute[2] === 'setup' ? login.setup(loginRoute[1]) : login.start(loginRoute[1]))); return;
        }
        if (pathname === '/api/open-data') { await openFolder(engine.dataDir); json(res, 200, { ok: true }); return; }
        if (pathname === '/api/missions') {
          if (connectors.active?.has(body.provider)) { json(res, 409, { error: 'Les connecteurs de ce moteur sont en cours de préparation. Attendez la fin de cette opération.' }); return; }
          if (['installing', 'connecting'].includes(engine.logins?.[body.provider]?.status)) { json(res, 409, { error: 'Ce moteur est en cours de préparation. Attendez sa connexion ou choisissez un autre moteur.' }); return; }
          json(res, 202, engine.start(body)); return;
        }
        const openMissionFolder = pathname.match(/^\/api\/missions\/([^/]+)\/open-folder$/);
        if (openMissionFolder) {
          const id = openMissionFolder[1];
          if (!engine.get(id)) { json(res, 404, { error: 'Mission inconnue.' }); return; }
          await openFolder(engine.workDir(id)); json(res, 200, { ok: true }); return;
        }
        const openMissionFile = pathname.match(/^\/api\/missions\/([^/]+)\/open-file$/);
        if (openMissionFile) {
          const id = openMissionFile[1];
          if (!engine.get(id)) { json(res, 404, { error: 'Mission inconnue.' }); return; }
          const file = resolveNativeMissionFile(engine.workDir(id), body.path);
          await openFile(file); json(res, 200, { ok: true }); return;
        }
        const stop = pathname.match(/^\/api\/missions\/([^/]+)\/stop$/);
        if (stop) { if (!engine.get(stop[1])) { json(res, 404, { error: 'Mission inconnue.' }); return; } json(res, 200, engine.stop(stop[1])); return; }
        json(res, 404, { error: 'Action inconnue.' }); return;
      }
      const missionPath = pathname.match(/^\/api\/missions\/([^/]+)(?:\/files\/(.+))?$/);
      if (missionPath && req.method === 'GET') {
        const [, id, relative] = missionPath;
        const mission = engine.get(id);
        if (!mission) { json(res, 404, { error: 'Mission inconnue.' }); return; }
        if (!relative) { json(res, 200, mission); return; }
        const root = realpathSync(engine.workDir(id));
        const candidate = path.resolve(root, relative);
        if (!candidate.startsWith(root + path.sep) || relative.includes('\0') || relative.split(/[\\/]/).some(s => s.startsWith('.'))) { json(res, 403, { error: 'Ce fichier est hors du dossier de la mission.' }); return; }
        if (!existsSync(candidate)) { json(res, 404, { error: 'Fichier introuvable.' }); return; }
        const real = realpathSync(candidate);
        if (!real.startsWith(root + path.sep) || !statSync(real).isFile()) { json(res, 403, { error: 'Ce fichier n’est pas accessible.' }); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(real)] ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(real))}`, 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store' });
        const stream = createReadStream(real); stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      if (pathname.startsWith('/api/')) { json(res, 404, { error: 'Route inconnue.' }); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: 'Méthode non prise en charge.' }); return; }
      const staticName = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      if (!['index.html', 'style.css', 'immersive.css', 'app.js', 'pixel-world.js', 'pixel-scene.css', 'mission-catalog.js', 'mission-catalog.css', 'mission-extras.js', 'coffee-dialog.js', 'coffee-dialog.css', 'ambience.js', 'welcome-guide.js', 'welcome-guide.css', 'i18n.js', 'translations-catalog.js', 'translations-interface.js', 'translations-guide.js', 'publication-dialog.js', 'publication-dialog.css', 'office-speech.js', 'clock-dialog.js', 'clock-dialog.css', 'creative-studio.js', 'creative-studio.css', 'automations-dialog.js', 'automations-dialog.css', 'connectors-dialog.js', 'connectors-dialog.css', 'completion-dialog.js', 'completion-dialog.css', 'artifact-viewer.js', 'artifact-viewer.css', 'secretary-dialog.js', 'secretary-dialog.css', 'voice-dialog.js', 'voice-preview-oscar-fr.wav', 'voice-preview-oscar-en.wav', 'voice-preview-oscar-nl.wav', 'voice-preview-zoe-fr.wav', 'voice-preview-zoe-en.wav', 'voice-preview-zoe-nl.wav', 'voice-dialog.css'].includes(staticName)) { res.writeHead(404); res.end('Introuvable'); return; }
      const content = await readFile(path.join(ROOT, 'public', staticName));
      res.writeHead(200, { 'Content-Type': MIME[path.extname(staticName)], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.destroyed) return;
      if (!res.headersSent) json(res, ['PUBLICATION_NOT_FOUND', 'AUTOMATION_NOT_FOUND', 'MISSION_FILE_NOT_FOUND', 'VOICE_AUDIO_NOT_FOUND'].includes(error.code) ? 404 : error.code === 'MISSION_FILE_FORBIDDEN' ? 403 : ['MISSION_CAPACITY', 'PUBLICATION_BUSY', 'PUBLICATION_CHANGED', 'CONNECTOR_BUSY', 'AUTOMATION_BUSY', 'VOICE_BUSY'].includes(error.code) ? 409 : 400, { error: error.message?.slice(0, 2000) ?? 'La demande a échoué.' });
      else res.destroy();
    }
  });
  server.requestTimeout = 15000;
  server.once('listening', () => automations.start());
  const close = async () => {
    await automations.close();
    await voice.close();
    await connectors.close();
    await login.close();
    await publishing.close();
    for (const m of engine.missions.values()) if (engine.runs.has(m.id)) engine.stop(m.id);
    await Promise.all([...engine.runs.keys()].map(id => engine.wait(id)));
    clearInterval(heartbeat); for (const c of clients) c.end();
    engine.off('change', push);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return { server, engine, publishing, connectors, automations, voice, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 4850);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Le port choisi est invalide.');
  const { server, engine, close } = await createAtelierServer({ port });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé. L’Atelier est peut-être déjà ouvert : http://localhost:${port}` : 'Impossible de lancer le serveur local.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`Oscar et les agents · Oscar et son équipe\n${url}\nDonnées : ${engine.dataDir.replace(os.homedir(), '~')}`);
    if (process.argv.includes('--open')) execFile('open', [url], () => {});
  });
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; await close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
