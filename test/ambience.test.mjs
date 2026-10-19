import test from 'node:test';
import assert from 'node:assert/strict';
import {getAmbience} from '../public/ambience.js';

const at=(hour,minute=0,second=0)=>new Date(2026,0,15,hour,minute,second);

test('local-clock schedule covers night, dawn, day and sunset with automatic night lights',()=>{
  for(const [hour,phase,daylight] of [[0,'night',0],[6,'dawn',0],[7,'dawn',.5],[8,'day',1],[12,'day',1],[18,'sunset',1],[19,'sunset',.5],[20,'night',0],[23,'night',0]]) {
    const result=getAmbience(at(hour));assert.equal(result.hour,hour);assert.equal(result.phase,phase);assert.equal(result.daylight,daylight);
    assert.equal(result.source,'local-clock');assert.equal(result.lampsOn,daylight<.6);
  }
});
test('light varies continuously around each schedule boundary',()=>{
  for(const hour of [6,8,18,20]) {
    const center=at(hour),before=new Date(center.getTime()-1000),after=new Date(center.getTime()+1000);
    assert.ok(Math.abs(getAmbience(before).daylight-getAmbience(after).daylight)<.00001);
  }
});
test('the decorative sun moves left to right and climbs before descending',()=>{
  const dawn=getAmbience(at(6)),morning=getAmbience(at(9)),midday=getAmbience(at(13)),evening=getAmbience(at(18)),night=getAmbience(at(22));
  assert.ok(dawn.sun.x<morning.sun.x&&morning.sun.x<midday.sun.x&&midday.sun.x<evening.sun.x);
  assert.ok(midday.sun.y<morning.sun.y&&midday.sun.y<evening.sun.y);
  assert.equal(dawn.sun.visible,true);assert.equal(night.sun.visible,false);assert.equal(night.moon.visible,true);assert.equal(night.stars,1);
});
test('all generated lighting and positions stay finite and bounded throughout a day',()=>{
  for(let minute=0;minute<24*60;minute++) {
    const result=getAmbience(at(0,minute));
    for(const value of [result.daylight,result.warmth,result.sun.x,result.sun.y,result.sun.opacity,result.moon.x,result.moon.y,result.moon.opacity,result.stars,result.lampStrength])assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
  }
});
test('invalid dates are rejected instead of silently using a different clock',()=>{
  assert.throws(()=>getAmbience(new Date('invalid')),TypeError);assert.throws(()=>getAmbience(null),TypeError);
});
