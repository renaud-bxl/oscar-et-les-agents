import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat, writeFile, unlink } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { StringDecoder } from 'node:string_decoder';
import { isTrustedReadPlan, READ_ONLY_SERVICES } from './connectors.mjs';

const NAMES = { codex: 'Codex · ChatGPT', claude: 'Claude Code' };
const FALLBACKS = {
  codex: ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
  claude: ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
};
export const MAX_AGENT_TIMEOUT_MS = 12 * 60 * 1000;
const RUN_TIMEOUT = MAX_AGENT_TIMEOUT_MS;
const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_LINE = 8 * 1024 * 1024;

function childEnvironment() {
  const env = { ...process.env, NO_COLOR: '1' };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDECODE']) delete env[key];
  // Keep normal subscription login; do not inherit switches to paid API providers.
  for (const key of Object.keys(env)) if (/^CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$/.test(key)) delete env[key];
  return env;
}

function abortError() {
  return Object.assign(new Error('Mission arrêtée.'), { name: 'AbortError' });
}

function assertActive(signal) {
  if (signal?.aborted) throw abortError();
}

function timeoutError(duration) {
  const label = duration % 60000 === 0 ? `${duration / 60000} minute${duration === 60000 ? '' : 's'}` : duration >= 1000 ? `${(duration / 1000).toLocaleString('fr-FR')} s` : `${duration} ms`;
  return Object.assign(new Error(`Le moteur a dépassé le délai de ${label} pour cet appel. L’appel a été arrêté ; les fichiers déjà créés sont conservés.`), { name: 'TimeoutError' });
}

function publicError(provider, detail = '', fallback = 'Le moteur a interrompu la mission. Réessayez après avoir vérifié sa connexion.') {
  const name = NAMES[provider] ?? 'Le moteur';
  if (/oauth.{0,80}(expired|expire|revoked|invalid)|token.{0,80}(expired|expire|revoked)|authentication_error|unauthorized|not.?logged.?in|not authenticated|invalid_api_key|login required|401/i.test(detail)) {
    return new Error(`${name} : connexion expirée ou absente. Reconnectez-vous dans ${provider === 'claude' ? 'Claude Code avec « claude auth login »' : 'Codex avec « codex login »'}, puis relancez la mission.`);
  }
  if (/rate.?limit|usage.?limit|quota|429|insufficient_quota/i.test(detail)) return new Error(`${name} : limite d’utilisation atteinte. Réessayez lorsque votre abonnement autorise de nouvelles missions.`);
  if (/permission|sandbox|operation not permitted|access denied|EACCES/i.test(detail)) return new Error(`${name} : une action dépasse les permissions autorisées. La mission a été arrêtée sans élargir les accès.`);
  if (/unknown (option|argument)|unrecognized|unexpected argument|unsupported|invalid value|invalid choice/i.test(detail)) return new Error(`${name} : cette version du logiciel ne prend pas en charge les options nécessaires. Mettez le CLI à jour.`);
  return new Error(`${name} : ${fallback}`);
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
function execute(binary, args, { cwd, input = '', signal, timeout = RUN_TIMEOUT, onChunk, maxOutput = MAX_OUTPUT } = {}) {
  assertActive(signal);
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
      stopGroup('SIGTERM');
      killTimer = setTimeout(() => stopGroup('SIGKILL'), 750);
      killTimer.unref();
    };
    const onAbort = () => fail(abortError());
    const timer = setTimeout(() => fail(timeoutError(timeout)), timeout);
    timer.unref();
    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // Keep the escalation after cancellation even when the parent exits first.
      if (!failure) clearTimeout(killTimer);
    };
    try {
      child = spawn(binary, args, { cwd, env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
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
        fail(new Error('La sortie du moteur dépasse la taille autorisée. La mission a été arrêtée.'));
        return;
      }
      if (onChunk) {
        try { onChunk(chunk); } catch (error) { fail(error); }
      } else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-24000); });
    child.stdin.on('error', () => { /* Early exits can close stdin before its write finishes. */ });
    child.once('error', error => { cleanup(); reject(failure ?? error); });
    child.once('close', (code, exitSignal) => {
      cleanup();
      if (failure) reject(failure);
      else resolvePromise({ stdout, stderr, code, exitSignal });
    });
    child.stdin.end(input);
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
      const result = await execute(binary, provider === 'codex' ? ['login', 'status'] : ['auth', 'status'], { cwd: process.env.TMPDIR || '/tmp', timeout: 10000, maxOutput: 64000 });
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
    if (pending.length > MAX_LINE) throw new Error('Le flux JSON du moteur dépasse la taille autorisée.');
    if (final && pending.trim()) { parse(pending.trim()); pending = ''; }
  };
  const parse = line => {
    if (line.length > MAX_LINE) throw new Error('Le flux JSON du moteur dépasse la taille autorisée.');
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('Le moteur a renvoyé un flux JSON invalide ou incomplet.'); }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') throw new Error('Le moteur a renvoyé un événement JSON invalide.');
    consume(event);
  };
  return {
    push(chunk) { pending += decoder.write(chunk); flush(false); },
    finish() { pending += decoder.end(); flush(true); },
  };
}

