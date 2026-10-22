import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,lstat,realpath,symlink,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import {AppUpdates} from '../lib/app-updates.mjs';
import {UPDATE_REPOSITORY,parseUpdateArchive,parseUpdateRelease,validUpdateVersion,compareUpdateVersions,updateBytes,inspectUpdateInstallation,prepareUpdate,releaseUpdateLock,runUpdateWorker,waitForUpdateParent} from '../scripts/update.mjs';

const oldVersion='0.6.9',newVersion='0.6.10';
const release=version=>({tag_name:'v'+version,draft:false,prerelease:false,html_url:`https://github.com/${UPDATE_REPOSITORY}/releases/tag/v${version}`,body:'Version stable publique.'});
function source(version){return new Map(Object.entries({'package.json':JSON.stringify({name:'oscar-et-les-agents',version}),'server.mjs':`// server ${version}`,'launch.mjs':'// launcher','public/index.html':'<!doctype html><title>Oscar</title>','lib/orchestrator.mjs':'// orchestration','scripts/install.mjs':'// installer','.gitignore':'data/\n.tools/\n.runtime/\n','.github/workflows/test.yml':'name: test'}));}
function archive(version,{entries,global=true}={}){
  const chunks=[],put=(name,body,type='0')=>{const bytes=Buffer.from(body),header=Buffer.alloc(512),oct=(value,length)=>value.toString(8).padStart(length-1,'0')+'\0';header.write(name,0,100,'utf8');header.write(oct(0o644,8),100,8,'ascii');header.write(oct(bytes.length,12),124,12,'ascii');header.fill(32,148,156);header[156]=type.charCodeAt(0);header.write('ustar\0',257,6,'ascii');header.write('00',263,2,'ascii');const sum=header.reduce((total,value)=>total+value,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));};
  if(global)put('pax_global_header','52 comment='+'a'.repeat(40)+'\n','g');
  for(const[name,body,type]of entries||[...source(version)].map(([name,body])=>[`oscar-et-les-agents-${version}/${name}`,body,'0']))put(name,body,type);
  return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
async function fixture(t,{fetchChange}={}){
  const base=await realpath(await mkdtemp(path.join(os.tmpdir(),'oscar-update-test-'))),root=path.join(base,'installation'),dataDir=path.join(base,'personal-data');await mkdir(root);await mkdir(dataDir);
  for(const[name,bytes]of source(oldVersion)){if(name.startsWith('.github/'))continue;await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),bytes);}
  for(const name of ['data','.tools','.runtime']){await mkdir(path.join(root,name));await writeFile(path.join(root,name,'personal.txt'),'PRESERVE-'+name);}
  await writeFile(path.join(root,'.runtime','installation.json'),JSON.stringify({version:1,dataDirectory:dataDir,locationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));
  await writeFile(path.join(root,'atelier.log'),'PRESERVE-LOG');await writeFile(path.join(dataDir,'missions.txt'),'PRESERVE-MISSIONS');
  const calls=[],fetchImpl=async(url,options)=>{calls.push({url,options});if(fetchChange)return fetchChange(url,options);if(url.endsWith('/releases/latest'))return new Response(JSON.stringify(release(newVersion)));if(url.endsWith('/v'+oldVersion))return new Response(archive(oldVersion));if(url.endsWith('/v'+newVersion))return new Response(archive(newVersion));throw new Error('No real network permitted');};
  const configs=[];t.after(async()=>{for(const config of configs)if(config.workspace)await rm(config.workspace,{recursive:true,force:true});await rm(base,{recursive:true,force:true});});
  const prepare=async options=>{const config=await prepareUpdate({root,currentVersion:oldVersion,release:parseUpdateRelease(release(newVersion)),dataDir,port:54321,fetchImpl,...options});configs.push(config);return config;};
  return{root,dataDir,base,calls,fetchImpl,prepare,configs};
}
const versionAt=async root=>JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
async function preserved(f){for(const name of ['data','.tools','.runtime'])assert.equal(await readFile(path.join(f.root,name,'personal.txt'),'utf8'),'PRESERVE-'+name);assert.equal(JSON.parse(await readFile(path.join(f.root,'.runtime','installation.json'),'utf8')).dataDirectory,f.dataDir);assert.equal(await readFile(path.join(f.root,'atelier.log'),'utf8'),'PRESERVE-LOG');assert.equal(await readFile(path.join(f.dataDir,'missions.txt'),'utf8'),'PRESERVE-MISSIONS');}
function workerDependencies(f,changes={}){return{waitParent:async()=>assert.equal(await versionAt(f.root),oldVersion),ensurePortFree:async()=>{},start:async()=>({pid:123456}),stop:async()=>{},checkHealth:async(config,child,version)=>{assert.equal(await versionAt(f.root),version);return true;},...changes};}

