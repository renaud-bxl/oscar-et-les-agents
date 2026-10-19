import {getLocale,translate} from './i18n.js';
import {supportsLanguage} from './office-speech.js';

const node=(tag,cls,text)=>{const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=String(text);return element;};
const lang=voice=>String(voice?.lang||'').toLowerCase().split(/[-_]/)[0];
const text=value=>typeof value==='string'?value.slice(0,600):'';
const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const EXAMPLES={oscar:'Bonjour, moi c’est Oscar. Une idée, une équipe, et on se met au travail.',zoe:'Bonjour, je suis Zoé. Je vous aide à préparer vos e-mails, votre agenda et vos priorités.'};

export class VoiceDialog {
  constructor({getSpeech,onClose=()=>{}}={}){
    this.getSpeech=getSpeech;this.onClose=onClose;this.pending={};this.heard=new Set();this.epoch=0;
    this.dialog=node('dialog','voice-dialog');this.dialog.id='voice-dialog';this.dialog.setAttribute('aria-labelledby','voice-dialog-title');
    this.dialog.addEventListener('close',()=>this.closed());document.body.append(this.dialog);
    this.languageChanged=()=>{this.signature='';this.refresh();};document.addEventListener('oscar:language',this.languageChanged);
  }
  button(label,cls,action){const button=node('button',cls,label);button.type='button';button.addEventListener('click',action);return button;}
  state(){return this.getSpeech?.()?.getState?.()||{engine:'captions',enabled:false,available:false,characterVoices:{},voices:[],locale:getLocale(),local:{status:'unsupported',voices:[],message:'Le service de voix locales n’est pas disponible.'}};}
  statusMessage(state){
    if(!state.enabled)return'Les voix sont coupées. Les répliques restent affichées à l’écran.';
    if(state.engine==='captions')return'Sous-titres uniquement. Les personnages gardent leurs répliques à l’écran.';
    if(state.engine==='system')return'Voix du système activées à votre demande. Leur qualité dépend de cet ordinateur.';
    if(state.local?.status==='installing')return'Installation de la voix locale en cours. Les sous-titres restent disponibles.';
    return state.available?'Voix naturelles locales prêtes. Votre texte reste sur cet ordinateur.':'Les répliques restent affichées. Installez une voix naturelle compatible avec la langue du bureau pour les entendre.';
  }
  render(state){
    this.stopPreviews();
    const focused=this.dialog.contains(document.activeElement)?document.activeElement?.dataset.voiceFocus:null;
    const header=node('header','voice-header'),copy=node('div');copy.append(node('span','voice-eyebrow','LES VOIX DU BUREAU'));
    const title=node('h2','','Une voix pour chaque personnage');title.id='voice-dialog-title';title.tabIndex=-1;
    copy.append(title,node('p','','Oscar vous accompagne. Zoé vous aide à vous organiser. Les spécialistes travaillent en silence.'));
    const close=this.button('×','voice-close',()=>this.close());close.setAttribute('aria-label','Fermer les réglages des voix');header.append(copy,close);
    const body=node('div','voice-body');
    const enabled=node('label','voice-enabled'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=state.enabled;checkbox.dataset.voiceFocus='enabled';checkbox.addEventListener('change',()=>{this.getSpeech?.()?.setEnabled(checkbox.checked);this.refresh();});enabled.append(checkbox,node('span','','Entendre les personnages'));body.append(enabled);
    const modes=node('fieldset','voice-modes');modes.append(node('legend','','Comment voulez-vous les entendre ?'));
    for(const [value,label,description] of [['natural','Voix naturelles locales','Un téléchargement explicite, puis la lecture se fait sur cet ordinateur.'],['captions','Sous-titres uniquement','Les répliques restent visibles, sans lecture audio.'],['system','Voix du système','Option facultative. Le rendu et le fonctionnement dépendent de votre navigateur.']]){
      const item=node('label','voice-mode'),radio=node('input');radio.type='radio';radio.name='office-voice-engine';radio.value=value;radio.checked=state.engine===value;radio.dataset.voiceFocus=value;
      radio.addEventListener('change',()=>{this.preview=null;this.pendingInstall=null;this.getSpeech?.()?.setEngine(value);this.signature='';this.refresh();});const content=node('span');content.append(node('strong','',label),node('small','',description));item.append(radio,content);modes.append(item);
    }
    body.append(modes);this.status=node('p','voice-status');this.status.setAttribute('role','status');body.append(this.status);
    this.progress=node('div','voice-progress');this.progress.hidden=true;this.progressBar=node('progress');this.progressBar.max=100;this.progressBar.setAttribute('aria-label','Progression de l’installation de la voix');this.progressLabel=node('span');this.progress.append(this.progressLabel,this.progressBar);body.append(this.progress);
    const local=state.local||{},all=Array.isArray(local.voices)?local.voices:[],locale=state.locale||getLocale();
    if(state.engine!=='captions'){
      const native=state.engine==='system',available=(native?(state.voices||[]):all).filter(voice=>supportsLanguage(voice,locale)&&(native||voice.installed)).sort((a,b)=>Number(Boolean(b.recommended))-Number(Boolean(a.recommended)));
      const choices=node('section','voice-characters');choices.append(node('h3','','Oscar et Zoé peuvent avoir des voix différentes'));
      if(!available.length)choices.append(node('p','voice-empty',native?'Aucune voix du système n’est disponible dans la langue du bureau. Les sous-titres restent affichés.':'Aucune voix naturelle n’est installée dans la langue du bureau. Choisissez une voix compatible ci-dessous.'));
      for(const [role,name] of [['oscar','Oscar'],['zoe','Zoé']]){
        const card=node('section','voice-character'),heading=node('h4','',name),label=node('label','voice-field','Voix du personnage'),select=node('select');select.dataset.voiceFocus=role;
        const auto=node('option','',native?'Automatique':'Automatique · voix recommandée');auto.value='auto';select.append(auto);
        for(const voice of available){const option=node('option','',voice.name||voice.id);option.value=native?voice.name:voice.id;select.append(option);}
        const saved=state.characterVoices?.[role]||'auto',pending=this.pending[role]??saved;select.value=[...select.options].some(option=>option.value===pending)?pending:'auto';this.pending[role]=select.value;select.disabled=!available.length;
        const actions=node('div','voice-character-actions');const listen=this.button('Écouter un extrait','voice-listen',()=>this.previewVoice(role,select.value));listen.disabled=!available.length||local.status==='installing';listen.dataset.voiceFocus=`listen-${role}`;
        const choose=this.button('Choisir cette voix','voice-choose',()=>{this.getSpeech?.()?.setCharacterVoice(role,select.value);this.noticeText='Le choix de voix est enregistré.';this.refresh();});choose.dataset.voiceFocus=`choose-${role}`;
        const chosen=()=>{const id=select.value;choose.disabled=!available.length||id===saved||id!=='auto'&&!this.heard.has(`${state.engine}:${role}:${id}`);};chosen();
        select.addEventListener('change',()=>{this.pending[role]=select.value;this.noticeText='Écoutez un extrait avant de choisir cette voix.';this.notice.textContent=translate(this.noticeText);chosen();});label.append(select);actions.append(listen,choose);card.append(heading,label,actions);choices.append(card);
      }
      body.append(choices);
    }
    if(state.engine==='natural'){
      const recommended=all.filter(voice=>voice.recommended),legacy=all.filter(voice=>!voice.recommended);
      const catalog=node('section','voice-catalog');
      if(recommended.length){
        const pack=node('section','voice-studio-pack');pack.append(node('span','voice-pack-kicker','LE DUO DU BUREAU'),node('h3','','Oscar et Zoé, dans vos trois langues.'),node('p','voice-catalog-note','Un seul téléchargement installe les deux voix en français, anglais et néerlandais. La lecture se fait ensuite sur cet ordinateur.'));
        const grid=node('div','voice-catalog-grid');for(const voice of recommended)grid.append(this.voiceCard(voice,state,{shared:true}));pack.append(grid);
        const descriptor=recommended[0];this.addDownloadDetails(pack,descriptor,true);
        if(recommended.some(voice=>voice.supported===false))pack.append(node('p','voice-language-note',text(local.message)||'Ce pack demande un programme local compatible. Consultez les indications du bureau avant de l’installer.'));
        const missing=recommended.find(voice=>!voice.installed);
        if(missing){const install=this.button('Installer le pack Oscar + Zoé','voice-pack-install',()=>this.requestInstall(missing.id));install.dataset.voiceFocus='install-studio';install.disabled=missing.supported===false||local.status==='installing'||local.status==='unsupported'||this.installBusy;pack.append(install);}
        else pack.append(node('p','voice-pack-ready','Le duo est installé. Écoutez Oscar et Zoé ci-dessus pour choisir leurs voix.'));
        pack.append(node('p','voice-catalog-note','Des voix de synthèse préétablies, sans importer ni cloner votre voix. Aucun texte envoyé à un service vocal externe. Le rendu et la vitesse dépendent de la langue et de cet ordinateur.'));catalog.append(pack);
      }
      if(legacy.length){const details=node('details','voice-legacy');details.open=this.legacyOpen===true;details.addEventListener('toggle',()=>{this.legacyOpen=details.open;});details.append(node('summary','',recommended.length?'Autres voix locales · ancien moteur':'Autres voix locales'));const grid=node('div','voice-catalog-grid');for(const voice of legacy)grid.append(this.voiceCard(voice,state));details.append(node('p','voice-catalog-note','Ces voix plus légères restent facultatives. Leurs langues et leurs licences sont indiquées pour chaque voix.'),grid);catalog.append(details);}
      if(!all.length)catalog.append(node('p','voice-empty','Le catalogue local n’est pas disponible pour le moment. Les sous-titres restent utilisables.'));
      body.append(catalog);
      const selected=all.find(voice=>voice.id===this.pendingInstall&&!voice.installed);
      if(selected){const confirm=node('section','voice-confirm');confirm.setAttribute('aria-label','Confirmer l’installation de la voix');confirm.tabIndex=-1;confirm.append(node('h3','',selected.recommended?'Télécharger le duo Oscar + Zoé ?':'Télécharger cette voix sur cet ordinateur ?'));if(!selected.recommended)confirm.append(node('p','',text(selected.name)||selected.id));this.addDownloadDetails(confirm,selected,Boolean(selected.recommended));confirm.append(node('p','',selected.recommended?'Le moteur, les trois langues et les deux voix seront téléchargés depuis les sources officielles indiquées. Cette installation est commune à Oscar et Zoé. Aucune clé API ni abonnement vocal supplémentaire.':'Le moteur et les fichiers de la voix seront téléchargés depuis les sources indiquées. La lecture utilisera ensuite votre ordinateur. Aucune clé API ni abonnement vocal supplémentaire.'));const actions=node('div','voice-confirm-actions');actions.append(this.button('Confirmer le téléchargement','voice-choose',()=>this.install(selected.id)),this.button('Annuler','voice-secondary',()=>{this.pendingInstall=null;this.signature='';this.refresh();}));body.append(confirm);confirm.append(actions);}
      if(local.licenseNotice)body.append(node('p','voice-license',text(local.licenseNotice)));
    }
    this.notice=node('p','voice-notice',this.noticeText||'');this.notice.setAttribute('role','status');this.error=node('p','voice-error',this.errorText||'');this.error.setAttribute('role','alert');this.error.hidden=!this.errorText;body.append(this.notice,this.error);
    const footer=node('footer','voice-footer');footer.append(this.button('Arrêter la lecture','voice-secondary',()=>{this.preview=null;this.getSpeech?.()?.stop();this.noticeText='Lecture arrêtée.';this.notice.textContent=this.noticeText;}),this.button('Terminé','voice-done',()=>this.close()));
    this.dialog.replaceChildren(header,body,footer);
    if(focused)for(const control of this.dialog.querySelectorAll('[data-voice-focus]'))if(control.dataset.voiceFocus===focused){control.focus({preventScroll:true});break;}
  }
  requestInstall(id){this.pendingInstall=id;this.signature='';this.refresh();this.dialog.querySelector('.voice-confirm')?.focus();}
  stopPreviews(){for(const audio of this.dialog.querySelectorAll('.voice-model-preview')){try{audio.pause();audio.removeAttribute('src');audio.load();}catch{}}}
  addDownloadDetails(container,voice,shared=false){
    const details=node('p','voice-download-size');details.setAttribute('data-no-translate','');const bits=[];
    if(Number.isFinite(voice.downloadMB))bits.push(`${translate(shared?'Téléchargement du pack':'Téléchargement')} : ${new Intl.NumberFormat({fr:'fr-BE',en:'en-GB',nl:'nl-BE'}[getLocale()],{maximumFractionDigits:1}).format(voice.downloadMB)} ${translate('Mo')}`);
    if(Number.isFinite(voice.runtimeDownloadMB))bits.push(`${translate('Programme local si nécessaire')} : ≈ ${new Intl.NumberFormat({fr:'fr-BE',en:'en-GB',nl:'nl-BE'}[getLocale()],{maximumFractionDigits:1}).format(voice.runtimeDownloadMB)} ${translate('Mo')} ${translate('supplémentaires')}`);
    if(Number.isFinite(voice.installationMB))bits.push(`${translate('Espace à prévoir')} : ${new Intl.NumberFormat({fr:'fr-BE',en:'en-GB',nl:'nl-BE'}[getLocale()],{maximumFractionDigits:1}).format(voice.installationMB)} ${translate('Mo')}`);
    if(bits.length){details.textContent=bits.join(' · ');container.append(details);}
  }
  voiceCard(voice,state,{shared=false}={}){
    const card=node('article',`voice-card${shared?' voice-card-recommended':''}`),topline=node('div','voice-card-heading');topline.append(node('h4','',text(voice.name)||voice.id),node('span','voice-badge',voice.installed?'Installée':shared?'Recommandée':'À télécharger'));card.append(topline);
    const details=node('dl','voice-details');const languages=voice.languages||[lang(voice)];const names=languages.map(code=>({fr:'Français',en:'Anglais',nl:'Néerlandais'}[code]||code));
    details.append(node('dt','','Langue'),node('dd','',shared?'Français · Anglais · Néerlandais':names.map(name=>translate(name)).join(' · ')),node('dt','','Licence'),node('dd','',text(voice.license)||'Consultez la fiche de la voix.'));card.append(details);
    const source=safeUrl(voice.source);if(source){const link=node('a','voice-source','Provenance et conditions ↗');link.href=source;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
    if(shared){const url=voice.previewUrls?.[getLocale()],person=voice.id==='studio-oscar'?'oscar':voice.id==='studio-zoe'?'zoe':null;
      if(person&&typeof url==='string'&&new RegExp(`^/voice-preview-${person}-(fr|en|nl)\\.wav$`,'u').test(url)){
        const preview=node('div','voice-before-download');preview.append(node('span','voice-preview-label','Écouter la voix avant de télécharger'));
        const audio=node('audio','voice-model-preview');audio.controls=true;audio.preload='none';audio.src=url;audio.setAttribute('aria-label','Écouter la voix avant de télécharger');audio.addEventListener('play',()=>{this.getSpeech?.()?.stop();for(const other of this.dialog.querySelectorAll('.voice-model-preview'))if(other!==audio)other.pause();});preview.append(audio,node('p','voice-preview-note','Extrait de démonstration généré avec ce modèle. La lecture de vos propres textes nécessite le pack installé.'));card.append(preview);
      }
    }
    if(!shared){this.addDownloadDetails(card,voice);if(!voice.installed){const install=this.button('Installer cette voix','voice-install',()=>this.requestInstall(voice.id));install.disabled=state.local?.status==='installing'||state.local?.status==='unsupported'||this.installBusy;install.dataset.voiceFocus=`install-${voice.id}`;card.append(install);}else if(!supportsLanguage(voice,state.locale||getLocale()))card.append(node('p','voice-language-note','Cette voix sera disponible quand le bureau utilisera sa langue.'));}
    return card;
  }
  refresh(){
    if(this.destroyed||!this.dialog.open)return;const state=this.state(),local=state.local||{};
    if(this.preview){if(state.speaking&&state.role===this.preview.role){this.heard.add(this.preview.key);this.noticeText='L’extrait est en cours de lecture. Vous pouvez choisir cette voix.';this.preview=null;this.signature='';}else if(Date.now()-this.preview.at>125000||Date.now()-this.preview.at>1000&&!state.preparing&&!state.speaking){this.preview=null;this.errorText='La lecture audio n’a pas démarré. Les sous-titres restent disponibles.';}}
    const signature=JSON.stringify([state.engine,state.enabled,state.locale,state.characterVoices,local.status,local.voices,state.engine==='system'?state.voices.map(voice=>[voice.name,voice.lang]):null,this.pendingInstall,this.installBusy,this.errorText]);
    if(signature!==this.signature){this.signature=signature;this.render(state);}
    this.status.textContent=translate(this.statusMessage(state));
    if(this.noticeText)this.notice.textContent=translate(this.noticeText);
    if(local.status==='failed'||local.status==='unsupported'){this.error.textContent=translate(text(local.message)||'Le service de voix locales n’est pas disponible.');this.error.hidden=false;}
    const progress=local.progress;this.progress.hidden=local.status!=='installing';
    if(!this.progress.hidden){this.progressLabel.textContent=translate({runtime:'Installation du moteur local…',download:'Téléchargement de la voix…',extract:'Préparation des fichiers…',verify:'Vérification de l’installation…'}[progress?.phase]||'Installation en cours…');if(Number.isFinite(progress?.percent))this.progressBar.value=Math.max(0,Math.min(100,progress.percent));else this.progressBar.removeAttribute('value');}
  }
  previewVoice(role,id){
    const speech=this.getSpeech?.();if(!speech)return;this.errorText='';this.noticeText='Préparation de l’extrait…';speech.setEnabled(true);
    const requested=speech.speak(role,translate(EXAMPLES[role]),{interrupt:true,...(id!=='auto'?{voiceId:id}:{})});
    if(requested)this.preview={role,key:`${this.state().engine}:${role}:${id}`,at:Date.now()};else{this.preview=null;this.errorText='La lecture audio n’a pas démarré. Les sous-titres restent disponibles.';}
    this.signature='';this.refresh();
  }
  async install(id){
    if(this.installBusy)return;const epoch=this.epoch;this.installBusy=true;this.errorText='';this.pendingInstall=null;this.signature='';this.refresh();
    try{await this.getSpeech?.()?.installVoice(id,{confirmed:true});if(epoch===this.epoch){this.noticeText='Installation demandée. Les sous-titres restent disponibles pendant le téléchargement.';}}
    catch(error){if(epoch===this.epoch)this.errorText=text(error.message)||'L’installation de la voix n’a pas abouti.';}
    finally{this.installBusy=false;if(epoch===this.epoch){this.signature='';this.refresh();}}
  }
  async open(){
    if(this.destroyed||this.dialog.open)return;this.returnFocus=document.activeElement;this.notified=false;this.epoch++;this.signature='';this.errorText='';this.noticeText='';this.dialog.showModal();this.refresh();this.dialog.querySelector('h2')?.focus({preventScroll:true});
    const epoch=this.epoch;await this.getSpeech?.()?.refreshLocal?.();if(epoch!==this.epoch||!this.dialog.open)return;this.refresh();this.lastLocalRefresh=Date.now();
    this.timer=setInterval(()=>{this.refresh();if(this.state().local?.status==='installing'&&Date.now()-this.lastLocalRefresh>2000){this.lastLocalRefresh=Date.now();this.getSpeech?.()?.refreshLocal?.().then(()=>this.refresh()).catch(()=>{});}},250);
  }
  closed(){if(this.notified)return;this.notified=true;this.epoch++;clearInterval(this.timer);this.timer=null;this.preview=null;this.pendingInstall=null;this.stopPreviews();this.getSpeech?.()?.stop();if(!this.destroyed){if(this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});this.onClose();}}
  close(){if(this.dialog.open){this.dialog.close();this.closed();}}
  destroy(){this.destroyed=true;clearInterval(this.timer);this.close();document.removeEventListener('oscar:language',this.languageChanged);this.dialog.remove();}
}
