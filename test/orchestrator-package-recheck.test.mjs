import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Atelier,PLAN_SCHEMA} from '../lib/orchestrator.mjs';
import {captureContributionPackage} from '../lib/contribution-package.mjs';
import {preserveRecoveryFiles} from '../lib/mission-recovery.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function fixture(t){
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-package-policy-recheck-')),trace=[];let app,gate=null,deny=false;
 const svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>',renderer='export const sprite=new URL("../assets/building.svg",import.meta.url).href;export const fallback=true;';
 const task=(role,title,deliverables,dependsOn=[])=>({role,title,instruction:title,criteria:'Fichiers du périmètre présents ; contrôles honnêtes.',deliverables,dependsOn});
 const tasks=[task('design','Créer le décor',['assets/building.svg']),task('code','Développer le rendu Canvas',['js/renderer.js','tests/rendu.html']),task('code','Assembler le jeu complet',['index.html','js/main.js'],['t1','t2']),task('analyse','Vérifier le résultat',['recette.md'],['t3'])];
 const runner=async input=>{
  if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify({title:'Ancien refus technique du rendu',approach:'Contributions puis contrôles réels.',sharedBrief:'Faux moteur local, aucune connexion ni partie réelle.',tasks})};
  if(input.schema?.properties.reviews){
   const rows=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);for(const row of rows)trace.push({kind:'review',id:row.taskId,readOnly:input.readOnly});
   if(gate&&rows.some(row=>row.taskId==='t2')){gate.started.resolve();await gate.release.promise;}
   return{text:JSON.stringify({reviews:rows.map(row=>({taskId:row.taskId,approved:!(deny&&row.taskId==='t2'),feedback:deny?'Le composant ne satisfait toujours pas le critère.':'Contrôle simulé favorable après lecture du périmètre.'}))})};
  }
  if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Contrôle final fictif, aucun gameplay réellement essayé.'})};
  const current=[...app.missions.values()][0].tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
  if(!current){trace.push({kind:'assembly'});return{text:'Bilan fictif de la livraison.'};}
  trace.push({kind:'creation',id:current.id});
  const write=(file,value)=>{mkdirSync(path.dirname(path.join(input.cwd,file)),{recursive:true});writeFileSync(path.join(input.cwd,file),value);};
  if(current.id==='t1')write('assets/building.svg',svg);
  if(current.id==='t2'){write('js/renderer.js',renderer);write('tests/rendu.html','<script type="module">import {fallback} from "../js/renderer.js";</script>');}
  if(current.id==='t3'){
   write('assets/building.svg',readFileSync(path.join(input.cwd,'Contributions/t1-design/assets/building.svg')));write('js/renderer.js',readFileSync(path.join(input.cwd,'Contributions/t2-code/js/renderer.js')));
   write('index.html','<script type="module" src="js/main.js"></script>');write('js/main.js','import "./renderer.js";');
  }
  if(current.id==='t4')write('recette.md','Le scénario vérifie la transmission du paquet, sans revendiquer de vrai test de jeu.');
  return{text:'Rapport fictif local.'};
 };
 app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:runner});
 t.after(async()=>{gate?.release.resolve();for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
 const initial=app.start({prompt:'Recrute une équipe pour ce scénario de composant et de contrôle.'}),first=await app.wait(initial.id);assert.equal(first.status,'completed',first.error);
 const m=app.missions.get(initial.id);m.status='needs_review';m.phase='Oscar demande une reprise';m.error=null;m.errorInfo=null;
 const component=m.tasks[1],cwd=path.join(app.workDir(m.id),'t2-code');
 const strict=captureContributionPackage({deliverables:component.deliverables,readFile:file=>{try{const bytes=readFileSync(path.join(cwd,file));return{bytes,hash:'fixture'};}catch{return null;}}});
 assert.deepEqual(strict.issues,['Ressource locale absente ou invalide : assets/building.svg']);
 component.status='needs_review';component.attempt=3;component.recoveryMode='salvage';component.recoveryWriteRemaining=0;component.review={approved:false,materialFailure:true,feedback:`Fichiers obligatoires absents, invalides ou modifiés pendant le contrôle : ${strict.issues.join(', ')}.`};
 for(const row of m.tasks.slice(2)){row.status='blocked';row.recoveryMode='salvage';row.recoveryWriteRemaining=1;row.review={approved:false,feedback:'Une contribution nécessaire n’a pas été validée par Oscar.'};}
 const backup=preserveRecoveryFiles({missionDirectory:app.missionDir(m.id),workDirectory:app.workDir(m.id),state:m}),recheck=preserveRecoveryFiles({missionDirectory:app.missionDir(m.id),workDirectory:app.workDir(m.id),state:m,name:'manual-recheck-1'});
 m.recovery={used:1,rechecksUsed:1,backup,recheck:{startedAt:1,backup:recheck,taskIds:['t2','t3','t4']}};app.save(m);trace.length=0;
 return{app,m,trace,dataDir,runner,setDeny:value=>{deny=value;},setGate:()=>{gate={started:deferred(),release:deferred()};return gate;}};
}

test('the package-policy-v2 recheck reserves one durable receipt and genuinely rereads the blocked chain without resetting any budget',async t=>{
 const f=await fixture(t),{app,m,trace}=f,gate=f.setGate(),oldRecheck=structuredClone(m.recovery.recheck),work=app.workDir(m.id),renderer=readFileSync(path.join(work,'t2-code/js/renderer.js'));
 assert.deepEqual(app.packagePolicyRecheckCandidates(m),['t2']);assert.equal(app.get(m.id).recovery.canRecheck,true);assert.equal(app.get(m.id).recovery.packagePolicyRechecksUsed,0);
 const accepted=app.recheck(m.id);assert.equal(accepted.recovery.packagePolicyRechecksUsed,1);assert.equal(accepted.recovery.packagePolicyRecheck.version,'package-policy-v2');assert.equal(accepted.recovery.used,1);assert.equal(accepted.recovery.rechecksUsed,1);
 const reserved=JSON.parse(readFileSync(path.join(app.missionDir(m.id),'state.json'),'utf8'));assert.equal(reserved.recovery.packagePolicyRecheck.used,1);assert.ok(Number.isInteger(reserved.recovery.packagePolicyRecheck.startedAt));
 assert.throws(()=>app.recheck(m.id),{code:'MISSION_RECHECK_UNAVAILABLE'});await gate.started.promise;assert.deepEqual(trace,[{kind:'review',id:'t2',readOnly:true}]);assert.equal(m.tasks[1].status,'reviewing');assert.equal(m.tasks[1].recoveryWriteRemaining,0);
 gate.release.resolve();const done=await app.wait(m.id);
 assert.equal(done.status,'completed',done.error);assert.equal(done.workDirectory,work);assert.deepEqual(trace.filter(row=>row.kind==='review').map(row=>row.id),['t2','t3','t4']);assert.equal(trace.some(row=>row.kind==='creation'),false);
 assert.equal(done.recovery.used,1);assert.equal(done.recovery.rechecksUsed,1);assert.equal(done.recovery.packagePolicyRechecksUsed,1);assert.equal(done.recovery.canRecheck,false);assert.deepEqual(done.recovery.recheck,oldRecheck);
 assert.deepEqual(done.tasks.slice(1).map(row=>row.recoveryWriteRemaining),[0,1,1]);assert.equal(done.tasks[1].attempt,3);assert.deepEqual(readFileSync(path.join(work,'t2-code/js/renderer.js')),renderer);
 assert.equal(done.tasks[3].inputContributions[0].files.length,4);assert.deepEqual(done.recovery.packagePolicyRecheck.taskIds,['t2','t3','t4']);
 const snapshot=JSON.parse(readFileSync(path.join(app.missionDir(m.id),'recovery/package-policy-v2/previous-state.json'),'utf8'));assert.equal(snapshot.recovery.packagePolicyRecheck,undefined);assert.equal(snapshot.tasks[1].status,'needs_review');assert.equal(snapshot.tasks[1].recoveryWriteRemaining,0);
 assert.ok(existsSync(path.join(app.missionDir(m.id),'recovery/package-policy-v2/previous-inputs/t3-code')));assert.throws(()=>app.recheck(m.id),{code:'MISSION_RECHECK_LIMIT'});
 const restored=new Atelier({dataDir:f.dataDir,providers:[{id:'codex',available:true}],runAgent:f.runner});assert.equal(restored.get(m.id).recovery.packagePolicyRechecksUsed,1);assert.throws(()=>restored.recheck(m.id),{code:'MISSION_RECHECK_LIMIT'});
});

test('a real review refusal keeps the exhausted renderer stopped and cannot create a second technical recheck',async t=>{
 const f=await fixture(t);f.setDeny(true);f.app.recheck(f.m.id);const done=await f.app.wait(f.m.id);
 assert.equal(done.status,'needs_review');assert.equal(done.tasks[1].review.approved,false);assert.equal(done.tasks[1].recoveryWriteRemaining,0);assert.equal(done.tasks[2].status,'blocked');assert.equal(done.recovery.packagePolicyRechecksUsed,1);
 assert.deepEqual(f.trace,[{kind:'review',id:'t2',readOnly:true}]);assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});
});

