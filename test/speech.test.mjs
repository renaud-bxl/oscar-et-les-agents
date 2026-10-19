import test from 'node:test';
import assert from 'node:assert/strict';
import {OfficeSpeech} from '../public/office-speech.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const VOICES=[{id:'fr-pierre',name:'Pierre',lang:'fr-FR',gender:'male',installed:true},{id:'fr-jessica',name:'Jessica',lang:'fr-FR',gender:'female',installed:true},{id:'en-alba',name:'Alba',lang:'en-GB',installed:false}];
function fixture({installed=true,response,stored}={}){
  const utterances=[],audio=[],changes=[],calls=[],saved=new Map(stored?[['oscar-voice-v1',JSON.stringify(stored)]]:[]),document=new EventTarget();document.hidden=false;
  const synth=new EventTarget();Object.assign(synth,{cancel(){},resume(){},getVoices:()=>[{name:'System voice',lang:'fr-FR',localService:true}],speak:utterance=>utterances.push(utterance)});
  const host={document,speechSynthesis:synth,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},Audio:class{constructor(url){this.url=url;audio.push(this);}play(){this.played=true;return Promise.resolve();}pause(){this.paused=true;}removeAttribute(){}load(){}},localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},fetch:async(url,options={})=>{calls.push({url,options});if(response)return response(url,options);return{ok:true,json:async()=>url==='/api/voice'?{status:installed?'ready':'not_installed',available:installed,voices:VOICES.map(voice=>({...voice,installed:installed&&voice.installed})),progress:null}:url==='/api/voice/install'?{status:'installing',available:false,voices:VOICES,progress:{phase:'download',percent:0}}:{url:'/api/voice/audio/abc123.wav'}};}};
  const speech=new OfficeSpeech({host,onChange:change=>changes.push(change)});return{speech,host,utterances,audio,changes,calls,saved};
}
test('natural speech is the default and no voice is downloaded without confirmation',async()=>{
 const{speech,utterances,audio,calls,changes}=fixture({installed:false});await speech.ready;
 assert.equal(speech.engine,'natural');assert.equal(speech.speak('oscar','Bonjour'),false);assert.equal(changes.at(-1).caption,true);assert.equal(utterances.length,0);assert.equal(audio.length,0);assert.deepEqual(calls.map(call=>call.url),['/api/voice']);
 await assert.rejects(speech.installVoice('fr-pierre'),/Confirmez/);assert.equal(calls.length,1);await speech.installVoice('fr-pierre',{confirmed:true});assert.equal(calls[1].url,'/api/voice/install');assert.equal(JSON.parse(calls[1].options.body).confirmed,true);speech.destroy();
});
test('automatic local narration waits for interaction and only synthesizes an installed matching voice',async()=>{
 const{speech,host,audio,calls,utterances}=fixture();await speech.ready;
 assert.equal(speech.speak('oscar','Bonjour',{automatic:true}),false);host.document.dispatchEvent(new Event('pointerdown'));
 assert.equal(speech.speak('oscar','Bonjour',{automatic:true}),true);await tick();assert.equal(audio[0].url,'/api/voice/audio/abc123.wav');assert.equal(audio[0].played,true);assert.equal(speech.current.phase,'speaking');assert.equal(utterances.length,0);
 const body=JSON.parse(calls[1].options.body);assert.equal(body.voiceId,'fr-pierre');assert.equal(body.text,'Bonjour');assert.equal(speech.speak('code','Une étape',{automatic:true,interrupt:false}),false);speech.destroy();assert.equal(audio[0].paused,true);
});
test('robotic system voices require an explicit engine choice, including with legacy preferences',async()=>{
 const{speech,utterances}=fixture({stored:{enabled:true,voice:'System voice'}});await speech.ready;assert.equal(speech.engine,'natural');assert.equal(speech.speak('oscar','Bonjour'),false);
 speech.setEngine('system');assert.equal(speech.speak('oscar','Bonjour'),true);assert.equal(utterances[0].voice.name,'System voice');speech.destroy();
});
test('mute cancels playback and persists preferences and character choices',async()=>{
 const{speech,audio,saved}=fixture();await speech.ready;speech.setCharacterVoice('zoe','fr-jessica');speech.speak('zoe','Une réplique.');await tick();assert.equal(audio.length,1);speech.setEnabled(false);assert.equal(speech.current,null);assert.equal(audio[0].paused,true);assert.equal(speech.speak('oscar','Bonjour'),false);const value=JSON.parse(saved.get('oscar-voice-v1'));assert.equal(value.enabled,false);assert.equal(value.characters.zoe,'fr-jessica');speech.destroy();
});
test('late synthesis cannot play after stop or replace another character',async()=>{
 let resolve;const pending=new Promise(yes=>{resolve=yes;});const{speech,audio}=fixture({response:async url=>({ok:true,json:async()=>url==='/api/voice'?{status:'ready',voices:VOICES,available:true}:pending})});await speech.ready;speech.speak('oscar','Un');speech.stop();resolve({url:'/api/voice/audio/abc.wav'});await tick();assert.equal(audio.length,0);assert.equal(speech.current,null);speech.destroy();
});
test('wrong language, uninstalled voice and remote audio URLs preserve captions without system fallback',async()=>{
 const{speech,calls,changes,utterances}=fixture();await speech.ready;assert.equal(speech.speak('oscar','Bonjour',{voiceId:'en-alba'}),false);assert.equal(calls.length,1);assert.equal(changes.at(-1).caption,true);assert.equal(utterances.length,0);speech.destroy();
 const unsafe=fixture({response:async url=>({ok:true,json:async()=>url==='/api/voice'?{status:'ready',available:true,voices:VOICES}:{url:'https://example.com/speech.wav'}})});await unsafe.speech.ready;unsafe.speech.speak('oscar','Bonjour');await tick();assert.equal(unsafe.audio.length,0);assert.match(unsafe.changes.at(-1).error,/inattendu/);unsafe.speech.destroy();
});
test('captions mode, hidden tab, unavailable service and late native completion are safe',async()=>{
 const{speech,host,calls,changes,utterances}=fixture();await speech.ready;speech.setEngine('captions');assert.equal(speech.speak('oscar','Bonjour'),false);assert.equal(changes.at(-1).caption,true);assert.equal(calls.length,1);speech.setEngine('system');speech.speak('oscar','Un');speech.speak('design','Deux');utterances[0].onend();assert.equal(speech.current.role,'design');host.document.hidden=true;host.document.dispatchEvent(new Event('visibilitychange'));assert.equal(speech.current,null);assert.equal(speech.speak('oscar','Caché'),false);speech.destroy();
 const offline=new OfficeSpeech({host:{},onChange:()=>{}});await offline.ready;assert.equal(offline.speak('oscar','Bonjour'),false);offline.destroy();
});
