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
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-package-policy-recheck-')),trace=[],creationInputs=[];let app,gate=null,deny=false,denyId='t2',creationGate=null;
 const svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>',renderer='export const sprite=new URL("../assets/building.svg",import.meta.url).href;export const fallback=true;';
 const task=(role,title,deliverables,dependsOn=[])=>({role,title,instruction:title,criteria:'Fichiers du périmètre présents ; contrôles honnêtes.',deliverables,dependsOn});
 const tasks=[task('design','Créer le décor',['assets/building.svg']),task('code','Développer le rendu Canvas',['js/renderer.js','tests/rendu.html']),task('code','Assembler le jeu complet',['index.html','js/main.js'],['t1','t2']),task('analyse','Vérifier le résultat',['recette.md'],['t3'])];
 const runner=async input=>{
  if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify({title:'Ancien refus technique du rendu',approach:'Contributions puis contrôles réels.',sharedBrief:'Faux moteur local, aucune connexion ni partie réelle.',tasks})};
  if(input.schema?.properties.reviews){
   const rows=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);for(const row of rows)trace.push({kind:'review',id:row.taskId,readOnly:input.readOnly});
   if(gate&&rows.some(row=>row.taskId==='t2')){gate.started.resolve();await gate.release.promise;}
   return{text:JSON.stringify({reviews:rows.map(row=>({taskId:row.taskId,approved:!(deny&&row.taskId===denyId),feedback:deny?'Le composant ne satisfait toujours pas le critère.':'Contrôle simulé favorable après lecture du périmètre.'}))})};
  }
  if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Contrôle final fictif, aucun gameplay réellement essayé.'})};
  const current=[...app.missions.values()][0].tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
  if(!current){trace.push({kind:'assembly'});return{text:'Bilan fictif de la livraison.'};}
  trace.push({kind:'creation',id:current.id});
  creationInputs.push(input);if(creationGate){creationGate.started.resolve();await creationGate.release.promise;if(input.signal.aborted)throw Object.assign(new Error('Fixture cancelled'),{name:'AbortError',code:'PROVIDER_CANCELLED'});}
  const write=(file,value)=>{mkdirSync(path.dirname(path.join(input.cwd,file)),{recursive:true});writeFileSync(path.join(input.cwd,file),value);};
  if(current.id==='t1')write('assets/building.svg',svg);
  if(current.id==='t2'){write('js/renderer.js',renderer+([...app.missions.values()][0].recovery?.packagePolicyRecheck?'\n// A real specialist rewrite during the technical review wave.':''));write('tests/rendu.html','<script type="module">import {fallback} from "../js/renderer.js";</script>');}
  if(current.id==='t3'){
   write('assets/building.svg',readFileSync(path.join(input.cwd,'Contributions/t1-design/assets/building.svg')));write('js/renderer.js',readFileSync(path.join(input.cwd,'Contributions/t2-code/js/renderer.js')));
   write('index.html','<script type="module" src="js/main.js"></script>');write('js/main.js','import "./renderer.js";');
  }
  if(current.id==='t4')write('recette.md','Le scénario vérifie la transmission du paquet, sans revendiquer de vrai test de jeu.');
  return{text:'Rapport fictif local.'};
 };
 app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:runner});
 t.after(async()=>{gate?.release.resolve();creationGate?.release.resolve();for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
 const initial=app.start({prompt:'Recrute une équipe pour ce scénario de composant et de contrôle.'}),first=await app.wait(initial.id);assert.equal(first.status,'completed',first.error);
 const m=app.missions.get(initial.id);m.status='needs_review';m.phase='Oscar demande une reprise';m.error=null;m.errorInfo=null;
 const component=m.tasks[1],cwd=path.join(app.workDir(m.id),'t2-code');
 const strict=captureContributionPackage({deliverables:component.deliverables,readFile:file=>{try{const bytes=readFileSync(path.join(cwd,file));return{bytes,hash:'fixture'};}catch{return null;}}});
 assert.deepEqual(strict.issues,['Ressource locale absente ou invalide : assets/building.svg']);
 component.status='needs_review';component.attempt=3;component.recoveryMode='salvage';component.recoveryWriteRemaining=0;component.review={approved:false,materialFailure:true,feedback:`Fichiers obligatoires absents, invalides ou modifiés pendant le contrôle : ${strict.issues.join(', ')}.`};
 for(const row of m.tasks.slice(2)){row.status='blocked';row.recoveryMode='salvage';row.recoveryWriteRemaining=1;row.review={approved:false,feedback:'Une contribution nécessaire n’a pas été validée par Oscar.'};}
 const backup=preserveRecoveryFiles({missionDirectory:app.missionDir(m.id),workDirectory:app.workDir(m.id),state:m}),recheck=preserveRecoveryFiles({missionDirectory:app.missionDir(m.id),workDirectory:app.workDir(m.id),state:m,name:'manual-recheck-1'});
 m.recovery={used:1,rechecksUsed:1,backup,recheck:{startedAt:1,backup:recheck,taskIds:['t2','t3','t4']}};app.save(m);trace.length=0;
 return{app,m,trace,creationInputs,dataDir,runner,setDeny:(value,id='t2')=>{deny=value;denyId=id;},setGate:()=>{gate={started:deferred(),release:deferred()};return gate;},setCreationGate:()=>{creationGate={started:deferred(),release:deferred()};return creationGate;}};
}

async function externalFixture(t){
 const f=await fixture(t);f.setDeny(true);f.app.recheck(f.m.id);const refused=await f.app.wait(f.m.id);assert.equal(refused.status,'needs_review');assert.equal(refused.tasks[1].review.materialFailure,undefined);assert.equal(refused.recovery.packagePolicyRechecksUsed,1);f.trace.length=0;f.setDeny(false);
 f.correct=()=>{const root=f.app.workDir(f.m.id);writeFileSync(path.join(root,'t2-code/js/renderer.js'),readFileSync(path.join(root,'t2-code/js/renderer.js'),'utf8')+'\n// External fixture correction: preserve the public API.');writeFileSync(path.join(root,'t2-code/tests/rendu.html'),readFileSync(path.join(root,'t2-code/tests/rendu.html'),'utf8')+'\n<!-- External fixture verification, no real game result claimed. -->');};
 return f;
}

async function remainingFixture(t,id='t4'){
 const f=await externalFixture(t);f.correct();f.setDeny(true,id);f.app.recheck(f.m.id);const done=await f.app.wait(f.m.id);assert.equal(done.status,'needs_review');assert.equal(done.tasks.find(row=>row.id===id).recoveryWriteRemaining,1);f.setDeny(false);f.trace.length=0;f.creationInputs.length=0;return f;
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

test('an externally corrected component receives one durably reserved read-only chain without reopening specialist writing budgets',async t=>{
 const f=await externalFixture(t),{app,m,trace}=f,work=app.workDir(m.id),oldPolicy=structuredClone(m.recovery.packagePolicyRecheck),oldRecheck=structuredClone(m.recovery.recheck),budgets=m.tasks.map(row=>row.recoveryWriteRemaining),attempts=m.tasks.map(row=>row.attempt);
 assert.equal(app.get(m.id).recovery.canRecheck,false);assert.equal(app.get(m.id).recovery.externalCorrectionRechecksUsed,0);f.correct();assert.equal(app.get(m.id).recovery.canRecheck,true);const proof=app.externalCorrectionRecheckProof(m);assert.deepEqual(proof.taskIds,['t2']);assert.ok(proof.files.some(row=>row.taskId==='t2'&&row.previousSha256!==row.sha256));
 const gate=f.setGate(),accepted=app.recheck(m.id),reserved=JSON.parse(readFileSync(path.join(app.missionDir(m.id),'state.json'),'utf8'));
 assert.equal(accepted.recovery.externalCorrectionRechecksUsed,1);assert.equal(reserved.recovery.externalCorrectionRecheck.version,'external-correction-1');assert.equal(reserved.recovery.externalCorrectionRecheck.used,1);assert.deepEqual(reserved.recovery.externalCorrectionRecheck.proof,proof);assert.throws(()=>app.recheck(m.id),{code:'MISSION_RECHECK_UNAVAILABLE'});
 await gate.started.promise;assert.deepEqual(trace,[{kind:'review',id:'t2',readOnly:true}]);assert.notEqual(m.status,'completed');gate.release.resolve();const done=await app.wait(m.id);
 assert.equal(done.status,'completed',done.error);assert.deepEqual(trace.filter(row=>row.kind==='review').map(row=>row.id),['t2','t3','t4']);assert.equal(trace.some(row=>row.kind==='creation'),false);assert.equal(trace.at(-1).kind,'assembly');assert.deepEqual(done.tasks.map(row=>row.recoveryWriteRemaining),budgets);assert.deepEqual(done.tasks.map(row=>row.attempt),attempts);
 assert.equal(done.recovery.used,1);assert.equal(done.recovery.rechecksUsed,1);assert.deepEqual(done.recovery.packagePolicyRecheck,oldPolicy);assert.deepEqual(done.recovery.recheck,oldRecheck);assert.equal(done.recovery.externalCorrectionRechecksUsed,1);assert.equal(done.recovery.canRecheck,false);assert.deepEqual(done.recovery.externalCorrectionRecheck.taskIds,['t2','t3','t4']);assert.equal(done.workDirectory,work);
 const previous=JSON.parse(readFileSync(path.join(app.missionDir(m.id),'recovery/external-correction-1/previous-state.json'),'utf8'));assert.equal(previous.recovery.externalCorrectionRecheck,undefined);assert.equal(previous.tasks[1].review.approved,false);assert.equal(previous.tasks[1].recoveryWriteRemaining,0);assert.ok(existsSync(path.join(app.missionDir(m.id),'recovery/external-correction-1/files/t3-code/index.html')));assert.ok(existsSync(path.join(app.missionDir(m.id),'recovery/package-policy-v2/previous-inputs/t3-code')));
 assert.throws(()=>app.recheck(m.id),{code:'MISSION_RECHECK_LIMIT'});const restored=new Atelier({dataDir:f.dataDir,providers:[{id:'codex',available:true}],runAgent:f.runner});assert.equal(restored.get(m.id).recovery.externalCorrectionRechecksUsed,1);assert.throws(()=>restored.recheck(m.id),{code:'MISSION_RECHECK_LIMIT'});
});

test('an external recheck never creates specialists or assembles after a real refusal, even where an old writing budget remains',async t=>{
 for(const id of ['t2','t3','t4'])await t.test(id,async t=>{
  const f=await externalFixture(t);f.correct();f.setDeny(true,id);const before=f.m.tasks.map(row=>row.recoveryWriteRemaining);f.app.recheck(f.m.id);const done=await f.app.wait(f.m.id);
  assert.equal(done.status,'needs_review',done.error);assert.equal(done.tasks.find(row=>row.id===id).review.approved,false);assert.deepEqual(done.tasks.map(row=>row.recoveryWriteRemaining),before);assert.ok(f.trace.every(row=>row.kind==='review'&&row.readOnly===true));assert.equal(done.recovery.externalCorrectionRechecksUsed,1);assert.equal(done.recovery.remainingCorrectionPassesUsed,0);
  if(id==='t2')assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});else assert.equal(done.recovery.canRecheck,true,'A remaining correction is a distinct explicit action, never launched by the read-only wave.');
 });
});

