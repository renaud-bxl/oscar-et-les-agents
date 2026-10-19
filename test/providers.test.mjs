import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { detectProviders, runAgent } from '../lib/providers.mjs';

const fakeSource = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const provider = process.argv[1].endsWith('codex') ? 'codex' : 'claude';
if (args.includes('--version')) {
  console.log(provider === 'codex' ? 'codex-cli 0.162.0-alpha.17.2' : (process.env.FAKE_OLD ? '2.1.200' : '2.1.303 (Claude Code)'));
} else if (args.includes('--help')) {
  console.log(provider === 'codex' ? '--json --sandbox --color --skip-git-repo-check --output-schema' + (process.env.FAKE_NO_SEARCH ? '' : ' --search') : '--restricted --output-format --verbose --permission-mode "manual" "dontAsk" --permission-prompts --tools --allowedTools --strict-mcp-config --json-schema');
} else if (args.includes('status')) {
  if (provider === 'codex') console.error('Logged in using ChatGPT');
  else console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', neverExpose: 'sk-status-secret' }));
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    const schemaIndex = args.indexOf('--output-schema');
    fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ provider, args, input, cwd: process.cwd(), apiKeysPresent: ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'].some(key => Boolean(process.env[key])), schema: schemaIndex >= 0 ? JSON.parse(fs.readFileSync(args[schemaIndex + 1], 'utf8')) : null }));
    const emit = value => console.log(JSON.stringify(value));
    const mode = process.env.FAKE_MODE || 'ok';
    if (mode === 'hang') {
      const worker = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.env.FAKE_PID + ".ready", "1"); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      fs.writeFileSync(process.env.FAKE_PID, String(worker.pid));
      setInterval(() => {}, 1000);
      return;
    }
    if (mode === 'malformed') { process.stdout.write('{"type":"result",secret-sk-NEVER-LEAK'); return; }
    if (mode === 'missing-terminal') { emit({ type: 'item.completed', item: { type: 'agent_message', text: 'Réponse partielle' } }); return; }
    if (mode === 'auth') {
      if (provider === 'codex') emit({ type: 'turn.failed', error: { message: 'OAuth token expired sk-NEVER-LEAK' } });
      else emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['OAuth token expired sk-NEVER-LEAK'] });
      process.exitCode = 1;
      return;
    }
    if (mode === 'exit-error') { console.error('rate limit 429 secret-sk-NEVER-LEAK'); process.exitCode = 1; return; }
    if (mode === 'permission') { emit({ type: 'result', subtype: 'success', result: 'Terminé', permission_denials: [{ tool_name: 'Write' }] }); return; }
    if (mode === 'unicode') {
      const content = Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Été 🌿'}}) + '\n' + JSON.stringify({type:'turn.completed',usage:{input_tokens:1}}));
      const offset = content.indexOf(Buffer.from('🌿')) + 2;
      process.stdout.write(content.subarray(0, offset));
      setTimeout(() => process.stdout.end(content.subarray(offset)), 15);
      return;
    }
    if (provider === 'codex') {
      emit({ type: 'thread.started', thread_id: 'fake-thread' });
      emit({ type: 'turn.started' });
      emit({ type: 'item.started', item: {type:'reasoning',text:'private thought never shown'} });
      emit({ type: 'item.started', item: {type:'web_search',query:'private query never shown'} });
      emit({ type: 'item.completed', item: {type:'agent_message',text:'Livrable prêt'} });
      emit({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
    } else {
      emit({ type: 'system', subtype: 'init' });
      emit({ type: 'assistant', message: {content:[{type:'thinking',thinking:'private thought never shown'},{type:'tool_use',name:'WebSearch',input:{query:'private query never shown'}},{type:'text',text:'Brouillon'}]} });
      emit({ type: 'result', subtype: 'success', result: 'Livrable Claude prêt', ...(args.includes('--json-schema') ? {structured_output:{answer:'structuré'}} : {}), usage: { input_tokens: 12, output_tokens: 6 } });
    }
  });
}
`;

async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'oscar-provider-test-'));
  const bin = join(directory, 'bin');
  const cwd = join(directory, 'mission');
  await Promise.all([mkdir(bin), mkdir(cwd)]);
  await Promise.all(['codex', 'claude'].map(name => writeFile(join(bin, name), `#!${process.execPath}\n${fakeSource}`, { mode: 0o700 })));
  const keys = ['PATH', 'FAKE_CAPTURE', 'FAKE_MODE', 'FAKE_PID', 'FAKE_OLD', 'FAKE_NO_SEARCH', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.PATH = bin;
  process.env.FAKE_CAPTURE = join(directory, 'capture.json');
  process.env.FAKE_PID = join(directory, 'worker.pid');
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_OLD;
  delete process.env.FAKE_NO_SEARCH;
  try {
    await fn({ cwd, directory, capture: async () => JSON.parse(await readFile(process.env.FAKE_CAPTURE, 'utf8')) });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test('détection : expose une connexion enregistrée sans certifier sa validité ni exposer les sorties', async () => {
  await fixture(async () => {
    const providers = await detectProviders();
    assert.deepEqual(providers.map(info => info.id), ['codex', 'claude']);
    for (const info of providers) {
      assert.equal(info.available, true);
      assert.equal(info.auth.loggedIn, true);
      assert.match(info.message, /validité.*confirmée/);
      assert.equal('binary' in info, false);
      assert.equal('help' in info, false);
    }
    assert.doesNotMatch(JSON.stringify(providers), /sk-status-secret/);
    assert.equal(providers.find(info => info.id === 'claude').auth.method, 'subscription');
  });
});

test('refuse Claude ancien avant toute mission', async () => {
  await fixture(async ({ cwd, directory }) => {
    process.env.FAKE_OLD = '1';
    await assert.rejects(runAgent({provider:'claude',cwd,prompt:'Mission'}), /mise à jour/);
    assert.equal((await readdir(directory)).includes('capture.json'), false);
  });
});

test('Codex : prompt stdin, configuration par défaut, sandbox, nettoyage du schéma et usage', async () => {
  await fixture(async ({ cwd, capture }) => {
    process.env.OPENAI_API_KEY = 'sk-NEVER-LEAK';
    process.env.CODEX_API_KEY = 'sk-NEVER-LEAK';
    const activities = [];
    const schema = {type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};
    const result = await runAgent({provider:'codex',cwd,prompt:'Une mission avec $() et `texte` littéraux.',schema,onActivity:value => activities.push(value)});
    assert.deepEqual(result, {text:'Livrable prêt',usage:{input_tokens:10,output_tokens:5}});
    const invocation = await capture();
    assert.equal(invocation.input, 'Une mission avec $() et `texte` littéraux.');
    assert.equal(invocation.cwd, await realpath(cwd));
    assert.equal(invocation.apiKeysPresent, false);
    assert.deepEqual(invocation.args.slice(0, 4), ['-a','never','--search','exec']);
    assert.equal(invocation.args.at(-1), '-');
    assert.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], 'workspace-write');
    assert.deepEqual(invocation.schema, schema);
    assert.equal((await readdir(cwd)).some(file => file.startsWith('.oscar-schema-')), false);
    assert.doesNotMatch(invocation.args.join(' '), /--model|--ignore|bypass|danger-full/);
    assert.ok(activities.includes('Recherche sur le Web'));
    assert.doesNotMatch(activities.join(' '), /private|thought|query/);
  });
});