test('stable release metadata and versions are strict and URLs come only from the official repository',()=>{
  for(const value of ['0.6.9','1.0.0','12.31.999'])assert.equal(validUpdateVersion(value),true);
  for(const value of ['v0.6.9','0.6','01.2.3','1.0.0-beta','1.0.0+build','1.2.3/path',NaN,null])assert.equal(validUpdateVersion(value),false);
  assert.equal(compareUpdateVersions(newVersion,oldVersion),1);assert.equal(compareUpdateVersions('1.0.0','1.0.0'),0);assert.equal(compareUpdateVersions('0.9.1','1.0.0'),-1);
  assert.equal(parseUpdateRelease(release(newVersion)).version,newVersion);
  for(const change of [{draft:true},{prerelease:true},{tag_name:'v1.0.0-beta'},{html_url:'https://evil.invalid/release'},{html_url:`https://github.com/other/project/releases/tag/v${newVersion}`}])assert.throws(()=>parseUpdateRelease({...release(newVersion),...change}),{code:'UPDATE_INVALID'});
});

test('the bounded tar reader accepts GitHub global commit metadata and rejects all links, traversal and overrides',()=>{
  const files=parseUpdateArchive(archive(newVersion),newVersion);assert.equal(files.has('public/index.html'),true);assert.equal(files.has('.github/workflows/test.yml'),false);assert.equal(files.has('.gitignore'),true);
  const entries=[...source(newVersion)].map(([name,body])=>[`oscar-et-les-agents-${newVersion}/${name}`,body,'0']);
  for(const bad of [[`oscar-et-les-agents-${newVersion}/../outside.txt`,'PRIVATE','0'],[`oscar-et-les-agents-${newVersion}/public/link`,'','2'],[`oscar-et-les-agents-${newVersion}/public/hard`,'','1'],[`oscar-et-les-agents-${newVersion}/public/file`,'','x'],[`other-project-${newVersion}/file.js`,'bad','0'],[`oscar-et-les-agents-${newVersion}/server.mjs`,'duplicate','0']])assert.throws(()=>parseUpdateArchive(archive(newVersion,{entries:[...entries,bad]}),newVersion),{code:'UPDATE_INVALID'});
  assert.throws(()=>parseUpdateArchive(archive(oldVersion),newVersion),{code:'UPDATE_VERSION'});assert.throws(()=>parseUpdateArchive(Buffer.from('not gzip'),newVersion),{code:'UPDATE_INVALID'});
});

test('download limits and deadlines reject errors without redirects or an implicit retry',async()=>{
  let calls=0;await assert.rejects(updateBytes('https://api.github.com/example',{fetchImpl:async()=>{calls++;return new Response('error',{status:503});}}),{code:'UPDATE_NETWORK'});assert.equal(calls,1);
  await assert.rejects(updateBytes('https://api.github.com/example',{maxBytes:2,fetchImpl:async()=>new Response('too long')}),{code:'UPDATE_INVALID'});
  await assert.rejects(updateBytes('https://api.github.com/example',{timeoutMs:10,fetchImpl:async()=>new Promise(()=>{})}),{code:'UPDATE_NETWORK'});
});

test('preparation verifies baseline and exact target without changing code, data, engines or login files',async t=>{
  const f=await fixture(t),config=await f.prepare();assert.equal(await versionAt(f.root),oldVersion);assert.equal(await versionAt(path.join(config.workspace,'target')),newVersion);assert.ok(!config.workspace.startsWith(f.root+path.sep));assert.ok(config.backupDirectory.startsWith(path.join(f.dataDir,'app-updates','backups')+path.sep));
  const plan=JSON.stringify(config);assert.ok(!plan.includes('env'));assert.ok(!plan.includes('token'));assert.equal((await lstat(path.join(config.workspace,'worker.mjs'))).isFile(),true);assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'app-updates','update.lock'),'utf8')).restartId,config.restartId);await preserved(f);
  assert.deepEqual(f.calls.map(call=>call.url),[`https://codeload.github.com/${UPDATE_REPOSITORY}/tar.gz/refs/tags/v${oldVersion}`,`https://codeload.github.com/${UPDATE_REPOSITORY}/tar.gz/refs/tags/v${newVersion}`]);assert.ok(f.calls.every(call=>call.options.redirect==='error'));
});

