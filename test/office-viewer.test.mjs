import test from 'node:test';
import assert from 'node:assert/strict';
import {OfficeViewer,officeColumnName} from '../public/office-viewer.js';
import {officeText,officeTranslations} from '../public/translations-office.js';
import {readFileSync} from 'node:fs';
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attributes=new Map();this.listeners=new Map();this.classes=new Set();this.classList={add:(...values)=>values.forEach(value=>this.classes.add(value))};}
 append(...values){for(const value of values){value.parentElement=this;this.children.push(value);}}
 replaceChildren(...values){this.children=[];this.append(...values);}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 addEventListener(name,action){this.listeners.set(name,action);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(value=>value!==this);}
 set innerHTML(value){throw new Error('Document HTML must never be inserted');}
}
function documentFor(t){const before=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};t.after(()=>{if(before===undefined)delete globalThis.document;else globalThis.document=before;});}
const workbook={kind:'spreadsheet',status:'ready',warnings:[],sheets:[{name:'Budget <script>',state:'visible',totalRows:4,totalColumns:2,rows:[{number:1,cells:[{column:1,address:'A1',text:'00123',formula:false,bold:true,color:'255C49'}]},{number:3,cells:[{column:2,address:'B3',text:'=1+1',formula:true,cachedValue:'2'}]},{number:4,cells:[{column:2,address:'B4',text:'=2+2',formula:true}]}]},{name:'Archives',state:'hidden',totalRows:1,totalColumns:1,rows:[{number:1,cells:[{column:1,address:'A1',text:'Texte conservé',formula:false}]}]}]};
const all=node=>[node,...node.children.flatMap(all)];
test('Excel has real sheet tabs, coordinates, inert formulas and optional stored values without losing the file',t=>{
 documentFor(t);const host=new Element('div'),viewer=new OfficeViewer({container:host});viewer.open(structuredClone(workbook));assert.equal(viewer.tabButtons.length,2);assert.equal(viewer.tabButtons[0].textContent,'Budget <script>');assert.equal(viewer.tabButtons[0].attributes.get('aria-selected'),'true');assert(all(viewer.gridHost).some(item=>item.textContent==='=1+1'));assert(all(viewer.gridHost).some(item=>item.textContent==='00123'));assert(all(viewer.gridHost).some(item=>item.textContent==='3'));
 const tabs=[...viewer.tabButtons];viewer.formulaCheck.checked=false;viewer.formulaCheck.listeners.get('change')();assert(all(viewer.gridHost).some(item=>item.textContent==='2'&&item.classes.has('is-formula')));assert(!all(viewer.gridHost).some(item=>item.textContent==='=1+1'));const missing=all(viewer.gridHost).find(item=>item.textContent==='—');assert.match(missing.title,/Aucune valeur calculée enregistrée/);assert.match(missing.title,/=2\+2/);viewer.tabButtons[1].listeners.get('click')();assert.equal(viewer.sheetIndex,1);assert.equal(viewer.tabButtons[1],tabs[1]);assert.equal(viewer.tabButtons[1].attributes.get('aria-selected'),'true');assert(all(viewer.gridHost).some(item=>item.textContent==='Texte conservé'));assert.match(viewer.sheetMeta.textContent,/Feuille masquée/u);assert.equal(host.children.length,1);viewer.destroy();assert.equal(host.children.length,0);
});
test('Word displays real paragraphs, tables and a bounded style subset using text nodes only',t=>{
 documentFor(t);const host=new Element('div'),viewer=new OfficeViewer({container:host});viewer.open({kind:'word',status:'ready',warnings:[],blocks:[{kind:'paragraph',heading:1,alignment:'left',runs:[{text:'<img src=x onerror=alert(1)>',bold:true,color:'255C49',size:16}]},{kind:'table',rows:[['Objet','Écoles'],['Budget','1200 €']]}]});assert(all(viewer.page).some(item=>item.tagName==='H1'));assert(all(viewer.page).some(item=>item.tagName==='TABLE'));const span=all(viewer.page).find(item=>item.tagName==='SPAN');assert.equal(span.textContent,'<img src=x onerror=alert(1)>');assert.equal(span.style.color,'#255C49');assert.equal(span.style.fontSize,'16pt');assert(!all(viewer.page).some(item=>['IMG','IFRAME','SCRIPT','A'].includes(item.tagName)));viewer.destroy();
});
test('Office column names and fixed strings are complete in all three interface languages',()=>{
 assert.equal(officeColumnName(1),'A');assert.equal(officeColumnName(26),'Z');assert.equal(officeColumnName(27),'AA');assert.equal(officeColumnName(40),'AN');for(const value of[0,41,NaN,1.5])assert.equal(officeColumnName(value),'');
 const files=['../public/office-viewer.js','../lib/passive-office-worker.py','../lib/passive-office-preview.mjs'];const texts=files.map(file=>readFileSync(new URL(file,import.meta.url),'utf8')).join('\n');
 for(const [fr,en]of Object.entries(officeTranslations.en)){assert.notEqual(en,fr);assert.notEqual(officeText(fr,'nl'),fr);assert(texts.includes(fr)||['Word · lecture dans le bureau','Excel · lecture dans le bureau','Lecture locale en lecture seule. La mise en page avancée reste accessible dans votre application habituelle.'].includes(fr),fr);}
 for(const match of texts.matchAll(/(?:this\.label|note|fail)\('([^']+[’éèêàùç][^']*)'/gu)){const key=match[1];if(['Choisissez un livrable de cette mission.','Les outils de documents ne sont pas disponibles.'].includes(key))continue;assert(officeTranslations.en[key],key);assert(officeTranslations.nl[key],key);}
});
