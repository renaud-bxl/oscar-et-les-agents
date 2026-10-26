import {getLocale,translate} from './i18n.js';
import {formatTimingDuration} from './mission-timing.js';
import messages from './translations-delivery-progress.js';

const ACTIVE=new Set(['planning','running','reviewing']);
const TERMINAL=new Set(['completed','needs_review','failed','cancelled']);
const STAGES=new Set(['review','assembly','final-review']);
const CALL_STATUSES=new Set(['running','completed','failed','cancelled']);
const SUBMITTED=new Set(['reviewing','approved','needs_review']);
const IMPORTANT=new Set(['needs_review','failed']);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const clean=(value,max=320)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'').replace(/\s+/gu,' ').trim().slice(0,max):'';
export const deliveryProgressText=(source,locale=getLocale())=>messages[source]?.[locale]||translate(source,locale);

/** A failed response is a stopped operation, never a progress update or a model dump. */
export function missionProblemSummary(mission,{locale=getLocale()}={}){
  if(!mission||!['failed','needs_review'].includes(mission.status))return null;
  const formatCodes=new Set(['MISSION_REVIEW_FORMAT','PROVIDER_STRUCTURED_OUTPUT_INVALID']);
  const interrupted=(Array.isArray(mission.tasks)?mission.tasks:[]).find(task=>task?.status!=='approved'&&formatCodes.has(task?.runtimeError?.code));
  const code=formatCodes.has(mission.errorInfo?.code)?mission.errorInfo.code:interrupted?.runtimeError?.code;
  const raw=typeof mission.error==='string'&&mission.error?mission.error:typeof interrupted?.review?.feedback==='string'?interrupted.review.feedback:'';
  if(!raw&&!code&&mission.status!=='failed')return null;
  const calls=Array.isArray(mission.performance?.calls)?mission.performance.calls:[];
  const stage=interrupted?.runtimeError?.stage||[...calls].reverse().find(call=>call?.status==='failed')?.stage||(code==='MISSION_REVIEW_FORMAT'?'review':null);
  const unreadable=Boolean(code)||/\bJSON\b|Unexpected (?:token|end)|réponse[^.\n]*(?:illisible|structurée|invalide|incomplète)/iu.test(raw);
  const source=unreadable?(['review','final-review'].includes(stage)?'Oscar n’a pas pu lire sa réponse de vérification.':'Oscar n’a pas pu lire la réponse du moteur.'):'Une erreur a interrompu la mission.';
  // Public errors are bounded again here. Keep the first diagnostic line only,
  // excluding response objects, stacks and possible credential-shaped values.
  const detail=clean([code,raw.split(/\r?\n/u).find(line=>line.trim())||''].filter(Boolean).join(' · '),1000).replace(/\bsk-[a-zA-Z0-9_-]+/gu,'[secret]').replace(/\bBearer\s+\S+/giu,'Bearer [secret]').replace(/\s*[\[{][\s\S]*$/u,'').slice(0,600);
  return{message:deliveryProgressText(source,locale),detail};
}

/** Only persisted mission/task/call facts produce progress; scenery is never evidence. */
export function deliveryProgressSnapshot(mission,{now=Date.now(),locale=getLocale()}={}){
  if(!mission||typeof mission!=='object')return null;
  const active=ACTIVE.has(mission.status),terminal=TERMINAL.has(mission.status),demo=mission.provider==='demo';
  const clock=finite(now)?now:null;
  const calls=!demo&&Array.isArray(mission.performance?.calls)?mission.performance.calls.filter(call=>call&&clean(call.agent)==='Oscar'&&STAGES.has(call.stage)&&CALL_STATUSES.has(call.status)&&finite(call.startedAt)&&(clock===null||call.startedAt<=clock)&&(call.durationMs==null||finite(call.durationMs))):[];
  const ordered=calls.map((call,index)=>({call,index})).sort((a,b)=>a.call.startedAt-b.call.startedAt||a.index-b.index);
  const current=active?ordered.filter(({call})=>call.status==='running'&&call.durationMs==null).at(-1)?.call:null;
  if(!terminal&&!(active&&(current||mission.status==='reviewing')))return null;
  const latest=current||ordered.filter(({call})=>call.status!=='running'&&finite(call.durationMs)).at(-1)?.call||null;
  const stage=current?.stage||null;
  const elapsedMs=current&&clock!==null?Math.max(0,clock-current.startedAt):null;
  const effectiveNow=active?clock:finite(mission.updatedAt)?(clock===null?mission.updatedAt:Math.min(clock,mission.updatedAt)):latest&&finite(latest.durationMs)?latest.startedAt+latest.durationMs:null;
  const activityEnd=latest?(latest===current?clock:latest.startedAt+latest.durationMs):null;
  const events=latest&&Array.isArray(mission.events)?mission.events.filter(event=>event?.kind==='activity'&&clean(event.who)==='Oscar'&&finite(event.at)&&event.at>=latest.startedAt&&(activityEnd===null||event.at<=activityEnd)&&(effectiveNow===null||event.at<=effectiveNow)&&clean(event.text)):[];
  const activity=events.map((event,index)=>({event,index})).sort((a,b)=>a.event.at-b.event.at||a.index-b.index).at(-1)?.event;
  const lastActivity=active&&activity?{text:clean(activity.text),at:activity.at,ageMs:effectiveNow===null?null:Math.max(0,effectiveNow-activity.at)}:null;
  const lastSignalAt=current?(lastActivity?.at??current.startedAt):null;
  const silenceMs=lastSignalAt!==null&&clock!==null?Math.max(0,clock-lastSignalAt):null;
  const silent=silenceMs!==null&&silenceMs>=30000;
  const tasks=Array.isArray(mission.tasks)?mission.tasks.filter(task=>task&&typeof task==='object'):[];
  const counts={submitted:tasks.filter(task=>SUBMITTED.has(task.status)).length,approved:tasks.filter(task=>task.status==='approved').length,total:tasks.length};
  const tr=source=>deliveryProgressText(source,locale);
  const problem=missionProblemSummary(mission,{locale});
  const unapproved=['needs_review','failed'].includes(mission.status)?tasks.filter(task=>task.status!=='approved'&&(mission.status==='needs_review'||task.review?.approved===false||task.runtimeError)).slice(0,20).map(task=>({id:clean(task.id,80),name:clean(task.agentName,60)||tr('Un collègue'),title:clean(task.title,180)||tr('Contribution à vérifier'),feedback:['MISSION_REVIEW_FORMAT','PROVIDER_STRUCTURED_OUTPUT_INVALID'].includes(task.runtimeError?.code)?tr('Oscar n’a pas pu lire sa réponse de vérification.'):clean(task.review?.feedback,360)||tr('Cette contribution n’est pas encore validée.')})):[];
  const finalFeedback=mission.status==='needs_review'&&mission.finalReview?.approved===false?clean(mission.finalReview.feedback,500):'';
  const recoveryKind=terminal&&mission.recovery?.canRecheck===true?'recheck':terminal&&mission.recovery?.canResume===true?'resume':null;
  const recoveryAction=recoveryKind?{kind:recoveryKind,label:tr(recoveryKind==='recheck'?'Faire relire les corrections':'Reprendre avec Oscar'),key:JSON.stringify([mission.id,recoveryKind,mission.recovery?.used??0,mission.recovery?.rechecksUsed??0,mission.recovery?.packagePolicyRechecksUsed??0,mission.recovery?.externalCorrectionRechecksUsed??0,mission.recovery?.remainingCorrectionPassesUsed??0,mission.recovery?.reviewFormatRechecksUsed??0])}:null;
  let title,phase,note;
  if(terminal){
    title={completed:'Votre livraison est disponible',needs_review:'Votre livraison demande une reprise',failed:'La mission a rencontré un problème',cancelled:'La mission a été arrêtée'}[mission.status];
    phase=clean(mission.phase,500);
    note=mission.status==='needs_review'?'Les fichiers disponibles sont conservés. Une vérification est encore nécessaire.':mission.status==='cancelled'?'La mission est arrêtée. Les fichiers déjà produits sont conservés.':mission.status==='failed'?'Les fichiers déjà produits sont conservés.':'';
  }else{
    title=stage==='review'?'Oscar vérifie les contributions':stage==='final-review'?'Oscar vérifie votre livraison':'Oscar prépare votre livraison';
    phase=clean(mission.phase,500)||({review:'Relecture des contributions',assembly:'Assemblage de la livraison','final-review':'Contrôle final de la livraison'})[stage]||'Oscar prépare la suite du contrôle.';
    note=demo?'Démonstration : cette étape est simulée, sans appel du moteur.':silent?(stage==='assembly'?'L’assemblage est toujours en cours. Aucun nouveau retour du moteur depuis le dernier signal.':'Le contrôle est toujours en cours. Aucun nouveau retour du moteur depuis le dernier signal.'):current?'Temps mesuré, sans estimation de fin.':'Aucun appel d’Oscar en cours n’est enregistré.';
  }
  return{missionId:mission.id??null,state:active?'active':mission.status,active,terminal,demo,stage,title:tr(title),phase:problem?.message||(phase?translate(phase,locale):''),problem,note:[note?tr(note):'',terminal?tr('Aucun appel du moteur n’est en cours pour cette mission.'):''].filter(Boolean).join(' '),counts,unapproved,finalFeedback,recoveryAction,
    call:current?{stage:current.stage,startedAt:current.startedAt,elapsedMs}:null,elapsedMs,lastActivity,silenceMs,silent,
    action:mission.status==='completed'?'delivery':'progress',actionLabel:tr(mission.status==='completed'?'Voir la livraison':'Ouvrir le suivi'),dismissible:terminal};
}

const text=(node,value)=>{const copy=String(value??'');if(node.textContent!==copy)node.textContent=copy;};
let nextProgressId=0;

/** Stable DOM: details settle into a compact notice with recovery controls kept visible. */
export class DeliveryProgress{
  constructor({container,isVisible,now=()=>Date.now(),intervalMs=500,autoCollapseMs=10000,timers=globalThis,onOpen=()=>{},onResume=null}={}){
    if(!container?.ownerDocument||typeof container.append!=='function')throw new TypeError('Un conteneur est nécessaire pour afficher le suivi de la livraison.');
    Object.assign(this,{container,document:container.ownerDocument,now,timers,onOpen,onResume});this.pendingRecoveries=new Map();this.sentRecoveries=new Set();this.contextEpoch=0;
    this.isVisible=isVisible||(()=>container.isConnected!==false&&!container.closest?.('[hidden],[aria-hidden="true"]')&&(typeof container.getClientRects!=='function'||container.getClientRects().length>0));
    this.intervalMs=Math.max(200,Math.min(1000,finite(intervalMs)?intervalMs:500));
    this.autoCollapseMs=Math.max(1000,Math.min(60000,finite(autoCollapseMs)?autoCollapseMs:10000));
    this.collapseRemainingMs=this.autoCollapseMs;this.collapsed=false;this.collapseChoice=null;this.collapseSince=null;
    const node=(tag,cls='')=>{const element=this.document.createElement(tag);element.className=cls;return element;};
    this.root=node('section','delivery-progress');this.root.dataset.noTranslate='';this.root.hidden=true;
    this.header=node('div','delivery-progress-header');this.copy=node('div','delivery-progress-copy');this.title=node('h3');this.title.id=`delivery-progress-title-${++nextProgressId}`;this.title.setAttribute('aria-live','polite');this.title.setAttribute('aria-atomic','true');this.root.setAttribute('aria-labelledby',this.title.id);this.phase=node('p','delivery-progress-phase');this.phase.setAttribute('role','status');this.copy.append(this.title,this.phase);
    this.toggleButton=node('button','delivery-progress-toggle');this.toggleButton.type='button';this.header.append(this.copy,this.toggleButton);
    this.details=node('div','delivery-progress-details');this.details.id=`delivery-progress-details-${nextProgressId}`;this.toggleButton.setAttribute('aria-controls',this.details.id);
    this.stats=node('div','delivery-progress-stats');this.countNodes={};
    for(const key of ['submitted','approved','total']){const item=node('div'),label=node('span'),value=node('strong');item.append(label,value);this.stats.append(item);this.countNodes[key]={label,value};}
    this.timing=node('div','delivery-progress-timing');this.timingLabel=node('span');this.elapsed=node('output');this.elapsed.setAttribute('aria-live','off');this.timing.append(this.timingLabel,this.elapsed);
    this.activity=node('div','delivery-progress-activity');this.activityLabel=node('span');this.activityText=node('p');this.activityAge=node('output');this.activityAge.setAttribute('aria-live','off');this.activity.append(this.activityLabel,this.activityText,this.activityAge);
    this.issues=node('section','delivery-progress-issues');this.issues.hidden=true;this.issuesTitle=node('h4');this.issuesTitle.textContent=deliveryProgressText('Ce qui reste à corriger');this.issueList=node('div','delivery-progress-issue-list');this.issues.append(this.issuesTitle,this.issueList);this.issueNodes=[];
    this.diagnostic=node('details','delivery-progress-diagnostic');this.diagnostic.hidden=true;this.diagnosticSummary=node('summary');this.diagnosticText=node('p');this.diagnostic.append(this.diagnosticSummary,this.diagnosticText);
    this.note=node('p','delivery-progress-note');this.note.setAttribute('role','status');this.recoveryError=node('p','delivery-progress-error');this.recoveryError.setAttribute('role','alert');this.recoveryError.hidden=true;this.actions=node('div','delivery-progress-actions');
    this.recoveryButton=node('button','delivery-progress-recover');this.recoveryButton.type='button';this.recoveryButton.hidden=true;
    this.openButton=node('button','delivery-progress-open');this.openButton.type='button';this.dismissButton=node('button','delivery-progress-dismiss');this.dismissButton.type='button';this.actions.append(this.recoveryButton,this.openButton,this.dismissButton);
    this.onOpenClick=()=>{if(!this.destroyed&&this.data&&!this.root.hidden)this.onOpen(this.data.action);};
    this.onDismiss=()=>{if(!this.destroyed&&this.data?.dismissible){this.dismissed=true;this.render();this.schedule();}};
    this.onToggle=()=>{if(this.destroyed||!this.data)return;this.collapsed=!this.collapsed;this.collapseChoice=this.collapsed?'collapsed':'expanded';this.render();this.schedule();};
    this.onRecover=()=>this.recover();
    this.openButton.addEventListener('click',this.onOpenClick);this.dismissButton.addEventListener('click',this.onDismiss);this.toggleButton.addEventListener('click',this.onToggle);this.recoveryButton.addEventListener('click',this.onRecover);
    this.details.append(this.stats,this.timing,this.activity,this.issues,this.note,this.diagnostic);this.root.append(this.header,this.details,this.recoveryError,this.actions);container.append(this.root);
    this.onVisibility=()=>this.refresh();this.onLanguage=()=>this.refresh();
    this.document.addEventListener('visibilitychange',this.onVisibility);this.document.addEventListener('oscar:language',this.onLanguage);
  }
  visible(){try{return!this.document.hidden&&this.visibleOverride!==false&&this.isVisible();}catch{return false;}}
  update(mission){
    if(this.destroyed)return;
    const previous=this.data,next=deliveryProgressSnapshot(mission,{now:this.now()});
    const changedMission=(mission?.id??null)!==(this.mission?.id??null);
    if(changedMission){this.contextEpoch++;this.errorMessage='';this.dismissed=false;this.collapsed=false;this.collapseChoice=null;this.collapseSince=null;this.collapseRemainingMs=this.autoCollapseMs;this.importantKey=null;this.diagnostic.open=false;}
    else if(next?.active&&!previous?.active){this.dismissed=false;this.errorMessage='';}
    const importantKey=next&&IMPORTANT.has(next.state)?`${next.missionId}:${next.state}`:null;
    if(importantKey&&importantKey!==this.importantKey){this.dismissed=false;if(this.collapseChoice===null){this.collapsed=false;this.collapseSince=null;this.collapseRemainingMs=this.autoCollapseMs;}}
    this.importantKey=importantKey;
    this.mission=mission||null;this.render(next);this.schedule();
  }
  setVisible(value){if(this.destroyed)return;this.visibleOverride=Boolean(value);this.refresh();}
  refresh(){if(this.destroyed)return;if(this.visible())this.render();this.schedule();}
  render(data=deliveryProgressSnapshot(this.mission,{now:this.now()})){
    this.data=data;this.root.hidden=!data||!!this.dismissed;if(!data||this.dismissed)return;
    const tr=deliveryProgressText;
    this.root.dataset.state=data.state;this.root.dataset.stage=data.stage||'';
    this.root.dataset.collapsed=String(this.collapsed);this.root.dataset.important=String(IMPORTANT.has(data.state));
    text(this.title,data.title);text(this.phase,data.phase);this.phase.hidden=this.collapsed||!data.phase;
    this.details.hidden=this.collapsed;this.toggleButton.setAttribute('aria-expanded',String(!this.collapsed));
    text(this.toggleButton,tr(this.collapsed?'Détails':'Réduire'));this.toggleButton.setAttribute('aria-label',tr(this.collapsed?'Afficher les détails du suivi':'Réduire le panneau de suivi'));
    for(const[key,label]of Object.entries({submitted:'Contributions remises',approved:'Contributions validées',total:'Contributions prévues'})){text(this.countNodes[key].label,tr(label));text(this.countNodes[key].value,data.counts[key]);}
    text(this.timingLabel,tr('Temps de l’appel en cours'));text(this.elapsed,formatTimingDuration(data.elapsedMs));this.timing.hidden=!data.call;
    text(this.activityLabel,tr('Dernière activité d’Oscar'));text(this.activityText,data.lastActivity?.text||tr('Aucune activité détaillée reçue pour cet appel.'));this.activity.hidden=!data.active;
    const age=data.lastActivity?.ageMs;text(this.activityAge,finite(age)?`${tr('Depuis le dernier retour')} : ${formatTimingDuration(age)}`:'');this.activityAge.hidden=!data.active||!finite(age);
    const issueRows=[...data.unapproved,...(data.finalFeedback?[{name:tr('Contrôle final de la livraison'),title:'',feedback:data.finalFeedback}]:[])];
    text(this.issuesTitle,tr('Ce qui reste à corriger'));this.issues.hidden=!issueRows.length;
    while(this.issueNodes.length<issueRows.length){const item=this.document.createElement('article'),name=this.document.createElement('strong'),title=this.document.createElement('span'),feedback=this.document.createElement('p');item.className='delivery-progress-issue';item.append(name,title,feedback);this.issueList.append(item);this.issueNodes.push({item,name,title,feedback});}
    for(let index=0;index<this.issueNodes.length;index++){const row=issueRows[index],nodes=this.issueNodes[index];nodes.item.hidden=!row;if(row){text(nodes.name,row.name);text(nodes.title,row.title);text(nodes.feedback,row.feedback);}}
    text(this.note,data.note);this.note.hidden=!data.note;this.root.dataset.silent=String(data.silent);
    text(this.diagnosticSummary,tr('Détail technique'));text(this.diagnosticText,data.problem?.detail||'');this.diagnostic.hidden=!data.problem?.detail;
    text(this.recoveryError,this.errorMessage||'');this.recoveryError.hidden=!this.errorMessage;
    this.recoveryButton.hidden=!data.recoveryAction||typeof this.onResume!=='function';text(this.recoveryButton,data.recoveryAction?.label||'');this.recoveryButton.disabled=!!data.recoveryAction&&(this.pendingRecoveries.has(data.recoveryAction.key)||this.sentRecoveries.has(data.recoveryAction.key));
    text(this.openButton,this.collapsed&&data.action!=='delivery'?tr('Suivi'):data.actionLabel);this.openButton.setAttribute('aria-label',data.actionLabel);text(this.dismissButton,tr('Masquer'));this.dismissButton.hidden=!data.dismissible;
  }
  async recover(){
    const action=this.data?.recoveryAction,mission=this.mission;
    if(this.destroyed||this.root.hidden||!action||typeof this.onResume!=='function'||this.pendingRecoveries.has(action.key)||this.sentRecoveries.has(action.key))return;
    const epoch=this.contextEpoch,token={},receipts=action.kind==='recheck'?['rechecksUsed','packagePolicyRechecksUsed','externalCorrectionRechecksUsed','remainingCorrectionPassesUsed','reviewFormatRechecksUsed']:['used'];this.pendingRecoveries.set(action.key,token);this.errorMessage='';this.render();this.schedule();
    try{const result=await this.onResume(mission);if(result?.id===mission.id&&(ACTIVE.has(result.status)||receipts.some(counter=>Number(result.recovery?.[counter])>Number(mission.recovery?.[counter]||0))))this.sentRecoveries.add(action.key);}
    catch(cause){if(!this.destroyed&&epoch===this.contextEpoch&&this.mission?.id===mission.id)this.errorMessage=clean(cause?.message,400)||deliveryProgressText('La reprise n’a pas abouti. Les fichiers sont conservés.');}
    finally{if(this.pendingRecoveries.get(action.key)===token)this.pendingRecoveries.delete(action.key);if(!this.destroyed){this.render();this.schedule();}}
  }
  autoCollapseEligible(){return Boolean(this.data&&!this.root.hidden&&!this.collapsed&&this.collapseChoice===null);}
  focusWithin(){for(let element=this.document.activeElement;element;element=element.parentElement)if(element===this.root)return true;return false;}
  schedule(){
    this.stop();
    const now=this.now();
    if(this.collapseSince!==null&&finite(now))this.collapseRemainingMs=Math.max(0,this.collapseRemainingMs-Math.max(0,now-this.collapseSince));
    this.collapseSince=null;
    if(this.destroyed||!this.data||this.root.hidden||!this.visible())return;
    if(this.autoCollapseEligible()&&this.collapseRemainingMs===0&&!this.focusWithin()){this.collapsed=true;this.render(this.data);}
    const auto=this.autoCollapseEligible();
    if(auto&&finite(now))this.collapseSince=now;
    if(!this.collapsed&&this.data.active||auto)this.timer=this.timers.setTimeout(()=>{this.timer=null;if(this.visible())this.render();this.schedule();},this.intervalMs);
  }
  stop(){if(this.timer!=null)this.timers.clearTimeout(this.timer);this.timer=null;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.stop();this.collapseSince=null;this.document.removeEventListener('visibilitychange',this.onVisibility);this.document.removeEventListener('oscar:language',this.onLanguage);this.openButton.removeEventListener('click',this.onOpenClick);this.dismissButton.removeEventListener('click',this.onDismiss);this.toggleButton.removeEventListener('click',this.onToggle);this.recoveryButton.removeEventListener('click',this.onRecover);this.root.remove();this.mission=null;this.data=null;}
}
