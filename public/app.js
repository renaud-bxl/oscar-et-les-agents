import { CoffeeDialog } from '/coffee-dialog.js';
import { PixelWorld } from '/pixel-world.js';
import { MISSION_TEMPLATES, MISSION_CATEGORIES, MissionWizard } from '/mission-catalog.js';
import { WelcomeGuide, withTeamPreference } from '/welcome-guide.js';
import { startI18n, withLocaleInstruction, translate, getLocale, setLocale } from '/i18n.js';
import { PublicationDialog } from '/publication-dialog.js';
import { OfficeSpeech } from '/office-speech.js';
import { ClockDialog } from '/clock-dialog.js';
import { CreativeStudio } from '/creative-studio.js';
import { ConnectorsDialog } from '/connectors-dialog.js';
import { AutomationsDialog } from '/automations-dialog.js';
import { ArtifactViewer } from '/artifact-viewer.js';
import { CompletionDialog } from '/completion-dialog.js';
import { SecretaryDialog } from '/secretary-dialog.js';
import { VoiceDialog } from '/voice-dialog.js';
import { DocumentLibraryDialog } from '/document-library.js';
import { PersonalizationDialog } from '/personalization-dialog.js';
import { CharacterLines } from '/character-lines.js';
import { DictationDialog } from '/dictation-dialog.js';
import { DraftStorage, draftScope } from '/draft-storage.js';
'use strict';

const $ = (id) => document.getElementById(id);
const roleInfo = {
  secretaire: {name:'Zoé',label:'Secrétariat',initial:'Z',intro:'Zoé prépare vos e-mails, votre agenda et vos priorités avec les services que vous avez connectés.'},
  oscar: {name: 'Oscar', label: 'Chef d’équipe', initial: 'O', intro: 'Oscar transforme votre idée en plan de travail, confie chaque tâche au bon spécialiste, puis vérifie et assemble les résultats.'},
  recherche: {name: 'Lina', label: 'Recherche', initial: 'L', intro: 'Lina explore le sujet, recoupe les informations et rassemble des sources utiles à votre projet.'},
  redaction: {name: 'Noé', label: 'Rédaction', initial: 'N', intro: 'Noé trouve les mots justes et donne une structure claire aux contenus de votre mission.'},
  code: {name: 'Sam', label: 'Développement & code', initial: 'S', intro: 'Sam construit et vérifie le code, les outils et les pages qui donnent vie à votre projet.'},
  design: {name: 'Alma', label: 'Design', initial: 'A', intro: 'Alma travaille la forme, les idées visuelles et la lisibilité de vos créations.'},
  analyse: {name: 'Jules', label: 'Analyse', initial: 'J', intro: 'Jules organise les données, évalue les options et fait ressortir ce qui aide à décider.'}
};
const missionStatus = {planning:'Oscar prépare le plan',running:'L’équipe est au travail',reviewing:'Oscar vérifie les résultats',completed:'Mission livrée',needs_review:'Votre attention est nécessaire',failed:'La mission a rencontré un problème',cancelled:'Mission arrêtée'};
const taskStatus = {queued:'À venir',working:'En cours',reviewing:'Vérification',revising:'À améliorer',approved:'Validé',needs_review:'À vérifier',failed:'Interrompu',cancelled:'Arrêté'};
const ROLE_DETAILS={
  oscar:['Il découpe votre objectif en tâches, choisit les métiers et recrute les spécialistes utiles.','Un plan de travail, des retours sur chaque tâche et une livraison assemblée.','La cohérence du projet, les fichiers attendus et les points qui demandent votre attention.'],
  recherche:['L’équipe recherche des informations, compare les sources et prépare des dossiers thématiques ou parlementaires.','Des sources citées, une chronologie, des références officielles et des synthèses documentées.','Les dates, les liens, la distinction entre faits et interprétations et les limites de la recherche.'],
  redaction:['Les écrivains et rédacteurs structurent vos idées et adaptent le ton au public : livres, articles, discours ou réseaux sociaux.','Un plan éditorial, des chapitres, des textes révisés ou un calendrier de contenus.','La clarté, la structure, le respect du brief et les faits qui doivent être sourcés.'],
  code:['Les développeurs construisent des sites, des jeux, des logiciels et des outils. Ils travaillent le fonctionnement et expliquent leurs vérifications.','Du code, des fichiers utilisables, des tests adaptés et un mode d’emploi.','Les fichiers livrés, les erreurs rencontrées, les tests exécutés et ce qui reste à vérifier.'],
  design:['Les designers cherchent une direction visuelle, dessinent les interfaces et organisent les éléments pour rendre le projet agréable à utiliser.','Des maquettes, des palettes, des interfaces HTML/CSS/SVG et des éléments graphiques.','La lisibilité, les contrastes, la cohérence visuelle et l’adaptation aux écrans.'],
  analyse:['Les analystes organisent les données, calculent, comparent les options et font ressortir les éléments utiles à une décision.','Des tableaux, des comparatifs, des indicateurs et des conclusions argumentées.','Les hypothèses, les unités, les calculs et la différence entre une mesure et une estimation.'],
};
const runningStatuses = new Set(['planning','running','reviewing']);
let state = {providers:[], missions:[], active:null};
let initialBuildId = null;
const routeParams = new URLSearchParams(location.search);
let selectedId = /^[a-zA-Z0-9-]+$/.test(routeParams.get('mission') || '') ? routeParams.get('mission') : null;
let pendingTemplate = routeParams.get('template');
let pendingReuse = /^[a-zA-Z0-9-]{1,100}$/u.test(routeParams.get('reuse')||'')?routeParams.get('reuse'):null;
let reuseLoading = false;
let mission = null;
let creating = false;
let browsingNew = routeParams.has('new');
let eventSource = null;
let refreshSequence = 0;
let lastAnnouncement = '';
let openedRole = null;
let openedTaskId = null;
let catalogCategory = 'all';
let historyFilter = 'all';
let lastMissionSignature = '';
let fetchErrorCount = 0;
let providerInitialized = false;
let pixelWorld = null;
let animationPaused = false;
let missionWizard = null;
let coffeeDialog = null;
let welcomeGuide = null;
let publicationDialog = null;
let officeSpeech = null;
let clockDialog = null;
let creativeStudio = null;
let connectorsDialog = null;
let automationsDialog = null;
let artifactViewer = null;
let completionDialog = null;
let secretaryDialog = null;
let voiceDialog = null;
let documentLibrary = null;
let personalizationDialog = null;
let dictationDialog = null;
let dictationReturnPanel = null;
let personalContext = {profile:{},weather:{status:'disabled'}};
let weatherTimer = null;
let archiveDownload = null;
const utilityReturns = new Map();
function openUtility(dialog){utilityReturns.set(dialog,{panel:activePanel,focus:document.activeElement});closeOfficePanel({restoreFocus:false});return dialog.open();}
function returnFromUtility(dialog){const previous=utilityReturns.get(dialog);utilityReturns.delete(dialog);if(previous?.panel){openPanel(previous.panel,{focus:false});if(previous.focus?.isConnected)previous.focus.focus({preventScroll:true});}}
const briefDrafts = new DraftStorage();
let pendingBriefRequest = null;
let pendingStudioRequest = null;
function saveBriefDraft(){const saved=briefDrafts.write('oscar',{text:$('mission-input').value,provider:$('provider-select').value,teamSize:$('team-size').value,...(pendingBriefRequest?.hash?{requestId:pendingBriefRequest.id,requestHash:pendingBriefRequest.hash}:{})});$('brief-draft-note').textContent=translate(saved?'Votre texte est gardé 7 jours sur cet ordinateur, sans envoi automatique.':'Votre navigateur ne peut pas conserver ce brouillon. Gardez cette fenêtre ouverte.');}
function restoreBriefDraft(){const draft=briefDrafts.read('oscar');$('mission-input').value=draft?.text||'';if(draft?.provider&&['codex','claude'].includes(draft.provider)){$('provider-select').value=draft.provider;providerInitialized=true;}if(draft?.teamSize)$('team-size').value=draft.teamSize;pendingBriefRequest=draft?.requestId&&draft?.requestHash?{id:draft.requestId,hash:draft.requestHash}:null;$('brief-draft-note').textContent=translate(draft?.text?'Brouillon retrouvé sur cet ordinateur. Il n’a pas été envoyé.':'Votre texte est gardé 7 jours sur cet ordinateur, sans envoi automatique.');}
function switchBriefDraft(){saveBriefDraft();briefDrafts.scope=draftScope();restoreBriefDraft();}
async function launchRequestIdentity(intent,{studio=false}={}){const signature=JSON.stringify(intent);let hash=null;try{hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature))),byte=>byte.toString(16).padStart(2,'0')).join('');}catch{}let record=studio?pendingStudioRequest:pendingBriefRequest;if(record){if(hash?record.hash===hash:record.signature===signature)return record.id;if(studio)throw new Error(translate('Cette mission a changé depuis sa première validation. Lancez une nouvelle mission pour poursuivre.'));}record={id:globalThis.crypto?.randomUUID?.()||`request_${Date.now()}_${Math.random().toString(36).slice(2)}`,hash,signature};if(studio)pendingStudioRequest=record;else{pendingBriefRequest=record;saveBriefDraft();}return record.id;}
const characterLines = new CharacterLines();
function characterLine(role){return characterLines.next(role,{locale:getLocale(),firstName:personalContext.profile?.name,now:new Date(),weather:personalContext.weather});}
function acceptPersonalContext(value){personalContext=value;clearTimeout(weatherTimer);if(value.profile?.weatherEnabled){const next=Number(value.weather?.expiresAt)||Date.now()+30*60000;weatherTimer=setTimeout(refreshPersonalWeather,Math.max(30*60000,next-Date.now()+1000));}}
async function refreshPersonalWeather(){if(!personalContext.profile?.weatherEnabled)return;if(document.hidden){weatherTimer=setTimeout(refreshPersonalWeather,30*60000);return;}try{acceptPersonalContext(await request('/api/profile/weather'));}catch{weatherTimer=setTimeout(refreshPersonalWeather,30*60000);}}
function openSecretary(mode,spokenLine,connection){closeOfficePanel({restoreFocus:false});secretaryDialog?.open();if(mode&&['mail','calendar','free','service'].includes(mode))secretaryDialog?.choose(mode);if(connection)secretaryDialog?.selectService(connection);officeSpeech?.speak('secretaire',spokenLine||characterLine('zoe'));}
function dictateInto(target){dictationReturnPanel=activePanel;closeOfficePanel({restoreFocus:false});dictationDialog?.open({initialText:target?.value||'',onText:text=>{if(!target)throw new Error(translate('Choisissez une demande avant de dicter.'));if(text.length>target.maxLength&&target.maxLength>0)throw new Error(translate('Le texte dicté est trop long pour cette demande.'));target.value=text;target.dispatchEvent(new Event('input',{bubbles:true}));}});}
const completionStatuses = new Map(),pendingCompletions = new Map();
let completionTimer = null;
let lastNarrated = null;
let statusTimer = null;
let activePanel = null;
let panelReturnFocus = null;
let memberReturnPanel = null;
let wizardReturnPanel = null;
let lastMemberSignature = '';
let onboardingDismissed = false;
try { onboardingDismissed = sessionStorage.getItem('oscar-welcome-dismissed') === '1'; } catch {}
let openedQuip = "";
const QUIPS = {oscar:["J’ai un plan. Le café, c’est le plan B.","Je recrute les talents. Je garde les biscuits."],recherche:["J’ai recoupé mes sources. Même celle du café.","Le premier lien était un chat. J’ai poursuivi l’enquête."],redaction:["Je pose une virgule et j’arrive.","Un café, deux adjectifs. Pas l’inverse."],code:["Chez moi, ça marche. Chez toi, je vais vérifier.","Le bug était entre la chaise et la cafetière."],design:["Encore deux pixels à gauche… parfait.","Le café manque un peu de contraste."],analyse:["Je compte les cafés. Pour la science.","Selon mon tableau, il est l’heure de faire un tableau."]};

