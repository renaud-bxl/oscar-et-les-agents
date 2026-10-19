import {getLocale,translate,withLocaleInstruction} from './i18n.js';
import {DraftStorage} from './draft-storage.js';

const LOCALES={fr:'fr-BE',en:'en-GB',nl:'nl-BE'};
const STATUS={scheduled:'Programmée',paused:'En pause',running:'Au travail',busy:'Bureau occupé',needs_connection:'Connexion nécessaire',needs_configuration:'À configurer',failed:'À vérifier',completed:'Mission terminée'};
const PRESETS=[
  {id:'morning',label:'Veille du matin',detail:'Les nouvelles utiles, avec leurs sources.',frequency:'daily',time:'07:30',prompt:'Prépare une veille sur [votre sujet]. Recherche les évolutions récentes, cite tes sources et leurs dates, puis livre une synthèse claire avec les points à vérifier. Conserve le résultat dans les fichiers de la mission.'},
  {id:'social',label:'Réseaux sociaux',detail:'Des idées et des brouillons, prêts à relire.',frequency:'weekdays',time:'09:00',prompt:'Prépare des idées et des brouillons de publications pour [votre activité]. Propose des angles complémentaires, un texte et une suggestion visuelle pour chaque publication. Ne publie rien et conserve les propositions dans la livraison.'},
  {id:'night',label:'Recherche de nuit',detail:'Un dossier préparé pendant votre repos.',frequency:'daily',time:'02:00',prompt:'Prépare un dossier de recherche sur [votre sujet]. Compare les sources, construis une synthèse argumentée, distingue les faits des hypothèses et indique les limites de la recherche. Livre les références et les fichiers utiles.'},
  {id:'mail',label:'Brief e-mails',detail:'Accès à configurer · aucun envoi activé.',frequency:'weekdays',time:'08:00',requiresConnector:true,prompt:'Après configuration explicite d’un accès aux e-mails, prépare un brief des messages relatifs à [votre sujet] : sujets, priorités et brouillons de réponses. Ne lis aucun compte sans accès autorisé et n’envoie aucun message. Conserve le brief et les brouillons dans les fichiers de la mission.'},
];
let instanceNumber=0;
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const requestJson=async(url,options={})=>{
  const response=await fetch(url,{credentials:'same-origin',...options});let data;
  try{data=await response.json();}catch{throw new Error('Le bureau a renvoyé une réponse inattendue.');}
  if(!response.ok)throw new Error(data.error||'Cette action n’a pas pu être réalisée.');return data;
};
const TEMPLATE_SLOT=/\[(?:votre|vos|your|je|jouw)\b[^\]\n]*\]/giu;
export const routineTemplate=(template,subject,locale=getLocale())=>translate(template,locale).replace(TEMPLATE_SLOT,()=>String(subject||'').trim()||translate('le sujet indiqué ci-dessus',locale));

