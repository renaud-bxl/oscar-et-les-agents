import test from 'node:test';
import assert from 'node:assert/strict';
import {DeliveryProgress,deliveryProgressSnapshot} from '../public/delivery-progress.js';
import {setLocale} from '../public/i18n.js';

const call=(values={})=>({agent:'Oscar',stage:'review',startedAt:2000,status:'running',durationMs:null,...values});
const mission=(values={})=>({id:'mission-1',provider:'codex',status:'running',createdAt:1000,updatedAt:10000,
  tasks:[{id:'t1',status:'approved'},{id:'t2',status:'reviewing'},{id:'t3',status:'working'},{id:'t4',status:'queued'}],
  performance:{calls:[call()]},events:[],...values});
const snapshot=(value,now=10000)=>deliveryProgressSnapshot(value,{now,locale:'fr'});

function dom(){
  const document={hidden:false,handlers:new Map(),activeElement:null};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.dataset={};this.textContent='';this.hidden=false;this.isConnected=true;this.handlers=new Map();}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    setAttribute(key,value){this[key]=value;}
    closest(){return null;}
    getClientRects(){return[{}];}
    addEventListener(name,action){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(action);}
    removeEventListener(name,action){this.handlers.get(name)?.delete(action);}
    click(){for(const action of this.handlers.get('click')||[])action();}
    focus(){document.activeElement=this;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.isConnected=false;}
  }
  document.createElement=tag=>new Element(tag);
  document.addEventListener=(name,action)=>{if(!document.handlers.has(name))document.handlers.set(name,new Set());document.handlers.get(name).add(action);};
  document.removeEventListener=(name,action)=>document.handlers.get(name)?.delete(action);
  document.emit=name=>{for(const action of document.handlers.get(name)||[])action();};
  return{document,container:document.createElement('div')};
}
function clock(){
  let current=10000,next=0;const queue=new Map();
  return{now:()=>current,timers:{setTimeout(action,delay){const id=++next;queue.set(id,{action,delay});return id;},clearTimeout(id){queue.delete(id);}},queue,
    tick(ms=500){current+=ms;const pending=[...queue];queue.clear();for(const[,entry]of pending)entry.action();}};
}

test('only real Oscar delivery work or a reviewing state displays the active notice',()=>{
  assert.equal(snapshot(null),null);assert.equal(snapshot(mission({performance:{calls:[]}})),null);
  assert.equal(snapshot(mission({performance:{calls:[call({agent:'Alma',stage:'creation'})]}})),null);
  assert.equal(snapshot(mission({performance:{calls:[call({stage:'planning'})]}})),null);
  assert.equal(snapshot(mission({performance:{calls:[call({stage:'answer'})]}})),null);
  const data=snapshot(mission());assert.equal(data.title,'Oscar vérifie les contributions');assert.equal(data.phase,'Relecture des contributions');assert.equal(data.elapsedMs,8000);assert.equal(data.active,true);assert.equal(data.action,'progress');assert.equal(data.dismissible,false);
  for(const[stage,title,phase]of [['assembly','Oscar prépare votre livraison','Assemblage de la livraison'],['final-review','Oscar vérifie votre livraison','Contrôle final de la livraison']]){
    const item=snapshot(mission({performance:{calls:[call({stage})]}}));assert.equal(item.title,title);assert.equal(item.phase,phase);
  }
  const between=snapshot(mission({status:'reviewing',phase:'Oscar assemble la livraison',performance:{calls:[]}}));assert.equal(between.call,null);assert.equal(between.elapsedMs,null);assert.equal(between.phase,'Oscar assemble la livraison');assert.match(between.note,/Aucun appel/u);
  const afterReview=snapshot(mission({status:'reviewing',phase:'Oscar assemble la livraison',performance:{calls:[call({status:'completed',durationMs:1000})]}}));assert.equal(afterReview.stage,null);assert.equal(afterReview.title,'Oscar prépare votre livraison');assert.equal(afterReview.phase,'Oscar assemble la livraison');
});

test('counts use the real task states and cannot turn an active mission into a completed delivery',()=>{
  const source=mission({tasks:[{id:'t1',status:'approved'},{id:'t2',status:'reviewing'},{id:'t3',status:'needs_review'},{id:'t4',status:'revising',report:'previous attempt'},{id:'t5',status:'queued',paper:true}],events:[{kind:'approved'},{kind:'handoff'}]});
  const before=JSON.stringify(source),data=snapshot(source);assert.deepEqual(data.counts,{submitted:3,approved:1,total:5});assert.equal(data.state,'active');assert.equal(data.action,'progress');assert.equal(JSON.stringify(source),before);
  const allApproved=snapshot(mission({tasks:[{status:'approved'}]}));assert.equal(allApproved.title,'Oscar vérifie les contributions');assert.equal(allApproved.action,'progress');assert.equal(allApproved.terminal,false);
});

