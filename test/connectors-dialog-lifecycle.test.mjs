import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectorsDialog} from '../public/connectors-dialog.js';

const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(t,request){
  const previous={document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},timers=new Map();let next=0,renders=0;
  globalThis.document={hidden:false,activeElement:null,removeEventListener(){}};globalThis.setTimeout=callback=>{const id=++next;timers.set(id,callback);return id;};globalThis.clearTimeout=id=>timers.delete(id);
  const dialog=Object.assign(Object.create(ConnectorsDialog.prototype),{epoch:1,busy:false,dialog:{open:true,contains:()=>false,close(){this.open=false;},remove(){}},jobs:{dataset:{},replaceChildren(){},append(){}},error:{hidden:true},data:{catalog:[],connections:[],jobs:[]},request,renderCatalog(){renders++;},renderConnections(){renders++;},showError(message){this.error={hidden:false,message};}});
  t.after(()=>{dialog.destroy();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});return{dialog,timers,get renders(){return renders;}};
}

test('reopening connectors reads current metadata immediately and never accepts an older snapshot',async t=>{
  const first=defer(),second=defer(),calls=[];const f=fixture(t,route=>{calls.push(route);return calls.length===1?first.promise:second.promise;});
  const before=f.dialog.refresh();await f.dialog.refresh();assert.equal(calls.length,1,'Repeated refresh in one open dialog remains deduplicated.');
  f.dialog.epoch++;const reopened=f.dialog.refresh();assert.equal(calls.length,2,'A reopened dialog does not wait for a discarded metadata request.');first.resolve({jobs:[],connections:[{name:'old'}]});await before;assert.equal(f.dialog.refreshing,true,'The old request cannot unlock the new read.');assert.deepEqual(f.dialog.data.connections,[]);
  second.resolve({jobs:[],connections:[{name:'current'}]});await reopened;assert.equal(f.dialog.refreshing,false);assert.equal(f.dialog.data.connections[0].name,'current');assert.deepEqual(calls,['/api/connectors','/api/connectors']);assert.equal(f.renders,2);
});

test('a visibility refresh finishing after destruction cannot restart polling or show a stale error',async t=>{
  const metadata=defer();let calls=0;const f=fixture(t,()=>{calls++;return metadata.promise;});const pending=f.dialog.refresh().finally(()=>f.dialog.poll(f.dialog.epoch));f.dialog.destroy();metadata.reject(new Error('Late metadata failure.'));await pending;
  assert.equal(f.dialog.dialog.open,false);assert.equal(f.timers.size,0);assert.equal(f.dialog.error.hidden,true);await f.dialog.refresh();f.dialog.poll(f.dialog.epoch);await f.dialog.run(()=>assert.fail('No action after destruction'));assert.equal(calls,1);assert.equal(f.renders,0);
});

test('a completed metadata refresh does not continue an operation after its dialog is destroyed',async t=>{
  const metadata=defer();let calls=0;const f=fixture(t,()=>{calls++;return Promise.resolve({jobs:[],connections:[]});});const pending=f.dialog.run(()=>metadata.promise);assert.equal(f.dialog.busy,true);f.dialog.destroy();const renders=f.renders;metadata.resolve();await pending;assert.equal(calls,0);assert.equal(f.renders,renders);assert.equal(f.timers.size,0);
});

test('an obsolete poll cannot cancel the metadata timer of a reopened connector dialog',t=>{
  const f=fixture(t,()=>assert.fail('A timer is not a metadata request'));f.dialog.epoch=2;f.dialog.poll(2);assert.equal(f.timers.size,1);const timer=[...f.timers.keys()][0];f.dialog.poll(1);assert.equal(f.timers.size,1);assert.equal([...f.timers.keys()][0],timer);
});
