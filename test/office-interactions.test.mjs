import test from 'node:test';
import assert from 'node:assert/strict';
import {catPose,CAT_TOUR_SECONDS,windowCelestials,PixelWorld} from '../public/pixel-world.js';
import {getAmbience} from '../public/ambience.js';

test('a cat tour jumps down, walks in the aisle and returns to its exact perch',()=>{
  assert.deepEqual(catPose(-1),catPose(CAT_TOUR_SECONDS));
  const poses=Array.from({length:168},(_,i)=>catPose(i/10));
  assert.ok(poses.some(p=>p.jumping&&p.x>1324));
  assert.ok(poses.some(p=>p.walking&&p.x<1230&&p.y>730));
  assert.ok(poses.some(p=>p.sniffing));
  assert.ok(poses.every(p=>Number.isFinite(p.x)&&p.x>1190&&p.x<1420&&p.y>=500&&p.y<820));
  assert.ok(poses.filter(p=>p.walking).every(p=>p.y>710||p.x>=1390),'walking stays clear of the desks and cupboard');
  for(const elapsed of [0,.5,7,16])assert.deepEqual(catPose(elapsed,{reducedMotion:true}),catPose(-1));
});
test('repeated clicks keep the cat on its tour and the moving cat stays clickable',()=>{
  const world=Object.create(PixelWorld.prototype);Object.assign(world,{time:5,props:{catStart:0,catUntil:CAT_TOUR_SECONDS},_draw:()=>{},_sayStatus:()=>{},onInteract:()=>{},onEvent:()=>{},reducedMotion:false});
  const pose=catPose(5);assert.equal(world._hitProp({x:pose.x,y:pose.y-20}).kind,'cat');
  world.interact('cat');assert.equal(world.props.catStart,0);assert.equal(world.props.catUntil,CAT_TOUR_SECONDS);
  assert.equal(world._hitProp({x:1324,y:580}),null,'the empty perch is no longer a cat target');
});
test('the two windows never duplicate the Sun or Moon through a complete day',()=>{
  for(let minute=0;minute<1440;minute+=5){const scene=getAmbience(new Date(2026,9,19,0,minute));const windows=[windowCelestials(scene,0),windowCelestials(scene,1)];assert.equal(windows.filter(w=>w.sun).length,Number(scene.sun.visible));assert.equal(windows.filter(w=>w.moon).length,Number(scene.moon.visible));}
});

test('floating department nameplates open their actual department sheet',()=>{
  const world=Object.create(PixelWorld.prototype);
  Object.assign(world,{agents:new Map(),oscar:{x:155,y:285},_spaceLabels:[
    {role:'recherche',x:218,y:213,w:124,h:32},
    {role:'code',x:614,y:293,w:212,h:32},
    {role:'design',x:333,y:639,w:94,h:32}
  ]});
  assert.deepEqual(world._hit({x:280,y:227}),{role:'recherche',id:null,type:'desk'},'the research sign is above the old desk hit area');
  assert.deepEqual(world._hit({x:720,y:305}),{role:'code',id:null,type:'desk'});
  assert.deepEqual(world._hit({x:380,y:654}),{role:'design',id:null,type:'desk'});
  world.agents.set('person',{visible:true,x:280,y:260,role:'recherche',id:'person'});
  assert.equal(world._hit({x:280,y:227}).id,'person','a person passing in front of a sign keeps their own click target');
  assert.equal(world._hit({x:900,y:30}),null);
});
