import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AppUpdates,appUpdateView,updatesText} from '../public/app-updates.js';
import messages from '../public/translations-updates.js';
import {setLocale} from '../public/i18n.js';

const snapshot=(values={})=>({installed:true,supported:true,currentVersion:'0.6.9',status:'available',latestVersion:'0.6.10',checkedAt:1700000000000,releaseUrl:'https://evil.invalid/release',releaseNotes:'Une nouvelle équipe.',canInstall:true,busyReasons:[],maintenance:false,error:null,result:null,...values});
const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
class Element extends EventTarget{
  constructor(tag,document){super();this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.dataset={};this.attributes=new Map();this.parentNode=null;this.hidden=false;this.open=false;this._text='';this.value='';}
  get isConnected(){return this===this.ownerDocument.body||!!this.parentNode?.isConnected;}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
  append(...children){for(const child of children){child.remove();child.parentNode=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];this._text='';this.append(...children);}
  remove(){if(this.parentNode){const children=this.parentNode.children;children.splice(children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key)??null;}
  removeAttribute(key){this.attributes.delete(key);}
  focus(){this.ownerDocument.activeElement=this;}
  showModal(){this.open=true;this.ownerDocument.modalCalls++;}
  close(){this.open=false;}
}
class Document extends EventTarget{
  constructor(){super();this.modalCalls=0;this.body=new Element('body',this);}
  createElement(tag){return new Element(tag,this);}
}
class Clock{
  constructor(){this.time=1000;this.tasks=new Map();this.next=0;this.errors=[];}
  setTimeout=(callback,delay)=>{const id=++this.next;this.tasks.set(id,{callback,at:this.time+delay});return id;};
  clearTimeout=id=>this.tasks.delete(id);
  async advance(ms){const end=this.time+ms;for(let i=0;i<1000;i++){const due=[...this.tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;this.time=due[1].at;this.tasks.delete(due[0]);try{const result=due[1].callback();result?.catch?.(error=>this.errors.push(error));}catch(error){this.errors.push(error);}await settle();}this.time=end;await settle();assert.deepEqual(this.errors,[]);}
}
async function fixture(t,{initial=snapshot(),handler,state={missions:[]}}={}){
  const document=new Document(),notice=document.createElement('div'),settings=document.createElement('div');document.body.append(notice,settings);const calls=[],clock=new Clock();let reloads=0;
  const request=(url,options={})=>{calls.push({url,options});return handler?handler(url,options,calls):Promise.resolve(initial);};
  const updates=new AppUpdates({hosts:{notice,settings},request,getState:()=>state,reload:()=>reloads++,timers:clock,now:()=>clock.time});await settle();
  t.after(async()=>{updates.destroy();await settle();setLocale('fr');});return{updates,document,notice,settings,calls,clock,state,get reloads(){return reloads;}};
}

test('opening the app only reads update state and a notification never opens a surprise modal or installer',async t=>{
  const f=await fixture(t,{initial:snapshot({releaseNotes:'<img src=x onerror=alert(1)>\n[link](https://evil.invalid)'})});assert.deepEqual(f.calls.map(call=>[call.url,call.options.method]),[['/api/updates',undefined]]);assert.equal(f.document.modalCalls,0);assert.equal(f.reloads,0);assert.equal(f.updates.notice.hidden,false);assert.equal(f.updates.notesText.textContent,'<img src=x onerror=alert(1)>\n[link](https://evil.invalid)');assert.equal(f.updates.release.href,'https://github.com/renaud-bxl/oscar-et-les-agents/releases/tag/v0.6.10');assert.equal(f.updates.install.disabled,false);
  f.updates.dismiss.dispatchEvent(new Event('click'));assert.equal(f.updates.notice.hidden,true);f.updates.update(snapshot());assert.equal(f.updates.notice.hidden,true);f.updates.update(snapshot({latestVersion:'0.6.11'}));assert.equal(f.updates.notice.hidden,false);
});

test('checking sends only an empty check request and does not install or reload',async t=>{
  const f=await fixture(t,{handler:async(url)=>url.endsWith('/check')?snapshot({status:'up_to_date',latestVersion:'0.6.9',canInstall:false}):snapshot()});await f.updates.checkNow();
  assert.deepEqual(f.calls.map(call=>call.url),['/api/updates','/api/updates/check']);assert.equal(f.calls[1].options.method,'POST');assert.equal(f.calls[1].options.body,'{}');assert.equal(f.updates.view.status,'up_to_date');assert.equal(f.updates.meta.latest.label.textContent,'Dernière version publiée');assert.equal(f.updates.install.hidden,true);assert.equal(f.document.modalCalls,0);assert.equal(f.reloads,0);
});

test('background checking locks duplicate checks and language changes translate existing error state',async t=>{
  const f=await fixture(t);f.updates.update(snapshot({status:'checking'}));await f.updates.checkNow();assert.equal(f.calls.length,1);assert.equal(f.updates.check.disabled,true);assert.equal(f.updates.install.disabled,true);
  f.updates.localError='L’état des mises à jour n’a pas pu être chargé.';f.updates.render();setLocale('nl');f.document.dispatchEvent(new Event('oscar:language'));assert.equal(f.updates.error.textContent,'De updatestatus kon niet worden geladen.');
});

test('installation needs a visible exact-version confirmation and cannot dispatch twice',async t=>{
  let finish;const f=await fixture(t,{handler:(url)=>url.endsWith('/install')?new Promise(resolve=>{finish=resolve;}):Promise.resolve(snapshot())});
  f.updates.openConfirmation();assert.equal(f.updates.dialog.open,true);assert.equal(f.updates.confirmationVersion,'0.6.10');assert.equal(f.calls.length,1);f.updates.closeConfirmation();assert.equal(f.calls.length,1);
  f.updates.openConfirmation();const first=f.updates.installConfirmed();await settle();const duplicate=f.updates.installConfirmed();await duplicate;assert.equal(f.calls.filter(call=>call.url.endsWith('/install')).length,1);assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{version:'0.6.10',confirmed:true});assert.equal(f.updates.confirm.disabled,true);
  f.updates.update(snapshot({status:'downloading',maintenance:true,canInstall:false}));assert.match(f.updates.dialogWarning.textContent,/Téléchargement/u,'a real download is not described as an unsupported installation');finish(snapshot({status:'downloading',maintenance:true,canInstall:false}));await first;assert.equal(f.updates.dialog.open,false);assert.equal(f.updates.view.progress,true);assert.equal(f.reloads,0);
});

test('running work and an updated release disable a confirmation without silently changing its version',async t=>{
  const f=await fixture(t);f.updates.openConfirmation();f.state.missions=[{id:'active',status:'running'}];f.updates.update(snapshot());assert.equal(f.updates.confirm.disabled,true);assert.match(f.updates.dialogWarning.textContent,/missions/u);await f.updates.installConfirmed();assert.equal(f.calls.length,1);
  f.state.missions=[];f.updates.update(snapshot({latestVersion:'0.6.11'}));assert.equal(f.updates.confirmationVersion,'0.6.10');assert.equal(f.updates.confirm.disabled,true);assert.match(f.updates.dialogWarning.textContent,/changé/u);await f.updates.installConfirmed();assert.equal(f.calls.length,1);
  f.updates.closeConfirmation();f.updates.openConfirmation();assert.equal(f.updates.confirmationVersion,'0.6.11');assert.equal(f.updates.confirm.disabled,false);
});

test('source copies, unsupported installations and network errors stay distinct and cannot claim an update is installed',async t=>{
  const f=await fixture(t,{initial:snapshot({installed:false,supported:false,canInstall:false})});assert.equal(f.updates.install.disabled,true);assert.equal(f.updates.sourceNote.hidden,false);assert.match(f.updates.sourceNote.textContent,/copie/u);assert.match(f.updates.sourceLink.href,/github\.com\/renaud-bxl\/oscar-et-les-agents#/u);
  f.updates.update(snapshot({installed:true,supported:false,canInstall:false}));assert.match(f.updates.sourceNote.textContent,/installateur/u);
  f.updates.update(snapshot({status:'error',canInstall:false,error:{code:'UPDATE_NETWORK',message:'Offline'}}));assert.match(f.updates.status.textContent,/hors connexion/u);assert.equal(f.reloads,0);assert.equal(f.updates.reloadButton.hidden,true);
  assert.equal(appUpdateView(snapshot({currentVersion:'0.6.10',latestVersion:'0.6.9'})).available,false,'an older release never becomes an offered update');
});

test('maintenance reason codes become translated explanations and unknown codes never leak into the interface',()=>{
  const codes=['missions','calendar','connections','publishing','automations','documents','voice','dictation','requests','unknown_technical_lock'];
  for(const locale of ['fr','en','nl']){const view=appUpdateView(snapshot({busyReasons:codes}),{locale});assert.equal(view.canInstall,false);assert.equal(view.busyReasons.length,codes.length);assert(view.busyReasons.every(reason=>!codes.includes(reason)));assert(view.busyReasons.every(reason=>!reason.includes('unknown_technical_lock')));if(locale!=='fr')assert(view.busyReasons.every(reason=>!Object.keys(messages).includes(reason)));}
  assert.equal(appUpdateView(snapshot({supported:undefined})).canInstall,true,'canInstall remains authoritative for an older compatible snapshot');assert.equal(appUpdateView(snapshot({checkedAt:Number.MAX_VALUE})).checkedAt,null);
});

test('the returning server offers an explicit reload while the current draft and nodes remain untouched',async t=>{
  const f=await fixture(t),draft=f.document.createElement('textarea');draft.value='Mon projet non envoyé';f.document.body.append(draft);draft.focus();const card=f.updates.root;
  f.updates.update(snapshot({currentVersion:'0.6.10',latestVersion:'0.6.10',status:'updated',canInstall:false}));assert.equal(f.updates.view.reloadRequired,true);assert.equal(f.updates.reloadButton.hidden,false);assert.equal(f.reloads,0);assert.strictEqual(f.updates.root,card);assert.strictEqual(f.document.activeElement,draft);assert.equal(draft.value,'Mon projet non envoyé');
  f.updates.reloadButton.dispatchEvent(new Event('click'));assert.equal(f.reloads,1);f.updates.destroy();f.updates.reloadButton.dispatchEvent(new Event('click'));assert.equal(f.reloads,1);
});

test('restart reconnection is bounded, has a manual retry and never repeats installation',async t=>{
  let offline=false;const f=await fixture(t,{handler:async()=>{if(offline)throw new Error('offline');return snapshot();}});offline=true;f.updates.update(snapshot({status:'restarting',maintenance:true,canInstall:false}));await f.clock.advance(70000);
  assert.equal(f.updates.reconnectExpired,true);assert.equal(f.updates.reconnectTimer,null);assert.equal(f.updates.retry.hidden,false);assert(f.calls.length<=31);assert.equal(f.calls.some(call=>call.options.method==='POST'),false);const count=f.calls.length;await f.clock.advance(120000);assert.equal(f.calls.length,count,'expired reconnect does not keep polling forever');
  f.updates.retry.dispatchEvent(new Event('click'));await f.clock.advance(2000);assert(f.calls.length>count);assert.equal(f.calls.some(call=>call.url.endsWith('/install')),false);assert.equal(f.reloads,0);
});

test('a lost installation response is recovered with GET only and never resubmitted',async t=>{
  let getCount=0;const f=await fixture(t,{handler:async(url)=>{if(url.endsWith('/install'))throw new Error('response lost');getCount++;return getCount===1?snapshot():getCount===2?snapshot({status:'restarting',maintenance:true,canInstall:false}):snapshot({status:'updated',currentVersion:'0.6.10',latestVersion:'0.6.10',canInstall:false});}});
  f.updates.openConfirmation();await f.updates.installConfirmed();assert.equal(f.updates.installUncertain,true);await f.clock.advance(6000);assert.equal(f.calls.filter(call=>call.url.endsWith('/install')).length,1);assert.equal(f.updates.view.reloadRequired,true);assert.equal(f.updates.reconnectTimer,null);assert.equal(f.updates.reconnectStarted,null);assert.equal(f.updates.reloadButton.hidden,false);assert.equal(f.reloads,0);
});

test('late reads cannot roll back newer SSE progress, and an accepted SSE update resolves a lost acknowledgement',async t=>{
  let resolveRead;const f=await fixture(t,{handler:()=>new Promise(resolve=>{resolveRead=resolve;})});f.updates.update(snapshot({status:'downloading',maintenance:true,canInstall:false}));resolveRead(snapshot());await settle();assert.equal(f.updates.view.status,'downloading');
  let rejectInstall;f.updates.request=url=>url.endsWith('/install')?new Promise((_,reject)=>{rejectInstall=reject;}):Promise.resolve(snapshot());f.updates.update(snapshot());f.updates.openConfirmation();const installing=f.updates.installConfirmed();await settle();f.updates.update(snapshot({status:'downloading',maintenance:true,canInstall:false}));rejectInstall(new Error('response lost'));await installing;assert.equal(f.updates.installUncertain,false);assert.equal(f.updates.dialog.open,false);assert.equal(f.updates.localError,'');
});

test('destroy aborts pending requests, clears timers and removes all future click effects',async t=>{
  let finish;const f=await fixture(t,{handler:()=>new Promise(resolve=>{finish=resolve;})});assert.equal(f.updates.controllers.size,1);const signal=f.calls[0].options.signal;f.updates.destroy();await settle();assert.equal(signal.aborted,true);assert.equal(f.clock.tasks.size,0);assert.equal(f.notice.children.length,0);assert.equal(f.settings.children.length,0);f.updates.install.dispatchEvent(new Event('click'));f.updates.check.dispatchEvent(new Event('click'));f.updates.noticeAction.dispatchEvent(new Event('click'));finish(snapshot({currentVersion:'0.6.10'}));await settle();assert.equal(f.calls.length,1);assert.equal(f.document.modalCalls,0);assert.equal(f.reloads,0);
});

test('every new label is translated and release notes remain literal data with fixed official links',async()=>{
  for(const[source,value]of Object.entries(messages))for(const locale of ['en','nl']){assert.equal(typeof value[locale],'string',source);assert(value[locale]);assert.notEqual(updatesText(source,locale),source);}
  for(const locale of ['en','nl'])for(const status of ['idle','checking','up_to_date','available','downloading','ready','restarting','updated','rolled_back','error']){const view=appUpdateView(snapshot({status,releaseNotes:'<script>PRIVATE</script>'}),{locale});assert(!Object.keys(messages).includes(view.label),`${locale} ${status}`);assert.equal(view.releaseNotes,'<script>PRIVATE</script>');}
  const css=await readFile(new URL('../public/app-updates.css',import.meta.url),'utf8');assert(css.includes('[data-office-theme="dark"]'));assert(css.includes('@media(max-width:600px)'));assert(!/url\s*\(/iu.test(css));
});

test('update rejection explanations remain available in both translated interfaces',async()=>{
  for(const filename of ['../lib/app-updates.mjs','../scripts/update.mjs']){
    const source=await readFile(new URL(filename,import.meta.url),'utf8');
    for(const match of source.matchAll(/(?:fail\(|message:\s*)'([^']+)'/gu))for(const locale of ['en','nl'])assert.notEqual(updatesText(match[1],locale),match[1],`${locale}: ${match[1]}`);
  }
});
