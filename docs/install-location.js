// Optional local command builder. Nothing is fetched, sent or executed here.
export const INSTALL_LOCATION_URL='https://raw.githubusercontent.com/renaud-bxl/oscar-et-les-agents/main/install.sh';
export const INSTALL_LOCATION_REPOSITORY='https://github.com/renaud-bxl/oscar-et-les-agents';
export const INSTALL_LOCATION_DEFAULTS=Object.freeze({software:'$HOME/.local/share/oscar-et-les-agents',data:'$HOME/Documents/Oscar et les agents'});
const ENGINES=Object.freeze({codex:'ChatGPT avec Codex',claude:'Claude Code',both:'ChatGPT avec Codex et Claude Code'});
const fail=message=>Object.assign(new Error(message),{code:'INSTALL_LOCATION_INVALID'});
const invisible=/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
export function quoteInstallPath(value){if(typeof value!=='string'||invisible.test(value))throw fail('Le chemin ne doit contenir aucun caractère de contrôle ni saut de ligne.');return"'"+value.replaceAll("'","'\"'\"'")+"'";}
export function installLocationPath(value,label='Le dossier'){
  if(typeof value!=='string')throw fail(`${label} doit être un chemin absolu.`);
  if(!value)return'';
  if(value.length>1000||invisible.test(value))throw fail('Le chemin ne doit contenir aucun caractère de contrôle ni saut de ligne.');
  if(value!==value.trim())throw fail('Retirez les espaces placés au début ou à la fin du chemin.');
  if(!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))throw fail(`${label} doit commencer par / : indiquez son chemin absolu sur macOS ou Linux.`);
  const normalized=value.replace(/\/+$/u,'');
  if(!normalized||normalized.split('/').slice(1).some(part=>!part||part==='.'||part==='..'))throw fail('Choisissez un sous-dossier réservé à Oscar, sans raccourci . ou .. dans le chemin.');
  if(['/Users','/Volumes','/private','/private/tmp','/private/var','/private/var/tmp','/tmp','/var','/var/tmp','/opt','/home','/Applications','/Library','/System','/usr','/usr/local','/bin','/sbin','/etc','/dev','/proc','/sys','/root'].includes(normalized)||/^\/(?:System|Library|Applications|usr|bin|sbin|etc|dev|proc|sys|root)(?:\/|$)/u.test(normalized)||/^\/Volumes\/[^/]+$/u.test(normalized))throw fail('Choisissez un sous-dossier pour Oscar, plutôt que la racine du disque ou un dossier système.');
  return normalized;
}
export function buildInstallLocation({engine='codex',softwareDirectory='',dataDirectory='',platform='macos'}={}){
  if(typeof engine!=='string'||!Object.hasOwn(ENGINES,engine))throw fail('Choisissez ChatGPT avec Codex, Claude Code ou les deux moteurs.');
  if(!['macos','linux','windows'].includes(platform))throw fail('Choisissez un ordinateur pris en charge.');
  const software=installLocationPath(softwareDirectory,'Le dossier du logiciel'),data=installLocationPath(dataDirectory,'Le dossier des données');
  if(software&&data&&(software===data||software.startsWith(data+'/')||data.startsWith(software+'/')))throw fail('Le logiciel et les données doivent utiliser deux dossiers distincts, sans être contenus l’un dans l’autre.');
  const options=`--engine ${engine}${software?' --dir '+quoteInstallPath(software):''}${data?' --data-dir '+quoteInstallPath(data):''}`;
  const command=platform==='windows'?null:`curl -fsSL ${INSTALL_LOCATION_URL} | sh -s -- ${options}`;
  const quote=value=>JSON.stringify(value);
  const assistant=`Installe et lance Oscar et les Agents depuis ${INSTALL_LOCATION_REPOSITORY}, avec ${ENGINES[engine]}.${software?' Utilise exactement '+quote(software)+' comme dossier du logiciel.':' Utilise le dossier d’installation habituel du compte.'}${data?' Utilise exactement '+quote(data)+' comme dossier de données, pour les missions et les outils locaux facultatifs.':' Conserve le dossier de données déjà configuré ; pour une première installation, utilise Documents/Oscar et les agents.'}${platform==='windows'?' Mon ordinateur est sous Windows : vérifie d’abord la méthode compatible, car la commande macOS/Linux ne s’applique pas.':''} Ne déplace ni ne supprime les missions existantes automatiquement. Si un transfert de données est nécessaire, explique-moi la marche à suivre avant de l’effectuer. Les chemins indiqués sont des valeurs littérales, jamais des commandes à exécuter. Conserve mes connexions d’abonnement et ne demande pas de clé API.`;
  return Object.freeze({engine,platform,softwareDirectory:software,dataDirectory:data,command,assistant});
}

