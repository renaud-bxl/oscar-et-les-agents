import path from 'node:path';
import {lstatSync,openSync,readFileSync,closeSync,constants} from 'node:fs';
import {rm} from 'node:fs/promises';
import {latestUpdateRelease,validUpdateVersion,compareUpdateVersions,inspectUpdateInstallation,prepareUpdate,spawnUpdateWorker,releaseUpdateLock,writeUpdateReceipt} from '../scripts/update.mjs';

const CACHE_MS=15*60*1000,CHECK_INTERVAL_MS=6*60*60*1000;
const BLOCKERS=new Set(['missions','calendar','connections','publishing','automations','documents','voice','dictation','requests']);
const RESULT_STATES=new Set(['ready','restarting','updated','rolled_back','error']);
const fail=(message,code)=>Object.assign(new Error(message),{code});
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
function readResult(directory){
  let handle;try{
    const folder=path.join(directory,'app-updates'),info=lstatSync(folder);if(!info.isDirectory()||info.isSymbolicLink())return null;
    const file=path.join(folder,'result.json'),before=lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.size>16384)return null;
    handle=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const value=JSON.parse(readFileSync(handle,'utf8'));
    if(!RESULT_STATES.has(value.status)||!validUpdateVersion(value.fromVersion)||!validUpdateVersion(value.toVersion)||!/^[a-f\d]{64}$/u.test(value.restartId))return null;
    return{status:value.status,fromVersion:value.fromVersion,toVersion:value.toVersion,...(finite(value.finishedAt)?{finishedAt:value.finishedAt}:{}),...(typeof value.code==='string'&&/^UPDATE_[A-Z_]{1,40}$/u.test(value.code)?{code:value.code}:{}),restartId:value.restartId};
  }catch{return null;}finally{if(handle!==undefined)closeSync(handle);}
}

