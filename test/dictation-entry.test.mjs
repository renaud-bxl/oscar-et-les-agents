import test from 'node:test';
import assert from 'node:assert/strict';
import {dictationEntry} from '../public/dictation-entry.js';
import {translate} from '../public/i18n.js';

function fixture(options={}){
  const handlers={},document={createElement:()=>({dataset:{},addEventListener:(name,action)=>handlers[name]=action})};
  const target={ownerDocument:document,value:'Mon texte déjà écrit, avec [références] et mes couleurs.'};
  const button=dictationEntry(target,options);let prevented=false;
  const click=()=>handlers.click({preventDefault(){prevented=true;}});
  return{target,button,click,prevented:()=>prevented};
}

test('a dictation entry only opens the reviewed-text workflow with the exact existing field',async()=>{
  const calls=[],f=fixture({onDictate:target=>{calls.push({target,text:target.value});}});
  assert.equal(calls.length,0,'Building the UI must not open recording or a dialog.');
  assert.equal(f.button.type,'button','The dictation entry can never submit its enclosing form.');
  assert.equal(f.button.hidden,false);const original=f.target.value;
  await f.click();assert.equal(f.prevented(),true);assert.deepEqual(calls,[{target:f.target,text:original}]);assert.equal(f.target.value,original,'Opening dictation must not replace an unfinished draft.');
});

test('locked, disabled, read-only or unwired fields never start dictation',async()=>{
  for(const state of ['locked','disabled','readOnly','buttonDisabled','unwired']){
    let calls=0;const f=fixture({onDictate:state==='unwired'?undefined:()=>calls++,isLocked:()=>state==='locked'});
    if(['disabled','readOnly'].includes(state))f.target[state]=true;if(state==='buttonDisabled')f.button.disabled=true;
    await f.click();assert.equal(calls,0,state);assert.ok(f.target.value.includes('Mon texte déjà écrit'));
    if(state==='unwired')assert.equal(f.button.hidden,true);
  }
});

test('an opening error is shown without clearing the draft or sending a task',async()=>{
  const errors=[],f=fixture({onDictate:async()=>{throw new Error('Le micro est indisponible.');},onError:message=>errors.push(message)}),original=f.target.value;
  await f.click();assert.deepEqual(errors,['Le micro est indisponible.']);assert.equal(f.target.value,original);
});

test('the shared dictation entry and its fallback are translated in English and Dutch',()=>{
  for(const language of ['en','nl'])for(const source of ['🎙 Dicter ma demande','Cette demande n’a pas abouti. Votre formulaire est conservé.'])assert.notEqual(translate(source,language),source,`${language}: ${source}`);
});