test('only current-call Oscar activity is shown, and a real new return resets the silence notice',()=>{
  const source=mission({performance:{calls:[call({startedAt:5000})]},events:[
    {at:3000,who:'Oscar',kind:'activity',text:'Previous call'},
    {at:6000,who:'Alma',kind:'activity',text:'Specialist'},
    {at:6100,who:'Oscar',kind:'info',text:'Decorative info'},
    {at:7000,who:'Oscar',kind:'activity',text:'Je vérifie les fichiers.'},
    {at:90000,who:'Oscar',kind:'activity',text:'Future'},
  ]});
  const data=snapshot(source,36999);assert.equal(data.lastActivity.text,'Je vérifie les fichiers.');assert.equal(data.lastActivity.ageMs,29999);assert.equal(data.silent,false);
  const silent=snapshot(source,37000);assert.equal(silent.silent,true);assert.match(silent.note,/toujours en cours/u);assert.equal(silent.silenceMs,30000);
  source.events.push({at:37500,who:'Oscar',kind:'activity',text:'Je contrôle les commandes.'});
  const fresh=snapshot(source,38000);assert.equal(fresh.lastActivity.text,'Je contrôle les commandes.');assert.equal(fresh.silent,false);assert.equal(fresh.lastActivity.ageMs,500);
  const quiet=snapshot(mission({events:[]}),32000);assert.equal(quiet.lastActivity,null);assert.equal(quiet.silent,true);assert.equal(quiet.silenceMs,30000);
  const assembly=snapshot(mission({performance:{calls:[call({stage:'assembly'})]}}),32000);assert.match(assembly.note,/L’assemblage/u);
});

test('finished calls cannot keep ticking, old-call returns cannot leak into a newer check, and invalid metadata is ignored',()=>{
  const source=mission({performance:{calls:[call({startedAt:1000,status:'completed',durationMs:2000}),call({startedAt:7000})]},events:[{at:2000,who:'Oscar',kind:'activity',text:'Old review'}]});
  const data=snapshot(source);assert.equal(data.elapsedMs,3000);assert.equal(data.lastActivity,null);
  const invalid=[null,call({startedAt:NaN}),call({durationMs:-1}),call({agent:42}),call({stage:'creation'}),call({status:'invented'}),call({startedAt:90000})];
  assert.equal(snapshot(mission({performance:{calls:invalid}})),null);
  const terminal=mission({status:'cancelled',performance:{calls:[call()]}});assert.equal(snapshot(terminal).call,null);assert.equal(snapshot(terminal).elapsedMs,null);assert.equal(snapshot(terminal).silent,false);
});

test('terminal states are honest and a legacy or demo review never claims a measured model call',()=>{
  const terminalCopy={completed:'Votre livraison est disponible',needs_review:'Votre livraison demande une reprise',failed:'La mission a rencontré un problème',cancelled:'La mission a été arrêtée'};
  for(const[status,title]of Object.entries(terminalCopy)){
    const data=snapshot(mission({status}));assert.equal(data.title,title);assert.equal(data.active,false);assert.equal(data.dismissible,true);assert.equal(data.action,status==='completed'?'delivery':'progress');assert.equal(data.call,null);
  }
  const legacy=snapshot(mission({status:'reviewing',performance:undefined}));assert.equal(legacy.elapsedMs,null);assert.equal(legacy.lastActivity,null);assert.match(legacy.note,/n’est enregistré/u);
  const demo=snapshot(mission({status:'reviewing',provider:'demo'}));assert.equal(demo.demo,true);assert.equal(demo.elapsedMs,null);assert.match(demo.note,/simulée, sans appel/u);
  const finished=mission({status:'completed',updatedAt:10000,performance:{calls:[call({status:'completed',durationMs:6000})]},events:[{at:6000,who:'Oscar',kind:'activity',text:'Final check'},{at:9500,who:'Oscar',kind:'activity',text:'After call'}]});
  assert.equal(snapshot(finished,20000).lastActivity,null);assert.equal(snapshot(finished,90000).lastActivity,null);assert.match(snapshot(finished).note,/Aucun appel du moteur n’est en cours/u);
});