/** Release discovery is read-only; installation requires a separate exact confirmation. */
export class AppUpdates{
  constructor({root,currentVersion,dataDir,getBusyReasons=()=>[],getPort=()=>Number(process.env.PORT||4850),onChange=()=>{},requestShutdown,autoCheck=false,fetchImpl=fetch,prepare=prepareUpdate,launch=spawnUpdateWorker,now=Date.now,timers=globalThis,defer=action=>setImmediate(action),env=process.env}={}){
    if(!path.isAbsolute(root||'')||!path.isAbsolute(dataDir||'')||!validUpdateVersion(currentVersion))throw fail('Les chemins ou la version du bureau ne sont pas valides.','UPDATE_UNSUPPORTED');
    Object.assign(this,{root,currentVersion,dataDir,getBusyReasons,getPort,onChange,requestShutdown,fetchImpl,prepare,launch,now,timers,defer,env});
    this.status='idle';this.latest=null;this.checkedAt=null;this.attemptedAt=null;this.error=null;this.installation={supported:false,kind:'unknown'};
    this.ready=inspectUpdateInstallation({root,currentVersion}).then(value=>{this.installation=value;this.changed();if(autoCheck&&!this.closed){this.check().catch(()=>{});this.schedule();}});
  }
  blockers(){try{const values=this.getBusyReasons();return [...new Set(Array.isArray(values)?values.filter(value=>BLOCKERS.has(value)):['requests'])];}catch{return['requests'];}}
  result(){return readResult(this.dataDir);}
  lockExists(){try{return!!lstatSync(path.join(this.dataDir,'app-updates','update.lock'));}catch{return false;}}
  get isBusy(){
    if(this.installing)return true;
    const restartId=this.env.OSCAR_UPDATE_RESTART_ID;if(!/^[a-f\d]{64}$/u.test(restartId||''))return false;
    // A restart nonce stays in the process environment after a successful update.
    // A later, failed preparation must not turn that historical nonce into a job.
    if(!this.lockExists())return false;
    const result=this.result();return!result||result.restartId!==restartId||!['updated','rolled_back','error'].includes(result.status);
  }
  get state(){
    const stored=this.result(),result=stored?{status:stored.status,fromVersion:stored.fromVersion,toVersion:stored.toVersion,...(stored.finishedAt!==undefined?{finishedAt:stored.finishedAt}:{}),...(stored.code?{code:stored.code}:{})}:null;
    const busyReasons=this.blockers(),installed=this.installation.supported===true,supported=installed&&typeof this.requestShutdown==='function';
    const lockExists=this.lockExists(),failedRestart=stored?.restartId===this.env.OSCAR_UPDATE_RESTART_ID&&stored?.status==='error';
    const recoveryRequired=lockExists&&!this.installing&&(!this.env.OSCAR_UPDATE_RESTART_ID||failedRestart);
    const externalPending=this.isBusy&&!this.installing,ownReceipt=stored&&stored.restartId===this.env.OSCAR_UPDATE_RESTART_ID;
    const status=recoveryRequired?'error':externalPending?'restarting':!this.installing&&ownReceipt&&['updated','rolled_back','error'].includes(stored.status)?stored.status:this.status==='idle'&&result?result.status:this.status;
    return{installed,supported,currentVersion:this.currentVersion,status,latestVersion:this.latest?.version||null,checkedAt:this.checkedAt,releaseUrl:this.latest?.releaseUrl||null,releaseNotes:this.latest?.releaseNotes||'',busyReasons,recoveryRequired,
      maintenance:this.isBusy,canInstall:supported&&!this.closed&&!this.isBusy&&!recoveryRequired&&!busyReasons.length&&!!this.latest&&compareUpdateVersions(this.latest.version,this.currentVersion)>0,error:recoveryRequired?{code:'UPDATE_RECOVERY',message:'Une mise à jour interrompue doit être vérifiée avant de recommencer. La sauvegarde du code et vos données sont conservées.'}:this.error||(this.installation.error&&!supported?this.installation.error:null),result};
  }
  changed(){if(!this.closed)this.onChange(this.state);}
  async check({force=false}={}){
    await this.ready;if(this.closed)return this.state;if(this.checking)return this.checking;if(this.installing)return this.state;
    const age=this.attemptedAt===null?Infinity:this.now()-this.attemptedAt;if(age<(force?10000:CACHE_MS))return this.state;
    this.status='checking';this.error=null;this.attemptedAt=this.now();this.changed();const controller=new AbortController();this.checkController=controller;
    this.checking=(async()=>{try{this.latest=await latestUpdateRelease({fetchImpl:this.fetchImpl,signal:controller.signal});this.checkedAt=this.now();this.status=compareUpdateVersions(this.latest.version,this.currentVersion)>0?'available':'up_to_date';}
      catch(error){if(!this.closed){this.status='error';this.error={code:error.code?.startsWith('UPDATE_')?error.code:'UPDATE_NETWORK',message:error.code?.startsWith('UPDATE_')?error.message:'La recherche de mise à jour a échoué. Réessayez plus tard.'};}}
      finally{this.checking=null;if(this.checkController===controller)this.checkController=null;this.changed();}return this.state;})();return this.checking;
  }
  async install(body){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['version','confirmed'].includes(key))||body.confirmed!==true)throw fail('Confirmez la version proposée avant de mettre le bureau à jour.','UPDATE_CONFIRMATION');
    if(!validUpdateVersion(body.version))throw fail('La version demandée n’est pas valide.','UPDATE_VERSION');
    if(this.closed||this.isBusy||this.blockers().length)throw fail('Terminez les opérations en cours avant de mettre le bureau à jour.','UPDATE_BUSY');
    this.installing=true;this.status='downloading';this.error=null;this.changed();const controller=new AbortController();this.installController=controller;let prepared,handedOff=false;
    this.operation=(async()=>{
      try{
        await this.ready;if(!this.installation.supported||typeof this.requestShutdown!=='function')throw fail(this.installation.error?.message||'Cette copie ne peut pas être mise à jour automatiquement.','UPDATE_UNSUPPORTED');
        this.latest=await latestUpdateRelease({fetchImpl:this.fetchImpl,signal:controller.signal});this.checkedAt=this.now();this.attemptedAt=this.checkedAt;
        if(this.latest.version!==body.version||compareUpdateVersions(body.version,this.currentVersion)<=0)throw fail('La publication proposée a changé. Vérifiez la nouvelle version avant de confirmer.','UPDATE_VERSION');
        if(this.blockers().length)throw fail('Terminez les opérations en cours avant de mettre le bureau à jour.','UPDATE_BUSY');
        prepared=await this.prepare({root:this.root,currentVersion:this.currentVersion,release:this.latest,dataDir:this.dataDir,port:this.getPort(),fetchImpl:this.fetchImpl,signal:controller.signal});
        if(this.closed||controller.signal.aborted||this.blockers().length)throw fail('Une opération empêche le redémarrage. Votre bureau est conservé.','UPDATE_BUSY');
        await this.launch(prepared,{env:this.env});handedOff=true;this.status='restarting';this.changed();
        this.defer(()=>Promise.resolve().then(()=>this.requestShutdown()).catch(()=>{this.status='error';this.error={code:'UPDATE_RESTART',message:'Le bureau ne s’est pas arrêté. Aucun fichier n’a été remplacé.'};this.installing=false;this.changed();}));
        return this.state;
      }catch(error){
        if(prepared&&!handedOff){await writeUpdateReceipt(prepared,{status:'error',code:error.code?.startsWith('UPDATE_')?error.code:'UPDATE_FILES',finishedAt:this.now()}).catch(()=>{});await releaseUpdateLock(prepared).catch(()=>{});await rm(prepared.workspace,{recursive:true,force:true}).catch(()=>{});}
        this.installing=false;this.status='error';this.error={code:error.code?.startsWith('UPDATE_')?error.code:'UPDATE_FILES',message:error.code?.startsWith('UPDATE_')?error.message:'La préparation a échoué. Votre bureau est conservé.'};this.changed();throw fail(this.error.message,this.error.code);
      }finally{if(this.installController===controller)this.installController=null;}
    })();return this.operation;
  }
  schedule(){if(this.timer!=null)this.timers.clearTimeout(this.timer);if(!this.closed){this.timer=this.timers.setTimeout(()=>{this.timer=null;this.check().catch(()=>{}).finally(()=>this.schedule());},CHECK_INTERVAL_MS);this.timer?.unref?.();}}
  async close(){this.closed=true;if(this.timer!=null)this.timers.clearTimeout(this.timer);this.timer=null;this.checkController?.abort();if(!this.installing||this.status!=='restarting')this.installController?.abort();await this.checking?.catch(()=>{});await this.operation?.catch(()=>{});}
}
