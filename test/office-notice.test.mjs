import test from 'node:test';
import assert from 'node:assert/strict';
import {OfficeNotice} from '../public/office-notice.js';
import {OfficeSpeech} from '../public/office-speech.js';

class Element extends EventTarget{
  constructor(){super();this.hidden=false;this.textContent='';this.children=[];}
  contains(value){return value===this||this.children.includes(value);}
  emit(name,relatedTarget){const event=new Event(name);Object.defineProperty(event,'relatedTarget',{value:relatedTarget});this.dispatchEvent(event);}
}
function fixture(){
  let time=0,sequence=0,dismissals=0;
  const pending=new Map(),clock={performance:{now:()=>time},setTimeout(callback,delay){const id=++sequence;pending.set(id,{callback,at:time+delay});return id;},clearTimeout:id=>pending.delete(id)};
  const advance=milliseconds=>{const end=time+milliseconds;let limit=100;while(limit--){const next=[...pending].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;pending.delete(next[0]);next[1].callback();}assert(limit>0,'Timer loop must stay bounded.');time=end;};
  const element=new Element(),content=new Element(),label=new Element(),closeButton=new Element();element.children=[content,label,closeButton];
  const notice=new OfficeNotice({element,content,label,closeButton,clock,onDismiss:()=>dismissals++});
  return{notice,element,content,label,closeButton,advance,pending,get dismissals(){return dismissals;}};
}

test('an ordinary caption disappears after eight seconds without removing its text or interrupting another UI',()=>{
  const f=fixture();assert.equal(f.element.hidden,true);
  assert.equal(f.notice.show({id:'line-1',text:'L’équipe avance.',label:'Oscar'}),true);
  assert.equal(f.element.hidden,false);assert.equal(f.label.textContent,'Oscar');
  f.advance(7999);assert.equal(f.element.hidden,false);f.advance(1);assert.equal(f.element.hidden,true);
  assert.equal(f.content.textContent,'L’équipe avance.');assert.equal(f.dismissals,0);assert.equal(f.pending.size,0);f.notice.destroy();
});

