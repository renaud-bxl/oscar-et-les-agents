import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,realpath,rm,readdir,readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {MissionQuestions,missionQuestionSnapshot} from '../lib/mission-questions.mjs';

const NOW=Date.parse('2026-10-22T12:00:00Z');
const mission=(index=1)=>({id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,provider:'codex',title:'Un petit jeu',prompt:'Créer un jeu de rattrapage',status:'running',phase:'Les collègues travaillent.',tasks:[{id:'t1',role:'code',agentName:'Sam',title:'Le moteur',status:'working',attempt:1,report:'Le score est en cours.'}],files:[{path:'t1-code/index.html',size:220}],performance:{calls:[]},hiddenSecret:'NEVER_INCLUDE'});
const body=(m=mission(),requestId='question-0001',question='Où en est mon jeu ?')=>({mission:m,requestId,question,locale:'fr'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function fixture(t,options={}){
  const dataDir=await mkdtemp(path.join(await realpath(tmpdir()),'oscar-mission-questions-'));
  const calls=[],runner=options.runner|| (async input=>{calls.push(input);return{text:'Sam travaille encore. La livraison n’est pas validée.'};});
  const questions=new MissionQuestions({dataDir,now:()=>NOW,runner,...options});await questions.ready;
  t.after(async()=>{await questions.close().catch(()=>{});await rm(dataDir,{recursive:true,force:true});});
  return{dataDir,questions,calls};
}

test('model questions use an immutable bounded snapshot and a separate tool-free invocation',async t=>{
  const {questions,calls,dataDir}=await fixture(t),m=mission(),original=JSON.stringify(m);
  const answer=await questions.ask(body(m));
  assert.equal(JSON.stringify(m),original);assert.equal(calls.length,1);
  assert.deepEqual(Object.keys(calls[0]).sort(),['cwd','prompt','provider','readOnly','signal','snapshotOnly','timeoutMs'].sort());
  assert.equal(calls[0].provider,'codex');assert.equal(calls[0].cwd,path.join(dataDir,'mission-questions'));
  assert.equal(calls[0].readOnly,true);assert.equal(calls[0].snapshotOnly,true);assert.equal(calls[0].timeoutMs,90000);
  assert.ok(calls[0].prompt.includes('N’exécute aucun outil'));assert.ok(calls[0].prompt.includes('Le score est en cours.'));assert.equal(calls[0].prompt.includes('NEVER_INCLUDE'),false);
  assert.deepEqual(answer,{id:'question-0001',missionId:m.id,status:'completed',source:'model',asOf:NOW,answer:'Sam travaille encore. La livraison n’est pas validée.'});
  assert.deepEqual(await questions.get(m.id,'question-0001'),answer);assert.equal(questions.countActive,0);
  const files=await readdir(path.join(dataDir,'mission-questions'));assert.equal(files.length,1);
  const stored=await readFile(path.join(dataDir,'mission-questions',files[0]),'utf8');assert.equal(stored.includes('Où en est mon jeu ?'),false);assert.equal(stored.includes('NEVER_INCLUDE'),false);
});

test('concurrent duplicate clicks reuse one running answer, while changed content and a second question are rejected',async t=>{
  const gate=deferred(),started=deferred();let count=0;
  const {questions}=await fixture(t,{runner:async()=>{count++;started.resolve();return gate.promise;}}),m=mission();
  const first=questions.ask(body(m));await started.promise;
  assert.equal((await questions.get(m.id,'question-0001')).status,'running');assert.equal(questions.countActive,1);
  m.phase='Le travail a avancé depuis la question.';
  const second=questions.ask(body(m));
  await assert.rejects(questions.ask(body(m,'question-0001','Publie le jeu.')),{code:'QUESTION_REQUEST_CONFLICT'});
  await assert.rejects(questions.ask(body(m,'question-0002')),{code:'QUESTION_MISSION_BUSY'});
  gate.resolve('Je décris seulement l’instantané reçu.');
  assert.deepEqual(await first,await second);assert.equal(count,1);
  assert.equal((await questions.ask(body(m))).answer,'Je décris seulement l’instantané reçu.');assert.equal(count,1);
});

test('two global questions reserve their places before storage yields and GET never consumes a model call',async t=>{
  const gate=deferred(),started=deferred();let calls=0;
  const {questions}=await fixture(t,{runner:async()=>{if(++calls===2)started.resolve();return gate.promise;}});
  const one=questions.ask(body(mission(1))),two=questions.ask(body(mission(2)));await started.promise;
  assert.equal(questions.countActive,2);
  await assert.rejects(questions.ask(body(mission(3))),{code:'QUESTION_CAPACITY'});
  for(let index=0;index<10;index++)assert.equal((await questions.get(mission(1).id,'question-0001')).status,'running');
  await assert.rejects(questions.get(mission(3).id,'question-0001'),{code:'QUESTION_NOT_FOUND'});assert.equal(calls,2);
  gate.resolve('Réponse limitée aux faits.');await Promise.all([one,two]);assert.equal(questions.countActive,0);
});

test('provider errors retain their safe category, never expose raw diagnostics, and are never retried',async t=>{
  let calls=0;const {questions,dataDir}=await fixture(t,{runner:async()=>{calls++;throw Object.assign(new Error('SECRET token and raw engine log'),{code:'PROVIDER_AUTH_REQUIRED'});}});
  await assert.rejects(questions.ask(body()),error=>error.code==='PROVIDER_AUTH_REQUIRED'&&!error.message.includes('SECRET'));
  const receipt=await questions.get(mission().id,'question-0001');assert.equal(receipt.status,'failed');assert.equal(receipt.error.code,'PROVIDER_AUTH_REQUIRED');assert.equal(JSON.stringify(receipt).includes('SECRET'),false);
  await assert.rejects(questions.ask(body()),{code:'PROVIDER_AUTH_REQUIRED'});assert.equal(calls,1);assert.equal(questions.countActive,0);
  const files=await readdir(questions.directory);assert.equal((await readFile(path.join(questions.directory,files[0]),'utf8')).includes('SECRET'),false);
  await questions.close();const reopened=new MissionQuestions({dataDir,runner:async()=>{throw new Error('must not run');},now:()=>NOW});t.after(()=>reopened.close());await reopened.ready;
  assert.equal((await reopened.get(mission().id,'question-0001')).error.code,'PROVIDER_AUTH_REQUIRED');await assert.rejects(reopened.ask(body()),{code:'PROVIDER_AUTH_REQUIRED'});
});

test('a persisted running receipt becomes interrupted after restart without starting a model',async t=>{
  const {questions,dataDir}=await fixture(t);await questions.ask(body());await questions.close();
  const [name]=await readdir(questions.directory),file=path.join(questions.directory,name),row=JSON.parse(await readFile(file,'utf8'));row.status='running';delete row.answer;await writeFile(file,JSON.stringify(row));
  let calls=0;const reopened=new MissionQuestions({dataDir,runner:async()=>{calls++;return 'Never';},now:()=>NOW});t.after(()=>reopened.close());await reopened.ready;
  assert.equal((await reopened.get(mission().id,'question-0001')).error.code,'QUESTION_INTERRUPTED');
  await assert.rejects(reopened.ask(body()),{code:'QUESTION_INTERRUPTED'});assert.equal(calls,0);assert.equal(reopened.countActive,0);
});

test('invalid questions, paths, locales and providers cannot start a model or create receipts',async t=>{
  const {questions,calls}=await fixture(t);
  for(const request of [{...body(),question:''},{...body(),question:'x'.repeat(1001)},{...body(),question:'x\u0000y'},{...body(),requestId:'../../escape'},{...body(),locale:'xx'},{...body(),extra:true},{...body(),mission:{...mission(),id:'../../escape'}}])await assert.rejects(questions.ask(request),{code:'QUESTION_INVALID'});
  await assert.rejects(questions.ask(body({...mission(),provider:'demo'})),{code:'PROVIDER_UNAVAILABLE'});
  assert.equal(calls.length,0);assert.deepEqual(await readdir(questions.directory),[]);
});

test('snapshot content and model answers stay bounded without reading project files',async t=>{
  const m=mission();m.title='é'.repeat(20000);m.prompt='🎮'.repeat(20000);m.tasks=Array.from({length:200},(_,index)=>({id:'t'+index,role:'code',status:'working',agentName:'字'.repeat(10000),title:'jeu'.repeat(10000),activity:'a'.repeat(20000),report:'SECRET'.repeat(10000),review:{approved:false,feedback:'non'.repeat(10000)}}));m.files=Array.from({length:500},()=>({path:'dossier/'+ 'é'.repeat(2000),size:40}));
  const snapshot=missionQuestionSnapshot(m,NOW);assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<=32000);assert.equal(snapshot.tasks.length,20);assert.equal(snapshot.contributions.total,200);assert.equal(snapshot.contributions.counted,100);assert.equal(snapshot.limits.tasksOmitted,180);assert.equal(snapshot.limits.filesOmitted,470);
  const {questions}=await fixture(t,{runner:async()=>({text:'x'.repeat(12001)})});await assert.rejects(questions.ask(body()),{code:'QUESTION_INVALID_RESPONSE'});assert.equal((await questions.get(mission().id,'question-0001')).status,'failed');
});

test('a storage failure before dispatch releases capacity without starting a model',async t=>{
  const {questions,calls}=await fixture(t);questions.save=async()=>{throw new Error('private disk path');};
  await assert.rejects(questions.ask(body()),{code:'QUESTION_STORAGE'});assert.equal(calls.length,0);assert.equal(questions.countActive,0);assert.equal(questions.receipts.size,0);
  await assert.rejects(questions.get(mission().id,'question-0001'),{code:'QUESTION_NOT_FOUND'});
});

test('a failure saving the answer cannot return success or silently dispatch the same question again',async t=>{
  const {questions,calls}=await fixture(t),save=questions.save.bind(questions);let writes=0;
  questions.save=async row=>{if(++writes>1)throw new Error('private disk path');return save(row);};
  await assert.rejects(questions.ask(body()),{code:'QUESTION_STORAGE'});assert.equal(calls.length,1);
  assert.equal((await questions.get(mission().id,'question-0001')).error.code,'QUESTION_STORAGE');
  await assert.rejects(questions.ask(body()),{code:'QUESTION_STORAGE'});assert.equal(calls.length,1);assert.equal(questions.countActive,0);
});

test('closing aborts and waits for the active runner, persists failure, and refuses new requests',async t=>{
  const started=deferred(),aborted=deferred(),release=deferred();
  const {questions}=await fixture(t,{runner:async({signal})=>{started.resolve();signal.addEventListener('abort',()=>aborted.resolve(),{once:true});await release.promise;throw Object.assign(new Error('private abort log'),{name:'AbortError'});}});
  const asking=questions.ask(body()).catch(error=>error);await started.promise;
  let closed=false;const closing=questions.close().then(()=>{closed=true;});await aborted.promise;assert.equal(closed,false);assert.equal(questions.countActive,1);
  await assert.rejects(questions.ask(body(mission(2))),{code:'QUESTION_CLOSED'});
  release.resolve();assert.equal((await asking).code,'QUESTION_CANCELLED');await closing;assert.equal(questions.countActive,0);
  assert.equal((await questions.get(mission().id,'question-0001')).error.code,'QUESTION_CANCELLED');
});

test('a bounded timeout aborts the runner and discards a late answer without retrying',async t=>{
  let aborted=false,calls=0;
  const {questions}=await fixture(t,{timeoutMs:20,runner:async({signal,timeoutMs})=>{calls++;assert.equal(timeoutMs,20);await new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true});setTimeout(resolve,100);});return 'A late answer';}});
  await assert.rejects(questions.ask(body()),{code:'QUESTION_TIMEOUT'});assert.equal(aborted,true);assert.equal(calls,1);assert.equal((await questions.get(mission().id,'question-0001')).error.code,'QUESTION_TIMEOUT');
});