test('unknown files, local edits, Git checkouts and symlinked roots refuse installation',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.root,'personal-notes.txt'),'PERSONAL');await assert.rejects(f.prepare(),{code:'UPDATE_FILES'});assert.equal(await versionAt(f.root),oldVersion);await rm(path.join(f.root,'personal-notes.txt'));
  await writeFile(path.join(f.root,'server.mjs'),'LOCAL EDIT');await assert.rejects(f.prepare(),{code:'UPDATE_FILES'});await writeFile(path.join(f.root,'server.mjs'),source(oldVersion).get('server.mjs'));
  await mkdir(path.join(f.root,'.git'));assert.equal((await inspectUpdateInstallation({root:f.root,currentVersion:oldVersion})).supported,false);await rm(path.join(f.root,'.git'),{recursive:true});
  const alias=path.join(f.base,'alias');await symlink(f.root,alias);assert.equal((await inspectUpdateInstallation({root:alias,currentVersion:oldVersion})).supported,false);await preserved(f);
});

test('a second preparation cannot bypass the durable lock',async t=>{
  const f=await fixture(t),first=await f.prepare();await assert.rejects(f.prepare(),{code:'UPDATE_BUSY'});assert.equal(await versionAt(f.root),oldVersion);await releaseUpdateLock(first);
});

test('the worker waits for the parent then replaces verified code and preserves a durable code-only backup',async t=>{
  const f=await fixture(t),config=await f.prepare();let waited=false;const outcome=await runUpdateWorker(config,workerDependencies(f,{waitParent:async()=>{assert.equal(await versionAt(f.root),oldVersion);waited=true;},start:async()=>{assert.equal(waited,true);return{pid:123456};}}));
  assert.equal(outcome.status,'updated');assert.equal(await versionAt(f.root),newVersion);assert.equal(await versionAt(config.backupDirectory),oldVersion);assert.equal((await readdir(config.backupDirectory)).includes('data'),false);await preserved(f);assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'app-updates','result.json'),'utf8')).status,'updated');await assert.rejects(lstat(path.join(f.dataDir,'app-updates','update.lock')),{code:'ENOENT'});
});

test('a failed exact startup check restores previous code and restarts it before reporting rollback',async t=>{
  const f=await fixture(t),config=await f.prepare(),starts=[],stops=[];const outcome=await runUpdateWorker(config,workerDependencies(f,{start:async value=>{starts.push(value.version);return{pid:123456+starts.length};},stop:async child=>stops.push(child.pid),checkHealth:async(value,child,version,options)=>{assert.equal(await versionAt(f.root),version);if(version===newVersion)return false;assert.equal(options.legacy,true);return true;}}));
  assert.equal(outcome.status,'rolled_back');assert.deepEqual(starts,[newVersion,oldVersion]);assert.deepEqual(stops,[123457]);assert.equal(await versionAt(f.root),oldVersion);assert.equal(await versionAt(config.backupDirectory),oldVersion);await preserved(f);
});

test('an unkillable new process prevents rollback writes while preserving the original backup',async t=>{
  const f=await fixture(t),config=await f.prepare();await assert.rejects(runUpdateWorker(config,workerDependencies(f,{checkHealth:async()=>false,stop:async()=>{throw new Error('Still running');}})),{code:'UPDATE_ROLLBACK'});assert.equal(await versionAt(f.root),newVersion);assert.equal(await versionAt(config.backupDirectory),oldVersion);await preserved(f);
});

