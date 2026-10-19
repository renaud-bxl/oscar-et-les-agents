import path from 'node:path';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CLIENTS = new Set(['codex', 'claude']);
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MANAGED_NAME = /^oscar-[a-z0-9][a-z0-9-]{0,55}$/;
const MAX_OUTPUT = 512 * 1024;
const error = (message, code = 'CONNECTOR_INVALID') => Object.assign(new Error(message), { code });
const clone = value => structuredClone(value);
const NOTICE = 'Les connecteurs sont ajoutés à votre client officiel, après votre action explicite. Les plugins de cette conversation ne sont pas importés. L’ajout seul n’active aucun outil dans les agents d’Oscar : préparez un brief pour votre client interactif. Seule une option de lecture Gmail ou Google Agenda, choisie séparément et vérifiée, peut être autorisée pour une programmation.';
export const GMAIL_MCP_URL = 'https://gmailmcp.googleapis.com/mcp/v1';
export const GMAIL_READ_TOOLS = Object.freeze(['get_message', 'get_thread', 'list_drafts', 'list_labels', 'search_threads']);
export const CALENDAR_MCP_URL = 'https://calendarmcp.googleapis.com/mcp/v1';
export const CALENDAR_READ_TOOLS = Object.freeze(['get_event', 'list_calendars', 'list_events', 'search_events']);
export const READ_ONLY_SERVICES = Object.freeze({
  gmail: Object.freeze({ url: GMAIL_MCP_URL, enabledTools: GMAIL_READ_TOOLS }),
  calendar: Object.freeze({ url: CALENDAR_MCP_URL, enabledTools: CALENDAR_READ_TOOLS }),
});
const trustedReadPlans = new WeakSet();
export const isTrustedReadPlan = plan => Boolean(plan && typeof plan === 'object' && trustedReadPlans.has(plan));

// These URLs and prerequisites come from the linked provider documentation.
export const CONNECTOR_CATALOG = Object.freeze([
  Object.freeze({ id: 'higgsfield', name: 'Higgsfield', url: 'https://mcp.higgsfield.ai/mcp', documentationUrl: 'https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp', status: 'available', reason: 'Connexion officielle dans le navigateur, sans clé API. Les générations consomment les crédits du compte ; confirmez le coût dans votre client avant toute génération.' }),
  Object.freeze({ id: 'gmail', name: 'Gmail', url: 'https://gmailmcp.googleapis.com/mcp/v1', documentationUrl: 'https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server', status: 'prerequisites', reason: 'Le serveur officiel demande un projet Google et un client OAuth configurés. Ce gestionnaire ne collecte pas de secret OAuth. Vous pouvez utiliser le plugin Gmail de ChatGPT et y poursuivre avec votre brief.', alternativeUrl: 'https://chatgpt.com/plugins' }),
  Object.freeze({ id: 'calendar', name: 'Google Agenda', url: CALENDAR_MCP_URL, documentationUrl: 'https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server', status: 'prerequisites', reason: 'Le serveur officiel, en aperçu pour les développeurs Google Workspace, demande un projet Google, les services Agenda activés et un client OAuth configuré. Préparez ces accès dans Google puis autorisez le connecteur dans Codex. Oscar ne collecte aucun secret OAuth.', alternativeUrl: 'https://chatgpt.com/plugins' }),
  Object.freeze({ id: 'outlook', name: 'Microsoft 365 · Work IQ', url: 'https://workiq.svc.cloud.microsoft/mcp', documentationUrl: 'https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview', status: 'prerequisites', reason: 'Work IQ dépend des accès professionnels Microsoft 365, de la licence et des autorisations de votre organisation. Sa configuration doit être validée par votre administrateur. Une connexion de plugin ChatGPT ne prouve pas une connexion du client local.', alternativeUrl: 'https://chatgpt.com/plugins' }),
  Object.freeze({ id: 'custom', name: 'Mon serveur MCP', url: null, documentationUrl: null, status: 'available', reason: 'Ajoutez l’adresse d’un serveur que vous connaissez. Seules les connexions HTTP avec autorisation gérée par le client sont proposées ; aucun secret ni programme serveur à installer.' }),
]);

