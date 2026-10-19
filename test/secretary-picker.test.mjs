import test from 'node:test';
import assert from 'node:assert/strict';
import {SecretaryDialog,secretaryConnections} from '../public/secretary-dialog.js';
import {translate} from '../public/i18n.js';
import {DraftStorage} from '../public/draft-storage.js';

const gmail={client:'codex',name:'gmail',displayName:'Gmail',source:'chatgpt',inherited:true,status:'authorized',readOnlyAutomation:{available:true,service:'gmail'}};
const calendar={...gmail,name:'calendar',displayName:'Google Calendar',readOnlyAutomation:{available:true,service:'calendar'}};
const drive={...gmail,name:'google_drive',displayName:'Google Drive',readOnlyAutomation:{available:true,service:'app'}};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function answerDom(){
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.className='';this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];this._text='';}
  setAttribute(){}
  addEventListener(){}
  querySelector(selector){return this.children.flatMap(child=>[child,...(child.descendants?.()||[])]).find(child=>selector.startsWith('.')&&child.className?.split(' ').includes(selector.slice(1)))||null;}
  descendants(){return this.children.flatMap(child=>[child,...(child.descendants?.()||[])]);}
 }
 return {activeElement:null,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:String(text)})};
}
function harness(request=async()=>({})){
  const dialog=Object.create(SecretaryDialog.prototype);
  Object.assign(dialog,{request,epoch:1,dialog:{open:true,close(){this.open=false;}},connections:[],connectionClients:{},verified:false,entries:[],directMissions:new Map(),client:{value:'codex'},mode:'mail',connection:{value:'codex:gmail'},schedule:{value:'immediate'},scheduleTime:{value:'02:00'},prompt:{value:'Préparer une synthèse.'},region:{value:''},getProfile:()=>({}),getState:()=>({providers:[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}}]}),form:{reportValidity:()=>true},runButton:{disabled:false},error:{hidden:true},notice:{hidden:true},draftStore:{remove(){}},draftMessage:{},answers:{scrollIntoView(){}},locateButton:{},onClose(){},renderConnections(){},renderAnswers(){},update(){},activity(){},poll(){},requestIdentity:async()=> 'request_picker_123'});
  return dialog;
}

test('Zoé keeps confirmed Gmail, Calendar and app services, excluding stale or unconfirmed entries',()=>{
  const slack={...drive,name:'slack',displayName:'Slack'};
  const rows=[gmail,calendar,drive,slack,{...drive,name:'expired',stale:true},{...drive,name:'unverified',status:'unverified'},{...drive,name:'write-only',readOnlyAutomation:{available:false,service:'app'}},{...drive,name:'unknown',readOnlyAutomation:{available:true,service:'unknown'}},{...gmail,client:'claude',name:'claude-gmail'}];
  assert.deepEqual(secretaryConnections(rows,{client:'codex',mode:'mail'}),[gmail]);
  assert.deepEqual(secretaryConnections(rows,{client:'codex',mode:'calendar'}),[calendar]);
  assert.deepEqual(secretaryConnections(rows,{client:'codex',mode:'service'}),[gmail,calendar,drive,slack]);
  assert.equal(secretaryConnections(rows,{mode:'service'}).length,5);
});

test('a verified Claude Drive connection belongs to My services and never to mail or calendar',()=>{
 const claudeDrive={...drive,client:'claude',name:'claudeai-drive',status:'connected',readOnlyAutomation:{available:true,service:'drive'}};
 assert.deepEqual(secretaryConnections([gmail,claudeDrive],{client:'claude',mode:'service'}),[claudeDrive]);
 for(const mode of ['mail','calendar'])assert.deepEqual(secretaryConnections([claudeDrive],{client:'claude',mode}),[]);
 assert.deepEqual(secretaryConnections([{...claudeDrive,stale:true}],{client:'claude',mode:'service'}),[]);
});

