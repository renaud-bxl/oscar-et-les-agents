import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReadStream, existsSync, statSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { Atelier } from './lib/orchestrator.mjs';
import { detectProviders, runAgent } from './lib/providers.mjs';
import { BrowserLogin } from './lib/auth.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
export function resolveServerDataDirectory(env = process.env) {
  return path.resolve(env.OSCAR_DATA_DIR || env.ATELIER_DATA_DIR || path.join(os.homedir(), 'Documents', 'Oscar et les agents'));
}
function openDataFolder(folder) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise((resolve, reject) => {
    execFile(command, [folder], error => error ? reject(new Error('Impossible d’ouvrir le dossier des livrables sur cet ordinateur.')) : resolve());
  });
}
export async function createAtelierServer({ port = 4850, dataDir = resolveServerDataDirectory(), providers, runner = runAgent, demoDelay = 1800, openFolder = openDataFolder, loginFactory = options => new BrowserLogin(options) } = {}) {
  const engine = new Atelier({ dataDir, runAgent: runner, providers: providers ?? await detectProviders(), demoDelay });
  const login = loginFactory({ onChange: (logins, updated) => {
    engine.logins = logins;
    if (updated) engine.providers = updated;
    engine.emit('change', engine.state());
  } });
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
      if (req.method === 'POST') {
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
        const loginRoute = pathname.match(/^\/api\/providers\/(codex|claude)\/login$/);
        if (loginRoute) {
          if (engine.state().activeMissions.some(mission => mission.provider === loginRoute[1])) { json(res, 409, { error: 'Terminez les missions qui utilisent ce moteur avant de modifier sa connexion.' }); return; }
          json(res, 202, await login.start(loginRoute[1])); return;
        }
        if (pathname === '/api/open-data') { await openFolder(engine.dataDir); json(res, 200, { ok: true }); return; }
        if (pathname === '/api/missions') { json(res, 202, engine.start(body)); return; }
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
      if (!['index.html', 'style.css', 'immersive.css', 'app.js', 'pixel-world.js', 'pixel-scene.css', 'mission-catalog.js', 'mission-catalog.css', 'coffee-dialog.js', 'coffee-dialog.css'].includes(staticName)) { res.writeHead(404); res.end('Introuvable'); return; }
      const content = await readFile(path.join(ROOT, 'public', staticName));
      res.writeHead(200, { 'Content-Type': MIME[path.extname(staticName)], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(res, error.code === 'MISSION_CAPACITY' ? 409 : 400, { error: error.message?.slice(0, 2000) ?? 'La demande a échoué.' });
      else res.destroy();
    }
  });
  server.requestTimeout = 15000;
  const close = async () => {
    login.close();
    for (const m of engine.missions.values()) if (engine.runs.has(m.id)) engine.stop(m.id);
    await Promise.all([...engine.runs.keys()].map(id => engine.wait(id)));
    clearInterval(heartbeat); for (const c of clients) c.end();
    engine.off('change', push);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return { server, engine, close };
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
