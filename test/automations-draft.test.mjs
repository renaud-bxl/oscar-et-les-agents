import test from 'node:test';
import assert from 'node:assert/strict';
import {AutomationsDialog} from '../public/automations-dialog.js';
import {DraftStorage} from '../public/draft-storage.js';

const input=(value='')=>({value,setCustomValidity(){},options:[]});
function setup(){
 const memory=new Map();const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
 const dialog=Object.assign(Object.create(AutomationsDialog.prototype),{
  draftStore:new DraftStorage({storage,scope:'test-office'}),labelInput:input('Un nouveau rendez-vous'),prompt:input('Le texte à préparer'),topic:input('Mon sujet'),provider:{value:'claude',options:[{value:'codex'},{value:'claude'}]},
  frequency:input('weekly'),time:input('11:30'),day:input('4'),interval:input('90'),connector:{checked:true},connectorSelect:input('private-account'),editingId:null,busy:false,
  draftMessage:{textContent:''},clearDraftButton:{disabled:false},topicHint:{textContent:''},
  renderConnections(selected){this.connectorSelect.value=selected;},updateProviderNote(){},
 });return{dialog,memory};
}

test('a new routine draft keeps only unfinished writing and the chosen engine',()=>{
 const{dialog}=setup();dialog.saveDraft();assert.deepEqual(dialog.draftStore.read('routine'),{title:'Un nouveau rendez-vous',text:'Le texte à préparer',subject:'Mon sujet',provider:'claude'});
 assert.equal(dialog.clearDraftButton.disabled,false);
});

test('restoring routine writing never restores a schedule or account permission',()=>{
 const{dialog}=setup();dialog.saveDraft();dialog.draftStore.write('routine',{...dialog.draftStore.read('routine'),schedule:{frequency:'daily',time:'02:00'},connectorName:'untrusted-account',requiresConnector:true});
 dialog.labelInput.value='';dialog.prompt.value='';dialog.topic.value='';dialog.restoreDraft();
 assert.equal(dialog.labelInput.value,'Un nouveau rendez-vous');assert.equal(dialog.prompt.value,'Le texte à préparer');assert.equal(dialog.topic.value,'Mon sujet');assert.equal(dialog.provider.value,'claude');
 assert.equal(dialog.frequency.value,'');assert.equal(dialog.time.value,'');assert.equal(dialog.connector.checked,false);assert.equal(dialog.connectorSelect.value,'');assert.equal(dialog.editingId,null);assert.equal(dialog.selectedPreset,null);assert.equal(dialog.draftTopicVisible,true);
});

test('editing an existing routine leaves the separate new-routine draft intact',()=>{
 const{dialog}=setup();dialog.saveDraft();const original=dialog.draftStore.read('routine');dialog.editingId='existing-routine';dialog.labelInput.value='Une modification existante';dialog.prompt.value='Ce texte ne doit pas devenir une nouvelle routine';dialog.provider.value='codex';dialog.saveDraft();assert.deepEqual(dialog.draftStore.read('routine'),original);
});

test('empty new writing clears the draft without retaining an engine-only record',()=>{
 const{dialog}=setup();dialog.saveDraft();dialog.labelInput.value=' ';dialog.prompt.value='';dialog.topic.value='';dialog.saveDraft();assert.equal(dialog.draftStore.read('routine'),null);assert.equal(dialog.clearDraftButton.disabled,true);
});