test('answer cards follow the current mode and explicit engine, with engine labels and an intact history',()=>{
 const original=globalThis.document;globalThis.document=answerDom();
 try{
  const dialog=harness();dialog.mode='service';dialog.answers=document.createElement('section');dialog.renderAnswers=SecretaryDialog.prototype.renderAnswers;
  const codex={id:'codex-drive',assistantMode:'service',provider:'codex',createdAt:1,title:'Drive Codex',status:'completed',result:'Réponse Drive Codex.'},mail={...codex,id:'codex-mail',assistantMode:'mail',createdAt:2,title:'Mails Codex',result:'Réponse Gmail.'};
  dialog.directMissions=new Map([[codex.id,codex],[mail.id,mail]]);dialog.renderAnswers();assert.equal(dialog.answers.hidden,false);assert.match(dialog.answers.textContent,/Drive Codex/);assert.doesNotMatch(dialog.answers.textContent,/Mails Codex/);assert.equal(dialog.answers.querySelector('.secretary-answer-engine').textContent,'Codex · ChatGPT');
  const codexSignature=dialog.answersSignature;dialog.client.value='claude';dialog.renderAnswers();assert.notEqual(dialog.answersSignature,codexSignature);assert.equal(dialog.answers.hidden,true);assert.equal(dialog.answers.children.length,0);
  const claude={...codex,id:'claude-drive',provider:'claude',createdAt:3,title:'Drive Claude',result:'Réponse Drive Claude.'};dialog.directMissions.set(claude.id,claude);dialog.renderAnswers();assert.equal(dialog.answers.hidden,false);assert.match(dialog.answers.textContent,/Drive Claude/);assert.doesNotMatch(dialog.answers.textContent,/Drive Codex/);assert.equal(dialog.answers.querySelector('.secretary-answer-engine').textContent,'Claude Code');
  dialog.mode='mail';dialog.renderAnswers();assert.equal(dialog.answers.hidden,true);assert.doesNotMatch(dialog.answers.textContent,/Drive/);
  dialog.client.value='auto';dialog.renderAnswers();assert.match(dialog.answers.textContent,/Mails Codex/);assert.doesNotMatch(dialog.answers.textContent,/Drive/);
  dialog.mode='service';dialog.renderAnswers();assert.match(dialog.answers.textContent,/Drive Codex/);assert.match(dialog.answers.textContent,/Drive Claude/);assert.equal(dialog.directMissions.size,3);assert.deepEqual(dialog.directMissions.get(codex.id),codex);
 }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});

test('choosing a mode or an exact service immediately rerenders the matching answer cards',()=>{
 const dialog=harness(),renders=[];dialog.drafts={mail:'Mails',service:'Services'};dialog.prompt.focus=()=>{};dialog.requestChanged=()=>{};dialog.renderAnswers=()=>renders.push([dialog.mode,dialog.client.value]);dialog.connections=[drive,{...drive,client:'claude',name:'claude-drive'}];dialog.refreshConnections=()=>{};
 dialog.choose('service');assert.deepEqual(renders,[['service','codex']]);
 assert.equal(dialog.selectService({client:'claude',name:'claude-drive'}),true);assert.deepEqual(renders,[['service','codex'],['service','claude']]);
});

test('Gmail is displayed while Codex is checking and a routine request is still pending',async()=>{
  const routines=deferred(),calls=[];
  const dialog=harness(async url=>{calls.push(url);return url==='/api/automations'?routines.promise:{connections:[gmail,calendar,drive],clients:{codex:{available:true,status:'checking'},claude:{available:true,status:'checking'}}};});
  const pending=dialog.refresh(true);await tick();
  assert.deepEqual(calls,['/api/automations','/api/connectors']);
  assert.equal(dialog.verified,true);assert.deepEqual(dialog.available(),[gmail]);assert.equal(dialog.checkingConnections(),true);
  assert.equal(dialog.providerReady('codex'),true);
  routines.reject(new Error('Routine unavailable'));await pending;
  assert.deepEqual(dialog.available(),[gmail]);assert.equal(dialog.verified,true);
});

test('a long or failed Claude check does not keep Codex in the checking state',()=>{
  const dialog=harness();dialog.verified=true;dialog.connections=[gmail];
  for(const status of ['checking','failed']){
    dialog.connectionClients={codex:{available:true,status:'available'},claude:{available:true,status}};
    assert.equal(dialog.checkingConnections(),false);assert.deepEqual(dialog.available(),[gmail]);
    dialog.client.value='auto';assert.equal(dialog.checkingConnections(),status==='checking');dialog.client.value='codex';
  }
});

test('all connected apps remain visible in My services while unavailable or stale reads stay unselectable',()=>{
  const unavailable={...drive,name:'design',displayName:'Design',readOnlyAutomation:{available:false,service:null}},stale={...drive,name:'old-drive',status:'unverified',stale:true};
  const dialog=harness();dialog.mode='service';dialog.connections=[drive,unavailable,calendar,stale,gmail];
  assert.deepEqual(dialog.displayedConnections().map(row=>row.name),['gmail','calendar','google_drive','design','old-drive']);
  assert.deepEqual(dialog.available(),[drive,calendar,gmail]);dialog.connection.value='codex:design';assert.equal(dialog.selectedConnection(),undefined);assert.throws(()=>dialog.payload(false),/service déjà autorisé/u);
});

