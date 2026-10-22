import {getLocale,translate} from './i18n.js';
import messages from './translations-oscar-assistant.js';

const ACTIVE=new Set(['planning','running','reviewing']);
const TASK_STATES={queued:'en attente',working:'en réalisation',revising:'en correction',reviewing:'en relecture',approved:'validée',needs_review:'à reprendre',blocked:'bloquée',failed:'interrompue',cancelled:'arrêtée'};
const STATES={planning:'Préparation du plan',running:'Mission en cours',reviewing:'Vérification des résultats',completed:'Livraison validée',needs_review:'Une reprise est nécessaire',failed:'Mission interrompue',cancelled:'Mission arrêtée'};
const STAGES={planning:'prépare le plan',creation:'réalise une contribution',review:'contrôle une contribution',assembly:'assemble la livraison','final-review':'vérifie la livraison finale',answer:'prépare une réponse'};
const clean=(value,max=320)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'').trim().slice(0,max):'';
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export const oscarAssistantText=(source,locale=getLocale(),values={})=>(messages[source]?.[locale]||translate(source,locale)).replace(/\{([a-z]+)\}/gu,(_all,key)=>String(values[key]??''));
const tr=(source,values,locale)=>oscarAssistantText(source,locale,values);
const text=(element,value)=>{if(element.textContent!==String(value??''))element.textContent=String(value??'');};
let nextId=0;

/** A bounded copy of recorded facts. Task animation and queued work are not activity proof. */
export function oscarMissionSnapshot(mission,{now=Date.now()}={}){
  if(!mission||typeof mission!=='object'||typeof mission.id!=='string'||!mission.id)return null;
  const tasks=(Array.isArray(mission.tasks)?mission.tasks:[]).filter(task=>task&&typeof task==='object').slice(0,20).map(task=>({id:clean(task.id,120),title:clean(task.title,200),agent:clean(task.agentName||task.name||task.role,100),status:clean(task.status,40),dependsOn:(Array.isArray(task.dependsOn)?task.dependsOn:[]).filter(value=>typeof value==='string').slice(0,20),feedback:task.review?.approved===false?clean(task.review.feedback,500):''}));
  const taskMap=new Map(tasks.map(task=>[task.id,task]));
  const active=ACTIVE.has(mission.status),demo=mission.provider==='demo',measured=Array.isArray(mission.performance?.calls);
  const calls=!demo&&active&&measured?mission.performance.calls.filter(call=>call&&call.status==='running'&&call.durationMs==null&&finite(call.startedAt)&&call.startedAt<=now&&clean(call.agent)).slice(-24).map(call=>({agent:clean(call.agent,100),stage:clean(call.stage,60)})):[];
  const remaining=tasks.filter(task=>task.status!=='approved').map(task=>({...task,waitingFor:task.dependsOn.filter(id=>taskMap.get(id)?.status!=='approved').map(id=>taskMap.get(id)?.title||taskMap.get(id)?.agent||'dépendance inconnue')}));
  const issues=[...(clean(mission.error,1000)?[{message:clean(mission.error,1000)}]:[]),...remaining.filter(task=>['blocked','needs_review','failed'].includes(task.status)).map(task=>({agent:task.agent||task.title,message:task.feedback,status:task.status}))].slice(0,6);
  const files=(Array.isArray(mission.files)?mission.files:[]).filter(file=>file&&typeof file.path==='string'&&file.path.trim()).slice(0,500).map(file=>clean(file.path,500));
  return{missionId:mission.id,title:clean(mission.title,200),status:clean(mission.status,40),phase:clean(mission.phase,500),active,demo,measured,tasks,remaining,calls,issues,files,workDirectory:clean(mission.workDirectory,2000),approved:tasks.filter(task=>task.status==='approved').length,total:tasks.length,asOf:finite(mission.updatedAt)?mission.updatedAt:now};
}