test('external eligibility requires a changed declared livrable, the exact prior checkpoint and only its dependent blocked chain',async t=>{
 const f=await externalFixture(t),work=f.app.workDir(f.m.id);writeFileSync(path.join(work,'t2-code/notes.txt'),'An unrelated file cannot acquire an extra review.');assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);f.correct();const original=structuredClone(f.m),restore=()=>{for(const key of Object.keys(f.m))delete f.m[key];Object.assign(f.m,structuredClone(original));};
 const mutations=[m=>{m.assistant=true;},m=>{m.connectorRequired=true;},m=>{m.errorInfo={code:'PROVIDER_PERMISSION_REQUIRED'};},m=>{m.error='Connection expired';},m=>{m.tasks[1].runtimeError={code:'PROVIDER_USAGE_LIMIT'};},m=>{m.tasks[1].review.materialFailure=true;},m=>{m.tasks[2].status='needs_review';},m=>{m.tasks[2].dependsOn=[];},m=>{m.recovery.packagePolicyRecheck.version='other-policy';},m=>{m.recovery.packagePolicyRecheck.backup.directory='../outside';},m=>{m.recovery.packagePolicyRecheck.taskIds=[];},m=>{m.recovery.externalCorrectionRecheck={version:'external-correction-1',used:1};}];
 for(const change of mutations){restore();change(f.m);assert.equal(f.app.externalCorrectionRecheckProof(f.m),null);assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.throws(()=>f.app.recheck(f.m.id));}restore();assert.equal(f.trace.length,0);
});

