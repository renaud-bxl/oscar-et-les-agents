import {getLocale,translate} from './i18n.js';
import {formatTimingDuration} from './mission-timing.js';
import messages from './translations-delivery-progress.js';

const ACTIVE=new Set(['planning','running','reviewing']);
const TERMINAL=new Set(['completed','needs_review','failed','cancelled']);
const STAGES=new Set(['review','assembly','final-review']);
const CALL_STATUSES=new Set(['running','completed','failed','cancelled']);
const SUBMITTED=new Set(['reviewing','approved','needs_review']);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const clean=(value,max=320)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'').replace(/\s+/gu,' ').trim().slice(0,max):'';
export const deliveryProgressText=(source,locale=getLocale())=>messages[source]?.[locale]||translate(source,locale);

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
  const lastActivity=activity?{text:clean(activity.text),at:activity.at,ageMs:effectiveNow===null?null:Math.max(0,effectiveNow-activity.at)}:null;
  const lastSignalAt=current?(lastActivity?.at??current.startedAt):null;
  const silenceMs=lastSignalAt!==null&&clock!==null?Math.max(0,clock-lastSignalAt):null;
  const silent=silenceMs!==null&&silenceMs>=30000;
  const tasks=Array.isArray(mission.tasks)?mission.tasks.filter(task=>task&&typeof task==='object'):[];
  const counts={submitted:tasks.filter(task=>SUBMITTED.has(task.status)).length,approved:tasks.filter(task=>task.status==='approved').length,total:tasks.length};
  const tr=source=>deliveryProgressText(source,locale);
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
  return{missionId:mission.id??null,state:active?'active':mission.status,active,terminal,demo,stage,title:tr(title),phase:phase?translate(phase,locale):'',note:note?tr(note):'',counts,
    call:current?{stage:current.stage,startedAt:current.startedAt,elapsedMs}:null,elapsedMs,lastActivity,silenceMs,silent,
    action:mission.status==='completed'?'delivery':'progress',actionLabel:tr(mission.status==='completed'?'Voir la livraison':'Ouvrir le suivi'),dismissible:terminal};
}

const text=(node,value)=>{const copy=String(value??'');if(node.textContent!==copy)node.textContent=copy;};

