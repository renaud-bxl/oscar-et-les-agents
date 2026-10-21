import path from 'node:path';
import { constants, lstatSync, openSync, readFileSync, closeSync } from 'node:fs';

// Used before any engine, routine or connection starts. Only the updater's
// matching child may start while it holds the installation lock.
export function assertUpdateStartup({ dataDir, restartId = process.env.OSCAR_UPDATE_RESTART_ID } = {}) {
  const busy = () => Object.assign(new Error('La mise à jour d’Oscar est en cours. Gardez la page ouverte et attendez la fin du redémarrage. Si le problème persiste, conservez le dossier app-updates dans vos Documents pour retrouver la sauvegarde.'), { code:'UPDATE_BUSY' });
  let handle;
  try {
    const directory=path.join(dataDir,'app-updates');
    let folder;try{folder=lstatSync(directory);}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(!folder.isDirectory()||folder.isSymbolicLink())throw busy();
    const file=path.join(directory,'update.lock');
    let info;try{info=lstatSync(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw busy();
    handle=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    const lock=JSON.parse(readFileSync(handle,'utf8'));
    if(!/^[a-f\d]{64}$/u.test(lock.jobId||'')||!/^[a-f\d]{64}$/u.test(restartId||'')||lock.restartId!==restartId)throw busy();
  } catch(error) { if(error.code==='UPDATE_BUSY')throw error;throw busy(); }
  finally {if(handle!==undefined)closeSync(handle);}
}
