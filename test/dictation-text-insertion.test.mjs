import test from 'node:test';
import assert from 'node:assert/strict';
import {DictationDialog} from '../public/dictation-dialog.js';

function fixture(){
  const dialog=Object.create(DictationDialog.prototype),errors=[];
  let resolve,reject,closed=0;
  const inserted=new Promise((yes,no)=>{resolve=yes;reject=no;});
  Object.assign(dialog,{epoch:1,use:{disabled:false},using:false,transcript:{value:'Mon idée à insérer'},dialog:{open:true},targetOnText:text=>{assert.equal(text,'Mon idée à insérer');return inserted;},updateControls(){},close(){closed++;},showError:message=>errors.push(message)});
  return{dialog,resolve,reject,errors,closed:()=>closed};
}

test('a late successful insertion cannot close another dictation session or release its pending insertion',async()=>{
  const{dialog,resolve,closed}=fixture(),pending=dialog.useText();assert.equal(dialog.using,true);
  dialog.epoch++;dialog.transcript.value='La nouvelle demande';dialog.using=true;
  resolve();await pending;assert.equal(closed(),0);assert.equal(dialog.using,true);assert.equal(dialog.transcript.value,'La nouvelle demande');
});

test('a rejected old insertion does not display an error in a replacement session',async()=>{
  const{dialog,reject,errors,closed}=fixture(),pending=dialog.useText();dialog.epoch++;dialog.using=false;
  reject(new Error('A former target is no longer connected.'));await pending;assert.deepEqual(errors,[]);assert.equal(closed(),0);assert.equal(dialog.using,false);
});

test('a current insertion still closes on success or preserves reviewable text on failure',async()=>{
  const first=fixture(),accepted=first.dialog.useText();first.resolve();await accepted;assert.equal(first.closed(),1);assert.equal(first.dialog.using,false);
  const second=fixture(),failed=second.dialog.useText();second.reject(new Error('Insertion refused.'));await failed;assert.equal(second.closed(),0);assert.equal(second.dialog.using,false);assert.equal(second.errors.length,1);assert.equal(second.dialog.transcript.value,'Mon idée à insérer');
});
