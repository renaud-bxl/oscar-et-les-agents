import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,symlink,realpath,stat,access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolveInstallationDataLocation,configureInstallationDataLocation,dataDirectoryHash,INSTALLATION_LOCATION_FILE} from '../lib/installation-paths.mjs';
import {parseArgs,runInstaller} from '../scripts/install.mjs';
import {launchOffice} from '../launch.mjs';

const sourceRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url))),exec=promisify(execFile);
async function fixture(t){const base=await realpath(await mkdtemp(path.join(os.tmpdir(),'oscar-storage-'))),root=path.join(base,'logiciel avec espaces'),dataDir=path.join(base,'SSD simulé','Oscar données'),home=path.join(base,'personne');await mkdir(root);await mkdir(home);await mkdir(path.dirname(dataDir));t.after(()=>rm(base,{recursive:true,force:true}));return{base,root,dataDir,home};}
const lookup=(f,env={})=>resolveInstallationDataLocation({root:f.root,home:f.home,env});
const response=data=>new Response(JSON.stringify({app:'oscar-et-les-agents',...data}));

test('explicit data locations are persisted outside tracked code and preserve every existing document',async t=>{
  const f=await fixture(t);await mkdir(path.join(f.dataDir,'missions'),{recursive:true});await writeFile(path.join(f.dataDir,'missions','original.txt'),'KEEP');
  const chosen=configureInstallationDataLocation(f),saved=JSON.parse(await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8'));assert.equal(saved.dataDirectory,await realpath(f.dataDir));assert.equal(saved.version,1);assert.match(saved.locationId,/^[a-f\d-]{36}$/u);assert.equal((await stat(path.join(f.root,INSTALLATION_LOCATION_FILE))).mode&0o777,0o600);
  const resolved=lookup(f);assert.equal(resolved.dataDir,chosen.dataDir);assert.equal(resolved.configured,true);assert.equal(resolved.hash,dataDirectoryHash(f.dataDir));assert.equal(await readFile(path.join(f.dataDir,'missions','original.txt'),'utf8'),'KEEP');assert.equal(existsSync(path.join(f.home,'Documents')),false);
  const again=configureInstallationDataLocation(f);assert.equal(again.hash,chosen.hash);assert.equal(JSON.parse(await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8')).locationId,saved.locationId);
});

test('an absent or replaced configured data disk is refused without creating an empty local office',async t=>{
  const f=await fixture(t);configureInstallationDataLocation(f);const disconnected=f.dataDir+' hors ligne';await rename(f.dataDir,disconnected);
  assert.throws(()=>lookup(f),/indisponible/u);let probes=0;await assert.rejects(launchOffice({...f,env:{}},{fetch:()=>{probes++;assert.fail('No service must be contacted.');}}),/indisponible/u);assert.equal(probes,0);assert.equal(existsSync(f.dataDir),false);assert.equal(existsSync(path.join(f.home,'Documents')),false);
  await mkdir(f.dataDir);assert.throws(()=>lookup(f),/plus le dossier configuré/u);await rm(f.dataDir,{recursive:true});await rename(disconnected,f.dataDir);assert.equal(lookup(f).configured,true);
});

test('data overrides remain explicit, marker-checked when they match and never replace the saved preference implicitly',async t=>{
  const f=await fixture(t);configureInstallationDataLocation(f);const before=await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8'),other=path.join(f.base,'données temporaires');await mkdir(other);
  assert.equal(lookup(f,{OSCAR_DATA_DIR:other,ATELIER_DATA_DIR:'ignored'}).dataDir,other);assert.equal(lookup(f,{ATELIER_DATA_DIR:other}).source,'environment');assert.equal(await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8'),before);
  await rm(path.join(f.dataDir,'.oscar-data-location.json'));assert.throws(()=>lookup(f,{OSCAR_DATA_DIR:f.dataDir}),/plus le dossier configuré/u);
});

test('malformed configuration and user symlinks fail closed without changing targets',async t=>{
  const f=await fixture(t),outside=path.join(f.base,'outside');await mkdir(outside);await symlink(outside,f.dataDir);assert.throws(()=>configureInstallationDataLocation(f),/lien/u);assert.equal(existsSync(path.join(outside,'.oscar-data-location.json')),false);await rm(f.dataDir);configureInstallationDataLocation(f);
  const config=path.join(f.root,INSTALLATION_LOCATION_FILE);await writeFile(config,'{broken');assert.throws(()=>lookup(f),/illisible/u);assert.throws(()=>configureInstallationDataLocation(f),/illisible/u);assert.equal(await readFile(config,'utf8'),'{broken');await rm(config);const target=path.join(outside,'target');await writeFile(target,'KEEP');await symlink(target,config);assert.throws(()=>lookup(f),/fichier local valide/u);assert.equal(await readFile(target,'utf8'),'KEEP');
});

test('unmounted volumes, shared system roots and ambiguous explicit paths are rejected before mkdir',async t=>{
  const f=await fixture(t),missing=`/Volumes/Oscar-inexistent-${path.basename(f.base)}/Données`;
  assert.throws(()=>configureInstallationDataLocation({...f,dataDir:missing,platform:'darwin'}),/pas monté/u);assert.equal(existsSync(path.dirname(missing)),false);
  for(const dataDir of['relative','/','/Users','/System/example',f.home,f.root,path.join(f.root,'unexpected-data'),f.base+'/../elsewhere',f.base+'//data'])assert.throws(()=>configureInstallationDataLocation({...f,dataDir}),{code:'INSTALLATION_LOCATION'});
  assert.throws(()=>parseArgs(['--data-dir']),/Précisez/u);assert.throws(()=>parseArgs(['--data-dir=relative']),/absolu/u);assert.equal(parseArgs(['--data-dir',f.dataDir]).dataDir,f.dataDir);
});

test('launch verifies the selected data identity before reusing an existing server',async t=>{
  const f=await fixture(t);configureInstallationDataLocation(f);let opened=0,spawned=0;const deps={spawn:()=>{spawned++;assert.fail('No second server.');},open:async()=>opened++,log(){}};
  const launched=await launchOffice({...f,env:{},port:54321},{...deps,fetch:async()=>response({dataDirectoryHash:dataDirectoryHash(f.dataDir)})});assert.equal(launched.dataDir,f.dataDir);assert.equal(opened,1);assert.equal(spawned,0);
  for(const data of[{}, {dataDirectoryHash:'f'.repeat(64)},{app:'another-service'}])await assert.rejects(launchOffice({...f,env:{},port:54321},{...deps,fetch:async()=>response(data)}),/autre/u);assert.equal(opened,1);assert.equal(spawned,0);
});

test('a health redirect cannot make the launcher open a different service or spawn another office',async t=>{
  const f=await fixture(t);configureInstallationDataLocation(f);let redirectedHealth=0,opened=0,spawned=0,status=301;
  const actualOffice=createServer((_request,res)=>{redirectedHealth++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({app:'oscar-et-les-agents',dataDirectoryHash:dataDirectoryHash(f.dataDir)}));});
  await new Promise(resolve=>actualOffice.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>actualOffice.close(resolve)));
  const otherService=createServer((_request,res)=>{res.writeHead(status,{Location:`http://127.0.0.1:${actualOffice.address().port}/api/updates/health`});res.end();});
  await new Promise(resolve=>otherService.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>otherService.close(resolve)));
  for(const redirectStatus of[301,302]){status=redirectStatus;await assert.rejects(launchOffice({...f,env:{},port:otherService.address().port},{spawn:()=>{spawned++;assert.fail('No second server.');},open:async()=>opened++,log(){}}),/Impossible de vérifier/u);}
  assert.equal(redirectedHealth,0);assert.equal(opened,0);assert.equal(spawned,0);
});

test('a fresh launch passes the chosen path to its child and keeps user account directories unchanged',async t=>{
  const f=await fixture(t);configureInstallationDataLocation(f);const spawned=[],closed=[];let probes=0,opened;const env={HOME:f.home,CODEX_HOME:path.join(f.home,'existing-account'),PATH:'/bin'};
  await launchOffice({...f,env,port:54321},{fetch:async()=>{if(++probes===1)throw Object.assign(new Error('No server.'),{code:'ECONNREFUSED'});return response({dataDirectoryHash:dataDirectoryHash(f.dataDir)});},spawn:(binary,args,options)=>{spawned.push({binary,args,options});const child=new EventEmitter();child.unref=()=>{};return child;},openLog:()=>17,closeLog:fd=>closed.push(fd),open:async url=>{opened=url;},delay:async()=>{},log(){}});
  assert.equal(spawned.length,1);assert.equal(spawned[0].options.env.OSCAR_DATA_DIR,f.dataDir);assert.equal(spawned[0].options.env.HOME,env.HOME);assert.equal(spawned[0].options.env.CODEX_HOME,env.CODEX_HOME);assert.deepEqual(closed,[17]);assert.equal(opened,'http://localhost:54321');
});

test('the installer remembers an explicit data directory and a later preparation conserves it',async t=>{
  const f=await fixture(t),logs=[],deps={root:f.root,home:f.home,platform:'linux',env:{PATH:'/bin'},log:text=>logs.push(text),findBinary:async()=>'/fake/codex',capture:async(_binary,args)=>({code:0,stdout:args[0]==='--version'?'codex-cli 0.130.0':'--json --sandbox --color --skip-git-repo-check --output-schema'}),createShortcut:async()=>{},interactive:()=>assert.fail('No login or process is permitted.')};
  await runInstaller(parseArgs(['--engine','codex','--data-dir',f.dataDir,'--skip-login','--no-open']),deps);assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'preferences.json'),'utf8')).setupComplete,true);const saved=await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8');await runInstaller(parseArgs(['--engine','codex','--skip-login','--no-open']),deps);assert.equal(await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8'),saved);assert.equal(existsSync(path.join(f.home,'Documents')),false);assert.ok(logs.some(text=>text.includes(f.dataDir)));
});

