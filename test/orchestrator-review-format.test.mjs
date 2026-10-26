import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Atelier,PLAN_SCHEMA} from '../lib/orchestrator.mjs';

const plan={title:'Petit puzzle',approach:'Deux apports indépendants puis intégration.',sharedBrief:'Même brief pour tous, apports locaux sans compte ni publication.',tasks:[
  {role:'recherche',title:'Règles',instruction:'Fournis notes.md.',criteria:'Fichier utile.',deliverables:['notes.md'],dependsOn:[]},
  {role:'design',title:'Graphisme',instruction:'Fournis notes.md.',criteria:'Fichier utile.',deliverables:['notes.md'],dependsOn:[]},
  {role:'code',title:'Assemblage',instruction:'Intègre les apports dans notes.md.',criteria:'Fichier utile.',deliverables:['notes.md'],dependsOn:['t1','t2']},
]};
const rows=input=>JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);
function fixture(t,{review,create}={}){
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-review-format-')),calls=[];let app;
  const runner=async input=>{
    calls.push(input);
    if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify(plan)};
    if(input.schema?.properties.reviews){const result=await review?.(input,app);return{text:result??JSON.stringify({reviews:rows(input).map(row=>({taskId:row.taskId,approved:true,feedback:'Fichier réellement présent dans le scénario simulé.'}))})};}
    if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Contrôle final simulé.'})};
    const mission=[...app.missions.values()][0],task=mission.tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
    if(task){await create?.(input,task);writeFileSync(path.join(input.cwd,'notes.md'),`Apport réel ${task.id}`);return{text:`Rapport de ${task.id}`};}
    return{text:'Assemblage simulé des trois notes.'};
  };
  app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:runner});
  t.after(async()=>{for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
  return{app,calls};
}
test('une erreur de format de revue est corrigée une fois sans régénérer une contribution',async t=>{
  let invalid=true;const f=fixture(t,{review:()=>{if(invalid){invalid=false;return '**t1 : Validation**';}}});
  const done=await f.app.wait(f.app.start({prompt:'Préparer des notes de contrôle.'}).id);
  assert.equal(done.status,'completed',done.error);
  assert.equal(done.tasks[0].attempt,1);assert.equal(done.tasks[1].attempt,1);
  assert.ok(done.events.some(row=>row.text.includes('uniquement le format')));
  assert.equal(done.recovery.used,0);
});
test('le code de format du moteur est repris une fois, mais une permission arrête sans nouvel appel',async t=>{
  for(const code of ['PROVIDER_STRUCTURED_OUTPUT_INVALID','PROVIDER_PERMISSION_REQUIRED'])await t.test(code,async t=>{
    let failed=false;const f=fixture(t,{review:()=>{if(!failed){failed=true;throw Object.assign(new Error('Erreur simulée.'),{code});}}});
    const done=await f.app.wait(f.app.start({prompt:'Vérification du format sans élargir les permissions.'}).id);
    const reviews=f.calls.filter(input=>input.schema?.properties.reviews);
    if(code==='PROVIDER_PERMISSION_REQUIRED'){assert.equal(done.status,'failed');assert.equal(done.errorInfo.code,code);assert.equal(reviews.length,1);}
    else{assert.equal(done.status,'completed',done.error);assert.ok(reviews.length>=2);assert.equal(done.tasks[0].attempt,1);}
  });
});
test('une revue illisible persistante laisse le collègue indépendant terminer et ne devient pas un refus métier',async t=>{
  let release,started;const held=new Promise(resolve=>{release=resolve;}),running=new Promise(resolve=>{started=resolve;});
  const f=fixture(t,{create:async(input,task)=>{if(task.id==='t2'){started();await held;assert.equal(input.signal.aborted,false);}},review:input=>rows(input).some(row=>row.taskId==='t1')?'**t1 : Validation**':undefined});
  const initial=f.app.start({prompt:'Contributions indépendantes et vrai dépendant.'});await running;
  for(let n=0;n<300&&!f.app.get(initial.id).tasks[0].runtimeError;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.app.get(initial.id).tasks[0].runtimeError?.code,'MISSION_REVIEW_FORMAT');release();
  const done=await f.app.wait(initial.id);assert.equal(done.status,'needs_review');
  assert.equal(done.tasks[1].status,'approved');assert.equal(done.tasks[0].attempt,1);
  assert.equal(done.tasks[2].status,'blocked');assert.equal(done.tasks[2].attempt,0);
  assert.equal(f.calls.filter(input=>input.schema?.properties.reviews&&rows(input).some(row=>row.taskId==='t1')).length,2);
  assert.equal(done.recovery.used,0);assert.equal(f.app.specialistPool.active,0);
});
function oldFailure(f){
  const m={id:'old-review-failure',prompt:'Ancien petit puzzle',title:'Puzzle conservé',provider:'codex',status:'failed',phase:'La mission demande ton attention',createdAt:1,updatedAt:2,events:[],result:'',files:[],error:'Unexpected token \'*\', "**t1 : Val"... is not valid JSON',errorInfo:{code:'MISSION_INTERRUPTED',provider:'codex',action:'review-output',recoverable:false},tasks:plan.tasks.map((task,index)=>({...structuredClone(task),id:`t${index+1}`,agentName:['Lina','Alma','Sam'][index],attempt:index===2?0:1,status:index===2?'blocked':'failed',report:'Fichier partiel conservé.',review:null,recoveryMode:index===2?'repair':'salvage',recoveryWriteRemaining:index===2?1:0})),sharedBrief:plan.sharedBrief,performance:{calls:[{agent:'Oscar',stage:'review',status:'completed'}]},recovery:{used:1,rechecksUsed:1}};
  f.app.missions.set(m.id,m);for(const task of m.tasks){const cwd=path.join(f.app.workDir(m.id),`${task.id}-${task.role}`);mkdirSync(cwd,{recursive:true});if(task.attempt)writeFileSync(path.join(cwd,'notes.md'),`Apport conservé ${task.id}`);}
  f.app.save(m);return m;
}
test('une relecture technique unique prouvée préserve les budgets et les fichiers, puis démarre le dépendant jamais lancé',async t=>{
  const f=fixture(t),m=oldFailure(f),before=readFileSync(path.join(f.app.workDir(m.id),'t1-recherche/notes.md'),'utf8');
  assert.equal(f.app.get(m.id).recovery.canRecheck,true);f.app.recheck(m.id);assert.throws(()=>f.app.recheck(m.id));
  const done=await f.app.wait(m.id);assert.equal(done.status,'completed',done.error);
  assert.equal(done.recovery.used,1);assert.equal(done.recovery.rechecksUsed,1);assert.equal(done.recovery.reviewFormatRecheck.used,1);
  assert.equal(done.tasks[0].attempt,1);assert.equal(done.tasks[0].recoveryWriteRemaining,0);assert.equal(done.tasks[2].attempt,1);
  assert.equal(readFileSync(path.join(f.app.workDir(m.id),'t1-recherche/notes.md'),'utf8'),before);
  assert.equal(f.calls.filter(input=>/t[12]-/u.test(path.basename(input.cwd))).length,0);
  assert.equal(f.app.get(m.id).recovery.canRecheck,false);
});
test('la relecture de format refuse un fichier incomplet, une permission et un changement après réservation',async t=>{
  const f=fixture(t),m=oldFailure(f),file=path.join(f.app.workDir(m.id),'t1-recherche/notes.md');
  const bytes=readFileSync(file);writeFileSync(file,'');assert.equal(f.app.reviewFormatRecheckProof(m),null);writeFileSync(file,bytes);
  m.errorInfo.code='PROVIDER_PERMISSION_REQUIRED';assert.equal(f.app.reviewFormatRecheckProof(m),null);m.errorInfo.code='MISSION_INTERRUPTED';
  f.app.recheck(m.id);writeFileSync(file,'Modification concurrente');
  const done=await f.app.wait(m.id);assert.equal(done.status,'failed');assert.equal(done.errorInfo.code,'MISSION_RECHECK_FORMAT_CHANGED');assert.equal(f.calls.length,0);
});
test('une erreur de format ne réouvre pas le refus métier définitif d’un autre spécialiste',t=>{
  const f=fixture(t),m=oldFailure(f);
  m.status='needs_review';m.error=null;m.errorInfo={code:'MISSION_REVIEW_FORMAT'};
  m.tasks[0].status='needs_review';m.tasks[0].runtimeError={code:'MISSION_REVIEW_FORMAT',stage:'review'};
  m.tasks[1].status='needs_review';m.tasks[1].review={approved:false,feedback:'Les règles ne correspondent pas à la demande après deux corrections.'};
  assert.equal(f.app.reviewFormatRecheckProof(m),null);assert.equal(f.app.recoveryAvailability(m).canRecheck,false);
  assert.equal(f.calls.length,0);
});