test('eligibility proves the exact former material failure and excludes unrelated refusals, runtime/account errors and unrelated blocked work',async t=>{
 const f=await fixture(t),original=structuredClone(f.m),restore=()=>{for(const key of Object.keys(f.m))delete f.m[key];Object.assign(f.m,structuredClone(original));};
 const mutations=[m=>{m.assistant=true;},m=>{m.connectorRequired=true;},m=>{m.provider='demo';},m=>{m.status='failed';},m=>{m.errorInfo={code:'PROVIDER_AUTH_REQUIRED'};},m=>{m.error='Une permission est nécessaire.';},m=>{m.tasks[1].runtimeError={code:'PROVIDER_USAGE_LIMIT'};},m=>{m.tasks[1].review.materialFailure=false;},m=>{m.tasks[1].review.feedback+=' Une autre erreur.';},m=>{m.tasks[1].title='Assembler le jeu complet';},m=>{m.tasks[2].status='needs_review';},m=>{m.tasks[2].dependsOn=[];},m=>{m.recovery.packagePolicyRecheck={version:'package-policy-v2',used:1};}];
 for(const mutate of mutations){restore();mutate(f.m);assert.deepEqual(f.app.packagePolicyRecheckCandidates(f.m),[]);assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.throws(()=>f.app.recheck(f.m.id));}
 restore();const file=path.join(f.app.workDir(f.m.id),'t2-code/js/renderer.js');rmSync(file);assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.equal(f.trace.length,0);
});

