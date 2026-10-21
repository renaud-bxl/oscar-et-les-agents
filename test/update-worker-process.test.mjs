import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {prepareUpdate,spawnUpdateWorker,UPDATE_REPOSITORY} from '../scripts/update.mjs';

test('the detached updater really starts and verifies a new local process without an AI engine or account', {timeout:30000},async t=>{
  const base=await realpath(await mkdtemp(path.join(os.tmpdir(),'oscar-real-update-'))),root=path.join(base,'installation'),dataDir=path.join(base,'documents');await mkdir(root);await mkdir(dataDir);
  let serverPid,workerPid;
  t.after(async()=>{
    if(!serverPid)try{serverPid=Number(await readFile(path.join(dataDir,'fixture-server.pid'),'utf8'));}catch{}
    for(const pid of [serverPid,workerPid])if(pid)try{process.kill(-pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
    await rm(base,{recursive:true,force:true});
  });
  const bytes=new Map();
  for(const version of ['0.6.9','0.6.10']){
    const prefix=`oscar-et-les-agents-${version}`,folder=path.join(base,prefix);await mkdir(folder);
    const files={
      'package.json':JSON.stringify({name:'oscar-et-les-agents',version,type:'module'}),
      'server.mjs':`import http from 'node:http';import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(process.env.OSCAR_DATA_DIR,'fixture-server.pid'),String(process.pid));const version=${JSON.stringify(version)};http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'oscar-et-les-agents',version,pid:process.pid,restartId:process.env.OSCAR_UPDATE_RESTART_ID||null}));}).listen(Number(process.env.PORT),'127.0.0.1');`,
      'launch.mjs':'// No browser or engine is launched by this test.',
      'public/index.html':'<!doctype html><title>Local updater fixture</title>',
      'lib/orchestrator.mjs':'// No model.',
      'scripts/install.mjs':'// No installer or login.'
    };
    for(const [file,content] of Object.entries(files)){
      await mkdir(path.dirname(path.join(folder,file)),{recursive:true});await writeFile(path.join(folder,file),content);
      if(version==='0.6.9'){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);}
    }
    const archive=path.join(base,version+'.tar.gz');await promisify(execFile)('tar',['--format=ustar','-czf',archive,'-C',base,prefix]);bytes.set(version,await readFile(archive));
  }
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const config=await prepareUpdate({root,currentVersion:'0.6.9',release:{version:'0.6.10',tag:'v0.6.10'},dataDir,port,parentPid:0,workspaceParent:base,fetchImpl:async url=>{
    assert.ok(url.startsWith(`https://codeload.github.com/${UPDATE_REPOSITORY}/tar.gz/refs/tags/v`));const version=url.split('/v').at(-1);assert.ok(bytes.has(version));return new Response(bytes.get(version));
  }});
  ({pid:workerPid}=await spawnUpdateWorker(config));
  let receipt;
  for(let attempt=0;attempt<150;attempt++){
    try{receipt=JSON.parse(await readFile(path.join(dataDir,'app-updates','result.json'),'utf8'));}catch{}
    if(['updated','rolled_back','error'].includes(receipt?.status))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const response=await fetch(`http://127.0.0.1:${port}/api/updates/health`,{signal:AbortSignal.timeout(1000)});const health=await response.json();serverPid=health.pid;
  assert.equal(receipt.status,'updated');assert.equal(health.version,'0.6.10');assert.equal(health.restartId,config.restartId);assert.notEqual(serverPid,process.pid);assert.notEqual(serverPid,workerPid);
  assert.equal(JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,'0.6.10');
});