test('visible updates preserve nodes, focus and actions while durations keep advancing',()=>{
  setLocale('fr');const{document,container}=dom(),time=clock(),opened=[];
  const widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onOpen:action=>opened.push(action)});widget.update(mission());
  assert.equal(widget.root.hidden,false);assert.equal(widget.elapsed.textContent,'8 s');assert.equal(widget.countNodes.submitted.value.textContent,'2');assert.equal(time.queue.size,1);assert.equal(widget.dismissButton.hidden,true);
  const children=[...widget.root.children],openButton=widget.openButton;openButton.focus();widget.openButton.click();assert.deepEqual(opened,['progress']);
  time.tick(1500);assert.equal(widget.elapsed.textContent,'9 s');widget.update(structuredClone(mission()));assert.equal(widget.openButton,openButton);assert.equal(document.activeElement,openButton);assert.deepEqual(widget.root.children,children);
  widget.update(mission({status:'completed'}));assert.equal(time.queue.size,1,'A normal delivery only keeps its bounded auto-collapse timer.');assert.equal(widget.openButton.textContent,'Voir la livraison');widget.openButton.click();assert.deepEqual(opened,['progress','delivery']);
  widget.dismissButton.click();assert.equal(widget.root.hidden,true);widget.update(mission({status:'completed'}));assert.equal(widget.root.hidden,true);
  widget.update(mission());assert.equal(widget.root.hidden,false,'A resumed active cycle clears a terminal dismissal.');assert.equal(time.queue.size,1);
  widget.update(mission({id:'mission-2',status:'needs_review'}));assert.equal(widget.root.hidden,false);assert.equal(time.queue.size,1);widget.destroy();assert.equal(container.children.length,0);
});

test('hidden documents and panels stop timers and resume with measured time, then destroy removes listeners',()=>{
  setLocale('fr');const{document,container}=dom(),time=clock();let visible=false;
  const widget=new DeliveryProgress({container,isVisible:()=>visible,now:time.now,timers:time.timers,intervalMs:20});widget.update(mission());assert.equal(time.queue.size,0);
  visible=true;widget.setVisible(true);assert.equal(time.queue.size,1);assert.equal([...time.queue.values()][0].delay,200);
  document.hidden=true;document.emit('visibilitychange');assert.equal(time.queue.size,0);time.tick(5000);assert.equal(widget.elapsed.textContent,'8 s');
  document.hidden=false;document.emit('visibilitychange');assert.equal(widget.elapsed.textContent,'13 s');assert.equal(time.queue.size,1);
  widget.setVisible(false);assert.equal(time.queue.size,0);widget.setVisible(true);assert.equal(time.queue.size,1);
  setLocale('nl');document.emit('oscar:language');assert.equal(widget.title.textContent,'Oscar controleert de bijdragen');
  widget.destroy();assert.equal(time.queue.size,0);assert.equal(document.handlers.get('visibilitychange').size,0);assert.equal(document.handlers.get('oscar:language').size,0);
  document.emit('visibilitychange');widget.update(mission());widget.setVisible(true);assert.equal(time.queue.size,0);setLocale('fr');
});

test('empty missions hide the notice and a new mission cannot inherit the previous dismissal',()=>{
  const{container}=dom(),time=clock(),widget=new DeliveryProgress({container,now:time.now,timers:time.timers});
  widget.update(null);assert.equal(widget.root.hidden,true);assert.equal(time.queue.size,0);
  widget.update(mission({status:'failed'}));widget.dismissButton.click();assert.equal(widget.root.hidden,true);
  widget.update(mission({id:'new-mission',status:'failed'}));assert.equal(widget.root.hidden,false);assert.equal(time.queue.size,1);
  widget.update(mission({performance:{calls:[]}}));assert.equal(widget.root.hidden,true);widget.update(null);assert.equal(time.queue.size,0);widget.destroy();
});