test('Codex : utilise la configuration officielle live si le drapeau search est absent', async () => {
  await fixture(async ({ cwd, capture }) => {
    process.env.FAKE_NO_SEARCH = '1';
    await runAgent({provider:'codex',cwd,prompt:'Rechercher une source actuelle'});
    const invocation = await capture();
    assert.deepEqual(invocation.args.slice(0, 5), ['-a','never','-c','web_search="live"','exec']);
  });
});

test('Codex : décode les caractères multioctets et accepte une dernière ligne sans saut', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'unicode';
    const result = await runAgent({provider:'codex',cwd,prompt:'Mission',readOnly:true});
    assert.equal(result.text, 'Été 🌿');
  });
});

test('Claude : limite les outils, refuse les prompts de permission et restitue le résultat structuré', async () => {
  await fixture(async ({ cwd, capture }) => {
    process.env.ANTHROPIC_API_KEY = 'sk-NEVER-LEAK';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'secret';
    const activities = [];
    const result = await runAgent({provider:'claude',cwd,prompt:'Mission',readOnly:true,schema:{type:'object'},onActivity:value => activities.push(value)});
    assert.equal(result.text, '{"answer":"structuré"}');
    const invocation = await capture();
    assert.equal(invocation.apiKeysPresent, false);
    assert.ok(invocation.args.includes('--restricted'));
    assert.equal(invocation.args[invocation.args.indexOf('--permission-mode')+1], 'manual');
    assert.equal(invocation.args[invocation.args.indexOf('--permission-prompts')+1], 'none');
    const tools = invocation.args[invocation.args.indexOf('--tools')+1].split(',');
    assert.deepEqual(tools, ['Read','Glob','Grep','WebSearch','WebFetch']);
    assert.doesNotMatch(invocation.args.join(' '), /--model|Bash|Agent|bypass|skip-permissions/);
    assert.ok(activities.includes('Recherche sur le Web'));
    assert.doesNotMatch(activities.join(' '), /private|thought|query/);
  });
});

