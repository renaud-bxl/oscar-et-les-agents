import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat, writeFile, unlink, mkdtemp, open, lstat, rm } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { StringDecoder } from 'node:string_decoder';
import { isTrustedReadPlan, READ_ONLY_SERVICES } from './connectors.mjs';
import {INHERITED_APPS,isSafeInheritedAppId,isSafeInheritedToolName} from './connector-clients.mjs';
import {createClaudeReadSession} from './claude-read-session.mjs';
import {codexArguments} from './codex-compat.mjs';

const NAMES = { codex: 'Codex · ChatGPT', claude: 'Claude Code' };
const FALLBACKS = {
  codex: ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
  claude: ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
};
export const MAX_AGENT_TIMEOUT_MS = 12 * 60 * 1000;
const RUN_TIMEOUT = MAX_AGENT_TIMEOUT_MS;
const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_LINE = 8 * 1024 * 1024;
const trustedConnectorReadReceipts=new WeakSet();
export const isTrustedConnectorReadReceipt=value=>Boolean(value&&typeof value==='object'&&trustedConnectorReadReceipts.has(value));

function connectorReadReceipt(plan,client,successfulTools){
  // Execution metadata only. Tool inputs, results and event IDs never enter a
  // receipt. This proves access, not the accuracy or freshness of the answer.
  const tools=Object.freeze([...successfulTools].map(([name,successfulCalls])=>Object.freeze({name,successfulCalls})));
  const receipt=Object.freeze({client,service:plan.type,name:plan.name,displayName:plan.displayName||INHERITED_APPS[plan.type]?.displayName||plan.name,
    ...(plan.appId?{appId:plan.appId}:{}),successfulCalls:tools.reduce((sum,tool)=>sum+tool.successfulCalls,0),tools});
  trustedConnectorReadReceipts.add(receipt);
  return receipt;
}

function childEnvironment() {
  const env = { ...process.env, NO_COLOR: '1' };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDECODE']) delete env[key];
  // Keep normal subscription login; do not inherit switches to paid API providers.
  for (const key of Object.keys(env)) if (/^CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$/.test(key)) delete env[key];
  return env;
}

function providerFailure(provider, code, message, { recoverable = false, action = 'review-output', name = 'Error' } = {}) {
  return Object.assign(new Error(message), { name, code, ...(Object.hasOwn(NAMES, provider) ? { provider } : {}), recoverable, action });
}

function abortError() {
  return providerFailure(null, 'PROVIDER_CANCELLED', 'Mission arrêtée.', { name: 'AbortError', action: 'none' });
}

function assertActive(signal) {
  if (signal?.aborted) throw abortError();
}

function timeoutError(duration, provider) {
  const label = duration % 60000 === 0 ? `${duration / 60000} minute${duration === 60000 ? '' : 's'}` : duration >= 1000 ? `${(duration / 1000).toLocaleString('fr-FR')} s` : `${duration} ms`;
  return providerFailure(provider, 'PROVIDER_TIMEOUT', `Le moteur a dépassé le délai de ${label} pour cet appel. L’appel a été arrêté ; les fichiers déjà créés sont conservés.`, { name: 'TimeoutError', recoverable: true, action: 'repair' });
}

function publicError(provider, detail = '', fallback = 'Le moteur a interrompu la mission. Réessayez après avoir vérifié sa connexion.') {
  const name = NAMES[provider] ?? 'Le moteur';
  // This CLI warning is explicitly non-fatal and occurs even for --help. It is
  // not evidence that a task or a tool requested broader permissions.
  detail = String(detail).replace(/^WARNING: proceeding, even though we could not update PATH:[^\r\n]*/gmu, '');
  if (detail.includes('connector_scope_missing')) return providerFailure(provider, 'CONNECTOR_PERMISSIONS', 'La connexion existante au service ne possède pas les autorisations nécessaires pour cette consultation. Vérifiez ses autorisations dans ChatGPT ou Claude ; aucun nouvel accès n’a été demandé automatiquement.', { action: 'review-permissions' });
  if (detail.includes('connector_read_failed')) return providerFailure(provider, 'CONNECTOR_UNAVAILABLE', 'Le service n’a pas confirmé la lecture demandée. Les éventuels fichiers partiels sont conservés. Vérifiez la connexion du service dans votre client officiel avant de réessayer.', { action: 'check-connection' });
  if (detail.includes('connector_no_read')) return providerFailure(provider, 'CONNECTOR_NO_READ', 'Aucune lecture du service sélectionné n’a été confirmée. La réponse du moteur n’est pas présentée comme une consultation de votre compte.', { action: 'check-connection' });
  if (/oauth.{0,80}(expired|expire|revoked|invalid)|token.{0,80}(expired|expire|revoked)|authentication_error|unauthorized|not.?logged.?in|not authenticated|invalid_api_key|login required|\b401\b/i.test(detail)) {
    return providerFailure(provider, 'PROVIDER_AUTH_REQUIRED', `${name} : connexion expirée ou absente. Reconnectez-vous dans ${provider === 'claude' ? 'Claude Code avec « claude auth login »' : 'Codex avec « codex login »'}, puis relancez la mission.`, { action: 'reconnect' });
  }
  if (/rate.?limit|usage.?limit|quota|\b429\b|insufficient_quota/i.test(detail)) return providerFailure(provider, 'PROVIDER_USAGE_LIMIT', `${name} : limite d’utilisation atteinte. Réessayez lorsque votre abonnement autorise de nouvelles missions.`, { action: 'wait' });
  if (/permission[_ ]denied|permissions? (?:required|refused|rejected)|approval[_ ]required|requires? (?:an? )?(?:approval|permission)|(?:blocked|rejected).{0,60}(?:approval|sandbox)|sandbox (?:denied|violation|restriction)|denied by (?:the )?sandbox|operation not permitted|access denied|\bEACCES\b|\bEPERM\b/i.test(detail)) return providerFailure(provider, 'PROVIDER_PERMISSION_REQUIRED', `${name} : une action dépasse les permissions autorisées. La mission a été arrêtée sans élargir les accès.`, { action: 'review-permissions' });
  if (/\b(?:tool|outil)\b.{0,80}(?:unavailable|not available|not found|not supported|indisponible)|(?:unknown|unsupported) tool\b/i.test(detail)) return providerFailure(provider, 'PROVIDER_TOOL_UNAVAILABLE', `${name} : l’outil nécessaire n’est pas disponible dans ce moteur. Vérifiez les outils du client officiel ou choisissez un autre moteur.`, { action: 'review-tools' });
  if (detail === 'unsupported' || /unknown (?:option|argument)|unrecognized (?:option|argument)|unexpected argument|unsupported (?:option|argument|version)|invalid (?:value|choice).{0,80}--/i.test(detail)) return providerFailure(provider, 'PROVIDER_UNSUPPORTED', `${name} : cette version du logiciel ne prend pas en charge les options nécessaires. Mettez le CLI à jour.`, { action: 'update-engine' });
  if (/\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b|connection (?:reset|closed|refused)|network (?:error|unavailable)|stream (?:disconnected|closed unexpectedly)|temporar(?:y|ily) (?:unavailable|overloaded)|server (?:overloaded|unavailable)|\b(?:HTTP|status(?: code)?)\s*[:=]?\s*(?:502|503|504)\b/i.test(detail)) return providerFailure(provider, 'PROVIDER_NETWORK', `${name} : le service est momentanément indisponible ou la connexion a été interrompue. Les fichiers déjà créés sont conservés.`, { recoverable: true, action: 'retry' });
  return providerFailure(provider, 'PROVIDER_UNAVAILABLE', `${name} : ${fallback}`, { action: 'check-connection' });
}