test('linked or altered checkpoints, invalid current files and changed approved sources never grant the external recheck',async t=>{
 for(const damage of ['manifest-link','checkpoint-link','checkpoint-content','approved-content','missing-bench','current-link'])await t.test(damage,async t=>{
  const f=await externalFixture(t);f.correct();const root=f.app.workDir(f.m.id),backup=path.join(f.app.missionDir(f.m.id),'recovery/package-policy-v2');
  if(damage==='manifest-link'){const file=path.join(backup,'manifest.json'),other=path.join(f.dataDir,'other-manifest.json');writeFileSync(other,readFileSync(file));rmSync(file);symlinkSync(other,file);}
  if(damage==='checkpoint-link'){const file=path.join(backup,'files/t2-code/js/renderer.js'),other=path.join(f.dataDir,'other-renderer.js');writeFileSync(other,readFileSync(file));rmSync(file);symlinkSync(other,file);}
  if(damage==='checkpoint-content')writeFileSync(path.join(backup,'files/t2-code/js/renderer.js'),'Changed checkpoint fixture.');
  if(damage==='approved-content')writeFileSync(path.join(root,'t1-design/assets/building.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><circle r="9"/></svg>');
  if(damage==='missing-bench')rmSync(path.join(root,'t2-code/tests/rendu.html'));
  if(damage==='current-link'){const file=path.join(root,'t2-code/js/renderer.js'),other=path.join(f.dataDir,'other-current.js');writeFileSync(other,readFileSync(file));rmSync(file);symlinkSync(other,file);}
  assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});assert.equal(f.trace.length,0);
 });
});

