import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Connectors,GMAIL_MCP_URL} from '../lib/connectors.mjs';
import {readConnectorArguments} from '../lib/providers.mjs';

const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const fakeProbe=String.raw`
const fs=require('node:fs'),{spawn}=require('node:child_process');
const worker=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.send("ready");setInterval(()=>{},1000)',process.env.TEST_WORKER_PID],{stdio:['ignore','ignore','ignore','ipc']});
worker.once('message',()=>{
  worker.disconnect();let buffer='';
  process.stdin.on('data',chunk=>{buffer+=chunk;let end;
    while((end=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      if(frame.method&&frame.id!==undefined)console.log(JSON.stringify({id:frame.id,result:frame.method==='app/installed'?{apps:[]}:frame.method==='mcpServerStatus/list'?{data:[],nextCursor:null}:{}}));
      else if(frame.type==='control_request')console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:frame.request.subtype==='mcp_status'?{mcpServers:[]}:{} }}));
    }
  });
});`;

test('metadata probes kill a resistant descendant even after the CLI and the standalone caller naturally close',{skip:process.platform==='win32'},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'oscar-probe-group-'));
  const binary=join(directory,'fake-probe');
  const moduleURL=new URL('../lib/connector-clients.mjs',import.meta.url).href;
  const pids=[];
  t.after(async()=>{for(const pid of pids)try{process.kill(pid,'SIGKILL');}catch{}await rm(directory,{recursive:true,force:true});});
  await writeFile(binary,`#!${process.execPath}\n${fakeProbe}`,{mode:0o700});
  for(const name of ['inspectCodexApps','inspectClaudeConnectors']){
    const pidFile=join(directory,name+'.pid');
    const helper=join(directory,name+'.mjs');
    await writeFile(helper,`import {${name}} from ${JSON.stringify(moduleURL)};await ${name}({binary:${JSON.stringify(binary)},cwd:${JSON.stringify(directory)},env:{TEST_WORKER_PID:${JSON.stringify(pidFile)}},timeoutMs:2000,pollIntervalMs:10});`);
    // A separate Node caller has no testing timers keeping an unref'ed group
    // escalation alive after the inspected parent has exited.
    const child=spawn(process.execPath,[helper],{stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const pid=Number(await readFile(pidFile,'utf8'));pids.push(pid);
    assert.equal(code,0,stderr);
    for(let attempt=0;attempt<30&&alive(pid);attempt++)await delay(20);
    assert.equal(alive(pid),false,`${name} left its dedicated worker alive`);
  }
});

test('runner and connector command timeouts retain their group escalation until a standalone caller naturally exits',{skip:process.platform==='win32'},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'oscar-runner-group-'));
  const bin=join(directory,'bin'),mission=join(directory,'mission');
  await Promise.all([mkdir(bin),mkdir(mission)]);
  const fake=String.raw`const fs=require('node:fs'),{spawn}=require('node:child_process'),args=process.argv.slice(2);
if(args.includes('--version'))console.log('codex-cli 0.162.0');
else if(args.includes('--help'))console.log('--json --sandbox --color --skip-git-repo-check --search');
else{process.stdin.resume();process.stdin.on('end',()=>{spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',process.env.TEST_WORKER_PID],{stdio:'ignore'});setInterval(()=>{},1000);});}`;
  await writeFile(join(bin,'codex'),`#!${process.execPath}\n${fake}`,{mode:0o700});
  const providersURL=new URL('../lib/providers.mjs',import.meta.url).href,connectorsURL=new URL('../lib/connectors.mjs',import.meta.url).href,pids=[];
  t.after(async()=>{for(const pid of pids)try{process.kill(pid,'SIGKILL');}catch{}await rm(directory,{recursive:true,force:true});});
  const sources={
    runner:`import {runAgent} from ${JSON.stringify(providersURL)};try{await runAgent({provider:'codex',cwd:${JSON.stringify(mission)},prompt:'Mission simulée',timeoutMs:1200});throw new Error('Expected timeout');}catch(error){if(error.name!=='TimeoutError')throw error;}`,
    connector:`import {Connectors} from ${JSON.stringify(connectorsURL)};const manager=new Connectors({dataDir:${JSON.stringify(mission)}});try{await manager.process(${JSON.stringify(join(bin,'codex'))},[],{cwd:${JSON.stringify(mission)},timeoutMs:1000});throw new Error('Expected interruption');}catch(error){if(error.code!=='CONNECTOR_INVALID')throw error;}finally{await manager.close();}`,
  };
  for(const[name,source]of Object.entries(sources)){
    const helper=join(directory,name+'.mjs'),pidFile=join(directory,name+'.pid');await writeFile(helper,source);
    const child=spawn(process.execPath,[helper],{env:{...process.env,PATH:bin,TEST_WORKER_PID:pidFile},stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const pid=Number(await readFile(pidFile,'utf8'));pids.push(pid);assert.equal(code,0,stderr);
    for(let attempt=0;attempt<30&&alive(pid);attempt++)await delay(20);
    assert.equal(alive(pid),false,`${name} left its dedicated worker alive`);
  }
});

