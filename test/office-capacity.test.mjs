import test from 'node:test';
import assert from 'node:assert/strict';
import {PixelWorld} from '../public/pixel-world.js';

const roles=['recherche','redaction','code','design','analyse'];
function fullOffice(status='working'){
  const world=Object.create(PixelWorld.prototype);
  Object.assign(world,{mission:null,missionId:null,agents:new Map(),time:0,frame:0,
    oscarState:'idle',oscar:{x:155,y:285,id:'oscar',key:'oscar',role:'oscar',name:'Oscar',direction:'down',path:[],place:'welcome',destination:'welcome',nextVisitAt:18,visitUntil:0,visits:0},
    _reviewOwner:null,_reactions:new Map(),_statusMemo:'',_lastCompleted:null,reducedMotion:false,_destroyed:false,
    onStatus:()=>{},_draw:()=>{},_schedule:()=>{},onEvent:()=>{}});
  const mission={id:'full-office',status:'running',tasks:roles.flatMap(role=>Array.from({length:4},(_,index)=>({id:`${role}-${index}`,role,status,attempt:1})))};
  world.update(mission);
  const advance=seconds=>{for(let step=0;step<seconds*10;step++){world.time+=.1;for(const actor of [...world.agents.values()])world._stepAgent(actor,.1);world._updateOscar(.1);}};
  return {world,mission,advance};
}

test('all twenty working colleagues reach distinct accessible workstations, four per department',()=>{
  const {world,mission,advance}=fullOffice(),original=JSON.stringify(mission);
  advance(120);
  const agents=[...world.agents.values()];
  assert.equal(agents.length,20);
  assert.equal(new Set(agents.map(actor=>actor.slot)).size,20);
  for(const role of roles)assert.equal(agents.filter(actor=>actor.role===role).length,4);
  for(const actor of agents){
    assert.equal(actor.visible,true);
    assert.equal(actor.state,'working');
    assert.equal(actor.path.length,0);
    assert.equal(world._walkable(Math.floor(actor.x/20),Math.floor(actor.y/20),{actor}),true,'the colleague can reach their own workstation');
    assert.ok(actor.x>0&&actor.x<1440&&actor.y>80&&actor.y+31<850,'the character and their name remain inside the scene');
  }
  assert.equal(JSON.stringify(mission),original,'the office never starts or completes actual tasks');
});

test('the lounge sign stays clear of the names of all twenty waiting colleagues',()=>{
  const {world,advance}=fullOffice('reviewing');advance(500);
  const signs=[];
  Object.assign(world,{_round:()=>{},_ellipse:()=>{},_line:()=>{},_shadow:(_context,draw)=>draw(),
    _utilitySign:(_context,text,x,y,width)=>signs.push({text,x:x-width/2,y,w:width,h:26})});
  world._lounge({});
  const sign=signs.find(item=>item.text.startsWith('Lounge'));
  assert.ok(sign);
  assert.ok(sign.x>=0&&sign.x+sign.w<=1440&&sign.y+sign.h<=850);
  const agents=[...world.agents.values()];assert.equal(agents.length,20);
  for(const actor of agents){
    assert.equal(actor.visible,true);assert.equal(actor.path.length,0);
    assert.equal(world._walkable(Math.floor(actor.x/20),Math.floor(actor.y/20),{actor}),true);
    // Deliberately wider than a normal 15-character nameplate, to also cover
    // custom names without depending on the host's installed fonts.
    const name={x:actor.x-110,y:actor.y+9,w:220,h:22};
    assert.equal(name.x<sign.x+sign.w&&name.x+name.w>sign.x&&name.y<sign.y+sign.h&&name.y+name.h>sign.y,false,'a colleague must not cover the lounge sign');
  }
});
