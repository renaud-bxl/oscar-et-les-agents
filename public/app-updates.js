import {getLocale,translate} from './i18n.js';
import messages from './translations-updates.js';

const REPOSITORY='https://github.com/renaud-bxl/oscar-et-les-agents';
const PROGRESS=new Set(['downloading','ready','restarting']);
const ACTIVE=new Set(['planning','running','reviewing','assembling']);
const STATUSES=new Set(['idle','checking','up_to_date','available','downloading','ready','restarting','updated','rolled_back','error']);
const BUSY_LABELS={missions:'Des missions sont encore en cours.',calendar:'Un rendez-vous est en cours de création.',connections:'Une connexion est en cours.',publishing:'Une publication est en cours.',automations:'Une routine démarre actuellement.',documents:'Des documents sont en cours de préparation.',voice:'Une opération vocale est en cours.',dictation:'Une opération de dictée est en cours.',requests:'Une demande est en cours de validation.'};
const version=value=>typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/u.test(value)?value:null;
const clean=(value,max=1600)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'').trim().slice(0,max):'';
const text=(element,value)=>{const next=String(value??'');if(element.textContent!==next)element.textContent=next;};
const newer=(a,b)=>{if(!a||!b)return false;const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i];return false;};
const aborted=()=>Object.assign(new Error('Request cancelled'),{name:'AbortError'});
export const updatesText=(source,locale=getLocale())=>messages[source]?.[locale]||translate(source,locale);

/** Release URLs are constructed from the fixed project, never from remote text. */
export function appUpdateView(snapshot,{clientVersion=null,state={},locale=getLocale()}={}){
  const source=snapshot&&typeof snapshot==='object'?snapshot:{},status=STATUSES.has(source.status)?source.status:'idle',current=version(source.currentVersion),latest=version(source.latestVersion),tr=value=>updatesText(value,locale);
  const busyReasons=Array.isArray(source.busyReasons)?[...new Set(source.busyReasons.map(reason=>typeof reason==='string'&&Object.hasOwn(BUSY_LABELS,reason)?BUSY_LABELS[reason]:'Une opération est encore en cours.'))]:[];
  if(Array.isArray(state?.missions)&&state.missions.some(mission=>ACTIVE.has(mission?.status))&&!busyReasons.includes(BUSY_LABELS.missions))busyReasons.push('Attendez la fin des missions en cours.');
  if(source.maintenance===true&&!PROGRESS.has(status))busyReasons.push('Le bureau prépare déjà sa mise à jour.');
  const available=newer(latest,current),progress=PROGRESS.has(status),reloadRequired=!!version(clientVersion)&&!!current&&clientVersion!==current;
  const error=source.error&&typeof source.error==='object'?{code:clean(source.error.code,100),message:clean(source.error.message,1600)}:null;
  let label=status==='checking'?'Vérification en cours…':status==='up_to_date'?'Oscar est à jour.':status==='downloading'?'Téléchargement de la nouvelle version…':status==='ready'?'Nouvelle version préparée.':status==='restarting'?'Le bureau redémarre…':status==='updated'?'La mise à jour est terminée.':status==='rolled_back'?'La version précédente a été rétablie.':status==='error'?error?.code==='UPDATE_NETWORK'?'La vérification est indisponible hors connexion. Réessayez plus tard.':'La mise à jour n’a pas abouti. Vos fichiers restent conservés.':available?'Une nouvelle version d’Oscar est disponible.':'Les mises à jour sont recherchées automatiquement.';
  if(reloadRequired)label='La nouvelle version est prête. Rechargez quand vous êtes prêt.';
  const checkedAt=typeof source.checkedAt==='number'&&Number.isFinite(source.checkedAt)&&source.checkedAt>=0&&Number.isFinite(new Date(source.checkedAt).getTime())?source.checkedAt:null;
  const date=checkedAt===null?tr('Pas encore vérifié'):new Intl.DateTimeFormat(({fr:'fr-BE',en:'en-GB',nl:'nl-BE'})[locale]||'fr-BE',{dateStyle:'medium',timeStyle:'short'}).format(checkedAt);
  return{status,currentVersion:current,latestVersion:latest,installed:source.installed===true,supported:source.installed===true&&source.supported!==false,sourceCheckout:source.installed===false,available,progress,reloadRequired,canInstall:source.installed===true&&source.supported!==false&&source.canInstall===true&&available&&!progress&&status!=='checking'&&!reloadRequired&&busyReasons.length===0,
    label:tr(label),checkedAt,dateLabel:date,releaseNotes:clean(source.releaseNotes,12000),releaseUrl:latest?`${REPOSITORY}/releases/tag/v${latest}`:null,busyReasons:[...new Set(busyReasons)].map(tr),error:error?{...error,message:tr(error.message)}:null};
}

