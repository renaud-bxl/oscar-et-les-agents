#!/usr/bin/env node
// Standalone on purpose: a private copy runs outside the code it replaces.
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat,realpath,readdir,open,mkdir,mkdtemp,writeFile,readFile,copyFile,rm,rename} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';

export const UPDATE_REPOSITORY='renaud-bxl/oscar-et-les-agents';
export const UPDATE_LIMITS=Object.freeze({metadata:128*1024,download:64*1024*1024,expanded:200*1024*1024,file:20*1024*1024,files:5000,timeoutMs:10000,downloadTimeoutMs:120000});
const PRESERVED=new Set(['data','.tools','.runtime','.git','.github','atelier.log','.DS_Store']);
const REQUIRED=['package.json','server.mjs','launch.mjs','public/index.html','lib/orchestrator.mjs','scripts/install.mjs'];
const fail=(message,code='UPDATE_INVALID')=>Object.assign(new Error(message),{code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exactVersion=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/u;
export function validUpdateVersion(value){return typeof value==='string'&&exactVersion.test(value);}
export function compareUpdateVersions(first,second){if(!validUpdateVersion(first)||!validUpdateVersion(second))throw fail('La version de cette mise à jour n’est pas valide.','UPDATE_VERSION');const a=first.split('.').map(Number),b=second.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;return 0;}
export function parseUpdateRelease(value){
  const tag=typeof value?.tag_name==='string'?value.tag_name:'',version=tag.replace(/^v/u,'');
  if(!validUpdateVersion(version)||!['v'+version,version].includes(tag)||value.draft!==false||value.prerelease!==false)throw fail('La publication stable officielle n’a pas pu être vérifiée.');
  const releaseUrl=`https://github.com/${UPDATE_REPOSITORY}/releases/tag/${tag}`;
  if(value.html_url!==releaseUrl)throw fail('La publication stable officielle n’a pas pu être vérifiée.');
  return Object.freeze({version,tag,releaseUrl,releaseNotes:typeof value.body==='string'?value.body.slice(0,4000):''});
}
export async function updateBytes(url,{fetchImpl=fetch,maxBytes=UPDATE_LIMITS.download,timeoutMs=UPDATE_LIMITS.timeoutMs,signal}={}){
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)throw fail('La mise à jour a été interrompue.','UPDATE_NETWORK');signal?.addEventListener('abort',abort,{once:true});
  let reader,timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reader?.cancel().catch(()=>{});reject(fail('Le serveur de mise à jour ne répond pas. Réessayez plus tard.','UPDATE_NETWORK'));},timeoutMs);});
  try{return await Promise.race([(async()=>{
    const response=await fetchImpl(url,{redirect:'error',signal:controller.signal,headers:{Accept:url.includes('api.github.com')?'application/vnd.github+json':'application/octet-stream','User-Agent':'Oscar-et-les-Agents-update','X-GitHub-Api-Version':'2022-11-28'}});
    if(!response.ok)throw fail('La publication officielle n’est pas disponible. Réessayez plus tard.','UPDATE_NETWORK');
    if(response.url&&response.url!==url)throw fail('Le téléchargement officiel a changé de destination.');
    const length=Number(response.headers?.get?.('content-length'));if(Number.isFinite(length)&&length>maxBytes)throw fail('Les fichiers de mise à jour dépassent la limite autorisée.');
    if(!response.body?.getReader)throw fail('Le téléchargement officiel n’est pas lisible.','UPDATE_NETWORK');reader=response.body.getReader();const chunks=[];let total=0;
    while(true){const{done,value}=await reader.read();if(done)break;if(controller.signal.aborted)throw fail('La mise à jour a été interrompue.','UPDATE_NETWORK');total+=value.byteLength;if(total>maxBytes)throw fail('Les fichiers de mise à jour dépassent la limite autorisée.');chunks.push(Buffer.from(value));}
    return Buffer.concat(chunks,total);
  })(),timeout]);}catch(error){if(error.code?.startsWith('UPDATE_'))throw error;throw fail('Le téléchargement officiel a échoué. Votre bureau est conservé.','UPDATE_NETWORK');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);await reader?.cancel().catch(()=>{});}
}
export async function latestUpdateRelease(options={}){const bytes=await updateBytes(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`,{...options,maxBytes:UPDATE_LIMITS.metadata});let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw fail('La publication officielle n’est pas lisible.');}return parseUpdateRelease(data);}
const safeRelative=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!path.posix.isAbsolute(value)&&!/[\\\x00-\x1f\x7f:%?#]/u.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part===part.trim());
const ignored=relative=>relative.split('/').some(part=>(part.startsWith('.')&&part!=='.gitignore')||['data','.tools','.runtime','node_modules','__pycache__'].includes(part)||part.endsWith('.log'));
function octal(bytes){const value=bytes.toString('ascii').replace(/\0.*$/u,'').trim();if(!/^[0-7]*$/u.test(value))throw fail('L’archive officielle contient une taille invalide.');return parseInt(value||'0',8);}
function tarString(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytes.indexOf(0)<0?bytes.length:bytes.indexOf(0)));}catch{throw fail('L’archive officielle contient un nom invalide.');}}
export function parseUpdateArchive(compressed,version){
  if(!validUpdateVersion(version)||compressed.length>UPDATE_LIMITS.download)throw fail('L’archive de mise à jour n’est pas valide.');
  let bytes;try{bytes=gunzipSync(compressed,{maxOutputLength:UPDATE_LIMITS.expanded});}catch{throw fail('L’archive officielle est invalide ou trop grande.');}
  const files=new Map();let prefix=null,offset=0,entries=0,total=0,ended=false;
  while(offset+512<=bytes.length){
    const header=bytes.subarray(offset,offset+512);if(header.every(value=>value===0)){ended=true;if(bytes.subarray(offset).some(value=>value!==0))throw fail('La fin de l’archive officielle n’est pas valide.');break;}
    if(++entries>UPDATE_LIMITS.files+1000)throw fail('L’archive officielle contient trop de fichiers.');
    const expected=octal(header.subarray(148,156));let checksum=0;for(let index=0;index<512;index++)checksum+=index>=148&&index<156?32:header[index];if(checksum!==expected)throw fail('L’archive officielle est corrompue.');
    const size=octal(header.subarray(124,136)),type=header[156]===0?'0':String.fromCharCode(header[156]),name=[tarString(header.subarray(345,500)),tarString(header.subarray(0,100))].filter(Boolean).join('/');
    const start=offset+512,end=start+size;if(!Number.isSafeInteger(size)||end>bytes.length||size>UPDATE_LIMITS.file)throw fail('L’archive officielle contient un fichier invalide ou trop grand.');offset=start+Math.ceil(size/512)*512;
    if(type==='g'){
      if(name!=='pax_global_header'||size>4096)throw fail('Les métadonnées de l’archive ne sont pas reconnues.');
      const pax=bytes.subarray(start,end).toString('utf8');let cursor=0;while(cursor<pax.length){const space=pax.indexOf(' ',cursor),length=Number(pax.slice(cursor,space));if(space<cursor||!Number.isSafeInteger(length)||length<5||cursor+length>pax.length)throw fail('Les métadonnées de l’archive ne sont pas reconnues.');const field=pax.slice(space+1,cursor+length);if(!/^comment=[a-f\d]{40,64}\n$/u.test(field))throw fail('Les métadonnées de l’archive ne sont pas reconnues.');cursor+=length;}continue;
    }
    if(!['0','5'].includes(type))throw fail('L’archive contient un lien ou un type de fichier non autorisé.');
    const normalized=type==='5'&&name.endsWith('/')?name.slice(0,-1):name;if(!safeRelative(normalized))throw fail('L’archive contient un chemin non autorisé.');const parts=normalized.split('/'),first=parts.shift();
    if(!/^oscar-et-les-agents-[A-Za-z\d._-]+$/u.test(first)||prefix&&prefix!==first)throw fail('L’archive ne provient pas du projet attendu.');prefix=first;
    if(type==='5'){if(size!==0)throw fail('L’archive contient un dossier invalide.');continue;}
    const relative=parts.join('/');if(!safeRelative(relative))throw fail('L’archive contient un chemin non autorisé.');if(ignored(relative))continue;
    if(PRESERVED.has(parts[0])||files.has(relative))throw fail('L’archive contient un fichier réservé ou dupliqué.');
    total+=size;if(total>UPDATE_LIMITS.expanded||files.size>=UPDATE_LIMITS.files)throw fail('L’archive officielle dépasse les limites autorisées.');
    files.set(relative,{bytes:Buffer.from(bytes.subarray(start,end)),mode:octal(header.subarray(100,108))&0o111?0o755:0o644});
  }
  if(!ended||REQUIRED.some(file=>!files.has(file)))throw fail('L’archive officielle ne contient pas le logiciel complet.');
  let pkg;try{pkg=JSON.parse(files.get('package.json').bytes.toString('utf8'));}catch{throw fail('La version de l’archive n’est pas valide.','UPDATE_VERSION');}
  if(pkg.name!=='oscar-et-les-agents'||pkg.version!==version)throw fail('La version de l’archive ne correspond pas à votre confirmation.','UPDATE_VERSION');return files;
}
export async function noUpdateLinks(directory){
  const absolute=path.resolve(directory);if(absolute!==directory)throw fail('Le chemin de cette installation n’est pas reconnu.','UPDATE_UNSUPPORTED');let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw fail('Cette installation utilise un lien ou un dossier non reconnu.','UPDATE_UNSUPPORTED');}return absolute;
}
async function readPlain(file,max=UPDATE_LIMITS.file){
  const before=await lstat(file);if(before.isSymbolicLink()||!before.isFile()||before.size>max)throw fail('Un fichier de cette installation n’est pas reconnu.','UPDATE_FILES');
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const opened=await handle.stat();if(opened.dev!==before.dev||opened.ino!==before.ino)throw fail('Les fichiers du bureau ont changé.','UPDATE_FILES');const bytes=await handle.readFile();const after=await handle.stat();if(bytes.length>max||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw fail('Les fichiers du bureau ont changé.','UPDATE_FILES');return bytes;}finally{await handle.close();}
}
export async function inspectUpdateInstallation({root,currentVersion}={}){
  try{
    if(!path.isAbsolute(root||'')||root===os.homedir()||root===path.parse(root).root)throw fail('Choisissez une installation dédiée à Oscar.','UPDATE_UNSUPPORTED');await noUpdateLinks(root);
    const git=await lstat(path.join(root,'.git')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(git)throw fail('Les copies Git se mettent à jour avec Git. La mise à jour automatique est réservée aux installations du logiciel.','UPDATE_UNSUPPORTED');
    for(const name of PRESERVED){const info=await lstat(path.join(root,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info?.isSymbolicLink())throw fail('Un dossier interne est un lien symbolique. La mise à jour est refusée.','UPDATE_UNSUPPORTED');}
    const pkg=JSON.parse((await readPlain(path.join(root,'package.json'),32768)).toString('utf8'));if(pkg.name!=='oscar-et-les-agents'||!validUpdateVersion(pkg.version)||pkg.version!==currentVersion)throw fail('La version sur le disque ne correspond pas au bureau ouvert. Relancez le logiciel avant de le mettre à jour.','UPDATE_UNSUPPORTED');
    for(const name of REQUIRED)if(!(await lstat(path.join(root,name)))?.isFile())throw fail('Cette installation est incomplète.','UPDATE_UNSUPPORTED');
    return{supported:true,kind:'copy',root};
  }catch(error){return{supported:false,kind:'unknown',error:{code:error.code?.startsWith('UPDATE_')?error.code:'UPDATE_UNSUPPORTED',message:error.code?.startsWith('UPDATE_')?error.message:'Cette installation ne peut pas être mise à jour automatiquement.'}};}
}
async function ensureDirectory(directory){const parent=path.dirname(directory);await noUpdateLinks(parent);const info=await lstat(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info?.isSymbolicLink()||info&&!info.isDirectory())throw fail('Le dossier de mise à jour n’est pas accessible.','UPDATE_FILES');if(!info)await mkdir(directory,{mode:0o700});return directory;}
async function currentCode(root,expected){
  const files=new Map(),tops=new Set([...expected.keys()].map(file=>file.split('/')[0]));
  const walk=async(relative='')=>{for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){const child=relative?relative+'/'+entry.name:entry.name;if(!relative&&PRESERVED.has(entry.name))continue;if(!safeRelative(child)||!tops.has(child.split('/')[0])||entry.isSymbolicLink()||!entry.isFile()&&!entry.isDirectory())throw fail('Des fichiers personnels ou modifiés se trouvent dans le code. Ils sont conservés ; la mise à jour automatique est refusée.','UPDATE_FILES');if(entry.isDirectory())await walk(child);else{if(!expected.has(child))throw fail('Le code contient un fichier inconnu. La mise à jour automatique est refusée.','UPDATE_FILES');const bytes=await readPlain(path.join(root,child));files.set(child,{sha256:hash(bytes),mode:(await lstat(path.join(root,child))).mode&0o111?0o755:0o644});}}};await walk();
  if(files.size!==expected.size||[...expected].some(([name,value])=>files.get(name)?.sha256!==(value.sha256||hash(value.bytes))))throw fail('Le code a été modifié depuis sa publication. Vos fichiers sont conservés ; la mise à jour automatique est refusée.','UPDATE_FILES');return files;
}
async function putFiles(directory,files){await ensureDirectory(directory);for(const[name,file]of files){const destination=path.join(directory,name);let parent=directory;for(const component of name.split('/').slice(0,-1)){parent=path.join(parent,component);await ensureDirectory(parent);}await writeFile(destination,file.bytes,{flag:'wx',mode:file.mode});}}
async function receipt(config,value){const output={jobId:config.jobId,restartId:config.restartId,fromVersion:config.currentVersion,toVersion:config.version,...value};const destination=path.join(config.dataDir,'app-updates','result.json'),temporary=destination+'.'+config.jobId+'.tmp';await writeFile(temporary,JSON.stringify(output),{flag:'wx',mode:0o600});await rename(temporary,destination);}
export {receipt as writeUpdateReceipt};
export async function releaseUpdateLock(config){
  const file=path.join(config.dataDir,'app-updates','update.lock');try{const value=JSON.parse((await readPlain(file,16384)).toString('utf8'));if(value.jobId===config.jobId)await rm(file);}catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function prepareUpdate({root,currentVersion,release,dataDir,port,parentPid=process.pid,nodePath=process.execPath,fetchImpl=fetch,signal,workspaceParent=os.tmpdir(),now=Date.now}={}){
  const installation=await inspectUpdateInstallation({root,currentVersion});if(!installation.supported)throw fail(installation.error.message,installation.error.code);
  if(!release||!validUpdateVersion(release.version)||compareUpdateVersions(release.version,currentVersion)<=0||!['v'+release.version,release.version].includes(release.tag)||!Number.isInteger(port)||port<1||port>65535)throw fail('La version ou le port de mise à jour n’est pas valide.','UPDATE_VERSION');
  await noUpdateLinks(dataDir);await ensureDirectory(path.join(dataDir,'app-updates'));const jobId=randomBytes(32).toString('hex'),restartId=randomBytes(32).toString('hex');
  let workspace,locked=false;const config={root,dataDir,currentVersion,version:release.version,port,parentPid,nodePath,jobId,restartId};
  try{
    try{await writeFile(path.join(dataDir,'app-updates','update.lock'),JSON.stringify({jobId,restartId,parentPid,createdAt:now()}),{flag:'wx',mode:0o600});locked=true;}catch(error){if(error.code==='EEXIST')throw fail('Une autre mise à jour est déjà en préparation.','UPDATE_BUSY');throw error;}
    workspace=await mkdtemp(path.join(await realpath(workspaceParent),'oscar-update-'));config.workspace=workspace;await ensureDirectory(path.join(dataDir,'app-updates','backups'));config.backupDirectory=path.join(dataDir,'app-updates','backups',jobId);
    const download=async(tag,version)=>parseUpdateArchive(await updateBytes(`https://codeload.github.com/${UPDATE_REPOSITORY}/tar.gz/refs/tags/${tag}`,{fetchImpl,signal,timeoutMs:UPDATE_LIMITS.downloadTimeoutMs}),version);
    const baseline=await download('v'+currentVersion,currentVersion);const before=await currentCode(root,baseline);const target=await download(release.tag,release.version);
    if(signal?.aborted)throw fail('La mise à jour a été interrompue.','UPDATE_NETWORK');await currentCode(root,baseline);
    config.originalFiles=[...before].map(([name,value])=>({path:name,...value}));config.targetFiles=[...target].map(([name,value])=>({path:name,sha256:hash(value.bytes),mode:value.mode}));const rootInfo=await lstat(root);config.rootIdentity={dev:rootInfo.dev,ino:rootInfo.ino};
    await putFiles(path.join(workspace,'target'),target);await copyFile(fileURLToPath(import.meta.url),path.join(workspace,'worker.mjs'),constants.COPYFILE_EXCL);await writeFile(path.join(workspace,'config.json'),JSON.stringify(config),{flag:'wx',mode:0o600});
    await receipt(config,{status:'ready',createdAt:now()});return config;
  }catch(error){if(locked)await releaseUpdateLock(config).catch(()=>{});if(workspace)await rm(workspace,{recursive:true,force:true}).catch(()=>{});if(error.code?.startsWith('UPDATE_'))throw error;throw fail('La préparation a échoué. Votre bureau est conservé.','UPDATE_FILES');}
}
export const updateProcessAlive=pid=>{if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
export async function waitForUpdateParent(pid,{alive=updateProcessAlive,sleep=delay,timeoutMs=60000,now=Date.now}={}){const end=now()+timeoutMs;while(pid&&alive(pid)){if(now()>=end)throw fail('Le bureau ne s’est pas arrêté. Aucun fichier n’a été remplacé.','UPDATE_RESTART');await sleep(100);} }
async function freePort(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(fail('Le port du bureau est encore utilisé. Aucun fichier n’a été remplacé.','UPDATE_RESTART')));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
async function startServer(config){
  const child=spawn(config.nodePath,[path.join(config.root,'server.mjs')],{cwd:config.root,detached:true,stdio:'ignore',env:{...process.env,OSCAR_DATA_DIR:config.dataDir,PORT:String(config.port),OSCAR_UPDATE_RESTART_ID:config.restartId}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(fail('Le bureau n’a pas pu redémarrer.','UPDATE_RESTART')));});child.unref();return{pid:child.pid};
}
async function stopServer(child,{alive=updateProcessAlive,sleep=delay}={}){
  if(!child?.pid||!alive(child.pid))return;const send=signal=>{try{process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};send('SIGTERM');for(let i=0;i<50&&alive(child.pid);i++)await sleep(100);if(alive(child.pid))send('SIGKILL');for(let i=0;i<20&&alive(child.pid);i++)await sleep(100);if(alive(child.pid))throw fail('Le nouveau bureau ne s’est pas arrêté. La sauvegarde du code est conservée.','UPDATE_ROLLBACK');
}
async function health(config,child,version,{legacy=false,fetchImpl=fetch,sleep=delay,alive=updateProcessAlive}={}){
  for(let index=0;index<80;index++){
    if(!alive(child.pid))return false;
    try{const response=await fetchImpl(`http://127.0.0.1:${config.port}/api/updates/health`,{signal:AbortSignal.timeout(800),redirect:'error'});const data=await response.json();if(response.ok&&data.app==='oscar-et-les-agents'&&data.version===version&&data.pid===child.pid&&data.restartId===config.restartId)return true;
      if(legacy&&response.status===404){const fallback=await fetchImpl(`http://127.0.0.1:${config.port}/api/state`,{signal:AbortSignal.timeout(800),redirect:'error'}),state=await fallback.json();if(fallback.ok&&state.app==='oscar-et-les-agents'&&state.version===version&&alive(child.pid))return true;}
    }catch{}await sleep(250);
  }return false;
}
function manifest(rows){if(!Array.isArray(rows)||!rows.length||rows.length>UPDATE_LIMITS.files)throw fail('Le plan de mise à jour n’est pas valide.');const result=new Map();for(const row of rows){if(!safeRelative(row?.path)||PRESERVED.has(row.path.split('/')[0])||ignored(row.path)||!/^[a-f\d]{64}$/u.test(row.sha256)||![0o644,0o755].includes(row.mode)||result.has(row.path))throw fail('Le plan de mise à jour n’est pas valide.');result.set(row.path,row);}return result;}
async function backupFiles(source,destination,files){const copies=new Map();for(const[name,value]of files){const bytes=await readPlain(path.join(source,name));if(hash(bytes)!==value.sha256)throw fail('Les fichiers du bureau ont changé.','UPDATE_FILES');copies.set(name,{bytes,mode:value.mode});}await putFiles(destination,copies);}
async function workerRoots(config){
  await noUpdateLinks(config.workspace);await noUpdateLinks(config.root);await noUpdateLinks(config.dataDir);const info=await lstat(config.root);if(info.dev!==config.rootIdentity?.dev||info.ino!==config.rootIdentity?.ino)throw fail('Le dossier du bureau a changé.','UPDATE_FILES');
  if(config.backupDirectory!==path.join(config.dataDir,'app-updates','backups',config.jobId))throw fail('Le dossier de sauvegarde n’est pas reconnu.','UPDATE_FILES');await noUpdateLinks(path.dirname(config.backupDirectory));
}
async function replaceCode(config,source,files){
  await workerRoots(config);await noUpdateLinks(source);
  const tops=new Set([...config.originalFiles,...config.targetFiles].map(file=>file.path.split('/')[0]));for(const top of tops){if(PRESERVED.has(top))throw fail('Un fichier réservé ne peut pas être remplacé.');await rm(path.join(config.root,top),{recursive:true,force:true});}
  const copies=new Map();for(const[name,value]of files){const bytes=await readPlain(path.join(source,name));if(hash(bytes)!==value.sha256)throw fail('La copie de mise à jour a changé.','UPDATE_FILES');copies.set(name,{bytes,mode:value.mode});}for(const[name,value]of copies){let parent=config.root;for(const component of name.split('/').slice(0,-1)){parent=path.join(parent,component);await ensureDirectory(parent);}await writeFile(path.join(config.root,name),value.bytes,{flag:'wx',mode:value.mode});}
}
export async function runUpdateWorker(config,dependencies={}){
  const {waitParent=waitForUpdateParent,ensurePortFree=freePort,start=startServer,stop=stopServer,checkHealth=health,now=Date.now}=dependencies;let child=null,changed=false,backedUp=false,parentStopped=false;
  const original=manifest(config.originalFiles),target=manifest(config.targetFiles);
  try{
    if(!validUpdateVersion(config.currentVersion)||!validUpdateVersion(config.version)||compareUpdateVersions(config.version,config.currentVersion)<=0||!/^[a-f\d]{64}$/u.test(config.jobId)||!/^[a-f\d]{64}$/u.test(config.restartId)||!Number.isInteger(config.port)||config.port<1||config.port>65535||!path.isAbsolute(config.workspace||'')||config.workspace===config.root||config.workspace.startsWith(config.root+path.sep))throw fail('Le plan de mise à jour n’est pas valide.');
    await workerRoots(config);
    await waitParent(config.parentPid);parentStopped=true;await ensurePortFree(config.port);await workerRoots(config);await currentCode(config.root,original);await currentCode(path.join(config.workspace,'target'),target);
    await workerRoots(config);await backupFiles(config.root,config.backupDirectory,original);backedUp=true;await receipt(config,{status:'restarting',createdAt:now()});
    changed=true;await replaceCode(config,path.join(config.workspace,'target'),target);await currentCode(config.root,target);child=await start(config);
    if(!await checkHealth(config,child,config.version))throw fail('Le nouveau bureau n’a pas passé son contrôle de démarrage.','UPDATE_RESTART');
    await receipt(config,{status:'updated',finishedAt:now()});await releaseUpdateLock(config);return{status:'updated',fromVersion:config.currentVersion,toVersion:config.version};
  }catch(error){
    if(changed&&backedUp){
      try{await stop(child);await replaceCode(config,config.backupDirectory,original);await currentCode(config.root,original);child=await start({...config,version:config.currentVersion});if(!await checkHealth(config,child,config.currentVersion,{legacy:true}))throw fail('Le bureau précédent n’a pas pu être redémarré.','UPDATE_ROLLBACK');await receipt(config,{status:'rolled_back',code:'UPDATE_RESTART',finishedAt:now()});await releaseUpdateLock(config);return{status:'rolled_back',fromVersion:config.currentVersion,toVersion:config.version};}
      catch{await receipt(config,{status:'error',code:'UPDATE_ROLLBACK',finishedAt:now()}).catch(()=>{});throw fail('La restauration automatique n’a pas abouti. La sauvegarde du code est conservée.','UPDATE_ROLLBACK');}
    }
    // A pre-copy failure can still restart the previous, verified code. Never
    // launch from a replaced root or from files that no longer match it.
    try{if(!parentStopped)throw error;await workerRoots(config);await currentCode(config.root,original);await ensurePortFree(config.port);child=await start({...config,version:config.currentVersion});if(await checkHealth(config,child,config.currentVersion,{legacy:true})){await receipt(config,{status:'rolled_back',code:error.code?.startsWith('UPDATE_')?error.code:'UPDATE_FILES',finishedAt:now()});await releaseUpdateLock(config);return{status:'rolled_back',fromVersion:config.currentVersion,toVersion:config.version};}}catch{}
    await receipt(config,{status:'error',code:error.code?.startsWith('UPDATE_')?error.code:'UPDATE_FILES',finishedAt:now()}).catch(()=>{});await releaseUpdateLock(config).catch(()=>{});throw error;
  }
}
export async function spawnUpdateWorker(config,{spawnImpl=spawn,env=process.env}={}){
  return new Promise((resolve,reject)=>{
    const child=spawnImpl(process.execPath,[path.join(config.workspace,'worker.mjs'),'--worker',path.join(config.workspace,'config.json')],{cwd:config.workspace,detached:true,stdio:['ignore','ignore','ignore','ipc'],env:{...env,OSCAR_DATA_DIR:config.dataDir,PORT:String(config.port)}});
    const timer=setTimeout(()=>{child.kill?.();reject(fail('Le programme de mise à jour n’a pas démarré. Votre bureau reste ouvert.','UPDATE_RESTART'));},5000);
    child.once('error',()=>{clearTimeout(timer);reject(fail('Le programme de mise à jour n’a pas démarré. Votre bureau reste ouvert.','UPDATE_RESTART'));});
    child.once('message',message=>{clearTimeout(timer);if(message?.ready!==true){child.kill?.();reject(fail('Le programme de mise à jour n’a pas démarré.','UPDATE_RESTART'));return;}child.disconnect?.();child.unref?.();resolve({pid:child.pid});});
    child.once('exit',()=>{clearTimeout(timer);reject(fail('Le programme de mise à jour s’est arrêté. Votre bureau reste ouvert.','UPDATE_RESTART'));});
  });
}
export async function updateMain(argv=process.argv.slice(2)){
  if(argv.length===2&&argv[0]==='--worker'){
    const file=path.resolve(argv[1]);if(path.dirname(file)!==path.dirname(fileURLToPath(import.meta.url)))throw fail('Le plan de mise à jour n’est pas local.');const config=JSON.parse((await readPlain(file,2*1024*1024)).toString('utf8'));process.send?.({ready:true});await runUpdateWorker(config);return;
  }
  const options={};for(let index=0;index<argv.length;index++){const key=argv[index];if(key==='--confirmed')options.confirmed=true;else if(['--root','--data-dir','--version','--port'].includes(key))options[key.slice(2)]=argv[++index];else throw fail('Utilisez --root, --data-dir, --version, --port et --confirmed.');}
  if(options.confirmed!==true||!path.isAbsolute(options.root||''))throw fail('Confirmez la mise à jour et précisez le dossier du logiciel.','UPDATE_CONFIRMATION');
  const root=await realpath(options.root),pkg=JSON.parse((await readPlain(path.join(root,'package.json'),32768)).toString('utf8')),port=Number(options.port||process.env.PORT||4850);await freePort(port);
  const release=await latestUpdateRelease();if(options.version&&options.version!==release.version)throw fail('La version demandée n’est plus la dernière publication stable.','UPDATE_VERSION');
  const dataDir=await realpath(options['data-dir']||process.env.OSCAR_DATA_DIR||path.join(os.homedir(),'Documents','Oscar et les agents'));
  const config=await prepareUpdate({root,currentVersion:pkg.version,release,dataDir,port});await spawnUpdateWorker(config);console.log('La mise à jour est préparée. Oscar redémarrera après la fermeture de ce programme.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)updateMain().catch(error=>{process.send?.({ready:false});console.error(error.message||'La mise à jour a échoué.');process.exitCode=1;});
