import test from 'node:test';
import assert from 'node:assert/strict';
import {PdfCanvasPreview,pdfPreviewDimensions,PDF_PREVIEW_LIMITS} from '../public/pdf-preview.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attributes=new Map();this.listeners=new Map();this.clientWidth=1000;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(name,value){this.attributes.set(name,value);}
  addEventListener(name,action){this.listeners.set(name,action);}
  getContext(){return{};}
}
function documentFor(t){const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});}
function fixture({pages=3,render=()=>Promise.resolve()}={}){
  const calls={pages:[],renders:[],terminated:0,destroyed:0,cancelled:0};
  const document={numPages:pages,async getPage(number){calls.pages.push(number);return{getViewport:({scale})=>({width:595*scale,height:842*scale}),cleanup(){},render(options){calls.renders.push(options);return{promise:render(),cancel(){calls.cancelled++;}};}};}};
  const api={PDFWorker:class{constructor({port}){calls.port=port;}destroy(){}},getDocument(options){calls.options=options;return{promise:Promise.resolve(document),destroy(){calls.destroyed++;}};}};
  const preview=new PdfCanvasPreview({load:async()=>api,workerFactory:url=>{calls.workerUrl=url;return{terminate(){calls.terminated++;}};}});
  return{preview,calls};
}

test('PDF page dimensions remain bounded for large pages, high density and small screens',()=>{
  for(const [width,height,available,density] of [[595,842,1000,2],[100000,2,320,4],[2,100000,1920,1],[500000,500000,10000,3],[595,842,280,1]]){
    const result=pdfPreviewDimensions(width,height,available,density);
    assert(result.width>0&&result.height>0);assert(result.width<=PDF_PREVIEW_LIMITS.dimension&&result.height<=PDF_PREVIEW_LIMITS.dimension);assert(result.width*result.height<=PDF_PREVIEW_LIMITS.pixels);assert(result.cssWidth<=Math.max(240,Math.min(1200,available))+.001);
  }
  for(const values of [[0,842],[-1,842],[595,Infinity],[NaN,842]])assert.throws(()=>pdfPreviewDimensions(...values,900),/dimensions/);
});

test('passive PDF viewer renders one page, navigates, and releases its canvas and dedicated worker',async t=>{
  documentFor(t);const{preview,calls}=fixture();const host=new Element('div'),bytes=new Uint8Array([37,80,68,70]);
  await preview.open(bytes,host);const session=preview.session;
  assert.deepEqual(calls.pages,[1]);assert.equal(calls.renders.length,1);assert.equal(session.canvas.attributes.get('role'),'img');assert.equal(session.label.textContent,'Page 1 sur 3');assert(session.previous.disabled);assert(!session.next.disabled);
  assert.equal(calls.options.data,bytes);assert(!('url'in calls.options));assert.equal(calls.options.enableXfa,false);assert.equal(calls.options.useWasm,false);assert.equal(calls.options.useSystemFonts,false);assert.equal(calls.options.isEvalSupported,false);assert.equal(calls.options.disableWorkerRendering,true);assert.equal(calls.options.maxImageSize,PDF_PREVIEW_LIMITS.imagePixels);assert.equal(calls.options.canvasMaxAreaInBytes,PDF_PREVIEW_LIMITS.pixels*4);
  assert.equal(calls.workerUrl,'/vendor/pdfjs/6.4.299/build/pdf.worker.min.mjs');for(const option of ['cMapUrl','standardFontDataUrl','wasmUrl'])assert(calls.options[option].startsWith('/vendor/pdfjs/6.4.299/'));
  await session.next.listeners.get('click')();assert.deepEqual(calls.pages,[1,2]);assert.equal(session.label.textContent,'Page 2 sur 3');assert(!session.previous.disabled);
  await preview.goToPage(3);assert(session.next.disabled);await preview.goToPage(4);assert.deepEqual(calls.pages,[1,2,3]);
  await preview.close();assert.equal(preview.session,null);assert.equal(calls.terminated,1);assert.equal(calls.destroyed,1);assert.equal(session.canvas.width,0);assert.equal(session.canvas.height,0);
});

test('closing during a page render cancels the work and later completion cannot revive the reader',async t=>{
  documentFor(t);let finish;const pending=new Promise(resolve=>{finish=resolve;}),{preview,calls}=fixture({render:()=>pending});
  const opening=preview.open(new Uint8Array([37,80,68,70]),new Element('div'));const outcome=opening.catch(error=>error);
  for(let index=0;index<30&&!calls.renders.length;index++)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.renders.length,1);
  const canvas=preview.session.canvas;const closed=preview.close();assert.equal((await outcome).name,'AbortError');await closed;finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(preview.session,null);assert.equal(calls.cancelled,1);assert.equal(calls.terminated,1);assert.equal(canvas.width,0);assert.equal(canvas.height,0);
});

test('page limit is explicit and cannot be bypassed by navigation',async t=>{
  documentFor(t);const{preview,calls}=fixture({pages:500});await preview.open(new Uint8Array([37,80,68,70]),new Element('div'));
  assert.equal(preview.session.limitNote.hidden,false);assert(preview.session.limitNote.textContent.includes('500'));await preview.goToPage(200);assert(preview.session.next.disabled);
  await preview.goToPage(201);assert.deepEqual(calls.pages,[1,200]);preview.close();
});

test('a password-protected document keeps the native-download fallback and shuts down its worker',async()=>{
  const{preview,calls}=fixture();preview.load=async()=>({PDFWorker:class{destroy(){}},getDocument:()=>({promise:Promise.reject(Object.assign(new Error('password'),{name:'PasswordException'})),destroy(){calls.destroyed++;}})});
  await assert.rejects(preview.open(new Uint8Array([37,80,68,70]),{}),/mot de passe/);assert.equal(preview.session,null);assert.equal(calls.terminated,1);assert.equal(calls.destroyed,1);
});

test('a hung render reaches the deadline, cancels the job and terminates its worker',async t=>{
  documentFor(t);t.mock.timers.enable({apis:['setTimeout']});const{preview,calls}=fixture({render:()=>new Promise(()=>{})});
  const opening=preview.open(new Uint8Array([37,80,68,70]),new Element('div')),outcome=opening.catch(error=>error);
  for(let index=0;index<30&&!calls.renders.length;index++)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.renders.length,1);
  t.mock.timers.tick(PDF_PREVIEW_LIMITS.timeoutMs+1);assert.match((await outcome).message,/vingt secondes/);assert.equal(calls.cancelled,1);assert.equal(calls.terminated,1);assert.equal(calls.destroyed,1);assert.equal(preview.session,null);
});

test('normal cleanup can remove PDF fonts, while a stuck shutdown is forced after 250 milliseconds',async t=>{
  documentFor(t);const first=fixture();await first.preview.open(new Uint8Array([37,80,68,70]),new Element('div'));
  let cleaned;first.preview.session.loadingTask.destroy=()=>new Promise(resolve=>{cleaned=resolve;});const closing=first.preview.close();assert.equal(first.calls.terminated,0);cleaned();await closing;assert.equal(first.calls.terminated,1);
  const second=fixture();await second.preview.open(new Uint8Array([37,80,68,70]),new Element('div'));second.preview.session.loadingTask.destroy=()=>new Promise(()=>{});
  t.mock.timers.enable({apis:['setTimeout']});const forced=second.preview.close();assert.equal(second.calls.terminated,0);t.mock.timers.tick(250);await forced;assert.equal(second.calls.terminated,1);
});