test('normal details collapse after ten visible seconds without restarting on state polling',()=>{
  setLocale('fr');const{container}=dom(),time=clock(),opened=[];
  const widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onOpen:action=>opened.push(action)});widget.update(mission());
  const details=widget.details,submitted=widget.countNodes.submitted.value,children=[...widget.root.children];
  assert.equal(widget.toggleButton['aria-expanded'],'true');assert.equal(widget.toggleButton['aria-controls'],details.id);
  time.tick(4000);widget.update(structuredClone(mission()));time.tick(4000);widget.update(structuredClone(mission()));
  time.tick(1999);assert.equal(details.hidden,false);time.tick(1);
  assert.equal(widget.collapsed,true);assert.equal(details.hidden,true);assert.equal(widget.root.hidden,false);assert.equal(widget.toggleButton['aria-expanded'],'false');assert.equal(time.queue.size,0,'Hidden details need no live clock.');
  assert.equal(widget.title.textContent,'Oscar vérifie les contributions');assert.equal(widget.openButton.textContent,'Suivi');widget.openButton.click();assert.deepEqual(opened,['progress']);
  widget.update(mission({performance:{calls:[call({stage:'assembly'})]},tasks:[{status:'approved'}]}));
  assert.equal(widget.collapsed,true);assert.equal(widget.title.textContent,'Oscar prépare votre livraison');assert.equal(widget.countNodes.submitted.value,submitted);assert.equal(submitted.textContent,'1');assert.deepEqual(widget.root.children,children);
  widget.toggleButton.click();assert.equal(widget.collapsed,false);assert.equal(widget.details,details);assert.equal(widget.details.hidden,false);assert.equal(widget.toggleButton['aria-expanded'],'true');
  widget.destroy();assert.equal(time.queue.size,0);
});

test('manual collapse and expansion survive repeated polling and real stage changes',()=>{
  const{document,container}=dom(),time=clock(),widget=new DeliveryProgress({container,now:time.now,timers:time.timers});widget.update(mission());
  widget.toggleButton.focus();widget.toggleButton.click();assert.equal(widget.collapsed,true);
  for(const stage of['review','assembly','final-review']){time.tick(4000);widget.update(mission({performance:{calls:[call({stage})]}}));assert.equal(widget.collapsed,true);assert.equal(document.activeElement,widget.toggleButton);}
  widget.toggleButton.click();assert.equal(widget.collapsed,false);document.activeElement=null;
  for(let index=0;index<4;index++){time.tick(30000);widget.update(structuredClone(mission()));assert.equal(widget.collapsed,false);}
  assert.equal(widget.toggleButton.type,'button');assert.equal(widget.openButton.type,'button');widget.destroy();
});

test('important problems settle into a compact actionable notice and preserve explicit user choices',()=>{
  const{container}=dom(),time=clock(),opened=[],widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onOpen:action=>opened.push(action)});widget.update(mission());
  widget.update(mission({status:'needs_review'}));assert.equal(widget.collapsed,false);assert.equal(widget.root.dataset.important,'true');assert.equal(time.queue.size,1);assert.equal(widget.note.hidden,false);
  time.tick(9999);widget.update(mission({status:'needs_review'}));assert.equal(widget.collapsed,false);time.tick(1);assert.equal(widget.collapsed,true);assert.equal(time.queue.size,0);
  widget.openButton.click();assert.deepEqual(opened,['progress']);
  widget.toggleButton.click();assert.equal(widget.collapsed,false);time.tick(60000);widget.update(mission({status:'needs_review'}));assert.equal(widget.collapsed,false,'manual expansion is preserved');
  widget.toggleButton.click();widget.update(mission({status:'failed'}));assert.equal(widget.collapsed,true,'manual collapse is preserved when the problem changes');assert.equal(widget.title.textContent,'La mission a rencontré un problème');assert.equal(time.queue.size,0);widget.destroy();
});

test('hidden time does not consume the attention budget and a completed normal notice stops after collapsing',()=>{
  const{document,container}=dom(),time=clock(),widget=new DeliveryProgress({container,now:time.now,timers:time.timers});widget.update(mission({status:'completed'}));
  time.tick(6000);document.hidden=true;document.emit('visibilitychange');assert.equal(time.queue.size,0);
  time.tick(60000);document.hidden=false;document.emit('visibilitychange');assert.equal(widget.collapsed,false);
  time.tick(3999);assert.equal(widget.collapsed,false);time.tick(1);assert.equal(widget.collapsed,true);assert.equal(time.queue.size,0);assert.equal(widget.openButton.textContent,'Voir la livraison');
  widget.update(mission({id:'another',status:'completed'}));assert.equal(widget.collapsed,false);widget.setVisible(false);assert.equal(time.queue.size,0);time.tick(60000);widget.setVisible(true);time.tick(9999);assert.equal(widget.collapsed,false);time.tick(1);assert.equal(widget.collapsed,true);widget.destroy();
});

