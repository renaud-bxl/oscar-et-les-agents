import {getLocale,translate} from './i18n.js';
import messages from './translations-delivery-library.js';

const ACTIVE=new Set(['planning','running','reviewing','assembling']);
const ATTENTION=new Set(['needs_review','failed']);
const FILTERS=['all','completed','active','attention'];
const LABELS={planning:'En préparation',running:'Au travail',reviewing:'En vérification',assembling:'Assemblage',completed:'Livré',needs_review:'À vérifier',failed:'Interrompu',cancelled:'Arrêté'};
const LOCALES={fr:'fr-BE',en:'en-GB',nl:'nl-BE'};
const clean=(value,max=16000)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'').trim().slice(0,max):'';
const searchable=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLocaleLowerCase().replace(/\s+/gu,' ').trim();
const timestamp=value=>{const number=typeof value==='number'?value:typeof value==='string'&&value?Date.parse(value):NaN;return Number.isFinite(number)&&number>=0&&Number.isFinite(new Date(number).getTime())?number:null;};
const countFiles=mission=>Number.isSafeInteger(mission.filesCount)&&mission.filesCount>=0?mission.filesCount:Array.isArray(mission.files)?mission.files.length:null;
const text=(node,value)=>{const next=String(value??'');if(node.textContent!==next)node.textContent=next;};
const tone=id=>{let value=0;for(const c of id)value=(value*31+c.charCodeAt(0))>>>0;return String(value%5);};
let sequence=0;

export const deliveryLibraryText=(source,locale=getLocale())=>messages[source]?.[locale]||translate(source,locale);

/** Search summaries only. No file preview, account access or task execution. */
export function selectDeliveryProjects(snapshot,{query='',status='all',locale=getLocale()}={}){
  const missions=Array.isArray(snapshot)?snapshot:Array.isArray(snapshot?.missions)?snapshot.missions:[],seen=new Set(),lang=LOCALES[locale]?locale:'fr';
  const tr=source=>deliveryLibraryText(source,lang),words=searchable(query).split(' ').filter(Boolean),filter=FILTERS.includes(status)?status:'all';
  return missions.map((mission,index)=>{
    if(!mission||typeof mission!=='object'||typeof mission.id!=='string'||!mission.id||seen.has(mission.id))return null;
    seen.add(mission.id);
    const state=typeof mission.status==='string'?mission.status:'unknown',demo=mission.provider==='demo';
    const label=demo&&state==='completed'?'Démonstration terminée':LABELS[state]||'État non renseigné';
    const title=clean(mission.title,500)||tr('Projet sans titre'),prompt=clean(mission.prompt),folderName=clean(mission.folderName,500),createdAt=timestamp(mission.createdAt),updatedAt=timestamp(mission.updatedAt);
    const dateLabel=createdAt===null?tr('Date non renseignée'):new Intl.DateTimeFormat(LOCALES[lang],{day:'numeric',month:'long',year:'numeric'}).format(createdAt);
    const source=[title,prompt,folderName,state,mission.provider,dateLabel,...['fr','en','nl'].map(language=>deliveryLibraryText(label,language)),...(demo?['fr','en','nl'].map(language=>deliveryLibraryText('Démonstration',language)):[])].join(' ');
    if(filter==='completed'&&state!=='completed'||filter==='active'&&!ACTIVE.has(state)||filter==='attention'&&!ATTENTION.has(state)||!words.every(word=>searchable(source).includes(word)))return null;
    const compact=prompt.replace(/\s+/gu,' '),excerpt=compact?compact.length>170?compact.slice(0,169)+'…':compact:tr('Aucun descriptif enregistré.');
    return{id:mission.id,title,prompt,excerpt,folderName,status:state,provider:clean(mission.provider,80),createdAt,updatedAt,filesCount:countFiles(mission),hasRunnable:mission.hasRunnable===true,demo,stateLabel:tr(label),dateLabel,_index:index};
  }).filter(Boolean).sort((a,b)=>(b.createdAt??-Infinity)-(a.createdAt??-Infinity)||a._index-b._index).map(({_index,...project})=>project);
}

