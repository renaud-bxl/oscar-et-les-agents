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
import {INHERITED_APPS,isSafeInheritedAppId,isSafeInheritedToolName} from './connector-clients.mjs';
import {createClaudeReadSession} from './claude-read-session.mjs';

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
  if (detail.includes('connector_scope_missing')) return Object.assign(new Error('La connexion existante au service ne possède pas les autorisations nécessaires pour cette consultation. Vérifiez ses autorisations dans ChatGPT ou Claude ; aucun nouvel accès n’a été demandé automatiquement.'), { code: 'CONNECTOR_PERMISSIONS' });
  if (detail.includes('connector_read_failed')) return Object.assign(new Error('Le service n’a pas confirmé la lecture demandée. Les éventuels fichiers partiels sont conservés. Vérifiez la connexion du service dans votre client officiel avant de réessayer.'),{code:'CONNECTOR_UNAVAILABLE'});
  if (detail.includes('connector_no_read')) return Object.assign(new Error('Aucune lecture du service sélectionné n’a été confirmée. La réponse du moteur n’est pas présentée comme une consultation de votre compte.'),{code:'CONNECTOR_NO_READ'});
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
      killTimer.unref();
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
        fail(new Error('La sortie du moteur dépasse la taille autorisée. La mission a été arrêtée.'));
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
  const disabled = plan.disabledServers.flatMap(name => ['-c', `${serverKey(name)}.enabled=false`]);
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

async function runAgentInternal({ provider, cwd, prompt, schema, signal, onActivity, readOnly = false, disabledMcpNames = [], connectorPlan, timeoutMs = RUN_TIMEOUT }) {
  const id = typeof provider === 'string' ? provider : provider?.id;
  if (!Object.hasOwn(NAMES, id)) throw new Error('Moteur inconnu. Choisissez Codex ou Claude.');
  if (connectorPlan && (!isTrustedReadPlan(connectorPlan)||connectorPlan.client!==id)) throw new Error('Le plan de lecture ne correspond pas au moteur de cette mission.');
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
  let connectorReadConfirmed=false;
  const connectorToolCalls=new Map(),successfulConnectorEvents=new Set(),successfulConnectorTools=new Map();
  const capturedConnectorTools=connectorPlan?[...connectorPlan.enabledTools].sort((left,right)=>right.length-left.length):[];
  const selectedConnectorTool=raw=>typeof raw==='string'?(capturedConnectorTools.find(tool=>raw===tool)||capturedConnectorTools.find(tool=>raw.endsWith(`.${tool}`)||raw.endsWith(`__${tool}`))):undefined;
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
    if (id === 'codex') {
      if (event.type === 'turn.started') activity('Prise en charge de la mission');
      if (event.type === 'item.started') {
        const labels = { command_execution: 'Travail dans le dossier autorisé', file_change: 'Mise à jour du livrable', web_search: 'Recherche sur le Web', mcp_tool_call: 'Consultation d’un outil' };
        if (labels[event.item?.type]) activity(labels[event.item.type]);
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
      if (connectorPlan && event.type === 'item.completed' && event.item?.type === 'mcp_tool_call') {
        const item = event.item;
        // Tool names supplied by an app may themselves contain dots, slashes
        // or double underscores. Match the captured name without truncating it.
        const selected=selectedConnectorTool(item.tool);
        if (selected) recordConnectorResult(selected,item.id,item.status!=='completed'||item.error!=null||item.result?.isError===true,item.error??item.result);
      }
      if (event.type === 'error') failureDetail += JSON.stringify(event);
      if (event.type === 'turn.failed') { terminal = true; terminalFailure = true; failureDetail += JSON.stringify(event); }
      if (event.type === 'turn.completed') { terminal = true; usage = event.usage; }
    } else {
      if (event.type === 'system' && event.subtype === 'init') activity('Prise en charge de la mission');
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'tool_use' && TOOL_LABELS[block.name]) activity(TOOL_LABELS[block.name]);
          if(connectorPlan&&block.type==='tool_use'&&typeof block.id==='string'&&claudeReadConnectorArguments(connectorPlan).allowed.includes(block.name)){
            if(!connectorToolCalls.has(block.id)&&!successfulConnectorEvents.has(block.id))connectorToolCalls.set(block.id,selectedConnectorTool(block.name));
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
      const searchArgs = connectorPlan ? [] : info.searchFlag ? ['--search'] : ['-c', 'web_search="live"'];
      args = ['-a', 'never', ...searchArgs, ...(!connectorPlan?['--disable','apps']:[]),...disabledMcpArguments(disabledMcpNames), ...readConnectorArguments(connectorPlan), 'exec', '--json', '--color', 'never', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--cd', directory, '--skip-git-repo-check'];
      if (schemaText) {
        if (!hasFlag(info.help, '--output-schema')) throw publicError(id, 'unsupported');
        const newSchemaFile = join(directory, `.oscar-schema-${randomUUID()}.json`);
        await writeFile(newSchemaFile, schemaText, { flag: 'wx', mode: 0o600 });
        schemaFile = newSchemaFile;
        args.push('--output-schema', schemaFile);
      }
      args.push('-');
    } else {
      const tools = readOnly ? ['Read', 'Glob', 'Grep',...(!connectorPlan?['WebSearch','WebFetch']:[])] : ['Read', 'Write', 'Edit', 'Glob', 'Grep',...(!connectorPlan?['WebSearch','WebFetch']:[])];
      const inherited=connectorPlan?claudeReadConnectorArguments(connectorPlan):null;
      const canDenyPrompts = hasFlag(info.help, '--permission-prompts');
      const permissionMode = connectorPlan?'dontAsk':canDenyPrompts ? (/"manual"/.test(info.help) ? 'manual' : 'default') : 'dontAsk';
      args = ['-p', '--restricted', '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode, '--tools', tools.join(','), '--allowedTools', [...tools,...(inherited?.allowed||[])].join(','),...(inherited?inherited.args:['--strict-mcp-config'])];
      if(inherited)args.push('--input-format','stream-json','--no-session-persistence','--setting-sources','','--no-chrome','--disable-slash-commands');
      if (canDenyPrompts) args.push('--permission-prompts', 'none');
      if (schemaText) {
        if (!hasFlag(info.help, '--json-schema')) throw publicError(id, 'unsupported');
        args.push('--json-schema', schemaText);
      }
    }
    assertActive(signal);
    activity('Démarrage de l’agent');
    const result = await execute(info.binary, args, { cwd: directory, input: prompt, signal, timeout: timeoutMs, onChunk: stream.push,...(id==='claude'&&connectorPlan?{claudeReadPlan:connectorPlan}:{}) });
    stream.finish();
    const diagnostic = failureDetail + result.stderr;
    if (result.code !== 0 || result.exitSignal || terminalFailure) throw publicError(id, diagnostic);
    if (!terminal) throw publicError(id, diagnostic, 'La réponse a été interrompue avant sa confirmation finale. Aucun résultat n’a été validé.');
    if(connectorPlan&&!connectorReadConfirmed)throw publicError(id,'connector_no_read');
    if (!text.trim()) throw publicError(id, diagnostic, 'Le moteur a terminé sans livrable lisible.');
    return { text, ...(usage && typeof usage === 'object' ? { usage } : {}),...(connectorPlan?{connectorReadReceipt:connectorReadReceipt(connectorPlan,id,successfulConnectorTools)}:{}) };
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