export function connectorName(value) {
  if (typeof value !== 'string') throw error('Donnez un nom court à votre connecteur.');
  const stem = value.trim().toLowerCase().replace(/^oscar-/, '');
  const name = `oscar-${stem}`;
  if (!MANAGED_NAME.test(name)) throw error('Utilisez un nom de 1 à 56 caractères : lettres, chiffres et tirets.');
  return name;
}

export function connectorUrl(value) {
  if (typeof value !== 'string' || value.length > 1500) throw error('Indiquez une adresse de serveur MCP valide.');
  let url;
  try { url = new URL(value); } catch { throw error('Indiquez une adresse de serveur MCP valide.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || !url.hostname || url.username || url.password || url.search || url.hash || /[\x00-\x20\x7f]/.test(value)) {
    throw error('L’adresse doit utiliser HTTPS, sans identifiant, secret, paramètres ni fragment. HTTP est accepté uniquement sur cet ordinateur.');
  }
  return url.href;
}

export function parseCodexConnectors(output) {
  let data;
  try { data = JSON.parse(output); } catch { throw error('Codex n’a pas fourni une liste de connecteurs lisible.', 'CONNECTOR_PROBE'); }
  const rows = Array.isArray(data) ? data : Array.isArray(data?.servers) ? data.servers : null;
  if (!rows) throw error('Codex n’a pas fourni une liste de connecteurs lisible.', 'CONNECTOR_PROBE');
  return rows.filter(row => row && typeof row.name === 'string' && SAFE_NAME.test(row.name)).map(row => {
    const auth = String(row.auth_status || '').toLowerCase();
    const status = row.enabled === false ? 'disabled' : /^(not_logged_in|not_authenticated|needs_auth)$/.test(auth) ? 'needs_auth' : /^(o_auth|oauth|authenticated|authorized)$/.test(auth) ? 'authorized' : row.connected === true ? 'connected' : 'configured';
    return { name: row.name, status, reason: status === 'authorized' ? 'Autorisation détectée par Codex. La disponibilité des outils sera vérifiée dans votre session interactive.' : status === 'needs_auth' ? 'Ce connecteur demande une autorisation dans votre navigateur.' : status === 'disabled' ? 'Ce connecteur est désactivé dans Codex.' : status === 'connected' ? 'Codex confirme une connexion disponible.' : 'Serveur configuré dans Codex ; son autorisation et ses outils restent à vérifier.' };
  });
}

export function parseClaudeConnectors(output) {
  const clean = String(output).replace(/\x1b\[[0-9;]*m/g, '');
  const rows = [];
  for (const line of clean.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}):\s*(.*)$/);
    if (!match || /^(checking|warning|error|note|usage)$/i.test(match[1])) continue;
    const detail = match[2];
    const status = /[✓✔]\s*connected/i.test(detail) ? 'connected' : /needs? (?:authentication|authorization)|not authenticated|pending approval|⏸/i.test(detail) ? 'needs_auth' : /[✗✘]|failed|unavailable/i.test(detail) ? 'failed' : 'configured';
    rows.push({ name: match[1], status, reason: status === 'connected' ? 'Claude Code confirme une connexion disponible.' : status === 'needs_auth' ? 'Autorisez ce connecteur avec la connexion officielle ou le menu /mcp de Claude Code.' : status === 'failed' ? 'Claude Code ne confirme pas la disponibilité du connecteur. Vérifiez-le dans votre client.' : 'Serveur configuré dans Claude Code ; son autorisation et ses outils restent à vérifier.' });
  }
  return rows;
}

export function connectorEnvironment(source = process.env) {
  const env = { ...source, NO_COLOR: '1' };
  // The official clients keep their normal subscription and secure OAuth stores.
  // Do not copy credentials or move their home/config directories.
  for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|CLIENT_SECRET|PASSWORD|PASSWD)$/i.test(key) || key === 'CLAUDECODE') delete env[key];
  return env;
}

async function defaultFind(client) {
  const candidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, client));
  if (client === 'codex') candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex');
  if (client === 'claude' && process.env.HOME) candidates.push(path.join(process.env.HOME, '.local/bin/claude'));
  for (const candidate of candidates) try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try another executable. */ }
  return null;
}

