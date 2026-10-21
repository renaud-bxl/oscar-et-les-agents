import {getLocale,translate} from './i18n.js';
import messages from './translations-performance.js';

const ACTIVE=new Set(['planning','running','reviewing']),STATUSES=new Set(['running','completed','failed','cancelled']);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export const performanceText=(text,locale=getLocale())=>messages[text]?.[locale]||translate(text,locale);
export function formatTimingDuration(ms){
  if(!number(ms))return'—';const seconds=Math.floor(ms/1000),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
  return hours?`${hours} h ${minutes%60} min ${seconds%60} s`:minutes?`${minutes} min ${seconds%60} s`:`${seconds} s`;
}
function stageText(call,mission){
  if(call.stage==='creation'){
    const role=(mission.tasks||[]).find(task=>task.agentName===call.agent)?.role;
    return mission.executionMode==='single-design'?'crée le visuel':({design:'crée le visuel',code:'développe sa contribution',recherche:'recherche les informations',redaction:'rédige sa contribution',analyse:'analyse les informations'})[role]||'réalise sa contribution';
  }
  return({planning:'prépare la mission',review:'vérifie les fichiers','final-review':'vérifie les fichiers',assembly:'assemble la livraison',answer:'prépare votre réponse'})[call.stage]||'utilise le moteur';
}
/** Facts recorded by the runner only; scene animations and task counts are irrelevant. */
export function missionTimingSnapshot(mission,{now=Date.now(),locale=getLocale()}={}){
  if(!mission)return null;const active=ACTIVE.has(mission.status),demo=mission.provider==='demo',measured=!demo&&Array.isArray(mission.performance?.calls);
  const end=active&&number(now)?now:mission.updatedAt;
  const elapsedMs=!active&&number(mission.performance?.totalDurationMs)?mission.performance.totalDurationMs:number(mission.createdAt)&&number(end)?Math.max(0,end-mission.createdAt):null;
  const calls=measured?mission.performance.calls.filter(call=>call&&typeof call.agent==='string'&&typeof call.stage==='string'&&number(call.startedAt)&&STATUSES.has(call.status)&&(call.durationMs==null||number(call.durationMs))).map(call=>{
    const running=active&&call.status==='running'&&call.durationMs==null,agent=call.agent.trim().slice(0,120);
    return{agent,stage:call.stage,startedAt:call.startedAt,status:call.status,durationMs:call.durationMs??null,running,elapsedMs:running&&number(now)?Math.max(0,now-call.startedAt):call.durationMs??null,label:`${agent} ${performanceText(stageText(call,mission),locale)}`,statusLabel:performanceText(running?'en cours':call.status==='running'?'mesure incomplète':{completed:'terminé',failed:'échoué',cancelled:'arrêté'}[call.status],locale)};
  }):[];
  const running=calls.filter(call=>call.running),callCount=demo?0:measured?calls.length:null;
  return{active,demo,measured,elapsedMs,callCount,calls,phase:running.length?running.map(call=>call.label).join(' · '):mission.phase?performanceText(mission.phase,locale):measured?performanceText('Aucun appel du moteur n’est en cours.',locale):'',note:performanceText(demo?'Démonstration : aucun appel du moteur.':measured?'Temps mesuré, sans estimation de fin.':'Le nombre d’appels n’a pas été enregistré pour cette mission.',locale)};
}
const text=(element,value)=>{if(element.textContent!==String(value))element.textContent=String(value);};

export class MissionTiming{
  constructor({container,isVisible,now=()=>Date.now(),intervalMs=500,timers=globalThis}={}){
    if(!container?.ownerDocument||typeof container.append!=='function')throw new TypeError('Un conteneur est nécessaire pour afficher le suivi du temps.');
    Object.assign(this,{container,document:container.ownerDocument,now,timers});this.isVisible=isVisible||(()=>container.isConnected!==false&&!container.closest?.('[hidden],[aria-hidden="true"]')&&(typeof container.getClientRects!=='function'||container.getClientRects().length>0));this.intervalMs=Math.max(200,Math.min(1000,number(intervalMs)?intervalMs:500));this.rows=[];
    const node=(tag,cls)=>{const el=this.document.createElement(tag);el.className=cls||'';return el;};this.root=node('section','mission-timing');this.root.dataset.noTranslate='';this.root.hidden=true;
    this.title=node('h3');this.stats=node('div','mission-timing-stats');const elapsed=node('div'),count=node('div');this.elapsedLabel=node('span');this.elapsed=node('output');this.countLabel=node('span');this.count=node('strong');elapsed.append(this.elapsedLabel,this.elapsed);count.append(this.countLabel,this.count);this.stats.append(elapsed,count);
    this.phase=node('p','mission-timing-phase');this.phase.setAttribute('role','status');this.note=node('p','mission-timing-note');this.history=node('details','mission-timing-history');this.summary=node('summary');this.list=node('ol');this.history.append(this.summary,this.list);this.root.append(this.title,this.stats,this.phase,this.note,this.history);container.append(this.root);
    this.onVisibility=()=>this.refresh();this.onLanguage=()=>{this.signature='';this.refresh();};this.document.addEventListener('visibilitychange',this.onVisibility);this.document.addEventListener('oscar:language',this.onLanguage);
  }
  visible(){try{return!this.document.hidden&&this.visibleOverride!==false&&this.isVisible();}catch{return false;}}
  update(mission){if(this.destroyed)return;this.mission=mission||null;this.render();this.schedule();}
  setVisible(value){this.visibleOverride=Boolean(value);this.refresh();}
  refresh(){if(this.destroyed)return;if(this.visible())this.render();this.schedule();}
  render(){
    const data=missionTimingSnapshot(this.mission,{now:this.now()});this.root.hidden=!data;if(!data)return;
    const tr=performanceText; text(this.title,tr('Le temps du projet'));text(this.elapsedLabel,tr('Temps écoulé'));text(this.elapsed,formatTimingDuration(data.elapsedMs));text(this.countLabel,tr('Appels du moteur'));text(this.count,data.callCount===null?'—':`${data.callCount} ${tr(data.callCount===1?'appel':'appels')}`);text(this.phase,data.phase);this.phase.hidden=!data.phase;text(this.note,data.note);text(this.summary,tr('Appels mesurés'));this.history.hidden=!data.calls.length;
    const signature=JSON.stringify([getLocale(),data.calls.map(call=>[call.label,call.statusLabel,call.startedAt,call.durationMs])]);
    if(signature!==this.signature){this.signature=signature;this.list.replaceChildren();this.rows=[];for(const call of data.calls){const row=this.document.createElement('li'),copy=this.document.createElement('span'),duration=this.document.createElement('output');copy.textContent=`${call.label} · ${call.statusLabel}`;duration.setAttribute('aria-label',tr('Temps de cet appel'));row.append(copy,duration);this.list.append(row);this.rows.push(duration);}}
    this.rows.forEach((row,i)=>text(row,formatTimingDuration(data.calls[i].elapsedMs)));
  }
  schedule(){this.stop();if(!this.destroyed&&ACTIVE.has(this.mission?.status)&&this.visible())this.timer=this.timers.setTimeout(()=>{this.timer=null;if(this.visible())this.render();this.schedule();},this.intervalMs);}
  stop(){if(this.timer!=null)this.timers.clearTimeout(this.timer);this.timer=null;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.stop();this.document.removeEventListener('visibilitychange',this.onVisibility);this.document.removeEventListener('oscar:language',this.onLanguage);this.root.remove();this.mission=null;this.rows=[];}
}