/** Reconciles persistent cards and controls, preserving drafts and focus on SSE. */
export class DeliveryLibrary{
  constructor({container,onOpen=()=>{}}={}){
    if(!container?.ownerDocument||typeof container.append!=='function')throw new TypeError('Un conteneur est nécessaire pour afficher les projets.');
    Object.assign(this,{container,document:container.ownerDocument,onOpen});this.cards=new Map();this.missions=[];this.selectedId=null;this.query='';this.status='all';
    const node=(tag,cls='')=>{const element=this.document.createElement(tag);element.className=cls;return element;},uid=`delivery-library-${++sequence}`;
    this.root=node('section','delivery-library');this.root.dataset.noTranslate='';
    this.header=node('header','delivery-library-header');this.title=node('h2');this.intro=node('p');this.header.append(this.title,this.intro);
    this.controls=node('div','delivery-library-controls');this.searchLabel=node('label','delivery-library-search');this.searchCopy=node('span');this.search=node('input');this.search.type='search';this.search.id=uid+'-search';this.searchLabel.htmlFor=this.search.id;this.search.setAttribute('autocomplete','off');this.search.setAttribute('spellcheck','false');this.searchLabel.append(this.searchCopy,this.search);
    this.filterLabel=node('label','delivery-library-filter');this.filterCopy=node('span');this.filter=node('select');this.filter.id=uid+'-filter';this.filterLabel.htmlFor=this.filter.id;this.options=new Map();
    for(const value of FILTERS){const option=node('option');option.value=value;this.options.set(value,option);this.filter.append(option);}this.filter.value='all';this.filterLabel.append(this.filterCopy,this.filter);this.controls.append(this.searchLabel,this.filterLabel);
    this.count=node('p','delivery-library-count');this.count.setAttribute('role','status');this.count.setAttribute('aria-live','polite');
    this.grid=node('ul','delivery-library-grid');this.grid.id=uid+'-projects';this.search.setAttribute('aria-controls',this.grid.id);this.filter.setAttribute('aria-controls',this.grid.id);
    this.empty=node('div','delivery-library-empty');this.emptyMark=node('span','delivery-library-empty-folder');this.emptyMark.setAttribute('aria-hidden','true');this.emptyTitle=node('h3');this.emptyHint=node('p');this.reset=node('button','delivery-library-reset');this.reset.type='button';this.empty.append(this.emptyMark,this.emptyTitle,this.emptyHint,this.reset);
    this.root.append(this.header,this.controls,this.count,this.grid,this.empty);container.append(this.root);
    this.onInput=()=>{this.query=this.search.value;this.render();};this.onFilter=()=>{this.status=this.filter.value;this.render();};this.onReset=()=>{this.query='';this.status='all';this.search.value='';this.filter.value='all';this.render();this.focusSearch();};this.onLanguage=()=>this.render();
    this.search.addEventListener('input',this.onInput);this.filter.addEventListener('change',this.onFilter);this.reset.addEventListener('click',this.onReset);this.document.addEventListener('oscar:language',this.onLanguage);this.render();
  }
  update(missions,{selectedId=this.selectedId}={}){
    if(this.destroyed)return;this.missions=Array.isArray(missions)?missions:Array.isArray(missions?.missions)?missions.missions:[];this.selectedId=selectedId??null;this.render();
  }
  createCard(project){
    const node=(tag,cls='')=>{const element=this.document.createElement(tag);element.className=cls;return element;};
    const item=node('li','delivery-library-item'),button=node('button','delivery-project-card');button.type='button';button.dataset.missionId=project.id;button.dataset.tone=tone(project.id);
    const top=node('span','delivery-project-top'),art=node('span','delivery-project-folder');art.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)art.append(node('span','delivery-project-paper'));
    const badge=node('span','delivery-project-status');top.append(art,badge);
    const title=node('span','delivery-project-title'),excerpt=node('span','delivery-project-excerpt'),meta=node('span','delivery-project-meta'),date=node('time'),files=node('span','delivery-project-files');meta.append(date,files);
    const folder=node('span','delivery-project-path'),footer=node('span','delivery-project-footer'),engine=node('span','delivery-project-engine'),open=node('span','delivery-project-open'),arrow=node('span','delivery-project-arrow');arrow.setAttribute('aria-hidden','true');arrow.textContent='↗';footer.append(engine,open,arrow);button.append(top,title,excerpt,meta,folder,footer);item.append(button);
    const onClick=()=>{if(!this.destroyed)this.onOpen(project.id);};button.addEventListener('click',onClick);
    const card={item,button,badge,title,excerpt,date,files,folder,engine,open,onClick};this.cards.set(project.id,card);return card;
  }
  render(){
    if(this.destroyed)return;const tr=deliveryLibraryText,projects=selectDeliveryProjects(this.missions,{query:this.query,status:this.status}),allIds=new Set(this.missions.map(mission=>mission?.id)),visibleIds=new Set(projects.map(project=>project.id));
    text(this.title,tr('Tous vos projets'));text(this.intro,tr('Retrouvez chaque mission, ses fichiers et son état.'));text(this.searchCopy,tr('Rechercher un projet'));this.search.placeholder=tr('Nom, idée ou dossier…');text(this.filterCopy,tr('Afficher les projets'));
    for(const[value,label]of Object.entries({all:'Tous les projets',completed:'Livrés',active:'En cours',attention:'À vérifier'}))text(this.options.get(value),tr(label));
    text(this.count,`${projects.length} ${tr(projects.length===1?'projet':'projets')}`);this.grid.setAttribute('aria-label',tr('Dossiers des projets'));this.grid.hidden=projects.length===0;this.empty.hidden=projects.length!==0;
    const filtered=!!this.query.trim()||this.status!=='all';text(this.emptyTitle,tr(this.missions.length?'Aucun projet ne correspond à votre recherche.':'Votre bibliothèque attend sa première mission.'));text(this.emptyHint,tr('Essayez un autre mot ou affichez tous les projets.'));this.emptyHint.hidden=!this.missions.length;this.reset.hidden=!filtered;text(this.reset,tr('Réinitialiser la recherche'));
    for(const[id,card]of this.cards){
      if(!visibleIds.has(id)&&card.item.parentNode){if(card.item.contains?.(this.document.activeElement))this.focusSearch();card.item.remove();}
      if(!allIds.has(id)){card.button.removeEventListener('click',card.onClick);this.cards.delete(id);}
    }
    projects.forEach((project,index)=>{
      const card=this.cards.get(project.id)||this.createCard(project);card.button.dataset.status=project.status;card.button.dataset.demo=String(project.demo);card.button.dataset.selected=String(project.id===this.selectedId);
      if(project.id===this.selectedId)card.button.setAttribute('aria-current','true');else card.button.removeAttribute('aria-current');
      card.button.setAttribute('aria-label',`${tr('Ouvrir le dossier')} : ${project.title} · ${project.stateLabel}`);text(card.badge,project.stateLabel);text(card.title,project.title);text(card.excerpt,project.excerpt);text(card.date,project.dateLabel);
      if(project.createdAt===null)card.date.removeAttribute('datetime');else card.date.setAttribute('datetime',new Date(project.createdAt).toISOString());
      text(card.files,project.filesCount===null?tr('Fichiers non comptés'):`${project.filesCount} ${tr(project.filesCount===1?'fichier':'fichiers')}`);text(card.folder,project.folderName);card.folder.hidden=!project.folderName;
      text(card.engine,project.demo?tr('Démonstration'):project.provider==='codex'?'Codex · ChatGPT':project.provider==='claude'?'Claude Code':project.provider);card.engine.hidden=!project.provider;text(card.open,tr('Ouvrir le dossier'));
      if(this.grid.children[index]!==card.item)this.grid.insertBefore(card.item,this.grid.children[index]||null);
    });
  }
  focusProject(id){const card=this.cards.get(id);if(this.destroyed||!card||card.item.parentNode!==this.grid)return false;card.button.focus({preventScroll:true});return true;}
  focusSearch(){if(this.destroyed)return false;this.search.focus({preventScroll:true});return true;}
  destroy(){
    if(this.destroyed)return;this.destroyed=true;this.search.removeEventListener('input',this.onInput);this.filter.removeEventListener('change',this.onFilter);this.reset.removeEventListener('click',this.onReset);this.document.removeEventListener('oscar:language',this.onLanguage);for(const card of this.cards.values())card.button.removeEventListener('click',card.onClick);this.cards.clear();this.missions=[];this.root.remove();
  }
}
