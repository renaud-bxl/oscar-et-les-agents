import path from 'node:path';
import {mkdirSync,readdirSync,lstatSync,openSync,closeSync,fstatSync,readSync,writeFileSync,renameSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';

const fail=(message,code='MISSION_RECOVERY_FILES')=>Object.assign(new Error(message),{code});
const OMIT=new Set(['node_modules','vendor','.git','.tools','.runtime']);
const MAX_FILE=20*1024*1024,MAX_TOTAL=50*1024*1024;
export function recoveryErrorInfo(error,provider){
  const code=typeof error?.code==='string'&&/^(?:PROVIDER|CONNECTOR|MISSION)_[A-Z_]{1,60}$/u.test(error.code)?error.code:error?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'MISSION_INTERRUPTED';
  const action=['retry','repair','reconnect','wait','review-permissions','update-engine','review-output','check-connection','review-tools'].includes(error?.action)?error.action:code==='PROVIDER_TIMEOUT'?'repair':'review-output';
  return{code,...(['codex','claude'].includes(provider)?{provider}:{}),action,recoverable:error?.recoverable===true||code==='PROVIDER_TIMEOUT'};
}
export function canRepairRuntime(error){
  if(error?.name==='AbortError'||error?.code==='PROVIDER_CANCELLED')return false;
  return error?.name==='TimeoutError'||['PROVIDER_TIMEOUT','PROVIDER_NETWORK','PROVIDER_UNAVAILABLE'].includes(error?.code)&&error?.recoverable===true;
}
function plainBytes(file,before){
  const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const info=fstatSync(fd);if(!info.isFile()||info.dev!==before.dev||info.ino!==before.ino||info.size>MAX_FILE)throw fail('Un fichier a changé pendant la préparation de la reprise.');const bytes=Buffer.alloc(info.size);for(let offset=0;offset<bytes.length;){const count=readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)throw fail('Un fichier a changé pendant la préparation de la reprise.');offset+=count;}const after=fstatSync(fd);if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw fail('Un fichier a changé pendant la préparation de la reprise.');return bytes;}finally{closeSync(fd);}
}
function backupName(name){if(!['attempt-1','manual-recheck-1','package-policy-v2'].includes(name))throw fail('Le dossier de reprise n’est pas un dossier local sûr.');return name;}
function checkedDirectory(directory){const info=lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())throw fail('Le dossier de reprise n’est pas un dossier local sûr.');}
/** Private preservation only: no account, model, execution or overwrite. */
export function preserveRecoveryFiles({missionDirectory,workDirectory,state,name='attempt-1'}){
  backupName(name);
  if(!path.isAbsolute(missionDirectory)||path.dirname(workDirectory)!==missionDirectory||path.basename(workDirectory)!=='travail')throw fail('Le dossier de reprise n’est pas un dossier local sûr.');
  checkedDirectory(missionDirectory);checkedDirectory(workDirectory);
  const snapshot=JSON.stringify(state,null,2);if(Buffer.byteLength(snapshot)>8*1024*1024)throw fail('L’historique de la mission dépasse la limite de sauvegarde de reprise.');
  const files=[];let total=0;
  const walk=(relative='',depth=0)=>{
    if(depth>10)throw fail('Le dossier de travail dépasse la profondeur autorisée pour la reprise.');
    for(const entry of readdirSync(path.join(workDirectory,relative),{withFileTypes:true})){
      if(OMIT.has(entry.name))continue;
      const name=relative?`${relative}/${entry.name}`:entry.name;
      if(/[\\:\x00-\x1f\x7f]/u.test(name)||entry.name==='.'||entry.name==='..'||entry.name!==entry.name.trim())throw fail('Un chemin de travail ne peut pas être sauvegardé pour la reprise.');
      const file=path.join(workDirectory,name),info=lstatSync(file);
      if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory())throw fail('Un fichier lié ou spécial empêche la reprise. Les originaux sont conservés.');
      if(info.isDirectory()){walk(name,depth+1);continue;}
      if(info.size>MAX_FILE||files.length>=500||(total+=info.size)>MAX_TOTAL)throw fail('Les fichiers dépassent les limites de sauvegarde de reprise (20 Mo par fichier, 50 Mo au total).');
      const bytes=plainBytes(file,info);files.push({path:name,bytes,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
  };walk();
  const root=path.join(missionDirectory,'recovery');
  try{mkdirSync(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}checkedDirectory(root);
  const destination=path.join(root,name);try{mkdirSync(destination,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw fail('Une sauvegarde de reprise existe déjà. Elle est conservée avant toute nouvelle intervention.','MISSION_RECOVERY_LIMIT');throw error;}
  writeFileSync(path.join(destination,'previous-state.json'),snapshot,{flag:'wx',mode:0o600});
  const copied=path.join(destination,'files');mkdirSync(copied,{mode:0o700});
  for(const file of files){let parent=copied;for(const part of file.path.split('/').slice(0,-1)){parent=path.join(parent,part);try{mkdirSync(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}checkedDirectory(parent);}writeFileSync(path.join(copied,file.path),file.bytes,{flag:'wx',mode:0o600});}
  const manifest=files.map(file=>({path:file.path,size:file.bytes.length,sha256:file.sha256}));
  writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({files:manifest,totalBytes:total},null,2),{flag:'wx',mode:0o600});
  return{directory:`recovery/${name}`,filesCount:files.length,totalBytes:total};
}
export function preservePreviousInputs({missionDirectory,workDirectory,folder,name='attempt-1'}){
  backupName(name);
  if(!/^t(?:[1-9]|1\d|20)-(?:recherche|redaction|code|design|analyse)$/u.test(folder)||path.dirname(workDirectory)!==missionDirectory||path.basename(workDirectory)!=='travail')throw fail('Le dossier de reprise n’est pas un dossier local sûr.');
  const source=path.join(workDirectory,folder,'Contributions');let info;try{info=lstatSync(source);}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(!info.isDirectory()||info.isSymbolicLink())throw fail('Un fichier lié ou spécial empêche la reprise. Les originaux sont conservés.');
  const parent=path.join(missionDirectory,'recovery',name);checkedDirectory(parent);const inputs=path.join(parent,'previous-inputs');try{mkdirSync(inputs,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}checkedDirectory(inputs);
  renameSync(source,path.join(inputs,folder));return true;
}