export async function findBinary(provider) {
  const candidates = [join(PROJECT_ROOT, '.tools', 'node_modules', '.bin', provider), ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, provider))];
  candidates.push(...FALLBACKS[provider]);
  if (provider === 'claude' && process.env.HOME) candidates.push(join(process.env.HOME, '.local/bin/claude'));
  for (const file of [...new Set(candidates)]) {
    try {
      await access(file, constants.X_OK);
      if ((await stat(file)).isFile()) return file;
    } catch { /* Try the next installed location. */ }
  }
  return null;
}

// Every child owns a process group. Cancelling one agent never signals other CLIs.
function execute(binary, args, { cwd, input = '', signal, timeout = RUN_TIMEOUT, onChunk, maxOutput = MAX_OUTPUT, claudeReadPlan } = {}) {
  assertActive(signal);
  const readSession=claudeReadPlan?createClaudeReadSession({plan:claudeReadPlan,input,preflightTimeoutMs:Math.min(timeout,30000)}):null;
  return new Promise((resolvePromise, reject) => {
    let child;
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let failure;
    let finished = false;
    let killTimer;
    const stopGroup = killSignal => {
      if (!child?.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch { /* The child may already have exited. */ }
    };
    const fail = error => {
      if (failure || finished) return;
      failure = error;
      readSession?.dispose();
      stopGroup('SIGTERM');
      killTimer = setTimeout(() => stopGroup('SIGKILL'), 750);
    };
    const onAbort = () => fail(abortError());
    const timer = setTimeout(() => fail(timeoutError(timeout)), timeout);
    timer.unref();
    const cleanup = () => {
      finished = true;
      readSession?.dispose();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // Keep the escalation after cancellation even when the parent exits first.
      if (!failure) clearTimeout(killTimer);
    };
    try {
      child = spawn(binary, args, { cwd, env: {...childEnvironment(),...(readSession?{ENABLE_TOOL_SEARCH:'false'}:{})}, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxOutput) {
        fail(providerFailure(null, 'PROVIDER_OUTPUT_LIMIT', 'La sortie du moteur dépasse la taille autorisée. La mission a été arrêtée.'));
        return;
      }
      if(readSession){
        try{readSession.push(chunk,onChunk);}catch(error){fail(error);}
      }else if (onChunk) {
        try { onChunk(chunk); } catch (error) { fail(error); }
      } else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-24000); });
    child.stdin.on('error', () => { /* Early exits can close stdin before its write finishes. */ });
    child.once('error', error => { cleanup(); reject(failure ?? error); });
    child.once('close', (code, exitSignal) => {
      if(readSession&&!failure)try{readSession.finish(onChunk);}catch(error){failure=error;}
      cleanup();
      if (failure) reject(failure);
      else resolvePromise({ stdout, stderr, code, exitSignal });
    });
    if(readSession){try{readSession.start(child.stdin,fail);}catch(error){fail(error);}}
    else child.stdin.end(input);
  });
}

function hasFlag(help, flag) {
  return help.includes(flag);
}

function compatibleClaude(version) {
  const parts = version.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if (!parts) return false;
  return parts[0] > 2 || (parts[0] === 2 && (parts[1] > 1 || (parts[1] === 1 && parts[2] >= 248)));
}

async function inspect(provider, signal) {
  assertActive(signal);
  const binary = await findBinary(provider);
  if (!binary) return { id: provider, name: NAMES[provider], available: false, version: null, message: `${NAMES[provider]} n’est pas installé.` };
  const options = { cwd: process.env.TMPDIR || '/tmp', timeout: 10000, signal, maxOutput: 256 * 1024 };
  const versionResult = await execute(binary, ['--version'], options);
  const version = versionResult.stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? null;
  const helpResult = await execute(binary, provider === 'codex' ? ['exec', '--help'] : ['--help'], options);
  const help = helpResult.stdout;
  const searchFlag = provider === 'codex' && (await execute(binary, ['--help'], options)).stdout.includes('--search');
  const requiredFlags = provider === 'codex'
    ? ['--json', '--sandbox', '--color', '--skip-git-repo-check']
    : ['--restricted', '--output-format', '--verbose', '--permission-mode', '--tools', '--allowedTools', '--strict-mcp-config'];
  const available = versionResult.code === 0 && helpResult.code === 0 && requiredFlags.every(flag => hasFlag(help, flag)) && (provider !== 'claude' || compatibleClaude(version ?? ''));
  const info = { id: provider, name: NAMES[provider], available, version, binary, help, searchFlag };
  if (!available) info.message = `${NAMES[provider]} est installé, mais sa version doit être mise à jour pour les protections requises.`;
  return info;
}

