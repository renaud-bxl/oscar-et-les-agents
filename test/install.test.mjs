import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, realpath, access, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { parseArgs, supportsNode, compatibleClaude, compatibleCodex, binaryCandidates, findBinary, hasSubscription, subscriptionEnvironment, resolveInstallerDataDirectory, runInstaller } from '../scripts/install.mjs';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claudeHelp = '--restricted --output-format --verbose --permission-mode --tools --allowedTools --strict-mcp-config';
const codexHelp = '--json --sandbox --color --skip-git-repo-check --output-schema';
const ok = stdout => ({ code: 0, stdout, stderr: '' });

function fixture(overrides = {}) {
  const calls = [];
  const messages = [];
  const saved = [];
  const dependencies = {
    root: '/a/project', platform: 'linux', home: '/a/home', nodeVersion: '24.1.0', nodePath: '/a/node/bin/node',
    env: { PATH: '/a/bin', HOME: '/a/home' }, log: message => messages.push(message),
    findBinary: async provider => `/a/bin/${provider}`,
    capture: async (binary, args) => {
      calls.push({ type: 'capture', binary, args });
      if (args[0] === '--version') return ok(binary.endsWith('claude') ? '2.1.290 (Claude Code)' : 'codex-cli 0.130.0');
      if (args[0] === 'exec' && args[1] === '--help') return ok(codexHelp);
      if (args[0] === '--help') return ok(claudeHelp);
      return binary.endsWith('codex') ? ok('Logged in using ChatGPT') : ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }));
    },
    interactive: async (binary, args, options) => { calls.push({ type: 'interactive', binary, args, options }); return { code: 0 }; },
    prepareTools: async () => { calls.push({ type: 'prepare' }); },
    npmCommand: async () => ({ command: '/a/node/bin/node', args: ['/a/npm-cli.js'] }),
    savePreferences: async (_root, value) => saved.push(value),
    createShortcut: async () => { calls.push({ type: 'shortcut' }); },
    ...overrides,
  };
  return { dependencies, calls, messages, saved };
}

test('installer argument parsing and Node version boundaries', () => {
  assert.deepEqual(parseArgs(['--engine=both', '--skip-login', '--no-open', '--dry-run']), { engine: 'both', skipLogin: true, noOpen: true, dryRun: true, help: false });
  assert.equal(parseArgs(['--engine', 'claude']).engine, 'claude');
  assert.equal(parseArgs(['--help']).help, true);
  for (const args of [['--engine'], ['--engine', '--no-open'], ['--engine=unknown'], ['--api-key', 'secret'], ['--dir', '/tmp/a']]) assert.throws(() => parseArgs(args));
  for (const version of ['22.18.0', '22.19.1', '24.0.0', 'v25.0.0']) assert.equal(supportsNode(version), true);
  for (const version of ['18.20.0', '22.17.9', 'not a version']) assert.equal(supportsNode(version), false);
});

test('Claude compatibility rejects versions behind the required protections', () => {
  assert.equal(compatibleClaude('2.1.247', claudeHelp), false);
  assert.equal(compatibleClaude('2.1.248', claudeHelp), true);
  assert.equal(compatibleClaude('2.1.290', claudeHelp.replace('--restricted', '')), false);
  assert.equal(compatibleClaude('3.0.0', claudeHelp), true);
});

test('Codex requires all execution protections and structured output support', () => {
  assert.equal(compatibleCodex(codexHelp), true);
  for (const flag of codexHelp.split(' ')) assert.equal(compatibleCodex(codexHelp.replace(flag, '')), false);
  assert.equal(compatibleCodex(codexHelp.replace('--json', '--json-schema')), false);
});

test('detection prioritizes private tools and includes desktop and native installations', async () => {
  const context = { root: '/project', env: { PATH: '/bin:/usr/bin' }, home: '/person', platform: 'darwin' };
  assert.equal(binaryCandidates('codex', context)[0], '/project/.tools/node_modules/.bin/codex');
  assert.ok(binaryCandidates('codex', context).includes('/Applications/Codex.app/Contents/Resources/codex'));
  assert.ok(binaryCandidates('claude', context).includes('/person/.local/bin/claude'));
  const found = await findBinary('codex', { ...context, canExecute: async file => file === '/usr/bin/codex' });
  assert.equal(found, '/usr/bin/codex');
});

