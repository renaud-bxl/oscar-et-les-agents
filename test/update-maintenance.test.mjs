import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {UpdateMaintenance,updateBlockers} from '../lib/update-maintenance.mjs';

test('update reservation waits for the handler and the response independently',()=>{
  for(const event of['finish','close']){
    const maintenance=new UpdateMaintenance(),response=new EventEmitter();
    const done=maintenance.track(response);
    assert.deepEqual(updateBlockers(maintenance),['requests']);
    assert.throws(()=>maintenance.reserve(updateBlockers(maintenance)),error=>error.code==='UPDATE_BUSY');
    response.emit(event);
    assert.equal(maintenance.responses.size,0);assert.equal(maintenance.requests.size,1);
    assert.throws(()=>maintenance.reserve(updateBlockers(maintenance)),error=>error.code==='UPDATE_BUSY','A closed response cannot hide ongoing filesystem work.');
    done();done();assert.deepEqual(updateBlockers(maintenance),[]);
    assert.equal(response.listenerCount('finish'),0);assert.equal(response.listenerCount('close'),0);
    maintenance.reserve([]);assert.equal(maintenance.active,true);
    assert.throws(()=>maintenance.reserve([]),error=>error.code==='UPDATE_BUSY');
    maintenance.release();assert.equal(maintenance.active,false);
  }
});

test('a completed handler leaves streaming downloads busy until their response ends',()=>{
  const maintenance=new UpdateMaintenance(),first=new EventEmitter(),second=new EventEmitter();
  const firstDone=maintenance.track(first),secondDone=maintenance.track(second);
  firstDone();secondDone();assert.equal(maintenance.requests.size,0);assert.equal(maintenance.responses.size,2);
  first.emit('finish');assert.deepEqual(updateBlockers(maintenance),['requests']);
  assert.throws(()=>maintenance.reserve(updateBlockers(maintenance)),error=>error.code==='UPDATE_BUSY');
  second.emit('close');assert.deepEqual(updateBlockers(maintenance),[]);maintenance.reserve([]);
  assert.equal(maintenance.active,true);
});

test('every detached model account installation and archive operation blocks restart',()=>{
  const one=()=>new Set([{}]),map=()=>new Map([['operation',{}]]);
  const operations=[
    [{engine:{runs:map()}},'missions'],[{engine:{state:()=>({activeMissions:[{status:'running'}]})}},'missions'],
    [{calendar:{activeJobs:[{status:'creating'}]}},'calendar'],
    ...['jobs'].map(field=>[{login:{[field]:map()}},'connections']),
    ...['active','inspections','processes'].map(field=>[{connectors:{[field]:map()}},'connections']),
    ...['jobs','pending'].map(field=>[{publishing:{[field]:map()}},'publishing']),[{publishing:{loginJob:Promise.resolve()}},'publishing'],
    ...['launching','pending'].map(field=>[{automations:{[field]:one()}},'automations']),
    [{documents:{runtime:{status:'installing'}}},'documents'],
    ...['readerControllers','exportTasks'].map(field=>[{documents:{[field]:one()}},'documents']),
    ...['studio','piper'].flatMap(engine=>['operation','active','speaking'].map(field=>[{voice:{[engine]:{[field]:{}}}},'voice']).concat([[{voice:{[engine]:{queue:[{}]}}},'voice']])),
    ...['operation','active'].map(field=>[{dictation:{[field]:{}}},'dictation']),
    ...['preparations','secretaryPending','archiveTasks','requests','responses'].map(field=>[{[field]:one()},'requests']),
    [{activeArchive:{}},'requests'],
  ];
  for(const[input,reason]of operations){
    assert.deepEqual(updateBlockers(input),[reason],JSON.stringify(input));
    const maintenance=new UpdateMaintenance();assert.throws(()=>maintenance.reserve(updateBlockers(input)),error=>error.code==='UPDATE_BUSY');assert.equal(maintenance.active,false);
  }
});

test('an idle snapshot does not confuse old resolved queues with active work',()=>{
  assert.deepEqual(updateBlockers({engine:{runs:new Map(),state:()=>({activeMissions:[]})},calendar:{activeJobs:[]},login:{jobs:new Map(),installQueue:Promise.resolve()},connectors:{active:new Map(),inspections:new Map(),processes:new Set()},publishing:{jobs:new Map(),pending:new Set(),loginJob:null},automations:{launching:new Set(),pending:new Set()},documents:{runtime:{status:'ready'},readerControllers:new Set(),exportTasks:new Set(),mutations:Promise.resolve(),readerQueue:Promise.resolve()},voice:{studio:{queue:[],operation:null,active:null},piper:{queue:[],speaking:false}},dictation:{active:null,operation:null},archiveTasks:new Set(),requests:new Set(),responses:new Set()}),[]);
});
