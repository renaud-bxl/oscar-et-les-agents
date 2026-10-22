import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AutomationsDialog} from '../public/automations-dialog.js';
import {Automations} from '../lib/automations.mjs';

function fixture(t){
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-routine-edit-')),engine=new EventEmitter();
  let starts=0,resolutions=0;
  Object.assign(engine,{dataDir,get:()=>null,state:()=>({providers:[],activeMissions:[]}),start(){starts++;throw new Error('No mission may start while editing.');}});
  const scheduler=new Automations({engine,dataDir,resolveConnectorPlan:async()=>{resolutions++;throw new Error('No account may be read while editing.');}});
  t.after(async()=>{await scheduler.close();rmSync(dataDir,{recursive:true,force:true});});
  const initial={label:'Ma routine Zoé',prompt:'Prépare mes priorités dans un fichier local.',provider:'codex',schedule:{frequency:'daily',time:'08:00'},enabled:true,requiresConnector:true,connectorName:'gmail',assistant:true,assistantMode:'mail'};
  const entry=scheduler.create(initial),dialog=Object.create(AutomationsDialog.prototype);
  Object.assign(dialog,{editingId:entry.id,data:{automations:[entry]},labelInput:{value:entry.label},prompt:{value:entry.prompt},provider:{value:'codex'},frequency:{value:'daily'},time:{value:'08:00'},connector:{checked:true},connectorSelect:{value:'gmail'},connections:[
    {client:'codex',name:'gmail',readOnlyAutomation:{service:'gmail'}},
    {client:'codex',name:'agenda',readOnlyAutomation:{service:'calendar'}},
    {client:'codex',name:'drive',readOnlyAutomation:{service:'drive'}},
    {client:'claude',name:'agenda',readOnlyAutomation:{service:'gmail'}},
  ]});
  return{dialog,scheduler,entry,assertIdle(){assert.equal(starts,0);assert.equal(resolutions,0);}};
}

test('an edited Zoé mail routine can become a free request without keeping a hidden account mode',t=>{
  const{dialog,scheduler,entry,assertIdle}=fixture(t);
  dialog.connector.checked=false;dialog.prompt.value='Recherche des idées de repas pour la semaine.';
  const payload=dialog.payload();assert.equal(payload.assistant,true);assert.equal(payload.assistantMode,'free');assert.equal(payload.connectorName,'');
  const updated=scheduler.update(entry.id,payload);assert.equal(updated.assistantMode,'free');assert.equal(updated.requiresConnector,false);assert.equal(updated.connectorName,'');assertIdle();
});

test('editing a Zoé routine follows the selected calendar, mail or other reading service in the chosen client',t=>{
  const{dialog,scheduler,entry,assertIdle}=fixture(t);
  for(const[name,mode]of[['agenda','calendar'],['drive','service'],['gmail','mail']]){
    dialog.connectorSelect.value=name;const payload=dialog.payload();assert.equal(payload.assistantMode,mode);assert.equal(scheduler.update(entry.id,payload).assistantMode,mode);
  }
  dialog.provider.value='claude';dialog.connectorSelect.value='agenda';assert.equal(dialog.payload().assistantMode,'mail','metadata from the chosen client is used, not the other client’s identically named service');assertIdle();
});

test('editing an ordinary Oscar routine does not silently turn it into a direct Zoé request',t=>{
  const{dialog,assertIdle}=fixture(t);delete dialog.data.automations[0].assistant;delete dialog.data.automations[0].assistantMode;
  const payload=dialog.payload();assert.equal(Object.hasOwn(payload,'assistant'),false);assert.equal(Object.hasOwn(payload,'assistantMode'),false);assertIdle();
});