test('external reservation rollback is safe and a change before validation consumes its receipt without any model call',async t=>{
 const f=await externalFixture(t);f.correct();const save=f.app.save.bind(f.app);f.app.save=()=>{throw Object.assign(new Error('Disk full fixture'),{code:'ENOSPC'});};assert.throws(()=>f.app.recheck(f.m.id),{code:'ENOSPC'});assert.equal(f.app.get(f.m.id).recovery.externalCorrectionRechecksUsed,0);assert.equal(f.app.get(f.m.id).recovery.canRecheck,true);f.app.save=save;
 f.app.recheck(f.m.id);writeFileSync(path.join(f.app.workDir(f.m.id),'t2-code/js/renderer.js'),'An otherwise safe but different file after reservation.');const done=await f.app.wait(f.m.id);assert.equal(done.status,'failed');assert.equal(done.errorInfo.code,'MISSION_RECHECK_EXTERNAL_CHANGED');assert.equal(done.recovery.externalCorrectionRechecksUsed,1);assert.equal(f.trace.length,0);assert.equal(done.tasks[1].recoveryWriteRemaining,0);assert.equal(done.tasks[2].recoveryWriteRemaining,1);
});

test('a specialist rewrite during package-policy-v2 is never mistaken for a later external correction after another refusal',async t=>{
 const f=await fixture(t);f.m.tasks[1].recoveryWriteRemaining=1;f.setDeny(true);f.app.recheck(f.m.id);const done=await f.app.wait(f.m.id),root=f.app.workDir(f.m.id);
 assert.equal(done.status,'needs_review');assert.equal(done.tasks[1].review.materialFailure,undefined);assert.equal(done.tasks[1].recoveryWriteRemaining,0);assert.equal(done.recovery.packagePolicyRechecksUsed,1);
 assert.equal(f.trace.filter(row=>row.kind==='creation'&&row.id==='t2').length,1);assert.ok(done.performance.calls.some(call=>call.stage==='creation'&&call.startedAt>=done.recovery.packagePolicyRecheck.startedAt));
 assert.notDeepEqual(readFileSync(path.join(root,'t2-code/js/renderer.js')),readFileSync(path.join(f.app.missionDir(f.m.id),'recovery/package-policy-v2/files/t2-code/js/renderer.js')));
 assert.equal(f.app.externalCorrectionRecheckProof(f.m),null);assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.equal(f.app.get(f.m.id).recovery.externalCorrectionRechecksUsed,0);assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});
});

