import {deliveryPreviewEntries} from './delivery-preview.js';

const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = String(text); return element; };
const safeText = (value, length = 2000) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, length) : '';
function portrait() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
  const shape = (tag, attributes) => { const element = document.createElementNS(svg.namespaceURI, tag); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value); svg.append(element); };
  shape('circle', { cx: 50, cy: 50, r: 49, fill: '#e7eedd' }); shape('path', { d: 'M13 100Q12 64 50 64Q87 64 87 100Z', fill: '#4e765d' }); shape('rect', { x: 43, y: 54, width: 14, height: 19, rx: 5, fill: '#e4ac85' }); shape('ellipse', { cx: 50, cy: 40, rx: 23, ry: 27, fill: '#edbd99' }); shape('path', { d: 'M27 43Q15 11 49 11Q82 10 74 44L68 30Q51 38 39 24L31 44Z', fill: '#5f5042' }); shape('circle', { cx: 41, cy: 43, r: 2, fill: '#334334' }); shape('circle', { cx: 59, cy: 43, r: 2, fill: '#334334' }); shape('path', { d: 'M43 54Q50 61 58 53', fill: 'none', stroke: '#995e48', 'stroke-width': '2', 'stroke-linecap': 'round' }); shape('path', { d: 'M42 69L58 69L52 77L55 94H45L48 77Z', fill: '#ddc99a' });
  return svg;
}
function fileUrl(mission, file) {
  if (!/^[a-z\d-]{1,100}$/i.test(mission.id || '') || typeof file?.path !== 'string' || file.path.length > 512 || /[\x00-\x1f\x7f\\:?<>|]/.test(file.path) || file.path.split('/').some(part => !part || part.startsWith('.'))) return null;
  return `/api/missions/${encodeURIComponent(mission.id)}/files/${file.path.split('/').map(encodeURIComponent).join('/')}`;
}
function summary(mission) {
  const result = safeText(mission.result).replace(/^#{1,6}\s*/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/```[^\n]*\n?/g, '').trim();
  return { userContent: Boolean(result), text: result || (mission.status === 'completed' ? 'La livraison et les contributions de l’équipe sont disponibles. Vous pouvez les consulter et ouvrir leurs fichiers.' : 'Le travail est conservé. Consultez la livraison pour voir les points à reprendre avant d’utiliser ou de publier le résultat.') };
}

export class CompletionDialog {
  constructor({ onDelivery = () => {}, onFolder, onFile, onImprove = () => {}, onNew = () => {}, onView, onPublish, onResume, createPreview, onClose = () => {}, avatar } = {}) {
    Object.assign(this, { onDelivery, onFolder, onFile, onImprove, onNew, onView, onPublish, onResume, createPreview, onClose, avatar }); this.epoch = 0; this.pendingRecoveries = new Set();
    this.dialog = node('dialog', 'completion-dialog'); this.dialog.id = 'completion-dialog'; this.dialog.setAttribute('aria-labelledby', 'completion-title');
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.closed(); }); document.body.append(this.dialog);
  }
  button(label, className, action) { const button = node('button', className, label); button.type = 'button'; button.addEventListener('click', action); return button; }
  render() {
    this.preview?.destroy();this.preview=null;
    const mission = this.mission, validated = mission.status === 'completed', failed = mission.status === 'failed', cancelled = mission.status === 'cancelled', demo = mission.provider === 'demo';
    const header = node('header', 'completion-header'); const lead = node('div', 'completion-lead');
    const image = node('div', 'completion-portrait'); let supplied;
    try { supplied = typeof this.avatar === 'function' ? this.avatar(mission) : this.avatar; } catch { /* Use Oscar's local portrait. */ }
    image.append(supplied?.nodeType ? supplied.cloneNode(true) : portrait());
    const speaker = node('div', 'completion-speaker'); speaker.append(node('strong', '', 'Oscar'), node('span', '', 'Votre chef de projet')); lead.append(image, speaker);
    const close = this.button('×', 'completion-close', () => this.close()); close.setAttribute('aria-label', 'Fermer le bilan de la mission'); header.append(lead, close);
    const body = node('div', 'completion-body'); const badge = node('span', `completion-badge${validated ? '' : ' completion-badge-review'}`, demo ? 'Visite simulée · aucun appel à un modèle' : validated ? 'Livraison validée par Oscar' : failed || cancelled ? 'Travaux conservés' : 'Livraison à vérifier'); body.append(badge);
    const title = node('h2', '', validated ? 'Bravo, c’est prêt !' : failed ? 'Mission interrompue' : cancelled ? 'Mission arrêtée' : 'Un point reste à revoir'); title.id = 'completion-title'; title.tabIndex = -1;
    const intro = node('p', 'completion-intro', demo ? 'Cette visite présente des créations et une validation simulées.' : validated ? 'L’équipe a terminé son travail. Oscar a relu et assemblé votre livraison.' : failed ? 'Le travail n’est pas terminé. Les fichiers déjà créés sont conservés.' : cancelled ? 'La mission a été arrêtée. Les fichiers déjà créés restent disponibles.' : 'Oscar a gardé les résultats et précisé les points qui demandent une reprise.');
    const project = node('p', 'completion-project', safeText(mission.title || mission.prompt || 'Votre projet', 160)); project.setAttribute('data-no-translate', ''); body.append(title, intro, project);
    const assignment=node('details','completion-assignment');assignment.append(node('summary','',validated?'Tâche terminée':'Travaux conservés'));const prompt=node('p','',safeText(mission.prompt,16000));prompt.setAttribute('data-no-translate','');assignment.append(prompt);body.append(assignment);
    if(mission.error){const issue=node('p','completion-problem',safeText(mission.error,2000));issue.setAttribute('data-no-translate','');body.append(issue);}
    if(typeof this.createPreview==='function')this.preview=this.createPreview(body,mission,{deferBrowser:true});
    const tasks = Array.isArray(mission.tasks) ? mission.tasks : [], files = Array.isArray(mission.files) ? mission.files : [];
    const corrections = tasks.reduce((count, task) => count + (Number.isFinite(task.attempt) ? Math.max(0, Math.min(20, task.attempt - 1)) : 0), 0);
    const stats = node('div', 'completion-stats');
    for (const [value, label] of [[tasks.filter(task => task.status === 'approved').length, demo ? 'contributions simulées' : 'contributions approuvées'], [files.length, 'fichiers disponibles'], ...(corrections ? [[corrections, demo ? 'reprises simulées' : 'reprises demandées']] : [])]) { const stat = node('div', 'completion-stat'); stat.append(node('strong', '', value), node('span', '', label)); stats.append(stat); }
    body.append(stats);
    const report = node('section', 'completion-summary'); report.append(node('h3', '', validated ? 'Le mot d’Oscar' : 'Ce qu’il reste à vérifier')); const reportData = summary(mission), reportText = node('p', '', reportData.text); if (reportData.userContent) reportText.setAttribute('data-no-translate', ''); report.append(reportText); body.append(report);
    const visibleFiles = files.map(file => ({ file, url: fileUrl(mission, file) })).filter(item => item.url).slice(0, 4);
    if (visibleFiles.length) {
      const section = node('section', 'completion-files'); section.append(node('h3', '', 'Quelques fichiers à ouvrir')); const links = node('div', 'completion-file-list');
      for (const { file, url } of visibleFiles) {
        const row = node('div', 'completion-file-row');
        const link = typeof this.onFile === 'function' ? this.button('', 'completion-file', () => this.act('onFile', file)) : node('a', 'completion-file');
        if (link.tagName === 'A') { link.href = url; link.download = file.path.split('/').at(-1); }
        link.append(node('span', 'completion-file-icon', typeof this.onFile === 'function' ? '↗' : '↙'));
        const copy = node('span', 'completion-file-copy'), name = node('span', '', file.path); name.setAttribute('data-no-translate', ''); copy.append(name);
        if (typeof this.onFile === 'function') copy.append(node('small', 'completion-file-mode', 'Aperçu'));
        link.append(copy); row.append(link);
        if (typeof this.onFile === 'function') { const download = node('a', 'completion-file-download', '↓'); download.href = url; download.download = file.path.split('/').at(-1); download.title = 'Télécharger le fichier'; download.setAttribute('aria-label', 'Télécharger le fichier'); row.append(download); }
        links.append(row);
      }
      section.append(links); body.append(section);
    }
    const folder = node('section', 'completion-folder'); folder.append(node('span', 'completion-folder-icon', '⌁')); const folderCopy = node('div'); folderCopy.append(node('h3', '', 'Votre mission et son dossier'));
    if (mission.folderName) { const name = node('strong', '', safeText(mission.folderName, 250)); name.setAttribute('data-no-translate', ''); folderCopy.append(name); }
    if (mission.workDirectory) { const full = node('p', 'completion-folder-path', safeText(mission.workDirectory, 1500)); full.setAttribute('data-no-translate', ''); folderCopy.append(full); }
    else folderCopy.append(node('p', 'completion-folder-path', 'Le chemin exact sera disponible en rouvrant cette mission.'));
    this.folderButton = this.button('Ouvrir le dossier de tous les fichiers ↗', 'completion-action completion-folder-open', () => this.openFolder()); this.folderButton.disabled=typeof this.onFolder!=='function';folderCopy.append(this.folderButton);folder.append(folderCopy); body.append(folder);
    this.error = node('p', 'completion-error'); this.error.hidden = true; this.error.setAttribute('role', 'alert'); body.append(this.error);
    const browser=deliveryPreviewEntries(mission).length>0,canResume=!validated&&!demo&&(mission.recovery?.canResume===true||mission.recovery?.canRecheck===true)&&typeof this.onResume==='function';
    const actions = node('footer', 'completion-actions');
    if(browser&&typeof this.onView==='function')actions.append(this.button(validated?'Tester le jeu ou le site ↗':'Tester l’aperçu partiel ↗','completion-action completion-action-primary',()=>this.act('onView')));
    else actions.append(this.button(validated?'Voir le résultat ↗':'Voir les fichiers conservés ↗', 'completion-action completion-action-primary', () => this.act(validated&&typeof this.onView==='function'?'onView':'onDelivery')));
    this.recoveryButton=null;
    if(canResume){this.recoveryButton=this.button(mission.recovery?.canRecheck===true?'Faire relire les corrections':'Reprendre avec Oscar','completion-action completion-action-primary',()=>this.runRecovery());this.recoveryButton.disabled=this.pendingRecoveries.has(mission.id);actions.append(this.recoveryButton);}
    if(validated&&!demo&&typeof this.onPublish==='function')actions.append(this.button('Publier le projet ↗','completion-action',()=>this.act('onPublish')));
    actions.append(this.button('Ouvrir le dossier de tous les fichiers ↗','completion-action',()=>this.openFolder()));
    const secondary=node('div','completion-secondary-actions');secondary.append(this.button('Améliorer avec Oscar','completion-action completion-action-new',()=>this.act('onImprove')),this.button('Une nouvelle mission','completion-action completion-action-new',()=>this.act('onNew')));body.append(secondary);
    this.dialog.replaceChildren(header, body, actions); this.dialog.classList.toggle('completion-needs-review', !validated);
  }
  async openFolder() {
    if (this.folderBusy || typeof this.onFolder !== 'function') return;
    const epoch = this.epoch; this.folderBusy = true; this.folderButton.disabled = true; this.error.hidden = true;
    try { await this.onFolder(this.mission.id); if(epoch===this.epoch&&this.dialog.open){this.error.textContent='Le dossier a été ouvert sur votre ordinateur.';this.error.hidden=false;} }
    catch { if (epoch === this.epoch && this.dialog.open) { this.error.textContent = 'Le dossier n’a pas pu être ouvert. Vos fichiers restent accessibles dans la livraison.'; this.error.hidden = false; } }
    finally { this.folderBusy = false; if (epoch === this.epoch) this.folderButton.disabled = false; }
  }
  async act(name, ...details) {
    const mission = this.mission; this.close();
    try { await this[name](mission, ...details); }
    catch { this.open(mission); this.error.textContent = 'Cette action n’a pas abouti. Votre mission et ses fichiers sont conservés.'; this.error.hidden = false; }
  }
  async runRecovery() {
    const mission=this.mission,epoch=this.epoch;
    if(this.destroyed||!this.dialog.open||typeof this.onResume!=='function'||this.pendingRecoveries.has(mission.id)||mission.recovery?.canResume!==true&&mission.recovery?.canRecheck!==true)return;
    this.pendingRecoveries.add(mission.id);this.recoveryButton.disabled=true;this.error.hidden=true;
    try{await this.onResume(mission);if(epoch===this.epoch&&this.dialog.open)this.close();}
    catch{if(epoch===this.epoch&&this.dialog.open){this.error.textContent='Cette action n’a pas abouti. Votre mission et ses fichiers sont conservés.';this.error.hidden=false;}}
    finally{this.pendingRecoveries.delete(mission.id);if(epoch===this.epoch&&this.recoveryButton)this.recoveryButton.disabled=false;}
  }
  open(mission) {
    if (this.destroyed || !mission || !['completed', 'needs_review', 'failed', 'cancelled'].includes(mission.status)) return;
    const signature = `${mission.id}:${mission.status}:${mission.updatedAt || ''}`;
    if (this.dialog.open && this.signature === signature) return;
    if (!this.dialog.open) this.returnFocus = document.activeElement;
    this.signature = signature; this.mission = mission; this.epoch++; this.notified = false; this.render();
    if (!this.dialog.open) this.dialog.showModal(); this.dialog.querySelector('#completion-title').focus({ preventScroll: true });
  }
  closed() { this.preview?.destroy();this.preview=null;if (this.notified) return; this.notified = true; this.epoch++; if (!this.destroyed) { if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true }); this.onClose(); } }
  close() { if (this.dialog.open) { this.dialog.close(); this.closed(); } }
  destroy() { this.preview?.destroy();this.preview=null;this.destroyed = true; if (this.dialog.open) this.dialog.close(); this.dialog.remove(); }
}