export async function detectProviders() {
  return Promise.all(['codex', 'claude'].map(async provider => {
    try {
      const info = await inspect(provider);
      const { binary, help, searchFlag, ...safe } = info;
      if (!safe.available) return safe;
      const result = await execute(binary, provider === 'codex' ? codexArguments(['login', 'status']) : ['auth', 'status'], { cwd: process.env.TMPDIR || '/tmp', timeout: 10000, maxOutput: 64000 });
      let loggedIn = null;
      let method;
      if (provider === 'codex') {
        const output = result.stdout + result.stderr;
        if (/Logged in using ChatGPT/i.test(output)) { loggedIn = true; method = 'chatgpt'; }
        else if (/not logged in/i.test(output)) loggedIn = false;
        else if (/api key/i.test(output)) { loggedIn = false; method = 'api'; }
      } else {
        try {
          const status = JSON.parse(result.stdout);
          if (typeof status.loggedIn === 'boolean') loggedIn = status.loggedIn;
          if (/^(oauth|claude[._]ai|subscription)$/i.test(status.authMethod ?? '')) method = 'subscription';
          if (/api.?key/i.test(status.authMethod ?? '')) { loggedIn = false; method = 'api'; }
        } catch { /* An unknown status is not proof of an active login. */ }
      }
      safe.auth = { loggedIn, ...(method ? { method } : {}) };
      safe.message = loggedIn === true
        ? 'Connexion enregistrée ; sa validité sera confirmée au lancement d’une mission.'
        : loggedIn === false
          ? (method === 'api' ? 'Connexion par clé API détectée. Connectez le CLI à votre abonnement pour utiliser cet atelier.' : 'Connexion à l’abonnement nécessaire dans le CLI.')
          : 'CLI installé ; état de connexion à vérifier au lancement d’une mission.';
      return safe;
    } catch {
      return { id: provider, name: NAMES[provider], available: false, version: null, message: 'Impossible de vérifier le CLI. Vérifiez son installation et sa connexion.' };
    }
  }));
}

function jsonLines(consume) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const flush = final => {
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      if (line) parse(line);
    }
    if (pending.length > MAX_LINE) throw providerFailure(null, 'PROVIDER_OUTPUT_LIMIT', 'Le flux JSON du moteur dépasse la taille autorisée.');
    if (final && pending.trim()) { parse(pending.trim()); pending = ''; }
  };
  const parse = line => {
    if (line.length > MAX_LINE) throw providerFailure(null, 'PROVIDER_OUTPUT_LIMIT', 'Le flux JSON du moteur dépasse la taille autorisée.');
    let event;
    try { event = JSON.parse(line); } catch { throw providerFailure(null, 'PROVIDER_OUTPUT_INVALID', 'Le moteur a renvoyé un flux JSON invalide ou incomplet.'); }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') throw providerFailure(null, 'PROVIDER_OUTPUT_INVALID', 'Le moteur a renvoyé un événement JSON invalide.');
    consume(event);
  };
  return {
    push(chunk) { pending += decoder.write(chunk); flush(false); },
    finish() { pending += decoder.end(); flush(true); },
  };
}

function structuredResponse(text, schema, provider) {
  const invalid = () => providerFailure(provider, 'PROVIDER_STRUCTURED_OUTPUT_INVALID', 'Le moteur n’a pas respecté le format JSON demandé. Aucun résultat n’a été validé ; les fichiers déjà créés sont conservés.');
  // A whole JSON fence is formatting, but never extract an object from prose,
  // a tool result or an earlier message: that could turn an unfinished review
  // into an approval. Business checks still run in the orchestrator afterwards.
  const raw = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/iu, '$1').trim();
  let value;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  let nodes = 0;
  const matches = (item, rule, depth = 0) => {
    if (++nodes > 10000 || depth > 64 || !rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
    const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
    const types = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
    if (types.length && !types.some(expected => expected === type || expected === 'integer' && type === 'number' && Number.isInteger(item))) return false;
    if (Array.isArray(rule.enum) && !rule.enum.some(candidate => JSON.stringify(candidate) === JSON.stringify(item))) return false;
    if (type === 'object') {
      if (Array.isArray(rule.required) && rule.required.some(key => !Object.hasOwn(item, key))) return false;
      for (const key of Object.keys(item)) {
        if (rule.properties && Object.hasOwn(rule.properties, key)) { if (!matches(item[key], rule.properties[key], depth + 1)) return false; }
        else if (rule.additionalProperties === false) return false;
      }
    } else if (type === 'array') {
      if (Number.isInteger(rule.minItems) && item.length < rule.minItems || Number.isInteger(rule.maxItems) && item.length > rule.maxItems) return false;
      if (rule.items && item.some(child => !matches(child, rule.items, depth + 1))) return false;
    } else if (type === 'string') {
      const length = [...item].length;
      if (Number.isInteger(rule.minLength) && length < rule.minLength || Number.isInteger(rule.maxLength) && length > rule.maxLength) return false;
      if (typeof rule.pattern === 'string' && !new RegExp(rule.pattern, 'u').test(item)) return false;
    }
    return true;
  };
  try { if (!matches(value, schema)) throw invalid(); } catch { throw invalid(); }
  return JSON.stringify(value);
}