test('only official subscription status counts and API credentials are never inherited', () => {
  assert.equal(hasSubscription('codex', ok('Logged in using ChatGPT')), true);
  assert.equal(hasSubscription('codex', { code: 0, stdout: '', stderr: 'Logged in using ChatGPT' }), true);
  assert.equal(hasSubscription('codex', ok('Logged in using an API key')), false);
  assert.equal(hasSubscription('claude', ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }))), true);
  assert.equal(hasSubscription('claude', ok(JSON.stringify({ loggedIn: true, authMethod: 'api_key' }))), false);
  assert.equal(hasSubscription('claude', ok(JSON.stringify({ loggedIn: true, authMethod: 'third_party' }))), false);
  assert.equal(hasSubscription('claude', ok('unexpected output')), false);
  const environment = subscriptionEnvironment({ PATH: '/bin', HOME: '/person', OPENAI_API_KEY: 'must-not-propagate', CODEX_API_KEY: 'must-not-propagate', ANTHROPIC_API_KEY: 'must-not-propagate', ANTHROPIC_AUTH_TOKEN: 'must-not-propagate', CLAUDE_CODE_OAUTH_TOKEN: 'must-not-propagate', CLAUDE_CODE_USE_BEDROCK: '1' }, { root: '/project', nodePath: '/node/bin/node' });
  assert.equal(environment.HOME, '/person');
  assert.ok(environment.PATH.startsWith('/project/.runtime/bin:'));
  assert.doesNotMatch(JSON.stringify(environment), /must-not-propagate|USE_BEDROCK/);
});

test('existing connected subscriptions need no installation or login', async () => {
  const state = fixture();
  const result = await runInstaller(parseArgs(['--engine', 'both', '--no-open']), state.dependencies);
  assert.deepEqual(result.install, []);
  assert.equal(state.calls.filter(call => call.type === 'interactive').length, 0);
  assert.deepEqual(state.saved, [{ preferredProvider: 'codex', setupComplete: true }]);
  assert.ok(state.messages.some(message => message.includes('connexion est conservée')));
});

test('missing engines are installed together under the project and never globally', async () => {
  let installed = false;
  const state = fixture({
    findBinary: async provider => installed ? `/a/project/.tools/node_modules/.bin/${provider}` : null,
    interactive: async (binary, args) => { installed = true; state.calls.push({ type: 'interactive', binary, args }); return { code: 0 }; },
  });
  const result = await runInstaller(parseArgs(['--engine', 'both', '--skip-login', '--no-open']), state.dependencies);
  assert.deepEqual(result.install, ['codex', 'claude']);
  const installs = state.calls.filter(call => call.type === 'interactive');
  assert.equal(installs.length, 1);
  assert.deepEqual(installs[0].args, ['/a/npm-cli.js', '--prefix', '/a/project/.tools', 'install', '--no-fund', '--no-audit', '@openai/codex@latest', '@anthropic-ai/claude-code@latest']);
  assert.ok(!installs[0].args.includes('-g'));
});

test('an incompatible existing Claude is replaced locally without changing Codex', async () => {
  let installed = false;
  const state = fixture();
  const normalCapture = state.dependencies.capture;
  state.dependencies.capture = async (binary, args, options) => binary.endsWith('claude') && args[0] === '--version' && !installed ? ok('2.1.100') : normalCapture(binary, args, options);
  state.dependencies.interactive = async (binary, args) => { installed = true; state.calls.push({ type: 'interactive', binary, args }); return { code: 0 }; };
  await runInstaller(parseArgs(['--engine', 'both', '--skip-login', '--no-open']), state.dependencies);
  const install = state.calls.find(call => call.type === 'interactive');
  assert.ok(install.args.includes('@anthropic-ai/claude-code@latest'));
  assert.ok(!install.args.includes('@openai/codex@latest'));
});