test('external proof requires completed read-only post-checkpoint review history with no overlapping write or unknown call',async t=>{
 const f=await externalFixture(t);f.correct();const original=structuredClone(f.m.performance),checkpoint=f.m.recovery.packagePolicyRecheck.startedAt;
 const histories=[undefined,{calls:[]},{calls:original.calls.filter(call=>call.startedAt<checkpoint)},
  {calls:[...original.calls,{agent:'Sam',stage:'creation',startedAt:checkpoint-10,durationMs:20,status:'completed'}]},
  {calls:[...original.calls,{agent:'Oscar',stage:'review',startedAt:checkpoint,durationMs:null,status:'running'}]},
  {calls:[...original.calls,{agent:'Oscar',stage:'unrecognized',startedAt:checkpoint,durationMs:0,status:'completed'}]},
  {calls:original.calls.map(call=>call.startedAt>=checkpoint?{...call,status:'failed'}:call)}];
 for(const history of histories){f.m.performance=structuredClone(history);assert.equal(f.app.externalCorrectionRecheckProof(f.m),null);assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);}
 f.m.performance=original;assert.ok(f.app.externalCorrectionRecheckProof(f.m));assert.equal(f.trace.length,0);
});

test('the explicit remaining correction repairs the refused QA report directly, spends its existing one and genuinely reviews before delivery',async t=>{
 const f=await remainingFixture(t),{app,m,trace}=f,id=m.id,target=m.tasks[3],feedback=target.review.feedback,attempt=target.attempt,legacy={used:m.recovery.used,rechecksUsed:m.recovery.rechecksUsed,policy:structuredClone(m.recovery.packagePolicyRecheck),external:structuredClone(m.recovery.externalCorrectionRecheck)},gate=f.setCreationGate();
 const approved=m.tasks.filter(row=>row.status==='approved').flatMap(row=>row.outputFingerprints.map(file=>({path:`${row.id}-${row.role}/${file.path}`,bytes:readFileSync(path.join(app.workDir(id),`${row.id}-${row.role}`,file.path))})));
 assert.equal(app.get(id).recovery.remainingCorrectionPassesUsed,0);assert.equal(app.get(id).recovery.canRecheck,true);assert.deepEqual(app.remainingCorrectionPassProof(m).taskIds,['t4']);
 const accepted=app.recheck(id),reserved=JSON.parse(readFileSync(path.join(app.missionDir(id),'state.json'),'utf8'));assert.equal(accepted.recovery.remainingCorrectionPassesUsed,1);assert.equal(reserved.recovery.remainingCorrectionPass.version,'remaining-correction-1');assert.equal(reserved.recovery.remainingCorrectionPass.used,1);assert.equal(reserved.tasks[3].recoveryWriteRemaining,1);assert.equal(reserved.recovery.remainingCorrectionPass.proof.tasks[0].feedback,feedback);assert.throws(()=>app.recheck(id),{code:'MISSION_RECHECK_UNAVAILABLE'});
 await gate.started.promise;assert.deepEqual(trace,[{kind:'creation',id:'t4'}]);assert.equal(m.tasks[3].recoveryMode,'repair');assert.equal(m.tasks[3].recoveryWriteRemaining,0);assert.equal(m.tasks[3].attempt,attempt+1);assert.match(f.creationInputs[0].prompt,/CORRECTIONS DEMANDÉES PAR OSCAR/u);assert.ok(f.creationInputs[0].prompt.includes(feedback));assert.equal(f.creationInputs[0].readOnly,false);assert.notEqual(m.status,'completed');
 gate.release.resolve();const done=await app.wait(id);assert.equal(done.status,'completed',done.error);assert.deepEqual(trace,[{kind:'creation',id:'t4'},{kind:'review',id:'t4',readOnly:true},{kind:'assembly'}]);assert.equal(done.tasks[3].review.approved,true);assert.equal(done.tasks[3].recoveryWriteRemaining,0);assert.equal(done.recovery.used,legacy.used);assert.equal(done.recovery.rechecksUsed,legacy.rechecksUsed);assert.deepEqual(done.recovery.packagePolicyRecheck,legacy.policy);assert.deepEqual(done.recovery.externalCorrectionRecheck,legacy.external);assert.deepEqual(done.recovery.remainingCorrectionPass.taskIds,['t4']);assert.equal(done.recovery.remainingCorrectionPassesUsed,1);assert.equal(done.recovery.canRecheck,false);
 for(const row of approved)assert.deepEqual(readFileSync(path.join(app.workDir(id),row.path)),row.bytes,row.path);
 const previous=JSON.parse(readFileSync(path.join(app.missionDir(id),'recovery/remaining-correction-1/previous-state.json'),'utf8'));assert.equal(previous.recovery.remainingCorrectionPass,undefined);assert.equal(previous.tasks[3].recoveryWriteRemaining,1);assert.equal(previous.tasks[3].review.feedback,feedback);assert.equal(done.workDirectory,app.workDir(id));
 const restored=new Atelier({dataDir:f.dataDir,providers:[{id:'codex',available:true}],runAgent:f.runner});assert.equal(restored.get(id).recovery.remainingCorrectionPassesUsed,1);assert.throws(()=>restored.recheck(id),{code:'MISSION_RECHECK_LIMIT'});assert.throws(()=>app.recheck(id),{code:'MISSION_RECHECK_LIMIT'});
});