export class AutomationsDialog {
  constructor({request=requestJson,getState=()=>({providers:[]}),onMission=()=>{},onClose=()=>{},draftStore=new DraftStorage()}={}) {
    Object.assign(this,{request,getState,onMission,onClose,draftStore});
    this.number=++instanceNumber;this.data={automations:[],timezone:'',requiresRunning:true};this.connections=[];this.connectionsError=false;
    this.opened=false;this.destroyed=false;this.epoch=0;this.loadSequence=0;this.timer=null;this.busy=false;this.loading=false;this.loaded=false;this.editingId=null;this.selectedPreset=null;this.pendingDelete=null;this.listSignature='';
    this.previewSequence=0;this.previewSignature='';this.previewState='idle';this.previewData=null;
    this.build();this.restoreDraft();this.updateForm();
    this._onClose=()=>{if(!this.dialog.open)this.finishedClosing();};
    this._onCancel=event=>{event.preventDefault();this.close();};
    this._onBackdrop=event=>{if(event.target!==this.dialog)return;const box=this.dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)this.close();};
    this._onLanguage=()=>{if(this.opened){this.renderWeekdays();this.renderConnections();this.renderList(true);this.updateForm();this.renderPreview();}};
    this._onVisibility=()=>{this.stopTimer();if(this.opened&&!document.hidden){this.refresh({quiet:true});this.startTimer();}};
    this.dialog.addEventListener('close',this._onClose);this.dialog.addEventListener('cancel',this._onCancel);this.dialog.addEventListener('click',this._onBackdrop);
    document.addEventListener('oscar:language',this._onLanguage);document.addEventListener('visibilitychange',this._onVisibility);
  }

  field(label,type,key) {
    const wrapper=element('label','automation-field');const input=element(type==='textarea'?'textarea':type==='select'?'select':'input');
    input.id=`automation-${this.number}-${key}`;if(type!=='textarea'&&type!=='select')input.type=type;
    wrapper.htmlFor=input.id;wrapper.append(element('span','automation-field-label',label),input);return{wrapper,input};
  }

  build() {
    this.dialog=element('dialog','automations-dialog');this.dialog.id='automations-dialog';this.dialog.setAttribute('aria-labelledby',`automations-title-${this.number}`);this.dialog.setAttribute('aria-describedby',`automations-note-${this.number}`);
    const header=element('header','automations-header'),heading=element('div');heading.append(element('span','automations-eyebrow','LE BUREAU À L’HEURE'));
    const title=element('h2','','Vos rendez-vous avec Oscar');title.id=`automations-title-${this.number}`;
    heading.append(title,element('p','','Une mission qui revient, une équipe prête à s’y mettre.'));
    const close=element('button','automations-close','×');close.type='button';close.setAttribute('aria-label','Fermer les automatisations');close.addEventListener('click',()=>this.close());this.closeButton=close;header.append(heading,close);
    const note=element('div','automations-running-note');note.id=`automations-note-${this.number}`;
    const symbol=element('span','automations-running-symbol','↻');symbol.setAttribute('aria-hidden','true');
    const copy=element('div');copy.append(element('strong','','À 2 h aussi, le bureau doit rester ouvert.'),element('p','','L’application et l’ordinateur doivent être allumés, sans veille. Un horaire manqué est signalé ; il n’est pas rattrapé en boucle.'));
    this.timezone=element('span','automations-timezone');copy.append(this.timezone);note.append(symbol,copy);
    this.notice=element('p','automations-notice');this.notice.setAttribute('role','status');this.notice.hidden=true;
    this.error=element('p','automations-error');this.error.setAttribute('role','alert');this.error.hidden=true;

    const body=element('div','automations-body'),create=element('section','automations-create');
    const createHead=element('div','automations-section-heading');createHead.append(element('span','automations-step','01'));
    this.formTitle=element('h3','','Une nouvelle routine');createHead.append(this.formTitle);create.append(createHead);
    const presetLabel=element('p','automations-preset-label','Un point de départ ?');const presets=element('div','automation-presets');this.presetButtons=new Map();
    for(const preset of PRESETS){const button=element('button','automation-preset');button.type='button';button.setAttribute('aria-pressed','false');button.append(element('strong','',preset.label),element('span','',preset.detail));button.addEventListener('click',()=>this.choosePreset(preset));presets.append(button);this.presetButtons.set(preset.id,button);}
    create.append(presetLabel,presets);
    this.form=element('form','automation-form');
    const label=this.field('Nom du rendez-vous','text','label');this.labelInput=label.input;this.labelInput.required=true;this.labelInput.maxLength=100;this.labelInput.placeholder='Ma recherche de 2 h';
    const topic=this.field('Sur quel sujet ?','text','topic');this.topic=topic.input;this.topic.maxLength=200;this.topic.placeholder='Ex. : les nouvelles règles pour les indépendants en Belgique';this.topicWrapper=topic.wrapper;this.topicWrapper.hidden=true;
    this.topicHint=element('small','','Indiquez votre thème ici : Oscar l’ajoute à la mission ci-dessous.');this.topicHint.id=`automation-topic-hint-${this.number}`;this.topic.setAttribute('aria-describedby',this.topicHint.id);topic.wrapper.append(this.topicHint);
    this.topic.addEventListener('input',()=>{this.topic.setCustomValidity('');if(this.prompt.value===this.generatedPrompt){this.generatedPrompt=routineTemplate(this.templatePrompt,this.topic.value);this.prompt.value=this.generatedPrompt;}this.showError('');});
    const prompt=this.field('La mission confiée à Oscar','textarea','prompt');this.prompt=prompt.input;this.prompt.required=true;this.prompt.maxLength=16000;this.prompt.rows=5;this.prompt.placeholder='Que doit préparer l’équipe à chaque passage ? Précisez le sujet, le résultat attendu et les sources utiles.';
    const provider=this.field('Votre moteur d’IA','select','provider');this.provider=provider.input;this.providerNote=element('p','automation-field-note');this.providerNote.id=`automation-provider-note-${this.number}`;this.provider.setAttribute('aria-describedby',this.providerNote.id);provider.wrapper.append(this.providerNote);this.provider.addEventListener('change',()=>{this.updateProviderNote();this.renderConnections();this.updateForm();});
    this.draftNote=element('div','automation-draft-note');this.draftMessage=element('p','','Votre texte est gardé 7 jours sur cet ordinateur, sans envoi automatique.');this.draftMessage.setAttribute('role','status');this.clearDraftButton=element('button','automation-clear-draft','Effacer le brouillon');this.clearDraftButton.type='button';this.clearDraftButton.addEventListener('click',()=>this.clearDraft());this.draftNote.append(this.draftMessage,this.clearDraftButton);
    for(const input of [this.labelInput,this.prompt,this.topic])input.addEventListener('input',()=>this.saveDraft());this.provider.addEventListener('change',()=>this.saveDraft());
    const frequency=this.field('À quel rythme ?','select','frequency');this.frequency=frequency.input;
    const noFrequency=element('option','','Choisissez le rythme');noFrequency.value='';this.frequency.append(noFrequency);this.frequency.required=true;
    for(const [value,text]of[['daily','Chaque jour'],['weekdays','Du lundi au vendredi'],['weekly','Chaque semaine'],['interval','À intervalle régulier']]){const option=element('option','',text);option.value=value;this.frequency.append(option);}
    this.frequency.value='daily';this.frequency.addEventListener('change',()=>this.updateForm());
    const time=this.field('Heure locale','time','time');this.time=time.input;this.time.value='02:00';this.time.required=true;this.timeWrapper=time.wrapper;
    const day=this.field('Jour de la semaine','select','day');this.day=day.input;this.dayWrapper=day.wrapper;this.renderWeekdays();this.day.value='1';
    const interval=this.field('Intervalle en minutes','number','interval');this.interval=interval.input;this.interval.value='60';this.interval.min='15';this.interval.max='10080';this.interval.step='1';this.intervalWrapper=interval.wrapper;interval.wrapper.append(element('small','','De 15 minutes à 7 jours.'));
    const rhythm=element('div','automation-rhythm');rhythm.append(frequency.wrapper,time.wrapper,day.wrapper,interval.wrapper);
    this.preview=element('section','automation-schedule-preview');this.preview.setAttribute('aria-labelledby',`automation-preview-title-${this.number}`);const previewTitle=element('h4','','Avant d’enregistrer, les trois prochains passages');previewTitle.id=`automation-preview-title-${this.number}`;this.previewNote=element('p','automation-preview-state','Choisissez le rythme et l’heure pour voir les prochains passages.');this.previewNote.setAttribute('role','status');this.previewDates=element('ol','automation-preview-dates');this.previewContext=element('p','automation-preview-context');this.preview.append(previewTitle,this.previewNote,this.previewDates,this.previewContext,element('p','automation-preview-help','Le bureau doit rester ouvert. Une mission précédente encore active ne sera pas doublée.'));
    for(const field of [this.frequency,this.time,this.day,this.interval]){field.addEventListener('input',()=>this.queuePreview());field.addEventListener('change',()=>this.queuePreview());}
    const connector=element('label','automation-connector');this.connector=element('input');this.connector.type='checkbox';this.connector.addEventListener('change',()=>this.updateForm());connector.append(this.connector,element('span','','Cette mission a besoin d’un connecteur'));
    this.connectorNote=element('p','automation-connector-note','Choisissez un service déjà connecté. Son accès en lecture sera vérifié au prochain horaire ; enregistrer ne consulte aucun compte.');
    const connection=this.field('Service déjà connecté','select','connector');this.connectorSelect=connection.input;this.connectorWrapper=connection.wrapper;this.connectorSelect.addEventListener('change',()=>this.updateForm());this.connectionNote=element('small','');connection.wrapper.append(this.connectionNote);this.renderConnections();
    const actions=element('div','automation-form-actions');this.submit=element('button','automation-submit','Enregistrer le rendez-vous');this.submit.type='submit';this.cancelEdit=element('button','automation-cancel-edit','Annuler les modifications');this.cancelEdit.type='button';this.cancelEdit.hidden=true;this.cancelEdit.addEventListener('click',()=>this.resetForm());actions.append(this.submit,this.cancelEdit);
    this.form.append(label.wrapper,topic.wrapper,prompt.wrapper,this.draftNote,provider.wrapper,rhythm,this.preview,connector,this.connectorNote,connection.wrapper,actions,element('p','automation-save-note','Enregistrer prépare le prochain horaire. Cela ne lance pas une mission immédiatement.'));
    this.form.addEventListener('submit',event=>{event.preventDefault();this.save();});create.append(this.form);

    const schedule=element('section','automations-schedule');const scheduleHead=element('div','automations-section-heading');scheduleHead.append(element('span','automations-step','02'),element('h3','','Les prochains passages'));this.count=element('span','automations-count','0');scheduleHead.append(this.count);
    this.refreshButton=element('button','automations-refresh','Actualiser');this.refreshButton.type='button';this.refreshButton.addEventListener('click',()=>{this.refresh();this.refreshConnections();this.queuePreview(true);});scheduleHead.append(this.refreshButton);
    this.list=element('div','automation-list');this.list.setAttribute('aria-label','Vos automatisations');schedule.append(scheduleHead,this.list);body.append(create,schedule);
    const footer=element('footer','automations-footer');footer.append(element('span','automations-footer-mark','Oscar'),element('p','','Oscar prépare des résultats dans vos missions. Aucun paiement ni envoi automatique n’est activé.'));
    this.dialog.append(header,note,this.notice,this.error,body,footer);document.body.append(this.dialog);this.renderProviders();this.updateForm();this.renderList();
  }

  renderProviders() {
    const state=this.getState()||{},chosen=this.provider.value||state.preferredProvider;
    const providers=(state.providers||[]).filter(p=>['codex','claude'].includes(p.id));
    const items=providers.length?providers:[{id:'codex',name:'Codex · ChatGPT',available:false},{id:'claude',name:'Claude Code',available:false}];
    this.provider.replaceChildren();
    for(const item of items){const option=element('option','',`${item.name||item.id}${item.available?'':' · indisponible'}`);option.value=item.id;this.provider.append(option);}
    const preferred=items.some(p=>p.id===chosen)?chosen:items.find(p=>p.available&&p.auth?.loggedIn===true)?.id||items.find(p=>p.available)?.id||items[0].id;
    this.provider.value=preferred;this.updateProviderNote();this.renderConnections();
  }
  updateProviderNote() {
    const provider=(this.getState()?.providers||[]).find(p=>p.id===this.provider.value);
    this.providerNote.textContent=provider?.message||(provider?.available&&provider.auth?.loggedIn===true?'Votre abonnement local est prêt.':'Connectez ce moteur dans les réglages avant le premier lancement.');
    this.providerNote.classList.toggle('needs-connection',!provider?.available||provider.auth?.loggedIn!==true);
  }
  renderWeekdays() {
    if(!this.day)return;const selected=this.day.value||'1';this.day.replaceChildren();
    for(const number of[1,2,3,4,5,6,0]){const option=element('option','',new Intl.DateTimeFormat(LOCALES[getLocale()],{weekday:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,4+number))));option.value=String(number);this.day.append(option);}this.day.value=selected;
  }
  updateForm() {
    for(const field of this.form.querySelectorAll('input,select,textarea'))field.disabled=this.busy;
    const interval=this.frequency.value==='interval';this.timeWrapper.hidden=interval;this.dayWrapper.hidden=this.frequency.value!=='weekly';this.intervalWrapper.hidden=!interval;
    this.time.disabled=this.busy||interval;this.time.required=!interval;this.interval.disabled=this.busy||!interval;this.interval.required=interval;
    this.connectorNote.hidden=!this.connector.checked;this.connectorWrapper.hidden=!this.connector.checked;this.connectorSelect.disabled=this.busy;this.cancelEdit.hidden=!this.editingId;this.cancelEdit.disabled=this.busy;
    this.topicWrapper.hidden=!this.selectedPreset&&!this.draftTopicVisible;this.topic.required=Boolean(this.selectedPreset);this.draftNote.hidden=Boolean(this.editingId);this.clearDraftButton.disabled=this.busy||!this.hasDraftText();
    this.formTitle.textContent=this.editingId?'Modifier ce rendez-vous':'Une nouvelle routine';
    this.submit.textContent=this.busy?'Patientez…':this.editingId?'Enregistrer les modifications':this.connector.checked&&!this.connectorSelect.value?'Enregistrer · à configurer':'Enregistrer le rendez-vous';
    this.submit.disabled=this.busy;this.refreshButton.disabled=this.busy||(this.loading&&!this.quietRefresh);
    for(const [id,button]of this.presetButtons){button.setAttribute('aria-pressed',String(id===this.selectedPreset));button.disabled=this.busy;}
    this.queuePreview();
  }
  previewSchedule(){
    const frequency=this.frequency.value;if(!['daily','weekdays','weekly','interval'].includes(frequency))return null;
    if(frequency==='interval'){const minutes=Number(this.interval.value);return /^\d+$/u.test(this.interval.value)&&Number.isInteger(minutes)&&minutes>=15&&minutes<=10080?{frequency,intervalMinutes:minutes}:null;}
    const time=this.time.value;if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))return null;
    const schedule={frequency,time};if(frequency==='weekly'){const day=Number(this.day.value);if(!Number.isInteger(day)||day<0||day>6)return null;schedule.dayOfWeek=day;}return schedule;
  }
  cancelPreview(){clearTimeout(this.previewTimer);this.previewTimer=null;this.previewController?.abort();this.previewController=null;++this.previewSequence;}
  queuePreview(force=false){
    if(!this.opened||this.destroyed||this.busy)return;const schedule=this.previewSchedule(),signature=schedule?JSON.stringify(schedule):'';
    if(!force&&signature===this.previewSignature&&this.previewState!=='idle'){this.renderPreview();return;}
    this.cancelPreview();this.previewSignature=signature;this.previewData=null;this.previewState=schedule?'loading':'choose';this.renderPreview();if(!schedule)return;
    const sequence=this.previewSequence,epoch=this.epoch;
    this.previewTimer=setTimeout(async()=>{this.previewTimer=null;const controller=new AbortController();this.previewController=controller;
      try{const result=await this.request('/api/automations/preview',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify({schedule}),signal:controller.signal});if(controller.signal.aborted||sequence!==this.previewSequence||epoch!==this.epoch||!this.opened||this.destroyed)return;
        if(!Number.isFinite(result?.generatedAt)||!Array.isArray(result.nextRuns)||result.nextRuns.length!==3||result.nextRuns.some((value,index)=>!Number.isFinite(value)||!Number.isFinite(new Date(value).getTime())||value<=(index?result.nextRuns[index-1]:result.generatedAt))||typeof result.timezone!=='string'||result.timezone.length>100)throw new Error();
        this.previewData=result;this.previewState='ready';
      }catch{if(controller.signal.aborted||sequence!==this.previewSequence||epoch!==this.epoch||!this.opened||this.destroyed)return;this.previewState='error';}
      finally{if(sequence===this.previewSequence){this.previewController=null;this.renderPreview();}}
    },250);
  }
  renderPreview(){
    if(!this.preview)return;const signature=JSON.stringify([getLocale(),this.previewState,this.editingId,this.previewData?.nextRuns,this.previewData?.timezone]);if(signature===this.previewRenderSignature)return;this.previewRenderSignature=signature;this.preview.setAttribute('aria-busy',String(this.previewState==='loading'));this.previewDates.replaceChildren();this.previewContext.textContent='';
    const text=this.previewState==='ready'?(this.editingId?'Aperçu des modifications : le rendez-vous existant reste inchangé jusqu’à l’enregistrement.':'Aperçu uniquement : aucun rendez-vous n’est encore enregistré.'):this.previewState==='loading'?'Calcul des horaires…':this.previewState==='error'?'L’aperçu des horaires est indisponible. Votre formulaire est conservé.':'Choisissez le rythme et l’heure pour voir les prochains passages.';this.previewNote.textContent=translate(text);
    if(this.previewState==='ready'&&this.previewData){this.previewContext.textContent=`${translate('Heure locale')} · ${this.previewData.timezone}`;for(const value of this.previewData.nextRuns){const item=element('li'),time=element('time','',this.formatDate(value,this.previewData.timezone));time.dateTime=new Date(value).toISOString();time.setAttribute('data-no-translate','');item.append(time);this.previewDates.append(item);}}
    this.previewDates.hidden=!this.previewDates.children.length;
  }
  renderConnections(selected=this.connectorSelect?.value||'') {
    if(!this.connectorSelect)return;
    const options=this.connections.filter(connection=>connection.client===this.provider.value&&['authorized','connected'].includes(connection.status)&&connection.readOnlyAutomation?.available===true);this.connectorSelect.replaceChildren();
    const none=element('option','',translate('À configurer plus tard'));none.value='';this.connectorSelect.append(none);
    for(const connection of options){const option=element('option','',`${connection.displayName||connection.runtimeName||connection.name}${connection.inherited?` · ${translate('déjà connecté')}`:''}`);option.value=connection.name;this.connectorSelect.append(option);}
    if(selected&&!options.some(connection=>connection.name===selected)){const previous=element('option','',`${selected} · ${translate('À vérifier')}`);previous.value=selected;previous.disabled=true;this.connectorSelect.append(previous);}
    this.connectorSelect.value=selected;
    this.connectionNote.textContent=this.connectionsError?'Les services connectés n’ont pas pu être vérifiés. Retrouvez-les dans les réglages du bureau.':'Les accès déjà autorisés dans le moteur choisi sont proposés. Ils seront vérifiés avant chaque lancement ; aucun outil d’envoi n’est activé.';
  }
  async refreshConnections() {
    const epoch=this.epoch;
    try{const data=await this.request('/api/connectors');if(epoch!==this.epoch||!this.opened)return;this.connections=Array.isArray(data?.connections)?data.connections:[];this.connectionsError=false;}
    catch{if(epoch!==this.epoch||!this.opened)return;this.connections=[];this.connectionsError=true;}
    this.renderConnections();this.updateForm();
  }
  hasDraftText(){return [this.labelInput?.value,this.prompt?.value,this.topic?.value].some(value=>typeof value==='string'&&value.trim());}
  saveDraft(){
    if(this.editingId)return;
    const saved=this.hasDraftText()?this.draftStore.write('routine',{title:this.labelInput.value,text:this.prompt.value,subject:this.topic.value,provider:this.provider.value}):this.draftStore.remove('routine');
    this.draftMessage.textContent=translate(saved?'Votre texte est gardé 7 jours sur cet ordinateur, sans envoi automatique.':'Votre navigateur ne peut pas conserver ce brouillon. Gardez cette fenêtre ouverte.');this.clearDraftButton.disabled=this.busy||!this.hasDraftText();
  }
  restoreDraft(){
    const draft=this.draftStore.read('routine');if(!draft||![draft.title,draft.text,draft.subject].some(value=>typeof value==='string'&&value.trim()))return;
    this.labelInput.value=String(draft.title||'').slice(0,100);this.prompt.value=String(draft.text||'').slice(0,16000);this.topic.value=String(draft.subject||'').slice(0,200);this.topic.setCustomValidity('');
    if(['codex','claude'].includes(draft.provider)&&[...this.provider.options].some(option=>option.value===draft.provider))this.provider.value=draft.provider;
    // A saved piece of writing is not a saved schedule or permission grant.
    this.editingId=null;this.selectedPreset=null;this.generatedPrompt=null;this.templatePrompt=null;this.draftTopicVisible=Boolean(this.topic.value);this.topicHint.textContent='Votre sujet est conservé. Vérifiez qu’il figure bien dans la mission ci-dessous.';
    this.frequency.value='';this.time.value='';this.day.value='1';this.interval.value='60';this.connector.checked=false;this.renderConnections('');this.updateProviderNote();
    this.draftMessage.textContent=translate('Brouillon retrouvé. Choisissez le rythme et l’heure avant d’enregistrer cette routine.');
  }
  clearDraft(){
    if(this.busy||this.editingId)return;const cleared=this.draftStore.remove('routine');this.resetForm({restore:false});this.frequency.value='';this.time.value='';this.updateForm();
    this.draftMessage.textContent=translate(cleared?'Brouillon effacé.':'Le navigateur n’a pas confirmé l’effacement du brouillon.');this.prompt.focus();
  }
  choosePreset(preset) {
    this.editingId=null;this.selectedPreset=preset.id;this.draftTopicVisible=false;this.topicHint.textContent='Indiquez votre thème ici : Oscar l’ajoute à la mission ci-dessous.';this.labelInput.value=translate(preset.label);this.topic.value='';this.topic.setCustomValidity('');this.templatePrompt=preset.prompt;this.generatedPrompt=routineTemplate(preset.prompt,'');this.prompt.value=this.generatedPrompt;this.frequency.value=preset.frequency;this.time.value=preset.time;this.connector.checked=!!preset.requiresConnector;this.renderConnections('');this.updateProviderNote();this.updateForm();this.showError('');this.showNotice('');this.saveDraft();this.topic.focus({preventScroll:true});
  }
  resetForm({restore=true}={}) {this.editingId=null;this.selectedPreset=null;this.draftTopicVisible=false;this.topic.value='';this.topic.setCustomValidity('');this.topicHint.textContent='Indiquez votre thème ici : Oscar l’ajoute à la mission ci-dessous.';this.generatedPrompt=null;this.templatePrompt=null;this.labelInput.value='';this.prompt.value='';this.frequency.value='daily';this.time.value='02:00';this.day.value='1';this.interval.value='60';this.connector.checked=false;this.draftMessage.textContent=translate('Votre texte est gardé 7 jours sur cet ordinateur, sans envoi automatique.');this.renderConnections('');if(restore)this.restoreDraft();this.updateForm();}
  edit(entry) {
    this.saveDraft();this.editingId=entry.id;this.selectedPreset=null;this.draftTopicVisible=false;this.topic.value='';this.topic.setCustomValidity('');this.labelInput.value=entry.label;this.prompt.value=entry.prompt;this.provider.value=entry.provider;this.frequency.value=entry.schedule.frequency;this.time.value=entry.schedule.time||'02:00';this.day.value=String(entry.schedule.dayOfWeek??1);this.interval.value=String(entry.schedule.intervalMinutes||60);this.connector.checked=!!entry.requiresConnector;this.renderConnections(entry.connectorName||'');this.updateProviderNote();this.updateForm();this.labelInput.focus();
  }
  payload() {
    const schedule={frequency:this.frequency.value,time:this.time.value||'02:00'};
    if(schedule.frequency==='weekly')schedule.dayOfWeek=Number(this.day.value);
    if(schedule.frequency==='interval')schedule.intervalMinutes=Number(this.interval.value);
    const previous=this.data.automations.find(item=>item.id===this.editingId);
    return{label:this.labelInput.value.trim(),prompt:this.prompt.value.trim(),provider:this.provider.value,schedule,enabled:previous?.enabled??true,requiresConnector:this.connector.checked,connectorName:this.connector.checked?this.connectorSelect.value:''};
  }
  async save() {
    if(this.busy)return;
    this.saveDraft();
    if(this.selectedPreset&&!this.topic.value.trim()){this.topic.setCustomValidity(translate('Indiquez le sujet de cette routine, par exemple « les commerces de Bruxelles ».'));this.topic.reportValidity();this.topic.focus();return;}
    this.topic.setCustomValidity('');if(!this.form.reportValidity())return;
    const body=this.payload();if(!body.label||!body.prompt){this.showError('Ajoutez un nom et une mission avant d’enregistrer.','form');return;}
    const missing=/\[(?:votre|vos|your|je|jouw)\b[^\]\n]*\]/iu.exec(body.prompt);
    if(missing){this.showError('Dans la mission, remplacez le texte sélectionné par votre sujet, par exemple « les commerces de Bruxelles ».','form');this.prompt.focus();this.prompt.setSelectionRange(missing.index,missing.index+missing[0].length);return;}
    const editing=this.editingId;
    try{if(!editing)body.prompt=withLocaleInstruction(body.prompt);}catch(error){this.showError(error.message,'form');return;}
    await this.mutate(editing?`/api/automations/${encodeURIComponent(editing)}`:'/api/automations',editing?'PATCH':'POST',body,()=>{if(!editing)this.draftStore.remove('routine');this.resetForm({restore:Boolean(editing)});this.showNotice('Rendez-vous enregistré. Consultez son statut et son prochain horaire.');});
  }

  formatDate(value,timezone=this.data.timezone) {
    if(!Number.isFinite(value)||value<=0)return translate('Pas encore exécutée');
    const options={day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
    if(timezone)options.timeZone=timezone;
    try{return new Intl.DateTimeFormat(LOCALES[getLocale()],options).format(new Date(value));}catch{return new Date(value).toLocaleString(LOCALES[getLocale()]);}
  }
  rhythm(schedule={}) {
    const time=schedule.time||'02:00';
    if(schedule.frequency==='weekdays')return translate('Du lundi au vendredi à $1').replace('$1',time);
    if(schedule.frequency==='weekly'){const day=new Intl.DateTimeFormat(LOCALES[getLocale()],{weekday:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,4+Number(schedule.dayOfWeek||0))));return translate('Chaque $1 à $2').replace('$1',day).replace('$2',time);}
    if(schedule.frequency==='interval'){const minutes=Number(schedule.intervalMinutes)||60;if(minutes===60)return translate('Toutes les heures');if(minutes%60===0)return translate('Toutes les $1 heures').replace('$1',String(minutes/60));return translate('Toutes les $1 minutes').replace('$1',String(minutes));}
    return translate('Tous les jours à $1').replace('$1',time);
  }
  button(text,action,id,callback,className='') {
    const button=element('button',`automation-action ${className}`,text);button.type='button';button.dataset.action=action;button.dataset.automation=id;button.disabled=this.busy;button.addEventListener('click',callback);return button;
  }
  renderList(force=false) {
    const signature=JSON.stringify([getLocale(),this.loaded,!this.loaded&&this.loading,this.busy,this.pendingDelete,this.data.automations]);if(!force&&signature===this.listSignature)return;this.listSignature=signature;
    const focused=document.activeElement?.closest('[data-automation]');const focus=focused&&this.list.contains(focused)?{id:focused.dataset.automation,action:focused.dataset.action}:null;
    const expanded=new Set([...this.list.querySelectorAll('.automation-brief[open]')].map(node=>node.dataset.automation)),expandedUpcoming=new Set([...this.list.querySelectorAll('.automation-upcoming[open]')].map(node=>node.dataset.automation));this.list.replaceChildren();
    this.count.textContent=String(this.data.automations.length);this.list.setAttribute('aria-busy',String(this.loading));
    if(!this.data.automations.length){const empty=element('div','automation-empty');const icon=element('span','automation-empty-icon','↻');icon.setAttribute('aria-hidden','true');empty.append(icon,element('strong','',!this.loaded&&this.loading?'Chargement des rendez-vous…':'Oscar garde une place dans son agenda.'),element('p','','Choisissez une idée à gauche, adaptez la mission et décidez de son prochain passage.'));this.list.append(empty);}
    for(const entry of this.data.automations){
      const card=element('article','automation-card');card.dataset.status=entry.status;const top=element('div','automation-card-top');const title=element('h4','',entry.label);title.setAttribute('data-no-translate','');top.append(title,element('span',`automation-status ${entry.status}`,STATUS[entry.status]||'À vérifier'));
      const schedule=element('p','automation-card-rhythm',this.rhythm(entry.schedule));schedule.setAttribute('data-no-translate','');
      const engine=element('span','automation-card-engine',this.getState()?.providers?.find(p=>p.id===entry.provider)?.name||(entry.provider==='claude'?'Claude Code':'Codex · ChatGPT'));
      const dates=element('dl','automation-dates');
      for(const [label,value]of[['Prochain passage',entry.enabled&&Number.isFinite(entry.nextRunAt)?this.formatDate(entry.nextRunAt):entry.enabled?'À calculer':'En pause'],['Dernier passage',this.formatDate(entry.lastRunAt)]]){const group=element('div');group.append(element('dt','',label));const date=element('dd','',value);if(Number.isFinite(label==='Prochain passage'?entry.nextRunAt:entry.lastRunAt))date.setAttribute('data-no-translate','');group.append(date);dates.append(group);}
      card.append(top,schedule,engine,dates);
      if(entry.enabled&&Array.isArray(entry.nextRuns)&&entry.nextRuns.length===3&&entry.nextRuns.every(Number.isFinite)){const upcoming=element('details','automation-upcoming');upcoming.dataset.automation=entry.id;upcoming.open=expandedUpcoming.has(entry.id);const summary=element('summary','','Les trois prochains horaires');summary.dataset.automation=entry.id;summary.dataset.action='upcoming';const times=element('ol','automation-preview-dates');for(const value of entry.nextRuns){const item=element('li'),time=element('time','',this.formatDate(value));time.dateTime=new Date(value).toISOString();time.setAttribute('data-no-translate','');item.append(time);times.append(item);}upcoming.append(summary,times);card.append(upcoming);}
      if(entry.message)card.append(element('p','automation-card-message',entry.message));
      const brief=element('details','automation-brief');brief.dataset.automation=entry.id;brief.open=expanded.has(entry.id);const summary=element('summary','','Voir la mission confiée');summary.dataset.automation=entry.id;summary.dataset.action='brief';brief.append(summary);const prompt=element('pre','',entry.prompt);prompt.setAttribute('data-no-translate','');brief.append(prompt);card.append(brief);
      if(entry.lastMissionId){const result=this.button('Ouvrir la dernière mission ↗','mission',entry.id,()=>{this.close();this.onMission(entry.lastMissionId);},'automation-result');card.append(result);}
      const actions=element('div','automation-actions');
      actions.append(this.button(entry.enabled?'Mettre en pause':'Reprendre','pause',entry.id,()=>this.mutate(`/api/automations/${encodeURIComponent(entry.id)}`,'PATCH',{enabled:!entry.enabled})),this.button('Lancer maintenant','run',entry.id,()=>this.mutate(`/api/automations/${encodeURIComponent(entry.id)}/run`,'POST',{},data=>this.showNotice(data.message||STATUS[data.status]||'Le statut du rendez-vous a été mis à jour.')),'automation-run'),this.button('Modifier','edit',entry.id,()=>this.edit(entry)),this.button('Supprimer','delete',entry.id,()=>{this.pendingDelete=entry.id;this.renderList(true);},'automation-delete'));
      card.append(actions);
      if(this.pendingDelete===entry.id){const confirmation=element('div','automation-confirm-delete');confirmation.append(element('p','','Supprimer ce rendez-vous ? Les missions déjà créées seront conservées.'),this.button('Confirmer la suppression','confirm-delete',entry.id,()=>this.mutate(`/api/automations/${encodeURIComponent(entry.id)}`,'DELETE',null,()=>{this.pendingDelete=null;if(this.editingId===entry.id)this.resetForm();this.showNotice('Rendez-vous supprimé. Ses missions restent dans votre historique.');}),'automation-delete'),this.button('Garder ce rendez-vous','keep',entry.id,()=>{this.pendingDelete=null;this.renderList(true);}));card.append(confirmation);}
      this.list.append(card);
    }
    if(focus){const target=[...this.list.querySelectorAll('[data-automation][data-action]')].find(node=>node.dataset.automation===focus.id&&node.dataset.action===focus.action);target?.focus({preventScroll:true});}
  }
  showError(text,kind='action'){this.error.textContent=text;this.error.hidden=!text;this.errorKind=kind;}
  showNotice(text){this.notice.textContent=text;this.notice.hidden=!text;}

  async refresh({quiet=false}={}) {
    if(!this.opened||this.destroyed)return;
    const epoch=this.epoch,sequence=++this.loadSequence;this.loading=true;this.quietRefresh=quiet;this.updateForm();if(!quiet)this.renderList();
    try{const data=await this.request('/api/automations');if(epoch!==this.epoch||sequence!==this.loadSequence||!this.opened)return;if(!Array.isArray(data?.automations))throw new Error('Le bureau a renvoyé une réponse inattendue.');this.data=data;this.loaded=true;this.timezone.textContent=data.timezone?`${translate('Heure locale')} · ${data.timezone}`:translate('Heure de votre ordinateur');if(this.errorKind==='load')this.showError('');if(data.message)this.showError(data.message,'load');}
    catch(error){if(epoch===this.epoch&&sequence===this.loadSequence&&this.opened)this.showError(error.message||'Impossible de charger les automatisations.','load');}
    finally{if(epoch===this.epoch&&sequence===this.loadSequence&&this.opened){this.loading=false;this.updateForm();this.renderList();}}
  }
  async mutate(url,method,body,after) {
    if(this.busy||!this.opened)return;const epoch=this.epoch;this.busy=true;this.loading=false;++this.loadSequence;this.showError('');this.showNotice('');this.updateForm();this.renderList();
    try{const options={method};if(body!==null){options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(body);}const data=await this.request(url,options);if(epoch!==this.epoch||!this.opened)return;after?.(data);await this.refresh({quiet:true});}
    catch(error){if(epoch===this.epoch&&this.opened)this.showError(error.message||'Cette action n’a pas pu être réalisée.');}
    finally{if(epoch===this.epoch&&this.opened){this.busy=false;this.updateForm();this.renderList();}}
  }
  startTimer(){if(this.timer===null&&this.opened&&!document.hidden)this.timer=setInterval(()=>{if(!this.busy&&!this.loading)this.refresh({quiet:true});},5000);}
  stopTimer(){if(this.timer!==null){clearInterval(this.timer);this.timer=null;}}
  async open(){if(this.destroyed)return this;if(this.opened){this.closeButton.focus();return this;}this.returnFocus=document.activeElement;this.opened=true;this.busy=false;this.loading=false;this.epoch++;this.showError('');this.showNotice('');this.renderProviders();this.dialog.showModal();this.closeButton.focus();this.startTimer();await Promise.all([this.refresh(),this.refreshConnections()]);return this;}
  finishedClosing(){if(!this.opened)return;this.opened=false;this.epoch++;this.loadSequence++;this.stopTimer();this.cancelPreview();this.previewSignature='';this.previewState='idle';if(this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});this.onClose();}
  close(){this.stopTimer();if(this.dialog.open)this.dialog.close();this.finishedClosing();return this;}
  destroy(){if(this.destroyed)return;this.close();this.destroyed=true;this.dialog.removeEventListener('close',this._onClose);this.dialog.removeEventListener('cancel',this._onCancel);this.dialog.removeEventListener('click',this._onBackdrop);document.removeEventListener('oscar:language',this._onLanguage);document.removeEventListener('visibilitychange',this._onVisibility);this.dialog.remove();}
}