const TOOL_LABELS = {
  Read: 'Lecture des documents', Write: 'Rédaction du livrable', Edit: 'Mise à jour du livrable', Glob: 'Recherche de fichiers', Grep: 'Recherche dans les documents', WebSearch: 'Recherche sur le Web', WebFetch: 'Lecture d’une source Web',
};

export function disabledMcpArguments(names = []) {
  if (!Array.isArray(names) || names.length > 100 || names.some(name => typeof name !== 'string' || !/^oscar-[a-z0-9][a-z0-9-]{0,55}$/.test(name))) throw new Error('La liste des connecteurs exclus est invalide.');
  return [...new Set(names)].flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]);
}

export function readConnectorArguments(plan) {
  if (plan === undefined || plan === null) return [];
  const service = READ_ONLY_SERVICES[plan.type];
  if (!isTrustedReadPlan(plan) || plan.client !== 'codex' || !service || plan.url !== service.url || JSON.stringify(plan.enabledTools) !== JSON.stringify(service.enabledTools)) throw new Error('Le plan de lecture du connecteur n’a pas été vérifié.');
  const serverKey = name => `mcp_servers.${JSON.stringify(name)}`;
  const disabled = plan.disabledServers.flatMap(name => ['-c', `${serverKey(name)}.enabled=false`]);
  const key = serverKey(plan.name);
  return ['-c', 'web_search="disabled"', ...disabled, '-c', `${key}.url=${JSON.stringify(service.url)}`, '-c', `${key}.enabled=true`, '-c', `${key}.required=true`, '-c', `${key}.enabled_tools=${JSON.stringify(service.enabledTools)}`, '-c', `${key}.default_tools_approval_mode="auto"`];
}

