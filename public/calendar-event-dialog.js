import {getLocale,translate as t} from './i18n.js';

const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const POST=body=>({method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body)});
const plain=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
const action='(?:ajout\\w*|cre(?:e|er|ez|ons)?|planifi\\w*|inscri\\w*|add|create|schedule|plan|voeg\\w*|toevoeg\\w*)';
const personalCalendar=/(?:\b(?:mon|notre)\s+(?:agenda|calendrier)|\b(?:mes|nos)\s+(?:rendez[- ]vous|reunions)|\b(?:my|our)\s+(?:calendar|appointments?)|\b(?:mijn|onze)\s+(?:agenda|kalender|afspraken))\b/u;
const productIntent=/^(?:(?:s.il te plait|please|alsjeblieft)[, ]*)?(?:(?:je (?:veux|voudrais|souhaite|aimerais)|(?:peux|pourrais)-tu|(?:can|could) you|(?:kun|wil) je)\s+)?(?:me\s+)?(?:cre(?:e|er|ez)|developp\w*|concoi\w*|construi\w*|build|create|develop|make|maak|bouw|ontwerp)\s+(?:(?:moi|nous|me|us|un|une|des|le|la|a|an|een|my|our|new|nouveau|nouvelle)\s+){0,5}(?:logiciel|site|application|app|software|website|jeu|game|outil|tool|spel)\b/u;
export const calendarCommand=text=>{
  const value=plain(text);
  if(productIntent.test(value))return false;
  if(new RegExp(`(?:\\bne\\s+(?:(?:me|nous)\\s+)?${action}\\b|\\bn['’]${action}\\b|\\b(?:do\\s+not|don['’]t|never|sans|without|zonder)\\s+${action}\\b|\\b${action}\\s+(?:geen|niet)\\b)`,'u').test(value))return false;
  return new RegExp(`\\b${action}\\b`,'u').test(value)&&(/(?:\b(?:dans|a|sur)\s+(?:mon|notre)\s+(?:agenda|calendrier)|\b(?:to|into|in|on)\s+(?:my|our)\s+calendar|\b(?:in|aan)\s+(?:mijn|onze)\s+(?:agenda|kalender))\b/u.test(value)||new RegExp(`\\b${action}\\s+(?:(?:moi|nous|me|us|un|une|des|le|la|a|an|my|our|new|nouveau|nouvelle|nouvel|een|mijn|nieuwe)\\s+){0,5}(?:rendez[- ]vous|reunion|evenement|meeting|appointment|event|afspraak)\\b`,'u').test(value));
};
export const calendarQuestion=text=>{
  const value=plain(text),reading=/\b(?:lis|lire|consulte\w*|montre\w*|regarde\w*|resume\w*|voir|dis|dire|savoir|quels?|quelles?|show|read|check|what|see|view|toon|bekijk|lees|wat)\b/u;
  if(productIntent.test(value))return false;
  return personalCalendar.test(value)&&(reading.test(value)||/^(?:mon|mes|notre|nos|my|our|mijn|onze)\b/u.test(value))||/^(?:agenda|calendrier|calendar|kalender)\s+(?:(?:pour|for|voor)\s+)?(?:demain|aujourd.hui|tomorrow|today|morgen|vandaag)\b/u.test(value);
};
const STORAGE_KEY='oscar-calendar-request-v1',REQUEST_ID=/^[a-z\d_-]{8,100}$/iu;
export const calendarCreateChoices=(connections,{client='auto'}={})=>connections.filter(row=>['codex','claude'].includes(row.client)&&(client==='auto'||row.client===client)&&(row.type==='calendar'||row.readOnlyAutomation?.service==='calendar')&&['authorized','connected'].includes(row.status)&&row.stale!==true).sort((a,b)=>Number(b.calendarCreate?.available===true)-Number(a.calendarCreate?.available===true)||String(a.displayName||a.name).localeCompare(String(b.displayName||b.name),getLocale())||a.client.localeCompare(b.client));