/** A stable, non-modal notice; only a visible active review needs a timer. */
export class DeliveryProgress{
  constructor({container,isVisible,now=()=>Date.now(),intervalMs=500,timers=globalThis,onOpen=()=>{}}={}){
    if(!container?.ownerDocument||typeof container.append!=='function')throw new TypeError('Un conteneur est nécessaire pour afficher le suivi de la livraison.');
    Object.assign(this,{container,document:container.ownerDocument,now,timers,onOpen});
    this.isVisible=isVisible||(()=>container.isConnected!==false&&!container.closest?.('[hidden],[aria-hidden="true"]')&&(typeof container.getClientRects!=='function'||container.getClientRects().length>0));
    this.intervalMs=Math.max(200,Math.min(1000,finite(intervalMs)?intervalMs:500));
    const node=(tag,cls='')=>{const element=this.document.createElement(tag);element.className=cls;return element;};
    this.root=node('section','delivery-progress');this.root.dataset.noTranslate='';this.root.hidden=true;
    this.copy=node('div','delivery-progress-copy');this.title=node('h3');this.phase=node('p','delivery-progress-phase');this.phase.setAttribute('role','status');this.copy.append(this.title,this.phase);
    this.stats=node('div','delivery-progress-stats');this.countNodes={};
    for(const key of ['submitted','approved','total']){const item=node('div'),label=node('span'),value=node('strong');item.append(label,value);this.stats.append(item);this.countNodes[key]={label,value};}
    this.timing=node('div','delivery-progress-timing');this.timingLabel=node('span');this.elapsed=node('output');this.elapsed.setAttribute('aria-live','off');this.timing.append(this.timingLabel,this.elapsed);
    this.activity=node('div','delivery-progress-activity');this.activityLabel=node('span');this.activityText=node('p');this.activityAge=node('output');this.activityAge.setAttribute('aria-live','off');this.activity.append(this.activityLabel,this.activityText,this.activityAge);
    this.note=node('p','delivery-progress-note');this.note.setAttribute('role','status');this.actions=node('div','delivery-progress-actions');
    this.openButton=node('button','delivery-progress-open');this.openButton.type='button';this.dismissButton=node('button','delivery-progress-dismiss');this.dismissButton.type='button';this.actions.append(this.openButton,this.dismissButton);
    this.onOpenClick=()=>{if(!this.destroyed&&this.data&&!this.root.hidden)this.onOpen(this.data.action);};
    this.onDismiss=()=>{if(!this.destroyed&&this.data?.dismissible){this.dismissed=true;this.render();this.schedule();}};
    this.openButton.addEventListener('click',this.onOpenClick);this.dismissButton.addEventListener('click',this.onDismiss);
    this.root.append(this.copy,this.stats,this.timing,this.activity,this.note,this.actions);container.append(this.root);
    this.onVisibility=()=>this.refresh();this.onLanguage=()=>this.refresh();
    this.document.addEventListener('visibilitychange',this.onVisibility);this.document.addEventListener('oscar:language',this.onLanguage);
  }
  visible(){try{return!this.document.hidden&&this.visibleOverride!==false&&this.isVisible();}catch{return false;}}
  update(mission){
    if(this.destroyed)return;
    const previous=this.data,next=deliveryProgressSnapshot(mission,{now:this.now()});
    if((mission?.id??null)!==(this.mission?.id??null)||next?.active&&!previous?.active)this.dismissed=false;
    this.mission=mission||null;this.render(next);this.schedule();
  }
  setVisible(value){if(this.destroyed)return;this.visibleOverride=Boolean(value);this.refresh();}
  refresh(){if(this.destroyed)return;if(this.visible())this.render();this.schedule();}
  render(data=deliveryProgressSnapshot(this.mission,{now:this.now()})){
    this.data=data;this.root.hidden=!data||!!this.dismissed;if(!data||this.dismissed)return;
    const tr=deliveryProgressText;
    this.root.dataset.state=data.state;this.root.dataset.stage=data.stage||'';
    text(this.title,data.title);text(this.phase,data.phase);this.phase.hidden=!data.phase;
    for(const[key,label]of Object.entries({submitted:'Contributions remises',approved:'Contributions validées',total:'Contributions prévues'})){text(this.countNodes[key].label,tr(label));text(this.countNodes[key].value,data.counts[key]);}
    text(this.timingLabel,tr('Temps de l’appel en cours'));text(this.elapsed,formatTimingDuration(data.elapsedMs));this.timing.hidden=!data.call;
    text(this.activityLabel,tr('Dernière activité d’Oscar'));text(this.activityText,data.lastActivity?.text||tr('Aucune activité détaillée reçue pour cet appel.'));this.activity.hidden=!data.active&&!data.lastActivity;
    const age=data.lastActivity?.ageMs;text(this.activityAge,finite(age)?`${tr('Depuis le dernier retour')} : ${formatTimingDuration(age)}`:'');this.activityAge.hidden=!finite(age);
    text(this.note,data.note);this.note.hidden=!data.note;this.root.dataset.silent=String(data.silent);
    text(this.openButton,data.actionLabel);text(this.dismissButton,tr('Masquer'));this.dismissButton.hidden=!data.dismissible;
  }
  schedule(){this.stop();if(!this.destroyed&&this.data?.active&&!this.root.hidden&&this.visible())this.timer=this.timers.setTimeout(()=>{this.timer=null;if(this.visible())this.render();this.schedule();},this.intervalMs);}
  stop(){if(this.timer!=null)this.timers.clearTimeout(this.timer);this.timer=null;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.stop();this.document.removeEventListener('visibilitychange',this.onVisibility);this.document.removeEventListener('oscar:language',this.onLanguage);this.openButton.removeEventListener('click',this.onOpenClick);this.dismissButton.removeEventListener('click',this.onDismiss);this.root.remove();this.mission=null;this.data=null;}
}
