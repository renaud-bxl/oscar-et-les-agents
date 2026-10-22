import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Atelier,simpleCodePlan,validatePlan,PLAN_SCHEMA} from '../lib/orchestrator.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function until(check){for(let attempt=0;attempt<300;attempt++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Le travail attendu n’a pas commencé dans le scénario local simulé.');}
const roles=['recherche','analyse','design','redaction','code','recherche','analyse','design','code'];
const task=(role,index,dependsOn=[])=>({role,title:`Contribution ${index+1}`,instruction:`Produis uniquement apport-${index+1}.md ; respecte CONTRAT-INITIAL-TEST.`,criteria:'Le fichier utile existe et répond au brief.',deliverables:[`apport-${index+1}.md`],dependsOn});
const plan=(tasks=roles.map((role,index)=>task(role,index)))=>({title:'Équipe indépendante',approach:'Métiers en parallèle, contrôles réels.',sharedBrief:'CONTRAT-INITIAL-TEST : contributions séparées, aucun accès ni publication. Le résultat doit respecter les règles du brief initial.',tasks});
const requested=input=>JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);
function setup(t,{tasks,create,review,concurrency}={}){
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-parallel-'));let app;
  const calls=[];
  const runner=async input=>{
    calls.push(input);
    if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify(plan(tasks))};
    if(input.schema?.properties.reviews){const override=await review?.(input,app);return{text:JSON.stringify({reviews:override||requested(input).map(row=>({taskId:row.taskId,approved:true,feedback:'Contribution contrôlée dans ce scénario fictif.'}))})};}
    if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Livraison fictive contrôlée.'})};
    const mission=[...app.missions.values()].find(item=>input.cwd===app.workDir(item.id)||input.cwd.startsWith(app.workDir(item.id)+path.sep));
    const current=mission.tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
    if(!current)return{text:'Les contributions sont réunies dans ce rapport local simulé.'};
    assert.ok(input.prompt.includes('CONTRAT-INITIAL-TEST'));assert.ok(input.prompt.includes('RÉPARTITION DES CONTRIBUTIONS'));
    for(const file of current.deliverables)writeFileSync(path.join(input.cwd,file),`Contenu utile ${current.id}`);
    await create?.({input,mission,task:current,app});
    return{text:`Rapport utile de ${current.id}.`};
  };
  app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:runner,...(concurrency?{concurrency}:{})});
  t.after(async()=>{for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
  return{app,calls};
}

test('neuf spécialistes indépendants reçoivent le même brief et commencent avant le premier résultat ; intégration ensuite', {timeout:5000},async t=>{
  const barrier=defer(),started=[];
  const tasks=[...roles.map((role,index)=>task(role,index)),task('code',9,roles.map((_,index)=>`t${index+1}`))];
  const fixture=setup(t,{tasks,create:async({task:current,mission})=>{started.push(current.id);if(current.id!=='t10')await barrier.promise;else assert.ok(mission.tasks.slice(0,9).every(item=>item.status==='approved'));}});
  const initial=fixture.app.start({prompt:'Recrute neuf spécialistes indépendants puis un intégrateur pour ce dossier.'});
  try{await until(()=>started.length===9);const current=fixture.app.get(initial.id);assert.equal(current.tasks.filter(item=>item.status==='working').length,9);assert.equal(current.tasks.at(-1).status,'queued');assert.equal(fixture.app.specialistPool.active,9);assert.ok(!started.includes('t10'));assert.match(readFileSync(path.join(fixture.app.workDir(initial.id),'Brief-equipe.md'),'utf8'),/CONTRAT-INITIAL-TEST/);}
  finally{barrier.resolve();}
  const done=await fixture.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(started.length,10);assert.equal(new Set(started).size,10);assert.equal(fixture.app.specialistPool.active,0);assert.equal(fixture.app.specialistPool.pending,0);
});

test('un chercheur lent ne bloque ni le prochain indépendant ni le dépendant d’un collègue déjà validé', {timeout:5000},async t=>{
  const slow=defer(),started=[];
  const tasks=[task('recherche',0),task('analyse',1),task('design',2),task('code',3,['t2'])];
  const fixture=setup(t,{tasks,concurrency:2,create:async({task:current,mission})=>{started.push(current.id);if(current.id==='t1')await slow.promise;if(current.id==='t4')assert.equal(mission.tasks[1].status,'approved');}});
  const initial=fixture.app.start({prompt:'Travaux parallèles avec un vrai fichier préalable seulement pour le dernier.'});
  try{await until(()=>started.includes('t4'));const current=fixture.app.get(initial.id);assert.equal(current.tasks[0].status,'working');assert.equal(current.tasks[1].status,'approved');assert.equal(current.phase,'Les spécialistes poursuivent leurs contributions');assert.ok(started.includes('t3'));assert.equal(started.filter(id=>id==='t4').length,1);}
  finally{slow.resolve();}
  assert.equal((await fixture.app.wait(initial.id)).status,'completed');
});

test('les résultats arrivant pendant une revue sont contrôlés ensuite avec leurs propres identifiants exacts', {timeout:5000},async t=>{
  const second=defer(),reviewStarted=defer(),finishReview=defer(),batches=[];
  const fixture=setup(t,{tasks:[task('recherche',0),task('analyse',1)],create:async({task:current})=>{if(current.id==='t2')await second.promise;},review:async input=>{const ids=requested(input).map(row=>row.taskId);batches.push(ids);if(ids.includes('t1')){reviewStarted.resolve();await finishReview.promise;}}});
  const initial=fixture.app.start({prompt:'Deux contributions dont la seconde arrive durant le contrôle de la première.'});
  await reviewStarted.promise;second.resolve();await until(()=>fixture.app.get(initial.id).tasks[1].status==='reviewing');assert.deepEqual(batches,[['t1']]);finishReview.resolve();const done=await fixture.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.deepEqual(batches,[['t1'],['t2']]);assert.ok(done.tasks.every(item=>item.attempt===1));
});

test('le pool global limite les bureaux ensemble à vingt créations ; les spécialistes en attente ne tapent pas', {timeout:5000},async t=>{
  let active=0,peak=0,stopped=0;
  const fixture=setup(t,{create:async({input})=>{active++;peak=Math.max(peak,active);try{await new Promise((_,reject)=>{const abort=()=>{stopped++;reject(new Error('Arrêt simulé'));};input.signal.addEventListener('abort',abort,{once:true});if(input.signal.aborted)abort();});}finally{active--;}}});
  const missions=Array.from({length:3},(_,index)=>fixture.app.start({prompt:`Bureau indépendant ${index+1} et ses neuf spécialistes.`}));
  await until(()=>fixture.app.specialistPool.active===20&&fixture.app.specialistPool.pending===7);
  const visual=fixture.app.start({prompt:'Dessine une jolie carte avec le texte Bonjour.'});await until(()=>fixture.app.specialistPool.pending===8);assert.equal(fixture.app.get(visual.id).tasks[0].status,'queued');assert.equal(fixture.app.get(visual.id).tasks[0].attempt,0);
  assert.equal(peak,20);assert.equal(fixture.app.state().activeMissions.reduce((sum,item)=>sum+item.tasks.filter(current=>current.status==='working').length,0),20);assert.equal(fixture.app.state().activeMissions.reduce((sum,item)=>sum+item.tasks.filter(current=>current.status==='queued').length,0),8);
  for(const mission of [...missions,visual])fixture.app.stop(mission.id);const done=await Promise.all([...missions,visual].map(mission=>fixture.app.wait(mission.id)));assert.ok(done.every(item=>item.status==='cancelled'));assert.equal(stopped,20);assert.equal(active,0);assert.equal(fixture.app.specialistPool.active,0);assert.equal(fixture.app.specialistPool.pending,0);
});

test('annuler attend aussi un processus simulé qui rend tardivement avant de libérer la mission', {timeout:5000},async t=>{
  const finish=defer(),begun=defer();const fixture=setup(t,{tasks:[task('recherche',0),task('analyse',1)],create:async()=>{begun.resolve();await finish.promise;}});
  const initial=fixture.app.start({prompt:'Deux processus locaux simulés à arrêter proprement.'});await begun.promise;fixture.app.stop(initial.id);let settled=false;const waiting=fixture.app.wait(initial.id).then(value=>{settled=true;return value;});await tick();assert.equal(settled,false);assert.equal(fixture.app.runs.has(initial.id),true);finish.resolve();const done=await waiting;assert.equal(done.status,'cancelled');assert.equal(fixture.app.runs.has(initial.id),false);assert.ok(!done.tasks.some(item=>item.status==='approved'));assert.equal(fixture.app.specialistPool.active,0);
});

test('le petit jeu de fenêtres et trois objets au sol utilise le contrat local sans élargir aux projets en ligne',()=>{
  for(const prompt of ['Crée-moi un petit jeu où des objets tombent par les fenêtres. Si trois objets touchent le sol, c’est perdu.','Create a small game where objects fall from windows. Three objects on the ground and you lose.','Maak een klein spel met vallende voorwerpen uit vensters. Drie op de grond en je verliest.']){const result=simpleCodePlan({prompt,provider:'codex'});assert.ok(result,prompt);assert.ok(result.tasks.slice(0,-1).every(item=>item.dependsOn.length===0));assert.equal(result.tasks.at(-1).dependsOn.length,result.tasks.length-1);assert.match(result.sharedBrief,/var\(--game-accent/);assert.ok(validatePlan(JSON.stringify(result)));}
  for(const extra of [' Ajoute un mode multijoueur en ligne.',' Fais-le dans Unity.',' Avec une API de paiement.',' Déploie sur GitHub.'])assert.equal(simpleCodePlan({prompt:'Crée un petit jeu où des objets tombent des fenêtres, trois au sol et perdu.'+extra,provider:'codex'}),null);
  assert.throws(()=>validatePlan(JSON.stringify({...plan(),sharedBrief:'x'.repeat(16001)})),/brief commun/);assert.throws(()=>validatePlan(JSON.stringify({...plan(),sharedBrief:{authorization:true}})),/brief commun/);assert.ok(PLAN_SCHEMA.required.includes('sharedBrief'));
});

 test('un refus définitif bloque toute une chaîne de dépendances même lorsque le tableau est en ordre inverse', {timeout:5000},async t=>{
  const started=[];const fixture=setup(t,{tasks:[task('code',0,['t2']),task('analyse',1,['t3']),task('recherche',2)],create:async({task:current})=>started.push(current.id),review:async input=>requested(input).map(row=>({taskId:row.taskId,approved:false,feedback:'La source requise manque ; correction nécessaire.'}))});
  const initial=fixture.app.start({prompt:'Une chaîne de fichiers réellement nécessaires en ordre inverse.'});const done=await fixture.app.wait(initial.id);assert.equal(done.status,'needs_review',done.error);assert.deepEqual(done.tasks.map(item=>item.status),['blocked','blocked','needs_review']);assert.deepEqual(started,['t3','t3','t3']);assert.equal(done.recovery.used,1);assert.equal(done.recovery.cause.code,'MISSION_QUALITY_REVIEW');assert.ok(!done.tasks.some(item=>item.status==='queued'));assert.ok(!done.events.some(item=>item.kind==='success'));
});
