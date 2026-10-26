import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Atelier,PLAN_SCHEMA} from '../lib/orchestrator.mjs';
const plan={title:'Modèle parlementaire',approach:'Préparer puis vérifier le modèle.',sharedBrief:'Document local, structure claire et champs à compléter. Aucun fait ni source inventé.',tasks:[{role:'redaction',title:'Créer le modèle',instruction:'Créer modele.md avec les rubriques et champs.',criteria:'Le modèle existe et les champs sont explicites.',deliverables:['modele.md'],dependsOn:[]}]};
function fixture(t,{planning,review}={}){
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-planning-format-')),calls=[];let app;
  const runner=async input=>{
    calls.push(input);
    if(input.schema===PLAN_SCHEMA){const override=await planning?.(input,calls);return{text:override??JSON.stringify(plan)};}
    if(input.schema?.properties.reviews){const rows=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]),override=await review?.(input,calls);let verdict;try{verdict=JSON.parse(override);}catch{}return{text:override&&!verdict?.feedback?override:JSON.stringify({reviews:rows.map(row=>({taskId:row.taskId,approved:verdict?.approved??true,feedback:verdict?.feedback??'Contribution relue réellement dans ce scénario simulé.'}))})};}
    if(input.schema?.properties.approved){const override=await review?.(input,calls);return{text:override??JSON.stringify({approved:true,feedback:'Rubriques vérifiées dans ce scénario simulé.'})};}
    if(path.basename(input.cwd)==='t1-redaction'){writeFileSync(path.join(input.cwd,'modele.md'),'# Question parlementaire\n\n## Objet\nÀ compléter\n## Question\nÀ compléter');return{text:'Le modèle textuel local est prêt.'};}
    return{text:'# Modèle parlementaire\n\nObjet, contexte vérifié et questions à compléter. Fichier : t1-redaction/modele.md.'};
  };
  app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:runner});
  t.after(async()=>{for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
  return{app,calls};
}
test('un plan invalide est redemandé une fois avant toute création de document',async t=>{
  let count=0;const f=fixture(t,{planning:()=>++count===1?JSON.stringify({...plan,tasks:[]}):undefined});
  const done=await f.app.wait(f.app.start({prompt:'Une belle mise en page pour mes questions parlementaires.'}).id);
  assert.equal(done.status,'completed',done.error);assert.equal(count,2);
  assert.equal(f.calls.filter(input=>path.basename(input.cwd)==='t1-redaction').length,1);
  assert.ok(f.calls.filter(input=>input.schema===PLAN_SCHEMA).every(input=>input.readOnly===true&&input.connectorPlan===undefined));
});
test('un plan illisible persistant reste reprenable explicitement, sans dossier en double ni remise à zéro',async t=>{
  let broken=true;const f=fixture(t,{planning:()=>broken?'**Voici un modèle agréable**':undefined});
  const first=await f.app.wait(f.app.start({prompt:'Préparer un modèle pour mes questions parlementaires.'}).id);
  assert.equal(first.status,'failed');assert.equal(first.errorInfo.code,'MISSION_PLAN_FORMAT');assert.equal(first.tasks.length,0);
  assert.equal(f.calls.length,2);assert.equal(first.recovery.used,0);assert.equal(first.recovery.canResume,true);
  const folder=first.workDirectory;broken=false;f.app.resume(first.id);assert.throws(()=>f.app.resume(first.id));
  const done=await f.app.wait(first.id);assert.equal(done.status,'completed',done.error);assert.equal(done.id,first.id);assert.equal(done.workDirectory,folder);assert.equal(done.recovery.used,1);
  assert.ok(existsSync(path.join(f.app.missionDir(first.id),'recovery/attempt-1/previous-state.json')));
  assert.equal(done.tasks[0].attempt,1);
});
test('l’ancienne erreur de plan vide devient reprenable, mais les erreurs de compte restent exclues',t=>{
  const f=fixture(t),m={id:'legacy-empty-plan',status:'failed',provider:'codex',title:'Modèle',prompt:'Préparer un modèle',createdAt:1,updatedAt:2,tasks:[],files:[],events:[],result:'',error:'Oscar n’a pas fourni un plan valide (1 à 20 tâches).',errorInfo:{code:'MISSION_INTERRUPTED',recoverable:false},performance:{calls:[{stage:'planning',status:'completed'}]}};
  f.app.missions.set(m.id,m);assert.equal(f.app.recoveryAvailability(m).canResume,true);
  m.errorInfo.code='PROVIDER_USAGE_LIMIT';assert.equal(f.app.recoveryAvailability(m).canResume,false);
  m.errorInfo.code='MISSION_INTERRUPTED';m.connectorRequired=true;assert.equal(f.app.recoveryAvailability(m).canResume,false);
  delete m.connectorRequired;m.files=[{path:'inattendu.txt',size:2}];assert.equal(f.app.recoveryAvailability(m).canResume,false);
});
test('les revues ordinaires et finales corrigent leur format sans régénérer les fichiers',async t=>{
  const failed=new Set();const f=fixture(t,{review:input=>{const stage=input.prompt.includes('contrôle final')?'final':'task';if(!failed.has(stage)){failed.add(stage);return 'Contrôle terminé.';}}});
  const done=await f.app.wait(f.app.start({prompt:'Préparer un modèle textuel parlementaire.'}).id);
  assert.equal(done.status,'completed',done.error);assert.equal(failed.size,2);
  assert.equal(done.tasks[0].attempt,1);assert.equal(f.calls.filter(input=>input.schema?.properties.approved).length,4);
});
test('un vrai refus est conservé et une permission de planning ne déclenche pas de nouvel essai',async t=>{
  const denied=fixture(t,{planning:()=>{throw Object.assign(new Error('Permission refusée.'),{code:'PROVIDER_PERMISSION_REQUIRED'});}});
  const stopped=await denied.app.wait(denied.app.start({prompt:'Préparer un modèle.'}).id);assert.equal(stopped.status,'failed');assert.equal(denied.calls.length,1);assert.equal(stopped.recovery.canResume,false);
  const refused=fixture(t,{review:()=>JSON.stringify({approved:false,feedback:'Le contenu ne répond pas encore aux critères.'})});
  const done=await refused.app.wait(refused.app.start({prompt:'Préparer un modèle de texte.'}).id);assert.equal(done.status,'needs_review');assert.ok(done.tasks.every(task=>task.status!=='approved'));
  assert.equal(refused.calls.filter(input=>input.schema?.properties.approved).length,2);
});