/** Keeps the current page and its drafts open until an explicit reload click. */
export class AppUpdates{
  constructor({hosts,request,getState=()=>({}),reload=()=>globalThis.location?.reload(),timers=globalThis,now=Date.now,reconnectIntervalMs=2000,reconnectTimeoutMs=60000,requestTimeoutMs=8000}={}){
    if(!hosts?.notice?.ownerDocument||!hosts?.settings?.ownerDocument||typeof request!=='function')throw new TypeError('Les emplacements et le service de mises à jour sont nécessaires.');
    Object.assign(this,{hosts,request,getState,reload,timers,now});this.document=hosts.settings.ownerDocument;this.cards=[];this.listeners=[];this.controllers=new Set();this.epoch=0;this.revision=0;this.snapshot={};this.clientVersion=null;this.localError='';this.action=null;this.dismissedVersion=null;this.reconnectIntervalMs=Math.max(200,Math.min(5000,reconnectIntervalMs));this.reconnectTimeoutMs=Math.max(1000,Math.min(90000,reconnectTimeoutMs));this.requestTimeoutMs=Math.max(250,Math.min(15000,requestTimeoutMs));
    const node=(tag,cls='')=>{const element=this.document.createElement(tag);element.className=cls;return element;};this.node=node;
    this.notice=node('aside','app-updates-notice');this.notice.dataset.noTranslate='';this.notice.hidden=true;this.noticeCopy=node('span','app-updates-notice-copy');this.noticeCopy.setAttribute('role','status');this.noticeAction=node('button','app-updates-notice-action');this.noticeAction.type='button';this.dismiss=node('button','app-updates-dismiss');this.dismiss.type='button';this.dismiss.textContent='×';this.notice.append(this.noticeCopy,this.noticeAction,this.dismiss);hosts.notice.append(this.notice);
    this.root=node('section','app-updates-card');this.root.dataset.noTranslate='';this.heading=node('h3');this.status=node('p','app-updates-status');this.status.setAttribute('role','status');this.metadata=node('dl','app-updates-metadata');this.meta={};
    for(const key of ['current','latest','checked']){const pair=node('div'),label=node('dt'),value=node('dd');pair.append(label,value);this.metadata.append(pair);this.meta[key]={label,value};}
    this.sourceNote=node('p','app-updates-source');this.sourceLink=node('a','app-updates-link');this.sourceLink.href=REPOSITORY+'#installer-et-ouvrir';this.sourceLink.target='_blank';this.sourceLink.rel='noopener noreferrer';
    this.busy=node('ul','app-updates-busy');this.error=node('p','app-updates-error');this.error.setAttribute('role','alert');
    this.notes=node('details','app-updates-notes');this.notesTitle=node('summary');this.notesText=node('pre');this.notesText.setAttribute('data-no-translate','');this.release=node('a','app-updates-link');this.release.target='_blank';this.release.rel='noopener noreferrer';this.notes.append(this.notesTitle,this.notesText,this.release);
    this.actions=node('div','app-updates-actions');this.check=node('button','app-updates-check');this.install=node('button','app-updates-install');this.retry=node('button','app-updates-retry');this.reloadButton=node('button','app-updates-reload');for(const button of [this.check,this.install,this.retry,this.reloadButton])button.type='button';this.actions.append(this.check,this.install,this.retry,this.reloadButton);
    this.preserve=node('p','app-updates-preserve');this.root.append(this.heading,this.status,this.metadata,this.sourceNote,this.sourceLink,this.busy,this.error,this.notes,this.actions,this.preserve);hosts.settings.append(this.root);
    this.dialog=node('dialog','app-updates-dialog');this.dialog.dataset.noTranslate='';this.dialogTitle=node('h2');this.dialogTitle.id='app-updates-confirm-title';this.dialog.setAttribute('aria-labelledby',this.dialogTitle.id);this.dialogVersion=node('strong','app-updates-confirm-version');this.dialogCopy=node('p');this.dialogPreserve=node('p');this.dialogWarning=node('p','app-updates-warning');this.dialogWarning.setAttribute('role','status');this.dialogError=node('p','app-updates-error');this.dialogError.setAttribute('role','alert');this.dialogNotes=node('details','app-updates-notes');this.dialogNotesTitle=node('summary');this.dialogNotesText=node('pre');this.dialogRelease=node('a','app-updates-link');this.dialogRelease.target='_blank';this.dialogRelease.rel='noopener noreferrer';this.dialogNotes.append(this.dialogNotesTitle,this.dialogNotesText,this.dialogRelease);this.dialogActions=node('div','app-updates-actions');this.cancel=node('button','app-updates-cancel');this.confirm=node('button','app-updates-install');this.cancel.type='button';this.confirm.type='button';this.dialogActions.append(this.cancel,this.confirm);this.dialog.append(this.dialogTitle,this.dialogVersion,this.dialogCopy,this.dialogPreserve,this.dialogNotes,this.dialogWarning,this.dialogError,this.dialogActions);this.document.body.append(this.dialog);
    const listen=(target,type,callback)=>{target.addEventListener(type,callback);this.listeners.push([target,type,callback]);};
    listen(this.check,'click',()=>this.checkNow());listen(this.install,'click',()=>this.openConfirmation());listen(this.noticeAction,'click',()=>this.view?.reloadRequired?this.reloadNow():this.reconnectExpired?this.startReconnect(true):this.openConfirmation());listen(this.dismiss,'click',()=>{this.dismissedVersion=this.view?.latestVersion;this.render();});listen(this.cancel,'click',()=>this.closeConfirmation());listen(this.confirm,'click',()=>this.installConfirmed());listen(this.reloadButton,'click',()=>this.reloadNow());listen(this.retry,'click',()=>this.startReconnect(true));listen(this.dialog,'cancel',event=>{event.preventDefault();this.closeConfirmation();});listen(this.document,'oscar:language',()=>this.render());
    const initial=this.state()?.updates;if(initial)this.update(initial);else this.render();this.refresh();
  }
  state(){try{return this.getState()||{};}catch{return{};}}
  update(snapshot){
    if(this.destroyed||!snapshot||typeof snapshot!=='object')return;const signature=JSON.stringify(snapshot);if(signature!==this.signature){this.signature=signature;this.revision++;}
    const before=this.snapshot;this.snapshot=snapshot;if(!this.clientVersion&&version(snapshot.currentVersion))this.clientVersion=snapshot.currentVersion;
    if(PROGRESS.has(snapshot.status)||snapshot.status==='updated'||snapshot.checkedAt!==before.checkedAt&&!snapshot.error)this.localError='';
    if(PROGRESS.has(snapshot.status)||['updated','rolled_back','error'].includes(snapshot.status))this.installUncertain=false;
    const returned=version(snapshot.currentVersion)&&this.clientVersion&&snapshot.currentVersion!==this.clientVersion;
    if(returned||['updated','rolled_back'].includes(snapshot.status)){this.stopReconnect();this.reconnectExpired=false;}
    this.render();if(snapshot.status==='restarting'&&!this.reconnectStarted&&!this.reconnectExpired)this.startReconnect();
  }
  async call(url,options={}){
    const controller=new AbortController();this.controllers.add(controller);let timer;
    try{return await Promise.race([Promise.resolve().then(()=>this.request(url,{...options,signal:controller.signal})),new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(aborted()),{once:true});timer=this.timers.setTimeout(()=>controller.abort(),this.requestTimeoutMs);})]);}
    finally{this.timers.clearTimeout(timer);this.controllers.delete(controller);}
  }
  async refresh({reconnecting=false}={}){
    if(this.destroyed)return null;const epoch=this.epoch,revision=this.revision;
    try{const snapshot=await this.call('/api/updates');if(this.destroyed||epoch!==this.epoch)return null;if(revision===this.revision)this.update(snapshot);return snapshot;}
    catch(error){if(this.destroyed||epoch!==this.epoch)return null;if(!reconnecting){this.localError='L’état des mises à jour n’a pas pu être chargé.';this.render();}return null;}
  }
  async checkNow(){
    if(this.destroyed||this.action||this.view?.progress||this.view?.status==='checking')return;this.action='check';this.localError='';this.render();const epoch=this.epoch,revision=this.revision;
    try{const snapshot=await this.call('/api/updates/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(this.destroyed||epoch!==this.epoch)return;if(revision===this.revision)this.update(snapshot);this.installUncertain=false;this.reconnectExpired=false;}
    catch(error){if(!this.destroyed&&epoch===this.epoch)this.localError=error.status?error.message||'La vérification est indisponible hors connexion. Réessayez plus tard.':'La vérification est indisponible hors connexion. Réessayez plus tard.';}
    finally{if(!this.destroyed&&epoch===this.epoch){this.action=null;this.render();}}
  }
  openConfirmation(){
    if(this.destroyed||this.action||!this.view?.available||this.view?.progress||this.view.reloadRequired)return;
    this.confirmationVersion=this.view.latestVersion;this.returnFocus=this.document.activeElement;this.render();if(!this.dialog.open)this.dialog.showModal();this.cancel.focus();
  }
  closeConfirmation(){if(this.dialog.open)this.dialog.close();this.confirmationVersion=null;if(this.returnFocus?.isConnected!==false)this.returnFocus?.focus?.({preventScroll:true});}
  async installConfirmed(){
    this.render();if(this.destroyed||this.action||!this.dialog.open||!this.view?.canInstall||this.installUncertain||this.confirmationVersion!==this.view.latestVersion)return;
    const target=this.confirmationVersion,epoch=this.epoch,revision=this.revision;this.targetVersion=target;this.action='install';this.localError='';this.render();
    try{const snapshot=await this.call('/api/updates/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:target,confirmed:true})});if(this.destroyed||epoch!==this.epoch)return;this.closeConfirmation();if(revision===this.revision)this.update(snapshot);}
    catch(error){
      if(this.destroyed||epoch!==this.epoch)return;
      if(PROGRESS.has(this.snapshot.status)&&this.snapshot.latestVersion===target||this.snapshot.currentVersion===target){this.closeConfirmation();}
      else if(error.status>=400&&error.status<500){this.localError=error.message||'La mise à jour n’a pas abouti. Vos fichiers restent conservés.';this.refresh();}
      else{this.installUncertain=true;this.localError='La demande d’installation n’a pas pu être confirmée. Son état sera vérifié sans renvoyer la demande.';this.closeConfirmation();this.startReconnect();}
    }finally{if(!this.destroyed&&epoch===this.epoch){this.action=null;this.render();}}
  }
  startReconnect(force=false){
    if(this.destroyed)return;if(force){this.stopReconnect();this.reconnectExpired=false;this.localError='';}
    if(this.reconnectStarted)return;this.reconnectStarted=this.now()||1;this.reconnectDeadline=this.now()+this.reconnectTimeoutMs;this.render();this.scheduleReconnect();
  }
  scheduleReconnect(){
    if(this.destroyed||!this.reconnectStarted||this.reconnectTimer!=null)return;
    if(this.now()>=this.reconnectDeadline){this.stopReconnect();this.reconnectExpired=true;this.render();return;}
    this.reconnectTimer=this.timers.setTimeout(async()=>{this.reconnectTimer=null;if(this.destroyed||!this.reconnectStarted)return;if(this.now()>=this.reconnectDeadline){this.stopReconnect();this.reconnectExpired=true;this.render();return;}await this.refresh({reconnecting:true});if(this.destroyed||!this.reconnectStarted)return;this.scheduleReconnect();},Math.min(this.reconnectIntervalMs,Math.max(1,this.reconnectDeadline-this.now())));
  }
  stopReconnect(){if(this.reconnectTimer!=null)this.timers.clearTimeout(this.reconnectTimer);this.reconnectTimer=null;this.reconnectStarted=null;this.reconnectDeadline=null;}
  reloadNow(){if(!this.destroyed&&this.view?.reloadRequired)this.reload();}
  render(){
    if(this.destroyed)return;const tr=updatesText,view=appUpdateView(this.snapshot,{clientVersion:this.clientVersion,state:this.state()});this.view=view;
    text(this.heading,tr('Mises à jour d’Oscar'));this.root.dataset.status=view.status;text(this.status,this.reconnectExpired?tr('La reconnexion prend plus de temps. Cette page reste ouverte ; réessayez sans relancer l’installation.'):this.installUncertain&&this.reconnectStarted?tr('Vérification de la demande de mise à jour…'):view.label);
    for(const[key,label,value]of [['current','Version installée',view.currentVersion||'—'],['latest',view.available?'Nouvelle version':'Dernière version publiée',view.latestVersion||tr('Aucune nouvelle version connue')],['checked','Dernière vérification',view.dateLabel]]){text(this.meta[key].label,tr(label));text(this.meta[key].value,value);}
    text(this.sourceNote,tr(view.sourceCheckout?'Cette copie ne prend pas en charge la mise à jour automatique.':'Cette installation doit être mise à jour avec son installateur.'));this.sourceNote.hidden=view.supported||!view.currentVersion;text(this.sourceLink,tr('Ouvrir le guide d’installation'));this.sourceLink.hidden=this.sourceNote.hidden;
    const reasons=[...view.busyReasons];this.busy.hidden=!reasons.length;const signature=reasons.join('\n');if(signature!==this.busySignature){this.busySignature=signature;this.busy.replaceChildren(...reasons.map(reason=>{const li=this.node('li');li.textContent=reason;return li;}));}
    text(this.error,this.localError?tr(this.localError):view.error?.message||'');this.error.hidden=!this.error.textContent;
    text(this.notesTitle,tr('Les nouveautés'));text(this.notesText,view.releaseNotes||tr('Aucune note de version disponible.'));this.notes.hidden=!view.latestVersion;text(this.release,tr('Lire la note de version sur GitHub ↗'));this.release.hidden=!view.releaseUrl;if(view.releaseUrl)this.release.href=view.releaseUrl;else this.release.removeAttribute('href');
    text(this.check,tr(this.action==='check'||view.status==='checking'?'Vérification en cours…':'Vérifier les mises à jour'));this.check.disabled=!!this.action||view.progress||view.status==='checking';
    text(this.install,tr('Mettre à jour'));this.install.hidden=!view.available||view.progress||view.reloadRequired;this.install.disabled=!!this.action||!view.canInstall||!!this.installUncertain;
    text(this.reloadButton,tr('Recharger maintenant'));this.reloadButton.hidden=!view.reloadRequired;text(this.retry,tr('Réessayer la connexion'));this.retry.hidden=!this.reconnectExpired;
    text(this.preserve,tr('Vous choisirez quand recharger cette page. Vos saisies restent ici jusque-là.'));this.preserve.hidden=!view.progress&&!view.reloadRequired&&!this.reconnectStarted&&!this.reconnectExpired;
    const showNotice=view.reloadRequired||view.progress||this.reconnectExpired||this.installUncertain||view.available&&this.dismissedVersion!==view.latestVersion;this.notice.hidden=!showNotice;
    text(this.noticeCopy,this.reconnectExpired?tr('Le bureau redémarre ou est temporairement indisponible.'):view.reloadRequired?tr('La nouvelle version est prête. Rechargez quand vous êtes prêt.'):view.progress?view.label:this.installUncertain?tr('Vérification de la demande de mise à jour…'):tr('Une nouvelle version d’Oscar est disponible.')+' '+(view.latestVersion||''));
    text(this.noticeAction,tr(view.reloadRequired?'Recharger maintenant':this.reconnectExpired?'Réessayer la connexion':'Voir la mise à jour'));this.noticeAction.disabled=(!!this.action||view.progress)&&!view.reloadRequired;this.dismiss.hidden=view.progress||view.reloadRequired||!!this.reconnectStarted||this.reconnectExpired;this.dismiss.setAttribute('aria-label',tr('Masquer la notification'));
    text(this.dialogTitle,tr('Installer cette version ?'));text(this.dialogVersion,this.confirmationVersion?`v${this.confirmationVersion}`:'');text(this.dialogCopy,tr('Vos missions et vos fichiers restent dans leur dossier. Le bureau redémarre après la préparation.'));text(this.dialogPreserve,tr('Vous choisirez quand recharger cette page. Vos saisies restent ici jusque-là.'));text(this.cancel,tr(this.action==='install'?'Fermer la mise à jour':'Annuler'));text(this.confirm,tr('Installer cette version'));
    text(this.dialogNotesTitle,tr('Les nouveautés'));text(this.dialogNotesText,view.releaseNotes||tr('Aucune note de version disponible.'));this.dialogNotes.hidden=!view.latestVersion;text(this.dialogRelease,tr('Lire la note de version sur GitHub ↗'));this.dialogRelease.hidden=!view.releaseUrl;if(view.releaseUrl)this.dialogRelease.href=view.releaseUrl;else this.dialogRelease.removeAttribute('href');text(this.dialogError,this.localError?tr(this.localError):view.error?.message||'');this.dialogError.hidden=!this.dialogError.textContent;
    const changed=!!this.confirmationVersion&&this.confirmationVersion!==view.latestVersion,warning=changed?tr('La version proposée a changé. Fermez cette fenêtre puis vérifiez à nouveau.'):view.progress?view.label:this.installUncertain?tr('Vérification de la demande de mise à jour…'):view.busyReasons.join(' ')||(!view.canInstall?tr(!view.supported?view.sourceCheckout?'Cette copie ne prend pas en charge la mise à jour automatique.':'Cette installation doit être mise à jour avec son installateur.':'Vérifiez les mises à jour avant de continuer.'):'');text(this.dialogWarning,warning);this.dialogWarning.hidden=!warning;this.confirm.disabled=!!this.action||!view.canInstall||changed||!!this.installUncertain;
  }
  destroy(){
    if(this.destroyed)return;this.destroyed=true;this.epoch++;this.stopReconnect();for(const controller of this.controllers)controller.abort();this.controllers.clear();for(const[target,type,callback]of this.listeners)target.removeEventListener(type,callback);this.listeners=[];if(this.dialog.open)this.dialog.close();this.dialog.remove();this.root.remove();this.notice.remove();
  }
}