test('Connectors.close stops the initial MCP listing and completes its group cleanup before an explicit caller exit',{skip:process.platform==='win32'},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'oscar-close-group-')),binary=join(directory,'fake-probe'),pidFile=join(directory,'worker.pid'),helper=join(directory,'close.mjs');
  const connectorsURL=new URL('../lib/connectors.mjs',import.meta.url).href;
  let pid;
  t.after(async()=>{if(pid)try{process.kill(pid,'SIGKILL');}catch{}await rm(directory,{recursive:true,force:true});});
  await writeFile(binary,`#!${process.execPath}\n${fakeProbe}`,{mode:0o700});
  await writeFile(helper,`import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{setTimeout as delay}from'node:timers/promises';import{Connectors}from ${JSON.stringify(connectorsURL)};
const manager=new Connectors({dataDir:${JSON.stringify(directory)},find:async()=>${JSON.stringify(binary)},env:{TEST_WORKER_PID:${JSON.stringify(pidFile)}},appInspector:async()=>{throw new Error('The closed listing must not start another discovery');},probeTimeoutMs:10000});
manager.detected.codex=[{name:'previous-service'}];const inspection=manager.inspect('codex');let ready=false;for(let attempt=0;attempt<200;attempt++){try{await readFile(${JSON.stringify(pidFile)},'utf8');ready=true;break;}catch{await delay(10);}}assert.ok(ready);
const closing=manager.close();assert.equal(closing,manager.close());await closing;await inspection;assert.deepEqual(manager.detected.codex,[{name:'previous-service'}]);assert.equal(manager.processes.size,0);process.exit(0);`);
  const child=spawn(process.execPath,[helper],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  pid=Number(await readFile(pidFile,'utf8'));assert.equal(code,0,stderr);
  for(let attempt=0;attempt<30&&alive(pid);attempt++)await delay(20);
  assert.equal(alive(pid),false,'The explicit exit after close left a listing descendant alive');
});

// Minimal fixture for the documented CLI override grammar: dots in a key path
// select nested fields, while a quoted inline table key preserves literal dots.
function consumeMcpOverrides(config,args){
  const overrides={};
  for(let index=0;index<args.length;index++)if(args[index]==='-c'){
    const argument=args[++index];
    const table=argument.match(/^mcp_servers=\{(.*)\}$/);
    if(table){
      // Assigning the same CLI key twice replaces the earlier override value.
      // The overrides are then merged into the file-backed configuration.
      overrides.mcp_servers=Object.fromEntries([...table[1].matchAll(/("(?:[^"\\]|\\.)*")=\{enabled=false\}/g)].map(match=>[JSON.parse(match[1]),{enabled:false}]));
      continue;
    }
    const setting=argument.match(/^(mcp_servers\.[^=]+)=(.*)$/);
    if(!setting)continue;
    const parts=setting[1].split('.');let parent=overrides;
    for(const part of parts.slice(0,-1))parent=parent[part]||=(Object.create(null));
    try{parent[parts.at(-1)]=JSON.parse(setting[2]);}catch{parent[parts.at(-1)]=setting[2];}
  }
  const merge=(target,source)=>{for(const[key,value]of Object.entries(source))if(value&&typeof value==='object'&&!Array.isArray(value))merge(target[key]||=(Object.create(null)),value);else target[key]=value;};
  merge(config,overrides);
}

test('one local read override excludes two exact dotted servers and a simple server together',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'oscar-server-key-'));
  const manager=new Connectors({dataDir:directory,find:async()=>'/fake/codex',appInspector:async()=>[],run:async(binary,args)=>({code:0,stdout:args.includes('get')?JSON.stringify({name:'gmail',transport:{type:'streamable_http',url:GMAIL_MCP_URL}}):JSON.stringify(['gmail','other.service','other.two','simple'].map(name=>({name,auth_status:'OAuth'})))})});
  t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});
  const plan=await manager.readPlan({name:'gmail'});
  const config={mcp_servers:{gmail:{url:GMAIL_MCP_URL},'other.service':{url:'https://example.invalid/mcp',enabled:true},'other.two':{url:'https://example.invalid/second',enabled:true},simple:{url:'https://example.invalid/simple',enabled:true},other:{service:{enabled:true}}}};
  consumeMcpOverrides(config,readConnectorArguments(plan));
  assert.equal(config.mcp_servers['other.service'].enabled,false);
  assert.equal(config.mcp_servers['other.two'].enabled,false);
  assert.equal(config.mcp_servers.simple.enabled,false);
  assert.equal(config.mcp_servers['other.service'].url,'https://example.invalid/mcp');
  assert.equal(config.mcp_servers.other.service.enabled,true);
  assert.equal(config.mcp_servers.gmail.enabled,true);
  assert.equal(config.mcp_servers.gmail.url,GMAIL_MCP_URL);
});