async function finalMessage(file) {
  const invalid = () => providerFailure('codex', 'PROVIDER_OUTPUT_INVALID', 'Codex · ChatGPT : la réponse finale n’a pas pu être lue de façon sûre. Aucun résultat n’a été validé.');
  let handle;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_LINE) throw invalid();
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino || info.size > MAX_LINE) throw invalid();
    // Read exactly the confirmed byte count; a growing output file must never
    // turn a bounded stat into an unbounded readFile allocation.
    const bytes = Buffer.alloc(info.size);
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw invalid();
      offset += bytesRead;
    }
    const after = await handle.stat(), current = await lstat(file);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.dev !== info.dev || current.ino !== info.ino || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || current.size !== after.size || current.mtimeMs !== after.mtimeMs) throw invalid();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { throw invalid(); }
  finally { await handle?.close().catch(() => {}); }
}

const TOOL_LABELS = {
  Read: 'Lecture des documents', Write: 'Rédaction du livrable', Edit: 'Mise à jour du livrable', Glob: 'Recherche de fichiers', Grep: 'Recherche dans les documents', WebSearch: 'Recherche sur le Web', WebFetch: 'Lecture d’une source Web',
};

export function disabledMcpArguments(names = []) {
  if (!Array.isArray(names) || names.length > 100 || names.some(name => typeof name !== 'string' || !/^oscar-[a-z0-9][a-z0-9-]{0,55}$/.test(name))) throw new Error('La liste des connecteurs exclus est invalide.');
  return [...new Set(names)].flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]);
}

// Snapshot questions do not inherit the mission's tools. Keep transport,
// presentation and sandbox features; disable every other feature advertised by
// this CLI, including newly introduced capabilities. These are invocation-only
// overrides: no global settings, model or subscription credentials are changed.
const SNAPSHOT_PASSIVE_CODEX_FEATURES = new Set([
  'enable_request_compression', 'fast_mode', 'ultrafast_mode', 'personality',
  'guardian_approval', 'exec_permission_approvals', 'network_proxy',
  'runtime_metrics', 'responses_websocket_response_processed',
  'responses_websockets', 'responses_websockets_v2', 'remote_compaction_v2',
  'local_thread_store_compression', 'prevent_idle_sleep', 'terminal_resize_reflow',
  'use_legacy_landlock', 'use_linux_sandbox_bwrap', 'elevated_windows_sandbox',
  'experimental_windows_sandbox',
]);
const SNAPSHOT_REQUIRED_CODEX_FEATURES = ['apps', 'plugins', 'shell_tool', 'unified_exec'];
const SNAPSHOT_REMOVED_CODEX_MARKERS = new Set(['item_ids', 'resize_all_images', 'tool_search_always_defer_mcp_tools', 'tui_app_server']);
const SNAPSHOT_INACTIVE_CODEX_ALIASES = new Map([['guardianv2.thread_context','removed'],['transcript_v2','deprecated'],['web_search_cached','deprecated'],['web_search_request','deprecated']]);
const SNAPSHOT_CODE_MODE_CLOSED_WARNING = 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';
const SNAPSHOT_CLAUDE_FLAGS = [
  '--tools', '--allowedTools', '--disallowedTools', '--strict-mcp-config',
  '--mcp-config', '--no-session-persistence', '--setting-sources', '--settings',
  '--no-chrome', '--disable-slash-commands', '--safe-mode', '--permission-prompts',
];
const snapshotUnavailable = provider => providerFailure(provider, 'PROVIDER_UNSUPPORTED', `${NAMES[provider]} : ce moteur ne confirme pas les protections nécessaires pour répondre uniquement depuis l’instantané. La mission continue ; consultez son suivi ou mettez le CLI à jour.`, { action: 'update-engine' });
const snapshotToolFailure = provider => providerFailure(provider, 'PROVIDER_TOOL_UNAVAILABLE', `${NAMES[provider]} : un outil a été signalé pendant une réponse limitée à l’instantané. La réponse a été arrêtée sans élargir les permissions. La mission continue.`, { action: 'review-tools' });

function snapshotFeatures(result) {
  if (result.code !== 0 || result.exitSignal) throw snapshotUnavailable('codex');
  const rows = result.stdout.trim().split(/\r?\n/u).map(row => row.trim()).filter(Boolean);
  if (!rows.length || rows.length > 256) throw snapshotUnavailable('codex');
  const features = new Map();
  for (const row of rows) {
    const match = row.match(/^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\s+([a-z][a-z _-]*?)\s+(true|false)$/u);
    if (!match || match[1].length > 80 || features.has(match[1])) throw snapshotUnavailable('codex');
    features.set(match[1], {stage: match[2], enabled: match[3] === 'true'});
  }
  if (SNAPSHOT_REQUIRED_CODEX_FEATURES.some(name => !features.has(name) || features.get(name).stage === 'removed')) throw snapshotUnavailable('codex');
  return features;
}

function snapshotMcpServers(result) {
  if (result.code !== 0 || result.exitSignal) throw snapshotUnavailable('codex');
  let rows;
  try { rows = JSON.parse(result.stdout); } catch { throw snapshotUnavailable('codex'); }
  if (!Array.isArray(rows) || rows.length > 100) throw snapshotUnavailable('codex');
  const servers = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.name !== 'string' || !row.name.length || row.name.length > 256 || /[\u0000-\u001f\u007f]/u.test(row.name) || typeof row.enabled !== 'boolean' || servers.has(row.name)) throw snapshotUnavailable('codex');
    // Do not retain transport details, account identifiers or environment values.
    servers.set(row.name, row.enabled);
  }
  return servers;
}

