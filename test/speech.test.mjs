import test from 'node:test';
import assert from 'node:assert/strict';
import {OfficeSpeech,supportsLanguage} from '../public/office-speech.js';
import {setLocale} from '../public/i18n.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const VOICES=[{id:'fr-pierre',name:'Pierre',lang:'fr-FR',gender:'male',installed:true},{id:'fr-jessica',name:'Jessica',lang:'fr-FR',gender:'female',installed:true},{id:'en-alba',name:'Alba',lang:'en-GB',installed:false}];
const STUDIO=[{id:'studio-oscar',name:'Oscar Studio',lang:'multilingual',languages:['fr','en','nl'],gender:'male',recommended:true,installed:true},{id:'studio-zoe',name:'Zoé Studio',lang:'multilingual',languages:['fr','en','nl'],gender:'female',recommended:true,installed:true}];
function fixture({installed=true,response,stored,voices=VOICES}={}){
  const utterances=[],audio=[],changes=[],calls=[],saved=new Map(stored?[['oscar-voice-v1',JSON.stringify(stored)]]:[]),document=new EventTarget();document.hidden=false;
  const synth=new EventTarget();Object.assign(synth,{cancel(){},resume(){},getVoices:()=>[{name:'System voice',lang:'fr-FR',localService:true}],speak:utterance=>utterances.push(utterance)});
  const host={document,speechSynthesis:synth,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},Audio:class{constructor(url){this.url=url;audio.push(this);}play(){this.played=true;return Promise.resolve();}pause(){this.paused=true;}removeAttribute(){}load(){}},localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},fetch:async(url,options={})=>{calls.push({url,options});if(response)return response(url,options);return{ok:true,json:async()=>url==='/api/voice'?{status:installed?'ready':'not_installed',available:installed,voices:voices.map(voice=>({...voice,installed:installed&&voice.installed})),progress:null}:url==='/api/voice/install'?{status:'installing',available:false,voices,progress:{phase:'download',percent:0}}:{url:'/api/voice/audio/abc123.wav'}};}};
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
 const{speech,host,calls,changes,utterances}=fixture();await speech.ready;speech.setEngine('captions');assert.equal(speech.speak('oscar','Bonjour'),false);assert.equal(changes.at(-1).caption,true);assert.equal(calls.length,1);speech.setEngine('system');speech.speak('oscar','Un');speech.speak('zoe','Deux');utterances[0].onend();assert.equal(speech.current.role,'zoe');host.document.hidden=true;host.document.dispatchEvent(new Event('visibilitychange'));assert.equal(speech.current,null);assert.equal(speech.speak('oscar','Caché'),false);speech.destroy();
 const offline=new OfficeSpeech({host:{},onChange:()=>{}});await offline.ready;assert.equal(offline.speak('oscar','Bonjour'),false);offline.destroy();
});
test('the five specialist roles stay caption-only in every engine, including explicit previews',async()=>{
 const {speech,calls,audio,utterances,changes}=fixture();await speech.ready;
 for(const engine of ['natural','system','captions']){
  speech.setEngine(engine);
  for(const role of ['recherche','redaction','code','design','analyse','unknown']){
   assert.equal(speech.speak(role,'Une contribution locale.',{voiceId:'fr-pierre',automatic:true}),false);
   const caption=changes.at(-1);assert.equal(caption.role,role);assert.equal(caption.caption,true);assert.equal(caption.muted,true);assert.equal(caption.speaking,false);assert.equal(caption.preparing,false);
  }
 }
 assert.equal(audio.length,0);assert.equal(utterances.length,0);assert.deepEqual(calls.map(call=>call.url),['/api/voice']);speech.destroy();
});
test('a specialist caption neither interrupts Oscar nor consumes his automatic narration allowance',async()=>{
 const {speech,audio,changes,host}=fixture();await speech.ready;host.document.dispatchEvent(new Event('pointerdown'));
 speech.speak('oscar','Oscar parle.',{automatic:true});await tick();const current=speech.current,generation=speech.generation,lastAutomatic=speech.lastAutomatic;
 speech.speak('code','Mon résultat est prêt.',{automatic:true,interrupt:true});
 assert.equal(speech.current,current);assert.equal(speech.generation,generation);assert.equal(speech.lastAutomatic,lastAutomatic);assert.equal(audio[0].paused,undefined);
 assert.equal(changes.at(-1).audioSpeaking,true);assert.equal(changes.at(-1).audioRole,'oscar');assert.equal(changes.at(-1).speaking,false);speech.destroy();
});
test('the secretary alias uses Zoe’s voice and migrates legacy settings to only the two speakers',async()=>{
 const {speech,calls,saved}=fixture({stored:{characters:{oscar:'fr-pierre',secretaire:'fr-jessica',code:'fr-pierre'}}});await speech.ready;
 assert.deepEqual(speech.characterVoices,{oscar:'fr-pierre',zoe:'fr-jessica'});
 assert.equal(speech.speak('secretaire','Bonjour, voici votre agenda.'),true);await tick();assert.equal(speech.current.role,'zoe');assert.equal(JSON.parse(calls[1].options.body).voiceId,'fr-jessica');
 speech.setCharacterVoice('secretaire','fr-pierre');speech.setCharacterVoice('code','fr-jessica');const characters=JSON.parse(saved.get('oscar-voice-v1')).characters;
 assert.deepEqual(characters,{oscar:'fr-pierre',zoe:'fr-pierre'});speech.destroy();
});
test('each character keeps the same multilingual voice across French, English and Dutch',async()=>{
 const voices=[{id:'multi-oscar',name:'Oscar naturel',languages:['fr-FR','en','nl-NL'],gender:'male',installed:true},{id:'multi-zoe',name:'Zoé naturelle',lang:'multilingual',gender:'female',installed:true}];
 const {speech,host,calls}=fixture({voices,stored:{characters:{oscar:'multi-oscar',zoe:'multi-zoe'}}});await speech.ready;
 try{
  for(const locale of ['fr','en','nl']){
   setLocale(locale);host.document.dispatchEvent(new Event('oscar:language'));assert.equal(speech.available,true);
   for(const role of ['oscar','zoe']){assert.equal(speech.speak(role,'Test'),true);await tick();const body=JSON.parse(calls.at(-1).options.body);assert.equal(body.voiceId,`multi-${role}`);assert.equal(body.language,locale);}
   assert.deepEqual(speech.characterVoices,{oscar:'multi-oscar',zoe:'multi-zoe'});
  }
 }finally{speech.destroy();setLocale('fr');}
});
test('recommended multilingual characters are preferred over installed legacy voices of the same gender',async()=>{
 const {speech}=fixture({voices:[...VOICES,...STUDIO]});await speech.ready;
 assert.equal(speech.chooseVoice('oscar').id,'studio-oscar');assert.equal(speech.chooseVoice('secretaire').id,'studio-zoe');
 speech.setCharacterVoice('oscar','fr-pierre');assert.equal(speech.chooseVoice('oscar').id,'fr-pierre','an explicit compatible user choice stays selected');speech.destroy();
});
test('only incompatible saved legacy choices fall back automatically when changing language',async()=>{
 const {speech,host,calls,saved}=fixture({voices:[...VOICES,...STUDIO],stored:{version:2,characters:{oscar:'fr-pierre',zoe:'fr-jessica'}}});await speech.ready;
 try{
  for(const locale of ['en','nl']){
   setLocale(locale);host.document.dispatchEvent(new Event('oscar:language'));
   assert.equal(speech.chooseVoice('oscar').id,'studio-oscar');assert.equal(speech.chooseVoice('zoe').id,'studio-zoe');
   assert.equal(speech.speak('oscar','Test',{voiceId:'fr-pierre'}),false,'an explicit preview cannot silently switch voices');
   assert.equal(speech.speak('oscar','Test'),true);await tick();assert.equal(JSON.parse(calls.at(-1).options.body).language,locale);
  }
  speech.setEnabled(true);assert.deepEqual(JSON.parse(saved.get('oscar-voice-v1')).characters,{oscar:'fr-pierre',zoe:'fr-jessica'});
  setLocale('fr');host.document.dispatchEvent(new Event('oscar:language'));assert.equal(speech.chooseVoice('oscar').id,'fr-pierre');
 }finally{speech.destroy();setLocale('fr');}
});
test('automatic narration keeps captions while the recommended Studio pack is absent, even with Piper installed',async()=>{
 const {speech,calls,changes}=fixture({voices:[...VOICES,...STUDIO.map(voice=>({...voice,installed:false}))]});await speech.ready;
 assert.equal(speech.available,false);assert.equal(speech.chooseVoice('oscar'),null);assert.equal(speech.chooseVoice('zoe'),null);assert.equal(speech.speak('oscar','Bonjour'),false);assert.equal(changes.at(-1).caption,true);assert.equal(calls.length,1);
 speech.setCharacterVoice('oscar','fr-pierre');assert.equal(speech.available,true);assert.equal(speech.chooseVoice('oscar').id,'fr-pierre');assert.equal(speech.speak('oscar','Test'),true);await tick();speech.setCharacterVoice('oscar','auto');assert.equal(speech.available,false);speech.destroy();
});
test('version one natural preferences migrate once only after both Studio voices are installed',async()=>{
 const old={enabled:false,engine:'natural',voice:'fr-siwis',characters:{oscar:'fr-pierre',zoe:'fr-jessica'}};
 const first=fixture({voices:[...VOICES,...STUDIO.map(voice=>({...voice,installed:voice.id==='studio-oscar'}))],stored:old});await first.speech.ready;
 assert.equal(first.speech.preferencesVersion,1);assert.equal(first.speech.voiceName,'fr-siwis');first.speech.setEnabled(true);assert.equal(JSON.parse(first.saved.get('oscar-voice-v1')).version,1,'ordinary settings do not prematurely consume the migration');
 first.speech.acceptLocal({status:'ready',voices:[...VOICES,...STUDIO]});
 assert.equal(first.speech.voiceName,'auto');assert.deepEqual(first.speech.characterVoices,{oscar:'auto',zoe:'auto'});assert.equal(first.speech.chooseVoice('oscar').id,'studio-oscar');assert.equal(JSON.parse(first.saved.get('oscar-voice-v1')).version,2);
 first.speech.setCharacterVoice('oscar','fr-pierre');first.speech.acceptLocal({status:'ready',voices:[...VOICES,...STUDIO]});assert.equal(first.speech.chooseVoice('oscar').id,'fr-pierre','an explicit Piper re-selection survives refresh');
 const persisted=JSON.parse(first.saved.get('oscar-voice-v1'));first.speech.destroy();const reopened=fixture({voices:[...VOICES,...STUDIO],stored:persisted});await reopened.speech.ready;assert.equal(reopened.speech.chooseVoice('oscar').id,'fr-pierre');reopened.speech.destroy();
});
test('the one-time Studio migration preserves intentional captions and system modes',async()=>{
 for(const engine of ['captions','system']){
  const {speech,saved}=fixture({voices:[...VOICES,...STUDIO],stored:{engine,enabled:false,voice:'fr-pierre',characters:{zoe:'fr-jessica'}}});await speech.ready;
  assert.equal(speech.engine,engine);assert.equal(speech.enabled,false);assert.equal(speech.voiceName,'fr-pierre');assert.equal(speech.characterVoices.zoe,'fr-jessica');assert.equal(JSON.parse(saved.get('oscar-voice-v1')).version,2);speech.destroy();
 }
});
test('language helper respects explicit capabilities and does not replace an unavailable user-selected studio voice',async()=>{
 assert.equal(supportsLanguage({lang:'multilingual'},'nl'),true);assert.equal(supportsLanguage({lang:'multilingual',languages:['fr']},'nl'),false);assert.equal(supportsLanguage({languages:['en-GB','nl-NL']},'nl'),true);
 const {speech,host}=fixture({voices:[...STUDIO,{id:'studio-fr-only',lang:'fr',recommended:true,installed:true}],stored:{characters:{oscar:'studio-fr-only'}}});await speech.ready;
 try{setLocale('nl');host.document.dispatchEvent(new Event('oscar:language'));assert.equal(speech.chooseVoice('oscar'),null);speech.setCharacterVoice('oscar','unknown');assert.equal(speech.chooseVoice('oscar'),null);}
 finally{speech.destroy();setLocale('fr');}
});
test('explicit language lists and installation status limit multilingual availability',async()=>{
 const {speech,host,calls,changes}=fixture({voices:[{id:'fr-only',lang:'multilingual',languages:['fr'],installed:true},{id:'missing',lang:'multilingual',languages:['fr','en','nl'],installed:false}]});await speech.ready;
 try{setLocale('nl');host.document.dispatchEvent(new Event('oscar:language'));assert.equal(speech.available,false);assert.equal(speech.speak('oscar','Test'),false);assert.equal(changes.at(-1).caption,true);assert.equal(calls.length,1);}
 finally{speech.destroy();setLocale('fr');}
});
