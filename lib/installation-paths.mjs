import path from 'node:path';
import os from 'node:os';
import {constants,lstatSync,realpathSync,mkdirSync,openSync,fstatSync,readFileSync,closeSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';

export const INSTALLATION_LOCATION_FILE=path.join('.runtime','installation.json');
const MARKER='.oscar-data-location.json',ID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/u;
const fail=(message)=>Object.assign(new Error(message),{code:'INSTALLATION_LOCATION'});
function info(file){try{return lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function systemPath(value){
  let directory=path.resolve(value);
  for(const[alias,target]of [['/var','/private/var'],['/tmp','/private/tmp']])if(directory===alias||directory.startsWith(alias+'/')){
    if(info(alias)?.isSymbolicLink()&&realpathSync(alias)===target)directory=target+directory.slice(alias.length);
  }
  return directory;
}
function directoryChain(directory){
  const parts=systemPath(directory).split(path.sep).filter(Boolean);let current=path.parse(directory).root;
  for(const part of parts){current=path.join(current,part);const item=info(current);if(item&&(item.isSymbolicLink()||!item.isDirectory()))throw fail('Le dossier choisi ou un de ses parents est un lien ou un fichier. Utilisez son chemin réel.');}
}
export function externalVolumeRoot(directory,{platform=process.platform}={}){
  const value=path.resolve(directory);
  if(platform==='linux'&&/^\/(?:media|mnt|run\/media)\//u.test(value)){
    for(let current=value;current!==path.parse(current).root;current=path.dirname(current)){
      const item=info(current),parent=info(path.dirname(current));if(item?.isDirectory()&&parent?.isDirectory()&&item.dev!==parent.dev)return current;
    }
  }
  const patterns=platform==='darwin'?[/^\/Volumes\/[^/]+/u]:platform==='linux'?[/^\/run\/media\/[^/]+\/[^/]+/u,/^\/media\/[^/]+\/[^/]+/u,/^\/mnt\/[^/]+/u]:[];
  return patterns.map(pattern=>value.match(pattern)?.[0]).find(Boolean)||null;
}
export function assertInstallationVolume(directory,{platform=process.platform}={}){
  const anchor=externalVolumeRoot(directory,{platform});if(!anchor)return;
  const mounted=info(anchor),parent=info(path.dirname(anchor));
  if(!mounted?.isDirectory()||mounted.isSymbolicLink()||!parent?.isDirectory()||mounted.dev===parent.dev)throw fail('Le disque externe choisi n’est pas monté. Rebranchez-le avant de poursuivre ; aucun dossier local de remplacement ne sera créé.');
}
function safePath(value,{home=os.homedir(),root,explicit=false,platform=process.platform}={}){
  if(typeof value!=='string'||!value.trim()||value.length>4096||/[\p{Cf}\x00-\x1f\x7f\\]/u.test(value)||explicit&&!path.isAbsolute(value))throw fail('Le dossier des données doit être un chemin absolu complet.');
  if(explicit&&(/\/\//u.test(value)||value.split('/').some(part=>part==='.'||part==='..')))throw fail('Choisissez un chemin complet, sans raccourci de dossier ambigu.');
  const directory=systemPath(value);
  directoryChain(directory);
  if([path.parse(directory).root,systemPath(home),'/Users','/Volumes','/Applications','/Library','/System','/usr','/usr/local','/bin','/sbin','/etc','/dev','/proc','/sys','/root','/home','/mnt','/media','/run/media','/opt','/private','/private/tmp','/tmp','/var','/var/tmp','/private/var','/private/var/tmp'].includes(directory)||/^\/(?:System|Library|Applications|usr|bin|sbin|etc|dev|proc|sys|root|private\/etc)(?:\/|$)/u.test(directory)||directory===externalVolumeRoot(directory,{platform}))throw fail('Choisissez un sous-dossier réservé aux données d’Oscar.');
  const codeRoot=root?systemPath(root):null;
  if(codeRoot&&(directory===codeRoot||directory.startsWith(codeRoot+path.sep)&&directory!==path.join(codeRoot,'data')))throw fail('Séparez les données du logiciel, ou utilisez son sous-dossier data.');
  assertInstallationVolume(directory,{platform});directoryChain(directory);return directory;
}
function readJson(file){
  const before=info(file);if(!before)return null;
  if(!before.isFile()||before.isSymbolicLink()||before.size>16384)throw fail('La configuration du dossier de données n’est pas un fichier local valide. Elle a été conservée.');
  let handle;try{
    handle=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const opened=fstatSync(handle);
    if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size>16384)throw fail('La configuration du dossier de données a changé.');
    const text=readFileSync(handle,'utf8'),after=fstatSync(handle);if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw fail('La configuration du dossier de données a changé.');
    const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;
  }catch(error){if(error.code==='INSTALLATION_LOCATION')throw error;throw fail('La configuration du dossier de données est illisible. Elle a été conservée ; vérifiez-la avant de poursuivre.');}finally{if(handle!==undefined)closeSync(handle);}
}
function storedLocation(root){
  const runtime=path.join(root,'.runtime'),item=info(runtime);if(item&&(item.isSymbolicLink()||!item.isDirectory()))throw fail('Le dossier privé de l’installation n’est pas un dossier local valide.');
  const value=readJson(path.join(root,INSTALLATION_LOCATION_FILE));if(value===null)return null;
  if(value.version!==1||typeof value.dataDirectory!=='string'||!path.isAbsolute(value.dataDirectory)||!ID.test(value.locationId||'')||Object.keys(value).some(key=>!['version','dataDirectory','locationId'].includes(key)))throw fail('La configuration du dossier de données est invalide. Elle a été conservée.');
  return value;
}
function marker(directory){
  const value=readJson(path.join(directory,MARKER));if(value===null)return null;
  if(value.version!==1||!ID.test(value.locationId||'')||Object.keys(value).some(key=>!['version','locationId'].includes(key)))throw fail('L’identité du dossier de données n’est pas valide. Aucun dossier de remplacement n’a été ouvert.');return value;
}
export function dataDirectoryHash(directory){return createHash('sha256').update(realpathSync(directory)).digest('hex');}

/** Resolve without creating directories, copying data or opening a service. */
export function resolveInstallationDataLocation({root,env=process.env,home=os.homedir(),dataDir,platform=process.platform}={}){
  if(!path.isAbsolute(root||''))throw fail('Le dossier du logiciel doit être un chemin absolu.');
  const explicit=dataDir!==undefined&&dataDir!==null,override=explicit?dataDir:env.OSCAR_DATA_DIR||env.ATELIER_DATA_DIR;
  const known=storedLocation(root),saved=!explicit&&known&&(!override||systemPath(override)===known.dataDirectory)?known:null,source=explicit?'argument':override?'environment':saved?'installation':'default';
  const directory=safePath(override||saved?.dataDirectory||path.join(home,'Documents','Oscar et les agents'),{root,home,explicit,platform});
  if(saved){
    const item=info(directory);
    if(!item?.isDirectory()||item.isSymbolicLink())throw fail('Le dossier de données choisi est indisponible. Rebranchez son disque ; aucun bureau vide ne sera créé ailleurs.');
    if(marker(directory)?.locationId!==saved.locationId)throw fail('Le dossier de données choisi n’est plus le dossier configuré. Rebranchez le bon disque ou choisissez explicitement un autre dossier à l’installation.');
  }
  return{dataDir:directory,source,configured:Boolean(saved),strict:source!=='default',hash:info(directory)?.isDirectory()?dataDirectoryHash(directory):null};
}

/** Called only by an explicit installation. Existing documents are never moved. */
export function configureInstallationDataLocation({root,dataDir,home=os.homedir(),platform=process.platform}={}){
  if(!path.isAbsolute(root||''))throw fail('Le dossier du logiciel doit être un chemin absolu.');
  const directory=safePath(dataDir,{root,home,explicit:true,platform});directoryChain(root);storedLocation(root);
  mkdirSync(directory,{recursive:true,mode:0o700});directoryChain(directory);const canonical=realpathSync(directory);
  let identity=marker(canonical);
  if(!identity){identity={version:1,locationId:randomUUID()};try{writeFileSync(path.join(canonical,MARKER),JSON.stringify(identity)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;identity=marker(canonical);if(!identity)throw fail('Le dossier de données a changé pendant sa préparation.');}}
  const runtime=path.join(root,'.runtime');mkdirSync(runtime,{recursive:true,mode:0o700});directoryChain(runtime);
  const target=path.join(root,INSTALLATION_LOCATION_FILE),temporary=path.join(runtime,`.installation-${randomUUID()}.tmp`);
  try{writeFileSync(temporary,JSON.stringify({version:1,dataDirectory:canonical,locationId:identity.locationId},null,2)+'\n',{flag:'wx',mode:0o600});renameSync(temporary,target);}finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
  return{dataDir:canonical,source:'installation',configured:true,strict:true,hash:dataDirectoryHash(canonical)};
}