test('a transient connector request failure preserves confirmed choices; a stale snapshot removes them',async()=>{
  let phase=0;const dialog=harness(async()=>{if(phase===1)throw new Error('Temporary outage');return{connections:phase===2?[{...gmail,stale:true}]:[gmail],clients:{codex:{status:'available'}}};});
  await dialog.refreshConnections();phase=1;await dialog.refreshConnections();assert.deepEqual(dialog.available(),[gmail]);assert.equal(dialog.verified,true);
  phase=2;await dialog.refreshConnections();assert.deepEqual(dialog.available(),[]);
});

test('closing cancels discovery and a late response cannot overwrite a reopened dialog',async()=>{
  const first=deferred();let signal,count=0;
  const dialog=harness(async(url,options)=>{if(++count===1){signal=options.signal;return first.promise;}return{connections:[drive],clients:{codex:{status:'available'}}};});
  const pending=dialog.refreshConnections();dialog.close();assert.equal(signal.aborted,true);assert.equal(dialog.connectorsLoading,false);
  dialog.dialog.open=true;dialog.epoch++;await dialog.refreshConnections();first.resolve({connections:[gmail],clients:{codex:{status:'checking'}}});await pending;
  assert.deepEqual(dialog.connections,[drive]);assert.equal(dialog.discoveryPending,false);
});

test('immediate work posts only a direct request and can never silently create a daily routine',async()=>{
  const posts=[];const dialog=harness(async(url,options)=>{posts.push([url,JSON.parse(options.body)]);return{id:'direct-request',assistant:true,status:'completed'};});dialog.connections=[gmail];
  assert.throws(()=>dialog.payload(true),/rythme régulier/u);await dialog.submit(true);assert.equal(posts.length,0);
  await dialog.submit(false);assert.equal(posts.length,1);assert.equal(posts[0][0],'/api/secretary');assert.equal(posts[0][1].connectorName,'gmail');assert.equal(posts[0][1].mode,'mail');assert.equal('schedule' in posts[0][1],false);
});

test('a generic service request names exactly the selected confirmed app',async()=>{
  const posts=[];const dialog=harness(async(url,options)=>{posts.push([url,JSON.parse(options.body)]);return{id:'drive-request',assistant:true,status:'completed'};});
  dialog.mode='service';dialog.connections=[gmail,drive];dialog.connection.value='codex:google_drive';
  await dialog.submit(false);assert.equal(posts[0][0],'/api/secretary');assert.equal(posts[0][1].mode,'service');assert.equal(posts[0][1].connectorName,'google_drive');assert.equal('enabledTools' in posts[0][1],false);
});

test('opening Zoé from a connector targets that exact service and waits for its confirmed snapshot',async()=>{
  const snapshot=deferred(),dialog=harness(async()=>snapshot.promise);dialog.mode='service';dialog.connections=[gmail];dialog.requestChanged=()=>{};dialog.renderConnections=function(){this.connection.value=this.connectionChoice(this.available());};
  const target={client:'codex',name:'chatgpt-'+ 'a'.repeat(96)};
  assert.equal(dialog.selectService(target),true);assert.equal(dialog.connection.value,'');assert.equal(dialog.selectedConnection(),undefined);assert.deepEqual(dialog.pendingService,target);
  const requested=dialog.connectorsRefresh;assert.ok(requested);snapshot.resolve({connections:[gmail,{...drive,name:target.name}],clients:{codex:{status:'available'}}});await tick();
  assert.equal(dialog.connection.value,'codex:'+target.name);assert.equal(dialog.selectedConnection().displayName,'Google Drive');assert.equal(dialog.pendingService,null);
  assert.equal(dialog.selectService({client:'codex',name:'../unsafe'}),false);
});

test('opening a stale connector cannot select a different confirmed app as a fallback',()=>{
  const dialog=harness();dialog.mode='service';dialog.connections=[gmail,{...drive,stale:true}];dialog.requestChanged=()=>{};dialog.renderConnections=function(){this.connection.value=this.connectionChoice(this.available());};dialog.refreshConnections=()=>{};
  dialog.selectService({client:'codex',name:drive.name});assert.equal(dialog.connection.value,'');assert.equal(dialog.selectedConnection(),undefined);assert.throws(()=>dialog.payload(false),/service déjà autorisé/u);
});

