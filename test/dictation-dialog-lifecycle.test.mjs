import test from 'node:test';
import assert from 'node:assert/strict';
import {DictationDialog} from '../public/dictation-dialog.js';

function fixture(){
 const streams=[],recorders=[];
 class Recorder extends EventTarget{
  static isTypeSupported(){return true;}
  constructor(stream){super();this.stream=stream;this.state='inactive';recorders.push(this);}
  start(){this.state='recording';}
  stop(){this.state='inactive';}
 }
 const dialog=Object.create(DictationDialog.prototype);
 Object.assign(dialog,{epoch:1,dialog:{open:true},data:{available:true,maxSeconds:90,maxAudioBytes:8388608},host:{MediaRecorder:Recorder,navigator:{mediaDevices:{getUserMedia:async()=>{const track={stopped:false,stop(){this.stopped=true;}};const stream={getTracks:()=>[track],track};streams.push(stream);return stream;}}}},releaseAudio(){},onRecord(){},showError(){},setStatus(){},updateControls(){},status:{textContent:''}});
 return{dialog,streams,recorders};
}

test('a former recorder cannot cancel the next recording timer after a rapid reopen',async t=>{
 const {dialog,recorders,streams}=fixture();t.after(()=>dialog.stopRecording());
 await dialog.startRecording();dialog.stopRecording();dialog.epoch++;await dialog.startRecording();
 const current=dialog.recorder,timer=dialog.recordTimer,clear=globalThis.clearInterval,cleared=[];
 t.mock.method(globalThis,'clearInterval',value=>{cleared.push(value);clear(value);});
 recorders[0].dispatchEvent(new Event('stop'));
 assert.equal(cleared.includes(timer),false);assert.equal(dialog.recorder,current);assert.equal(current.state,'recording');assert.equal(streams[1].track.stopped,false);
});
test('late data, errors and stop from an inactive recorder cannot alter a replacement in the same dialog',async t=>{
 const {dialog,recorders}=fixture();t.after(()=>dialog.stopRecording());
 await dialog.startRecording();dialog.stopRecording();await dialog.startRecording();
 const current=dialog.recorder,event=new Event('dataavailable');event.data=new Blob(['old recording']);
 recorders[0].dispatchEvent(event);recorders[0].dispatchEvent(new Event('error'));recorders[0].dispatchEvent(new Event('stop'));
 assert.equal(dialog.recorder,current);assert.equal(current.state,'recording');assert.equal(dialog.discarded,false);assert.deepEqual(dialog.chunks,[]);assert.equal(dialog.recordedBytes,0);
});
