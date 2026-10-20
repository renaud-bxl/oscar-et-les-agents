import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceDialog} from '../public/voice-dialog.js';

test('saving an auditioned voice retires its preview before the synchronous audio-stop notification',()=>{
  for(const role of ['oscar','zoe']){
    const dialog=Object.create(VoiceDialog.prototype),updates=[];
    Object.assign(dialog,{pending:{},preview:{role,at:Date.now()-5000},errorText:'Ancienne erreur',signature:'old',refresh(){updates.push({preview:this.preview,error:this.errorText,pending:{...this.pending}});},getSpeech:()=>({setCharacterVoice(character,id){assert.equal(character,role);assert.equal(id,`studio-${role}-2`);dialog.refresh();}})});
    dialog.chooseCharacterVoice(role,`studio-${role}-2`);
    assert.equal(updates.length,2);for(const update of updates){assert.equal(update.preview,null);assert.equal(update.error,'');assert.equal(update.pending[role],`studio-${role}-2`);}
  }
});
