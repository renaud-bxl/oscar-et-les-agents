#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, stat, mkdir, readFile, writeFile, rename, unlink, symlink, readlink } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABELS = { codex: 'Codex pour ChatGPT', claude: 'Claude Code' };
const PACKAGES = { codex: '@openai/codex@latest', claude: '@anthropic-ai/claude-code@latest' };

export function parseArgs(argv = process.argv.slice(2)) {
  const options = { engine: null, skipLogin: false, noOpen: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--engine') {
      const engine = argv[++index];
      if (!engine || engine.startsWith('--')) throw new Error('Précisez codex, claude ou both après --engine.');
      options.engine = engine;
    } else if (arg.startsWith('--engine=')) options.engine = arg.slice('--engine='.length);
    else if (arg === '--skip-login') options.skipLogin = true;
    else if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Option inconnue : ${arg}. Utilisez --help.`);
  }
  if (options.engine !== null && !['codex', 'claude', 'both'].includes(options.engine)) throw new Error('Le moteur doit être codex, claude ou both.');
  return options;
}

export function supportsNode(version) {
  const match = String(version).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return !!match && (Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 18));
}

export function compatibleClaude(version, help = '') {
  const match = String(version).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return (major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 248))))
    && ['--restricted', '--output-format', '--verbose', '--permission-mode', '--tools', '--allowedTools', '--strict-mcp-config'].every(flag => help.includes(flag));
}

export function compatibleCodex(help = '') {
  const flags = new Set(typeof help === 'string' ? help.match(/--[A-Za-z][A-Za-z0-9-]*/g) || [] : []);
  return ['--json', '--sandbox', '--color', '--skip-git-repo-check', '--output-schema'].every(flag => flags.has(flag));
}

// Authentication remains with the official programs. No credential file is opened.
export function subscriptionEnvironment(source = process.env, { root = PROJECT_ROOT, nodePath = process.execPath } = {}) {
  const excluded = new Set([
    'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_FEDERATION_RULE_ID',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDECODE',
    'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL',
  ]);
  const env = {};
  for (const key of Object.keys(source)) {
    if (excluded.has(key) || /^CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$/.test(key)) continue;
    env[key] = source[key];
  }
  env.PATH = [path.join(root, '.runtime', 'bin'), path.join(root, '.tools', 'node_modules', '.bin'), path.dirname(nodePath), source.PATH || ''].join(path.delimiter);
  env.NO_COLOR = '1';
  return env;
}

async function canExecute(file) {
  try { await access(file, constants.X_OK); return (await stat(file)).isFile(); }
  catch { return false; }
}

export function binaryCandidates(provider, { root = PROJECT_ROOT, env = process.env, platform = process.platform, home = homedir() } = {}) {
  const names = platform === 'win32' ? [`${provider}.exe`, `${provider}.cmd`, provider] : [provider];
  const folders = [path.join(root, '.tools', 'node_modules', '.bin'), ...(env.PATH || '').split(path.delimiter).filter(Boolean)];
  const candidates = folders.flatMap(folder => names.map(name => path.join(folder, name)));
  if (provider === 'claude') candidates.push(path.join(home, '.local', 'bin', 'claude'));
  if (provider === 'codex' && platform === 'darwin') candidates.push(
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    path.join(home, 'Applications/Codex.app/Contents/Resources/codex'),
  );
  if (platform !== 'win32') candidates.push(`/opt/homebrew/bin/${provider}`, `/usr/local/bin/${provider}`);
  return [...new Set(candidates)];
}

export async function findBinary(provider, context = {}) {
  const check = context.canExecute || canExecute;
  for (const candidate of binaryCandidates(provider, context)) if (await check(candidate)) return candidate;
  return null;
}

function capture(command, args, options) {
  return new Promise(resolve => {
    execFile(command, args, { ...options, timeout: 15000, maxBuffer: 256 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout = '', stderr = '') => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

function interactive(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit', windowsHide: true });
    child.once('error', () => reject(new Error('Le programme demandé n’a pas pu démarrer.')));
    child.once('close', (code, signal) => resolve({ code: signal ? 1 : code ?? 1 }));
  });
}

export function hasSubscription(provider, result) {
  if (result.code !== 0) return false;
  if (provider === 'codex') return /Logged in using ChatGPT/i.test(`${result.stdout || ''}\n${result.stderr || ''}`);
  try {
    const status = JSON.parse(result.stdout);
    return status.loggedIn === true && /^(claude\.ai|claude_ai|oauth|oauth_token|subscription)$/i.test(status.authMethod || '');
  } catch { return false; }
}

async function noSymlink(file) {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error('Un lien symbolique occupe un dossier interne de l’installation. Choisissez un autre dossier.');
    return info;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function prepareTools(root) {
  const folder = path.join(root, '.tools');
  for (const internal of [folder, path.join(folder, 'node_modules'), path.join(folder, 'node_modules', '.bin')]) {
    const info = await noSymlink(internal);
    if (info && !info.isDirectory()) throw new Error('Un fichier empêche la préparation des moteurs.');
  }
  await mkdir(folder, { recursive: true, mode: 0o700 });
}

export function resolveInstallerDataDirectory({ env = process.env, home = homedir() } = {}) {
  return path.resolve(env.OSCAR_DATA_DIR || env.ATELIER_DATA_DIR || path.join(home, 'Documents', 'Oscar et les agents'));
}

async function savePreferences(_root, preferences, { dataDir = resolveInstallerDataDirectory(), preservePreferredProvider = false } = {}) {
  const folder = dataDir;
  const info = await noSymlink(folder);
  if (info && !info.isDirectory()) throw new Error('Le dossier des missions est inaccessible.');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = path.join(folder, 'preferences.json');
  await noSymlink(target);
  let previous = {};
  try {
    previous = JSON.parse(await readFile(target, 'utf8'));
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Invalid preferences');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Les préférences existantes ne peuvent pas être lues. Elles ont été conservées ; vérifiez ce fichier avant de relancer la préparation.');
  }
  const merged = { ...previous, ...preferences };
  if (preservePreferredProvider && ['codex', 'claude'].includes(previous.preferredProvider)) merged.preferredProvider = previous.preferredProvider;
  const temporary = path.join(folder, `.preferences-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(() => {}); }
  return merged;
}

