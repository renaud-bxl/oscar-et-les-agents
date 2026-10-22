import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicationDialog} from '../public/publication-dialog.js';

const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const providers={github:{available:true,connected:true,user:'synthetic-user'},ftp:{available:true}};
const preview=(id='a')=>({kind:'github',digest:'digest-'+id,destination:{repo:'project-'+id,visibility:'private'},files:[{path:id+'/index.html'}],totalBytes:100,exclusions:{paths:[],count:0,truncated:false}});
function fixture(t,handler=()=>undefined){
  const previous={document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const document={activeElement:null},tasks=new Map();let timerId=0,closed=0,current={id:'a',title:'Projet A',status:'completed'};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this.handlers=new Map();this.value='';this.hidden=false;this.disabled=false;this.open=false;this._text='';this.isConnected=true;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}
    addEventListener(name,handler){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(handler);}
    async emit(name){await Promise.all([...this.handlers.get(name)||[]].map(handler=>handler({target:this})));}async click(){if(!this.disabled)return this.emit('click');}
    querySelectorAll(selector){const tags=selector.split(',').map(value=>value.trim());return this.children.flatMap(child=>[...(tags.includes(child.tagName.toLowerCase())?[child]:[]),...child.querySelectorAll(selector)]);}
    showModal(){this.open=true;}close(){this.open=false;this.emit('close');}focus(){document.activeElement=this;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;this.isConnected=false;}
  }
  document.createElement=tag=>new Element(tag);document.body=new Element('body');globalThis.document=document;
  globalThis.setTimeout=callback=>{const id=++timerId;tasks.set(id,callback);return id;};globalThis.clearTimeout=id=>tasks.delete(id);
  const calls=[],request=(url,options)=>{calls.push({url,options});const custom=handler(url,options,calls);if(custom!==undefined)return custom;return Promise.resolve(url==='/api/publishing'?providers:{status:'idle'});};
  const dialog=new PublicationDialog({request,getMission:()=>current,onClose:()=>closed++});dialog.visibility.value='private';dialog.protocol.value='ftps';
  t.after(()=>{dialog.destroy();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  return{dialog,calls,tasks,setMission:item=>{current=item;},get closed(){return closed;},runTimer:()=>{const[first]=tasks;if(!first)return;tasks.delete(first[0]);return first[1]();}};
}

test('publication only inspects on demand and a changed destination invalidates its exact confirmation',async t=>{
  const f=fixture(t,(url,options)=>options?.method==='POST'&&url.endsWith('/preview')?Promise.resolve(preview()):undefined);await f.dialog.open({entry:'Livraison'});
  assert.equal(f.calls.some(call=>call.options?.method==='POST'),false);assert.equal(f.dialog.confirm.disabled,true);assert.equal(f.dialog.preview,null);
  await f.dialog.inspect.click();assert.equal(f.dialog.preview.digest,'digest-a');assert.equal(f.dialog.confirm.disabled,false);assert.equal(f.dialog.target.textContent.includes('project-a'),true);
  f.dialog.repo.value='another-project';await f.dialog.repo.emit('input');assert.equal(f.dialog.preview,null);assert.equal(f.dialog.confirm.disabled,true);await f.dialog.publish();assert.equal(f.calls.filter(call=>call.options?.method==='POST').length,1);
});

test('a late inspection from another project cannot replace its preview or unlock a pending verification',async t=>{
  const old=defer(),next=defer(),f=fixture(t,(url,options)=>options?.method==='POST'&&url.endsWith('/preview')?(url.includes('/a/')?old.promise:next.promise):undefined);
  await f.dialog.open();const first=f.dialog.inspectFiles();assert.equal(f.dialog.busy,true);f.dialog.dialog.close();f.setMission({id:'b',title:'Projet B',status:'completed'});await f.dialog.open();const second=f.dialog.inspectFiles();
  old.resolve(preview('a'));await first;assert.equal(f.dialog.missionId,'b');assert.equal(f.dialog.preview,null);assert.equal(f.dialog.busy,true);assert.equal(f.dialog.inspect.disabled,true);assert.equal(f.dialog.confirm.disabled,true);
  next.resolve(preview('b'));await second;assert.equal(f.dialog.preview.digest,'digest-b');assert.equal(f.dialog.busy,false);assert.equal(f.dialog.list.children[0].textContent,'b/index.html');
});

test('closing a pending transfer clears its password and never repeats it or changes a reopened project',async t=>{
  const transfer=defer(),next=defer(),f=fixture(t,(url,options)=>options?.method==='POST'?(url.endsWith('/preview')?next.promise:transfer.promise):undefined);
  await f.dialog.open();f.dialog.choose('ftp');f.dialog.host.value='ftp.example.invalid';f.dialog.username.value='synthetic-user';f.dialog.password.value='temporary-test-password';f.dialog.preview=preview();const first=f.dialog.publish();await f.dialog.publish();assert.equal(f.calls.filter(call=>call.options?.method==='POST').length,1);
  f.dialog.dialog.close();assert.equal(f.dialog.password.value,'');f.setMission({id:'b',title:'Projet B',status:'completed'});await f.dialog.open();f.dialog.password.value='new-test-password';const second=f.dialog.inspectFiles();transfer.resolve({status:'uploading',message:'Synthetic upload accepted.'});await first;
  assert.equal(f.dialog.busy,true);assert.equal(f.dialog.password.value,'new-test-password');assert.equal(f.dialog.job.status,'idle');next.resolve({...preview('b'),kind:'ftp',destination:{protocol:'ftps',host:'ftp.example.invalid',port:21,directory:'/public_html'}});await second;
  assert.equal(f.calls.filter(call=>call.options?.method==='POST'&&!call.url.endsWith('/preview')).length,1);assert.equal(f.dialog.preview.digest,'digest-b');
});

test('destroying an open publication cancels future polling even when a metadata read arrives late',async t=>{
  const metadata=defer();let reads=0;const f=fixture(t,url=>url==='/api/publishing'&&++reads===2?metadata.promise:undefined);await f.dialog.open();assert.equal(f.tasks.size,1);const pending=f.runTimer();assert.equal(reads,2);f.dialog.password.value='temporary-test-password';f.dialog.destroy();assert.equal(f.dialog.dialog.open,false);assert.equal(f.dialog.password.value,'');assert.equal(f.tasks.size,0);
  metadata.resolve(providers);await pending;assert.equal(f.tasks.size,0);const count=f.calls.length;await f.dialog.open();await f.dialog.connect();await f.dialog.inspectFiles();await f.dialog.publish();assert.equal(f.calls.length,count);assert.equal(f.closed,0,'Destroy does not navigate the parent to a different panel.');
});

test('a delayed initial read cannot stop the polling of a reopened publication',async t=>{
  const metadata=defer();let reads=0;const f=fixture(t,url=>url==='/api/publishing'&&++reads===1?metadata.promise:undefined);const first=f.dialog.open();f.dialog.dialog.close();f.setMission({id:'b',title:'Projet B',status:'completed'});await f.dialog.open();assert.equal(f.tasks.size,1);const timer=[...f.tasks.keys()][0];metadata.resolve(providers);await first;assert.equal(f.tasks.size,1);assert.equal([...f.tasks.keys()][0],timer);assert.equal(f.dialog.missionId,'b');
});
