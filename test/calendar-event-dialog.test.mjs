import test from 'node:test';
import assert from 'node:assert/strict';
import {CalendarEventDialog,calendarCommand,calendarQuestion,calendarCreateChoices} from '../public/calendar-event-dialog.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const event={title:'Réunion projet',start:'2026-10-21T14:00:00.000Z',end:'2026-10-21T14:45:00.000Z',timeZone:'Europe/Brussels',location:'Bruxelles',description:'Mes notes'};
const preview={previewId:'preview-123',confirmationToken:'token-123',event};
const agenda=(client,name,{usable=true,stale=false,status='authorized'}={})=>({client,name,displayName:name,status,stale,readOnlyAutomation:{service:'calendar'},calendarCreate:{available:usable}});

function dom(){
  const document={activeElement:null};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.handlers=new Map();this.value='';this.disabled=false;this.open=false;this.textContent='';}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,action){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(action);}
    emit(name){return Promise.all((this.handlers.get(name)||[]).map(action=>action({preventDefault(){}})));}
    all(){return this.children.flatMap(child=>[child,...child.all()]);}
    querySelectorAll(selector){return this.all().filter(child=>child.tagName===selector.toUpperCase());}
    get selectedOptions(){return this.children.filter(child=>child.value===this.value);}
    reset(){for(const input of this.all())if(['INPUT','TEXTAREA','SELECT'].includes(input.tagName))input.value='';}
    reportValidity(){return this.all().every(input=>input.disabled||!input.required||Boolean(input.value));}
    showModal(){this.open=true;}
    close(){this.open=false;void this.emit('close');}
    focus(){document.activeElement=this;}
    scrollIntoView(){}
  }
  document.createElement=tag=>new Element(tag);document.body=new Element('body');return document;
}
async function fixture(t,request=async()=>preview,options={}){
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const memory=new Map(),storage=options.storage||{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const calls=[],dialog=new CalendarEventDialog({storage,request:async(url,settings)=>{if(['/api/connectors','/api/connectors/refresh'].includes(url))return options.metadata?options.metadata(url,settings):{connections:options.connections||[agenda('codex','agenda-codex')],clients:{}};calls.push([url,settings?.body?JSON.parse(settings.body):null]);return request(url,settings);}});t.after(()=>dialog.close());
  await dialog.open({connections:options.connections||[agenda('codex','agenda-codex')],client:options.client||'auto',timeZone:'Europe/Brussels'});
  Object.assign(dialog.fields.title,{value:event.title});Object.assign(dialog.fields.startLocal,{value:'2026-10-21T16:00'});Object.assign(dialog.fields.endLocal,{value:'2026-10-21T16:45'});dialog.fields.description.value=event.description;dialog.fields.location.value=event.location;
  return{dialog,calls};
}

test('calendar language routing distinguishes agenda questions and explicit additions',()=>{
  for(const text of ['Ajoute un rendez-vous à mon agenda demain','Create an appointment tomorrow','Voeg een afspraak toe aan mijn agenda'])assert.equal(calendarCommand(text),true,text);
  for(const text of ['Lis mon agenda demain','Show my appointments','Mijn afspraken morgen']){assert.equal(calendarQuestion(text),true,text);assert.equal(calendarCommand(text),false,text);}
  for(const text of ['Ajoute un paragraphe à mon texte','Crée un logiciel de gestion d’agenda','Crée un site de prise de rendez-vous','Ne crée aucun événement dans mon agenda.','N’ajoute pas de rendez-vous à mon agenda.',"Don't add an appointment to my calendar",'Voeg geen afspraak toe aan mijn agenda'])assert.equal(calendarCommand(text),false,text);
  for(const text of ['Crée un logiciel de gestion d’agenda','Crée un site de prise de rendez-vous','Crée une application pour lire mon agenda et ajouter des rendez-vous','Build an app to read my calendar']){assert.equal(calendarQuestion(text),false,text);assert.equal(calendarCommand(text),false,text);}
  assert.equal(calendarCommand('Ajoute un rendez-vous pour discuter du logiciel'),true);
  assert.equal(calendarCommand('Prépare mon agenda pour aujourd’hui et demain, selon le fuseau indiqué. Liste les rendez-vous avec heure de début et de fin, titre, priorités et préparation utile. Signale les chevauchements et les informations manquantes. Ne crée, ne modifie et ne supprime aucun événement, et n’invite personne.'),false);
});

test('no calendar write happens before a valid preview and an explicit confirmation',async t=>{
  const{dialog,calls}=await fixture(t,async url=>url==='/api/calendar/confirm'?{status:'completed',message:'Ajout confirmé'}:preview);
  await dialog.confirm();assert.equal(calls.length,0);assert.equal(dialog.receipt,null);
  dialog.fields.title.value='';await dialog.preview();assert.equal(calls.length,0,'Invalid required input must not request a preview.');
  dialog.fields.title.value=event.title;await dialog.preview();assert.deepEqual(calls.map(([url])=>url),['/api/calendar/preview']);assert.equal(dialog.review.hidden,false);assert.equal(dialog.receipt,null);
  await dialog.confirm();assert.deepEqual(calls.map(([url])=>url),['/api/calendar/preview','/api/calendar/confirm']);assert.equal(dialog.result.hidden,false);assert.equal(dialog.fields.title.disabled,true);
  await dialog.confirm();assert.equal(calls.length,2,'A completed request must not write again.');
});

test('confirmation locks every edit while waiting and a network retry reuses the exact request identity',async t=>{
  const waiting=deferred();let attempt=0;const{dialog,calls}=await fixture(t,async url=>{if(url==='/api/calendar/preview')return preview;if(url.startsWith('/api/calendar/receipts/'))throw Object.assign(new Error('Unknown'),{status:404});return++attempt===1?waiting.promise:{status:'completed',message:'Confirmé une seule fois'};});
  await dialog.preview();const pending=dialog.confirm();assert.equal(dialog.busy,true,'busy');assert.equal(dialog.fields.title.disabled,true,'title locked');assert.equal(dialog.connection.disabled,true,'connection locked');assert.equal(dialog.prompt.disabled,true,'prompt locked');assert.equal(dialog.confirmButton.disabled,true,'confirmation locked');assert.equal(dialog.editButton.disabled,true,'edit locked');
  dialog.close();assert.equal(dialog.dialog.open,true);await dialog.confirm();assert.equal(calls.length,2);
  waiting.reject(new Error('Réponse perdue'));await pending;assert.equal(dialog.busy,false);assert.equal(dialog.fields.title.disabled,true);assert.equal(dialog.editButton.disabled,true);assert.equal(dialog.confirmButton.disabled,false);
  const first=calls.at(-1)[1];await dialog.confirm();assert.deepEqual(calls.at(-1)[1],first);assert.equal(calls.filter(([url])=>url==='/api/calendar/confirm').length,2);assert.equal(dialog.receipt.status,'completed');
});

test('an invalidated interpretation cannot overwrite a changed request',async t=>{
  const waiting=deferred();const{dialog}=await fixture(t,async()=>waiting.promise);dialog.prompt.value='Ajoute un rendez-vous demain';
  const operation=dialog.interpret();dialog.prompt.value='Ma demande a changé';await dialog.prompt.emit('input');
  waiting.resolve({title:'Ancienne interprétation',startLocal:'2026-10-22T09:00',endLocal:'2026-10-22T10:00'});await operation;
  assert.equal(dialog.fields.title.value,event.title);assert.equal(dialog.prompt.value,'Ma demande a changé');assert.equal(dialog.busy,false);
});

test('calendar choices show writable agendas first, respect the chosen client and exclude stale accounts',()=>{
  const readOnly=agenda('claude','A lecture seule',{usable:false}),last=agenda('claude','Zoé agenda'),first=agenda('claude','Agenda principal'),codex=agenda('codex','Codex'),old=agenda('claude','Ancien',{stale:true}),disabled=agenda('claude','Désactivé',{status:'disabled'}),rows=[readOnly,last,codex,old,first,disabled];
  assert.deepEqual(calendarCreateChoices(rows,{client:'claude'}),[first,last,readOnly]);assert.equal(rows[0],readOnly);assert.equal(rows[1],last);
});

test('a lost confirmation survives closing and finds the completed receipt without a duplicate write',async t=>{
  let posted=0;const{dialog,calls}=await fixture(t,async url=>{if(url==='/api/calendar/preview')return preview;if(url==='/api/calendar/confirm'){posted++;throw new Error('Réponse perdue');}return{status:'completed',eventId:'event-existing',message:'Ajout déjà terminé'};});
  await dialog.preview();await dialog.confirm();const identity=dialog.pending.requestId;dialog.close();await dialog.open({prompt:'Une autre demande ne doit pas remplacer l’ajout en attente',connections:[agenda('claude','other')]});
  assert.equal(dialog.pending.requestId,identity);assert.equal(dialog.receipt.status,'completed');assert.equal(dialog.fields.title.value,event.title);assert.equal(posted,1);assert.equal(calls.at(-1)[0],`/api/calendar/receipts/${identity}`);
});

test('reload stores only an identity, reads its receipt and requires an explicit new request after completion',async t=>{
  const id='calendar_request_reload_123',memory=new Map([['oscar-calendar-request-v1',id]]),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const{dialog,calls}=await fixture(t,async()=>({status:'completed',requestId:id,eventId:'event-durable',message:'Ajout confirmé'}),{storage});
  assert.deepEqual(calls,[[`/api/calendar/receipts/${id}`,null]]);assert.equal(dialog.receipt.status,'completed');assert.deepEqual([...memory],[['oscar-calendar-request-v1',id]]);assert.equal(dialog.result.children.includes(dialog.newButton),true);
  await dialog.newButton.emit('click');assert.equal(dialog.pending,null);assert.equal(dialog.receipt,null);assert.equal(dialog.prompt.value,'');assert.equal(memory.size,0);assert.equal(calls.length,1);
});

test('a receipt absent after reload can never replay a write without its original preview token',async t=>{
  const id='calendar_request_missing_123',memory=new Map([['oscar-calendar-request-v1',id]]),storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const{dialog,calls}=await fixture(t,async()=>{throw Object.assign(new Error('Unknown request'),{status:404});},{storage});
  assert.equal(dialog.recoveryMissing,true);await dialog.confirm();assert.equal(calls.length,2);assert.ok(calls.every(([url])=>url===`/api/calendar/receipts/${id}`));assert.equal(dialog.fields.title.disabled,true);assert.equal(memory.get('oscar-calendar-request-v1'),id);
  await dialog.abandonButton.emit('click');assert.equal(memory.size,0);assert.equal(dialog.pending,null);assert.equal(dialog.fields.title.disabled,false);assert.equal(calls.length,2);
});

test('a pending creation is polled in read-only mode until the result is final',async t=>{
  const finished=deferred();let posts=0;const{dialog,calls}=await fixture(t,async url=>{if(url==='/api/calendar/preview')return preview;if(url==='/api/calendar/confirm'){posts++;return{status:'pending',message:'En préparation'};}finished.resolve();return{status:'completed',eventId:'event-polled',message:'Ajout terminé'};});
  await dialog.preview();await dialog.confirm();assert.equal(dialog.receipt,null);assert.equal(dialog.receiptStatus,'pending');assert.equal(dialog.fields.title.disabled,true);
  await finished.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(dialog.receipt.status,'completed');assert.equal(posts,1);assert.equal(calls.filter(([url])=>url.startsWith('/api/calendar/receipts/')).length,1);
});

test('calendar metadata may arrive after opening without overwriting the prompt or event fields',async t=>{
  const gate=deferred(),{dialog}=await fixture(t,async()=>preview,{connections:[],client:'claude',metadata:()=>gate.promise});
  assert.equal(dialog.dialog.open,true);assert.equal(dialog.connection.value,'');dialog.prompt.value='Mes précisions saisies pendant la recherche';dialog.fields.title.value='Titre saisi en attendant';
  gate.resolve({connections:[agenda('codex','wrong-client'),agenda('claude','Compte Claude')],clients:{claude:{status:'available'}}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dialog.connection.value,'claude:Compte Claude');assert.equal(dialog.connection.children.some(option=>option.value==='codex:wrong-client'),false);assert.equal(dialog.prompt.value,'Mes précisions saisies pendant la recherche');assert.equal(dialog.fields.title.value,'Titre saisi en attendant');assert.match(dialog.connectionNote.textContent,/Agenda principal/u);
});

test('late metadata from a closed dialog cannot replace the accounts or text of a reopened form',async t=>{
  const old=deferred();let call=0,signal;const{dialog}=await fixture(t,async()=>preview,{connections:[],metadata:(url,settings)=>{if(++call===1){signal=settings.signal;return old.promise;}return{connections:[agenda('codex','new-account')],clients:{}};}});
  dialog.close();assert.equal(signal.aborted,true);await dialog.open({connections:[],timeZone:'Europe/Brussels'});await new Promise(resolve=>setImmediate(resolve));dialog.prompt.value='Le nouveau texte';
  old.resolve({connections:[agenda('codex','old-account')],clients:{}});await new Promise(resolve=>setImmediate(resolve));assert.equal(dialog.connection.value,'codex:new-account');assert.equal(dialog.prompt.value,'Le nouveau texte');
});

test('interpretation exposes missing fields and its concrete ambiguity issues before preview',async t=>{
  const issue='La date reste à préciser.',{dialog}=await fixture(t,async()=>({title:'',missing:['title','startLocal'],issues:[issue],durationSource:'default'}));
  dialog.prompt.value='Ajoute un rendez-vous';await dialog.interpret();assert.match(dialog.message.textContent,/Complétez les détails manquants/u);assert.ok(dialog.message.textContent.includes(issue));assert.equal(dialog.fields.title.value,'');assert.equal(dialog.review.hidden,true);
});
