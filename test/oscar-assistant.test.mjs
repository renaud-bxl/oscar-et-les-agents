import test from 'node:test';
import assert from 'node:assert/strict';
import {OscarAssistant,oscarMissionSnapshot,answerOscarQuestion,oscarQuestionIntent,oscarAssistantText} from '../public/oscar-assistant.js';
import messages from '../public/translations-oscar-assistant.js';
import {setLocale} from '../public/i18n.js';

const NOW=Date.parse('2026-10-22T10:20:30Z');
const mission=(values={})=>({id:'mission-A',title:'Mon jeu personnel',provider:'codex',status:'running',updatedAt:NOW,tasks:[{id:'t1',agentName:'Alma',title:'Le dessin',status:'approved',dependsOn:[]},{id:'t2',agentName:'Sam',title:'Le moteur',status:'queued',dependsOn:[]},{id:'t3',agentName:'Alex',title:'Assembler le jeu',status:'queued',dependsOn:['t1','t2']}],performance:{calls:[]},files:[],...values});
const snapshot=(values={})=>oscarMissionSnapshot(mission(values),{now:NOW});
const answer=(question,values={},locale='fr')=>answerOscarQuestion(snapshot(values),question,{locale}).answer;
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};

function dom(){
  const document={handlers:new Map()};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.handlers=new Map();this.attributes=new Map();this.dataset={};this.value='';this.hidden=false;this.textContent='';}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    setAttribute(name,value){this.attributes.set(name,String(value));}
    addEventListener(name,action){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(action);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
    click(){return Promise.all([...(this.handlers.get('click')||[])].map(action=>action()));}
    set innerHTML(_value){throw Error('Active HTML is forbidden.');}
  }
  document.createElement=tag=>new Element(tag);
  document.addEventListener=(name,action)=>{if(!document.handlers.has(name))document.handlers.set(name,new Set());document.handlers.get(name).add(action);};
  document.removeEventListener=(name,action)=>document.handlers.get(name)?.delete(action);
  document.emit=name=>{for(const action of document.handlers.get(name)||[])action();};
  return{document,container:document.createElement('div')};
}
function fixture(options={}){setLocale('fr');const d=dom(),widget=new OscarAssistant({container:d.container,now:()=>NOW,...options});widget.update(mission());return{...d,widget};}

test('queued specialists and scene activity cannot become claims of actual model work',()=>{
  const source=mission({tasks:[{id:'t1',agentName:'Sam',status:'queued',activity:'Je travaille',animation:'typing'}]});const original=JSON.stringify(source),s=oscarMissionSnapshot(source,{now:NOW});
  assert.equal(s.calls.length,0);assert.match(answerOscarQuestion(s,'Qui travaille maintenant ?').answer,/Aucun appel du moteur n’est enregistré comme en cours/u);assert.equal(JSON.stringify(source),original);
  assert.match(answer('Où en est-on ?'),/1\/3/u);assert.match(answer('Combien de temps reste-t-il ?'),/ne peux pas déduire une heure de fin/u);
});

test('only current measured running calls are reported and terminal or demo missions cannot keep them running',()=>{
  const calls=[{agent:'Sam',stage:'creation',status:'running',startedAt:NOW-1000,durationMs:null},{agent:'Alma',stage:'creation',status:'completed',startedAt:NOW-2000,durationMs:1000},{agent:'Oscar',stage:'review',status:'running',startedAt:NOW+1000,durationMs:null}];
  assert.deepEqual(snapshot({performance:{calls}}).calls,[{agent:'Sam',stage:'creation'}]);
  assert.match(answer('Qui travaille maintenant ?',{performance:{calls}}),/Sam — réalise une contribution/u);assert.doesNotMatch(answer('Qui travaille maintenant ?',{performance:{calls}}),/Alma/u);
  for(const status of['completed','failed','cancelled','needs_review'])assert.equal(snapshot({status,performance:{calls}}).calls.length,0);
  assert.match(answer('Qui travaille maintenant ?',{provider:'demo',performance:{calls}}),/activités sont simulées/u);
  assert.match(answer('Qui travaille maintenant ?',{performance:undefined}),/ancienne mission.*mesures/u);
});

