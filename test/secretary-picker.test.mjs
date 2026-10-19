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
  for(const source of ['◇ Mes services','Mes services','Vos services connectés, avec Zoé','Zoé — Mes services','Quand Zoé doit-elle travailler ?','Travail immédiat','Heure locale de la routine','Choisissez un rythme régulier avant de programmer.','Indiquez une heure valide pour cette routine.','Les services confirmés sont disponibles. La liste se complète automatiquement pendant la vérification.'])for(const locale of ['en','nl'])assert.notEqual(translate(source,locale),source,`${locale}: ${source}`);
});