async function createShortcut({ root, platform, home }) {
  if (platform !== 'darwin') return;
  const bundle = path.join(root, 'Oscar et les agents.app');
  if (!(await stat(bundle).catch(() => null))?.isDirectory()) return;
  const apps = path.join(home, 'Applications');
  const info = await noSymlink(apps);
  if (info && !info.isDirectory()) return;
  await mkdir(apps, { recursive: true });
  const target = path.join(apps, 'Oscar et les agents.app');
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    if (existing.isSymbolicLink() && await readlink(target) === bundle) return;
    return; // Keep any application or shortcut already placed here by the user.
  }
  await symlink(bundle, target, 'dir');
}

async function npmCommand({ nodePath, env, platform }) {
  const scripts = [
    path.resolve(path.dirname(nodePath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const file of scripts) if ((await stat(file).catch(() => null))?.isFile()) return { command: nodePath, args: [file] };
  if (platform !== 'win32') {
    for (const directory of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
      const file = path.join(directory, 'npm');
      if (await canExecute(file)) return { command: file, args: [] };
    }
  }
  throw new Error('Le gestionnaire de paquets de Node.js est introuvable. Relancez install.sh pour préparer Node.js avec ses outils.');
}

async function promptEngine() {
  if (!process.stdin.isTTY) throw new Error('Précisez --engine codex, --engine claude ou --engine both pour choisir votre abonnement.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await terminal.question('Quel abonnement utiliser ? 1. ChatGPT avec Codex · 2. Claude · 3. Les deux [1] : ')).trim();
    if (['', '1', 'codex', 'chatgpt'].includes(answer.toLowerCase())) return 'codex';
    if (['2', 'claude'].includes(answer.toLowerCase())) return 'claude';
    if (['3', 'both', 'deux'].includes(answer.toLowerCase())) return 'both';
    throw new Error('Choisissez 1, 2 ou 3, puis relancez l’installation.');
  } finally { terminal.close(); }
}

export async function runInstaller(options, dependencies = {}) {
  const root = dependencies.root || PROJECT_ROOT;
  const home = dependencies.home || homedir();
  const platform = dependencies.platform || process.platform;
  const nodePath = dependencies.nodePath || process.execPath;
  const nodeVersion = dependencies.nodeVersion || process.versions.node;
  const log = dependencies.log || console.log;
  const env = subscriptionEnvironment(dependencies.env || process.env, { root, nodePath });
  const dataDir = resolveInstallerDataDirectory({ env, home });
  const context = { root, home, platform, env, dataDir };
  const runCapture = dependencies.capture || capture;
  const runInteractive = dependencies.interactive || interactive;
  const detect = dependencies.findBinary || ((provider) => findBinary(provider, context));
  const childOptions = { cwd: root, env };
  if (!supportsNode(nodeVersion)) throw new Error('Node.js 22.18 ou plus récent est nécessaire. Lancez install.sh pour le préparer automatiquement.');
  const engine = options.engine || await (dependencies.promptEngine || promptEngine)();
  if (!['codex', 'claude', 'both'].includes(engine)) throw new Error('Le moteur doit être codex, claude ou both.');
  const providers = engine === 'both' ? ['codex', 'claude'] : [engine];
  let preferredProvider = providers[0];
  log('\nOscar et les agents — préparons votre équipe.');
  const binaries = {};
  const missing = [];
  for (const provider of providers) {
    const binary = await detect(provider);
    if (!binary) { missing.push(provider); continue; }
    const version = await runCapture(binary, ['--version'], childOptions);
    if (provider === 'claude') {
      const help = await runCapture(binary, ['--help'], childOptions);
      if (version.code !== 0 || help.code !== 0 || !compatibleClaude(version.stdout, help.stdout)) {
        log('Claude Code doit être mis à jour pour fonctionner avec les protections du bureau.');
        missing.push(provider);
        continue;
      }
    } else {
      const help = await runCapture(binary, ['exec', '--help'], childOptions);
      if (version.code !== 0 || help.code !== 0 || !compatibleCodex(help.stdout)) {
        log('Codex doit être mis à jour pour fonctionner avec les protections du bureau.');
        missing.push(provider);
        continue;
      }
    }
    binaries[provider] = binary;
    log(`${LABELS[provider]} est déjà installé ; il est conservé.`);
  }

  if (options.dryRun) {
    for (const provider of missing) log(`Simulation : installer ${LABELS[provider]} dans le dossier privé du logiciel.`);
    if (!options.skipLogin) log('Simulation : conserver les abonnements connectés ou ouvrir leur connexion officielle dans le navigateur.');
    log(`Simulation : enregistrer le moteur préféré (${preferredProvider})${options.noOpen ? '.' : ', puis ouvrir le bureau.'}`);
    return { engine, preferredProvider, install: missing, dryRun: true };
  }

  if (missing.length) {
    await (dependencies.prepareTools || prepareTools)(root);
    const npm = await (dependencies.npmCommand || npmCommand)({ nodePath, env, platform });
    log(`Installation locale de ${missing.map(provider => LABELS[provider]).join(' et ')}…`);
    const result = await runInteractive(npm.command, [...npm.args, '--prefix', path.join(root, '.tools'), 'install', '--no-fund', '--no-audit', ...missing.map(provider => PACKAGES[provider])], childOptions);
    if (result.code !== 0) throw new Error('L’installation du moteur a échoué. Vérifiez la connexion Internet et relancez la préparation.');
    for (const provider of missing) {
      const binary = await detect(provider);
      if (!binary) throw new Error(`${LABELS[provider]} reste introuvable après son installation.`);
      const version = await runCapture(binary, ['--version'], childOptions);
      if (version.code !== 0) throw new Error(`${LABELS[provider]} a été installé mais ne démarre pas sur cet ordinateur.`);
      if (provider === 'claude') {
        const help = await runCapture(binary, ['--help'], childOptions);
        if (help.code !== 0 || !compatibleClaude(version.stdout, help.stdout)) throw new Error('La version de Claude Code installée ne fournit pas encore les protections nécessaires. Aucun accès élargi n’a été activé.');
      } else {
        const help = await runCapture(binary, ['exec', '--help'], childOptions);
        if (help.code !== 0 || !compatibleCodex(help.stdout)) throw new Error('La version de Codex installée ne fournit pas encore les protections et les réponses structurées nécessaires. Relancez la préparation après sa mise à jour.');
      }
      binaries[provider] = binary;
    }
  }

  for (const provider of providers) {
    if (options.skipLogin) {
      log(`Connexion à ${LABELS[provider]} reportée à votre demande.`);
      continue;
    }
    const statusArgs = provider === 'codex' ? ['login', 'status'] : ['auth', 'status'];
    if (hasSubscription(provider, await runCapture(binaries[provider], statusArgs, childOptions))) {
      log(`${LABELS[provider]} est déjà connecté à votre abonnement ; la connexion est conservée.`);
      continue;
    }
    log(`Connectez votre abonnement ${provider === 'codex' ? 'ChatGPT' : 'Claude'} dans la fenêtre officielle de votre navigateur.`);
    const login = await runInteractive(binaries[provider], provider === 'codex' ? ['login'] : ['auth', 'login'], childOptions);
    if (login.code !== 0) throw new Error(`La connexion à ${LABELS[provider]} n’a pas abouti. Vous pouvez relancer la préparation pour la terminer.`);
    if (!hasSubscription(provider, await runCapture(binaries[provider], statusArgs, childOptions))) {
      throw new Error(`La connexion à l’abonnement ${provider === 'codex' ? 'ChatGPT' : 'Claude'} n’a pas été confirmée. Relancez la préparation et choisissez votre abonnement dans le navigateur.`);
    }
    log(`Votre abonnement ${provider === 'codex' ? 'ChatGPT' : 'Claude'} est connecté.`);
  }

  const savedPreferences = await (dependencies.savePreferences || savePreferences)(root, { preferredProvider, setupComplete: true }, { dataDir, preservePreferredProvider: engine === 'both' });
  if (['codex', 'claude'].includes(savedPreferences?.preferredProvider)) preferredProvider = savedPreferences.preferredProvider;
  try { await (dependencies.createShortcut || createShortcut)(context); }
  catch { log('Le raccourci n’a pas pu être créé. Le bureau reste disponible dans son dossier d’installation.'); }
  log('Installation terminée. Oscar et les agents est prêt.');
  if (!options.noOpen) {
    const opened = await runInteractive(nodePath, [path.join(root, 'launch.mjs')], childOptions);
    if (opened.code !== 0) throw new Error('Le logiciel est installé, mais le bureau n’a pas pu s’ouvrir. Relancez « Oscar et les agents » depuis son dossier.');
  }
  return { engine, preferredProvider, install: missing, setupComplete: true };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Oscar et les agents\n\n  node scripts/install.mjs [--engine codex|claude|both] [--skip-login] [--no-open] [--dry-run]\n\nChoisissez votre abonnement. La connexion se fait dans le navigateur officiel ; les sessions existantes sont conservées.');
    return;
  }
  await runInstaller(options);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Installation interrompue : ${error.message}`); process.exitCode = 1; });
}