test('automatic collapse never hides a focused control and collapsed controls follow the chosen language',()=>{
  const{document,container}=dom(),time=clock(),widget=new DeliveryProgress({container,now:time.now,timers:time.timers});widget.update(mission());
  widget.openButton.focus();time.tick(10000);assert.equal(widget.collapsed,false);assert.equal(document.activeElement,widget.openButton);
  document.activeElement=null;time.tick(500);assert.equal(widget.collapsed,true);
  setLocale('en');document.emit('oscar:language');assert.equal(widget.toggleButton.textContent,'Details');assert.equal(widget.toggleButton['aria-label'],'Show progress details');assert.equal(widget.openButton.textContent,'Progress');assert.equal(widget.toggleButton['aria-expanded'],'false');
  setLocale('nl');document.emit('oscar:language');assert.equal(widget.toggleButton['aria-label'],'Voortgangsdetails tonen');assert.equal(widget.openButton.textContent,'Voortgang');assert.equal(widget.details.hidden,true);
  widget.toggleButton.click();assert.equal(widget.toggleButton.textContent,'Inklappen');assert.equal(widget.toggleButton['aria-expanded'],'true');
  widget.destroy();assert.equal(time.queue.size,0);assert.equal(widget.toggleButton.handlers.get('click').size,0);setLocale('fr');
});

test('a terminal partial delivery names the actual unapproved contribution and hides historic activity ages',()=>{
  const tasks=Array.from({length:20},(_,index)=>({id:'t'+index,status:index===19?'needs_review':'approved',agentName:index===19?'Rémi':'Collègue',title:index===19?'Contrôle du jeu':'Contribution',review:index===19?{approved:false,feedback:'Le démarrage du jeu reste à corriger. '+ 'x'.repeat(700)}:{approved:true}}));
  const source=mission({status:'needs_review',tasks,recovery:{canResume:true,used:0},performance:{calls:[call({status:'completed',durationMs:5000})]},events:[{at:6000,who:'Oscar',kind:'activity',text:'Ancienne vérification'}]}),before=JSON.stringify(source),data=snapshot(source,900000);
  assert.deepEqual(data.counts,{submitted:20,approved:19,total:20});assert.equal(data.unapproved.length,1);assert.equal(data.unapproved[0].name,'Rémi');assert.equal(data.unapproved[0].title,'Contrôle du jeu');assert.ok(data.unapproved[0].feedback.startsWith('Le démarrage'));assert.equal(data.unapproved[0].feedback.length,360);
  assert.equal(data.lastActivity,null);assert.equal(data.elapsedMs,null);assert.equal(data.silent,false);assert.match(data.note,/Aucun appel du moteur n’est en cours/u);assert.equal(data.recoveryAction.kind,'resume');assert.equal(JSON.stringify(source),before);
  const{container}=dom(),time=clock(),widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onResume:async()=>{}});widget.update(source);
  assert.equal(widget.activity.hidden,true);assert.equal(widget.activityAge.hidden,true);assert.equal(widget.issues.hidden,false);assert.equal(widget.issueNodes[0].name.textContent,'Rémi');assert.equal(widget.issueNodes[0].feedback.textContent,data.unapproved[0].feedback);assert.equal(widget.recoveryButton.hidden,false);widget.destroy();
});

test('needs-review auto collapse retains its recovery action and never dispatches during updates or visibility changes',()=>{
  const{document,container}=dom(),time=clock();let calls=0;const widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onResume:async()=>{calls++;}}),source=mission({status:'needs_review',recovery:{canRecheck:true,used:1,rechecksUsed:0}});
  widget.update(source);const button=widget.recoveryButton,issues=widget.issues;assert.equal(button.textContent,'Faire relire les corrections');assert.equal(button.parentElement,widget.actions);assert.equal(button.type,'button');
  time.tick(6000);widget.update(structuredClone(source));time.tick(4000);assert.equal(widget.collapsed,true);assert.equal(widget.details.hidden,true);assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.equal(widget.root.hidden,false);assert.equal(time.queue.size,0);assert.equal(calls,0);
  widget.setVisible(false);widget.setVisible(true);document.emit('visibilitychange');widget.update(structuredClone(source));assert.equal(widget.recoveryButton,button);assert.equal(widget.issues,issues);assert.equal(calls,0);
  setLocale('en');document.emit('oscar:language');assert.equal(button.textContent,'Ask Oscar to review the corrections');setLocale('nl');document.emit('oscar:language');assert.equal(button.textContent,'Laat Oscar de correcties beoordelen');widget.destroy();setLocale('fr');
});