test('a remaining correction that is genuinely refused consumes no second write and never assembles a delivery',async t=>{
 const f=await remainingFixture(t);f.setDeny(true,'t4');f.app.recheck(f.m.id);const done=await f.app.wait(f.m.id);
 assert.equal(done.status,'needs_review');assert.equal(done.tasks[3].review.approved,false);assert.equal(done.tasks[3].recoveryWriteRemaining,0);assert.equal(done.recovery.remainingCorrectionPassesUsed,1);assert.deepEqual(f.trace,[{kind:'creation',id:'t4'},{kind:'review',id:'t4',readOnly:true}]);assert.equal(done.recovery.canRecheck,false);assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});
});

test('the remaining pass corrects only its originally refused targets and rereads healthy blocked dependents without writing them',async t=>{
 const f=await remainingFixture(t,'t3');f.app.recheck(f.m.id);const done=await f.app.wait(f.m.id);
 assert.equal(done.status,'completed',done.error);assert.deepEqual(f.trace,[{kind:'creation',id:'t3'},{kind:'review',id:'t3',readOnly:true},{kind:'review',id:'t4',readOnly:true},{kind:'assembly'}]);assert.equal(done.tasks[2].recoveryWriteRemaining,0);assert.equal(done.tasks[3].recoveryWriteRemaining,1);assert.equal(done.recovery.remainingCorrectionPassesUsed,1);
});

