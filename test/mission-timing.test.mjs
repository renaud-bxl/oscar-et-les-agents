import test from 'node:test';
import assert from 'node:assert/strict';
import {MissionTiming,missionTimingSnapshot,formatTimingDuration,performanceText} from '../public/mission-timing.js';
import messages,{patterns} from '../public/translations-performance.js';

const call=(values={})=>({agent:'Alma',stage:'creation',startedAt:2000,durationMs:null,status:'running',...values});
const mission=(values={})=>({id:'mission-1',provider:'codex',executionMode:'single-design',status:'running',createdAt:1000,updatedAt:5000,performance:{calls:[call()]},...values});

function dom(){
  const document={hidden:false,handlers:new Map()};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.dataset={};this.textContent='';this.hidden=false;this.isConnected=true;this.replacements=0;}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){this.replacements++;this.children=[];this.append(...children);}
    setAttribute(key,value){this[key]=value;}
    closest(){return null;}
    getClientRects(){return[{}];}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.isConnected=false;}
  }
  document.createElement=tag=>new Element(tag);
  document.addEventListener=(name,action)=>{if(!document.handlers.has(name))document.handlers.set(name,new Set());document.handlers.get(name).add(action);};
  document.removeEventListener=(name,action)=>document.handlers.get(name)?.delete(action);
  document.emit=name=>{for(const handler of document.handlers.get(name)||[])handler();};
  return{document,container:document.createElement('div')};
}
function clock(){
  let current=10000,next=0;const queue=new Map();
  return{now:()=>current,timers:{setTimeout(action,delay){const id=++next;queue.set(id,{action,delay});return id;},clearTimeout(id){queue.delete(id);}},queue,tick(ms=500){current+=ms;const pending=[...queue];queue.clear();for(const[,entry]of pending)entry.action();}};
}

test('real calls provide elapsed time and phase while scene activity cannot fabricate progress',()=>{
  const first=missionTimingSnapshot(mission(),{now:12000});
  assert.equal(first.elapsedMs,11000);assert.equal(first.callCount,1);assert.equal(first.phase,'Alma crée le visuel');assert.equal(first.calls[0].elapsedMs,10000);
  const animated=missionTimingSnapshot(mission({tasks:Array.from({length:20},(_,i)=>({id:i,status:'working'})),events:[{kind:'hired'},{kind:'approved'}],performance:{calls:[]}}),{now:12000});
  assert.equal(animated.callCount,0);assert.equal(animated.calls.length,0);assert.equal(animated.phase,'Aucun appel du moteur n’est en cours.');
  const two=missionTimingSnapshot(mission({status:'reviewing',performance:{calls:[call({durationMs:4000,status:'completed'}),call({agent:'Oscar',stage:'review',startedAt:7000})]}}),{now:12000});
  assert.equal(two.callCount,2);assert.equal(two.phase,'Oscar vérifie les fichiers');assert.equal(two.calls[0].elapsedMs,4000);assert.equal(two.calls[1].elapsedMs,5000);
});

test('terminal timing is frozen and legacy missions do not pretend to have measured calls',()=>{
  const done=mission({status:'completed',updatedAt:17000,performance:{totalDurationMs:15800,calls:[call({status:'completed',durationMs:13500})]}});
  for(const now of[20000,90000]){const data=missionTimingSnapshot(done,{now});assert.equal(data.elapsedMs,15800);assert.equal(data.calls[0].elapsedMs,13500);assert.equal(data.active,false);}
  const legacy=missionTimingSnapshot(mission({status:'failed',performance:undefined}),{now:90000});
  assert.equal(legacy.elapsedMs,4000);assert.equal(legacy.callCount,null);assert.match(legacy.note,/n’a pas été enregistré/u);
  const invalid=missionTimingSnapshot({status:'completed',createdAt:'yesterday',updatedAt:NaN});assert.equal(invalid.elapsedMs,null);assert.equal(formatTimingDuration(invalid.elapsedMs),'—');
  const demo=missionTimingSnapshot(mission({provider:'demo'}),{now:90000});assert.equal(demo.callCount,0);assert.equal(demo.calls.length,0);assert.match(demo.note,/Démonstration/u);
});

test('invalid measurements are excluded and interrupted calls never keep claiming live activity',()=>{
  const calls=[call(),null,call({startedAt:NaN}),call({durationMs:-2}),call({status:'untrusted'}),call({agent:42}),call({stage:undefined})];
  const data=missionTimingSnapshot(mission({status:'cancelled',performance:{calls}}),{now:90000});
  assert.equal(data.callCount,1);assert.equal(data.calls[0].running,false);assert.equal(data.calls[0].elapsedMs,null);assert.equal(data.calls[0].statusLabel,'mesure incomplète');assert.equal(data.phase,'Aucun appel du moteur n’est en cours.');
  assert.equal(formatTimingDuration(345000),'5 min 45 s');assert.equal(formatTimingDuration(3723000),'1 h 2 min 3 s');assert.equal(formatTimingDuration(Infinity),'—');
});