test('a selected service lost during refresh or an engine change never falls back to another account',()=>{
 const dialog=harness();dialog.mode='service';dialog.connections=[gmail,drive];dialog.connection.value='codex:google_drive';
 assert.equal(dialog.connectionChoice(dialog.available()),'codex:google_drive');
 dialog.connections=[gmail,{...drive,stale:true}];dialog.connection.value=dialog.connectionChoice(dialog.available());assert.equal(dialog.connection.value,'');
 assert.equal(dialog.connectionChoice(dialog.available()),'','later snapshots must keep the missing choice empty');
 dialog.connections=[gmail,drive];assert.equal(dialog.connectionChoice(dialog.available()),'','restoring access still requires an explicit choice');
 dialog.connection.value='codex:google_drive';assert.equal(dialog.connectionChoice(dialog.available()),'codex:google_drive');
 dialog.client.value='claude';dialog.connections.push({...gmail,client:'claude'});dialog.connection.value=dialog.connectionChoice(dialog.available());assert.equal(dialog.connection.value,'');assert.equal(dialog.connectionChoice(dialog.available()),'');
});

test('an uncertain request recovers its durable mission before form, engine or service validation',async()=>{
 const calls=[],id='recovery_request_123',mission={id:'recovered-mission',assistant:true,assistantMode:'service',provider:'codex',status:'completed',secretaryRequest:{id}};
 const dialog=harness(async url=>{calls.push(url);return{status:'accepted',mission};});dialog.pendingRequest={id,hash:'a'.repeat(64)};dialog.mode='service';dialog.connections=[];dialog.runButton.disabled=true;dialog.form.reportValidity=()=>{throw new Error('Recovery must not validate a new form');};dialog.payload=()=>{throw new Error('Recovery must not prepare a new request');};
 await dialog.submit(false);assert.deepEqual(calls,['/api/secretary-requests/'+id]);assert.equal(dialog.directMissions.get(mission.id),mission);assert.equal(dialog.pendingRequest,null);
});

test('checking, invalid lookup responses and lookup errors retain the request without posting',async()=>{
 for(const response of [{status:'checking'},{status:'accepted',mission:{id:'wrong-mission',assistant:true,secretaryRequest:{id:'another_request'}}},Object.assign(new Error('Unavailable'),{status:503})]){
  const calls=[],id='recovery_waiting_123',dialog=harness(async url=>{calls.push(url);if(response instanceof Error)throw response;return response;});dialog.pendingRequest={id,hash:'a'.repeat(64)};
  await dialog.submit(false);assert.deepEqual(calls,['/api/secretary-requests/'+id]);assert.equal(dialog.pendingRequest.id,id);assert.equal(dialog.pendingRequest.absent,false);assert.equal(dialog.error.hidden,false);
 }
});

test('only a confirmed absence retries the exact original request with its original identity',async()=>{
 const calls=[],id='recovery_absent_123',body={mode:'service',prompt:'Original exact request',provider:'codex',connectorName:'google_drive'};
 const dialog=harness(async(url,options)=>{calls.push([url,options]);if(url.startsWith('/api/secretary-requests/'))throw Object.assign(new Error('Unknown'),{status:404});return{id:'retried-mission',assistant:true};});
 dialog.requestIdentity=SecretaryDialog.prototype.requestIdentity;dialog.saveDraft=()=>{};dialog.pendingRequest={id,hash:await dialog.requestHash(body),signature:JSON.stringify(body)};dialog.payload=()=>{throw new Error('Use the exact in-memory request');};
 await dialog.submit(false);assert.equal(calls.length,2);assert.equal(calls[0][0],'/api/secretary-requests/'+id);assert.deepEqual(JSON.parse(calls[1][1].body),{...body,requestId:id});assert.equal(dialog.pendingRequest,null);
});