export class CalendarEventDialog {
  constructor({request,onDictate=()=>{},onClose=()=>{},storage}={}){
    Object.assign(this,{request,onDictate,onClose});this.epoch=0;this.interpretToken=0;this.receipt=null;
    try{this.storage=storage??globalThis.sessionStorage;const id=this.storage?.getItem(STORAGE_KEY);if(REQUEST_ID.test(id||''))this.pending={requestId:id};}catch{}
    this.dialog=node('dialog','calendar-event-dialog');this.dialog.setAttribute('aria-labelledby','calendar-event-title');
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});this.dialog.addEventListener('close',()=>this.closed());document.body.append(this.dialog);this.build();
  }
  button(text,cls,fn){const el=node('button',cls,text);el.type='button';el.addEventListener('click',fn);return el;}
  field(label,el){const row=node('label','calendar-event-field');row.append(node('span','',label),el);return row;}
  build(){
    const header=node('header','calendar-event-header'),copy=node('div');copy.append(node('small','','ZOÉ S’OCCUPE DE VOTRE AGENDA'));const title=node('h2','','Un rendez-vous, simplement.');title.id='calendar-event-title';copy.append(title,node('p','','Dictez votre idée, vérifiez les détails, puis confirmez l’ajout.'));const close=this.button('×','calendar-event-close',()=>this.close());close.setAttribute('aria-label','Fermer le rendez-vous');header.append(copy,close);
    this.form=node('form','calendar-event-body');this.form.addEventListener('submit',event=>{event.preventDefault();this.preview();});
    this.prompt=node('textarea');this.prompt.rows=3;this.prompt.maxLength=12000;this.prompt.placeholder='Ex. : Ajoute dans mon agenda une réunion projet mercredi à 16 h pendant 45 minutes.';
    const command=this.field('Votre demande, à voix haute ou au clavier',this.prompt),controls=node('div','calendar-event-actions');controls.append(this.button('🎙 Dicter ma demande','secretary-link',()=>this.onDictate(this.prompt)),this.button('Comprendre ma demande','secretary-link',()=>this.interpret()));command.append(controls);
    this.connection=node('select');this.connection.required=true;this.connection.addEventListener('change',()=>{this.choiceLost=false;this.invalidate();});this.connectionNote=node('p','calendar-event-note');this.refreshButton=this.button('Retrouver mes agendas','secretary-link',()=>this.refreshConnections(true));
    this.fields={};const grid=node('div','calendar-event-grid');for(const[name,label,type]of [['title','Titre du rendez-vous','text'],['startLocal','Début du rendez-vous','datetime-local'],['endLocal','Fin du rendez-vous','datetime-local'],['timeZone','Fuseau horaire','text'],['location','Lieu (facultatif)','text']]){const el=node('input');el.type=type;el.required=!['location'].includes(name);if(type==='text')el.maxLength=name==='title'?200:name==='location'?500:100;el.addEventListener('input',()=>this.invalidate());this.fields[name]=el;grid.append(this.field(label,el));}
    this.fields.description=node('textarea');this.fields.description.rows=3;this.fields.description.maxLength=4000;this.fields.description.addEventListener('input',()=>this.invalidate());grid.append(this.field('Informations à ajouter (facultatif)',this.fields.description));
    this.prompt.addEventListener('input',()=>{this.interpretToken=(this.interpretToken||0)+1;this.invalidate();});
    this.message=node('p','calendar-event-note');this.message.setAttribute('role','status');this.error=node('p','secretary-error');this.error.setAttribute('role','alert');this.error.hidden=true;
    this.previewButton=node('button','secretary-run','Vérifier avant d’ajouter');this.previewButton.type='submit';
    this.review=node('section','calendar-event-review');this.review.hidden=true;this.summary=node('dl');this.summary.dataset.noTranslate='';this.confirmButton=this.button('Confirmer l’ajout à mon agenda','secretary-run',()=>this.confirm());this.editButton=this.button('Modifier les détails','secretary-link',()=>{this.invalidate();this.fields.title.focus();});this.review.append(node('h3','','Tout est correct ?'),this.summary,node('p','','Un seul rendez-vous sera ajouté. Aucun invité, aucune invitation et aucune répétition automatique.'),this.confirmButton,this.editButton);
    this.result=node('section','calendar-event-result');this.result.hidden=true;this.result.setAttribute('role','status');
    this.recoverButton=this.button('Retrouver cet ajout','secretary-link',()=>this.recover());this.retryButton=this.button('Reprendre le même ajout','secretary-link',()=>this.confirm());this.newButton=this.button('Préparer un autre rendez-vous','secretary-link',()=>this.startNew());this.abandonButton=this.button('J’ai vérifié mon agenda, recommencer','secretary-link',()=>this.startNew());
    this.form.append(command,this.field('Agenda à utiliser',this.connection),this.connectionNote,this.refreshButton,grid,this.message,this.previewButton,this.review,this.error,this.result);this.dialog.append(header,this.form);
  }
  async open({prompt='',connections=[],connection,client='auto',timeZone}={}){
    if(this.dialog.open)return;this.returnFocus=document.activeElement;this.epoch++;this.notified=false;this.busy=false;this.lastOptions={connections,connection,client,timeZone};
    if(!this.pending&&!this.receipt)this.resetForm({prompt,...this.lastOptions});
    this.update();this.dialog.showModal();
    if(this.receipt){this.showReceipt(this.receipt);return;}
    if(this.pending){await this.recover();return;}
    void this.refreshConnections();this.prompt.focus();if(prompt.trim())await this.interpret();
  }
  resetForm({prompt='',connections=[],connection,client='auto',timeZone}={}){
    this.form.reset();this.prompt.value=prompt;for(const input of Object.values(this.fields))input.value='';this.fields.timeZone.value=timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;this.previewData=null;this.receiptStatus=null;this.recoveryMissing=false;this.durationSource='default';
    this.choiceLost=false;this.connection.value='';this.renderConnections(connections);
    this.review.hidden=true;this.result.hidden=true;this.error.hidden=true;this.message.textContent=t('Les dates relatives seront remplacées par des dates complètes. La durée proposée reste modifiable.');this.update();
  }
  renderConnections(connections){
    const selected=this.connection.value,{client='auto',connection}=this.lastOptions||{};this.connection.replaceChildren();const empty=node('option','',t('Choisissez votre agenda'));empty.value='';this.connection.append(empty);const rows=calendarCreateChoices(connections,{client});
    for(const row of rows){const usable=row.calendarCreate?.available===true;const option=node('option','',`${row.displayName||'Google Agenda'} · ${row.client==='codex'?'ChatGPT':'Claude'}${usable?'':` · ${t('Ajout non disponible')}`}`);option.value=`${row.client}:${row.name}`;option.disabled=!usable;this.connection.append(option);}
    const choices=rows.filter(row=>row.calendarCreate?.available===true),preferred=choices.find(row=>connection?.client===row.client&&connection?.name===row.name);if(choices.some(row=>`${row.client}:${row.name}`===selected))this.connection.value=selected;else{if(selected)this.choiceLost=true;this.connection.value=this.choiceLost?'':preferred?`${preferred.client}:${preferred.name}`:!connection&&choices.length===1?`${choices[0].client}:${choices[0].name}`:'';}
    this.connectionNote.textContent=t(choices.length?'Agenda principal du compte connecté. L’accès d’ajout sera vérifié par le service au moment de votre confirmation.':'Aucun outil d’ajout confirmé dans ce client. Retrouvez vos connexions dans Zoé. La lecture de votre agenda reste disponible.');
    if(this.choiceLost)this.connectionNote.textContent=t('L’agenda choisi n’est plus disponible. Choisissez explicitement le compte à utiliser.');if(selected&&selected!==this.connection.value)this.invalidate();this.update();
  }
  async refreshConnections(force=false){
    if(this.connectionsLoading||!this.dialog.open||this.pending||this.receipt)return;clearTimeout(this.connectionTimer);const controller=new AbortController(),epoch=this.epoch;this.connectionsController=controller;this.connectionsLoading=true;this.refreshButton.disabled=true;
    const stale=()=>epoch!==this.epoch||!this.dialog.open||controller.signal.aborted;
    try{const data=await this.request(force?'/api/connectors/refresh':'/api/connectors',{...(force?POST({}):{}),signal:controller.signal});if(stale())return;if(!Array.isArray(data?.connections))throw new Error('Les connexions n’ont pas pu être vérifiées.');this.lastOptions.connections=data.connections;if(!this.pending&&!this.receipt){this.renderConnections(data.connections);if(Object.values(data.clients||{}).some(row=>row?.status==='checking'))this.connectionTimer=setTimeout(()=>this.refreshConnections(),1500);}}
    catch(error){if(!stale())this.showError(error);}
    finally{if(this.connectionsController===controller){this.connectionsController=null;this.connectionsLoading=false;if(!stale())this.update();}}
  }
  remember(){try{this.storage?.setItem(STORAGE_KEY,this.pending.requestId);}catch{this.message.textContent=t('La reprise après rechargement n’est pas disponible. Gardez cette fenêtre ouverte jusqu’au résultat.');}}
  startNew(){if(this.busy)return;clearTimeout(this.timer);this.pending=null;this.receipt=null;this.receiptStatus=null;try{this.storage?.removeItem(STORAGE_KEY);}catch{}this.resetForm(this.lastOptions);void this.refreshConnections();this.prompt.focus();}
  invalidate(){if(this.busy||this.pending)return;this.previewData=null;this.review.hidden=true;this.result.hidden=true;this.error.hidden=true;this.update();}
  update(){for(const input of [...Object.values(this.fields),this.connection,this.prompt])input.disabled=Boolean(this.busy||this.receipt||this.pending);this.previewButton.disabled=Boolean(this.busy||this.receipt||this.pending||!this.connection.value);this.previewButton.hidden=Boolean(this.previewData||this.receipt||this.pending);this.confirmButton.disabled=Boolean(this.busy||this.receipt);this.confirmButton.textContent=t(this.pending?'Retrouver cet ajout':'Confirmer l’ajout à mon agenda');this.editButton.disabled=Boolean(this.busy||this.pending);for(const button of this.form.querySelectorAll('button'))if(![this.confirmButton,this.previewButton,this.editButton,this.recoverButton,this.retryButton,this.newButton,this.abandonButton,this.refreshButton].includes(button))button.disabled=Boolean(this.busy||this.receipt||this.pending);for(const button of [this.recoverButton,this.retryButton,this.newButton,this.abandonButton])button.disabled=Boolean(this.busy);this.refreshButton.disabled=Boolean(this.busy||this.pending||this.receipt||this.connectionsLoading);}
  showError(error){this.error.textContent=t(error?.message||String(error));this.error.hidden=false;}
  async interpret(){if(this.busy||this.pending||this.receipt||!this.prompt.value.trim())return;this.busy=true;this.error.hidden=true;this.update();const epoch=this.epoch,token=++this.interpretToken;try{const data=await this.request('/api/calendar/interpret',POST({prompt:this.prompt.value.trim(),timeZone:this.fields.timeZone.value}));if(epoch!==this.epoch||!this.dialog.open||token!==this.interpretToken)return;this.previewData=null;this.review.hidden=true;for(const key of Object.keys(this.fields))if(data[key]!==undefined)this.fields[key].value=data[key];this.durationSource=data.durationSource||'default';this.message.textContent=[t(data.missing?.length?'Complétez les détails manquants ci-dessous avant de vérifier.':'Demande comprise. Relisez les dates et le titre ; la durée proposée est modifiable.'),...(Array.isArray(data.issues)?data.issues.filter(issue=>typeof issue==='string').map(issue=>t(issue)):[])].join(' ');}catch(error){if(epoch===this.epoch)this.showError(error);}finally{if(epoch===this.epoch){this.busy=false;this.update();}}}
  event(){const fields=Object.fromEntries(Object.entries(this.fields).map(([key,input])=>[key,input.value.trim()]));return{...fields,durationSource:this.durationSource||'default'};}
  async preview(){if(this.busy||this.receipt||this.pending||!this.form.reportValidity())return;this.busy=true;this.error.hidden=true;this.update();const epoch=this.epoch;try{const[client,...name]=this.connection.value.split(':');const data=await this.request('/api/calendar/preview',POST({client,name:name.join(':'),event:this.event()}));if(epoch!==this.epoch||!this.dialog.open)return;if(!data?.previewId||!data?.confirmationToken||!data?.event)throw new Error('Le bureau n’a pas confirmé cet aperçu.');this.summary.replaceChildren();const event=data.event;const fmt=value=>new Intl.DateTimeFormat(getLocale(),{timeZone:event.timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(value));for(const[label,value]of [['Agenda à utiliser',`${this.connection.selectedOptions[0]?.textContent||''} · ${t('Agenda principal du compte connecté')}`],['Titre du rendez-vous',event.title],['Début du rendez-vous',fmt(event.start)],['Fin du rendez-vous',fmt(event.end)],['Fuseau horaire',event.timeZone],['Lieu (facultatif)',event.location],['Informations à ajouter (facultatif)',event.description]])if(value)this.summary.append(node('dt','',t(label)),node('dd','',value));this.previewData=data;this.review.hidden=false;this.review.scrollIntoView({block:'nearest'});}catch(error){if(epoch===this.epoch)this.showError(error);}finally{if(epoch===this.epoch){this.busy=false;this.update();}}}
  async confirm(){
    if(this.busy||this.receipt||!this.previewData&&!this.pending)return;
    this.busy=true;this.error.hidden=true;clearTimeout(this.timer);const epoch=this.epoch;this.update();
    try{
      if(this.pending){const retry=await this.lookup(epoch);if(!retry||epoch!==this.epoch)return;}
      else{this.pending={previewId:this.previewData.previewId,confirmationToken:this.previewData.confirmationToken,requestId:crypto.randomUUID()};this.remember();}
      this.confirming=true;this.update();const data=await this.request('/api/calendar/confirm',POST({previewId:this.pending.previewId,confirmationToken:this.pending.confirmationToken,requestId:this.pending.requestId}));if(epoch!==this.epoch)return;this.showReceipt(data);
    }catch(error){if(epoch===this.epoch){this.showError(error);this.showRecovery();}}
    finally{this.confirming=false;if(epoch===this.epoch){this.busy=false;this.update();}}
  }
  async lookup(epoch){
    try{const data=await this.request(`/api/calendar/receipts/${encodeURIComponent(this.pending.requestId)}`);if(epoch!==this.epoch||!this.dialog.open)return false;this.showReceipt(data);return false;}
    catch(error){if(epoch!==this.epoch)return false;if(error.status!==404)throw error;this.recoveryMissing=!this.pending.previewId||!this.pending.confirmationToken;this.showRecovery();return!this.recoveryMissing;}
  }
  async recover(){
    if(this.busy||!this.pending)return;this.busy=true;this.error.hidden=true;clearTimeout(this.timer);const epoch=this.epoch;this.update();
    try{await this.lookup(epoch);}catch(error){if(epoch===this.epoch){this.showError(error);this.showRecovery();}}finally{if(epoch===this.epoch){this.busy=false;this.update();}}
  }
  showRecovery(){
    this.review.hidden=true;this.result.replaceChildren(node('h3','',t('Retrouver cet ajout')),node('p','',t(this.recoveryMissing?'Aucun reçu n’a été retrouvé sur ce bureau. Vérifiez votre agenda avant de recommencer. Aucun ajout n’a été relancé.':'La confirmation n’a pas encore été retrouvée. Reprenez le même ajout ; aucune nouvelle demande ne sera créée.')),this.recoverButton);
    if(this.recoveryMissing)this.result.append(this.abandonButton);else if(this.pending?.previewId)this.result.append(this.retryButton);this.result.hidden=false;
  }
  showReceipt(data){
    if(!['pending','creating','completed','failed','uncertain'].includes(data?.status)||data.requestId&&data.requestId!==this.pending?.requestId)throw new Error('Le bureau n’a pas confirmé le résultat de cet ajout.');
    this.receiptStatus=data.status;this.review.hidden=true;this.recoveryMissing=false;
    const running=['pending','creating'].includes(data.status);if(!running)this.receipt=data;
    this.result.replaceChildren(node('h3','',t(running?'L’ajout est en cours.':data.status==='completed'?'Rendez-vous ajouté à votre agenda.':'Vérifiez le résultat avant tout nouvel essai.')),node('p','',t(data.message||'Le service n’a pas confirmé le résultat. Consultez votre agenda ; ne relancez pas un ajout identique.')));
    if(data.eventId)this.result.append(node('p','',String(data.eventId)));
    if(running){this.result.append(this.recoverButton);clearTimeout(this.timer);if(this.dialog.open)this.timer=setTimeout(()=>this.recover(),1500);}
    else this.result.append(data.status==='uncertain'?this.abandonButton:this.newButton);
    this.result.hidden=false;this.result.scrollIntoView({block:'nearest'});
  }
  closed(){if(this.notified)return;this.notified=true;this.epoch++;clearTimeout(this.timer);clearTimeout(this.connectionTimer);this.connectionsController?.abort();this.connectionsController=null;this.connectionsLoading=false;this.interpretToken=(this.interpretToken||0)+1;if(this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});this.onClose();}
  close(){if(this.confirming){this.showError('L’ajout est en cours. Attendez son résultat pour éviter un doublon.');return;}if(this.dialog.open){this.dialog.close();this.closed();}}
  destroy(){clearTimeout(this.timer);clearTimeout(this.connectionTimer);this.connectionsController?.abort();this.epoch++;this.interpretToken++;this.dialog.remove();}
}