test('all stages have literal localized labels and translations retain file paths',()=>{
  const calls=[call({agent:'Oscar',stage:'planning'}),call(),call({agent:'Oscar',stage:'review'}),call({agent:'Oscar',stage:'assembly'}),call({agent:'Oscar',stage:'final-review'}),call({agent:'Zoé',stage:'answer'})];
  const english=missionTimingSnapshot(mission({performance:{calls}}),{locale:'en',now:9000}),dutch=missionTimingSnapshot(mission({performance:{calls}}),{locale:'nl',now:9000});
  assert.match(english.phase,/Alma creates the visual/u);assert.match(dutch.phase,/Oscar controleert de bestanden/u);assert.match(english.phase,/Zoé prepares your answer/u);
  for(const[source,translations]of Object.entries(messages))for(const locale of['en','nl']){assert.equal(typeof translations[locale],'string',`${source}: ${locale}`);assert.equal(performanceText(source,locale),translations[locale]);}
  const rule=patterns[0],source='Fichiers image absents, invalides ou formats demandés manquants : Livraison/image.png.';
  for(const locale of['en','nl'])assert.ok(source.replace(new RegExp(rule.source,'u'),rule[locale]).includes('Livraison/image.png'));
  assert.ok(performanceText('Le visuel est prêt. J’ai vérifié le résultat et conservé les fichiers dans Livraison/.','en').includes('Livraison/'));
});

test('a visible active widget ticks without rebuilding an unchanged call history',()=>{
  const{document,container}=dom(),time=clock(),widget=new MissionTiming({container,now:time.now,timers:time.timers});
  widget.update(mission());assert.equal(widget.root.hidden,false);assert.equal(widget.count.textContent,'1 appel');assert.equal(widget.elapsed.textContent,'9 s');assert.equal(time.queue.size,1);
  const row=widget.list.children[0],replacements=widget.list.replacements;widget.history.open=true;
  time.tick(1500);assert.equal(widget.elapsed.textContent,'10 s');assert.equal(widget.rows[0].textContent,'9 s');assert.equal(widget.list.children[0],row);
  widget.update(structuredClone(mission()));assert.equal(widget.list.children[0],row);assert.equal(widget.list.replacements,replacements);assert.equal(widget.history.open,true);
  widget.update(mission({status:'completed',performance:{calls:[call()]}}));assert.equal(time.queue.size,0);assert.match(widget.list.children[0].children[0].textContent,/mesure incomplète/u);assert.equal(widget.rows[0].textContent,'—');
  widget.destroy();assert.equal(container.children.length,0);assert.equal(document.handlers.get('visibilitychange').size,0);assert.equal(document.handlers.get('oscar:language').size,0);
});

test('hidden tabs and closed panels stop ticking, resume safely, and destroy removes pending work',()=>{
  const{document,container}=dom(),time=clock();let panelOpen=false;
  const widget=new MissionTiming({container,now:time.now,timers:time.timers,isVisible:()=>panelOpen,intervalMs:40});
  widget.update(mission());assert.equal(time.queue.size,0);panelOpen=true;widget.setVisible(true);assert.equal(time.queue.size,1);assert.equal([...time.queue.values()][0].delay,200);
  document.hidden=true;document.emit('visibilitychange');assert.equal(time.queue.size,0);time.tick(5000);assert.equal(widget.elapsed.textContent,'9 s');
  document.hidden=false;document.emit('visibilitychange');assert.equal(widget.elapsed.textContent,'14 s');assert.equal(time.queue.size,1);
  widget.setVisible(false);assert.equal(time.queue.size,0);widget.setVisible(true);assert.equal(time.queue.size,1);widget.destroy();assert.equal(time.queue.size,0);
  document.emit('visibilitychange');widget.update(mission());widget.setVisible(true);assert.equal(time.queue.size,0);
});

test('empty missions and terminal missions never schedule a timer',()=>{
  const{container}=dom(),time=clock(),widget=new MissionTiming({container,now:time.now,timers:time.timers,intervalMs:NaN});
  widget.update(null);assert.equal(widget.root.hidden,true);assert.equal(time.queue.size,0);
  widget.update(mission({status:'completed'}));assert.equal(widget.root.hidden,false);assert.equal(time.queue.size,0);
  widget.update(mission());assert.equal([...time.queue.values()][0].delay,500);widget.update(null);assert.equal(time.queue.size,0);assert.equal(widget.root.hidden,true);widget.destroy();
});