test('an older Codex without required execution flags is upgraded locally and checked again', async () => {
  let installed = false;
  const state = fixture();
  const normalCapture = state.dependencies.capture;
  state.dependencies.findBinary = async provider => provider === 'codex' && installed ? '/a/project/.tools/node_modules/.bin/codex' : `/a/bin/${provider}`;
  state.dependencies.capture = async (binary, args, options) => binary.endsWith('codex') && args[0] === 'exec' && !installed ? ok('--json --color') : normalCapture(binary, args, options);
  state.dependencies.interactive = async (binary, args) => { installed = true; state.calls.push({ type: 'interactive', binary, args }); return { code: 0 }; };
  const result = await runInstaller(parseArgs(['--engine', 'both', '--skip-login', '--no-open']), state.dependencies);
  assert.deepEqual(result.install, ['codex']);
  const install = state.calls.find(call => call.type === 'interactive');
  assert.ok(install.args.includes('@openai/codex@latest'));
  assert.ok(!install.args.includes('@anthropic-ai/claude-code@latest'));
  assert.ok(state.calls.some(call => call.type === 'capture' && call.binary === '/a/project/.tools/node_modules/.bin/codex' && call.args[0] === 'exec' && call.args[1] === '--help'));
});

test('a newly installed Codex that remains incompatible cannot complete setup', async () => {
  const state = fixture({ findBinary: async () => null });
  const normalCapture = state.dependencies.capture;
  state.dependencies.capture = async (binary, args, options) => args[0] === 'exec' ? ok(codexHelp.replace('--output-schema', '')) : normalCapture(binary, args, options);
  let installed = false;
  state.dependencies.findBinary = async () => installed ? '/a/project/.tools/node_modules/.bin/codex' : null;
  state.dependencies.interactive = async () => { installed = true; return { code: 0 }; };
  await assert.rejects(runInstaller(parseArgs(['--engine', 'codex', '--skip-login', '--no-open']), state.dependencies), /Codex installée ne fournit pas/);
  assert.equal(state.saved.length, 0);
});

test('browser onboarding uses stock subscription login and verifies it before saving', async () => {
  for (const provider of ['codex', 'claude']) {
    let connected = false;
    const state = fixture();
    const normalCapture = state.dependencies.capture;
    state.dependencies.capture = async (binary, args, options) => args.includes('status') && !connected ? { code: 1, stdout: '', stderr: '' } : normalCapture(binary, args, options);
    state.dependencies.interactive = async (binary, args, options) => { state.calls.push({ type: 'interactive', binary, args, options }); connected = true; return { code: 0 }; };
    await runInstaller(parseArgs(['--engine', provider, '--no-open']), state.dependencies);
    const logins = state.calls.filter(call => call.type === 'interactive');
    assert.equal(logins.length, 1);
    assert.deepEqual(logins[0].args, provider === 'codex' ? ['login'] : ['auth', 'login']);
    assert.equal(state.saved.length, 1);
  }
});

test('unconfirmed login does not mark setup complete or launch the application', async () => {
  const state = fixture();
  const normalCapture = state.dependencies.capture;
  state.dependencies.capture = async (binary, args, options) => args.includes('status') ? ok('Logged in using an API key') : normalCapture(binary, args, options);
  await assert.rejects(runInstaller(parseArgs(['--engine', 'codex']), state.dependencies), /n’a pas été confirmée/);
  assert.equal(state.saved.length, 0);
  assert.equal(state.calls.filter(call => call.type === 'interactive').length, 1);
});

test('dry run detects requirements but never installs, authenticates, saves or opens', async () => {
  const state = fixture({ findBinary: async () => null });
  const result = await runInstaller(parseArgs(['--engine', 'both', '--dry-run']), state.dependencies);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.install, ['codex', 'claude']);
  assert.equal(state.calls.length, 0);
  assert.equal(state.saved.length, 0);
});

test('opening the installed application receives the private runtime and tool paths', async () => {
  const state = fixture();
  await runInstaller(parseArgs(['--engine', 'claude']), state.dependencies);
  const launch = state.calls.find(call => call.type === 'interactive');
  assert.deepEqual(launch.args, ['/a/project/launch.mjs']);
  assert.ok(launch.options.env.PATH.includes('/a/project/.tools/node_modules/.bin'));
});

test('shell refuses dangerous folders and symbolic links before copying or downloading', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-installer-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const linked = path.join(temporary, 'linked');
  await symlink(temporary, linked, 'dir');
  for (const folder of ['/', '/srv', process.env.HOME, '/usr/local', linked, `${temporary}/../other`]) {
    await assert.rejects(exec('/bin/sh', [path.join(root, 'install.sh'), '--engine', 'codex', '--dir', folder, '--dry-run']), error => /Installation interrompue/.test(error.stderr));
  }
  const destination = path.join(temporary, 'preview');
  const preview = await exec('/bin/sh', [path.join(root, 'install.sh'), '--engine', 'both', '--dir', destination, '--dry-run']);
  assert.match(preview.stdout, /Aucun changement effectué/);
  await assert.rejects(access(destination));
});