export function oscarQuestionIntent(question){
  const value=String(question||'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
  if(/^(?:(?:s'il te plait|peux[- ]tu|please|kun je)\s*[,?:]?\s*)?(?:ajoute|ajouter|modifie|modifier|supprime|supprimer|publie|publier|envoie|envoyer|relance|relancer|arrete|arreter|delete|publish|send|restart|stop|change|verwijder|publiceer|verstuur|herstart)\b/u.test(value))return'change';
  if(/combien.*temps|\bquand\b|how long|when.*ready|hoelang|wanneer/u.test(value))return'status';
  if(/erreur|probleme|bloqu|pourquoi|attend|error|problem|block|why|wait|waarom|wacht|fout/u.test(value))return'blockers';
  if(/reste|a faire|prochain|terminer|remaining|left to do|next|nog.*(?:doen|gebeuren)|volgende/u.test(value))return'remaining';
  if(/fichier|dossier|livraison|resultat|\bfiles?\b|folder|delivery|bestanden|werkmap|resultaat/u.test(value))return'files';
  if(/\bqui\b|travaille|agents?|equipe|\bwho\b|working|team|\bwie\b|werkt/u.test(value))return'working';
  if(/en est|en sommes|avancement|etat|progress|status|where.*(?:we|now)|stand van|hoe.*(?:gaat|ver)|combien.*temps|\bquand\b|how long|when.*ready|hoelang|wanneer/u.test(value))return'status';
  return'free';
}

/** Local answers never start, stop, approve or alter a mission. */
export function answerOscarQuestion(snapshot,question,{locale=getLocale()}={}){
  const intent=oscarQuestionIntent(question),t=(source,values)=>tr(source,values,locale);
  if(!snapshot)return{intent,source:'state',answer:t('Choisissez une mission pour interroger Oscar sur son travail.')};
  if(intent==='change')return{intent,source:'state',answer:t('Cette conversation ne modifie pas la mission. Utilisez les commandes du bureau pour demander une nouvelle tâche ou une correction.')};
  const summary=[t(STATES[snapshot.status]||'État non disponible'),t('Contributions validées : {approved}/{total}.',{approved:snapshot.approved,total:snapshot.total})];
  const issueLine=issue=>'• '+(issue.agent?issue.agent+' — ':'')+(issue.message||t(TASK_STATES[issue.status]||'État non disponible'));
  const taskLine=task=>`• ${task.agent||task.title}${task.agent&&task.title?' — '+task.title:''} : ${t(TASK_STATES[task.status]||'État non disponible')}${task.waitingFor?.length?' ; '+t('attend : {tasks}',{tasks:task.waitingFor.map(value=>value==='dépendance inconnue'?t(value):value).join(', ')}):''}`;
  const work=()=>snapshot.demo?[t('Démonstration : les activités sont simulées.')]:snapshot.calls.length?[t('Appels du moteur enregistrés comme en cours :'),...snapshot.calls.map(call=>`• ${call.agent} — ${t(STAGES[call.stage]||'utilise le moteur')}`)]:[t('Aucun appel du moteur n’est enregistré comme en cours.'),...(!snapshot.measured?[t('Cette ancienne mission ne contient pas de mesures d’appels.')]:[])];
  let lines;
  if(intent==='free')return{intent,source:'state',answer:t('Je peux expliquer l’avancement, les collègues, les tâches restantes, les blocages et les fichiers enregistrés. Reformulez votre question ou utilisez une proposition ci-dessus.')};
  if(intent==='remaining')lines=snapshot.total?(snapshot.remaining.length?[t('Contributions restant à vérifier ou à réaliser :'),...snapshot.remaining.map(taskLine)]:[t('Toutes les contributions enregistrées sont validées.'),...(snapshot.status!=='completed'?[t('La validation finale d’Oscar reste distincte de celle des contributions.')]:[])]):[t('La répartition des tâches n’est pas encore enregistrée.')];
  else if(intent==='blockers'){
    const waiting=snapshot.remaining.filter(task=>task.waitingFor.length||task.status==='queued');
    lines=[...(snapshot.issues.length?[t('Points signalés :'),...snapshot.issues.map(issueLine)]:[t('Aucun blocage n’est signalé dans l’état enregistré.')]),...waiting.map(task=>taskLine(task)+(task.status==='queued'&&!task.waitingFor.length?' ; '+t('Prête selon ses dépendances ; aucun démarrage n’est promis.') :''))];
  }else if(intent==='files')lines=[t('Fichiers enregistrés : {count}.',{count:snapshot.files.length}),...(snapshot.workDirectory?[t('Dossier de travail : {path}',{path:snapshot.workDirectory})]:[]),...(snapshot.files.length?snapshot.files.slice(0,12).map(file=>'• '+file):[t('Aucun fichier n’est encore enregistré pour cette mission.')]),...(snapshot.status!=='completed'?[t('Les fichiers d’une mission non validée peuvent être partiels.')]:[])];
  else if(intent==='working')lines=work();
  else lines=[...work(),...(snapshot.issues.length?[t('Points signalés :'),...snapshot.issues.map(issueLine)]:[]),t('Je ne peux pas déduire une heure de fin de ces données.')];
  return{intent,source:'state',answer:[...summary,...lines].join('\n\n')};
}

export class OscarAssistant{
  constructor({container,onAsk=null,onRecover=null,onOpen=()=>{},onDictate=null,now=Date.now}={}){
    if(!container?.ownerDocument)throw new TypeError('Un conteneur est nécessaire pour parler à Oscar.');
    Object.assign(this,{container,document:container.ownerDocument,onAsk,onRecover,onOpen,onDictate,now});this.epoch=0;this.visible=true;
    const node=(tag,cls='')=>{const element=this.document.createElement(tag);element.className=cls;return element;},id=`oscar-assistant-${++nextId}`;
    this.root=node('section','oscar-assistant');this.root.dataset.noTranslate='';this.heading=node('h3');this.heading.id=id+'-title';this.root.setAttribute('aria-labelledby',this.heading.id);
    this.state=node('p','oscar-assistant-state');this.state.setAttribute('role','status');this.intro=node('p','oscar-assistant-intro');this.quick=node('div','oscar-assistant-quick');this.quickButtons=[];
    for(const label of['Où en est-on ?','Que reste-t-il à faire ?','Qui travaille maintenant ?','Pourquoi ça attend ?','Où sont mes fichiers ?']){const button=node('button');button.type='button';button.addEventListener('click',()=>{if(this.destroyed||!this.visible||this.pending)return;this.question.value=oscarAssistantText(label);this.ask();});this.quick.append(button);this.quickButtons.push({button,label});}
    this.form=node('form','oscar-assistant-form');this.label=node('label');this.question=node('textarea');this.question.id=id+'-question';this.question.maxLength=1000;this.question.rows=2;this.label.htmlFor=this.question.id;
    this.actions=node('div','oscar-assistant-actions');this.askButton=node('button');this.askButton.type='submit';this.dictateButton=node('button');this.dictateButton.type='button';this.dictateButton.hidden=typeof onDictate!=='function';this.dictateButton.addEventListener('click',async()=>{if(this.destroyed||!this.visible||this.pending)return;try{await this.onDictate?.(this.question);}catch{if(!this.destroyed&&this.visible)this.showError(oscarAssistantText('La dictée n’a pas pu s’ouvrir. Votre question est conservée.'));}});
    this.actions.append(this.askButton,this.dictateButton);this.form.append(this.label,this.question,this.actions);this.form.addEventListener('submit',event=>{event.preventDefault();this.ask();});
    this.error=node('p','oscar-assistant-error');this.error.setAttribute('role','alert');this.error.hidden=true;
    this.reply=node('section','oscar-assistant-reply');this.reply.hidden=true;this.replyTitle=node('h4');this.replyQuestion=node('p','oscar-assistant-reply-question');this.replyText=node('p','oscar-assistant-answer');this.replyTime=node('p','oscar-assistant-time');this.replySource=node('p','oscar-assistant-source');this.reply.append(this.replyTitle,this.replyQuestion,this.replyText,this.replyTime,this.replySource);this.reply.setAttribute('aria-live','polite');
    this.recoverButton=node('button','oscar-assistant-recover');this.recoverButton.type='button';this.recoverButton.hidden=true;this.recoverButton.addEventListener('click',()=>this.recover());
    this.navigation=node('div','oscar-assistant-navigation');this.progressButton=node('button');this.progressButton.type='button';this.progressButton.addEventListener('click',()=>{if(!this.destroyed&&this.visible&&this.snapshot)this.onOpen('progress');});this.filesButton=node('button');this.filesButton.type='button';this.filesButton.addEventListener('click',()=>{if(!this.destroyed&&this.visible&&this.snapshot?.files.length)this.onOpen('delivery');});this.navigation.append(this.progressButton,this.filesButton);
    this.root.append(this.heading,this.state,this.intro,this.quick,this.form,this.error,this.reply,this.recoverButton,this.navigation);container.append(this.root);
    this.onLanguage=()=>this.render();this.document.addEventListener('oscar:language',this.onLanguage);this.render();
  }
  update(mission){
    if(this.destroyed)return;const snapshot=oscarMissionSnapshot(mission,{now:this.now()});
    if(this.snapshot?.missionId!==snapshot?.missionId){this.cancel();this.answer=null;this.receipt=null;this.question.value='';this.error.hidden=true;}
    this.snapshot=snapshot;this.render();
  }
  setVisible(value){if(this.destroyed)return;this.visible=Boolean(value);this.root.hidden=!this.visible;if(!this.visible)this.cancel();this.render();}
  render(){
    if(this.destroyed)return;const t=oscarAssistantText,s=this.snapshot;this.root.hidden=!this.visible;
    text(this.heading,t('Demandez à Oscar'));text(this.state,s?`${s.title} · ${t(STATES[s.status]||'État non disponible')} · ${s.approved}/${s.total}`:t('Choisissez une mission pour interroger Oscar sur son travail.'));
    text(this.intro,t('Ce point reste consultable pendant que l’équipe travaille.')+(typeof this.onAsk==='function'?' '+t('Une question libre utilise le moteur de cette mission, sans modifier son travail.'):''));text(this.label,t('Votre question sur cette mission'));this.question.setAttribute('placeholder',t('Par exemple : pourquoi une tâche attend-elle ?'));
    for(const{button,label}of this.quickButtons){text(button,t(label));button.disabled=!!this.pending;}
    this.askButton.disabled=!!this.pending;text(this.askButton,t(this.pending?'Oscar prépare sa réponse…':'Demander à Oscar'));text(this.dictateButton,t('Dicter ma question'));this.dictateButton.disabled=!!this.pending;
    this.navigation.hidden=!s;text(this.progressButton,t('Ouvrir le suivi'));text(this.filesButton,t('Voir les fichiers'));this.filesButton.disabled=!s?.files.length;
    this.recoverButton.hidden=!this.receipt;text(this.recoverButton,t('Retrouver ma réponse'));this.recoverButton.disabled=!!this.pending;
    this.reply.hidden=!this.answer;
    if(this.answer){const answer=this.answer,local=answer.snapshot?answerOscarQuestion(answer.snapshot,answer.question):null;this.reply.dataset.source=answer.source;text(this.replyTitle,t('Réponse d’Oscar'));text(this.replyQuestion,answer.question);text(this.replyText,local?.answer??answer.answer);
      const at=new Date(answer.asOf).toLocaleString({fr:'fr-FR',en:'en-GB',nl:'nl-NL'}[getLocale()]||'fr-FR',{dateStyle:'short',timeStyle:'medium'});text(this.replyTime,tr('Point enregistré à {time}',{time:at}));text(this.replySource,t(answer.source==='model'?'Réponse du moteur, fondée sur un instantané de la mission.':'Réponse depuis les données de la mission, sans appel au moteur.'));}
    this.root.setAttribute('aria-busy',String(!!this.pending));
  }
  showError(message){text(this.error,message);this.error.hidden=!message;}
  async ask(){
    if(this.destroyed||!this.visible||this.pending)return;const question=this.question.value.trim();if(!question||question.length>1000){this.showError(oscarAssistantText('Écrivez une question de 1 à 1 000 caractères.'));return;}
    this.showError('');const snapshot=this.snapshot,local=answerOscarQuestion(snapshot,question);
    if(local.intent!=='free'||!snapshot||typeof this.onAsk!=='function'){this.answer={...local,question,snapshot,asOf:snapshot?.asOf??this.now()};this.render();return;}
    if(this.receipt?.missionId===snapshot.missionId&&this.receipt.question===question){await this.recover();return;}
    const requestId=globalThis.crypto?.randomUUID?.()||`oscar-question-${this.now()}-${Math.random().toString(36).slice(2)}`;
    await this.send({missionId:snapshot.missionId,question,requestId,locale:getLocale()},false);
  }
  async recover(){if(this.destroyed||this.pending||!this.visible||!this.receipt)return;await this.send(this.receipt,true);}
  async send(record,recovering){
    const callback=recovering?this.onRecover:this.onAsk;
    if(typeof callback!=='function'){this.showError(oscarAssistantText('La réponse n’a pas été confirmée. Retrouvez-la depuis le suivi avant de recommencer.'));return;}
    const epoch=++this.epoch,controller=new AbortController();this.controller=controller;this.inflight=record;this.pending=true;this.render();
    try{
      const result=await callback({...record,signal:controller.signal});if(this.destroyed||epoch!==this.epoch||record.missionId!==this.snapshot?.missionId)return;
      if(result?.missionId===record.missionId&&['pending','running','processing'].includes(result.status)){this.receipt=record;this.showError(oscarAssistantText('La question est enregistrée ; sa réponse n’est pas encore disponible.'));return;}
      if(result?.missionId!==record.missionId||typeof result.answer!=='string'||!result.answer.trim()||!['state','model'].includes(result.source)||!finite(result.asOf))throw new Error('Incomplete answer');
      this.answer={question:record.question,answer:result.answer.slice(0,16000),source:result.source,asOf:result.asOf};this.receipt=null;this.showError('');
    }catch(error){
      if(this.destroyed||epoch!==this.epoch||controller.signal.aborted)return;
      if(recovering&&error.status===404){this.receipt=null;this.showError(oscarAssistantText('Aucune réponse n’est enregistrée. Vous pouvez envoyer de nouveau votre question.'));}
      else{this.receipt=Number.isInteger(error.status)&&error.status>=400&&error.status<500?null:record;this.showError(oscarAssistantText(this.receipt?'La réponse n’a pas été confirmée. Retrouvez-la depuis le suivi avant de recommencer.':'Oscar n’a pas pu répondre. Votre question est conservée ; vous pouvez réessayer.'));}
    }finally{if(epoch===this.epoch&&!this.destroyed){this.pending=false;this.controller=null;this.inflight=null;this.render();}}
  }
  cancel(){this.epoch++;if(this.inflight)this.receipt=this.inflight;this.inflight=null;this.controller?.abort();this.controller=null;this.pending=false;}
  destroy(){if(this.destroyed)return;this.cancel();this.destroyed=true;this.document.removeEventListener('oscar:language',this.onLanguage);this.root.remove();this.snapshot=null;this.answer=null;this.receipt=null;}
}