async function codexSnapshotArguments(info, { cwd, signal, timeoutMs }) {
  if (!['--disable', '--ephemeral', '--strict-config'].every(flag => hasFlag(info.help, flag))) throw snapshotUnavailable('codex');
  const options = { cwd, signal, timeout: Math.min(timeoutMs, 10000), maxOutput: 256 * 1024 };
  const features = snapshotFeatures(await execute(info.binary, codexArguments(['features', 'list']), options));
  const disabled = [...features.keys()].filter(name => !SNAPSHOT_PASSIVE_CODEX_FEATURES.has(name) && !(SNAPSHOT_INACTIVE_CODEX_ALIASES.get(name) === features.get(name).stage && features.get(name).enabled === false));
  const args = [
    ...disabled.flatMap(name => ['--disable', name]),
    '-c', 'web_search="disabled"', '-c', 'tools.web_search=false', ...(!features.has('view_image') ? ['-c', 'tools.view_image=false'] : []),
    '-c', 'apps._default.enabled=false', '-c', 'project_doc_max_bytes=0', '-c', 'notify=[]',
  ];
  const confirmed = snapshotFeatures(await execute(info.binary, codexArguments([...args, 'features', 'list']), options));
  // Some removed protocol markers are pinned true. Also, current official CLIs
  // ignore user opt-outs for unified_exec: shell_tool=false is the separate
  // command-tool gate (official config reference). Keep requesting both off,
  // and tolerate the backend marker only while that gate is confirmed closed.
  const pinnedMarker = (name, value) => value.stage === 'removed' && SNAPSHOT_REMOVED_CODEX_MARKERS.has(name)
    || name === 'unified_exec' && value.stage === 'stable' && confirmed.get('shell_tool')?.enabled === false;
  if (confirmed.size !== features.size || [...confirmed].some(([name, value]) => !features.has(name) || features.get(name).stage !== value.stage || !SNAPSHOT_PASSIVE_CODEX_FEATURES.has(name) && value.enabled && !pinnedMarker(name, value))) throw snapshotUnavailable('codex');
  const servers = snapshotMcpServers(await execute(info.binary, codexArguments([...args, 'mcp', 'list', '--json']), options));
  // Empty tables merge with inherited MCP configuration. Set every exact quoted
  // key to false, then confirm the effective list instead of assuming removal.
  if (servers.size) args.push('-c', `mcp_servers={${[...servers.keys()].map(name => `${JSON.stringify(name)}={enabled=false}`).join(',')}}`);
  const confirmedServers = snapshotMcpServers(await execute(info.binary, codexArguments([...args, 'mcp', 'list', '--json']), options));
  if (confirmedServers.size !== servers.size || [...confirmedServers].some(([name, enabled]) => !servers.has(name) || enabled)) throw snapshotUnavailable('codex');
  // strict-config is accepted by exec, not metadata subcommands. The eventual
  // model launch must reject unknown security overrides before starting a turn.
  return ['--strict-config', ...args];
}

export function readConnectorArguments(plan) {
  if (plan === undefined || plan === null) return [];
  if(isTrustedReadPlan(plan)&&plan.client==='codex'&&plan.source==='chatgpt'){
    const app=INHERITED_APPS[plan.type];
    const identity=app?app.id===plan.appId&&plan.name===app.name:plan.type==='app'&&isSafeInheritedAppId(plan.appId)&&plan.name===`chatgpt-${plan.appId}`;
    if(!identity||!Array.isArray(plan.enabledTools)||!plan.enabledTools.length||plan.enabledTools.length>200||plan.enabledTools.some(tool=>!isSafeInheritedToolName(tool)||app&&!app.tools.includes(tool))||!Array.isArray(plan.disabledTools)||plan.disabledTools.some(tool=>!isSafeInheritedToolName(tool))||!Array.isArray(plan.disabledApps)||plan.disabledApps.some(id=>!isSafeInheritedAppId(id)||id===plan.appId))throw new Error('Le plan de lecture du connecteur n’a pas été vérifié.');
    const key=`apps.${plan.appId}`;
    return ['--disable','plugins','--enable','apps','-c','web_search="disabled"','-c','apps._default.enabled=false',
      ...(plan.disabledServers.length?['-c',`mcp_servers={${plan.disabledServers.map(name=>`${JSON.stringify(name)}={enabled=false}`).join(',')}}`]:[]),
      ...plan.disabledApps.flatMap(id=>['-c',`apps.${id}.enabled=false`]),
      '-c',`${key}.enabled=true`,'-c',`${key}.default_tools_enabled=false`,'-c',`${key}.destructive_enabled=false`,
      '-c',`${key}.tools={${[...plan.disabledTools.map(tool=>`${JSON.stringify(tool)}={enabled=false}`),...plan.enabledTools.map(tool=>`${JSON.stringify(tool)}={enabled=true,approval_mode="auto"}`)].join(',')}}`];
  }
  const service = READ_ONLY_SERVICES[plan.type];
  if (!isTrustedReadPlan(plan) || plan.client !== 'codex' || !service || plan.url !== service.url || JSON.stringify(plan.enabledTools) !== JSON.stringify(service.enabledTools)) throw new Error('Le plan de lecture du connecteur n’a pas été vérifié.');
  const serverKey = name => `mcp_servers.${name}`;
  // -c splits dotted paths even when a server's literal name contains a dot.
  // An inline TOML table preserves such an existing name as one exact key.
  const disabled = plan.disabledServers.some(name=>!/^[a-zA-Z0-9_-]+$/.test(name))
    ? ['-c',`mcp_servers={${plan.disabledServers.map(name=>`${JSON.stringify(name)}={enabled=false}`).join(',')}}`]
    : plan.disabledServers.flatMap(name=>['-c',`${serverKey(name)}.enabled=false`]);
  const key = serverKey(plan.name);
  return ['--disable','apps','-c', 'web_search="disabled"', ...disabled, '-c', `${key}.url=${JSON.stringify(service.url)}`, '-c', `${key}.enabled=true`, '-c', `${key}.required=true`, '-c', `${key}.enabled_tools=${JSON.stringify(service.enabledTools)}`, '-c', `${key}.default_tools_approval_mode="auto"`];
}