test('remaining tasks and waiting explanations use real dependencies without promising a start or final approval',()=>{
  const remaining=answer('Que reste-t-il à faire ?');assert.match(remaining,/Sam — Le moteur/u);assert.match(remaining,/Alex — Assembler le jeu.*attend : Le moteur/u);assert.doesNotMatch(remaining,/Alma — Le dessin/u);
  const waiting=answer('Pourquoi ça attend ?');assert.match(waiting,/Prête selon ses dépendances ; aucun démarrage n’est promis/u);assert.match(waiting,/attend : Le moteur/u);
  const review=answer('Que reste-t-il à faire ?',{status:'reviewing',tasks:[{id:'t1',agentName:'Alma',status:'approved'}]});assert.match(review,/validation finale.*distincte/u);assert.doesNotMatch(review,/Livraison validée/u);
  assert.match(answer('Que reste-t-il à faire ?',{tasks:[]}),/répartition des tâches n’est pas encore enregistrée/u);
});

test('errors and files remain passive recorded data, with partial files clearly distinguished',()=>{
  const values={status:'failed',error:'Une permission est nécessaire.',workDirectory:'/Mon SSD/Mon projet',files:[{path:'Livraison/index.html'},{path:'dessin.svg'}],tasks:[{id:'t1',agentName:'Alma',status:'blocked',dependsOn:['unknown'],review:{approved:false,feedback:'<script>texte non fiable</script>'}}]};
  assert.match(answer('Pourquoi ça attend ?',values),/<script>texte non fiable<\/script>/u);assert.match(answer('Pourquoi ça attend ?',values),/Une permission est nécessaire/u);
  const files=answer('Où sont mes fichiers ?',values);assert.match(files,/\/Mon SSD\/Mon projet/u);assert.match(files,/Livraison\/index.html/u);assert.match(files,/peuvent être partiels/u);
  assert.equal(oscarMissionSnapshot(null),null);assert.match(answerOscarQuestion(null,'Bonjour').answer,/Choisissez une mission/u);
});

test('quick prompts resolve locally in French English and Dutch while modification requests stay distinct',()=>{
  for(const locale of['fr','en','nl'])for(const source of['Où en est-on ?','Que reste-t-il à faire ?','Qui travaille maintenant ?','Pourquoi ça attend ?','Où sont mes fichiers ?'])assert.notEqual(oscarQuestionIntent(oscarAssistantText(source,locale)),'free',`${locale}: ${source}`);
  assert.equal(oscarQuestionIntent('Ajoute une nouvelle page'),'change');assert.equal(oscarQuestionIntent('Publish the game'),'change');assert.equal(oscarQuestionIntent('Waarom wacht Sam?'),'blockers');
  assert.equal(oscarQuestionIntent('Cette architecture convient-elle à mon objectif ?'),'free');
  assert.match(answer('Ajoute une nouvelle page'),/conversation ne modifie pas la mission/u);
  for(const [source,targets]of Object.entries(messages))for(const locale of['en','nl']){assert.equal(typeof targets[locale],'string',source);assert.notEqual(targets[locale],source);}
});

test('local questions are instant, make no callback and preserve the same input and draft through state refreshes',async()=>{
  const calls=[],f=fixture({onAsk:options=>calls.push(options)}),{widget}=f,question=widget.question;
  question.value='Où en est-on ?';await widget.ask();assert.equal(calls.length,0);assert.equal(widget.reply.dataset.source,'state');assert.match(widget.replyText.textContent,/1\/3/u);
  question.value='Une question encore en cours de rédaction';widget.update(mission({status:'reviewing',updatedAt:NOW+2000}));assert.equal(widget.question,question);assert.equal(question.value,'Une question encore en cours de rédaction');assert.match(widget.state.textContent,/Vérification des résultats/u);assert.match(widget.replyTime.textContent,/Point enregistré/u);
  widget.destroy();
});

test('a free question uses one request, respects pending state and cannot modify the selected mission',async()=>{
  const done=deferred(),calls=[],f=fixture({onAsk:options=>{calls.push(options);return done.promise;}}),{widget}=f,source=mission();widget.update(source);const before=JSON.stringify(source);
  widget.question.value='Cette architecture convient-elle à mon objectif ?';const pending=widget.ask();await widget.ask();assert.equal(calls.length,1);assert.equal(widget.askButton.disabled,true);assert.equal(calls[0].missionId,'mission-A');assert.equal(calls[0].locale,'fr');assert.ok(calls[0].requestId.length>=8);assert.equal(calls[0].signal.aborted,false);
  widget.question.value='Mon prochain message reste à écrire';widget.update({...source,updatedAt:NOW+3000});done.resolve({missionId:'mission-A',answer:'Une réponse de démonstration.',source:'model',asOf:NOW});await pending;
  assert.equal(widget.question.value,'Mon prochain message reste à écrire');assert.equal(widget.replyText.textContent,'Une réponse de démonstration.');assert.equal(widget.reply.dataset.source,'model');assert.equal(widget.askButton.disabled,false);assert.equal(JSON.stringify(source),before);widget.destroy();
});

