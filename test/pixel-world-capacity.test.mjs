import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelWorld } from '../public/pixel-world.js';

const roles=['recherche','redaction','code','design','analyse'];
const twenty=(status='reviewing')=>roles.flatMap(role=>Array.from({length:4},(_,index)=>({id:`${role}-${index}`,role,status,attempt:1})));
function office(tasks,{reducedMotion=false}={}){
  const world=Object.create(PixelWorld.prototype),events=[];
  Object.assign(world,{mission:null,missionId:null,agents:new Map(),time:0,frame:0,
    oscarState:'idle',oscar:{x:250,y:275,id:'oscar',key:'oscar',role:'oscar',name:'Oscar',direction:'down',path:[],place:'welcome',destination:'welcome',nextVisitAt:18,visitUntil:0,visits:0},
    _reviewOwner:null,_reactions:new Map(),_statusMemo:'',_lastCompleted:null,reducedMotion,_destroyed:false,
    onStatus:()=>{},_draw:()=>{},_schedule:()=>{},onEvent:(kind,data)=>events.push({kind,...data,time:world.time,owner:world._emittingActor?.missionId})});
  const emit=world._event;
  world._event=function(kind,actor){this._emittingActor=actor;try{return emit.call(this,kind,actor);}finally{this._emittingActor=null;}};
  const mission={id:'bureau-a',status:'running',tasks};world.update(mission);
  const advance=seconds=>{for(let step=0;step<seconds*10;step++){world.time+=.1;for(const actor of [...world.agents.values()])world._stepAgent(actor,.1);world._updateOscar(.1);}};
  return{world,mission,events,advance};
}
const current=world=>[...world.agents.values()].filter(actor=>actor.visible&&!actor.retiring&&actor.missionId===world.missionId);

test('twenty submitted colleagues can wait alive without inventing approval or blocking Oscar',()=>{
  const fixture=office(twenty()),source=JSON.stringify(fixture.mission);fixture.advance(500);
  const agents=current(fixture.world);assert.equal(agents.length,20);assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20);
  assert.ok(agents.every(actor=>actor.handoffAttempts.size===1&&actor.handoffAttempts.has(1)));
  assert.equal(fixture.world._reviewOwner,null);assert.ok(!fixture.events.some(event=>['approved','coffee'].includes(event.kind)));
  assert.ok(agents.every(actor=>!actor.mug&&!actor.paper));
  assert.ok(agents.filter(actor=>actor.direction!=='up').length>=8,'Waiting colleagues must not all remain a static row with their backs to the room.');
  const still=agents.filter(actor=>!actor.path.length);
  for(let first=0;first<still.length;first++)for(let second=first+1;second<still.length;second++)assert.ok(Math.hypot(still[first].x-still[second].x,still[first].y-still[second].y)>=35,'Stationary colleagues need distinct standing places.');
  assert.equal(JSON.stringify(fixture.mission),source);
});

test('twenty colleagues respect reduced motion and keep honest waiting places',()=>{
  const fixture=office(twenty(),{reducedMotion:true});fixture.advance(500);
  const before=current(fixture.world).map(actor=>({key:actor.key,x:actor.x,y:actor.y}));assert.equal(before.length,20);
  fixture.advance(120);
  for(const point of before){const actor=fixture.world.agents.get(point.key);assert.ok(actor?.visible);assert.ok(Math.hypot(actor.x-point.x,actor.y-point.y)<2,'Reduced motion should avoid repeated waiting excursions.');}
  assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20);assert.ok(!fixture.events.some(event=>['approved','coffee'].includes(event.kind)));
});

test('switching full offices releases places and cannot select or attribute the old office colleague',()=>{
  const fixture=office(twenty());fixture.advance(15);const old=current(fixture.world).find(actor=>actor.visible);assert.ok(old);
  const next={id:'bureau-b',status:'running',tasks:twenty('queued')};fixture.world.update(next);
  assert.notEqual(fixture.world._hit({x:old.x,y:old.y-35})?.key,old.key,'A retiring colleague must not open a same-id task in another office.');
  fixture.advance(700);
  const visible=current(fixture.world);assert.equal(visible.length,20);assert.equal(fixture.world.agents.size,20);assert.equal(new Set(visible.map(actor=>actor.slot)).size,20);
  assert.ok(visible.every(actor=>actor.missionId==='bureau-b'&&actor.state==='waiting_task'));
  assert.ok(fixture.events.filter(event=>event.owner).every(event=>event.missionId===event.owner),'Actor events must keep their actual mission identity during departure.');
  fixture.world.update(fixture.mission);fixture.advance(700);
  const reopened=current(fixture.world);assert.equal(reopened.length,20);assert.equal(fixture.world.agents.size,20);assert.equal(new Set(reopened.map(actor=>actor.slot)).size,20);
  assert.ok(reopened.every(actor=>actor.missionId==='bureau-a'&&actor.handoffAttempts.size===1));assert.equal(fixture.world._reviewOwner,null);
});