test('identical state updates neither extend a caption nor reopen it after auto-dismiss or manual close',()=>{
  const f=fixture(),line={id:'line-1',text:'De nouvelles contributions sont validées.'};f.notice.show(line);
  f.advance(5000);assert.equal(f.notice.show(line),false);f.advance(3000);assert.equal(f.element.hidden,true);
  f.notice.show(line);assert.equal(f.element.hidden,true);assert.equal(f.pending.size,0);
  f.notice.show({...line,id:'line-2'});f.closeButton.emit('click');assert.equal(f.element.hidden,true);assert.equal(f.dismissals,1);
  f.notice.show({...line,id:'line-2'});assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('a genuinely new utterance can repeat the same words with a fresh display period',()=>{
  const f=fixture();f.notice.show({id:1,text:'Bonjour.'});f.advance(8000);
  f.notice.show({id:2,text:'Bonjour.'});assert.equal(f.element.hidden,false);f.advance(7999);assert.equal(f.element.hidden,false);
  f.advance(1);assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('closing a focused or hovered notice does not leave a pause attached to the next message',()=>{
  const f=fixture();f.notice.show({id:1,text:'Une information.'});f.element.emit('pointerenter');f.element.emit('focusin');
  f.closeButton.emit('click');assert.equal(f.element.hidden,true);assert.equal(f.pending.size,0);
  f.notice.show({id:2,text:'La suite.'});f.advance(8000);assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('hover pauses the remaining reading time rather than starting a new full timeout',()=>{
  const f=fixture();f.notice.show({id:1,text:'Une information.'});f.advance(3000);f.element.emit('pointerenter');
  assert.equal(f.pending.size,0);f.advance(60000);assert.equal(f.element.hidden,false);
  f.element.emit('pointerleave');f.advance(4999);assert.equal(f.element.hidden,false);f.advance(1);assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('focus inside a caption pauses it, including moves between its close and audio buttons',()=>{
  const f=fixture();f.notice.show({id:1,text:'Une information.'});f.advance(2000);f.element.emit('focusin');
  f.element.emit('focusout',f.closeButton);f.advance(60000);assert.equal(f.element.hidden,false);assert.equal(f.pending.size,0);
  f.element.emit('focusout',new Element());f.advance(6000);assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('overlapping hover, focus and audio holds must all end before the caption can expire',()=>{
  const f=fixture();f.notice.show({id:1,text:'Oscar explique.'});f.advance(1000);
  f.element.emit('pointerenter');f.element.emit('focusin');f.notice.hold(true);
  f.element.emit('pointerleave');f.notice.hold(false);f.advance(60000);assert.equal(f.element.hidden,false);
  f.element.emit('focusout');f.advance(6999);assert.equal(f.element.hidden,false);f.advance(1);assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('long spoken explanations remain readable until playback ends and then get eight seconds',()=>{
  const f=fixture();f.notice.hold(true);f.notice.show({id:1,text:'Une explication parlée.'});
  f.advance(90000);assert.equal(f.element.hidden,false);assert.equal(f.pending.size,0);
  f.notice.hold(false);f.advance(8000);assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('actionable notices stay visible until acknowledgement and are not replaced by routine updates',()=>{
  const f=fixture();f.notice.show({id:1,text:'Ouvrez le suivi pour vérifier le problème.',persistent:true});
  f.advance(90000);assert.equal(f.element.hidden,false);assert.equal(f.pending.size,0);
  assert.equal(f.notice.show({id:2,text:'Une contribution est validée.'}),false);
  assert.equal(f.content.textContent,'Ouvrez le suivi pour vérifier le problème.');
  f.closeButton.emit('click');assert.equal(f.dismissals,1);assert.equal(f.element.hidden,true);
  assert.equal(f.notice.show({id:3,text:'Une nouvelle information.'}),true);f.notice.destroy();
});

test('a newer important alert can update an existing important alert without becoming transient',()=>{
  const f=fixture();f.notice.show({id:1,text:'Un point demande votre attention.',persistent:true});
  assert.equal(f.notice.show({id:2,text:'La mission a rencontré un problème.',persistent:true}),true);
  f.advance(90000);assert.equal(f.element.hidden,false);assert.equal(f.content.textContent,'La mission a rencontré un problème.');f.notice.destroy();
});

test('a new mission clears old message timers and pause state without affecting same-mission updates',()=>{
  const f=fixture();f.notice.setContext('mission-A');f.notice.show({id:1,text:'Mission A.'});f.advance(2000);
  f.notice.setContext('mission-A');assert.equal(f.element.hidden,false);assert.equal(f.pending.size,1);
  f.element.emit('pointerenter');f.notice.setContext('mission-B');assert.equal(f.element.hidden,true);assert.equal(f.pending.size,0);
  f.notice.show({id:1,text:'Mission B.'});f.advance(8000);assert.equal(f.element.hidden,true);f.notice.destroy();
});

test('destroy clears timers and event listeners and ignores late or duplicate updates',()=>{
  const f=fixture();f.notice.show({id:1,text:'Une information.'});assert.equal(f.pending.size,1);
  f.notice.destroy();f.notice.destroy();assert.equal(f.pending.size,0);assert.equal(f.element.hidden,true);
  f.advance(90000);f.element.emit('pointerenter');f.closeButton.emit('click');
  assert.equal(f.dismissals,0);assert.equal(f.notice.show({id:2,text:'Trop tard.'}),false);assert.equal(f.pending.size,0);
});

test('notice content is assigned as passive text, and empty updates cannot clear an important notice',()=>{
  const f=fixture();f.notice.show({id:1,text:'<img src=x onerror=alert(1)>',persistent:true});
  assert.equal(f.content.textContent,'<img src=x onerror=alert(1)>');
  assert.equal(f.notice.show({id:2,text:''}),false);assert.equal(f.element.hidden,false);f.notice.destroy();
});

test('speech uses stable caption identities across state refreshes and new identities for explicit repetitions',async()=>{
  const changes=[],host={document:new EventTarget(),fetch:async()=>({ok:true,json:async()=>({status:'not_installed',voices:[]})})};
  const speech=new OfficeSpeech({host,onChange:info=>changes.push(info)});await speech.ready;speech.setEngine('captions');
  speech.speak('oscar','Bonjour.');const first=changes.at(-1).captionId;assert.equal(Number.isInteger(first),true);
  speech.notify();assert.equal(changes.at(-1).captionId,first);
  speech.speak('oscar','Bonjour.');assert.notEqual(changes.at(-1).captionId,first);
  speech.speak('oscar','Un point demande votre attention.',{persistent:true});assert.equal(changes.at(-1).persistent,true);
  speech.speak('oscar','Une nouvelle information.');assert.equal(changes.at(-1).persistent,false);speech.destroy();
});