export function claudeReadConnectorArguments(plan){
  const service=READ_ONLY_SERVICES[plan?.type];
  if(!isTrustedReadPlan(plan)||plan.client!=='claude'||plan.source!=='claude.ai'||!service||plan.url!==service.url||typeof plan.runtimeName!=='string'||!plan.runtimeName.length||plan.runtimeName.length>120||/[\x00-\x1f\x7f]/.test(plan.runtimeName)||!/^[a-f0-9]{64}$/.test(plan.identityHash||'')||!Array.isArray(plan.disabledTools)||plan.disabledTools.some(tool=>typeof tool!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(tool)||service.enabledTools.includes(tool))||JSON.stringify(plan.enabledTools)!==JSON.stringify(service.enabledTools))throw new Error('Le plan de lecture du connecteur n’a pas été vérifié.');
  const namespace=plan.runtimeName.replace(/[^a-zA-Z0-9_-]/g,'_'),allowed=plan.enabledTools.map(tool=>`mcp__${namespace}__${tool}`);
  const disabled=plan.disabledServers.map(name=>({serverName:name}));
  const deniedTools=[...plan.disabledTools.map(tool=>`mcp__${namespace}__${tool}`),...plan.disabledServers.map(name=>`mcp__${name.replace(/[^a-zA-Z0-9_-]/g,'_')}__*`)];
  return {allowed,args:['--settings',JSON.stringify({allowedMcpServers:[{serverUrl:plan.url}],deniedMcpServers:disabled,permissions:{defaultMode:'dontAsk',allow:allowed,deny:deniedTools}})]};
}