test('a quick return to the same full office preserves handed folders and current places',()=>{
  const fixture=office(twenty());fixture.advance(180);
  const originals=new Map(current(fixture.world).map(actor=>[actor.key,actor]));
  assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20);
  fixture.world.update({id:'bureau-b',status:'running',tasks:twenty('queued')});fixture.advance(.1);
  fixture.world.update(fixture.mission);fixture.advance(180);
  const agents=current(fixture.world);assert.equal(agents.length,20);assert.equal(fixture.world.agents.size,20);
  assert.ok(agents.every(actor=>originals.get(actor.key)===actor),'A colleague still leaving should be resumed rather than duplicated.');
  assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20,'Returning before departure must not replay the same folder handoff.');
  assert.equal(new Set(agents.map(actor=>actor.slot)).size,20);assert.equal(fixture.world._reviewOwner,null);
  assert.ok(!fixture.events.some(event=>['approved','coffee'].includes(event.kind)));
});

test('mixed batch states retain real work, pending review and a fresh correction attempt',()=>{
  const tasks=[{id:'lina',role:'recherche',status:'approved',attempt:1},{id:'alma',role:'design',status:'reviewing',attempt:1},{id:'maya',role:'design',status:'reviewing',attempt:1},{id:'jules',role:'analyse',status:'revising',attempt:2},
    {id:'noe',role:'redaction',status:'queued'},{id:'sam',role:'code',status:'queued'},{id:'alex',role:'code',status:'queued'},{id:'jade',role:'design',status:'queued'}];
  const fixture=office(tasks),source=JSON.stringify(fixture.mission);fixture.advance(180);
  assert.equal(JSON.stringify(fixture.mission),source);assert.equal(fixture.world.agents.get('bureau-a:jules').task.status,'revising');
  for(const id of ['alma','maya']){assert.equal(fixture.events.filter(event=>event.id===id&&event.kind==='handoff').length,1);assert.ok(!fixture.events.some(event=>event.id===id&&['approved','coffee'].includes(event.kind)));}
  for(const id of ['noe','sam','alex','jade'])assert.ok(!fixture.events.some(event=>event.id===id&&['handoff','approved','coffee'].includes(event.kind)));
  tasks[2].status='approved';fixture.world.update(fixture.mission);fixture.advance(100);
  assert.ok(fixture.events.some(event=>event.id==='maya'&&event.kind==='coffee'));assert.ok(!fixture.events.some(event=>event.id==='alma'&&event.kind==='coffee'));
  tasks[1].status='revising';tasks[1].attempt=2;fixture.world.update(fixture.mission);fixture.advance(30);
  assert.equal(fixture.world.agents.get('bureau-a:alma').state,'working');
  tasks[1].status='reviewing';fixture.world.update(fixture.mission);fixture.advance(100);
  assert.deepEqual([...fixture.world.agents.get('bureau-a:alma').handoffAttempts],[1,2]);
  assert.equal(fixture.events.filter(event=>event.id==='alma'&&event.kind==='handoff').length,2);assert.ok(!fixture.events.some(event=>event.id==='alma'&&['approved','coffee'].includes(event.kind)));
});