async function runAgentInternal({ provider, cwd, prompt, schema, signal, onActivity, readOnly = false, disabledMcpNames = [], connectorPlan, timeoutMs = RUN_TIMEOUT }) {
  const id = typeof provider === 'string' ? provider : provider?.id;
  if (!Object.hasOwn(NAMES, id)) throw new Error('Moteur inconnu. Choisissez Codex ou Claude.');
  if (connectorPlan && id !== 'codex') throw new Error('La lecture automatique de ce connecteur est disponible uniquement avec Codex.');
  if (typeof cwd !== 'string' || !cwd || typeof prompt !== 'string' || !prompt.trim()) throw new Error('Un dossier de travail et une mission sont nécessaires.');
  assertActive(signal);
  const directory = resolve(cwd);
  if (!(await stat(directory)).isDirectory()) throw new Error('Le dossier de la mission est introuvable.');
  let info;
  try { info = await inspect(id, signal); } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw publicError(id, '', 'Impossible de démarrer le CLI. Vérifiez son installation.');
  }
  if (!info.available) throw new Error(info.message);
  let schemaFile;
  let schemaText;
  if (schema !== undefined) {
    try { schemaText = JSON.stringify(schema); } catch { throw new Error('Le schéma de réponse est invalide.'); }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !schemaText || schemaText.length > 256000) throw new Error('Le schéma de réponse est invalide.');
  }
  const activity = label => { try { onActivity?.(label); } catch { /* UI callbacks do not control the CLI. */ } };
  let text = '';
  let usage;
  let terminal = false;
  let terminalFailure = false;
  let failureDetail = '';
  const stream = jsonLines(event => {
    if (terminal) return;
    if (id === 'codex') {
      if (event.type === 'turn.started') activity('Prise en charge de la mission');
      if (event.type === 'item.started') {
        const labels = { command_execution: 'Travail dans le dossier autorisé', file_change: 'Mise à jour du livrable', web_search: 'Recherche sur le Web', mcp_tool_call: 'Consultation d’un outil' };
        if (labels[event.item?.type]) activity(labels[event.item.type]);
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
      if (event.type === 'error') failureDetail += JSON.stringify(event);
      if (event.type === 'turn.failed') { terminal = true; terminalFailure = true; failureDetail += JSON.stringify(event); }
      if (event.type === 'turn.completed') { terminal = true; usage = event.usage; }
    } else {
      if (event.type === 'system' && event.subtype === 'init') activity('Prise en charge de la mission');
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'tool_use' && TOOL_LABELS[block.name]) activity(TOOL_LABELS[block.name]);
          if (block.type === 'text' && typeof block.text === 'string') text = block.text;
        }
        if (event.error) failureDetail += JSON.stringify(event);
      }
      if (event.type === 'result') {
        terminal = true;
        terminalFailure = event.is_error === true || event.subtype !== 'success';
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
      const searchArgs = connectorPlan ? [] : info.searchFlag ? ['--search'] : ['-c', 'web_search="live"'];
      args = ['-a', 'never', ...searchArgs, ...disabledMcpArguments(disabledMcpNames), ...readConnectorArguments(connectorPlan), 'exec', '--json', '--color', 'never', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--cd', directory, '--skip-git-repo-check'];
      if (schemaText) {
        if (!hasFlag(info.help, '--output-schema')) throw publicError(id, 'unsupported');
        const newSchemaFile = join(directory, `.oscar-schema-${randomUUID()}.json`);
        await writeFile(newSchemaFile, schemaText, { flag: 'wx', mode: 0o600 });
        schemaFile = newSchemaFile;
        args.push('--output-schema', schemaFile);
      }
      args.push('-');
    } else {
      const tools = readOnly ? ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'] : ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
      const canDenyPrompts = hasFlag(info.help, '--permission-prompts');
      const permissionMode = canDenyPrompts ? (/"manual"/.test(info.help) ? 'manual' : 'default') : 'dontAsk';
      args = ['-p', '--restricted', '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode, '--tools', tools.join(','), '--allowedTools', tools.join(','), '--strict-mcp-config'];
      if (canDenyPrompts) args.push('--permission-prompts', 'none');
      if (schemaText) {
        if (!hasFlag(info.help, '--json-schema')) throw publicError(id, 'unsupported');
        args.push('--json-schema', schemaText);
      }
    }
    assertActive(signal);
    activity('Démarrage de l’agent');
    const result = await execute(info.binary, args, { cwd: directory, input: prompt, signal, timeout: timeoutMs, onChunk: stream.push });
    stream.finish();
    const diagnostic = failureDetail + result.stderr;
    if (result.code !== 0 || result.exitSignal || terminalFailure) throw publicError(id, diagnostic);
    if (!terminal) throw publicError(id, diagnostic, 'La réponse a été interrompue avant sa confirmation finale. Aucun résultat n’a été validé.');
    if (!text.trim()) throw publicError(id, diagnostic, 'Le moteur a terminé sans livrable lisible.');
    return { text, ...(usage && typeof usage === 'object' ? { usage } : {}) };
  } catch (error) {
    if (['AbortError', 'TimeoutError'].includes(error.name)) throw error;
    if (error.code === 'ENOENT') throw publicError(id, '', 'Le CLI est introuvable. Vérifiez son installation.');
    throw error;
  } finally {
    if (schemaFile) await unlink(schemaFile).catch(() => {});
  }
}

export async function runAgent(options) {
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_AGENT_TIMEOUT_MS) throw new Error('Le délai d’un appel doit être compris entre 1 ms et 12 minutes.');
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  try {
    return await runAgentInternal({ ...options, timeoutMs, signal });
  } catch (error) {
    if (deadline.signal.aborted && !options.signal?.aborted) {
      throw timeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