test('shell installs a local checkout without network and preserves existing mission data', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-copy-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'source');
  const destination = path.join(temporary, 'destination');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  await mkdir(path.join(source, 'data'));
  await mkdir(path.join(destination, 'data'), { recursive: true });
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'oscar-et-les-agents' }));
  await writeFile(path.join(source, 'server.mjs'), '// Test source\n');
  await writeFile(path.join(source, 'scripts', 'install.mjs'), 'console.log("ONBOARDING_MOCK_OK");\n');
  await writeFile(path.join(source, 'install.sh'), await readFile(path.join(root, 'install.sh')));
  await writeFile(path.join(source, '.env'), 'PRIVATE_TEST_VALUE');
  await writeFile(path.join(source, 'data', 'do-not-copy.txt'), 'PRIVATE_TEST_VALUE');
  await writeFile(path.join(destination, 'data', 'mission.txt'), 'Mission conservée');
  const result = await exec('/bin/sh', [path.join(source, 'install.sh'), '--engine', 'codex', '--dir', destination, '--skip-login', '--no-open'], { cwd: source, env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` } });
  assert.match(result.stdout, /ONBOARDING_MOCK_OK/);
  assert.doesNotMatch(result.stdout, /Téléchargement/);
  assert.equal(await readFile(path.join(destination, 'data', 'mission.txt'), 'utf8'), 'Mission conservée');
  assert.equal(await readFile(path.join(destination, 'server.mjs'), 'utf8'), '// Test source\n');
  await assert.rejects(access(path.join(destination, '.env')));
  await assert.rejects(access(path.join(destination, 'data', 'do-not-copy.txt')));
});

test('portable runtime download is simulated and its official checksum is required before execution', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-runtime-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'source');
  const mocks = path.join(temporary, 'mocks');
  const archiveRoot = path.join(temporary, 'node-v24.999.0-linux-x64');
  const archive = path.join(temporary, 'node-fixture.tar.gz');
  const checksums = path.join(temporary, 'checksums.txt');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  await mkdir(path.join(archiveRoot, 'bin'), { recursive: true });
  await mkdir(mocks);
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'oscar-et-les-agents' }));
  await writeFile(path.join(source, 'server.mjs'), '// simulated checkout');
  await writeFile(path.join(source, 'scripts', 'install.mjs'), 'console.log("SIMULATED_RUNTIME_OK");');
  await writeFile(path.join(source, 'install.sh'), await readFile(path.join(root, 'install.sh')));
  const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(path.join(archiveRoot, 'bin', 'node'), `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`, { mode: 0o755 });
  await exec('tar', ['-czf', archive, '-C', temporary, 'node-v24.999.0-linux-x64']);
  const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(checksums, `${checksum}  node-v24.999.0-linux-x64.tar.gz\n`);
  await writeFile(path.join(mocks, 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await writeFile(path.join(mocks, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n', { mode: 0o755 });
  await writeFile(path.join(mocks, 'curl'), '#!/bin/sh\nurl=""\nout=""\nwhile [ "$#" -gt 0 ]; do\n case "$1" in\n  https://*) url=$1; shift;;\n  -o) out=$2; shift 2;;\n  *) shift;;\n esac\ndone\ncase "$url" in\n https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt) cp "$OSCAR_TEST_CHECKSUMS" "$out";;\n https://nodejs.org/dist/latest-v24.x/node-v24.999.0-linux-x64.tar.gz) cp "$OSCAR_TEST_ARCHIVE" "$out";;\n *) echo "Unexpected network request" >&2; exit 1;;\nesac\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${mocks}:/usr/bin:/bin`, OSCAR_TEST_CHECKSUMS: checksums, OSCAR_TEST_ARCHIVE: archive };
  const installed = path.join(temporary, 'installed');
  await mkdir(path.join(installed,'.runtime'),{recursive:true});
  const location=JSON.stringify({version:1,dataDirectory:path.join(temporary,'external-data'),locationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  await writeFile(path.join(installed,'.runtime','installation.json'),location);
  const result = await exec('/bin/sh', [path.join(source, 'install.sh'), '--engine', 'claude', '--dir', installed, '--skip-login', '--no-open'], { cwd: source, env });
  assert.match(result.stdout, /SIMULATED_RUNTIME_OK/);
  await access(path.join(installed, '.runtime', 'bin', 'node'));
  assert.equal(await readFile(path.join(installed,'.runtime','installation.json'),'utf8'),location,'Preparing portable Node must preserve the chosen data location.');
  await writeFile(checksums, `${'0'.repeat(64)}  node-v24.999.0-linux-x64.tar.gz\n`);
  const rejected = path.join(temporary, 'rejected');
  await assert.rejects(exec('/bin/sh', [path.join(source, 'install.sh'), '--engine', 'codex', '--dir', rejected, '--skip-login', '--no-open'], { cwd: source, env }), error => /ne correspond pas à sa somme officielle/.test(error.stderr));
  await assert.rejects(access(path.join(rejected, '.runtime')));
});

test('preferences are stored with the documents and leave missions and obsolete local settings untouched', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-documents-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const home = path.join(temporary, 'person');
  const project = path.join(temporary, 'application');
  const documents = path.join(home, 'Documents', 'Oscar et les agents');
  await mkdir(path.join(documents, 'missions'), { recursive: true });
  await mkdir(path.join(project, 'data'), { recursive: true });
  await writeFile(path.join(documents, 'missions', 'conserver.txt'), 'Mission à conserver');
  await writeFile(path.join(project, 'data', 'preferences.json'), '{"ancien":true}');
  const state = fixture({ root: project, home, env: { PATH: '/bin' } });
  delete state.dependencies.savePreferences;
  await runInstaller(parseArgs(['--engine', 'claude', '--skip-login', '--no-open']), state.dependencies);
  assert.deepEqual(JSON.parse(await readFile(path.join(documents, 'preferences.json'), 'utf8')), { preferredProvider: 'claude', setupComplete: true });
  assert.equal(await readFile(path.join(documents, 'missions', 'conserver.txt'), 'utf8'), 'Mission à conserver');
  assert.equal(await readFile(path.join(project, 'data', 'preferences.json'), 'utf8'), '{"ancien":true}');
  assert.equal(resolveInstallerDataDirectory({ env: {}, home }), documents);
});

