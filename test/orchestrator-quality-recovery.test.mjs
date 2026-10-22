import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Atelier,PLAN_SCHEMA} from '../lib/orchestrator.mjs';

function setup(t,{acceptReview=4,creationError,account=false}={}){
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-quality-recovery-')),trace=[];let app,reviews=0;
 const tasks=[{role:'recherche',title:'Relever les règles',instruction:'Produis regles.md',criteria:'Les règles sont précises.',deliverables:['regles.md'],dependsOn:[]},
  {role:'code',title:'Consommer les règles approuvées',instruction:'Produis resultat.md',criteria:'La contribution validée est utilisée.',deliverables:['resultat.md'],dependsOn:['t1']}];
 const runAgent=async input=>{
  if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify({title:'Une correction contrôlée',approach:'Contrôles et corrections bornés.',sharedBrief:'Données de test uniquement.',tasks})};
  if(input.schema?.properties.reviews){
   const requested=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);
   return{text:JSON.stringify({reviews:requested.map(row=>{trace.push({kind:'review',id:row.taskId});return{taskId:row.taskId,approved:row.taskId!=='t1'||++reviews>=acceptReview,feedback:'Avis simulé : la règle nécessite une précision, sans accès ni outil supplémentaire.'};})})};
  }
  if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Contrôle final fictif favorable.'})};
  const mission=[...app.missions.values()].find(item=>input.cwd===app.workDir(item.id)||input.cwd.startsWith(app.workDir(item.id)+path.sep));
  const task=mission.tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
  if(!task)return{text:'Bilan fictif des contributions.'};
  trace.push({kind:'creation',id:task.id});if(account)mission.connectorRequired=true;
  if(creationError)throw Object.assign(new Error('Échec de fournisseur simulé.'),creationError);
  writeFileSync(path.join(input.cwd,task.deliverables[0]),`Contenu local ${task.id}, passage ${task.attempt}.`);
  return{text:'Rapport local fictif, aucun test de jeu revendiqué.'};
 };
 app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent});
 t.after(async()=>{for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
 return{app,trace};
}

test('Oscar makes one backed-up quality recovery, genuinely reviews existing work, then spends at most one further writing attempt',async t=>{
 const {app,trace}=setup(t),initial=app.start({prompt:'Recrute une équipe pour une mission à vérifier.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.equal(done.recovery.used,1);assert.equal(done.recovery.mode,'automatic');assert.equal(done.recovery.cause.code,'MISSION_QUALITY_REVIEW');
 assert.equal(trace.filter(item=>item.kind==='creation'&&item.id==='t1').length,3);
 assert.equal(trace.filter(item=>item.kind==='review'&&item.id==='t1').length,4,'The salvage review is genuine and cannot silently approve the previous refusal.');
 assert.equal(trace.filter(item=>item.kind==='creation'&&item.id==='t2').length,1);
 assert.equal(done.tasks[0].review.approved,true);assert.equal(done.tasks[0].attempt,3);assert.equal(done.tasks[0].recoveryWriteRemaining,0);
 const backup=path.join(app.missionDir(done.id),'recovery','attempt-1');assert.ok(existsSync(path.join(backup,'previous-state.json')));
 assert.equal(readFileSync(path.join(backup,'files','t1-recherche','regles.md'),'utf8'),'Contenu local t1, passage 2.');
});

test('a repeated quality refusal stops after that one recovery with no success claim or automatic second wave',async t=>{
 const {app,trace}=setup(t,{acceptReview:Infinity}),initial=app.start({prompt:'Recrute une équipe pour un contrôle exigeant.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'needs_review',done.error);assert.equal(done.recovery.used,1);assert.equal(done.recovery.canResume,false);
 assert.equal(trace.filter(item=>item.kind==='creation'&&item.id==='t1').length,3);assert.equal(trace.filter(item=>item.kind==='review'&&item.id==='t1').length,4);
 assert.equal(trace.some(item=>item.kind==='creation'&&item.id==='t2'),false);assert.equal(done.events.some(event=>event.kind==='success'),false);
});

for(const code of ['PROVIDER_AUTH_REQUIRED','PROVIDER_PERMISSION_REQUIRED','PROVIDER_USAGE_LIMIT','PROVIDER_TOOL_UNAVAILABLE'])test(`quality recovery never retries ${code}`,async t=>{
 const {app,trace}=setup(t,{creationError:{code,recoverable:false}}),initial=app.start({prompt:'Recrute une équipe pour une mission bornée.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'failed');assert.equal(done.errorInfo.code,code);assert.equal(done.recovery.used,0);assert.equal(trace.filter(item=>item.kind==='creation').length,1);
});

test('missions attached to a private account remain excluded from automatic quality recovery',async t=>{
 const {app,trace}=setup(t,{account:true,acceptReview:Infinity}),initial=app.start({prompt:'Recrute une équipe pour ce scénario protégé.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'needs_review');assert.equal(done.recovery.used,0);assert.equal(trace.filter(item=>item.kind==='creation'&&item.id==='t1').length,2);
});

test('assembly uses bounded excerpts and real report paths instead of embedding twenty complete 60,000-character reports',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-bounded-assembly-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let app,assemblyPrompt;
 const roles=['recherche','analyse','design','redaction','code'];
 const tasks=roles.flatMap(role=>Array.from({length:4},(_,index)=>({role,title:`Contribution ${role} ${index}`,instruction:'Produire le rapport local.',criteria:'Le fichier existe.',deliverables:[`rapport-${role}-${index}.md`],dependsOn:[]})));
 const runner=async input=>{
  if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify({title:'Vingt rapports bornés',approach:'Rapports locaux.',sharedBrief:'Même contexte pour tous.',tasks})};
  if(input.schema?.properties.reviews){const rows=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);return{text:JSON.stringify({reviews:rows.map(row=>({taskId:row.taskId,approved:true,feedback:'Fichier fictif contrôlé.'}))})};}
  if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Assemblage fictif contrôlé.'})};
  const mission=[...app.missions.values()][0],task=mission.tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
  if(task){writeFileSync(path.join(input.cwd,task.deliverables[0]),'Contenu fictif.');return{text:`Rapport ${task.id} : `+'donnée '.repeat(10000)+'MARQUEUR_HORS_EXTRAIT'};}
  assemblyPrompt=input.prompt;return{text:'Assemblage fictif.'};
 };
 app=new Atelier({dataDir,runAgent:runner,providers:[{id:'codex',available:true}]});
 const initial=app.start({prompt:'Recrute vingt agents, quatre de chaque métier.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.ok(assemblyPrompt.length<100000,`Assembly prompt length: ${assemblyPrompt.length}`);
 for(const task of done.tasks){assert.ok(assemblyPrompt.includes(`Rapports/${task.id}-${task.role}.md`));assert.ok(readFileSync(path.join(app.workDir(done.id),'Rapports',`${task.id}-${task.role}.md`),'utf8').length>60000);}
 assert.equal(assemblyPrompt.includes('MARQUEUR_HORS_EXTRAIT'),false);
});
