import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {Atelier} from '../lib/orchestrator.mjs';
import {createAtelierServer} from '../server.mjs';
import {DeliveryNavigation} from '../public/delivery-navigation.js';
import {selectDeliveryProjects} from '../public/delivery-library.js';

const records=()=>['completed','failed','needs_review','cancelled','running'].map((status,index)=>({
  id:`project-${index}`,title:`Projet ${index}`,prompt:index===0?'Un brief précis. '.repeat(180):`Demande du projet ${index}`,status,provider:'codex',createdAt:1000+index,updatedAt:2000+index,phase:status==='running'?'Oscar coordonne':'État conservé',
  files:[{path:'Livraison/rapport.txt',size:8},{path:'Livraison/notes.txt',size:5},null,{}, {path:42},{path:''}],
  tasks:[{id:'t1',status:status==='completed'?'approved':'failed',report:'PRIVATE_REPORT_SENTINEL'}],events:[{who:'Oscar',at:1800,kind:'activity',text:'PRIVATE_EVENT_SENTINEL'}],
  error:'PRIVATE_ERROR_SENTINEL',performance:{calls:[{details:'PRIVATE_PERFORMANCE_SENTINEL'}]},credentials:{token:'PRIVATE_AUTH_SENTINEL'},result:'PRIVATE_RESULT_SENTINEL',
}));
async function seed(engine,items){
  for(const item of items){engine.missions.set(item.id,item);const directory=engine.workDir(item.id);await mkdir(path.join(directory,'Livraison'),{recursive:true});await writeFile(path.join(directory,'Livraison','rapport.txt'),`Rapport local ${item.id}`);await writeFile(path.join(directory,'Livraison','notes.txt'),`Notes locales ${item.id}`);}
}
function assertSummaries(state,items){
  assert.equal(state.missions.length,items.length);assert.deepEqual(new Set(state.missions.map(item=>item.status)),new Set(items.map(item=>item.status)));
  const allowed=new Set(['id','title','prompt','filesCount','folderName','provider','status','createdAt','updatedAt','phase','assistant','assistantMode']);
  for(const original of items){
    const summary=state.missions.find(item=>item.id===original.id);assert.ok(summary);assert.equal(summary.prompt,typeof original.prompt==='string'?original.prompt.slice(0,1600):'');assert.ok(summary.prompt.length<=1600);assert.equal(summary.filesCount,Array.isArray(original.files)?2:0);assert.equal(summary.folderName,original.folderName);
    assert.ok(Object.keys(summary).every(key=>allowed.has(key)));assert.ok(!JSON.stringify(summary).includes('PRIVATE_'));for(const key of ['files','tasks','events','result','error','performance','credentials','workDirectory'])assert.equal(Object.hasOwn(summary,key),false,key);
  }
}
function navigation(){
  const requests=[],selected=[],changes=[];
  const instance=new DeliveryNavigation({load:(id,{signal})=>new Promise((resolve,reject)=>requests.push({id,signal,resolve,reject})),onSelect:detail=>selected.push(detail.id),onChange:state=>changes.push(state)});
  return{instance,requests,selected,changes};
}
async function appNavigation(){
  // Execute the actual navigation handlers, not the browser boot sequence.
  // All rendering, storage and HTTP dependencies are inert test doubles.
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),part=(start,end)=>{
    const first=source.indexOf(start),last=source.indexOf(end,first+start.length);assert.ok(first>=0&&last>first,`Navigation handler ${start}`);return source.slice(first,last);
  },requests=[],elements=new Map(),panels=[],files=[],browsers=[];
  const context={selectedId:'previous-project',mission:{id:'previous-project',status:'completed'},state:{missions:[],activeMissions:[]},refreshSequence:0,browsingNew:false,lastMissionSignature:'',pendingBriefRequest:null,completionStatuses:new Map(),pendingCompletions:new Map(),officeSpeech:null,activePanel:null,missionTiming:{setVisible:()=>{}},document:{querySelectorAll:()=>[]},
    closeMemberForNavigation:()=>{},closeOfficePanel:()=>{},switchBriefDraft:()=>{},saveBriefDraft:()=>{},renderAll:()=>{},showError:()=>{},dismissWelcome:()=>{},openAnotherOffice:()=>{},openPanel:(...args)=>panels.push(args),history:{replaceState:()=>{}},
    artifactViewer:{open:(item,file)=>files.push([item.id,file.path])},resultPreviewDialog:{open:(item,options)=>browsers.push([item.id,options.entry])},
    $:id=>{if(!elements.has(id))elements.set(id,{hidden:false,open:false,firstElementChild:null,focus:()=>{},lastElementChild:{firstElementChild:{textContent:''}}});return elements.get(id);},
    isRunning:item=>['planning','running','reviewing'].includes(item?.status),
    request:(route,{signal}={})=>new Promise((resolve,reject)=>requests.push({id:route.split('/').at(-1),signal,resolve,reject})),
  };
  context.activeMissions=()=>context.state.activeMissions;vm.createContext(context);
  vm.runInContext([
    part('function restorePanel(', '\nfunction closeOfficePanel('),
    part('function activateDeliveryProject(', '\nfunction showDeliveryDetail('),
    part('function showDeliveryDetail(', '\nfunction renderDeliveries('),
    part('function openDeliveryFile(', '\nasync function viewResult('),
    part('async function selectMission(', '\nasync function acceptState('),
    part('function newMission(', '\nfunction acceptLaunchedMission('),
    part('function acceptLaunchedMission(', '\nasync function launch('),
  ].join('\n'),context,{filename:'app-navigation-handlers.js'});
  const nav=new DeliveryNavigation({load:(id,{signal})=>context.request(`/api/missions/${id}`,{signal}),onSelect:detail=>context.activateDeliveryProject(detail)});context.deliveryNavigation=nav;
  return{context,nav,requests,panels,files,browsers};
}

