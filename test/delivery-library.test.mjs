import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DeliveryLibrary,selectDeliveryProjects} from '../public/delivery-library.js';
import {setLocale} from '../public/i18n.js';

const project=(values={})=>({id:'project',title:'Un jeu de café',prompt:'Créer un petit jeu avec des chats.',folderName:'2026-10-21 — Jeu du café',createdAt:Date.UTC(2026,9,21,10),updatedAt:Date.UTC(2026,9,21,12),status:'completed',provider:'codex',filesCount:3,...values});
class Element extends EventTarget{
  constructor(tag,document){super();this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.dataset={};this.attributes=new Map();this.value='';this.hidden=false;this.parentNode=null;this.scrollTop=0;this._text='';}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
  append(...children){for(const child of children)this.insertBefore(child,null);}
  insertBefore(child,before){child.remove();const index=before?this.children.indexOf(before):this.children.length;assert(index>=0);this.children.splice(index,0,child);child.parentNode=this;this.ownerDocument.operations.push(['insert',this,child]);return child;}
  remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.ownerDocument.operations.push(['remove',this.parentNode,this]);this.parentNode=null;}}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  getAttribute(name){return this.attributes.get(name)??null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  focus(){this.ownerDocument.activeElement=this;}
}
class Document extends EventTarget{
  constructor(){super();this.operations=[];this.created=[];this.activeElement=null;}
  createElement(tag){this.created.push(tag);return new Element(tag,this);}
}
function fixture(t){
  const document=new Document(),container=document.createElement('div'),opened=[],library=new DeliveryLibrary({container,onOpen:id=>opened.push(id)});
  t.after(()=>{library.destroy();setLocale('fr');});return{document,container,opened,library};
}

test('the library includes every requested mission, keeps truthful statuses and does not mutate summaries',()=>{
  const missions=['planning','running','reviewing','assembling','completed','needs_review','failed','cancelled','legacy'].map((status,index)=>project({id:status,status,createdAt:1000+index}));missions.push(project({id:'demo',provider:'demo'}));const original=structuredClone(missions),selected=selectDeliveryProjects({missions});
  assert.equal(selected.length,10);assert.deepEqual(missions,original);assert.equal(selected.find(item=>item.id==='failed').stateLabel,'Interrompu');assert.equal(selected.find(item=>item.id==='cancelled').stateLabel,'Arrêté');assert.equal(selected.find(item=>item.id==='demo').stateLabel,'Démonstration terminée');assert.notEqual(selected.find(item=>item.id==='legacy').stateLabel,'Livré');
  assert.deepEqual(selectDeliveryProjects(missions,{status:'active'}).map(item=>item.id),['assembling','reviewing','running','planning']);assert.deepEqual(selectDeliveryProjects(missions,{status:'attention'}).map(item=>item.id),['failed','needs_review']);assert.deepEqual(new Set(selectDeliveryProjects(missions,{status:'completed'}).map(item=>item.id)),new Set(['completed','demo']));
});

test('accent-insensitive multi-term search covers prompts, folders and each interface language without changing personal text',()=>{
  const missions=[project({id:'cafe',title:'Affiche Café',prompt:'De belles couleurs pour notre inauguration.',folderName:'21 octobre — Affiche finale',status:'failed'}),project({id:'book',title:'Livre du soir',prompt:'Une histoire pour enfants',folderName:'21 octobre — Livre jeunesse',status:'completed'})];
  for(const query of ['cafe couleurs','octobre CAFÉ','interrupted inauguration','onderbroken affiche','interrompu finale'])assert.deepEqual(selectDeliveryProjects(missions,{query}).map(item=>item.id),['cafe'],query);
  const english=selectDeliveryProjects(missions,{locale:'en',query:'interrupted'});assert.equal(english[0].stateLabel,'Interrupted');assert.equal(english[0].title,'Affiche Café');assert.equal(english[0].prompt,missions[0].prompt);assert.equal(english[0].folderName,missions[0].folderName);assert.deepEqual(selectDeliveryProjects(missions,{query:'café enfants'}),[]);
});

test('creation-date sorting is stable, missing metadata stays unknown, and duplicate identities never create two folders',()=>{
  const missions=[project({id:'older',createdAt:1000,updatedAt:999999}),project({id:'newer',createdAt:2000}),project({id:'tie',createdAt:2000}),{id:'old-unknown',status:'failed',createdAt:'bad'},{id:'empty',status:'running',filesCount:-1},project({id:'newer',title:'duplicate'}),null,{title:'no identity'}];
  const rows=selectDeliveryProjects(missions);assert.deepEqual(rows.map(item=>item.id),['newer','tie','older','old-unknown','empty']);assert.equal(rows.find(item=>item.id==='old-unknown').filesCount,null);assert.equal(rows.find(item=>item.id==='old-unknown').dateLabel,'Date non renseignée');assert.equal(rows.find(item=>item.id==='empty').title,'Projet sans titre');assert.equal(rows.find(item=>item.id==='empty').excerpt,'Aucun descriptif enregistré.');
  assert.equal(selectDeliveryProjects([project({filesCount:0})])[0].filesCount,0);assert.equal(selectDeliveryProjects([project({filesCount:undefined,files:[{path:'original.png'}]})])[0].filesCount,1);
});