for (const provider of ['codex', 'claude']) {
  test(`${provider} : transforme un OAuth expiré en erreur de reconnexion sans fuite`, async () => {
    await fixture(async ({ cwd }) => {
      process.env.FAKE_MODE = 'auth';
      await assert.rejects(runAgent({provider,cwd,prompt:'Mission'}), error => /connexion expirée/.test(error.message) && !/NEVER-LEAK/.test(error.message));
    });
  });
}

test('refuse les JSON tronqués et nettoie le schéma même en échec', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'malformed';
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission',schema:{type:'object'}}), error => /JSON invalide ou incomplet/.test(error.message) && !/NEVER-LEAK/.test(error.message));
    assert.equal((await readdir(cwd)).length, 0);
  });
});

test('une réponse sans événement terminal ne devient jamais un succès', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'missing-terminal';
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission'}), /confirmation finale/);
  });
});

test('un processus en échec reste un échec, même sans événement JSON', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'exit-error';
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission'}), error => /limite d’utilisation/.test(error.message) && !/NEVER-LEAK/.test(error.message));
  });
});

test('une écriture refusée par Claude ne valide pas le livrable', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'permission';
    await assert.rejects(runAgent({provider:'claude',cwd,prompt:'Mission'}), /permissions autorisées/);
  });
});

test('un signal déjà annulé ne lance pas de CLI', async () => {
  await fixture(async ({ cwd, directory }) => {
    await assert.rejects(runAgent({provider:'codex',cwd,prompt:'Mission',signal:AbortSignal.abort()}), {name:'AbortError'});
    assert.equal((await readdir(directory)).includes('capture.json'), false);
  });
});

test('annulation : termine le processus dédié et son descendant, puis nettoie le schéma', async () => {
  await fixture(async ({ cwd }) => {
    process.env.FAKE_MODE = 'hang';
    const controller = new AbortController();
    const run = runAgent({provider:'codex',cwd,prompt:'Mission',schema:{type:'object'},signal:controller.signal});
    // Attach the rejection handler before cancelling to avoid an unhandled rejection.
    const rejected = assert.rejects(run, {name:'AbortError'});
    let workerPid;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await readFile(`${process.env.FAKE_PID}.ready`, 'utf8');
        workerPid = Number(await readFile(process.env.FAKE_PID, 'utf8'));
        break;
      } catch { await delay(20); }
    }
    assert.ok(workerPid, 'Le faux moteur a démarré son descendant.');
    controller.abort();
    await rejected;
    let alive = true;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { process.kill(workerPid, 0); await delay(20); } catch { alive = false; break; }
    }
    assert.equal(alive, false, 'Le descendant reçoit aussi la terminaison.');
    assert.equal((await readdir(cwd)).length, 0);
  });
});
