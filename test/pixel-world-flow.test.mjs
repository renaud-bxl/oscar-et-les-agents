import test from 'node:test';
import assert from 'node:assert/strict';
import {PixelWorld} from '../public/pixel-world.js';

function scene(tasks) {
  const world=Object.create(PixelWorld.prototype),events=[],transitions=[];
  Object.assign(world,{mission:null,missionId:null,agents:new Map(),time:0,frame:0,
    oscarState:'idle',oscar:{x:250,y:275,id:'oscar',key:'oscar',role:'oscar',name:'Oscar',
      direction:'down',path:[],place:'welcome',destination:'welcome',nextVisitAt:18,visitUntil:0,visits:0},
    _reviewOwner:null,_reactions:new Map(),_statusMemo:'',_lastCompleted:null,
    reducedMotion:false,_destroyed:false,onStatus:()=>{},_draw:()=>{},_schedule:()=>{},
    onEvent:(kind,data)=>events.push({kind,...data,time:world.time,oscar:world.oscar.place})});
  const visit=world._visit;
  world._visit=function(a,state){transitions.push({id:a.id,state,time:this.time,x:a.x,y:a.y,oscar:this.oscar.place});visit.call(this,a,state);};
  const mission={id:'isolated-flow',status:'running',tasks};world.update(mission);
  function advance(seconds){for(let i=0;i<seconds*10;i++){world.time+=.1;for(const a of [...world.agents.values()])world._stepAgent(a,.1);world._updateOscar(.1);}}
  return {world,mission,events,transitions,advance};
}

test('Oscar reaches his desk and visits working agents using the real routes',()=>{
  const s=scene([{id:'designer',role:'design',status:'working'}]);
  assert.equal(s.world.oscar.destination,'desk');
  s.advance(12);assert.equal(s.world.oscar.place,'desk');
  assert.equal(s.events.filter(e=>e.kind==='oscar_arrived').length,1);
  s.advance(30);assert.ok(s.world.oscar.visits>=1);
  assert.equal(s.world.agents.get('isolated-flow:designer').state,'working');
});

test('approved and failed workers hand their folders to Oscar before coffee or departure',()=>{
  const tasks=[{id:'approved',role:'design',status:'working'},{id:'failed',role:'code',status:'working'}];
  const s=scene(tasks);s.advance(28);
  tasks[0].status='approved';tasks[1].status='failed';s.world.update(s.mission);s.advance(65);
  for(const task of tasks){
    const handoff=s.transitions.find(e=>e.id===task.id&&e.state==='handoff');
    assert.ok(handoff,`${task.id} must deliver a folder`);
    assert.ok(Math.hypot(handoff.x-730,handoff.y-330)<5,'folder is delivered at Oscar’s desk');
    const departure=s.transitions.find(e=>e.id===task.id&&['to_coffee','leaving'].includes(e.state));
    assert.ok(departure);assert.ok(departure.time>handoff.time);
    assert.equal(departure.oscar,'desk','Oscar is present before a worker leaves the review');
  }
  assert.ok(s.events.some(e=>e.kind==='coffee'&&e.id==='approved'));
  assert.ok(s.events.some(e=>e.kind==='exit'&&e.id==='failed'));
  assert.equal(s.events.some(e=>e.kind==='coffee'&&e.id==='failed'),false);
});

test('a second correction delivers a fresh folder before another coffee break',()=>{
  const task={id:'writer',role:'redaction',status:'approved',attempt:1};
  const s=scene([task]);s.advance(35);
  assert.ok(s.events.some(e=>e.kind==='coffee'));
  task.status='revising';task.attempt=2;s.world.update(s.mission);s.advance(20);
  task.status='approved';s.world.update(s.mission);s.advance(35);
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,2);
  const a=s.world.agents.get('isolated-flow:writer');
  assert.deepEqual([...a.handoffAttempts],[1,2]);
});

test('reopening a result that needs review hands over its folder and stops visual work',()=>{
  const task={id:'researcher',role:'recherche',status:'needs_review',attempt:2};
  const s=scene([task]);s.mission.status='needs_review';s.world.update(s.mission);
  const original=JSON.stringify(s.mission);s.advance(120);
  const a=s.world.agents.get('isolated-flow:researcher');
  assert.equal(a.state,'needs_review');assert.equal(a.paper,false);assert.equal(a.mug,false);
  assert.deepEqual([...a.handoffAttempts],[2]);
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,1);
  assert.equal(s.events.some(e=>['approved','coffee'].includes(e.kind)),false);
  assert.equal(JSON.stringify(s.mission),original,'the scene never approves or resumes the real task');
});

test('a final rejection after handoff waits for attention instead of returning to work',()=>{
  const task={id:'researcher',role:'recherche',status:'working',attempt:2};
  const s=scene([task]);s.advance(25);
  task.status='reviewing';s.world.update(s.mission);s.advance(25);
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,1);
  task.status='needs_review';s.mission.status='needs_review';s.world.update(s.mission);s.advance(120);
  assert.equal(s.world.agents.get('isolated-flow:researcher').state,'needs_review');
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,1);
  assert.equal(s.events.some(e=>['approved','coffee'].includes(e.kind)),false);
});

test('four reopened results needing review release their desks when another mission is selected',()=>{
  for(const beforeSwitch of [12,120]) {
    const tasks=Array.from({length:4},(_,i)=>({id:'old'+i,role:'recherche',status:'needs_review',attempt:2}));
    const s=scene(tasks);s.mission.status='needs_review';s.world.update(s.mission);s.advance(beforeSwitch);
    const next={id:'next-mission',status:'running',tasks:Array.from({length:4},(_,i)=>({id:'new'+i,role:'recherche',status:'working',attempt:1}))};
    s.world.update(next);s.advance(120);
    assert.equal([...s.world.agents.values()].some(a=>a.missionId===s.mission.id),false);
    const current=[...s.world.agents.values()];assert.equal(current.length,4);
    assert.ok(current.every(a=>a.visible&&a.state==='working'&&a.missionId===next.id));
    assert.equal(s.events.filter(e=>e.kind==='handoff').length,4,'each rejected result is handed over before leaving');
    assert.equal(s.events.filter(e=>e.kind==='exit').length,4);
    assert.equal(s.events.some(e=>['approved','coffee'].includes(e.kind)),false);
  }
});

test('reopened failed results hand over before departure and cancelled tasks never recruit',()=>{
  const s=scene([{id:'failed',role:'code',status:'failed',attempt:2},{id:'cancelled',role:'design',status:'cancelled',attempt:1}]);
  s.mission.status='failed';s.world.update(s.mission);const original=JSON.stringify(s.mission);s.advance(120);
  assert.equal(s.world.agents.size,0);
  assert.deepEqual(s.events.filter(e=>e.id==='failed').map(e=>e.kind),['hire','handoff','exit']);
  assert.equal(s.events.some(e=>e.id==='cancelled'),false);
  assert.equal(JSON.stringify(s.mission),original);
});