test('a root swapped during parent shutdown never reads, removes or overwrites the replacement target',async t=>{
  const f=await fixture(t),config=await f.prepare(),outside=path.join(f.base,'outside'),oldRoot=f.root+'-old';await mkdir(outside);await writeFile(path.join(outside,'personal.txt'),'DO NOT TOUCH');let starts=0;
  await assert.rejects(runUpdateWorker(config,workerDependencies(f,{waitParent:async()=>{await rename(f.root,oldRoot);await symlink(outside,f.root);},start:async()=>{starts++;return{pid:1};}})),{code:'UPDATE_UNSUPPORTED'});
  assert.equal(starts,0);assert.equal(await readFile(path.join(outside,'personal.txt'),'utf8'),'DO NOT TOUCH');assert.deepEqual(await readdir(outside),['personal.txt']);assert.equal(await versionAt(oldRoot),oldVersion);
});

test('a root swapped before rollback cannot redirect the restoration outside the installation',async t=>{
  const f=await fixture(t),config=await f.prepare(),outside=path.join(f.base,'outside');await mkdir(outside);await writeFile(path.join(outside,'personal.txt'),'DO NOT TOUCH');
  await assert.rejects(runUpdateWorker(config,workerDependencies(f,{checkHealth:async()=>{await rename(f.root,f.root+'-new');await symlink(outside,f.root);return false;}})),{code:'UPDATE_ROLLBACK'});assert.deepEqual(await readdir(outside),['personal.txt']);assert.equal(await versionAt(config.backupDirectory),oldVersion);
});

test('a parent that has not stopped prevents all copying and all restart attempts',async t=>{
  const f=await fixture(t),config=await f.prepare();let starts=0;
  await assert.rejects(runUpdateWorker(config,workerDependencies(f,{waitParent:async()=>{throw Object.assign(new Error('Parent alive'),{code:'UPDATE_RESTART'});},start:async()=>{starts++;return{pid:1};}})),{code:'UPDATE_RESTART'});assert.equal(starts,0);assert.equal(await versionAt(f.root),oldVersion);
  let time=0;await assert.rejects(waitForUpdateParent(42,{alive:()=>true,now:()=>time,sleep:async()=>{time+=100;},timeoutMs:200}),{code:'UPDATE_RESTART'});
});

test('update checks are cached and state getters never cause network calls',async t=>{
  const f=await fixture(t),updater=new AppUpdates({root:f.root,currentVersion:oldVersion,dataDir:f.dataDir,fetchImpl:f.fetchImpl,requestShutdown:async()=>{},getPort:()=>54321});t.after(()=>updater.close());await updater.ready;assert.equal(f.calls.length,0);assert.equal(updater.state.currentVersion,oldVersion);assert.equal(f.calls.length,0);
  const checked=await updater.check();assert.equal(checked.status,'available');assert.equal(checked.canInstall,true);assert.equal(checked.latestVersion,newVersion);await updater.check();await updater.check({force:true});assert.equal(f.calls.length,1);
});