test('a changed approved contribution, missing required bench or linked input cannot acquire technical eligibility',async t=>{
 for(const damage of ['approved','bench','link'])await t.test(damage,async t=>{
  const f=await fixture(t),root=f.app.workDir(f.m.id);
  if(damage==='approved')writeFileSync(path.join(root,'t1-design/assets/building.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><circle r="8"/></svg>');
  if(damage==='bench')rmSync(path.join(root,'t2-code/tests/rendu.html'));
  if(damage==='link'){const file=path.join(root,'t2-code/js/renderer.js'),outside=path.join(f.dataDir,'outside.js');writeFileSync(outside,'DO NOT READ');rmSync(file);symlinkSync(outside,file);}
  assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});assert.equal(f.trace.length,0);
 });
});

test('a reservation save failure restores eligibility, while a subsequent file change consumes the reserved recheck without a model call',async t=>{
 const f=await fixture(t),save=f.app.save.bind(f.app);f.app.save=()=>{throw Object.assign(new Error('Disk full fixture'),{code:'ENOSPC'});};assert.throws(()=>f.app.recheck(f.m.id),{code:'ENOSPC'});assert.equal(f.app.runs.size,0);assert.equal(f.app.get(f.m.id).recovery.packagePolicyRechecksUsed,0);assert.equal(f.app.get(f.m.id).recovery.canRecheck,true);f.app.save=save;
 f.app.recheck(f.m.id);rmSync(path.join(f.app.workDir(f.m.id),'t2-code/tests/rendu.html'));const done=await f.app.wait(f.m.id);
 assert.equal(done.status,'failed');assert.equal(done.errorInfo.code,'MISSION_RECHECK_PACKAGE_CHANGED');assert.equal(done.recovery.packagePolicyRechecksUsed,1);assert.equal(f.trace.length,0);assert.equal(done.recovery.used,1);assert.equal(done.recovery.rechecksUsed,1);
});

test('the technical backup name is exact, private and cannot overwrite an earlier technical preservation',t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'oscar-package-policy-backup-')),work=path.join(directory,'travail');t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(work);writeFileSync(path.join(work,'original.txt'),'Preserved fixture');
 for(const name of ['package-policy-v1','package-policy-v3','../package-policy-v2'])assert.throws(()=>preserveRecoveryFiles({missionDirectory:directory,workDirectory:work,state:{},name}),{code:'MISSION_RECOVERY_FILES'});
 const backup=preserveRecoveryFiles({missionDirectory:directory,workDirectory:work,state:{status:'needs_review'},name:'package-policy-v2'});assert.equal(backup.directory,'recovery/package-policy-v2');assert.equal(readFileSync(path.join(directory,'recovery/package-policy-v2/files/original.txt'),'utf8'),'Preserved fixture');assert.throws(()=>preserveRecoveryFiles({missionDirectory:directory,workDirectory:work,state:{},name:'package-policy-v2'}),{code:'MISSION_RECOVERY_LIMIT'});
});