test('installer data overrides remain compatible and reach the existing preferences dependency', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-preferences-override-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const override = path.join(temporary, 'custom-documents');
  const state = fixture({ env: { PATH: '/bin', OSCAR_DATA_DIR: override, ATELIER_DATA_DIR: path.join(temporary, 'obsolete') } });
  let received;
  state.dependencies.savePreferences = async (project, preferences, location) => { received = { project, preferences, location }; };
  await runInstaller(parseArgs(['--engine', 'codex', '--skip-login', '--no-open']), state.dependencies);
  assert.deepEqual(received, { project: '/a/project', preferences: { preferredProvider: 'codex', setupComplete: true }, location: { dataDir: override, preservePreferredProvider: false } });
  assert.equal(resolveInstallerDataDirectory({ env: { ATELIER_DATA_DIR: override } }), override);
  delete state.dependencies.savePreferences;
  await runInstaller(parseArgs(['--engine', 'codex', '--skip-login', '--no-open']), state.dependencies);
  assert.equal(JSON.parse(await readFile(path.join(override, 'preferences.json'), 'utf8')).preferredProvider, 'codex');
});

test('reinstalling both engines preserves the preferred engine and unknown preferences; an explicit engine changes only that choice', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-preferences-upgrade-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'preferences.json');
  const unknownPreference = { futureOption: ['conserver', 42] };
  await writeFile(target, JSON.stringify({ preferredProvider: 'claude', setupComplete: true, unknownPreference }));
  const state = fixture({ root: path.join(temporary, 'application'), env: { PATH: '/bin', OSCAR_DATA_DIR: temporary } });
  delete state.dependencies.savePreferences;
  const both = await runInstaller(parseArgs(['--engine', 'both', '--skip-login', '--no-open']), state.dependencies);
  assert.equal(both.preferredProvider, 'claude');
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { preferredProvider: 'claude', setupComplete: true, unknownPreference });
  const codex = await runInstaller(parseArgs(['--engine', 'codex', '--skip-login', '--no-open']), state.dependencies);
  assert.equal(codex.preferredProvider, 'codex');
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { preferredProvider: 'codex', setupComplete: true, unknownPreference });
});