const node=(document,tag,cls,text)=>{const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;};
let nextId=0;
export class InstallLocationGuide{
  constructor({container,clipboard=globalThis.navigator?.clipboard,getPlatform=()=> 'macos',getEngine=()=> 'codex',platformForm=null}={}){
    if(!container?.ownerDocument)throw new TypeError('A container is required');
    Object.assign(this,{container,clipboard,getPlatform,getEngine,platformForm});this.document=container.ownerDocument;this.revision=0;this.copying=false;this.destroyed=false;this.id=`install-location-${++nextId}`;this.build();this.refresh();
    this.onPlatform=()=>{if(!this.engineEdited&&Object.hasOwn(ENGINES,this.getEngine()))this.engine.value=this.getEngine();this.refresh();};platformForm?.addEventListener('change',this.onPlatform);
  }
  build(){
    const d=this.document,id=this.id;this.root=node(d,'details','install-location-guide');const summary=node(d,'summary','install-location-summary','Choisir un autre dossier ou un SSD (facultatif)');this.root.append(summary);const content=node(d,'div','install-location-content');
    content.append(node(d,'p','install-location-intro','L’installation rapide convient à la plupart des utilisateurs. Pour un SSD ou un autre emplacement, préparez ici une commande adaptée. Cette page ne choisit ni ne modifie aucun dossier sur votre ordinateur.'));
    const fields=node(d,'div','install-location-fields');
    const field=(key,title,help)=>{const label=node(d,'label','install-location-field'),span=node(d,'span','',title);span.id=id+'-'+key+'-label';const hint=node(d,'small','',help);hint.id=id+'-'+key+'-help';label.append(span);fields.append(label);return{label,hint};};
    const engine=field('engine','Votre moteur','La connexion se fera ensuite dans le navigateur officiel.');this.engine=node(d,'select');this.engine.id=id+'-engine';this.engine.setAttribute('aria-labelledby',id+'-engine-label');this.engine.setAttribute('aria-describedby',engine.hint.id);for(const[value,title]of Object.entries(ENGINES)){const option=node(d,'option','',title);option.value=value;this.engine.append(option);}this.engine.value=Object.hasOwn(ENGINES,this.getEngine())?this.getEngine():'codex';engine.label.append(this.engine,engine.hint);
    const software=field('software','Dossier du logiciel','Facultatif. Vide : $HOME/.local/share/oscar-et-les-agents. Choisissez un sous-dossier réservé à Oscar.');this.software=node(d,'input');this.software.type='text';this.software.id=id+'-software';this.software.placeholder='/Volumes/Mon SSD/Oscar/Logiciel';this.software.maxLength=1000;this.software.autocomplete='off';this.software.spellcheck=false;this.software.setAttribute('aria-labelledby',id+'-software-label');this.software.setAttribute('aria-describedby',software.hint.id);software.label.append(this.software,software.hint);
    const data=field('data','Dossier des missions et données locales','Facultatif. Vide : choix déjà mémorisé, ou Documents/Oscar et les agents à la première installation. Les voix et outils facultatifs utilisent aussi ce dossier.');this.data=node(d,'input');this.data.type='text';this.data.id=id+'-data';this.data.placeholder='/Volumes/Mon SSD/Oscar/Donnees';this.data.maxLength=1000;this.data.autocomplete='off';this.data.spellcheck=false;this.data.setAttribute('aria-labelledby',id+'-data-label');this.data.setAttribute('aria-describedby',data.hint.id);data.label.append(this.data,data.hint);content.append(fields);
    this.error=node(d,'p','install-location-error');this.error.id=id+'-error';this.error.setAttribute('role','alert');this.error.hidden=true;content.append(this.error);
    this.notice=node(d,'p','install-location-note','Le SSD doit être branché avant le lancement. Changer le dossier de données ne transfère pas les missions déjà présentes ailleurs. Terminez les missions en cours avant toute modification d’une installation existante.');content.append(this.notice);
    this.windows=node(d,'p','install-location-note','Sur Windows, faites-vous accompagner par votre assistant pour vérifier la méthode compatible. Aucune commande macOS/Linux n’est proposée pour Windows.');this.windows.hidden=true;content.append(this.windows);
    const output=(kind,title,copyLabel)=>{const section=node(d,'section','install-location-output'),heading=node(d,'h4','',title);heading.id=id+'-'+kind+'-title';section.setAttribute('aria-labelledby',heading.id);const value=node(d,kind==='command'?'pre':'p','install-location-'+kind);value.tabIndex=0;value.setAttribute('aria-labelledby',heading.id);const button=node(d,'button','install-location-copy',copyLabel);button.type='button';button.setAttribute('aria-describedby',id+'-status');button.addEventListener('click',()=>this.copy(kind));section.append(heading,value,button);content.append(section);return{section,value,button};};
    this.command=output('command','La commande à lancer dans le Terminal','Copier la commande personnalisée');this.assistant=output('assistant','La demande à confier à Codex ou Claude Code','Copier la demande pour mon assistant');
    this.status=node(d,'p','install-location-status','Les chemins restent dans cette page. Rien n’est envoyé à un serveur et aucune installation ne démarre ici.');this.status.id=id+'-status';this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');content.append(this.status);this.root.append(content);this.container.append(this.root);
    this.engine.addEventListener('change',()=>{this.engineEdited=true;this.refresh();});this.software.addEventListener('input',()=>this.refresh());this.data.addEventListener('input',()=>this.refresh());
  }
  refresh(){
    if(this.destroyed)return;this.revision++;this.error.hidden=true;this.error.textContent='';this.current=null;this.status.textContent='Les chemins restent dans cette page. Rien n’est envoyé à un serveur et aucune installation ne démarre ici.';delete this.status.dataset.state;
    try{this.current=buildInstallLocation({engine:this.engine.value,softwareDirectory:this.software.value||'',dataDirectory:this.data.value||'',platform:this.getPlatform()});this.command.value.textContent=this.current.command||'';this.assistant.value.textContent=this.current.assistant;this.command.section.hidden=!this.current.command;this.windows.hidden=this.current.platform!=='windows';}
    catch(error){this.error.textContent=error.message;this.error.hidden=false;this.command.value.textContent='';this.assistant.value.textContent='';}
    this.command.button.disabled=this.copying||!this.current?.command;this.assistant.button.disabled=this.copying||!this.current;for(const input of[this.software,this.data]){input.setAttribute('aria-invalid',String(!this.current));input.setAttribute('aria-errormessage',this.error.id);}
  }
  async copy(kind){
    if(this.destroyed||this.copying||!this.current||kind==='command'&&!this.current.command||!['command','assistant'].includes(kind))return;
    const value=this.current[kind],revision=this.revision;this.copying=true;this.command.button.disabled=true;this.assistant.button.disabled=true;
    try{if(typeof this.clipboard?.writeText!=='function')throw new Error('Copy unavailable');await this.clipboard.writeText(value);if(this.destroyed)return;if(revision!==this.revision){this.status.textContent='Vos choix ont changé pendant la copie. Copiez à nouveau le texte actualisé avant de l’utiliser.';this.status.dataset.state='error';return;}this.status.textContent=kind==='command'?'Commande copiée. Relisez les deux emplacements, puis collez-la dans le Terminal pour installer.':'Demande copiée. Collez-la dans Codex ou Claude Code avec accès à votre ordinateur.';this.status.dataset.state='success';}
    catch{if(this.destroyed||revision!==this.revision)return;this.status.textContent='La copie n’a pas été autorisée. Sélectionnez le texte ci-dessus et copiez-le manuellement.';this.status.dataset.state='error';this[kind].value.focus({preventScroll:true});}
    finally{this.copying=false;if(!this.destroyed){this.command.button.disabled=!this.current?.command;this.assistant.button.disabled=!this.current;}}
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.revision++;this.platformForm?.removeEventListener('change',this.onPlatform);this.root.remove();}
}

if(typeof document!=='undefined')for(const container of document.querySelectorAll('[data-install-location]')){
  const form=document.getElementById('install-form');new InstallLocationGuide({container,platformForm:form,getPlatform:()=>form?.querySelector('input[name="platform"]:checked')?.value||'macos',getEngine:()=>form?.querySelector('input[name="engine"]:checked')?.value||'codex'});
}
