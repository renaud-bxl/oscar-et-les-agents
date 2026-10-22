import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {codexArguments} from '../lib/codex-compat.mjs';
import {runInstaller} from '../scripts/install.mjs';

test('command-local compatibility preserves explicit effort, models and permissions without mutating arguments',()=>{
  const args=['-a','never','--model','chosen-model','exec','--sandbox','workspace-write','-'];
  const before=[...args],resolved=codexArguments(args);
  assert.deepEqual(args,before);assert.deepEqual(resolved.slice(2),args);
  assert.deepEqual(resolved.slice(0,2),['-c','model_reasoning_effort="medium"']);
  for(const config of[['-c','model_reasoning_effort="high"'],['--config','model_reasoning_effort="xhigh"'],['--config=model_reasoning_effort="medium"']]){
    const explicit=[...config,...args];assert.deepEqual(codexArguments(explicit),explicit);
  }
  assert.deepEqual(codexArguments(resolved),resolved);
  assert.throws(()=>codexArguments(['login',null]),TypeError);
});

test('a real child CLI rejecting shared ultra config completes both-engine setup with existing subscriptions',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'oscar-cli-compat-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const root=path.join(base,'software'),home=path.join(base,'home'),config=path.join(home,'.codex'),log=path.join(base,'commands.jsonl');
  await mkdir(root);await mkdir(config,{recursive:true});
  const original='model = "chosen-model"\nmodel_reasoning_effort = "ultra"\n';
  await writeFile(path.join(config,'config.toml'),original);
  const binary=async provider=>{
    const file=path.join(base,provider);
    await writeFile(file,`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2),provider=${JSON.stringify(provider)};
const status=args.includes('status');
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({provider,args,home:process.env.HOME,codexHome:process.env.CODEX_HOME})+'\\n');
if(args.includes('--version'))console.log(provider==='codex'?'codex-cli 0.162.0':'2.1.303');
else if(args.includes('--help'))console.log(provider==='codex'?'--json --sandbox --color --skip-git-repo-check --output-schema':'--restricted --output-format --verbose --permission-mode --tools --allowedTools --strict-mcp-config');
else if(provider==='codex'&&!args.includes('model_reasoning_effort="medium"')){console.error('Error loading configuration: unknown variant ultra');process.exitCode=1;}
else if(status)console.log(provider==='codex'?'Logged in using ChatGPT':JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));
else{console.error('Unexpected login, model call or installation');process.exitCode=99;}
`,{mode:0o755});return file;
  };
  const binaries={codex:await binary('codex'),claude:await binary('claude')};
  const result=await runInstaller({engine:'both',noOpen:true},{root,home,platform:'linux',nodePath:process.execPath,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:config},findBinary:async name=>binaries[name],log:()=>{},createShortcut:async()=>{},interactive:async()=>assert.fail('Existing subscriptions must never reopen login or install a package')});
  assert.equal(result.setupComplete,true);assert.deepEqual(result.install,[]);
  assert.equal(await readFile(path.join(config,'config.toml'),'utf8'),original);
  const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  const status=calls.filter(call=>call.args.includes('status'));assert.equal(status.length,2);
  assert.deepEqual(status.find(call=>call.provider==='codex').args,['-c','model_reasoning_effort="medium"','login','status']);
  assert.deepEqual(status.find(call=>call.provider==='claude').args,['auth','status']);
  for(const call of calls){assert.equal(call.home,home);assert.equal(call.codexHome,config);}
});
