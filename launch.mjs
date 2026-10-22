import {spawn,execFile} from 'node:child_process';
import {openSync,closeSync,existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {assertUpdateStartup} from './lib/update-startup.mjs';
import {resolveInstallationDataLocation,dataDirectoryHash} from './lib/installation-paths.mjs';

const PROJECT_ROOT=path.dirname(fileURLToPath(import.meta.url));
const fail=message=>new Error(message);
export async function launchOffice({root=PROJECT_ROOT,env=process.env,home,port=Number(env.PORT??4850)}={},dependencies={}){
  if(!Number.isInteger(port)||port<1||port>65535)throw fail('Le port choisi est invalide.');
  const location=resolveInstallationDataLocation({root,env,home});
  const childEnv={...env,OSCAR_DATA_DIR:location.dataDir,PATH:[path.join(root,'.runtime','bin'),path.join(root,'.tools','node_modules','.bin'),env.PATH||''].join(path.delimiter)};
  const fetchImpl=dependencies.fetch||fetch,spawnImpl=dependencies.spawn||spawn,wait=dependencies.delay||delay,log=dependencies.log||console.log;
  const url=`http://127.0.0.1:${port}`;
  async function ready(){
    let response;
    try{response=await fetchImpl(url+'/api/updates/health',{signal:AbortSignal.timeout(800),redirect:'error'});}
    catch(error){if(error.code==='ECONNREFUSED'||error.cause?.code==='ECONNREFUSED')return false;throw fail('Impossible de vérifier si ce port est disponible. Aucun autre bureau n’a été lancé.');}
    let data;try{data=await response.json();}catch{throw fail('Un autre service utilise ce port. Fermez-le ou choisissez un autre port avant de lancer Oscar.');}
    if(!response.ok||data.app!=='oscar-et-les-agents')throw fail('Un autre service utilise ce port. Aucun bureau supplémentaire n’a été lancé.');
    const checked=resolveInstallationDataLocation({root,env,home});
    if(checked.dataDir!==location.dataDir)throw fail('Le dossier de données a changé pendant le lancement. Relancez le bureau pour vérifier son nouvel emplacement.');
    const expected=existsSync(location.dataDir)?dataDirectoryHash(location.dataDir):null;
    if((location.strict||data.dataDirectoryHash)&&(!expected||data.dataDirectoryHash!==expected))throw fail('Un autre bureau utilise déjà ce port avec un autre dossier de données, ou ne permet pas de vérifier son emplacement. Fermez son serveur avant de lancer ce bureau.');
    return true;
  }
  if(!await ready()){
    assertUpdateStartup({dataDir:location.dataDir});
    const openLog=dependencies.openLog||(()=>openSync(path.join(root,'atelier.log'),'a',0o600));
    const closeLog=dependencies.closeLog||closeSync;const handle=openLog();let server,error;
    try{server=spawnImpl(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:childEnv,detached:true,stdio:['ignore',handle,handle]});server.once('error',cause=>{error=cause;});server.unref();}finally{closeLog(handle);}
    let started=false;
    for(let index=0;index<40;index++){if(error)throw fail('Impossible de démarrer Oscar et les agents. Consultez atelier.log.');if(await ready()){started=true;break;}await wait(250);}
    if(!started)throw fail(`Oscar et les agents ne répond pas. Consultez atelier.log dans son dossier, ou vérifiez le port ${port}.`);
  }
  const browserUrl=`http://localhost:${port}`;
  if(dependencies.open)await dependencies.open(browserUrl);else await new Promise((resolve,reject)=>execFile(process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open',[browserUrl],error=>error?reject(fail('Le bureau est prêt, mais le navigateur n’a pas pu être ouvert. Ouvrez son adresse manuellement.')):resolve()));
  log(`Oscar et les agents est ouvert : ${browserUrl}`);return{url:browserUrl,dataDir:location.dataDir};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)launchOffice().catch(error=>{console.error(error.message);process.exitCode=1;});