test('zero or malformed budgets, private-account errors, interrupted states and unrelated refusals never grant the remaining pass',async t=>{
 const f=await remainingFixture(t),original=structuredClone(f.m),restore=()=>{for(const key of Object.keys(f.m))delete f.m[key];Object.assign(f.m,structuredClone(original));};
 const changes=[m=>{m.tasks[3].recoveryWriteRemaining=0;},m=>{m.tasks[3].recoveryWriteRemaining=2;},m=>{m.tasks[3].recoveryWriteRemaining='1';},m=>{m.tasks[3].review.materialFailure=true;},m=>{m.tasks[3].runtimeError={code:'PROVIDER_TOOL_UNAVAILABLE'};},m=>{m.assistant=true;},m=>{m.connectorRequired=true;},m=>{m.provider='demo';},m=>{m.error='Permission denied';},m=>{m.errorInfo={code:'PROVIDER_AUTH_REQUIRED'};},m=>{m.errorInfo={code:'PROVIDER_USAGE_LIMIT'};},m=>{m.errorInfo={code:'PROVIDER_PERMISSION_REQUIRED'};},m=>{m.status='cancelled';},m=>{m.status='paused';},m=>{m.status='running';},m=>{m.recovery.externalCorrectionRecheck.taskIds=[];},m=>{m.recovery.remainingCorrectionPass={version:'remaining-correction-1',used:1};},m=>{m.tasks[0].status='blocked';}];
 for(const change of changes){restore();change(f.m);assert.equal(f.app.remainingCorrectionPassProof(f.m),null);assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.throws(()=>f.app.recheck(f.m.id));}restore();assert.equal(f.trace.length,0);
});

test('a missing or linked QA report and a changed approved game cannot unlock the remaining correction',async t=>{
 for(const kind of ['missing','linked','approved'])await t.test(kind,async t=>{
  const f=await remainingFixture(t),root=f.app.workDir(f.m.id),file=path.join(root,'t4-analyse/recette.md');
  if(kind==='missing')rmSync(file);if(kind==='linked'){const outside=path.join(f.dataDir,'outside.md');writeFileSync(outside,'Keep private');rmSync(file);symlinkSync(outside,file);}if(kind==='approved')writeFileSync(path.join(root,'t3-code/index.html'),'<h1>Changed after approval</h1>');
  assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});assert.equal(f.trace.length,0);
 });
});

test('remaining pass save rollback preserves the one while changed files before preparation consume only the explicit receipt',async t=>{
 const f=await remainingFixture(t),save=f.app.save.bind(f.app);f.app.save=()=>{throw Object.assign(new Error('Disk full fixture'),{code:'ENOSPC'});};assert.throws(()=>f.app.recheck(f.m.id),{code:'ENOSPC'});assert.equal(f.app.get(f.m.id).recovery.remainingCorrectionPassesUsed,0);assert.equal(f.app.get(f.m.id).tasks[3].recoveryWriteRemaining,1);assert.equal(f.app.get(f.m.id).recovery.canRecheck,true);f.app.save=save;
 f.app.recheck(f.m.id);writeFileSync(path.join(f.app.workDir(f.m.id),'t4-analyse/recette.md'),'Changed after the durable reservation.');const done=await f.app.wait(f.m.id);assert.equal(done.status,'failed');assert.equal(done.errorInfo.code,'MISSION_RECHECK_REMAINING_CHANGED');assert.equal(done.recovery.remainingCorrectionPassesUsed,1);assert.equal(done.tasks[3].recoveryWriteRemaining,1);assert.equal(f.trace.length,0);assert.throws(()=>f.app.recheck(f.m.id),{code:'MISSION_RECHECK_LIMIT'});
});

test('stopping a remaining correction cancels its task and never restores its spent one or starts a review',async t=>{
 const f=await remainingFixture(t),gate=f.setCreationGate();f.app.recheck(f.m.id);await gate.started.promise;assert.equal(f.m.tasks[3].recoveryWriteRemaining,0);f.app.stop(f.m.id);gate.release.resolve();const done=await f.app.wait(f.m.id);
 assert.equal(done.status,'cancelled');assert.equal(done.tasks[3].recoveryWriteRemaining,0);assert.equal(done.recovery.remainingCorrectionPassesUsed,1);assert.deepEqual(f.trace,[{kind:'creation',id:'t4'}]);assert.equal(f.app.runs.size,0);assert.equal(f.app.get(f.m.id).recovery.canRecheck,false);
});