test('state summaries retain every outcome with bounded briefs and counts, without private delivery details',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-library-summaries-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));let modelCalls=0;
  const engine=new Atelier({dataDir,providers:[],runAgent:async()=>{modelCalls++;throw new Error('No model permitted');}}),items=records();
  items.push({id:'legacy-project',title:'Ancien dossier',status:'failed',provider:'claude',createdAt:500,updatedAt:600,tasks:[],events:[]});await seed(engine,items);
  assertSummaries(engine.state(),items);assert.equal(modelCalls,0);
  const selected=selectDeliveryProjects(engine.state());assert.equal(selected.length,items.length);assert.ok(selected.some(item=>item.status==='failed'));assert.ok(selected.some(item=>item.status==='cancelled'));
});

test('inverted detail responses select only the last chosen folder',async()=>{
  const{instance,requests,selected}=navigation();const first=instance.open('project-a'),second=instance.open('project-b');
  assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,true);assert.equal(instance.state.mode,'loading');assert.equal(instance.state.id,'project-b');
  requests[1].resolve({id:'project-b',status:'failed',files:[]});assert.equal((await second).id,'project-b');requests[0].resolve({id:'project-a',status:'completed',files:[]});assert.equal(await first,undefined);
  assert.deepEqual(selected,['project-b']);assert.equal(instance.state.detail.id,'project-b');assert.equal(instance.state.mode,'detail');instance.destroy();
});

test('returning to all projects cancels pending selection without creating a new mission',async()=>{
  const{instance,requests,selected,changes}=navigation(),pending=instance.open('project-a');instance.library();const returned=changes.at(-1);assert.equal(returned.mode,'library');assert.equal(requests[0].signal.aborted,true);
  requests[0].resolve({id:'project-a',status:'completed'});await pending;assert.equal(instance.state.mode,'library');assert.deepEqual(selected,[]);assert.equal(changes.at(-1),returned);instance.destroy();
});

test('a mismatched mission response is rejected and errors can be retried explicitly',async()=>{
  const{instance,requests,selected}=navigation();const mismatched=instance.open('project-a');requests[0].resolve({id:'project-b',status:'completed'});await mismatched;assert.equal(instance.state.mode,'error');assert.equal(instance.state.id,'project-a');assert.deepEqual(selected,[]);
  const failure=instance.open('project-a');requests[1].reject(new Error('Local folder unavailable'));await failure;assert.equal(instance.state.mode,'error');assert.equal(instance.state.error,'Local folder unavailable');
  const retry=instance.open('project-a');requests[2].resolve({id:'project-a',status:'needs_review'});await retry;assert.equal(instance.state.mode,'detail');assert.equal(instance.state.error,null);assert.deepEqual(selected,['project-a']);instance.destroy();
});

test('known detail views and destruction invalidate older requests; unsafe IDs perform no read',async()=>{
  const{instance,requests,selected}=navigation();for(const id of [null,undefined,'','../project-a','a/b','a?b',' a','a'.repeat(101)])await instance.open(id);assert.equal(requests.length,0);
  const pending=instance.open('project-a'),known={id:'project-b',status:'completed',files:[]};instance.show(known);assert.equal(requests[0].signal.aborted,true);requests[0].resolve({id:'project-a'});await pending;assert.equal(instance.state.detail,known);assert.deepEqual(selected,[]);
  const last=instance.open('project-c');instance.destroy();assert.equal(requests[1].signal.aborted,true);requests[1].resolve({id:'project-c'});await last;assert.deepEqual(selected,[]);await instance.open('project-d');assert.equal(requests.length,2);
});

