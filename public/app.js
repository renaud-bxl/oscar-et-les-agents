import { CoffeeDialog } from '/coffee-dialog.js';
import { PixelWorld } from '/pixel-world.js';
import { MISSION_TEMPLATES, MissionWizard } from '/mission-catalog.js';
'use strict';

const $ = (id) => document.getElementById(id);
const roleInfo = {
  oscar: {name: 'Oscar', label: 'Chef d’équipe', initial: 'O', intro: 'Oscar transforme votre idée en plan de travail, confie chaque tâche au bon spécialiste, puis vérifie et assemble les résultats.'},
  recherche: {name: 'Lina', label: 'Recherche', initial: 'L', intro: 'Lina explore le sujet, recoupe les informations et rassemble des sources utiles à votre projet.'},
  redaction: {name: 'Noé', label: 'Rédaction', initial: 'N', intro: 'Noé trouve les mots justes et donne une structure claire aux contenus de votre mission.'},
  code: {name: 'Sam', label: 'Développement', initial: 'S', intro: 'Sam construit et vérifie le code, les outils et les pages qui donnent vie à votre projet.'},
  design: {name: 'Alma', label: 'Design', initial: 'A', intro: 'Alma travaille la forme, les idées visuelles et la lisibilité de vos créations.'},
  analyse: {name: 'Jules', label: 'Analyse', initial: 'J', intro: 'Jules organise les données, évalue les options et fait ressortir ce qui aide à décider.'}
};
const missionStatus = {planning:'Oscar prépare le plan',running:'L’équipe est au travail',reviewing:'Oscar vérifie les résultats',completed:'Mission livrée',needs_review:'Votre attention est nécessaire',failed:'La mission a rencontré un problème',cancelled:'Mission arrêtée'};
const taskStatus = {queued:'À venir',working:'En cours',reviewing:'Vérification',revising:'À améliorer',approved:'Validé',needs_review:'À vérifier',failed:'Interrompu',cancelled:'Arrêté'};
const runningStatuses = new Set(['planning','running','reviewing']);
let state = {providers:[], missions:[], active:null};
const routeParams = new URLSearchParams(location.search);
let selectedId = /^[a-zA-Z0-9-]+$/.test(routeParams.get('mission') || '') ? routeParams.get('mission') : null;
let pendingTemplate = routeParams.get('template');
let mission = null;
let creating = false;
let browsingNew = routeParams.has('new');
let eventSource = null;
let refreshSequence = 0;
let lastAnnouncement = '';
let openedRole = null;
let lastMissionSignature = '';
let fetchErrorCount = 0;
let providerInitialized = false;
let pixelWorld = null;
let animationPaused = false;
let missionWizard = null;
let coffeeDialog = null;
let openedQuip = "";
const QUIPS = {oscar:["J’ai un plan. Le café, c’est le plan B.","Je recrute les talents. Je garde les biscuits."],recherche:["J’ai recoupé mes sources. Même celle du café.","Le premier lien était un chat. J’ai poursuivi l’enquête."],redaction:["Je pose une virgule et j’arrive.","Un café, deux adjectifs. Pas l’inverse."],code:["Chez moi, ça marche. Chez toi, je vais vérifier.","Le bug était entre la chaise et la cafetière."],design:["Encore deux pixels à gauche… parfait.","Le café manque un peu de contraste."],analyse:["Je compte les cafés. Pour la science.","Selon mon tableau, il est l’heure de faire un tableau."]};