test('installation needs exact confirmation, rechecks busy work, and defers shutdown until after its return',async t=>{
  const f=await fixture(t),deferred=[],launched=[];let shutdowns=0,busy=[];
  const updater=new AppUpdates({root:f.root,currentVersion:oldVersion,dataDir:f.dataDir,fetchImpl:f.fetchImpl,getBusyReasons:()=>busy,getPort:()=>54321,requestShutdown:async()=>{shutdowns++;},defer:action=>deferred.push(action),prepare:async options=>{const value=await f.prepare(options);return value;},launch:async config=>{launched.push(config);}});t.after(()=>updater.close());await updater.ready;
  for(const body of [{version:newVersion},{version:newVersion,confirmed:true,url:'https://evil.invalid'},{version:'v'+newVersion,confirmed:true}])await assert.rejects(updater.install(body));assert.equal(f.calls.length,0);
  busy=['missions'];await assert.rejects(updater.install({version:newVersion,confirmed:true}),{code:'UPDATE_BUSY'});assert.equal(f.calls.length,0);busy=[];
  const output=await updater.install({version:newVersion,confirmed:true});assert.equal(output.status,'restarting');assert.equal(launched.length,1);assert.equal(shutdowns,0);assert.equal(deferred.length,1);assert.equal(await versionAt(f.root),oldVersion);await deferred[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(shutdowns,1);
});

test('a late busy operation or changed release leaves the old server and code intact',async t=>{
  const f=await fixture(t);let busy=[],launches=0,shutdowns=0;const updater=new AppUpdates({root:f.root,currentVersion:oldVersion,dataDir:f.dataDir,fetchImpl:f.fetchImpl,getBusyReasons:()=>busy,getPort:()=>54321,requestShutdown:async()=>{shutdowns++;},prepare:async options=>{const config=await f.prepare(options);busy=['documents'];return config;},launch:async()=>{launches++;}});t.after(()=>updater.close());await updater.ready;
  await assert.rejects(updater.install({version:newVersion,confirmed:true}),{code:'UPDATE_BUSY'});assert.equal(launches,0);assert.equal(shutdowns,0);assert.equal(await versionAt(f.root),oldVersion);await preserved(f);busy=[];
  await assert.rejects(updater.install({version:'0.6.11',confirmed:true}),{code:'UPDATE_VERSION'});assert.equal(launches,0);
});

test('matching restart receipts lift maintenance and preserve rollback status despite automatic release checks',async t=>{
  const f=await fixture(t),restartId='a'.repeat(64);await mkdir(path.join(f.dataDir,'app-updates'));const file=path.join(f.dataDir,'app-updates','result.json'),receipt={fromVersion:oldVersion,toVersion:newVersion,restartId,status:'restarting'};await writeFile(file,JSON.stringify(receipt));
  await writeFile(path.join(f.dataDir,'app-updates','update.lock'),JSON.stringify({restartId}));
  const updater=new AppUpdates({root:f.root,currentVersion:oldVersion,dataDir:f.dataDir,fetchImpl:f.fetchImpl,env:{OSCAR_UPDATE_RESTART_ID:restartId},requestShutdown:async()=>{}});t.after(()=>updater.close());await updater.ready;assert.equal(updater.isBusy,true);assert.equal(updater.state.status,'restarting');
  await writeFile(file,JSON.stringify({...receipt,status:'rolled_back',finishedAt:10000}));assert.equal(updater.isBusy,false);await updater.check();assert.equal(updater.state.status,'rolled_back');assert.equal(updater.state.result.status,'rolled_back');assert.equal(updater.state.currentVersion,oldVersion);
});

test('a second failed preparation cannot reactivate the historical restart nonce',async t=>{
  const f=await fixture(t),restartId='a'.repeat(64);await mkdir(path.join(f.dataDir,'app-updates'));await writeFile(path.join(f.dataDir,'app-updates','result.json'),JSON.stringify({fromVersion:'0.6.8',toVersion:oldVersion,restartId,status:'updated'}));
  const updater=new AppUpdates({root:f.root,currentVersion:oldVersion,dataDir:f.dataDir,fetchImpl:f.fetchImpl,env:{OSCAR_UPDATE_RESTART_ID:restartId},requestShutdown:async()=>{},getPort:()=>54321,prepare:options=>f.prepare(options),launch:async()=>{throw Object.assign(new Error('Le bureau ne s’est pas arrêté. Aucun fichier n’a été remplacé.'),{code:'UPDATE_RESTART'});}});t.after(()=>updater.close());await updater.ready;
  assert.equal(updater.isBusy,false);await assert.rejects(updater.install({version:newVersion,confirmed:true}),{code:'UPDATE_RESTART'});assert.equal(updater.isBusy,false);assert.equal(updater.state.maintenance,false);assert.equal(updater.state.status,'error');assert.equal(updater.state.error.code,'UPDATE_RESTART');assert.equal(await versionAt(f.root),oldVersion);await assert.rejects(lstat(path.join(f.dataDir,'app-updates','update.lock')),{code:'ENOENT'});
});

test('an interrupted durable lock is reported as recovery required and is never silently removed',async t=>{
  const f=await fixture(t),config=await f.prepare(),updater=new AppUpdates({root:f.root,currentVersion:oldVersion,dataDir:f.dataDir,fetchImpl:f.fetchImpl,requestShutdown:async()=>{}});t.after(()=>updater.close());await updater.ready;await updater.check();assert.equal(updater.state.canInstall,false);assert.equal(updater.state.recoveryRequired,true);assert.equal(updater.state.error.code,'UPDATE_RECOVERY');assert.equal((await lstat(path.join(f.dataDir,'app-updates','update.lock'))).isFile(),true);await releaseUpdateLock(config);
});
