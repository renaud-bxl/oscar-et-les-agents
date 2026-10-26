import test from 'node:test';
import assert from 'node:assert/strict';
import {ArtifactViewer} from '../public/artifact-viewer.js';

function fixture(t,{request=async()=>({}),fetchImpl=async()=>new Response('Texte public de contrôle')}={}){
  const previous={document:globalThis.document,fetch:globalThis.fetch},document={activeElement:null,listeners:new Map()};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this.listeners=new Map();this.style={};this.className='';this._text='';this.open=false;this.isConnected=true;this.classList={add:(value)=>{this.className+=' '+value;},toggle:()=>{}};}
    set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set innerHTML(_value){assert.fail('A document must never be inserted as HTML.');}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));}removeAttribute(name){this.attributes.delete(name);}getAttribute(name){return this.attributes.get(name)??null;}
    addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(handler);}removeEventListener(name,handler){this.listeners.get(name)?.delete(handler);}
    querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tagName.toLowerCase()===tag?[child]:[]),...child.querySelectorAll(tag)]);}
    focus(){document.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;for(const handler of this.listeners.get('close')||[])handler();}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.isConnected=false;}
  }
  document.createElement=tag=>new Element(tag);document.body=new Element('body');document.addEventListener=(name,handler)=>{if(!document.listeners.has(name))document.listeners.set(name,new Set());document.listeners.get(name).add(handler);};document.removeEventListener=(name,handler)=>document.listeners.get(name)?.delete(handler);
  globalThis.document=document;globalThis.fetch=fetchImpl;const viewer=new ArtifactViewer({request});t.after(()=>{viewer.destroy();globalThis.fetch=previous.fetch;if(previous.document===undefined)delete globalThis.document;else globalThis.document=previous.document;});return{viewer,document};
}
const mission=(id='preview-test')=>({id,status:'completed'}),word={kind:'word',status:'ready',warnings:[],blocks:[{kind:'paragraph',heading:1,alignment:'left',runs:[{text:'Texte Word <script> inerte',bold:true,italic:false,underline:false}]}]},book={kind:'spreadsheet',status:'ready',warnings:[],sheets:[{name:'Budget',state:'visible',totalRows:1,totalColumns:1,rows:[{number:1,cells:[{column:1,address:'A1',text:'42',formula:false}]}]}]};

test('artifact text is passive and bounded while download and native-folder actions stay available',async t=>{
  const calls=[],{viewer}=fixture(t,{request:async(...args)=>{calls.push(args);return{};},fetchImpl:async()=>new Response('<script>Texte inerte</script>'+ 'x'.repeat(530000))});
  await viewer.open(mission(),{path:'Livraison/notes.md',size:530000});assert.equal(viewer.dialog.open,true);assert.equal(viewer.error.hidden,true);assert.equal(viewer.content.querySelectorAll('pre')[0].textContent.length,512*1024);assert.match(viewer.content.textContent,/^<script>Texte inerte/u);assert.match(viewer.hint.textContent,/512/u);assert.equal(viewer.hint.hidden,false);assert.match(viewer.download.href,/\/files\/Livraison\/notes.md$/u);
  await viewer.openNative();await viewer.openFolder();assert.deepEqual(calls.map(([route])=>route),['/api/missions/preview-test/open-file','/api/missions/preview-test/open-folder']);assert.equal(viewer.dialog.open,true);
});

test('Word and Excel use the passive local reader and a late old file cannot replace the new document',async t=>{
  let resolveWord;const requests=[],{viewer}=fixture(t,{request:async(route,options)=>{requests.push({route,options});const file=JSON.parse(options.body).path;return file.endsWith('.docx')?new Promise(resolve=>{resolveWord=resolve;}):book;}});
  const first=viewer.open(mission(),{path:'note.docx',size:20});await Promise.resolve();const firstSignal=requests[0].options.signal;await viewer.open(mission('second-project'),{path:'budget.xlsx',size:20});assert(firstSignal.aborted);assert.equal(viewer.officePreview.current.kind,'spreadsheet');assert.match(viewer.mode.textContent,/Excel/u);assert.equal(requests[1].route,'/api/missions/second-project/document-preview');assert.equal(requests[1].options.headers['X-Oscar-Client'],'1');
  resolveWord(word);await first;assert.equal(viewer.officePreview.current.kind,'spreadsheet');assert.equal(viewer.title.textContent,'budget.xlsx');assert.equal(viewer.error.hidden,true);viewer.close();assert.equal(viewer.officePreview,null);assert.equal(viewer.content.children.length,0);
});

test('a missing Office runtime or unavailable PDF keeps an actionable file instead of a blank reader',async t=>{
  const{viewer}=fixture(t,{request:async()=>{throw Object.assign(new Error('Préparez les outils locaux de documents pour lire Word et Excel dans le bureau.'),{code:'DOCUMENT_RUNTIME'});},fetchImpl:async()=>new Response('not a PDF')});
  await viewer.open(mission(),{path:'note.docx',size:20});assert.equal(viewer.error.hidden,false);assert.match(viewer.error.textContent,/Préparez les outils/u);assert.equal(viewer.retry.hidden,false);assert(viewer.download.href);assert.equal(viewer.native.disabled,false);assert.equal(viewer.folder.disabled,false);
  await viewer.open(mission(),{path:'rapport.pdf',size:20});assert.match(viewer.error.textContent,/ne correspond pas à un PDF/u);assert.equal(viewer.retry.hidden,false);assert.match(viewer.content.textContent,/Votre fichier reste accessible/u);
});

test('native and folder controls remain disabled while a previous file action is still running',async t=>{
  let finish;const calls=[],{viewer}=fixture(t,{request:async(route)=>{calls.push(route);return new Promise(resolve=>{finish=resolve;});}});
  await viewer.open(mission(),{path:'note.md'});const native=viewer.openNative();assert.equal(viewer.native.disabled,true);await viewer.open(mission('next-project'),{path:'budget.txt'});assert.equal(viewer.native.disabled,true);await viewer.openNative();assert.equal(calls.length,1);finish({});await native;assert.equal(viewer.native.disabled,false);assert.equal(viewer.status.hidden,true,'the old file action must not announce success for a new file');
  const folder=viewer.openFolder();assert.equal(viewer.folder.disabled,true);await viewer.open(mission(),{path:'rapport.json'});assert.equal(viewer.folder.disabled,true);await viewer.openFolder();assert.equal(calls.length,2);finish({});await folder;assert.equal(viewer.folder.disabled,false);assert.equal(viewer.status.hidden,true);
});