test('twenty approved colleagues share a short coffee or lounge break, then go home without stacking',()=>{
  const fixture=office(twenty('approved'));
  const peersAtChat=[];const originalEvent=fixture.world.onEvent;
  fixture.world.onEvent=(kind,data)=>{
    if(kind==='chat'){
      const actor=fixture.world.agents.get(`${data.missionId}:${data.id}`);
      peersAtChat.push(current(fixture.world).some(peer=>peer!==actor&&!peer.path.length&&Math.hypot(peer.x-actor.x,peer.y-actor.y)<225));
    }
    originalEvent(kind,data);
  };
  for(let step=0;step<4000;step++){
    fixture.advance(.1);
    const still=current(fixture.world).filter(actor=>!actor.path.length&&['coffee','chat','lounge','strolling','waiting_review','needs_review'].includes(actor.state));
    for(let first=0;first<still.length;first++)for(let second=first+1;second<still.length;second++)assert.ok(Math.hypot(still[first].x-still[second].x,still[first].y-still[second].y)>=35,'Coffee and lounge occupants need distinct standing places.');
    assert.ok(still.filter(actor=>actor.state==='coffee').length<=2,'The small machine does not hold the whole team.');
  }
  assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20);assert.equal(fixture.events.filter(event=>event.kind==='approved').length,20);
  const all=[...fixture.world.agents.values()];assert.equal(all.length,20);assert.equal(current(fixture.world).length,0);
  assert.equal(fixture.events.filter(event=>event.kind==='exit').length,20);
  for(const actor of all){
    assert.equal(actor.state,'home');assert.equal(actor.slot,-1);
    assert.ok(actor.visited.includes('coffee')||actor.visited.includes('lounge')||actor.visited.includes('chat'),'each approved colleague takes a short break');
    const approved=fixture.events.find(event=>event.id===actor.id&&event.kind==='approved'),exit=fixture.events.find(event=>event.id===actor.id&&event.kind==='exit');
    assert.ok(exit.time-approved.time>=20&&exit.time-approved.time<45,'even the full team has a bounded break and journey home');
  }
  assert.ok(peersAtChat.length>0,'The lounge should support real nearby exchanges.');assert.ok(peersAtChat.every(Boolean),'A chat needs a nearby colleague in the same office.');
});

test('final validation sends all twenty submitted colleagues home promptly and leaves Oscar at his desk',()=>{
  const fixture=office(twenty());fixture.advance(200);
  assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20);
  assert.equal(current(fixture.world).length,20);
  const transitions=[],originalVisit=fixture.world._visit;
  fixture.world._visit=function(actor,state){if(state==='leaving')transitions.push({id:actor.id,time:this.time});return originalVisit.call(this,actor,state);};
  for(const task of fixture.mission.tasks)task.status='approved';
  fixture.mission.status='completed';const original=JSON.stringify(fixture.mission),completedAt=fixture.world.time;fixture.world.update(fixture.mission);
  fixture.advance(1.6);
  assert.equal(transitions.length,20);
  assert.ok(transitions.every(item=>item.time-completedAt<1.6),'completion stops all remaining breaks with a small bounded stagger');
  assert.ok(new Set(transitions.map(item=>item.time)).size>1);
  fixture.advance(20);
  assert.equal(current(fixture.world).length,0);assert.equal(fixture.world.oscar.place,'desk');
  assert.equal(fixture.events.filter(event=>event.kind==='exit').length,20);assert.equal(fixture.events.filter(event=>event.kind==='coffee').length,0);
  for(let index=0;index<30;index++){fixture.world.update(structuredClone(fixture.mission));fixture.advance(1);}
  assert.equal(current(fixture.world).length,0);assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20);assert.equal(fixture.events.filter(event=>event.kind==='exit').length,20);
  assert.equal(JSON.stringify(fixture.mission),original);
});

test('a mission needing attention keeps only its unapproved colleague, without pretending the delivery is complete',()=>{
  const tasks=twenty('approved');tasks.at(-1).status='needs_review';
  const fixture=office(tasks);fixture.mission.status='needs_review';fixture.world.update(fixture.mission);
  const original=JSON.stringify(fixture.mission);fixture.advance(500);
  const visible=current(fixture.world);assert.equal(visible.length,1);assert.equal(visible[0].id,tasks.at(-1).id);
  assert.equal(visible[0].state,'needs_review');assert.equal(visible[0].mug,false);
  assert.equal(fixture.events.filter(event=>event.kind==='handoff').length,20);
  assert.equal(fixture.events.filter(event=>event.kind==='approved').length,19);
  assert.equal(fixture.events.filter(event=>event.kind==='exit').length,19);
  assert.equal(fixture.world.oscar.place,'desk');assert.equal(JSON.stringify(fixture.mission),original);
  fixture.mission.status='completed';fixture.world.update(fixture.mission);fixture.advance(100);
  assert.equal(current(fixture.world).length,1,'a phase label alone never substitutes for the colleague’s actual approval');
});