async function runAgentInternal({ provider, cwd, prompt, schema, signal, onActivity, readOnly = false, snapshotOnly = false, disabledMcpNames = [], connectorPlan, reasoningEffort, timeoutMs = RUN_TIMEOUT }) {
  const id = typeof provider === 'string' ? provider : provider?.id;
  if (!Object.hasOwn(NAMES, id)) throw new Error('Moteur inconnu. Choisissez Codex ou Claude.');
  if (connectorPlan && (!isTrustedReadPlan(connectorPlan)||connectorPlan.client!==id)) throw new Error('Le plan de lecture ne correspond pas au moteur de cette mission.');
  if (typeof cwd !== 'string' || !cwd || typeof prompt !== 'string' || !prompt.trim()) throw new Error('Un dossier de travail et une mission sont nécessaires.');
  assertActive(signal);
  const directory = resolve(cwd);
  if (!(await stat(directory)).isDirectory()) throw new Error('Le dossier de la mission est introuvable.');
  let info;
  try { info = await inspect(id, signal); } catch (error) {
    if (['AbortError','TimeoutError'].includes(error.name)) throw error;
    if (['EACCES','EPERM'].includes(error.code)) throw publicError(id, error.code);
    throw publicError(id, '', 'Impossible de démarrer le CLI. Vérifiez son installation.');
  }
  if (!info.available) throw providerFailure(id, info.binary ? 'PROVIDER_UNSUPPORTED' : 'PROVIDER_NOT_INSTALLED', info.message, { action: info.binary ? 'update-engine' : 'install-engine' });
  let schemaFile;
  let outputDirectory;
  let outputFile;
  let schemaText;
  if (schema !== undefined) {
    try { schemaText = JSON.stringify(schema); } catch { throw new Error('Le schéma de réponse est invalide.'); }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !schemaText || schemaText.length > 256000) throw new Error('Le schéma de réponse est invalide.');
  }
  const activity = label => { try { onActivity?.(label); } catch { /* UI callbacks do not control the CLI. */ } };
  let text = '';
  let explicitFinalMessage = false;
  let usage;
  let terminal = false;
  let terminalFailure = false;
  let failureDetail = '';
  let snapshotToolsConfirmed = false;
  let snapshotCodeModeClosed = false;
  let connectorReadConfirmed=false;
  const connectorToolCalls=new Map(),successfulConnectorEvents=new Set(),successfulConnectorTools=new Map();
  const capturedConnectorTools=new Map(connectorPlan?.source==='chatgpt'?connectorPlan.executionTools.map(binding=>[binding.name,binding.tool]):(connectorPlan?.enabledTools||[]).map(tool=>[tool,tool]));
  const expectedConnectorServer=connectorPlan?.source==='chatgpt'?'codex_apps':connectorPlan?.name;
  const claudeConnectorTools=new Map(connectorPlan&&id==='claude'?claudeReadConnectorArguments(connectorPlan).allowed.map((name,index)=>[name,connectorPlan.enabledTools[index]]):[]);
  const recordConnectorResult=(tool,eventId,failed,payload)=>{
    if(!failed){
      if(typeof eventId==='string'&&successfulConnectorEvents.has(eventId))return;
      if(typeof eventId==='string')successfulConnectorEvents.add(eventId);
      successfulConnectorTools.set(tool,(successfulConnectorTools.get(tool)||0)+1);
      connectorReadConfirmed=true;return;
    }
    terminalFailure=true;
    // Only retain a fixed error category, never the service response/account.
    const detail=JSON.stringify(payload??'').slice(0,16000);
    failureDetail+=/missing permissions or scopes|required scopes|insufficient[_ ](?:scope|permissions)|permission[_ ]denied/i.test(detail)?' connector_scope_missing':' connector_read_failed';
  };
  const stream = jsonLines(event => {
    if (terminal) return;
    if (snapshotOnly) {
      if (id === 'codex' && /^item\./u.test(event.type)) {
        if (!['reasoning', 'agent_message', 'error'].includes(event.item?.type)) throw snapshotToolFailure(id);
        // An exec error item is a passive diagnostic, never an attempted tool.
        // Keep its failure category while discarding any unconfirmed answer.
        if (event.item.type === 'error' && !(snapshotCodeModeClosed && event.item.message === SNAPSHOT_CODE_MODE_CLOSED_WARNING)) {
          terminalFailure = true;
          failureDetail += typeof event.item.message === 'string' ? event.item.message.slice(0, 16000) : '';
        }
      }
      if (id === 'claude') {
        if (event.type === 'system' && event.subtype === 'init') {
          if (!Array.isArray(event.tools) || event.tools.length || !Array.isArray(event.mcp_servers) || event.mcp_servers.length || event.plugins !== undefined && (!Array.isArray(event.plugins) || event.plugins.length)) throw snapshotToolFailure(id);
          snapshotToolsConfirmed = true;
        }
        if (event.type === 'assistant' && (!snapshotToolsConfirmed || !Array.isArray(event.message?.content) || event.message.content.some(block => !block || !['text', 'thinking', 'redacted_thinking'].includes(block.type)))) throw snapshotToolFailure(id);
        if (['tool_progress', 'tool_use_summary'].includes(event.type)) throw snapshotToolFailure(id);
      }
    }
    if (id === 'codex') {
      if (event.type === 'turn.started') activity('Prise en charge de la mission');
      if (event.type === 'item.started') {
        const labels = { command_execution: 'Travail dans le dossier autorisé', file_change: 'Mise à jour du livrable', web_search: 'Recherche sur le Web', mcp_tool_call: 'Consultation d’un outil' };
        if (labels[event.item?.type]) activity(labels[event.item.type]);
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        const phase = event.item.phase;
        if (phase === 'final_answer') { text = event.item.text; explicitFinalMessage = true; }
        else if (phase == null && !explicitFinalMessage) text = event.item.text;
        // Commentary, including JSON-looking commentary, is never a verdict.
      }
      if (connectorPlan && event.type === 'item.completed' && event.item?.type === 'mcp_tool_call') {
        const item = event.item;
        // codex exec preserves the raw server/tool pair. Display namespaces and
        // suffixes are not identity: another app can declare the same action.
        const selected=item.server===expectedConnectorServer?capturedConnectorTools.get(item.tool):undefined;
        if (selected) recordConnectorResult(selected,item.id,item.status!=='completed'||item.error!=null||item.result?.isError===true||!item.result||!Array.isArray(item.result.content),item.error??item.result);
      }
      if (event.type === 'error') { terminalFailure=true;failureDetail += JSON.stringify(event); }
      if (event.type === 'turn.failed') { terminal = true; terminalFailure = true; failureDetail += JSON.stringify(event); }
      if (event.type === 'turn.completed') { terminal = true; usage = event.usage; }
    } else {
      if (event.type === 'system' && event.subtype === 'init') activity('Prise en charge de la mission');
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'tool_use' && TOOL_LABELS[block.name]) activity(TOOL_LABELS[block.name]);
          if(connectorPlan&&block.type==='tool_use'&&typeof block.id==='string'&&claudeConnectorTools.has(block.name)){
            if(!connectorToolCalls.has(block.id)&&!successfulConnectorEvents.has(block.id))connectorToolCalls.set(block.id,claudeConnectorTools.get(block.name));
            activity('Consultation d’un outil');
          }
          if (block.type === 'text' && typeof block.text === 'string') text = block.text;
        }
        if (event.error) failureDetail += JSON.stringify(event);
      }
      if(connectorPlan&&event.type==='user')for(const block of event.message?.content??[]){
        if(block.type==='tool_result'&&connectorToolCalls.has(block.tool_use_id)){
          const tool=connectorToolCalls.get(block.tool_use_id);connectorToolCalls.delete(block.tool_use_id);
          recordConnectorResult(tool,block.tool_use_id,block.is_error===true,block.content);
        }
      }
      if (event.type === 'result') {
        terminal = true;
        terminalFailure ||= event.is_error === true || event.subtype !== 'success';
        usage = event.usage;
        if (event.structured_output && typeof event.structured_output === 'object') text = JSON.stringify(event.structured_output);
        else if (typeof event.result === 'string') text = event.result;
        if (terminalFailure) failureDetail += JSON.stringify(event);
        if (event.permission_denials?.length) { terminalFailure = true; failureDetail += ' permission denied'; }
      }
    }
  });
  try {
    let args;
    if (id === 'codex') {
      // Live search is a hosted tool; shell networking stays within its sandbox.
      const searchArgs = connectorPlan || snapshotOnly ? [] : info.searchFlag ? ['--search'] : ['-c', 'web_search="live"'];
      const snapshotArgs = snapshotOnly ? await codexSnapshotArguments(info, { cwd: directory, signal, timeoutMs }) : [];
      snapshotCodeModeClosed = snapshotArgs.some((value, index) => value === '--disable' && snapshotArgs[index + 1] === 'code_mode_host');
      args = ['-a', 'never', ...searchArgs, ...(!connectorPlan && !snapshotOnly?['--disable','apps']:[]), ...snapshotArgs, ...disabledMcpArguments(disabledMcpNames), ...readConnectorArguments(connectorPlan), ...(reasoningEffort ? ['-c', `model_reasoning_effort="${reasoningEffort}"`] : []), 'exec', '--json', '--color', 'never', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--cd', directory, '--skip-git-repo-check', ...(snapshotOnly ? ['--ephemeral'] : [])];
      if (schemaText) {
        if (!hasFlag(info.help, '--output-schema')) throw publicError(id, 'unsupported');
        const newSchemaFile = join(directory, `.oscar-schema-${randomUUID()}.json`);
        await writeFile(newSchemaFile, schemaText, { flag: 'wx', mode: 0o600 });
        schemaFile = newSchemaFile;
        args.push('--output-schema', schemaFile);
        if (hasFlag(info.help, '--output-last-message')) {
          outputDirectory = await mkdtemp(join(tmpdir(), 'oscar-final-response-'));
          outputFile = join(outputDirectory, 'final.json');
          await writeFile(outputFile, '', { flag: 'wx', mode: 0o600 });
          args.push('--output-last-message', outputFile);
        }
      }
      args.push('-');
      args = codexArguments(args);
    } else {
      if (snapshotOnly && !SNAPSHOT_CLAUDE_FLAGS.every(flag => hasFlag(info.help, flag))) throw snapshotUnavailable(id);
      const tools = snapshotOnly ? [] : readOnly ? ['Read', 'Glob', 'Grep',...(!connectorPlan?['WebSearch','WebFetch']:[])] : ['Read', 'Write', 'Edit', 'Glob', 'Grep',...(!connectorPlan?['WebSearch','WebFetch']:[])];
      const inherited=connectorPlan?claudeReadConnectorArguments(connectorPlan):null;
      const canDenyPrompts = hasFlag(info.help, '--permission-prompts');
      const permissionMode = connectorPlan || snapshotOnly ? 'dontAsk' : canDenyPrompts ? (/"manual"/.test(info.help) ? 'manual' : 'default') : 'dontAsk';
      args = ['-p', '--restricted', '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode, '--tools', tools.join(','), '--allowedTools', [...tools,...(inherited?.allowed||[])].join(','),...(inherited?inherited.args:['--strict-mcp-config'])];
      if(inherited)args.push('--input-format','stream-json','--no-session-persistence','--setting-sources','','--no-chrome','--disable-slash-commands');
      if(snapshotOnly)args.push('--mcp-config','{"mcpServers":{}}','--disallowedTools','mcp__*','--no-session-persistence','--setting-sources','','--no-chrome','--disable-slash-commands','--safe-mode','--settings',JSON.stringify({disableAllHooks:true,autoMemoryEnabled:false,permissions:{defaultMode:'dontAsk',allow:[],deny:['mcp__*']}}));
      if (canDenyPrompts) args.push('--permission-prompts', 'none');
      if (schemaText) {
        if (!hasFlag(info.help, '--json-schema')) throw publicError(id, 'unsupported');
        args.push('--json-schema', schemaText);
      }
    }
    assertActive(signal);
    activity('Démarrage de l’agent');
    const input = snapshotOnly ? `Réponds uniquement depuis l’instantané de mission fourni ci-dessous. Aucun outil n’est nécessaire ni autorisé. Ne lis aucun fichier, compte, calendrier ou message ; ne lance aucune commande ni recherche. Ne modifie, n’approuve et ne relance aucune tâche. Signale ce que l’instantané ne permet pas de savoir.\n\n${prompt}` : schemaText ? `${prompt}\n\nFORMAT DE LA RÉPONSE FINALE\nRéponds uniquement avec un JSON valide conforme au schéma ci-dessous, sans phrase autour, sans liste Markdown et sans bloc de code. Ce format ne change ni la mission ni ses autorisations. N’invente aucun résultat pour satisfaire le schéma : conserve les refus, les limites et les corrections réellement nécessaires.\n${schemaText}` : prompt;
    const result = await execute(info.binary, args, { cwd: directory, input, signal, timeout: timeoutMs, onChunk: stream.push, ...(snapshotOnly ? {maxOutput:256*1024} : {}), ...(id==='claude'&&connectorPlan?{claudeReadPlan:connectorPlan}:{}) });
    stream.finish();
    const diagnostic = `${failureDetail}\n${result.stderr}`;
    if (result.code !== 0 || result.exitSignal || terminalFailure) throw publicError(id, diagnostic);
    if (snapshotOnly && id === 'claude' && !snapshotToolsConfirmed) throw snapshotUnavailable(id);
    if (!terminal) throw providerFailure(id, 'PROVIDER_NO_RESULT', `${NAMES[id]} : La réponse a été interrompue avant sa confirmation finale. Aucun résultat n’a été validé.`);
    if(connectorPlan&&!connectorReadConfirmed)throw publicError(id,'connector_no_read');
    if (outputFile) { assertActive(signal); text = await finalMessage(outputFile); assertActive(signal); }
    if (!text.trim()) throw providerFailure(id, 'PROVIDER_NO_RESULT', `${NAMES[id]} : Le moteur a terminé sans livrable lisible.`);
    if (schemaText) text = structuredResponse(text, JSON.parse(schemaText), id);
    return { text, ...(usage && typeof usage === 'object' ? { usage } : {}),...(connectorPlan?{connectorReadReceipt:connectorReadReceipt(connectorPlan,id,successfulConnectorTools)}:{}) };
  } catch (error) {
    if (['AbortError', 'TimeoutError'].includes(error.name)) throw error;
    if (error.code === 'ENOENT') throw providerFailure(id, 'PROVIDER_NOT_INSTALLED', `${NAMES[id]} : Le CLI est introuvable. Vérifiez son installation.`, { action: 'install-engine' });
    if (['EACCES','EPERM'].includes(error.code)) throw publicError(id, error.code);
    throw error;
  } finally {
    if (schemaFile) await unlink(schemaFile).catch(() => {});
    if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runAgent(options) {
  const provider=typeof options.provider === 'string' ? options.provider : options.provider?.id;
  if(options.snapshotOnly!==undefined&&typeof options.snapshotOnly!=='boolean')throw providerFailure(provider,'PROVIDER_REQUEST_INVALID','Le mode de consultation de l’instantané est invalide.');
  if(options.snapshotOnly&&(options.connectorPlan!=null||options.schema!==undefined))throw providerFailure(provider,'PROVIDER_REQUEST_INVALID','Une question sur l’instantané ne peut pas utiliser de connecteur ni de schéma de fichier.');
  if(options.reasoningEffort!==undefined&&(provider!=='codex'||!['medium','high'].includes(options.reasoningEffort)))throw providerFailure(provider,'PROVIDER_REQUEST_INVALID','Le réglage de réflexion doit être medium ou high et ne concerne que Codex.');
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_AGENT_TIMEOUT_MS) throw new Error('Le délai d’un appel doit être compris entre 1 ms et 12 minutes.');
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  try {
    return await runAgentInternal({ ...options, ...(options.snapshotOnly ? {readOnly:true} : {}), timeoutMs, signal });
  } catch (error) {
    if (deadline.signal.aborted && !options.signal?.aborted) {
      throw timeoutError(timeoutMs, provider);
    }
    if (/^(?:PROVIDER|CONNECTOR)_[A-Z_]+$/u.test(error.code || '') && Object.hasOwn(NAMES, provider)) error.provider=provider;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