function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined && value !== null) el.textContent = String(value);
  return el;
}
function roleOf(value) {
  const key = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
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
function providerName(id) { return id === 'demo' ? 'Démonstration sans IA' : state.providers.find(p => p.id === id)?.name || (id === 'claude' ? 'Claude' : id === 'codex' ? 'Codex' : 'Moteur local'); }
function isRunning(value) { return !!value && runningStatuses.has(value.status); }
function activeMissions(){return (Array.isArray(state.activeMissions)?state.activeMissions:state.active?[state.active]:[]).filter(isRunning);}
function openAnotherOffice(templateId){if(activeMissions().length>=4){showError('Quatre missions sont déjà en cours. Attendez une livraison avant d’ouvrir une autre équipe.');return;}const url=new URL(location.href);url.search='';url.searchParams.set('new','1');if(templateId)url.searchParams.set('template',templateId);window.open(url.href,'_blank','noopener');}
function openGuidedTemplate(template){$('guided-provider').value=$('provider-select').value;$('mission-wizard-dialog').showModal();missionWizard.open(template.id);}
function dateLabel(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-BE',{day:'numeric',month:'short'});
}
function timeLabel(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
}
function announce(message) { if(message && message !== lastAnnouncement) { $('live-announcement').textContent = message; lastAnnouncement = message; } }
function showError(message) { $('global-error').textContent = message; $('global-error').hidden = !message; }
async function request(url, options) {
  const response = await fetch(url, {credentials:'same-origin',...options});
  let data;
  try { data = await response.json(); } catch { throw new Error('L’atelier a renvoyé une réponse inattendue. Réessayez dans un instant.'); }
  if (!response.ok) throw new Error(data.error || 'Cette action n’a pas pu être réalisée.');
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
function updateForm() {
  const provider = state.providers.find(p => p.id === $('provider-select').value);
  const available = provider?.available;
  const active = isRunning(mission);
  const atCapacity = activeMissions().length >= (state.maxConcurrentMissions || 4);
  const authMessage = provider?.auth?.loggedIn === false ? 'Connexion à renouveler dans votre application.' : provider?.auth?.loggedIn === true ? 'Connexion détectée · votre abonnement local' : 'Connexion vérifiée au lancement de la mission.';
  const message = provider?.message || (available ? `${provider.name || providerName(provider.id)}${provider.version ? ` ${provider.version}` : ''} · ${authMessage}` : state.providers.length ? 'Ce moteur n’est pas disponible. Connectez-vous à son application, puis relancez l’atelier.' : 'Vérification de vos outils locaux…');
  $('provider-message').textContent = message;
  $('provider-message').classList.toggle('unavailable', !available || provider?.auth?.loggedIn === false);
  $('launch-button').disabled = creating || !available || active || atCapacity;
  $('launch-button').firstElementChild.textContent = creating ? 'Oscar prépare l’atelier…' : active ? 'Cette mission est en cours' : atCapacity ? 'Quatre équipes déjà au travail' : 'Lancer la mission';
  $('demo-button').disabled = creating || active || atCapacity;
  $('new-mission').lastChild.textContent = activeMissions().length ? ' Créer une autre mission' : ' Nouvelle mission';
  $('new-mission').disabled = creating || atCapacity;
  $('provider-select').disabled = creating || active;
  $('mission-input').disabled = creating;
  const login = state.logins?.[provider?.id];
  $('connect-provider').hidden = !provider?.available;
  $('connect-provider').disabled = login?.status === 'connecting' || active;
  $('connect-provider').textContent = login?.status === 'connecting' ? 'Connexion en cours dans le navigateur…' : provider?.auth?.loggedIn ? 'Renouveler la connexion ↗' : 'Se connecter dans le navigateur ↗';
  $('login-message').hidden = !login?.message;
  $('login-message').textContent = login?.message || '';
}
function renderHistory() {
  $('mission-count').textContent = state.missions.length;
  const history = $('mission-history');
  history.replaceChildren();
  if (!state.missions.length) { history.append(node('p','history-empty','L’atelier attend votre première idée.')); return; }
  for(const item of state.missions) {
    const button = node('button','history-item');
    button.type = 'button';
    button.dataset.status = item.status || '';
    button.classList.toggle('selected', item.id === selectedId);
    if(item.id === selectedId) button.setAttribute('aria-current','true');
    button.append(node('i'));
    const copy = node('span');
    copy.append(node('strong','',item.title || item.prompt || 'Nouvelle mission'),node('small','',`${dateLabel(item.createdAt)}${item.provider ? ` · ${providerName(item.provider)}` : ''}`));
    button.append(copy);
    button.addEventListener('click',()=>selectMission(item.id));
    history.append(button);
  }
}
function renderScene() {
  const busy = isRunning(mission);
  if (!pixelWorld) {
    pixelWorld = new PixelWorld($('pixel-canvas'), {
      onSelect: (role, taskId) => openMember(role, taskId),
      onStatus: text => { $('pixel-world-status').textContent = String(text).slice(0, 150); },
      onInteract: (kind) => { if(kind==='coffee') coffeeDialog?.open(); }
    });
    window.__oscarWorld = pixelWorld;
  }
  pixelWorld.update(mission);
  $('atelier-scene').dataset.mode = mission?.provider === 'demo' ? 'demo' : busy ? 'live' : 'idle';
  $('pixel-mode').textContent = mission?.provider === 'demo' ? 'DÉMO SIMULÉE' : busy ? 'EN MISSION' : 'AU REPOS';
  const pill = $('scene-live');
  pill.classList.toggle('busy',busy);
  pill.lastChild.textContent = busy ? ' Au travail' : mission?.status === 'completed' ? ' Mission livrée' : ' Prêt à recruter';
  $('scene-caption').textContent = busy ? mission.phase || missionStatus[mission.status] : mission?.status === 'completed' ? 'Les rapports sont rendus. Une pause café bien méritée.' : 'Oscar attend votre mission pour faire venir les bons spécialistes.';
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
  list.replaceChildren();
  for(const task of mission?.tasks || []) {
    const info=getRole(task.role);
    const button=node('button','task-row');
    button.type='button';
    button.append(node('span','task-avatar',info.initial));
    const main=node('span','task-main');
    main.append(node('span','task-title',task.title || info.label));
    main.append(node('span','task-subtitle',`${info.name}${task.activity ? ` · ${String(task.activity).slice(0,150)}` : ` · ${info.label}`}`));
    button.append(main,node('span',`task-state ${task.status || ''}`,taskStatus[task.status] || task.status || 'À venir'));
    button.addEventListener('click',()=>openMember(roleOf(task.role),task.id));
    list.append(button);
  }
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
    link.target='_blank';link.rel='noopener noreferrer';
    link.append(node('i','','▤'));
    const text=node('span');
    text.append(node('strong','',file.path),node('small','',Number.isFinite(file.size) ? file.size < 1024 ? `${file.size} octets` : `${Math.round(file.size/1024)} Ko` : 'Fichier de la mission'));
    link.append(text,node('b','','↗'));$('file-list').append(link);
  }
  const oldOpen=new Set([...$('report-list').querySelectorAll('details[open]')].map(el=>el.dataset.task));
  $('report-list').replaceChildren();
  for(const task of reports) {
    const info=getRole(task.role);
    const detail=node('details','report-item');
    detail.dataset.task=task.id;
    detail.open=oldOpen.has(String(task.id));
    detail.append(node('summary','',`${info.name} · ${task.title || info.label}`));
    if(task.review && !task.review.approved && task.review.feedback) detail.append(node('p','report-review',`Retour d’Oscar : ${task.review.feedback}`));
    detail.append(node('pre','report-content',task.report));
    $('report-list').append(detail);
  }
}
function renderMission() {
  $('demo-banner').hidden=mission?.provider !== 'demo';
  $('mission-placeholder').hidden=!!mission;
  $('mission-overview').hidden=!mission;
  $('mission-prompt').textContent=mission?.prompt || '';
  $('mission-status').textContent=mission ? mission.phase || missionStatus[mission.status] || mission.status : '';
  $('mission-status').classList.toggle('problem',!!mission && ['failed','needs_review','cancelled'].includes(mission.status));
  $('mission-provider').textContent=mission ? `${providerName(mission.provider)} · ${dateLabel(mission.createdAt)} à ${timeLabel(mission.createdAt)}` : '';
  $('stop-mission').hidden=!isRunning(mission);
  renderPhase();renderTasks();renderEvents();renderDeliveries();renderScene();
  if(mission) announce(`${mission.title || 'Mission'} : ${missionStatus[mission.status] || mission.phase || mission.status}`);
  if(openedRole && $('member-dialog').open) renderMember(openedRole);
}
function renderAll() { renderHistory();renderProviders();renderMission(); }
async function selectMission(id) {
  browsingNew=false;selectedId=id;history.replaceState(null,'',`/?mission=${encodeURIComponent(id)}`);
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
  if(pendingTemplate && browsingNew && state.providers.length){const template=MISSION_TEMPLATES.find(t=>t.id===pendingTemplate);pendingTemplate=null;if(template)openGuidedTemplate(template);}
}
function newMission({forceLocal=false}={}) {
  if(!forceLocal && isRunning(mission)){openAnotherOffice();return;}
  history.replaceState(null,'','/?new=1');
  ++refreshSequence;selectedId=null;mission=null;browsingNew=true;lastMissionSignature='';
  $('form-error').hidden=true;
  $('mission-placeholder').lastElementChild.firstElementChild.textContent='Une équipe prête à se mettre au travail';
  renderAll();$('mission-input').focus();
}
async function launch(provider) {
  if(creating || isRunning(mission) || activeMissions().length>=4) return;
  const prompt=$('mission-input').value.trim();
  if(provider!=='demo' && !prompt) { $('mission-input').reportValidity();return; }
  creating=true;$('form-error').hidden=true;updateForm();
  try {
    const detail=await request('/api/missions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt || 'Imaginer le lancement d’un café de quartier : positionnement, idées de communication et une page de présentation.',provider})});
    selectedId=detail.id;mission=detail;state.active=detail;state.activeMissions=[...activeMissions().filter(m=>m.id!==detail.id),detail];browsingNew=false;history.replaceState(null,'',`/?mission=${encodeURIComponent(detail.id)}`);
    const previous=state.missions.findIndex(m=>m.id===detail.id);
    if(previous<0) state.missions.unshift(detail);else state.missions[previous]=detail;
    showError('');renderAll();
    if(window.matchMedia('(max-width:680px)').matches) $('scene-title').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
  } catch(error) { $('form-error').textContent=error.message;$('form-error').hidden=false; }
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
  $('member-title').textContent=info.name;
  $('member-role').textContent=info.label;
  $('member-quip').textContent=openedQuip;
  $('member-intro').textContent=info.intro || 'Un membre de l’équipe d’Oscar.';
  const list=$('member-tasks');list.replaceChildren();
  const tasks=role==='oscar' ? [] : (mission?.tasks || []).filter(t=>roleOf(t.role)===role);
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
function openMember(role,taskId) {
  openedRole=role;const quips=QUIPS[role] || QUIPS.oscar;openedQuip=quips[Math.floor(Math.random()*quips.length)];renderMember(role,taskId);
  const dialog=$('member-dialog');
  if(!dialog.open) dialog.showModal();
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
$('provider-select').addEventListener('change',updateForm);
$('demo-button').addEventListener('click',()=>launch('demo'));
$('new-mission').addEventListener('click',()=>{const running=isRunning(mission);newMission();if(!running)$('mission-library').scrollIntoView({behavior:'smooth',block:'start'});});
$('free-mission').addEventListener('click',newMission);
$('stop-mission').addEventListener('click',stopMission);
$('close-dialog').addEventListener('click',()=>$('member-dialog').close());
$('member-dialog').addEventListener('click',event=>{if(event.target===$('member-dialog')) {const box=$('member-dialog').getBoundingClientRect();if(event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom) $('member-dialog').close();}});
$('member-dialog').addEventListener('close',()=>{openedRole=null;});
document.querySelectorAll('[data-pixel-prop]').forEach(button=>button.addEventListener('click',()=>pixelWorld?.interact(button.dataset.pixelProp)));
document.querySelectorAll('[data-pixel-role]').forEach(button=>button.addEventListener('click',()=>openMember(button.dataset.pixelRole)));
$('pixel-pause').addEventListener('click',()=>{animationPaused=!animationPaused;pixelWorld.setPaused(animationPaused);$('pixel-pause').setAttribute('aria-pressed',String(animationPaused));$('pixel-pause').textContent=animationPaused?'Reprendre les animations':'Pause animations';$('atelier-scene').dataset.paused=String(animationPaused);});
$('pixel-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('atelier-scene').requestFullscreen();}catch{$('pixel-world-status').textContent='Utilisez le zoom du navigateur pour agrandir le bureau.';}});
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{$('mission-input').value=button.dataset.prompt;$('mission-input').focus();}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshState();});
window.addEventListener('online',refreshState);
window.addEventListener('beforeunload',()=>{eventSource?.close();pixelWorld?.destroy();});

coffeeDialog = new CoffeeDialog({recipient:'renaud2005@gmail.com'});
missionWizard = new MissionWizard($('mission-wizard-host'), {
  onComplete: (prompt) => {
    const provider = $('guided-provider').value;
    $('mission-wizard-dialog').close(); newMission({forceLocal:true});
    $('mission-input').value = prompt; $('provider-select').value = provider;
    launch(provider);
  },
  onCancel: () => $('mission-wizard-dialog').close(),
});
for (const template of MISSION_TEMPLATES) {
  const button=node('button','mission-template');button.type='button';
  button.append(node('span','mission-template-icon',template.icon));
  const copy=node('span','mission-template-copy');copy.append(node('strong','',template.title),node('small','',template.description));button.append(copy,node('span','mission-template-arrow','↗'));
  button.addEventListener('click',()=>{
    if(activeMissions().length>=4){showError('Quatre missions sont déjà en cours. Attendez une livraison pour lancer une autre équipe.');return;}
    if(isRunning(mission)){openAnotherOffice(template.id);return;}
    openGuidedTemplate(template);
  });
  $('mission-template-grid').append(button);
}
$('close-wizard').addEventListener('click',()=>{$('mission-wizard-dialog').close();missionWizard.close();});
$('open-missions-folder').addEventListener('click',async()=>{try{await request('/api/open-data',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch(error){showError(error.message);}});
$('connect-provider').addEventListener('click',async()=>{
  try{await request(`/api/providers/${encodeURIComponent($('provider-select').value)}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await refreshState();}catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;}
});

renderAll();
refreshState();
connectEvents();