export class Connectors {
  constructor({ dataDir, find = defaultFind, run, spawnImpl = spawn, env = process.env, onChange = () => {}, now = Date.now, timeoutMs = 8 * 60000, probeTimeoutMs = 10000 } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw error('Le dossier de données du bureau est nécessaire.');
    Object.assign(this, { dataDir: path.resolve(dataDir), find, spawn: spawnImpl, onChange, now, timeoutMs, probeTimeoutMs });
    this.file = path.join(this.dataDir, 'connectors.json');
    this.env = connectorEnvironment(env);
    this.run = run || ((binary, args, options) => this.process(binary, args, options));
    this.registry = [];
    this.clients = {};
    this.detected = { codex: [], claude: [] };
    this.jobs = [];
    this.active = new Map();
    this.closed = false;
    this.checkedAt = -Infinity;
    this.ready = this.load();
  }

  async load() {
    let text;
    try { text = await readFile(this.file, 'utf8'); } catch (cause) { if (cause.code === 'ENOENT') return; throw error('Le registre des connecteurs ne peut pas être lu.'); }
    if (text.length > 128000) throw error('Le registre des connecteurs est trop volumineux.');
    let data;
    try { data = JSON.parse(text); } catch { throw error('Le registre des connecteurs est invalide.'); }
    if (!Array.isArray(data?.connections) || data.connections.length > 100) throw error('Le registre des connecteurs est invalide.');
    this.registry = data.connections.map(row => {
      if (!CLIENTS.has(row?.client) || !MANAGED_NAME.test(row.name)) throw error('Le registre des connecteurs contient un nom invalide.');
      return { client: row.client, name: row.name, connectorId: CONNECTOR_CATALOG.some(item => item.id === row.connectorId) ? row.connectorId : 'custom', url: connectorUrl(row.url) };
    });
  }