test('an uncertain response is recovered by its existing request id and never creates a second post',async()=>{
  const sent=[],recovered=[],{widget}=fixture({onAsk:async options=>{sent.push(options);throw new Error('connection lost');},onRecover:async options=>{recovered.push(options);return{missionId:'mission-A',answer:'La réponse retrouvée.',source:'model',asOf:NOW};}});
  widget.question.value='Cette architecture convient-elle à mon objectif ?';await widget.ask();assert.equal(widget.recoverButton.hidden,false);assert.equal(widget.error.hidden,false);const id=sent[0].requestId;
  await widget.ask();assert.equal(sent.length,1);assert.equal(recovered.length,1);assert.equal(recovered[0].requestId,id);assert.equal(widget.replyText.textContent,'La réponse retrouvée.');assert.equal(widget.recoverButton.hidden,true);widget.destroy();
});

test('a pending receipt or confirmed missing receipt never causes an automatic model resubmission',async()=>{
  let sends=0,recoveries=0;const{widget}=fixture({onAsk:async()=>{sends++;throw Error('network');},onRecover:async()=>{recoveries++;if(recoveries===1)return{missionId:'mission-A',status:'running'};throw Object.assign(Error('missing'),{status:404});}});
  widget.question.value='Cette architecture convient-elle à mon objectif ?';await widget.ask();await widget.recover();assert.equal(sends,1);assert.equal(widget.recoverButton.hidden,false);assert.match(widget.error.textContent,/pas encore disponible/u);
  await widget.recover();assert.equal(sends,1);assert.equal(widget.receipt,null);assert.match(widget.error.textContent,/envoyer de nouveau/u);await widget.ask();assert.equal(sends,2);widget.destroy();
});

test('closing keeps an in-flight receipt but late answers cannot reopen or overwrite another selected mission',async()=>{
  const first=deferred(),calls=[],{widget}=fixture({onAsk:options=>{calls.push(options);return first.promise;}});
  widget.question.value='Cette architecture convient-elle à mon objectif ?';const pending=widget.ask();widget.setVisible(false);assert.equal(calls[0].signal.aborted,true);assert.equal(widget.receipt.requestId,calls[0].requestId);assert.equal(widget.root.hidden,true);
  widget.setVisible(true);widget.update(mission({id:'mission-B'}));widget.question.value='Question B';first.resolve({missionId:'mission-A',answer:'Ancienne réponse.',source:'model',asOf:NOW});await pending;assert.equal(widget.answer,null);assert.equal(widget.receipt,null);assert.equal(widget.question.value,'Question B');widget.destroy();
});

test('question validation and explicit server refusals keep text without fabricating an answer or retry receipt',async()=>{
  let sends=0;const{widget}=fixture({onAsk:async()=>{sends++;throw Object.assign(Error('not allowed'),{status:403});}});
  for(const value of['','x'.repeat(1001)]){widget.question.value=value;await widget.ask();assert.equal(sends,0);assert.equal(widget.error.hidden,false);}
  widget.question.value='Cette architecture convient-elle à mon objectif ?';await widget.ask();assert.equal(sends,1);assert.equal(widget.receipt,null);assert.equal(widget.answer,null);assert.equal(widget.question.value,'Cette architecture convient-elle à mon objectif ?');widget.destroy();
});

test('dictation and navigation are explicit, and localizing the component never translates personal questions or file paths',async()=>{
  const dictated=[],opened=[],f=fixture({onDictate:target=>dictated.push(target),onOpen:panel=>opened.push(panel)}),{widget,document}=f;
  widget.update(mission({files:[{path:'Mes images/Ingrid.svg'}],workDirectory:'/Mon SSD/Ingrid'}));widget.question.value='Où sont mes fichiers ?';await widget.ask();const originalQuestion=widget.question.value;
  assert.equal(dictated.length,0);await widget.dictateButton.click();assert.equal(dictated[0],widget.question);await widget.progressButton.click();await widget.filesButton.click();assert.deepEqual(opened,['progress','delivery']);
  for(const locale of['en','nl']){setLocale(locale);document.emit('oscar:language');assert.equal(widget.question.value,originalQuestion);assert.match(widget.replyText.textContent,/Mes images\/Ingrid.svg/u);assert.match(widget.replyText.textContent,/\/Mon SSD\/Ingrid/u);assert.notEqual(widget.heading.textContent,'Demandez à Oscar');}
  widget.destroy();await widget.progressButton.click();await widget.filesButton.click();assert.deepEqual(opened,['progress','delivery']);assert.equal(document.handlers.get('oscar:language').size,0);setLocale('fr');
});