test('completed receipts survive reload and the bounded history refuses additional calls',async t=>{
  const {questions,dataDir,calls}=await fixture(t,{maxReceipts:1});const first=await questions.ask(body());
  await assert.rejects(questions.ask(body(mission(2))),{code:'QUESTION_HISTORY_FULL'});assert.equal(calls.length,1);await questions.close();
  let restartedCalls=0;const reopened=new MissionQuestions({dataDir,maxReceipts:1,now:()=>NOW,runner:async()=>{restartedCalls++;return 'new';}});t.after(()=>reopened.close());await reopened.ready;
  assert.deepEqual(await reopened.ask(body()),first);assert.deepEqual(await reopened.get(mission().id,'question-0001'),first);assert.equal(restartedCalls,0);
});

test('symlinked receipt storage is refused instead of reading or writing outside the question directory',async t=>{
  const dataDir=await mkdtemp(path.join(await realpath(tmpdir()),'oscar-question-links-')),outside=await mkdtemp(path.join(await realpath(tmpdir()),'oscar-question-outside-'));t.after(async()=>{await rm(dataDir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
  await symlink(outside,path.join(dataDir,'mission-questions'));
  const questions=new MissionQuestions({dataDir,runner:async()=>{throw new Error('must not run');}});await assert.rejects(questions.ready,{code:'QUESTION_STORAGE'});await questions.close().catch(()=>{});assert.deepEqual(await readdir(outside),[]);
});

test('a symlink in place of an actual receipt is refused before its contents are read',async t=>{
  const {questions,dataDir}=await fixture(t);await questions.ask(body());await questions.close();
  const [name]=await readdir(questions.directory),file=path.join(questions.directory,name),outside=path.join(dataDir,'outside-secret.json');await writeFile(outside,'SECRET');await rm(file);await symlink(outside,file);
  const reopened=new MissionQuestions({dataDir,runner:async()=>{throw new Error('must not run');}});await assert.rejects(reopened.ready,{code:'QUESTION_STORAGE'});await reopened.close().catch(()=>{});assert.equal(await readFile(outside,'utf8'),'SECRET');
});