test('identical SSE updates preserve controls, search selection, card identity, focus and scrolling',t=>{
  const {library,container,document}=fixture(t),missions=[project(),project({id:'second',title:'Le deuxième projet',createdAt:1000})];library.update(missions,{selectedId:'project'});
  const root=library.root,search=library.search,filter=library.filter,card=library.cards.get('project');search.value='café';search.selectionStart=2;search.selectionEnd=3;search.focus();search.dispatchEvent(new Event('input'));container.scrollTop=315;library.grid.scrollTop=45;
  document.operations=[];for(let i=0;i<15;i++)library.update(structuredClone(missions),{selectedId:'project'});
  assert.strictEqual(library.root,root);assert.strictEqual(library.search,search);assert.strictEqual(library.filter,filter);assert.strictEqual(library.cards.get('project'),card);assert.strictEqual(document.activeElement,search);assert.equal(search.value,'café');assert.equal(search.selectionStart,2);assert.equal(search.selectionEnd,3);assert.equal(container.scrollTop,315);assert.equal(library.grid.scrollTop,45);assert.equal(document.operations.length,0,'unchanged data never removes, reinserts or rebuilds cards');
  card.button.focus();library.update(missions.map(item=>item.id==='project'?{...item,filesCount:5}:item),{selectedId:'project'});assert.strictEqual(document.activeElement,card.button);assert.equal(card.files.textContent,'5 fichiers');assert.equal(card.button.getAttribute('aria-current'),'true');
});

test('opening a folder uses its own mission identity only after a click, and return-focus helpers keep the chosen filter',t=>{
  const {library,opened,document}=fixture(t),missions=[project({id:'a'}),project({id:'b',title:'Un autre dossier',createdAt:1000})];library.update(missions,{selectedId:'a'});assert.deepEqual(opened,[]);
  const a=library.cards.get('a'),b=library.cards.get('b');b.button.dispatchEvent(new Event('click'));assert.deepEqual(opened,['b']);assert.equal(library.selectedId,'a','opening emits an intent without selecting another mission itself');
  library.search.value='autre';library.search.dispatchEvent(new Event('input'));assert.equal(library.focusProject('a'),false);assert.equal(library.focusProject('b'),true);assert.strictEqual(document.activeElement,b.button);assert.equal(library.search.value,'autre');assert.equal(library.focusSearch(),true);assert.strictEqual(document.activeElement,library.search);
  library.reset.dispatchEvent(new Event('click'));assert.equal(library.search.value,'');assert.equal(library.status,'all');assert.strictEqual(library.cards.get('a'),a,'filtering preserves the original folder node');
});

test('the library renders untrusted titles as text and never loads private thumbnails or previews',t=>{
  const {library,document}=fixture(t),payload='<img src="https://example.invalid/private.png" onerror="alert(1)">';library.update([project({title:payload,prompt:payload,files:[{path:'photo-personnelle.png'}],imageUrl:'https://example.invalid/photo.jpg'})]);
  const card=library.cards.get('project');assert.equal(card.title.textContent,payload);assert.equal(card.excerpt.textContent,payload);assert.equal(card.button.dataset.missionId,'project');assert(!document.created.some(tag=>['img','iframe','video','audio','script'].includes(tag)));assert(![...card.button.attributes.keys()].includes('src'));
});

test('language changes update interface labels while preserving filters, focused nodes and personal content',t=>{
  const {library,document}=fixture(t);library.update([project({id:'a',status:'failed',title:'Couleurs à Bruxelles',prompt:'Je veux garder exactement ce texte.'})]);library.search.value='bruxelles';library.search.dispatchEvent(new Event('input'));const card=library.cards.get('a');card.button.focus();
  setLocale('nl');document.dispatchEvent(new Event('oscar:language'));assert.strictEqual(library.cards.get('a'),card);assert.strictEqual(document.activeElement,card.button);assert.equal(card.badge.textContent,'Onderbroken');assert.equal(card.title.textContent,'Couleurs à Bruxelles');assert.equal(card.excerpt.textContent,'Je veux garder exactement ce texte.');assert.equal(library.search.value,'bruxelles');
});

test('closing the library detaches event handlers and never opens a mission afterwards',t=>{
  const {library,opened,container,document}=fixture(t);library.update([project()]);const button=library.cards.get('project').button;library.destroy();library.destroy();button.dispatchEvent(new Event('click'));document.dispatchEvent(new Event('oscar:language'));library.update([project({id:'new'})]);assert.deepEqual(opened,[]);assert.equal(container.children.length,0);assert.equal(library.cards.size,0);assert.equal(library.focusSearch(),false);assert.equal(library.focusProject('project'),false);
});

test('illustrated folders stay local, adapt to one, two or three columns, and respect dark/reduced-motion preferences',async()=>{
  const css=await readFile(new URL('../public/delivery-library.css',import.meta.url),'utf8');assert(!/url\s*\(/iu.test(css));assert(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));assert(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));assert(css.includes('@container(max-width:520px)'));assert(css.includes('[data-office-theme="dark"]'));assert(css.includes('prefers-reduced-motion:reduce'));
});