test('a restored request with a changed service refuses to create a replacement identity after 404',async()=>{
 const calls=[],dialog=harness(async url=>{calls.push(url);throw Object.assign(new Error('Unknown'),{status:404});});dialog.mode='service';dialog.connections=[gmail,drive];dialog.connection.value='codex:google_drive';dialog.requestIdentity=SecretaryDialog.prototype.requestIdentity;dialog.saveDraft=()=>{};
 const payload=dialog.payload(false),body={mode:dialog.mode,prompt:payload.prompt,provider:payload.provider,connectorName:payload.connectorName};
 dialog.pendingRequest={id:'recovery_changed_123',hash:await dialog.requestHash(body)};dialog.connection.value='codex:gmail';
 await dialog.submit(false);assert.deepEqual(calls,['/api/secretary-requests/recovery_changed_123']);assert.equal(dialog.pendingRequest.id,'recovery_changed_123');assert.equal(dialog.pendingRequest.absent,true);assert.match(dialog.error.textContent,/Cette demande a changé/u);
});

test('a late recovery lookup or identity hash cannot modify a reopened request',async()=>{
 const response=deferred(),dialog=harness(()=>response.promise);dialog.pendingRequest={id:'recovery_old_123',hash:'a'.repeat(64)};
 const recovering=dialog.submit(false);await tick();dialog.close();dialog.dialog.open=true;dialog.epoch++;dialog.pendingRequest={id:'recovery_new_123',hash:'b'.repeat(64)};
 response.reject(Object.assign(new Error('Unknown'),{status:404}));await recovering;assert.deepEqual(dialog.pendingRequest,{id:'recovery_new_123',hash:'b'.repeat(64)});
 const hash=deferred();dialog.requestHash=()=>hash.promise;dialog.pendingRequest=null;dialog.saveDraft=()=>{throw new Error('A stale identity must not be saved');};let current=true;
 const identity=SecretaryDialog.prototype.requestIdentity.call(dialog,{mode:'free',prompt:'Question',provider:'codex'},{isCurrent:()=>current});current=false;hash.resolve('a'.repeat(64));assert.equal(await identity,null);assert.equal(dialog.pendingRequest,null);
});

test('a My services draft preserves its mode and text without storing the selected account',()=>{
  const memory=new Map(),draft=new DraftStorage({scope:'services-test',storage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)}});
  draft.write('secretary',{text:'Retrouver mon compte rendu.',mode:'service',provider:'codex',connectorName:drive.name});
  assert.deepEqual(draft.read('secretary'),{text:'Retrouver mon compte rendu.',mode:'service',provider:'codex'});
});

test('regular schedules preserve the chosen local time and reject invalid times',()=>{
  const dialog=harness();dialog.connections=[gmail];
  for(const frequency of ['daily','weekdays']){dialog.schedule.value=frequency;dialog.scheduleTime.value='17:45';assert.deepEqual(dialog.payload(true).schedule,{frequency,time:'17:45'});dialog.scheduleTime.value='25:00';assert.throws(()=>dialog.payload(true),/heure valide/u);}
  dialog.schedule.value='interval';assert.deepEqual(dialog.payload(true).schedule,{frequency:'interval',time:'02:00',intervalMinutes:60});
});

test('closing during a direct request aborts it and ignores a late mission response',async()=>{
  const response=deferred();let signal;
  const dialog=harness(async(url,options)=>{signal=options.signal;return response.promise;});dialog.connections=[gmail];
  const pending=dialog.submit(false);await tick();dialog.close();assert.equal(signal.aborted,true);
  response.resolve({id:'late-mission',assistant:true,status:'running'});await pending;
  assert.equal(dialog.directMissions.size,0);assert.equal(dialog.submitting,false);assert.equal(dialog.error.hidden,true);
});

test('the service picker and immediate schedule instructions are translated into English and Dutch',()=>{
  for(const source of ['◇ Mes services','Mes services','Vos services connectés, avec Zoé','Zoé — Mes services','Quand Zoé doit-elle travailler ?','Travail immédiat','Heure locale de la routine','Choisissez un rythme régulier avant de programmer.','Indiquez une heure valide pour cette routine.','Les services confirmés sont disponibles. La liste se complète automatiquement pendant la vérification.','Le service choisi n’est plus disponible dans cet onglet ou ce moteur. Sélectionnez explicitement le service à utiliser.','Retrouver ma demande','Commencer une nouvelle demande','Votre demande attend sa confirmation. Retrouvez-la avant de lancer un nouveau travail.','Cette demande a changé. Commencez une nouvelle demande pour utiliser ce contexte.','Retrouvez la demande précédente ou commencez une nouvelle demande avant de programmer.','L’identifiant de reprise de cette demande est invalide.','Demande inconnue.'])for(const locale of ['en','nl'])assert.notEqual(translate(source,locale),source,`${locale}: ${source}`);
});