test('actual app handlers cancel a late folder response when a new mission or another history item is chosen',async()=>{
  for(const action of ['new','history','launched']){
    const{context,nav,requests}=await appNavigation(),late=nav.open('project-a');
    if(action==='new')context.newMission({forceLocal:true});
    else if(action==='launched')context.acceptLaunchedMission({id:'newly-launched',status:'running'},'codex');
    else{const chosen=context.selectMission('project-b',{fromHistory:true});requests[1].resolve({id:'project-b',status:'completed'});await chosen;}
    assert.equal(requests[0].signal.aborted,true,action);requests[0].resolve({id:'project-a',status:'completed'});await late;
    assert.equal(context.selectedId,action==='new'?null:action==='history'?'project-b':'newly-launched',action);assert.notEqual(context.mission?.id,'project-a',action);assert.notEqual(nav.state.mode,'detail',action);nav.destroy();
  }
});

test('a background state refresh preserves the pending folder choice but cannot overwrite it later',async()=>{
  const{context,nav,requests}=await appNavigation(),chosen=nav.open('project-a'),refresh=context.selectMission('previous-project',{background:true});
  assert.equal(requests[0].signal.aborted,false);requests[0].resolve({id:'project-a',status:'failed'});await chosen;assert.equal(context.mission.id,'project-a');
  requests[1].resolve({id:'previous-project',status:'completed'});await refresh;assert.equal(context.selectedId,'project-a');assert.equal(context.mission.id,'project-a');assert.equal(nav.state.detail.id,'project-a');nav.destroy();
});

test('the native panel close path cancels a pending folder read just like the close button',async()=>{
  const{context,nav,requests}=await appNavigation();context.activePanel='delivery';const late=nav.open('project-a');context.restorePanel();
  assert.equal(requests[0].signal.aborted,true);assert.equal(context.activePanel,null);requests[0].resolve({id:'project-a',status:'completed'});await late;assert.equal(context.selectedId,'previous-project');assert.equal(nav.state.mode,'library');nav.destroy();
});

test('a file opened from another project balance establishes that project before preview and return',async()=>{
  const{context,nav,files,browsers,panels,requests}=await appNavigation(),item={id:'project-a',status:'completed',title:'Projet A',prompt:'Demande A',updatedAt:2000};
  context.openDeliveryFile(item,{path:'Livraison/rapport.pdf'});assert.equal(context.selectedId,'project-a');assert.equal(context.mission.id,'project-a');assert.equal(nav.state.detail.id,'project-a');assert.deepEqual(files,[['project-a','Livraison/rapport.pdf']]);
  context.showDeliveryDetail();assert.equal(panels.at(-1)[0],'delivery');assert.equal(panels.at(-1)[1].deliveryView,'detail');assert.equal(context.mission.id,'project-a');
  context.openDeliveryFile(item,{path:'Livraison/index.html'});assert.deepEqual(browsers,[['project-a','Livraison/index.html']]);assert.equal(requests.length,0,'Previewing a known mission does not launch or reload another mission.');nav.destroy();
});

test('the real read-only library API opens the chosen details and native folder without model calls',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-library-api-')),calls={models:0,folders:[],requests:[]};
  const app=await createAtelierServer({port:0,dataDir,providers:[],runner:async()=>{calls.models++;throw new Error('No model permitted');},openFolder:async directory=>calls.folders.push(directory)});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const items=records();await seed(app.engine,items);const base=`http://127.0.0.1:${app.server.address().port}`;
  const state=await fetch(base+'/api/state').then(response=>response.json());assertSummaries(state,items);assert.ok(state.missions.some(item=>item.status==='failed'));
  const selected=[],nav=new DeliveryNavigation({load:async(id,{signal})=>{calls.requests.push(id);const response=await fetch(`${base}/api/missions/${encodeURIComponent(id)}`,{signal});assert.equal(response.status,200);return response.json();},onSelect:detail=>selected.push(detail.id)});
  const first=await nav.open('project-0');assert.equal(first.status,'completed');const second=await nav.open('project-1');assert.equal(second.status,'failed');assert.equal(second.prompt,items[1].prompt);assert.equal(second.files[0].path,'Livraison/rapport.txt');assert.match(second.workDirectory,/travail$/u);
  const response=await fetch(`${base}/api/missions/${second.id}/open-folder`,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:'{}'});assert.equal(response.status,200);assert.deepEqual(calls.folders,[app.engine.workDir('project-1')]);assert.notEqual(calls.folders[0],app.engine.workDir('project-0'));
  nav.library();assert.equal(nav.state.mode,'library');assert.deepEqual(selected,['project-0','project-1']);assert.deepEqual(calls.requests,['project-0','project-1']);assert.equal(calls.models,0);nav.destroy();
  const shell=await fetch(base+'/').then(response=>response.text());for(const id of ['delivery-library','delivery-library-view','delivery-project-detail','delivery-back-library','delivery-project-loading','delivery-project-error','delivery-project-retry'])assert.ok(shell.includes(`id="${id}"`),id);
  for(const asset of ['delivery-library.js','delivery-library.css','delivery-navigation.js','translations-delivery-library.js'])assert.equal((await fetch(base+'/'+asset)).status,200,asset);
});