  async save() {
    await mkdir(this.dataDir, { recursive: true });
    const temporary = path.join(this.dataDir, `.oscar-connectors-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ version: 1, connections: this.registry }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, this.file);
  }

  disabledNames(client = 'codex') { return [...new Set(this.registry.filter(row => row.client === client).map(row => row.name))]; }
  changed() { try { this.onChange(); } catch { /* UI refreshes cannot change a client operation. */ } }
  assertClient(client) { if (!CLIENTS.has(client)) throw error('Choisissez Codex ou Claude Code.'); }

  async inspect(client) {
    const binary = await this.find(client);
    if (!binary) { this.clients[client] = { available: false, status: 'unavailable', message: 'Ce client officiel n’est pas installé. Préparez votre moteur dans les réglages.' }; this.detected[client] = []; return; }
    try {
      const response = await this.run(binary, client === 'codex' ? ['mcp', 'list', '--json'] : ['mcp', 'list'], { env: this.env, cwd: this.dataDir, capture: true, timeoutMs: this.probeTimeoutMs });
      if (response.code !== 0) throw error('La vérification du client a échoué.');
      this.detected[client] = client === 'codex' ? parseCodexConnectors(response.stdout) : parseClaudeConnectors(response.stdout);
      if (client === 'codex') {
        // Only non-secret service identity survives this local configuration check.
        // Bound subprocesses even if another application configured many servers.
        await Promise.all(this.detected.codex.filter(row => ['authorized', 'connected'].includes(row.status)).slice(0, 64).map(async row => {
          try { const metadata = await this.readMetadata({ name: row.name, binary }); row.readOnlyAutomation = { available: true, service: metadata.service }; } catch { /* Unsupported or ambiguous servers remain ineligible. */ }
        }));
      }
      this.clients[client] = { available: true, status: 'available', message: 'Noms et états fournis par le client officiel. Aucun fichier d’identifiants n’est lu.' };
    } catch {
      this.detected[client] = [];
      this.clients[client] = { available: true, status: 'failed', message: 'Le client n’a pas confirmé ses connecteurs. Vérifiez sa version et son menu MCP.' };
    }
  }

  async state({ refresh = false } = {}) {
    await this.ready;
    if (!this.closed && (refresh || this.now() - this.checkedAt > 5000)) {
      if (!this.checking) this.checking = Promise.all(['codex', 'claude'].map(client => this.inspect(client))).then(() => { this.checkedAt = this.now(); }).finally(() => { this.checking = null; });
      await this.checking;
    }
    const connections = [];
    for (const client of CLIENTS) {
      for (const item of this.detected[client]) {
        const owned = this.registry.find(row => row.client === client && row.name === item.name);
        connections.push({ client, ...item, ...(owned || {}), managed: Boolean(owned), readOnlyAutomation: item.readOnlyAutomation || { available: false, service: null } });
      }
      for (const item of this.registry.filter(row => row.client === client && !this.detected[client].some(found => found.name === row.name))) {
        connections.push({ ...item, managed: true, status: this.clients[client]?.available === false ? 'unavailable' : 'unverified', reason: 'Le client n’a pas confirmé ce connecteur. Son nom reste exclu des missions automatiques d’Oscar.', readOnlyAutomation: { available: false, service: null } });
      }
    }
    return { scope: 'user', missionAccess: 'handoff_only', readOnlyAutomation: { available: true, client: 'codex', services: Object.entries(READ_ONLY_SERVICES).map(([service, value]) => ({ service, enabledTools: [...value.enabledTools] })), requiresSelection: true, message: 'Une automatisation peut lire Gmail ou Google Agenda après sélection explicite d’un connecteur officiel déjà configuré et autorisé. Les résultats restent des fichiers locaux, sans envoi, brouillon Gmail, modification ni invitation Agenda.' }, message: NOTICE, catalog: clone(CONNECTOR_CATALOG), clients: clone(this.clients), connections, jobs: clone(this.jobs) };
  }

  async readMetadata({ name, binary } = {}) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw error('Le nom du connecteur n’est pas compatible avec une lecture automatique.', 'CONNECTOR_READ_ONLY');
    binary ||= await this.find('codex');
    const response = await this.run(binary, ['mcp', 'get', name, '--json'], { env: this.env, cwd: this.dataDir, capture: true, timeoutMs: this.probeTimeoutMs });
    if (response.code !== 0) throw error('Codex ne confirme pas la configuration de ce connecteur.', 'CONNECTOR_READ_ONLY');
    let data;
    try { data = JSON.parse(response.stdout); } catch { throw error('Codex ne confirme pas la configuration de ce connecteur.', 'CONNECTOR_READ_ONLY'); }
    const transport = data?.transport;
    const service = Object.keys(READ_ONLY_SERVICES).find(type => READ_ONLY_SERVICES[type].url === transport?.url);
    if (data?.name !== name || data.enabled === false || transport?.type !== 'streamable_http' || !service || transport.bearer_token_env_var || Object.keys(transport.http_headers || {}).length || Object.keys(transport.env_http_headers || {}).length || transport.http_headers_helper) throw error('La lecture automatique exige un serveur Gmail officiel ou Google Agenda officiel avec OAuth, sans en-tête ou programme personnalisé.', 'CONNECTOR_READ_ONLY');
    return { service, ...READ_ONLY_SERVICES[service] };
  }

  async readPlan({ client = 'codex', name } = {}) {
    await this.ready;
    if (client !== 'codex' || typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw error('Choisissez un connecteur Gmail ou Google Agenda du client Codex.', 'CONNECTOR_READ_ONLY');
    if (this.closed || this.active.has(client)) throw error('Les connecteurs de ce client sont en cours de préparation.', 'CONNECTOR_BUSY');
    await this.inspect(client);
    const connection = this.detected.codex.find(row => row.name === name);
    if (this.clients.codex?.status !== 'available' || !['authorized', 'connected'].includes(connection?.status)) throw error('Le client ne confirme pas une autorisation Gmail ou Google Agenda. Terminez la configuration officielle et la connexion avant de lancer une lecture.', 'CONNECTOR_AUTH');
    const metadata = await this.readMetadata({ name });
    const plan = Object.freeze({ client: 'codex', type: metadata.service, name, url: metadata.url, enabledTools: metadata.enabledTools, disabledServers: Object.freeze(this.detected.codex.map(row => row.name).filter(other => other !== name)) });
    trustedReadPlans.add(plan);
    return plan;
  }

  startJob(client, name, action, work) {
    if (this.closed) throw error('Le bureau se ferme.');
    if (this.active.has(client)) throw error('Une opération utilise déjà les connecteurs de ce client.', 'CONNECTOR_BUSY');
    const controller = new AbortController();
    const job = { id: randomUUID(), client, name, action, status: action === 'setup' ? 'configuring' : 'authorizing', message: action === 'setup' ? 'Ajout dans votre client officiel. Celui-ci peut demander une autorisation dans votre navigateur.' : 'Confirmez l’autorisation dans le navigateur ouvert par votre client officiel.' };
    this.jobs.push(job); if (this.jobs.length > 30) this.jobs.shift();
    this.active.set(client, { controller });
    const operation = this.active.get(client);
    operation.completion = Promise.resolve().then(() => work(controller.signal, job)).catch(() => { job.status = 'failed'; job.message = controller.signal.aborted ? 'La connexion a été interrompue. Vérifiez son état dans votre client.' : 'Le client n’a pas confirmé cette opération. Vérifiez sa connexion et son menu MCP, puis réessayez.'; }).finally(async () => {
      if (!this.closed) await this.inspect(client); this.checkedAt = this.now();
      this.active.delete(client); this.changed();
    });
    this.changed(); return clone(job);
  }

  async setup(body) {
    await this.ready;
    this.assertClient(body?.client);
    const item = CONNECTOR_CATALOG.find(entry => entry.id === (body.connectorId || 'custom'));
    if (!item) throw error('Ce connecteur n’est pas proposé.');
    if (item.status === 'prerequisites') throw error(item.reason, 'CONNECTOR_PREREQUISITES');
    if (Object.keys(body).some(key => !['client', 'connectorId', 'name', 'url'].includes(key))) throw error('Aucun secret ou paramètre supplémentaire n’est accepté.');
    const name = connectorName(body.name || item.id);
    const url = connectorUrl(item.id === 'custom' ? body.url : item.url);
    return this.startJob(body.client, name, 'setup', async (signal, job) => {
      await this.inspect(body.client);
      if (this.clients[body.client]?.status !== 'available') throw error('Le client ne peut pas vérifier ses connecteurs.');
      if (this.detected[body.client].some(row => row.name === name) || this.registry.some(row => row.client === body.client && row.name === name)) {
        job.status = 'failed'; job.message = 'Ce nom existe déjà. Aucune configuration existante n’a été remplacée ; choisissez un autre nom.'; return;
      }
      if (this.registry.length >= 100) throw error('Le registre contient déjà trop de connecteurs.');
      // Reserve before add: even a partially completed CLI operation remains excluded from agents.
      this.registry.push({ client: body.client, name, connectorId: item.id, url }); await this.save();
      const binary = await this.find(body.client);
      const args = body.client === 'codex' ? ['mcp', 'add', name, '--url', url] : ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, url];
      const response = await this.run(binary, args, { env: this.env, cwd: this.dataDir, capture: false, timeoutMs: this.timeoutMs, signal });
      if (response.code !== 0) throw error('Le client n’a pas confirmé l’ajout.');
      job.status = 'completed'; job.message = 'Le client a confirmé l’ajout. Vérifiez son état puis autorisez le connecteur si nécessaire. Il reste désactivé dans les agents automatiques d’Oscar.';
    });
  }

  async auth(body) {
    await this.ready;
    this.assertClient(body?.client);
    if (!MANAGED_NAME.test(body?.name) || !this.registry.some(row => row.client === body.client && row.name === body.name)) throw error('Ajoutez ce connecteur depuis Oscar avant de l’autoriser.');
    if (Object.keys(body).some(key => !['client', 'name'].includes(key))) throw error('Aucun identifiant ni secret n’est accepté.');
    return this.startJob(body.client, body.name, 'auth', async (signal, job) => {
      const binary = await this.find(body.client);
      if (!binary) throw error('Le client officiel est absent.');
      const help = await this.run(binary, ['mcp', 'login', '--help'], { env: this.env, cwd: this.dataDir, capture: true, timeoutMs: this.probeTimeoutMs, signal });
      if (help.code !== 0 || !/login/.test(help.stdout || '')) {
        job.status = 'needs_auth'; job.message = body.client === 'claude' ? `Cette version demande une session interactive : ouvrez Claude Code, tapez /mcp puis autorisez ${body.name}.` : `Cette version ne propose pas la connexion automatique. Vérifiez ${body.name} dans le menu MCP de Codex.`; return;
      }
      const response = await this.run(binary, ['mcp', 'login', body.name], { env: this.env, cwd: this.dataDir, capture: false, timeoutMs: this.timeoutMs, signal });
      if (response.code !== 0) throw error('L’autorisation n’a pas été confirmée.');
      job.status = 'completed'; job.message = 'Le client a terminé son parcours d’autorisation. Consultez l’état vérifié du connecteur avant de poursuivre dans votre session interactive.';
    });
  }

  async handoff(body) {
    await this.ready;
    if (body?.client !== 'chatgpt') this.assertClient(body?.client);
    const plugin = body.client === 'chatgpt' && CONNECTOR_CATALOG.find(row => row.id === body.connectorId && ['gmail', 'outlook', 'higgsfield'].includes(row.id));
    if (!plugin) await this.state();
    const item = plugin ? { name: plugin.id, displayName: plugin.name } : this.registry.find(row => row.client === body.client && row.name === body.name) || this.detected[body.client]?.find(row => row.name === body.name);
    if (!item) throw error('Choisissez un connecteur ajouté depuis Oscar.');
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 16000) throw error('Préparez un brief de 1 à 16 000 caractères.');
    const personal = body.prompt.trim();
    const prompt = `${personal}\n\nCONNECTEUR À UTILISER\n${item.name}\nVérifie sa connexion et les outils réellement disponibles avant de commencer. L’accès depuis Oscar n’autorise aucune action payante ni aucun envoi. Pour un message : prépare d’abord le texte, les destinataires et les pièces jointes, puis demande ma confirmation avant tout envoi. Pour Higgsfield : présente le modèle, les paramètres et le coût en crédits estimé, puis demande ma confirmation avant toute génération. Si le coût ou la disponibilité ne sont pas vérifiables, arrête-toi et explique la limite. Ne prétends pas avoir réalisé une action sans résultat confirmé par l’outil.`;
    const instructions = plugin
      ? `Ouvrez ChatGPT, ajoutez et autorisez le plugin ${item.displayName} si nécessaire, puis collez ce brief dans la conversation où ce plugin est disponible. Un plugin installé ne prouve pas une autorisation. Ce transfert ne lance aucun outil et les confirmations restent dans ChatGPT.`
      : `Ouvrez ${body.client === 'codex' ? 'Codex' : 'Claude Code'} dans une session interactive, vérifiez ${item.name} dans le menu /mcp, puis collez ce brief. Ce transfert ne lance aucun outil et ne prouve pas une connexion. Les autorisations et confirmations restent dans votre client officiel.`;
    return { client: body.client, name: item.name, prompt, filename: `Brief-${item.name}.md`, missionAccess: 'handoff_only', instructions, ...(plugin ? { url: 'https://chatgpt.com/plugins' } : {}) };
  }

  process(binary, args, { env = this.env, cwd, capture = false, timeoutMs = this.probeTimeoutMs, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (!binary || signal?.aborted || this.closed) { reject(error('Opération interrompue.')); return; }
      let child, output = '', length = 0, settled = false, failure, killTimer;
      const terminate = () => { if (!child?.pid) return; try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* Already exited. */ } killTimer = setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } }, 750); killTimer.unref(); };
      const abort = () => { failure = error('Opération interrompue.'); terminate(); };
      const finish = (cause, code) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (!failure) clearTimeout(killTimer); if (cause || failure) reject(failure || cause); else resolve({ code, stdout: output }); };
      const timer = setTimeout(abort, timeoutMs); timer.unref();
      try { child = this.spawn(binary, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true }); } catch (cause) { finish(cause); return; }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on('data', chunk => { length += chunk.length; if (length > MAX_OUTPUT) { failure = error('La réponse du client est trop volumineuse.'); terminate(); } else if (capture) output += chunk.toString('utf8'); });
      child.stderr.on('data', () => { /* Client diagnostics may contain authorization URLs or secrets. */ });
      child.once('error', cause => finish(cause)); child.once('close', code => finish(null, code));
    });
  }

  async close() { this.closed = true; for (const operation of this.active.values()) operation.controller.abort(); await Promise.allSettled([...this.active.values()].map(operation => operation.completion)); }
}