test('the shell bootstrap forwards a quoted data path without executing it or touching real accounts',async t=>{
  const f=await fixture(t),source=path.join(f.base,'source'),destination=path.join(f.base,'application'),dataDir=path.join(f.base,"SSD 4 To's $(not-a-command)");await mkdir(path.join(source,'scripts'),{recursive:true});for(const file of['install.sh','package.json'])await writeFile(path.join(source,file),await readFile(path.join(sourceRoot,file)));await writeFile(path.join(source,'server.mjs'),'// fake');await writeFile(path.join(source,'scripts','install.mjs'),'console.log(JSON.stringify(process.argv.slice(2)));');
  const result=await exec('/bin/sh',[path.join(source,'install.sh'),'--engine','codex','--dir',destination,'--data-dir',dataDir,'--skip-login','--no-open'],{env:{...process.env,PATH:path.dirname(process.execPath)+':'+process.env.PATH}});const args=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(args[args.indexOf('--data-dir')+1],dataDir);assert.equal(existsSync(dataDir),false,'The simulated installer only records its arguments.');await access(path.join(destination,'scripts','install.mjs'));
});

test('a complete shell reinstall keeps its chosen disk without requiring an environment override',async t=>{
  const f=await fixture(t),source=path.join(f.base,'source');await mkdir(path.join(source,'scripts'),{recursive:true});await mkdir(path.join(source,'lib'));
  for(const file of['install.sh','package.json','scripts/install.mjs','lib/installation-paths.mjs'])await writeFile(path.join(source,file),await readFile(path.join(sourceRoot,file)));await writeFile(path.join(source,'server.mjs'),'// No server or model is started.');
  const tools=path.join(f.root,'.tools','node_modules','.bin');await mkdir(tools,{recursive:true});await writeFile(path.join(tools,'codex'),'#!/bin/sh\ncase "$1" in --version) echo "codex-cli 0.130.0";; exec) echo "--json --sandbox --color --skip-git-repo-check --output-schema";; *) exit 99;; esac\n',{mode:0o755});
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const env={...process.env,PORT:String(port),PATH:path.dirname(process.execPath)+':'+process.env.PATH};delete env.OSCAR_DATA_DIR;delete env.ATELIER_DATA_DIR;
  const args=[path.join(source,'install.sh'),'--engine','codex','--dir',f.root,'--skip-login','--no-open'];await exec('/bin/sh',[...args,'--data-dir',f.dataDir],{env});await writeFile(path.join(f.dataDir,'keep.txt'),'ORIGINAL');const before=await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8');
  await exec('/bin/sh',args,{env});assert.equal(await readFile(path.join(f.root,INSTALLATION_LOCATION_FILE),'utf8'),before);assert.equal(await readFile(path.join(f.dataDir,'keep.txt'),'utf8'),'ORIGINAL');assert.equal(lookup(f).dataDir,f.dataDir);assert.equal(existsSync(path.join(f.root,'data','preferences.json')),false);
});

test('known macOS aliases use canonical hashes while arbitrary user aliases remain forbidden',async t=>{
  if(process.platform!=='darwin')return t.skip('macOS system aliases only');const f=await fixture(t),alias=f.dataDir.startsWith('/private/var/')?f.dataDir.replace(/^\/private\/var/u,'/var'):f.dataDir.replace(/^\/private\/tmp/u,'/tmp');configureInstallationDataLocation(f);assert.equal(lookup(f,{OSCAR_DATA_DIR:alias}).dataDir,f.dataDir);assert.equal(lookup(f,{OSCAR_DATA_DIR:alias}).configured,true);assert.equal(dataDirectoryHash(alias),dataDirectoryHash(f.dataDir));
  const other=path.join(f.base,'user-alias');await symlink(f.dataDir,other);assert.throws(()=>lookup(f,{OSCAR_DATA_DIR:other}),/lien/u);
});