test('a recovery click is single-dispatch, stays disabled while pending, and exposes a refusal without changing mission state',async()=>{
  const{container}=dom(),time=clock();let reject,resolve,calls=0;
  const source=mission({status:'needs_review',recovery:{canResume:true,used:0}}),before=JSON.stringify(source),widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onResume:item=>{calls++;assert.equal(item.id,source.id);return new Promise((yes,no)=>{resolve=yes;reject=no;});}});
  widget.update(source);time.tick(10000);assert.equal(widget.collapsed,true);const first=widget.recover();assert.equal(calls,1);assert.equal(widget.recoveryButton.disabled,true);widget.recoveryButton.click();await widget.recover();widget.update(structuredClone(source));assert.equal(calls,1);assert.equal(widget.recoveryButton.disabled,true);
  reject(new Error('Une correction manque encore.'));await first;assert.equal(widget.recoveryButton.disabled,false);assert.equal(widget.recoveryError.hidden,false);assert.equal(widget.recoveryError.textContent,'Une correction manque encore.');assert.equal(widget.details.hidden,true);assert.equal(widget.data.state,'needs_review');assert.equal(JSON.stringify(source),before);
  const second=widget.recover();assert.equal(calls,2);assert.equal(widget.recoveryError.hidden,true);resolve({...source,status:'reviewing',recovery:{canResume:false,used:1}});await second;assert.equal(widget.recoveryButton.disabled,true,'an accepted request cannot be resent before the real state changes');widget.recoveryButton.click();assert.equal(calls,2);assert.equal(widget.data.state,'needs_review','a resolved callback is not a completed delivery');
  widget.update(mission({status:'reviewing',recovery:{canResume:false,used:1}}));assert.equal(widget.recoveryButton.hidden,true);widget.destroy();
});

test('late recovery results cannot display an old problem in another project or unlock its pending action',async()=>{
  const{container}=dom(),time=clock(),pending=new Map(),calls=[];
  const widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onResume:item=>{calls.push(item.id);return new Promise((resolve,reject)=>pending.set(item.id,{resolve,reject}));}}),first=mission({status:'needs_review',recovery:{canResume:true,used:0}}),second=mission({id:'mission-2',status:'needs_review',recovery:{canRecheck:true,used:1,rechecksUsed:0}});
  widget.update(first);const oldRequest=widget.recover();widget.update(second);const newRequest=widget.recover();assert.equal(widget.recoveryButton.disabled,true);pending.get(first.id).reject(new Error('Ancienne erreur.'));await oldRequest;
  assert.equal(widget.data.missionId,second.id);assert.equal(widget.recoveryError.hidden,true);assert.equal(widget.recoveryButton.disabled,true);assert.deepEqual(calls,[first.id,second.id]);pending.get(second.id).reject(new Error('La relecture doit attendre.'));await newRequest;assert.equal(widget.recoveryError.textContent,'La relecture doit attendre.');assert.equal(widget.recoveryButton.disabled,false);widget.destroy();
});

test('automatic problem collapse respects the focused recovery button, and unavailable actions cannot dispatch',async()=>{
  const{document,container}=dom(),time=clock();let calls=0;const widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onResume:async()=>{calls++;}});
  widget.update(mission({status:'needs_review',recovery:{canResume:true}}));widget.recoveryButton.focus();time.tick(10000);assert.equal(widget.collapsed,false);assert.equal(document.activeElement,widget.recoveryButton);document.activeElement=null;time.tick(500);assert.equal(widget.collapsed,true);assert.equal(widget.recoveryButton.hidden,false);
  widget.update(mission({status:'needs_review',recovery:{canResume:false,canRecheck:false}}));assert.equal(widget.recoveryButton.hidden,true);await widget.recover();assert.equal(calls,0);widget.destroy();
});

test('a callback with no accepted mission receipt never locks the action as a false success',async()=>{
  const{container}=dom(),time=clock();let calls=0;const widget=new DeliveryProgress({container,now:time.now,timers:time.timers,onResume:async()=>{calls++;}}),source=mission({status:'needs_review',recovery:{canResume:true,used:0}});
  widget.update(source);await widget.recover();assert.equal(calls,1);assert.equal(widget.recoveryButton.disabled,false);assert.equal(widget.data.state,'needs_review');assert.equal(widget.sentRecoveries.size,0);widget.destroy();
});