function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined && value !== null) el.textContent = String(value);
  return el;
}
const PANEL_LABELS = {catalog:['Les missions',`${MISSION_TEMPLATES.length} points de départ pour vos idées`],brief:['Parlez à Oscar','Votre prochaine mission'],team:['Votre équipe','Les talents de cette mission'],delivery:['Votre livraison','Fichiers et comptes rendus'],progress:['Le suivi du projet','Du brief à la livraison'],history:['Mes missions','Jusqu’à quatre bureaux en même temps'],settings:['Les réglages','Votre connexion et votre bureau']};
function restorePanel() {
  const content=$('office-panel-body').firstElementChild;
  if(content) $('office-panel-storage').append(content);
  activePanel=null;
  document.querySelectorAll('[data-open-panel]').forEach(button=>button.setAttribute('aria-expanded','false'));
}
function closeOfficePanel({restoreFocus=true}={}) {
  if($('office-panel').open) $('office-panel').close();
  restorePanel();
  if(restoreFocus&&panelReturnFocus?.isConnected) panelReturnFocus.focus({preventScroll:true});
}
function openPanel(name,{focus=true}={}) {
  const content=document.querySelector(`[data-panel-section="${name}"]`);
  if(!content || !PANEL_LABELS[name]) return;
  if(!$('office-panel').open) panelReturnFocus=document.activeElement;
  if(content.parentElement!==$('office-panel-body')) {restorePanel();$('office-panel-body').append(content);}
  activePanel=name;$('office-panel').dataset.panel=name;
  $('office-panel-title').textContent=PANEL_LABELS[name][0];$('office-panel-kicker').textContent=PANEL_LABELS[name][1];
  $('panel-error').textContent=$('global-error').textContent;$('panel-error').hidden=$('global-error').hidden;
  if(!$('office-panel').open) $('office-panel').showModal();
  document.querySelectorAll('[data-open-panel]').forEach(button=>button.setAttribute('aria-expanded',String(button.dataset.openPanel===name)));
  if(focus) {const target=name==='catalog'?$('template-search'):name==='brief'?$('mission-input'):name==='settings'?$('provider-select'):$('close-office-panel');target.focus({preventScroll:true});}
}
function closeMemberForNavigation() {memberReturnPanel=null;if($('member-dialog').open)$('member-dialog').close();openedRole=null;openedTaskId=null;lastMemberSignature='';}
function dismissWelcome() {onboardingDismissed=true;$('office-onboarding').hidden=true;try{sessionStorage.setItem('oscar-welcome-dismissed','1');}catch{}}
function rememberFocus(container) {
  const target=document.activeElement?.closest('[data-task],[data-mission]');
  const key=target&&container.contains(target)?{task:target.dataset.task,mission:target.dataset.mission}:null;
  return ()=>{if(!key)return;const attribute=key.task?'data-task':'data-mission',value=key.task||key.mission;container.querySelector(`[${attribute}="${CSS.escape(value)}"]`)?.focus({preventScroll:true});};
}
function roleOf(value) {
  const key = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(key==='zoe')return 'secretaire';
  if (roleInfo[key]) return key;
  if (/recherch|research/.test(key)) return 'recherche';
  if (/redac|writ/.test(key)) return 'redaction';
  if (/code|develop/.test(key)) return 'code';
  if (/design/.test(key)) return 'design';
  if (/analy/.test(key)) return 'analyse';
  if (/oscar|chef|lead/.test(key)) return 'oscar';
  return key;
}
function getRole(value) { return roleInfo[roleOf(value)] || {name:String(value || 'Équipe'),label:'Spécialiste',initial:'·'}; }
const agentPools = {recherche:['Lina','Camille','Nora','Iris'],redaction:['Noé','Hugo','Inès','Lou'],code:['Sam','Alex','Théo','Rémi'],design:['Alma','Maya','Jade','Rose'],analyse:['Jules','Léon','Éva','Nils']};
function agentName(task) {
  if(task.agentName) return task.agentName;
  const peers=(mission?.tasks || []).filter(t=>t.role===task.role);
  return agentPools[task.role]?.[Math.max(0,peers.findIndex(t=>t.id===task.id))] || getRole(task.role).name;
}
function portrait(role,index=0) {
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 56 56');svg.setAttribute('aria-hidden','true');
  const tones=['#edbd9a','#d8a07c','#efc7a7','#bc8c6b'];
  const shirts={oscar:'#6e9780',recherche:'#d8a18c',redaction:'#91aebd',code:'#d6bd87',design:'#9ebca9',analyse:'#b4a9c6'};
  const hair=['#634f43','#9c7257','#3c4845','#7f6254'][index%4];
  const shape=(tag,attrs)=>{const s=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))s.setAttribute(k,String(v));svg.append(s);return s;};
  shape('circle',{cx:28,cy:28,r:28,fill:role==='oscar'?'#e7edf5':'#f1f1f4'});
  shape('path',{d:'M9 56 Q9 35 28 35 Q47 35 47 56Z',fill:shirts[role]||'#6b94c0'});
  shape('rect',{x:24,y:32,width:8,height:9,rx:3,fill:tones[index%4]});
  shape('ellipse',{cx:28,cy:24,rx:13,ry:15,fill:tones[index%4]});
  if(index%4===1)shape('circle',{cx:16,cy:12,r:7,fill:hair});
  shape('path',{d:index%2?'M15 25 Q9 7 28 7 Q45 6 42 25 L38 19 Q27 22 22 15Z':'M15 23 Q11 7 28 7 Q44 7 41 22 Q35 12 28 15 Q23 19 15 19Z',fill:hair});
  for(const cx of [23,33])shape('circle',{cx,cy:25,r:1.35,fill:'#303a48'});
  shape('path',{d:'M24 31 Q28 34 32 30',fill:'none',stroke:'#864e46','stroke-width':1.5,'stroke-linecap':'round'});
  if(role!=='oscar'&&index%4===0){for(const x of [18,29])shape('rect',{x,y:21,width:9,height:8,rx:3,fill:'none',stroke:'#465263','stroke-width':1.4});shape('path',{d:'M27 24H29',stroke:'#465263','stroke-width':1.4});}
  if(index%4===2)shape('path',{d:'M17 31 Q28 43 39 31 Q28 37 17 31Z',fill:hair,opacity:.6});
  if(role==='code'&&index%2===1){shape('rect',{x:14,y:9,width:28,height:8,rx:5,fill:'#829b94'});shape('rect',{x:12,y:15,width:33,height:3,rx:1.5,fill:'#6e8880'});}
  if(role==='design'&&index%2===1)shape('rect',{x:34,y:14,width:7,height:3,rx:1.5,fill:'#d5a28f'});
  if(role==='oscar')shape('path',{d:'M24 38L32 38L29 43L31 51L26 51L27 43Z',fill:'#e7d4ad'});
  return svg;
}
function providerName(id) { return id === 'demo' ? 'Démonstration sans IA' : state.providers.find(p => p.id === id)?.name || (id === 'claude' ? 'Claude' : id === 'codex' ? 'Codex' : 'Moteur local'); }
function isRunning(value) { return !!value && runningStatuses.has(value.status); }
function activeMissions(){return (Array.isArray(state.activeMissions)?state.activeMissions:state.active?[state.active]:[]).filter(isRunning);}
function openAnotherOffice(templateId){if(activeMissions().length>=4){showError('Quatre missions sont déjà en cours. Attendez une livraison avant d’ouvrir une autre équipe.');return;}closeOfficePanel({restoreFocus:false});showError('');const url=new URL(location.href);url.search='';url.searchParams.set('new','1');if(templateId)url.searchParams.set('template',templateId);window.open(url.href,'_blank','noopener');}
async function loadReusableBrief(id){
  reuseLoading=true;
  try{
    const source=await request(`/api/missions/${encodeURIComponent(id)}`);if(source.assistant)throw new Error(translate('Cette demande appartient à Zoé. Retrouvez-la dans son historique.'));
    let prompt=String(source.prompt||'').replace(/\n\nLangue demandée pour cette mission : (?:français|anglais \(English\)|néerlandais \(Nederlands\))\. Rédige le titre, le plan, les tâches, les comptes rendus, les retours d’Oscar, la livraison finale et les textes visibles des fichiers créés dans cette langue\. Conserve les noms propres et les chemins techniques nécessaires\.$/u,'');
    let size='auto';for(const value of ['4','8','12','15','20']){const suffix=withTeamPreference('',value);if(prompt.endsWith(suffix)){prompt=prompt.slice(0,-suffix.length);size=value;break;}}
    $('mission-input').value=prompt;$('team-size').value=size;
    if(['codex','claude'].includes(source.provider))$('provider-select').value=source.provider;
    saveBriefDraft();updateForm();const selection=await documentLibrary?.applyMissionSelection(source);
    const url=new URL(location.href);url.searchParams.delete('reuse');history.replaceState(null,'',url.href);
    openPanel('brief');showError('');$('brief-draft-note').textContent=[translate('Brief repris dans un nouveau bureau. Relisez-le avant de lancer une nouvelle mission.'),...(selection?.warnings||[])].join(' ');
  }catch(error){showError(error.message);openPanel('brief');}
  finally{reuseLoading=false;}
}
function openGuidedTemplate(template){wizardReturnPanel='catalog';closeOfficePanel({restoreFocus:false});$('guided-provider').value=$('provider-select').value;$('mission-wizard-dialog').showModal();missionWizard.open(template.id);}
function dateLabel(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString({fr:'fr-BE',en:'en-GB',nl:'nl-BE'}[getLocale()],{day:'numeric',month:'short'});
}
function timeLabel(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString({fr:'fr-BE',en:'en-GB',nl:'nl-BE'}[getLocale()],{hour:'2-digit',minute:'2-digit'});
}
function announce(message) { if(message && message !== lastAnnouncement) { $('live-announcement').textContent = message; lastAnnouncement = message; } }
function showError(message) { $('global-error').textContent = message; $('global-error').hidden = !message;$('panel-error').textContent=message;$('panel-error').hidden=!message; }
function hideWorldStatus(){clearTimeout(statusTimer);$('office-toast').hidden=true;}
function showWorldStatus(message){clearTimeout(statusTimer);$('pixel-world-status').textContent=String(message).slice(0,200);$('office-toast').hidden=false;statusTimer=setTimeout(hideWorldStatus,7000);}
async function request(url, options) {
  let response;try{response=await fetch(url,{credentials:'same-origin',...options});}catch(error){if(error.name==='AbortError')throw error;throw new Error(translate('Le bureau ne répond pas pour le moment. Vos saisies restent dans cette fenêtre.'));}
  let data;
  try { data = await response.json(); } catch { throw new Error('L’atelier a renvoyé une réponse inattendue. Réessayez dans un instant.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Cette action n’a pas pu être réalisée.'),{status:response.status},typeof data.code==='string'?{code:data.code}:{});
  return data;
}
function renderProviders() {
  const select = $('provider-select');
  const chosen = isRunning(mission) && mission.provider !== 'demo' ? mission.provider : !providerInitialized && state.preferredProvider ? state.preferredProvider : select.value;
  select.replaceChildren();
  const providers = state.providers.length ? state.providers : [{id:'codex',name:'Codex · OpenAI',available:false},{id:'claude',name:'Claude · Anthropic',available:false}];
  for (const provider of providers) {
    if (!['codex','claude'].includes(provider.id)) continue;
    const available = provider.available;
    const option = node('option', '', `${provider.name || providerName(provider.id)}${available ? '' : ' · indisponible'}`);
    option.value = provider.id;
    select.append(option);
  }
  if ([...select.options].some(o=>o.value===chosen)) select.value = chosen;
  if (!providerInitialized && state.providers.length && !state.providers.find(p=>p.id===select.value)?.available) {
    const first = state.providers.find(p=>p.available);
    if(first) select.value = first.id;
  }
  if (state.providers.length) providerInitialized = true;
  const guided = $('guided-provider');
  const guidedChoice = $('mission-wizard-dialog').open ? guided.value : select.value;
  guided.replaceChildren(...[...select.options].map(option=>option.cloneNode(true)));
  guided.value = guidedChoice;
  updateForm();
}
function connectionState(id) {
  const provider=state.providers.find(p=>p.id===id);
  const login=state.logins?.[id];
  return {provider,login,pending:['installing','connecting'].includes(login?.status),active:activeMissions().some(m=>m.provider===id)};
}
async function startProviderConnection(id,{renew=false}={}) {
  const {provider,pending,active}=connectionState(id);
  if(pending)return;
  if(active)throw new Error('Une mission utilise ce moteur. Attendez sa fin avant de modifier sa connexion.');
  if(provider?.available&&provider.auth?.loggedIn===true&&!renew)return;
  const action=provider?.available?'login':'setup';
  await request(`/api/providers/${encodeURIComponent(id)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  await refreshState();
}
async function refreshProviders(){await acceptState(await request('/api/providers/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));}
function updateGuidedConnection(){
  const {provider,login,pending,active}=connectionState($('guided-provider').value);
  const connected=provider?.available&&provider.auth?.loggedIn===true;
  $('guided-connect').disabled=pending||active||connected;
  $('guided-connect').textContent=pending?login.status==='installing'?'Préparation en cours…':'Connexion en cours…':connected?'Compte connecté ✓':provider?.available?'Connecter mon compte ↗':'Préparer et connecter ↗';
  $('guided-login-message').textContent=login?.message||(connected?'Votre abonnement local est prêt.':provider?.available?'Connexion officielle dans votre navigateur. Vos réponses restent ici.':'Le moteur sera installé puis connecté. Vos réponses restent ici.');
}
function updateForm() {
  const provider = state.providers.find(p => p.id === $('provider-select').value);
  const available = provider?.available;
  const active = isRunning(mission);
  const atCapacity = activeMissions().length >= (state.maxConcurrentMissions || 4);
  const canRecover = Boolean(pendingBriefRequest);
  const authMessage = provider?.auth?.loggedIn === false ? 'Connexion à renouveler dans votre application.' : provider?.auth?.loggedIn === true ? 'Connexion détectée · votre abonnement local' : 'Connexion vérifiée au lancement de la mission.';
  const message = provider?.message || (available ? `${provider.name || providerName(provider.id)}${provider.version ? ` ${provider.version}` : ''} · ${authMessage}` : state.providers.length ? 'Ce moteur n’est pas disponible. Connectez-vous à son application, puis relancez l’atelier.' : 'Vérification de vos outils locaux…');
  $('provider-message').textContent = message;
  $('brief-provider-name').textContent = provider?.name || 'Choisir mon moteur';
  $('office-onboarding').hidden = true;
  $('provider-message').classList.toggle('unavailable', !available || provider?.auth?.loggedIn === false);
  $('launch-button').disabled = creating || !canRecover && (!available || active || atCapacity);
  $('launch-button').firstElementChild.textContent = creating ? 'Oscar prépare le bureau…' : canRecover ? 'Vérifier la demande avec Oscar' : active ? 'Cette mission est en cours' : atCapacity ? 'Quatre équipes déjà au travail' : 'Confier la mission à Oscar';
  $('demo-button').disabled = creating || active || atCapacity;
  $('new-mission').lastChild.textContent = activeMissions().length ? ' Créer une autre mission' : ' Nouvelle mission';
  $('new-mission').disabled = creating || atCapacity;
  $('office-capacity').textContent = `${activeMissions().length} / 4 missions en cours`;
  $('provider-select').disabled = creating || active;
  $('mission-input').disabled = creating;
  for(const id of ['team-size','brief-dictation','settings-dictation','clear-brief-draft','brief-documents','guided-documents','guided-provider','guided-team-size'])$(id).disabled=creating;
  for(const button of document.querySelectorAll('#brief-examples button,.brief-engine-switch'))button.disabled=creating;
  const {login,pending,active:engineActive}=connectionState(provider?.id);
  $('connect-provider').hidden = false;
  $('connect-provider').disabled = !provider || pending || engineActive;
  $('connect-provider').textContent = pending ? login.status==='installing'?'Préparation du moteur officiel…':'Connexion en cours dans le navigateur…' : !provider?.available ? 'Préparer et connecter ↗' : provider?.auth?.loggedIn ? 'Renouveler la connexion ↗' : 'Se connecter dans le navigateur ↗';
  $('login-message').hidden = !login?.message;
  $('login-message').textContent = login?.message || '';
  updateGuidedConnection();welcomeGuide?.updateState();
}
function renderHistory() {
  const query=searchable($('history-search').value.trim());
  const items=state.missions.filter(item=>query.split(/\s+/u).every(word=>searchable(`${item.title||''} ${item.folderName||''} ${providerName(item.provider)} ${dateLabel(item.createdAt)}`).includes(word))&&(historyFilter==='all'||historyFilter==='active'&&runningStatuses.has(item.status)||historyFilter==='completed'&&item.status==='completed'||historyFilter==='attention'&&['needs_review','failed'].includes(item.status)||historyFilter==='cancelled'&&item.status==='cancelled'));
  $('mission-count').textContent = items.length===state.missions.length?String(items.length):`${items.length} / ${state.missions.length}`;
  const history = $('mission-history');
  const signature=JSON.stringify([selectedId,query,historyFilter,state.missions.map(m=>[m.id,m.title,m.status,m.provider,m.createdAt])]);
  if(history.dataset.signature===signature)return;history.dataset.signature=signature;
  const restoreFocus=rememberFocus(history),scrollTop=history.scrollTop;
  history.replaceChildren();
  if (!state.missions.length) { history.append(node('p','history-empty','L’atelier attend votre première idée.')); return; }
  if(!items.length)history.append(node('p','history-empty','Aucune mission ne correspond. Essayez un autre mot ou un autre statut.'));
  for(const item of items) {
    const button = node('button','history-item');
    button.type = 'button';
    button.dataset.mission=item.id;
    button.dataset.status = item.status || '';
    button.classList.toggle('selected', item.id === selectedId);
    if(item.id === selectedId) button.setAttribute('aria-current','true');
    button.append(node('i'));
    const copy = node('span');
    const title=node('strong','',item.title || item.prompt || 'Nouvelle mission');title.setAttribute('data-no-translate','');
    copy.append(title,node('small','',`${dateLabel(item.createdAt)}${item.provider ? ` · ${providerName(item.provider)}` : ''}`),node('small','history-status',`${item.assistant?'Zoé · ':''}${translate(missionStatus[item.status]||item.phase||'')}`));
    button.append(copy);
    button.addEventListener('click',()=>selectMission(item.id,{fromHistory:true}));
    history.append(button);
  }
  history.scrollTop=scrollTop;restoreFocus();
}
function renderScene() {
  const busy = isRunning(mission);
  if (!pixelWorld) {
    pixelWorld = new PixelWorld($('pixel-canvas'), {
      onSelect: (role, taskId, line) => openMember(role, taskId, line),
      getCharacterLine: role => characterLine(role),
      onStatus: showWorldStatus,
      onEvent: (kind,data)=>{if(kind==='oscar_arrived'&&data.missionId===mission?.id&&isRunning(mission))officeSpeech?.speak('oscar','Je suis à mon bureau ! J’engage les spécialistes adaptés à votre idée. Chacun aura une tâche, et je vérifierai le résultat.',{automatic:true});},
      onAmbience: ambience => {const phases={dawn:'Aube',day:'Journée',sunset:'Coucher de soleil',night:'Nuit'};$('ambience-mode').value=ambience.mode;$('ambience-status').textContent=`${ambience.mode==='auto'?'Heure locale':'Ambiance manuelle'} · ${phases[ambience.phase]||ambience.phase}`;document.body.dataset.ambience=ambience.phase;},
      onInteract: (kind, text) => { if(kind==='coffee'){closeOfficePanel({restoreFocus:false});coffeeDialog?.open();}else if(kind==='clock'){closeOfficePanel({restoreFocus:false});hideWorldStatus();clockDialog?.open();}else if(kind==='secretary'){openSecretary(null,text);}else if(kind==='missions')openPanel('catalog');else if(kind==='delivery')openPanel('delivery');else if(kind==='team')openPanel('team'); }
    });
    window.__oscarWorld = pixelWorld;
  }
  pixelWorld.update(mission);
  $('atelier-scene').dataset.mode = mission?.provider === 'demo' ? 'demo' : busy ? 'live' : 'idle';
  $('pixel-mode').textContent = mission?.provider === 'demo' ? 'VISITE SIMULÉE' : busy ? 'EN MISSION' : 'BUREAU OUVERT';
  const pill = $('scene-live');
  pill.classList.toggle('busy',busy);
  pill.lastChild.textContent = busy ? ' Au travail' : mission?.status === 'completed' ? ' Mission livrée' : ' Prêt à recruter';
  $('scene-caption').textContent = busy ? mission.phase || missionStatus[mission.status] : mission?.status === 'completed' ? 'Les rapports sont rendus. Une pause café bien méritée.' : 'Oscar attend votre mission pour faire venir les bons spécialistes.';
}

function renderTeam() {
  const tasks=mission?.tasks || [];
  $('office-mission-title').toggleAttribute('data-no-translate',!!mission?.title);$('office-mission-title').textContent=mission?.title || 'Une idée à transformer en projet ?';
  $('stat-agents').textContent=tasks.length;
  $('stat-working').textContent=tasks.filter(t=>['working','revising'].includes(t.status)).length;
  $('stat-approved').textContent=tasks.filter(t=>t.status==='approved').length;
  $('stat-files').textContent=mission?.files?.length || 0;
  $('team-count').textContent=tasks.length;
  $('oscar-team-status').textContent=mission?.phase || 'Prêt à vous écouter';
  const lead=$('team-oscar').querySelector('.team-avatar');if(!lead.firstElementChild)lead.replaceChildren(portrait('oscar'));
  const brand=document.querySelector('.brand-portrait');if(!brand.firstElementChild)brand.replaceChildren(portrait('oscar'));
  const list=$('team-list'),signature=JSON.stringify([mission?.id,tasks.map(t=>[t.id,t.role,t.agentName,t.title,t.status])]);
  if(list.dataset.signature===signature)return;list.dataset.signature=signature;
  const restoreFocus=rememberFocus(list),scrollTop=list.scrollTop;list.replaceChildren();
  if(!tasks.length){list.append(node('p','history-empty',mission?.status==='planning'?'Oscar étudie votre projet avant de recruter les talents.':'Oscar compose l’équipe adaptée à votre mission. Jusqu’à quatre personnes par métier.'));return;}
  const counts={};
  for(const task of tasks) {
    const role=roleOf(task.role),index=counts[role] || 0;counts[role]=index+1;
    const button=node('button','team-member');button.type='button';button.dataset.task=task.id;button.dataset.status=task.status;button.dataset.role=role;
    const avatar=node('span','team-avatar');avatar.dataset.role=role;avatar.append(portrait(role,index));
    const detail=node('span','team-detail');detail.append(node('strong','',agentName(task)),node('small','',getRole(role).label),node('span','team-assignment',task.title),node('span',`team-status ${task.status}`,taskStatus[task.status] || task.status));
    button.append(avatar,detail,node('span','team-arrow','↗'));button.addEventListener('click',()=>openMember(role,task.id));list.append(button);
  }
  list.scrollTop=scrollTop;restoreFocus();
}

function renderPhase() {
  let step = -1;
  if(mission) {
    if(mission.status === 'planning') step=0;
    else if(mission.status === 'running') step=1;
    else if(['reviewing','needs_review'].includes(mission.status)) step=2;
    else if(mission.status === 'completed') step=3;
    else if(mission.tasks?.length) step=1;
    else step=0;
  }
  document.querySelectorAll('[data-step]').forEach(el=>{
    const n=Number(el.dataset.step);
    el.classList.toggle('current',n===step);
    el.classList.toggle('done',n<step || (mission?.status==='completed' && n===step));
    if(n===step) el.setAttribute('aria-current','step'); else el.removeAttribute('aria-current');
  });
}
function renderTasks() {
  const list=$('task-list');
  const signature=JSON.stringify([mission?.id,mission?.tasks]);if(list.dataset.signature===signature)return;list.dataset.signature=signature;
  const restoreFocus=rememberFocus(list),scrollTop=list.scrollTop;
  list.replaceChildren();
  for(const task of mission?.tasks || []) {
    const info=getRole(task.role);
    const button=node('button','task-row');
    button.type='button';
    button.dataset.task=task.id;
    const avatar=node('span','task-avatar');avatar.append(portrait(roleOf(task.role),(mission.tasks || []).filter(t=>t.role===task.role).findIndex(t=>t.id===task.id)));button.append(avatar);
    const main=node('span','task-main');
    main.append(node('span','task-title',task.title || info.label));
    main.append(node('span','task-subtitle',`${agentName(task)}${task.activity ? ` · ${String(task.activity).slice(0,150)}` : ` · ${info.label}`}`));
    button.append(main,node('span',`task-state ${task.status || ''}`,taskStatus[task.status] || task.status || 'À venir'));
    button.addEventListener('click',()=>openMember(roleOf(task.role),task.id));
    list.append(button);
  }
  list.scrollTop=scrollTop;restoreFocus();
}
function renderEvents() {
  const events = mission?.events || [];
  $('activity-details').hidden = !events.length;
  $('event-count').textContent = events.length ? `(${events.length})` : '';
  const list=$('event-list');
  const nearBottom=list.scrollHeight-list.clientHeight-list.scrollTop < 40;
  list.replaceChildren();
  for(const event of events.slice(-100)) {
    const item=node('li');
    item.append(node('span','event-time',timeLabel(event.at)));
    const copy=node('span','event-copy');
    if(event.who) copy.append(node('strong','',getRole(event.who).name));
    copy.append(document.createTextNode(String(event.text || '')));
    item.append(copy);list.append(item);
  }
  if(nearBottom) list.scrollTop=list.scrollHeight;
}
function renderDeliveries() {
  const files=mission?.files || [];
  const reports=(mission?.tasks || []).filter(t=>t.report);
  const result=mission?.result;
  $('open-work-folder').hidden=!mission;
  $('review-completion').hidden=!mission||!['completed','needs_review'].includes(mission.status);
  $('reuse-mission').hidden=!mission||mission.assistant===true;
  $('download-archive').hidden=!mission||isRunning(mission);
  $('download-archive').disabled=Boolean(archiveDownload);
  const signature=JSON.stringify([mission?.id,mission?.status,mission?.provider,mission?.error,files,result,reports.map(t=>[t.id,t.title,t.agentName,t.report,t.review])]);
  if($('file-list').dataset.signature===signature)return;$('file-list').dataset.signature=signature;
  $('delivery-empty').hidden=!!(result || files.length || reports.length || mission?.error);
  $('result-summary').hidden=!result;
  $('result-content').textContent=typeof result === 'string' ? result : result ? JSON.stringify(result,null,2) : '';
  $('result-label').textContent=mission?.status==='needs_review' ? 'Résultat à vérifier' : mission?.provider==='demo' ? 'Exemple de livraison · simulation' : 'Le mot d’Oscar';
  $('mission-error').textContent=mission?.error || '';
  $('mission-error').hidden=!mission?.error;
  $('file-list').replaceChildren();
  for(const file of files) {
    if(!file || typeof file.path !== 'string') continue;
    const link=node('a','file-link');
    link.href=`/api/missions/${encodeURIComponent(mission.id)}/files/${file.path.split('/').map(encodeURIComponent).join('/')}`;
    const deliveredMission=mission;
    link.addEventListener('click',event=>{event.preventDefault();closeOfficePanel({restoreFocus:false});artifactViewer?.open(deliveredMission,file);});
    link.append(node('i','','▤'));
    const text=node('span');
    const fileName=node('strong','',file.path);fileName.setAttribute('data-no-translate','');text.append(fileName,node('small','',Number.isFinite(file.size) ? file.size < 1024 ? `${file.size} octets` : `${Math.round(file.size/1024)} Ko` : 'Fichier de la mission'));
    link.append(text,node('b','','↗'));$('file-list').append(link);
    if(/\.svg$/iu.test(file.path)){const edit=node('button','text-button delivery-edit','Modifier dans le studio ↗');edit.type='button';edit.addEventListener('click',async()=>{utilityReturns.set(creativeStudio,{panel:activePanel,focus:edit});closeOfficePanel({restoreFocus:false});await creativeStudio?.openFile(deliveredMission.id,file.path);});$('file-list').append(edit);}
  }
  const oldOpen=new Set([...$('report-list').querySelectorAll('details[open]')].map(el=>el.dataset.task));
  $('report-list').replaceChildren();
  for(const task of reports) {
    const info=getRole(task.role);
    const detail=node('details','report-item');
    detail.dataset.task=task.id;
    detail.open=oldOpen.has(String(task.id));
    detail.append(node('summary','',`${agentName(task)} · ${task.title || info.label}`));
    if(task.review && !task.review.approved && task.review.feedback) detail.append(node('p','report-review',`Retour d’Oscar : ${task.review.feedback}`));
    detail.append(node('pre','report-content',task.report));
    $('report-list').append(detail);
  }
}
function renderMission() {
  $('publish-project').hidden=!mission;
  $('publish-project').disabled=!mission||isRunning(mission);
  $('demo-banner').hidden=mission?.provider !== 'demo';
  $('mission-placeholder').hidden=!!mission;
  $('mission-overview').hidden=!mission;
  $('mission-prompt').textContent=mission?.prompt || '';
  $('mission-status').textContent=mission ? mission.phase || missionStatus[mission.status] || mission.status : '';
  $('mission-status').classList.toggle('problem',!!mission && ['failed','needs_review','cancelled'].includes(mission.status));
  $('mission-provider').textContent=mission ? `${providerName(mission.provider)} · ${dateLabel(mission.createdAt)} à ${timeLabel(mission.createdAt)}` : '';
  $('stop-mission').hidden=!isRunning(mission);
  renderPhase();renderTasks();renderEvents();renderDeliveries();renderScene();renderTeam();
  narrateMission();
  observeCompletion();
  if(mission) announce(`${mission.title || 'Mission'} : ${missionStatus[mission.status] || mission.phase || mission.status}`);
  if(openedRole && $('member-dialog').open) renderMember(openedRole,openedTaskId);
}
function completionKey(item){return `${item.id}:${item.status}`;}
function observeCompletion(){
  if(!mission)return;
  const previous=completionStatuses.get(mission.id);completionStatuses.set(mission.id,mission.status);
  if(previous&&['planning','running','reviewing'].includes(previous)&&['completed','needs_review'].includes(mission.status)){
    let seen=false;try{seen=localStorage.getItem(`oscar-delivery:${completionKey(mission)}`)==='seen';}catch{}
    if(!seen){pendingCompletions.set(mission.id,mission);scheduleCompletion();}
  }
}
function scheduleCompletion(){clearTimeout(completionTimer);completionTimer=setTimeout(()=>{
  if(!completionDialog||document.querySelector('dialog[open]')||document.hidden)return;
  const item=pendingCompletions.values().next().value;if(!item)return;
  pendingCompletions.delete(item.id);try{localStorage.setItem(`oscar-delivery:${completionKey(item)}`,'seen');}catch{}
  completionDialog.open(item);
},100);}
document.addEventListener('close',scheduleCompletion,true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleCompletion();});
function narrateMission(){
  if(!mission){lastNarrated=null;return;}
  const next={id:mission.id,status:mission.status,tasks:mission.tasks?.length||0,approved:(mission.tasks||[]).filter(t=>t.status==='approved').length};
  const previous=lastNarrated;lastNarrated=next;
  if(!previous||previous.id!==next.id||!officeSpeech)return;
  if(next.status!==previous.status&&next.status==='completed')officeSpeech.speak('oscar','La mission est livrée ! J’ai assemblé les résultats de l’équipe. Vous pouvez ouvrir les fichiers dans Livraison.',{automatic:true});
  else if(next.status!==previous.status&&next.status==='needs_review')officeSpeech.speak('oscar','Un point demande votre attention. Ouvrez le suivi : je vous explique ce qui reste à vérifier.',{automatic:true});
  else if(next.tasks>previous.tasks){const roles=[...new Set((mission.tasks||[]).map(t=>translate(getRole(t.role).label)))].join(', ');officeSpeech.speak('oscar',`${translate('Je recrute l’équipe :')} ${roles}. ${translate('Chaque spécialiste reçoit une tâche. Je relirai leurs résultats avant la livraison.')}`,{automatic:true,interrupt:false});}
  else if(next.status!==previous.status&&next.status==='reviewing')officeSpeech.speak('oscar','L’équipe m’a rendu ses dossiers. Je vérifie les résultats et je prépare votre livraison.',{automatic:true});
  else if(next.approved>previous.approved)officeSpeech.speak('oscar','De nouvelles contributions sont validées. L’équipe avance ; vous pouvez suivre les détails dans le suivi.',{automatic:true,interrupt:false});
}
function renderAll() { renderHistory();renderProviders();renderMission(); }
async function selectMission(id,{fromHistory=false}={}) {
  if(id!==selectedId)closeMemberForNavigation();
  if(fromHistory)closeOfficePanel();
  browsingNew=false;selectedId=id;history.replaceState(null,'',`/?mission=${encodeURIComponent(id)}`);
  switchBriefDraft();
  const seq=++refreshSequence;
  const active=activeMissions().find(m=>m.id===id);
  if(active) { mission=active;renderAll(); }
  else if(mission?.id!==id) { mission=null;renderAll();$('mission-placeholder').hidden=false;$('mission-placeholder').lastElementChild.firstElementChild.textContent='Ouverture de la mission…'; }
  try {
    const detail=await request(`/api/missions/${encodeURIComponent(id)}`);
    if(seq!==refreshSequence || selectedId!==id) return;
    mission=detail;lastMissionSignature=JSON.stringify([detail.id,detail.updatedAt,detail.status]);renderAll();showError('');
  } catch(error) { if(seq===refreshSequence) { showError(error.message);$('mission-placeholder').lastElementChild.firstElementChild.textContent='Mission indisponible pour le moment'; } }
}
async function acceptState(next) {
  if(!next || !Array.isArray(next.providers) || !Array.isArray(next.missions)) return;
  if(next.buildId){if(!initialBuildId)initialBuildId=next.buildId;else if(initialBuildId!==next.buildId)$('update-notice').hidden=false;}
  if(next.version)$('app-version').textContent=`${translate('Version')} ${next.version}`;
  state=next;fetchErrorCount=0;
  const active=activeMissions();
  if(!selectedId && !browsingNew && active.length) selectedId=active[0].id;
  const selectedActive=active.find(m=>m.id===selectedId);
  if(selectedId && selectedActive) {
    mission=selectedActive;
    lastMissionSignature=JSON.stringify([mission.id,mission.updatedAt,mission.status]);
  } else if(selectedId) {
    const summary=state.missions.find(m=>m.id===selectedId);
    const signature=JSON.stringify([summary?.id,summary?.updatedAt,summary?.status]);
    if(summary && signature!==lastMissionSignature) {
      lastMissionSignature=signature;
      selectMission(selectedId);
    }
  }
  renderAll();
  if(pendingReuse&&state.providers.length){const id=pendingReuse;pendingReuse=null;await loadReusableBrief(id);}
  else if(pendingTemplate && browsingNew && state.providers.length){const template=MISSION_TEMPLATES.find(t=>t.id===pendingTemplate);pendingTemplate=null;if(template)openGuidedTemplate(template);}
  else if(state.providers.length&&!selectedId&&!mission&&!creating&&!reuseLoading&&!$('mission-wizard-dialog').open&&!$('office-panel').open)welcomeGuide?.maybeOpen();
}
function newMission({forceLocal=false,reveal=true}={}) {
  if(!forceLocal && isRunning(mission)){openAnotherOffice();return;}
  closeMemberForNavigation();
  pendingBriefRequest=null;saveBriefDraft();
  history.replaceState(null,'','/?new=1');
  switchBriefDraft();
  ++refreshSequence;selectedId=null;mission=null;browsingNew=true;lastMissionSignature='';
  $('form-error').hidden=true;
  $('mission-placeholder').lastElementChild.firstElementChild.textContent='Une équipe prête à se mettre au travail';
  renderAll();if(reveal)openPanel('brief');
}
function acceptLaunchedMission(detail,provider){
  selectedId=detail.id;mission=detail;state.active=detail;state.activeMissions=[...activeMissions().filter(m=>m.id!==detail.id),detail];browsingNew=false;history.replaceState(null,'',`/?mission=${encodeURIComponent(detail.id)}`);
  const previous=state.missions.findIndex(m=>m.id===detail.id);
  if(previous<0)state.missions.unshift(detail);else state.missions[previous]=detail;
  closeMemberForNavigation();dismissWelcome();closeOfficePanel({restoreFocus:false});showError('');renderAll();$('pixel-canvas').focus({preventScroll:true});
  if(!isRunning(detail)){openPanel('delivery');officeSpeech?.speak('oscar','Je retrouve votre mission et ses fichiers. Voici la livraison et les points à vérifier.',{automatic:true});}
  else officeSpeech?.speak('oscar',provider==='demo'?'Bienvenue dans la visite ! Cette démonstration vous montre notre travail sans appeler un modèle.':detail.status==='planning'?'Allez, let’s go ! Je rejoins mon bureau pour préparer votre projet.':'Je retrouve la mission en cours. L’équipe continue son travail.',{automatic:true});return detail;
}
async function launch(provider,{strict=false,teamSize=$('team-size').value,allowParallel=false,promptOverride,studioReceipt=null,onStudioIdentity}={}) {
  if(promptOverride!==undefined)pendingStudioRequest=studioReceipt?{id:studioReceipt.requestId,hash:studioReceipt.requestHash}:null;
  const canRecover=provider!=='demo'&&Boolean(promptOverride!==undefined?pendingStudioRequest:pendingBriefRequest);
  if(creating || !canRecover&&(isRunning(mission)&&!allowParallel || activeMissions().length>=4)) {if(strict)throw new Error(activeMissions().length>=4?'Quatre missions sont déjà en cours. Attendez une livraison puis réessayez : votre brief est conservé.':'Cette mission est déjà en cours. Ouvrez un autre bureau pour un nouveau projet.');return;}
  let prompt=String(promptOverride??$('mission-input').value).trim();
  const originalPrompt=prompt;
  if(provider!=='demo' && !prompt) {if(strict)throw new Error('Ajoutez une mission avant de la confier à Oscar.');$('mission-input').reportValidity();return; }
  if(provider!=='demo') {
    const {provider:engine,pending}=connectionState(provider);
    const error=pending?'La connexion est en cours. Terminez-la dans votre navigateur, puis réessayez : votre brief est conservé.':!engine?.available||engine.auth?.loggedIn===false?'Connectez votre compte avant de lancer la mission. Votre brief est conservé.':'';
    if(error&&!canRecover){if(strict)throw new Error(error);$('form-error').textContent=error;$('form-error').hidden=false;openPanel('settings');$('login-message').textContent=error;$('login-message').hidden=false;return;}
  }
  creating=true;$('form-error').hidden=true;updateForm();
  try {
    if(promptOverride!==undefined&&studioReceipt){
      let receipt;try{receipt=await request(`/api/mission-requests/${encodeURIComponent(studioReceipt.requestId)}`);}catch(error){if(error.status!==404)throw error;}
      if(receipt){
        if(receipt.status!=='accepted'||!receipt.mission?.id)throw new Error(translate('Cette demande est encore en cours de vérification. Patientez un instant, puis reprenez-la.'));
        pendingStudioRequest=null;return acceptLaunchedMission(receipt.mission,receipt.mission.provider);
      }
    }
    if(provider!=='demo')prompt=withLocaleInstruction(withTeamPreference(prompt,teamSize));
    if(provider!=='demo'&&documentLibrary&&!await documentLibrary.refresh())throw new Error(translate('Les choix de documents n’ont pas pu être repris. Actualisez la bibliothèque avant de réessayer.'));
    const documents=provider==='demo'?{}:{references:documentLibrary?.getReferences()||[],referenceIds:documentLibrary?.getSelection()||[],outputFormats:documentLibrary?.getOutputFormats()||[],templateId:documentLibrary?.getTemplateId()||null,templateRevision:documentLibrary?.getTemplateRevision()||null};
    const requestId=provider==='demo'?undefined:await launchRequestIdentity({prompt:originalPrompt,provider,teamSize,referenceIds:documents.referenceIds,outputFormats:documents.outputFormats,templateId:documents.templateId,locale:getLocale()},{studio:promptOverride!==undefined});
    if(promptOverride!==undefined&&pendingStudioRequest?.hash)onStudioIdentity?.({requestId:pendingStudioRequest.id,requestHash:pendingStudioRequest.hash});
    const detail=await request('/api/missions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt || 'Imaginer le lancement d’un café de quartier : positionnement, idées de communication et une page de présentation.',provider,locale:getLocale(),...documents,...(requestId?{requestId}:{})})});
    if(provider!=='demo'&&promptOverride===undefined){pendingBriefRequest=null;briefDrafts.remove('oscar');$('mission-input').value='';$('brief-draft-note').textContent=translate('Demande confirmée. Votre réponse est conservée dans l’historique.');}else if(promptOverride!==undefined)pendingStudioRequest=null;
    return acceptLaunchedMission(detail,provider);
  } catch(error) { $('form-error').textContent=error.message;$('form-error').hidden=false;if(strict)throw error; }
  finally { creating=false;updateForm(); }
}
async function stopMission() {
  if(!mission || !isRunning(mission)) return;
  $('stop-mission').disabled=true;
  try {
    const detail=await request(`/api/missions/${encodeURIComponent(mission.id)}/stop`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    mission=detail;if(state.active?.id===detail.id) state.active=detail;
    renderAll();
  } catch(error) { showError(error.message); }
  finally { $('stop-mission').disabled=false; }
}
function renderMember(role,taskId) {
  const info=getRole(role);
  const selected=(mission?.tasks || []).find(t=>t.id===taskId&&roleOf(t.role)===role);
  const signature=JSON.stringify([mission?.id,role,taskId,selected||mission?.tasks,role==='oscar'?[mission?.title,mission?.status,mission?.prompt,mission?.result]:null,openedQuip]);
  if(signature===lastMemberSignature)return;lastMemberSignature=signature;
  $('member-title').textContent=selected?agentName(selected):role==='oscar'?'Oscar':`L’îlot ${info.label.toLowerCase()}`;
  $('member-role').textContent=info.label;
  $('member-quip').textContent=openedQuip;
  $('member-intro').textContent=selected?`${agentName(selected)} · ${info.label}. Une tâche à soi, une équipe pour avancer et Oscar pour relire le résultat.`:role==='oscar'?info.intro:`Jusqu’à quatre spécialistes de ${info.label.toLowerCase()} peuvent travailler ici. Chacun garde son prénom, sa tâche et ses fichiers.`;
  $('member-expertise').replaceChildren();
  const descriptions=ROLE_DETAILS[role]||ROLE_DETAILS.oscar;
  ['Ce que nous faisons','Exemples de livrables','Ce qu’Oscar vérifie'].forEach((title,index)=>{const section=node('section','role-service');section.append(node('h3','',title),node('p','',descriptions[index]));$('member-expertise').append(section);});
  const list=$('member-tasks');list.replaceChildren();
  const tasks=role==='oscar' ? [] : (mission?.tasks || []).filter(t=>roleOf(t.role)===role&&(!selected||t.id===selected.id));
  if(role==='oscar' && mission) {
    const section=node('section','dialog-task');
    section.append(node('h3','',mission.title || 'La mission'),node('span',`task-state ${mission.status}`,missionStatus[mission.status] || mission.status));
    section.append(node('p','',mission.prompt));
    if(mission.result) section.append(node('pre','report-content',mission.result));
    list.append(section);
  }
  for(const task of tasks) {
    const section=node('section','dialog-task');section.dataset.task=task.id;
    section.append(node('h3','',task.title || info.label),node('span',`task-state ${task.status || ''}`,taskStatus[task.status] || task.status));
    if(task.instruction) section.append(node('p','',task.instruction));
    if(task.criteria) {
      section.append(node('div','dialog-label','Critères de validation'));
      section.append(node('p','',Array.isArray(task.criteria)?task.criteria.join('\n'):typeof task.criteria==='string'?task.criteria:JSON.stringify(task.criteria,null,2)));
    }
    if(task.activity) section.append(node('p','',`Activité : ${task.activity}`));
    if(task.report) { section.append(node('div','dialog-label','Compte rendu'),node('pre','report-content',task.report)); }
    if(task.review?.feedback) section.append(node('p',task.review.approved?'':'report-review',`Retour d’Oscar : ${task.review.feedback}`));
    list.append(section);
  }
  if(!mission || (role!=='oscar' && !tasks.length)) list.append(node('p','history-empty','Aucune tâche confiée pour cette mission.'));
  if(taskId) list.querySelector(`[data-task="${CSS.escape(String(taskId))}"]`)?.scrollIntoView({block:'nearest'});
}
function openMember(role,taskId,spokenLine) {
  memberReturnPanel=activePanel;closeOfficePanel({restoreFocus:false});
  lastMemberSignature='';
  openedRole=role;openedTaskId=taskId || null;const quips=QUIPS[role] || QUIPS.oscar;openedQuip=['oscar','secretaire'].includes(role)?spokenLine||characterLine(role):quips[Math.floor(Math.random()*quips.length)];renderMember(role,taskId);
  const dialog=$('member-dialog');
  if(!dialog.open) dialog.showModal();
  if(role==='oscar'||role==='secretaire')officeSpeech?.speak(role,openedQuip);
}
function setConnection(connected) {
  $('connection-dot').classList.toggle('connected',connected);
  $('connection-label').textContent=connected?'Atelier connecté':'Reconnexion à l’atelier…';
}
function connectEvents() {
  eventSource=new EventSource('/api/events');
  eventSource.onopen=()=>{setConnection(true);if(fetchErrorCount===0) showError('');};
  eventSource.addEventListener('state',event=>{
    try { acceptState(JSON.parse(event.data));setConnection(true); }
    catch { showError('Une mise à jour n’a pas pu être lue. L’atelier va se reconnecter.'); }
  });
  eventSource.onerror=()=>setConnection(false);
}
async function refreshState() {
  try { await acceptState(await request('/api/state'));setConnection(true);showError(''); }
  catch(error) { fetchErrorCount++;setConnection(false);showError(`Connexion à l’atelier impossible. ${error.message}`); }
}
$('mission-form').addEventListener('submit',event=>{event.preventDefault();launch($('provider-select').value);});
restoreBriefDraft();
$('mission-input').addEventListener('input',saveBriefDraft);
$('provider-select').addEventListener('change',saveBriefDraft);
$('team-size').addEventListener('change',saveBriefDraft);
$('clear-brief-draft').addEventListener('click',()=>{pendingBriefRequest=null;briefDrafts.remove('oscar');$('mission-input').value='';$('brief-draft-note').textContent=translate('Brouillon effacé.');$('mission-input').focus();});
$('reload-update').addEventListener('click',()=>location.reload());
$('history-search').addEventListener('input',renderHistory);
$('history-status').addEventListener('change',event=>{historyFilter=event.target.value;renderHistory();});
$('provider-select').addEventListener('change',updateForm);
$('demo-button').addEventListener('click',()=>launch('demo'));
$('new-mission').addEventListener('click',()=>{if(isRunning(mission)){closeOfficePanel({restoreFocus:false});openAnotherOffice();}else{newMission({reveal:false});openPanel('catalog');}});
$('free-mission').addEventListener('click',newMission);
$('stop-mission').addEventListener('click',stopMission);
$('close-dialog').addEventListener('click',()=>$('member-dialog').close());
$('member-dialog').addEventListener('click',event=>{if(event.target===$('member-dialog')) {const box=$('member-dialog').getBoundingClientRect();if(event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom) $('member-dialog').close();}});
$('member-dialog').addEventListener('close',()=>{if($('member-dialog').open)return;openedRole=null;openedTaskId=null;lastMemberSignature='';const previous=memberReturnPanel;memberReturnPanel=null;if(previous)openPanel(previous);});
$('team-oscar').addEventListener('click',()=>openMember('oscar'));
document.addEventListener('click',event=>{const button=event.target.closest('[data-open-panel]');if(button)openPanel(button.dataset.openPanel);});
$('close-office-panel').addEventListener('click',()=>closeOfficePanel());
$('office-panel').addEventListener('close',()=>{if(!$('office-panel').open){restorePanel();if(panelReturnFocus?.isConnected)panelReturnFocus.focus({preventScroll:true});}});
$('office-panel').addEventListener('click',event=>{if(event.target!==$('office-panel'))return;const box=$('office-panel').getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeOfficePanel();});
$('dismiss-onboarding').addEventListener('click',dismissWelcome);
document.querySelectorAll('[data-pixel-prop]').forEach(button=>button.addEventListener('click',()=>pixelWorld?.interact(button.dataset.pixelProp)));
document.querySelectorAll('[data-pixel-role]').forEach(button=>button.addEventListener('click',()=>openMember(button.dataset.pixelRole)));
$('pixel-pause').addEventListener('click',()=>{animationPaused=!animationPaused;pixelWorld.setPaused(animationPaused);$('pixel-pause').setAttribute('aria-pressed',String(animationPaused));$('pixel-pause').setAttribute('aria-label',animationPaused?'Reprendre les animations':'Pause animations');$('pixel-pause').title=animationPaused?'Reprendre les animations':'Pause animations';$('pixel-pause').querySelector('.dock-label').textContent=animationPaused?'Reprendre':'Pause';$('atelier-scene').dataset.paused=String(animationPaused);});
$('pixel-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('pixel-world-status').textContent='Le bureau utilise déjà toute la fenêtre. Le plein écran du navigateur peut aussi l’agrandir.';}});
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{$('mission-input').value=translate(button.dataset.prompt);saveBriefDraft();$('mission-input').focus();}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshState();});
window.addEventListener('online',refreshState);
window.addEventListener('beforeunload',()=>{archiveDownload?.abort();clearTimeout(statusTimer);clearTimeout(completionTimer);clearTimeout(weatherTimer);eventSource?.close();pixelWorld?.destroy();welcomeGuide?.destroy();publicationDialog?.destroy();voiceDialog?.destroy();officeSpeech?.destroy();clockDialog?.destroy();dictationDialog?.destroy();documentLibrary?.destroy();personalizationDialog?.destroy();creativeStudio?.destroy();connectorsDialog?.destroy();automationsDialog?.destroy();artifactViewer?.destroy();completionDialog?.destroy();secretaryDialog?.destroy();});

coffeeDialog = new CoffeeDialog({recipient:'renaud2005@gmail.com'});
clockDialog=new ClockDialog();
dictationDialog=new DictationDialog({onRecord:()=>officeSpeech?.stop(),onClose:()=>{if(dictationReturnPanel){const panel=dictationReturnPanel;dictationReturnPanel=null;openPanel(panel,{focus:false});if(panel==='brief')$('mission-input').focus({preventScroll:true});}}});
for(const id of ['brief-dictation','settings-dictation'])$(id).addEventListener('click',()=>{if(id==='settings-dictation'){closeOfficePanel({restoreFocus:false});openPanel('brief');}dictateInto($('mission-input'));});
documentLibrary=new DocumentLibraryDialog({request,getMission:()=>mission,onClose:()=>returnFromUtility(documentLibrary),onSelectionChanged:({ids,formats})=>{for(const id of ['brief-documents-status','guided-documents-status']){const status=$(id);if(status)status.textContent=`${ids.length} ${translate('exemples')} · ${formats.map(format=>({docx:'Word',pdf:'PDF',xlsx:'Excel'})[format]).join(', ')||translate('Format libre')}`;}},onExport:async options=>{if(!mission)throw new Error(translate('Choisissez une mission avant d’exporter.'));const id=mission.id;const result=await request(`/api/missions/${encodeURIComponent(id)}/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...options,locale:getLocale()})});if(mission?.id===id){mission=await request(`/api/missions/${encodeURIComponent(id)}`);renderMission();}return result;}});
for(const id of ['brief-documents','guided-documents','settings-documents','delivery-documents'])$(id).addEventListener('click',()=>openUtility(documentLibrary));
personalizationDialog=new PersonalizationDialog({request,onChange:acceptPersonalContext,onClose:()=>returnFromUtility(personalizationDialog)});
$('settings-personalization').addEventListener('click',()=>openUtility(personalizationDialog));
request('/api/profile').then(value=>{acceptPersonalContext(value);if(value.profile?.weatherEnabled)return refreshPersonalWeather();}).catch(()=>{});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&personalContext.profile?.weatherEnabled&&Date.now()>Number(personalContext.weather?.expiresAt||0))refreshPersonalWeather();});
documentLibrary.refresh();
creativeStudio=new CreativeStudio({getMission:()=>mission,onClose:()=>returnFromUtility(creativeStudio),onCreate:async({brief,requestReceipt,onRequestIdentity})=>{const detail=await launch($('provider-select').value,{strict:true,teamSize:'auto',allowParallel:true,promptOverride:brief,studioReceipt:requestReceipt,onStudioIdentity:onRequestIdentity});if(!detail?.id)throw new Error(translate('Le bureau n’a pas confirmé cette demande.'));utilityReturns.delete(creativeStudio);return detail;}});
for(const id of ['open-creative-studio','settings-creative-studio','delivery-creative-studio'])$(id).addEventListener('click',()=>openUtility(creativeStudio));
connectorsDialog=new ConnectorsDialog({request,getMission:()=>mission,onSecretary:(mode,connection)=>openSecretary(mode,undefined,connection)});
automationsDialog=new AutomationsDialog({request,getState:()=>state,onMission:id=>{automationsDialog.close();selectMission(id);openPanel('progress');}});
artifactViewer=new ArtifactViewer({request,onClose:()=>openPanel('delivery')});
const openWorkFolder=id=>request(`/api/missions/${encodeURIComponent(id)}/open-folder`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
completionDialog=new CompletionDialog({avatar:()=>portrait('oscar'),onFolder:openWorkFolder,onFile:(item,file)=>artifactViewer.open(item,file),onDelivery:async item=>{if(selectedId!==item.id)await selectMission(item.id);openPanel('delivery');},onNew:()=>newMission(),onImprove:item=>{newMission();$('mission-input').value=`${translate('Améliore la mission précédente :')} ${item.title||item.prompt}\n${translate('Dossier du travail précédent :')} ${item.workDirectory||item.folderName||''}\n${translate('Examine les fichiers existants, propose les améliorations utiles et vérifie le résultat. Garde les originaux et livre les nouvelles versions dans cette nouvelle mission.')}`;saveBriefDraft();},onClose:scheduleCompletion});
secretaryDialog=new SecretaryDialog({request,getState:()=>state,getProfile:()=>personalContext.profile||{},onDictate:target=>dictateInto(target),onMission:async id=>{await selectMission(id);openPanel('progress');},onAutomations:()=>automationsDialog.open(),onConnectors:()=>connectorsDialog.open(),onActivity:activity=>pixelWorld?.setSecretaryActivity(activity.busy)});
$('open-secretary').addEventListener('click',()=>openSecretary());
$('open-work-folder').addEventListener('click',async()=>{if(!mission)return;try{await openWorkFolder(mission.id);}catch(error){showError(error.message);}});
$('download-archive').addEventListener('click',async()=>{
  if(!mission||isRunning(mission)||archiveDownload)return;
  const item=mission,controller=new AbortController();archiveDownload=controller;$('download-archive').disabled=true;
  const status=$('archive-status');status.hidden=false;status.textContent=translate('Préparation de votre archive…');
  try{
    const response=await fetch(`/api/missions/${encodeURIComponent(item.id)}/archive`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!response.ok){let result;try{result=await response.json();}catch{}throw new Error(result?.error||translate('L’archive n’a pas pu être préparée. Ouvrez le dossier de travail.'));}
    const length=Number(response.headers.get('content-length'));if(response.headers.get('content-type')!=='application/zip'||!Number.isSafeInteger(length)||length<22||length>54*1024*1024){await response.body?.cancel();throw new Error(translate('L’archive reçue n’est pas reconnue. Ouvrez le dossier de travail.'));}
    const blob=await response.blob();if(blob.size!==length)throw new Error(translate('Le téléchargement a été interrompu. Vous pouvez réessayer.'));
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${String(item.folderName||item.title||'mission').replace(/[\\/:*?"<>|\x00-\x1f]/gu,'-').slice(0,100)}.zip`;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    if(mission?.id===item.id)status.textContent=translate('Archive préparée. Le téléchargement a été demandé au navigateur. Les fichiers cachés et dossiers de dépendances sont exclus.');
  }catch(error){if(mission?.id===item.id)status.textContent=translate(error.message);}
  finally{archiveDownload=null;renderDeliveries();}
});
$('review-completion').addEventListener('click',()=>{closeOfficePanel({restoreFocus:false});completionDialog.open(mission);});
$('reuse-mission').addEventListener('click',()=>{if(!mission||mission.assistant)return;const url=new URL(location.href);url.search='';url.searchParams.set('new','1');url.searchParams.set('reuse',mission.id);window.open(url.href,'_blank','noopener');});
for(const id of ['open-connectors','settings-connectors'])$(id).addEventListener('click',()=>{closeOfficePanel({restoreFocus:false});connectorsDialog.open();});
for(const id of ['open-automations','settings-automations'])$(id).addEventListener('click',()=>{closeOfficePanel({restoreFocus:false});automationsDialog.open();});
$('dismiss-office-status').addEventListener('click',hideWorldStatus);
publicationDialog=new PublicationDialog({request,getMission:()=>mission,onClose:()=>openPanel('delivery')});
$('publish-project').addEventListener('click',()=>{closeOfficePanel({restoreFocus:false});publicationDialog.open();});
missionWizard = new MissionWizard($('mission-wizard-host'), {
  onComplete: async (prompt) => {
    const provider = $('guided-provider').value;
    $('mission-input').value = prompt; $('provider-select').value = provider;saveBriefDraft();
    await launch(provider,{strict:true,teamSize:$('guided-team-size').value});
    wizardReturnPanel=null;$('mission-wizard-dialog').close();
  },
  onCancel: () => $('mission-wizard-dialog').close(),
});
function searchable(value){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function renderCatalog() {
  const query=searchable($('template-search').value.trim());
  const featured=['logiciel-sur-mesure','jeu-video','site-internet','reseaux-sociaux','concurrents','identite-visuelle','application-web','jeu-plateforme'];
  const templates=[...MISSION_TEMPLATES].sort((a,b)=>{const x=featured.indexOf(a.id),y=featured.indexOf(b.id);return(x<0?100:x)-(y<0?100:y);}).filter(t=>(catalogCategory==='all'||t.category===catalogCategory)&&(!query||query.split(/\s+/).every(word=>searchable(`${t.title} ${t.description} ${translate(t.title)} ${translate(t.description)} ${MISSION_CATEGORIES.find(c=>c.id===t.category)?.label || ''} ${translate(MISSION_CATEGORIES.find(c=>c.id===t.category)?.label || '')}`).includes(word))));
  $('mission-template-grid').replaceChildren();
  $('catalog-count').textContent=`${templates.length} ${templates.length===1?'idée':'idées'} pour démarrer`;
  $('catalog-empty').hidden=!!templates.length;
  for(const template of templates) {
    const button=node('button','mission-template');button.type='button';button.dataset.template=template.id;button.dataset.category=template.category;
    button.append(node('span','mission-template-icon',template.icon));
    const copy=node('span','mission-template-copy');copy.append(node('strong','',template.title),node('small','',template.description));button.append(copy,node('span','mission-template-arrow','↗'));
    button.addEventListener('click',()=>{
      if(activeMissions().length>=4){showError('Quatre missions sont déjà en cours. Attendez une livraison pour lancer une autre équipe.');return;}
      if(isRunning(mission)){openAnotherOffice(template.id);return;}
      openGuidedTemplate(template);
    });
    $('mission-template-grid').append(button);
  }
}
for(const category of MISSION_CATEGORIES) {
  const button=node('button','catalog-filter',category.label);button.type='button';button.dataset.category=category.id;button.setAttribute('aria-pressed',String(category.id===catalogCategory));
  button.addEventListener('click',()=>{catalogCategory=category.id;for(const other of $('catalog-filters').children)other.setAttribute('aria-pressed',String(other===button));renderCatalog();});
  $('catalog-filters').append(button);
}
$('template-search').addEventListener('input',renderCatalog);
renderCatalog();
$('close-wizard').addEventListener('click',()=>$('mission-wizard-dialog').close());
$('mission-wizard-dialog').addEventListener('close',()=>{if($('mission-wizard-dialog').open)return;missionWizard.close();const previous=wizardReturnPanel;wizardReturnPanel=null;if(previous)openPanel(previous);});
$('open-missions-folder').addEventListener('click',async()=>{try{await request('/api/open-data',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch(error){showError(error.message);}});
$('connect-provider').addEventListener('click',async()=>{
  try{await startProviderConnection($('provider-select').value,{renew:true});}catch(error){$('login-message').textContent=error.message;$('login-message').hidden=false;}
});
$('refresh-providers').addEventListener('click',async()=>{const button=$('refresh-providers');button.disabled=true;try{await refreshProviders();}catch(error){$('login-message').textContent=error.message;$('login-message').hidden=false;}finally{button.disabled=false;}});
$('guided-provider').addEventListener('change',updateGuidedConnection);
$('guided-connect').addEventListener('click',async()=>{try{await startProviderConnection($('guided-provider').value);}catch(error){$('guided-login-message').textContent=error.message;}});
$('ambience-mode').addEventListener('change',()=>{const mode=$('ambience-mode').value;if(mode==='auto')pixelWorld?.interact('auto');else pixelWorld?.setAmbienceMode(mode);});
welcomeGuide=new WelcomeGuide({getState:()=>state,onChooseProvider:id=>{$('provider-select').value=id;updateForm();},onConnect:startProviderConnection,onRefresh:refreshProviders,onClose:dismissWelcome,onAction:action=>{
  if(action==='demo')launch('demo');
  else if(action==='connectors')connectorsDialog.open();
  else if(action==='automations')automationsDialog.open();
  else if(action==='secretary')openSecretary('free');
  else if(action==='documents')documentLibrary.open();
  else if(action==='team-example'){newMission();$('team-size').value='15';$('mission-input').value='Crée un jeu de puzzle jouable dans mon navigateur, avec trois niveaux, une interface dessin animé et un mode d’emploi. Répartis le projet entre recherche, rédaction, code, design et analyse, avec des contributions complémentaires et des fichiers vérifiés.';}
  else openPanel(action);
}});
for(const id of ['hud-guide','replay-guide'])$(id).addEventListener('click',()=>{closeMemberForNavigation();closeOfficePanel({restoreFocus:false});welcomeGuide.open();dismissWelcome();});
officeSpeech=new OfficeSpeech({onChange:info=>{
  $('hud-voice').setAttribute('aria-pressed',String(info.enabled));$('hud-voice').textContent=info.enabled?'♪':'♩';$('hud-voice').setAttribute('aria-label',info.enabled?'Couper les voix':'Activer les voix');$('voice-enabled').checked=info.enabled;
  $('voice-status').textContent=info.error||info.message;
  const speaking=info.audioSpeaking??info.speaking,preparing=info.audioPreparing??info.preparing;
  $('speech-stop').hidden=!speaking&&!preparing;
  pixelWorld?.setSpeaking(speaking?roleOf(info.audioRole||info.role):null);
  if(info.text&&!info.muted){$('speech-caption').hidden=false;$('speech-name').textContent=getRole(info.role).name;$('speech-text').textContent=info.text;}
  voiceDialog?.refresh();
},onVoices:voices=>{const selected=$('voice-select').value;const auto=node('option','','Automatique · une voix par personnage');auto.value='auto';$('voice-select').replaceChildren(auto);for(const voice of voices){if(voice.installed===false)continue;const option=node('option','',`${voice.name} · ${voice.lang}`);option.value=voice.id||voice.name;$('voice-select').append(option);}if([...$('voice-select').options].some(o=>o.value===selected))$('voice-select').value=selected;}});
$('voice-select').value=officeSpeech.voiceName;
voiceDialog=new VoiceDialog({getSpeech:()=>officeSpeech,onClose:()=>returnFromUtility(voiceDialog)});
$('open-voice-settings').addEventListener('click',()=>openUtility(voiceDialog));
$('hud-voice').addEventListener('click',()=>{if(officeSpeech.available&&officeSpeech.engine!=='captions')officeSpeech.setEnabled(!officeSpeech.enabled);else openUtility(voiceDialog);});
$('voice-enabled').addEventListener('change',()=>officeSpeech.setEnabled($('voice-enabled').checked));
$('voice-select').addEventListener('change',()=>officeSpeech.setVoice($('voice-select').value));
$('voice-test').addEventListener('click',()=>{officeSpeech.setEnabled(true);officeSpeech.speak('oscar','Bonjour, moi c’est Oscar ! Une idée, une équipe, et on se met au travail.');});
$('speech-stop').addEventListener('click',()=>officeSpeech.stop());
$('speech-close').addEventListener('click',()=>{officeSpeech.stop();$('speech-caption').hidden=true;});
startI18n();
const LANGUAGE_FLAGS={fr:'🇫🇷',en:'🇬🇧',nl:'🇳🇱'};
function updateLanguageMenu(){const locale=getLocale();$('hud-language-flag').textContent=LANGUAGE_FLAGS[locale];for(const button of document.querySelectorAll('[data-hud-locale]'))button.setAttribute('aria-pressed',String(button.dataset.hudLocale===locale));}
for(const button of document.querySelectorAll('[data-hud-locale]'))button.addEventListener('click',()=>{setLocale(button.dataset.hudLocale);$('hud-language').open=false;$('hud-language').querySelector('summary').focus();});
document.addEventListener('click',event=>{if(!$('hud-language').contains(event.target))$('hud-language').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('hud-language').open){$('hud-language').open=false;$('hud-language').querySelector('summary').focus();}});
document.addEventListener('oscar:language',updateLanguageMenu);updateLanguageMenu();
document.addEventListener('oscar:language',()=>{renderCatalog();lastMemberSignature='';renderMission();$('mission-history').dataset.signature='';renderHistory();});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]:not(#office-panel)')){event.preventDefault();catalogCategory='all';for(const filter of $('catalog-filters').children)filter.setAttribute('aria-pressed',String(filter.dataset.category==='all'));renderCatalog();openPanel('catalog');}});

renderAll();
refreshState();
connectEvents();