test('unreadable existing preferences fail safely instead of replacing their contents', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-preferences-invalid-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'preferences.json');
  const original = '{"preferredProvider":"claude", unfinished';
  await writeFile(target, original);
  const state = fixture({ root: path.join(temporary, 'application'), env: { PATH: '/bin', OSCAR_DATA_DIR: temporary } });
  delete state.dependencies.savePreferences;
  await assert.rejects(runInstaller(parseArgs(['--engine', 'both', '--skip-login', '--no-open']), state.dependencies), /préférences existantes ne peuvent pas être lues/);
  assert.equal(await readFile(target, 'utf8'), original);
  assert.deepEqual(await readdir(temporary), ['preferences.json']);
});

test('a preferences write failure preserves the original file and leaves no temporary file', async t => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('Requires POSIX permissions for a non-root account.');
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-preferences-write-'));
  t.after(async () => { await chmod(temporary, 0o700); await rm(temporary, { recursive: true, force: true }); });
  const target = path.join(temporary, 'preferences.json');
  const original = '{"preferredProvider":"claude","keep":"unchanged"}\n';
  await writeFile(target, original);
  await chmod(temporary, 0o500);
  const state = fixture({ root: path.join(temporary, 'application'), env: { PATH: '/bin', OSCAR_DATA_DIR: temporary } });
  delete state.dependencies.savePreferences;
  await assert.rejects(runInstaller(parseArgs(['--engine', 'both', '--skip-login', '--no-open']), state.dependencies), { code: 'EACCES' });
  assert.equal(await readFile(target, 'utf8'), original);
  assert.deepEqual(await readdir(temporary), ['preferences.json']);
});

test('a real source reinstall with spaces preserves preferences, missions and connection metadata without login or network', async t => {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'oscar-upgrade espaces-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'source avec espaces');
  const destination = path.join(temporary, 'application avec espaces');
  const documents = path.join(temporary, 'documents avec espaces');
  const tools = path.join(destination, '.tools', 'node_modules', '.bin');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  await mkdir(path.join(source, 'lib'));
  await mkdir(tools, { recursive: true });
  await mkdir(path.join(documents, 'missions'), { recursive: true });
  for (const file of ['package.json', 'install.sh', 'scripts/install.mjs', 'lib/state-stream.mjs','lib/installation-paths.mjs']) await writeFile(path.join(source, file), await readFile(path.join(root, file)));
  await writeFile(path.join(source, 'server.mjs'), '// Installation fixture; no server is started.\n');
  const fakeEngine = '#!/bin/sh\ncase "$1" in\n --version) case "$0" in *claude) echo "2.1.303";; *) echo "codex-cli 0.130.0";; esac;;\n --help) echo "--restricted --output-format --verbose --permission-mode --tools --allowedTools --strict-mcp-config";;\n exec) echo "--json --sandbox --color --skip-git-repo-check --output-schema";;\n *) echo "Login and model calls are forbidden in this test" >&2; exit 97;;\nesac\n';
  for (const provider of ['codex', 'claude']) await writeFile(path.join(tools, provider), fakeEngine, { mode: 0o755 });
  const preferences = { preferredProvider: 'claude', setupComplete: true, futureSetting: { keep: 'exactly' } };
  await writeFile(path.join(documents, 'preferences.json'), JSON.stringify(preferences));
  const sentinels = ['missions/existing.txt', 'connectors.json', 'automations.json'];
  for (const file of sentinels) await writeFile(path.join(documents, file), `KEEP ${file}\n`);
  const portProbe=net.createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, OSCAR_DATA_DIR: documents, PORT:String(port) };
  for (let pass = 0; pass < 2; pass++) {
    const result = await exec('/bin/sh', [path.join(source, 'install.sh'), '--engine', 'both', '--dir', destination, '--skip-login', '--no-open'], { cwd: source, env });
    assert.match(result.stdout, /Installation terminée/);
    assert.doesNotMatch(result.stdout, /Téléchargement|Installation locale de/);
    assert.deepEqual(JSON.parse(await readFile(path.join(documents, 'preferences.json'), 'utf8')), preferences);
    for (const file of sentinels) assert.equal(await readFile(path.join(documents, file), 'utf8'), `KEEP ${file}\n`);
    assert.deepEqual(await readFile(path.join(destination, 'lib/state-stream.mjs')), await readFile(path.join(source, 'lib/state-stream.mjs')));
  }
});
