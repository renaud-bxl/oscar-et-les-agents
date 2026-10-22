import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync,copyFileSync,symlinkSync,truncateSync,readdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Atelier,PLAN_SCHEMA,simpleCodePlan} from '../lib/orchestrator.mjs';
import {preserveRecoveryFiles,canRepairRuntime} from '../lib/mission-recovery.mjs';

const timeout=()=>Object.assign(new Error('Le moteur a dépassé le délai de cet appel. Les fichiers restent conservés.'),{name:'TimeoutError',code:'PROVIDER_TIMEOUT',recoverable:true,action:'repair'});
const SVG='<svg xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" fill="#62896d"/></svg>';
const modelPlan={title:'Un jeu réparable',approach:'Modules et intégration.',sharedBrief:'Un seul jeu local ; reprendre les vrais fichiers et ne contacter aucun compte.',tasks:[
 {role:'code',title:'Moteur',instruction:'Écrire module.js.',criteria:'Le module est présent.',deliverables:['module.js'],dependsOn:[]},
 {role:'design',title:'Dessin',instruction:'Créer dessin.svg.',criteria:'Un dessin autonome.',deliverables:['dessin.svg'],dependsOn:['t1']},
 {role:'code',title:'Intégration',instruction:'Créer index.html avec les apports validés.',criteria:'Un jeu unique avec les apports.',deliverables:['index.html'],dependsOn:['t1','t2']},
]};
const approved={text:JSON.stringify({approved:true,feedback:'Fichiers et intégration réellement inspectés par le moteur fictif.'})};
const requested=input=>JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);
function fixture(t,options={}){
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-recovery-')),calls=[],creations=new Map(),reviews=[];let app,assembly=0,finalReviews=0;
 const runner=async input=>{
  calls.push(input);
  if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify(options.plan||modelPlan)};
  const mission=[...app.missions.values()].find(item=>input.cwd===app.workDir(item.id)||input.cwd.startsWith(app.workDir(item.id)+path.sep));
  if(input.schema?.properties.reviews){const rows=requested(input);reviews.push(rows.map(row=>row.taskId));const replacements=await options.review?.({input,mission,rows,app,creations});return{text:JSON.stringify({reviews:replacements||rows.map(row=>({taskId:row.taskId,approved:true,feedback:'Fichier réel présent, vérifié dans ce test local.'}))})};}
  if(input.schema?.properties.approved){finalReviews++;if(options.finalTimeout&&finalReviews===1)throw timeout();return approved;}
  const task=mission.tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
  if(task){const count=(creations.get(task.id)||0)+1;creations.set(task.id,count);await options.create?.({input,task,mission,count,app});for(const file of task.deliverables){const target=path.join(input.cwd,file);if(options.omit?.({task,file,count}))continue;mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,file.endsWith('.svg')?SVG:file==='index.html'?'<!doctype html><title>Jeu local</title><main>Jeu et contrôles locaux simulés</main>':`Contenu utile ${task.id} ${file}`);}if(options.fail?.({task,count}))throw options.fail({task,count});return{text:`Le fichier de ${task.id} est présent et vérifiable.`};}
  assembly++;await options.assemble?.({input,mission,app,assembly});mkdirSync(path.join(input.cwd,'Livraison'),{recursive:true});for(const task of mission.tasks)for(const file of task.deliverables){const source=path.join(input.cwd,`${task.id}-${task.role}`,file);if(existsSync(source))copyFileSync(source,path.join(input.cwd,'Livraison',file));}if(options.assemblyTimeout&&assembly===1)throw timeout();return{text:'Livraison/index.html est le jeu réuni. Les fichiers et les limites sont conservés.'};
 };
 app=new Atelier({dataDir,providers:[{id:'codex',available:true},{id:'claude',available:true}],runAgent:runner});
 t.after(async()=>{for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
 return{get app(){return app;},set app(value){app=value;},runner,dataDir,calls,creations,reviews,get assembly(){return assembly;},get finalReviews(){return finalReviews;}};
}

 test('un timeout avec fichiers complets passe par une vraie relecture et conserve les collègues sans régénération',async t=>{
 const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?timeout():null});const initial=f.app.start({prompt:'Recrute les métiers pour un jeu local réparable.'}),done=await f.app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.equal(done.recovery.used,1);assert.equal(done.recovery.mode,'automatic');assert.equal(f.creations.get('t1'),1);assert.equal(f.creations.get('t2'),1);assert.equal(f.creations.get('t3'),1);assert.ok(f.reviews.some(ids=>ids.includes('t2')));assert.ok(f.calls.some(input=>input.readOnly&&input.prompt.includes('Reprise après interruption')));assert.equal(readFileSync(path.join(f.app.workDir(initial.id),'t2-design/dessin.svg'),'utf8'),SVG);
 const backup=path.join(f.app.missionDir(initial.id),'recovery/attempt-1');assert.ok(existsSync(path.join(backup,'previous-state.json')));assert.equal(readFileSync(path.join(backup,'files/t2-design/dessin.svg'),'utf8'),SVG);assert.ok(!done.files.some(file=>file.path.includes('recovery/')));assert.equal(done.recovery.canResume,false);
});

 test('la reprise manuelle d’un ancien échec conserve id, dossier, approuvés et fichiers ; un deuxième clic ne redémarre rien',async t=>{
 const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?new Error('Ancien appel interrompu.'):null});const initial=f.app.start({prompt:'Ancien jeu interrompu avec deux contributions.'}),failed=await f.app.wait(initial.id);assert.equal(failed.status,'failed');assert.equal(failed.recovery.canResume,true);
 const oldDirectory=failed.workDirectory,oldFolder=failed.folderName,module=readFileSync(path.join(oldDirectory,'t1-code/module.js'));
 // Legacy approved contributions have no pinned fingerprints: reread, never
 // trust the old flag alone and never pay for a duplicate creation.
 delete f.app.missions.get(initial.id).tasks[0].outputFingerprints;f.app.save(f.app.missions.get(initial.id));
 const resumed=f.app.resume(initial.id);assert.equal(resumed.id,initial.id);assert.throws(()=>f.app.resume(initial.id),{code:'MISSION_RECOVERY_UNAVAILABLE'});const done=await f.app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.equal(done.workDirectory,oldDirectory);assert.equal(done.folderName,oldFolder);assert.equal(done.recovery.used,1);assert.equal(f.creations.get('t1'),1);assert.equal(f.creations.get('t2'),1);assert.deepEqual(readFileSync(path.join(oldDirectory,'t1-code/module.js')),module);assert.ok(f.reviews.filter(ids=>ids.includes('t1')).length>=2);assert.equal(JSON.parse(readFileSync(path.join(f.app.missionDir(initial.id),'recovery/attempt-1/previous-state.json'),'utf8')).status,'failed');
 const restored=new Atelier({dataDir:f.dataDir,providers:[{id:'codex',available:true}],runAgent:f.runner});f.app=restored;assert.equal(restored.get(initial.id).recovery.used,1);assert.throws(()=>restored.resume(initial.id),{code:'MISSION_RECOVERY_LIMIT'});
});

 test('un fichier manquant déclenche une seule écriture ciblée ; la sauvegarde de la première tentative reste intacte',async t=>{
 const custom=structuredClone(modelPlan);custom.tasks[1].deliverables.push('notes.md');const f=fixture(t,{plan:custom,omit:({task,file,count})=>task.id==='t2'&&file==='notes.md'&&count===1,fail:({task,count})=>task.id==='t2'&&count===1?timeout():null});const initial=f.app.start({prompt:'Réparer seulement les fichiers manquants de ce jeu.'}),done=await f.app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.equal(f.creations.get('t1'),1);assert.equal(f.creations.get('t2'),2);assert.ok(f.calls.some(input=>input.prompt.includes('REPRISE CIBLÉE APRÈS INTERRUPTION')));assert.equal(readFileSync(path.join(f.app.missionDir(initial.id),'recovery/attempt-1/files/t2-design/dessin.svg'),'utf8'),SVG);assert.equal(existsSync(path.join(f.app.missionDir(initial.id),'recovery/attempt-1/files/t2-design/notes.md')),false);assert.ok(existsSync(path.join(done.workDirectory,'t2-design/notes.md')));
});

 test('un second timeout épuisant la réparation reste à revoir sans boucle ni fausse livraison',async t=>{
 const custom=structuredClone(modelPlan);custom.tasks[1].deliverables.push('notes.md');const f=fixture(t,{plan:custom,omit:({task,file})=>task.id==='t2'&&file==='notes.md',fail:({task})=>task.id==='t2'?timeout():null});const initial=f.app.start({prompt:'Un jeu dont le moteur de design reste indisponible.'}),done=await f.app.wait(initial.id);
 assert.equal(done.status,'needs_review',done.error);assert.equal(done.recovery.used,1);assert.equal(done.recovery.canResume,false);assert.equal(done.recovery.reason,'limit');assert.equal(f.creations.get('t2'),2);assert.equal(f.creations.has('t3'),false);assert.equal(f.assembly,0);assert.ok(!done.events.some(event=>event.kind==='success'));assert.throws(()=>f.app.resume(initial.id),{code:'MISSION_RECOVERY_LIMIT'});
});

 test('authentification, permissions, quota et annulation ne déclenchent aucune réparation automatique',async t=>{
 for(const code of ['PROVIDER_AUTH_REQUIRED','PROVIDER_PERMISSION_REQUIRED','PROVIDER_USAGE_LIMIT'])await t.test(code,async t=>{const f=fixture(t,{fail:({task})=>task.id==='t2'?Object.assign(new Error('Action utilisateur requise.'),{code,recoverable:false,action:'reconnect'}):null});const initial=f.app.start({prompt:'Jeu local et contrôle de connexion.'}),done=await f.app.wait(initial.id);assert.equal(done.status,'failed');assert.equal(done.recovery.used,0);assert.equal(done.errorInfo.code,code);assert.equal(f.creations.get('t2'),1);assert.equal(existsSync(path.join(f.app.missionDir(initial.id),'recovery')),false);});
});

 test('un timeout de contrôle final reprend ce contrôle sans refaire les créations ni l’assemblage',async t=>{
 const f=fixture(t,{finalTimeout:true});const initial=f.app.start({prompt:'Jeu local déjà assemblé dont le contrôle est interrompu.'}),done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(f.assembly,1);assert.equal(f.finalReviews,2);assert.ok([...f.creations.values()].every(count=>count===1));assert.equal(done.recovery.used,1);
});

 test('un timeout d’assemblage répare seulement l’assemblage et conserve ses fichiers partiels',async t=>{
 const f=fixture(t,{assemblyTimeout:true});const initial=f.app.start({prompt:'Jeu local à reprendre pendant son assemblage.'}),done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(f.assembly,2);assert.ok([...f.creations.values()].every(count=>count===1));assert.ok(existsSync(path.join(f.app.missionDir(initial.id),'recovery/attempt-1/files/Livraison/index.html')));
});

 test('la présence d’un lien bloque la reprise avant tout appel et préserve le fichier extérieur',async t=>{
 const f=fixture(t,{fail:({task})=>task.id==='t2'?new Error('Ancienne panne.'):null});const initial=f.app.start({prompt:'Ancien jeu en échec.'});await f.app.wait(initial.id);const outside=path.join(f.dataDir,'outside.txt');writeFileSync(outside,'NE PAS MODIFIER');symlinkSync(outside,path.join(f.app.workDir(initial.id),'t2-design/lien.txt'));const count=f.calls.length;f.app.resume(initial.id);const done=await f.app.wait(initial.id);assert.equal(done.status,'failed');assert.equal(done.errorInfo.code,'MISSION_RECOVERY_FILES');assert.equal(f.calls.length,count);assert.equal(readFileSync(outside,'utf8'),'NE PAS MODIFIER');
});

 test('la sauvegarde de reprise est privée et bornée ; elle refuse un dossier déjà utilisé et les gros fichiers',t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'oscar-recovery-bounds-')),work=path.join(dir,'travail');t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(work);writeFileSync(path.join(work,'partiel.svg'),'<svg dessin encore incomplet');preserveRecoveryFiles({missionDirectory:dir,workDirectory:work,state:{status:'failed'}});assert.equal(readFileSync(path.join(dir,'recovery/attempt-1/files/partiel.svg'),'utf8'),'<svg dessin encore incomplet');assert.throws(()=>preserveRecoveryFiles({missionDirectory:dir,workDirectory:work,state:{status:'failed'}}),{code:'MISSION_RECOVERY_LIMIT'});writeFileSync(path.join(work,'grand.bin'),'');truncateSync(path.join(work,'grand.bin'),21*1024*1024);assert.throws(()=>preserveRecoveryFiles({missionDirectory:dir,workDirectory:work,state:{status:'failed'}}),{code:'MISSION_RECOVERY_FILES'});
});

 test('effort moyen interne uniquement pour les petits parcours Codex et les anciennes reprises simples',async t=>{
 const f=fixture(t);const initial=f.app.start({prompt:'Crée une petite calculatrice dans le navigateur.'});const done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.ok(f.calls.length>0&&f.calls.every(input=>input.reasoningEffort==='medium'));assert.ok(done.performance.calls.every(call=>call.reasoningEffort==='medium'));assert.ok(canRepairRuntime(timeout()));assert.equal(canRepairRuntime(Object.assign(new Error('OAuth'),{code:'CONNECTOR_UNAVAILABLE',recoverable:true})),false);
 const other=fixture(t);const complex=other.app.start({prompt:'Un logiciel complet avec une base de données.'});await other.app.wait(complex.id);assert.ok(other.calls.every(input=>input.reasoningEffort===undefined));
});

 test('plusieurs spécialistes interrompus partagent une seule vague de réparation et des relectures séparées',async t=>{
 const custom=structuredClone(modelPlan);custom.tasks[1].dependsOn=[];const f=fixture(t,{plan:custom,fail:({task,count})=>['t1','t2'].includes(task.id)&&count===1?timeout():null});const initial=f.app.start({prompt:'Deux apports indépendants interrompus avec leurs fichiers déjà présents.'}),done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(done.recovery.used,1);assert.equal(f.creations.get('t1'),1);assert.equal(f.creations.get('t2'),1);assert.equal(f.creations.get('t3'),1);assert.deepEqual(readdirSync(path.join(f.app.missionDir(initial.id),'recovery')),['attempt-1']);
});

 test('une relecture de sauvegarde refusée permet une seule correction ciblée avant validation',async t=>{
 let refused=false;const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?timeout():null,review:({input,rows})=>{if(!refused&&input.prompt.includes('Reprise après interruption')&&rows.some(row=>row.taskId==='t2')){refused=true;return rows.map(row=>({taskId:row.taskId,approved:row.taskId!=='t2',feedback:'Le dessin doit être complété avant son utilisation.'}));}}});const initial=f.app.start({prompt:'Un jeu avec un dessin interrompu qui doit vraiment être corrigé.'}),done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(refused,true);assert.equal(f.creations.get('t2'),2);assert.equal(f.creations.get('t1'),1);assert.equal(done.recovery.used,1);assert.ok(done.tasks[1].review.approved);
});

 test('annuler la réparation arrête ses processus et ne déclenche jamais une troisième tentative',async t=>{
 let notify;const started=new Promise(resolve=>{notify=resolve;});const custom=structuredClone(modelPlan);custom.tasks[1].deliverables.push('notes.md');const f=fixture(t,{plan:custom,omit:({task,file,count})=>task.id==='t2'&&file==='notes.md'&&count===1,fail:({task,count})=>task.id==='t2'&&count===1?timeout():null,create:async({task,count,input})=>{if(task.id==='t2'&&count===2){notify();await new Promise((_,reject)=>{const abort=()=>reject(Object.assign(new Error('Annulation explicite.'),{name:'AbortError',code:'PROVIDER_CANCELLED'}));input.signal.addEventListener('abort',abort,{once:true});if(input.signal.aborted)abort();});}}});const initial=f.app.start({prompt:'Réparation locale à annuler.'});await started;f.app.stop(initial.id);const done=await f.app.wait(initial.id);assert.equal(done.status,'cancelled');assert.equal(f.creations.get('t2'),2);assert.equal(f.creations.has('t3'),false);assert.equal(f.app.runs.has(initial.id),false);assert.equal(f.app.specialistPool.active,0);assert.equal(done.recovery.canResume,false);assert.ok(!done.events.some(event=>event.kind==='success'));
});

 test('une demande de Zoé ne récupère jamais une capacité de compte par la reprise générale',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-no-account-recovery-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let calls=0;const app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:async()=>{calls++;throw timeout();}});const initial=app.start({prompt:'Prépare mes messages sans aucun envoi.'},{assistant:true,assistantMode:'mail'}),done=await app.wait(initial.id);assert.equal(done.status,'failed');assert.equal(calls,1);assert.equal(done.recovery.used,0);assert.equal(done.recovery.canResume,false);assert.equal(done.recovery.reason,'account-or-demo');assert.throws(()=>app.resume(initial.id),{code:'MISSION_RECOVERY_UNAVAILABLE'});assert.equal(existsSync(path.join(app.missionDir(initial.id),'recovery')),false);
});

 test('une contribution approuvée modifiée pendant l’assemblage de reprise ne peut devenir une livraison validée',async t=>{
 const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?new Error('Ancienne panne.'):null,assemble:({input})=>writeFileSync(path.join(input.cwd,'t1-code/module.js'),'REMPLACEMENT NON VALIDÉ')});const initial=f.app.start({prompt:'Jeu dont les apports approuvés doivent être préservés.'});await f.app.wait(initial.id);const original=readFileSync(path.join(f.app.workDir(initial.id),'t1-code/module.js'));f.app.resume(initial.id);const done=await f.app.wait(initial.id);assert.equal(done.status,'needs_review',done.error);assert.equal(done.finalReview.approved,false);assert.match(done.finalReview.feedback,/t1-code\/module\.js/);assert.deepEqual(readFileSync(path.join(f.app.missionDir(initial.id),'recovery/attempt-1/files/t1-code/module.js')),original);assert.ok(!done.events.some(event=>event.kind==='success'));
});

 test('les références préparées restent épinglées et ne sont ni resélectionnées ni recopiées lors de la reprise',async t=>{
 let preparations=0;const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?new Error('Ancienne panne.'):null});f.app.prepareMission=async mission=>{preparations++;mkdirSync(path.join(f.app.workDir(mission.id),'References'));writeFileSync(path.join(f.app.workDir(mission.id),'References/exemple.md'),'Exemple local fourni.');mission.references=[{path:'References/exemple.md'}];};const initial=f.app.start({prompt:'Un jeu avec une référence déjà préparée.'});await f.app.wait(initial.id);f.app.resume(initial.id);const done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(preparations,1);assert.equal(readFileSync(path.join(done.workDirectory,'References/exemple.md'),'utf8'),'Exemple local fourni.');assert.ok(f.calls.some(input=>input.prompt.includes('EXEMPLES FOURNIS PAR L’UTILISATEUR')));
});

 test('la reprise d’un visuel sans image ne peut pas être validée par un texte et des avis favorables',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-visual-recovery-empty-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let creations=0,reviews=0;const app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:async input=>{if(input.schema?.properties.report){creations++;if(creations===1)throw timeout();return{text:JSON.stringify({title:'Affiche',report:'Une affirmation sans fichier ne suffit pas.',deliverables:['affiche.svg']})};}if(input.schema?.properties.approved){reviews++;return approved;}assert.fail('Une reprise visuelle ne peut pas passer par le parcours générique.');}});const initial=app.start({prompt:'Dessine une affiche sobre pour un café.'}),done=await app.wait(initial.id);assert.equal(done.status,'needs_review',done.error);assert.equal(creations,2);assert.equal(reviews,0);assert.equal(done.recovery.used,1);assert.ok(!done.events.some(event=>event.kind==='success'));assert.ok(!done.files.some(file=>/\.(?:svg|png|jpe?g|webp)$/u.test(file.path)));
});

 test('une image valide laissée avant un timeout visuel est relue strictement puis livrée sans nouvelle génération',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-visual-recovery-image-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let creations=0,reviews=0;const app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:async input=>{if(input.schema?.properties.report){creations++;writeFileSync(path.join(input.cwd,'affiche.svg'),SVG);throw timeout();}if(input.schema?.properties.approved){reviews++;assert.match(input.prompt,/inspecte les fichiers image/);assert.match(input.prompt,/sans nouvelle génération/);return approved;}assert.fail('Aucun plan, assemblage ni avis générique pour cette image.');}});const initial=app.start({prompt:'Dessine une affiche sobre pour un café.'}),done=await app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(creations,1);assert.equal(reviews,1);assert.equal(done.recovery.used,1);assert.equal(readFileSync(path.join(done.workDirectory,'Livraison/affiche.svg'),'utf8'),SVG);assert.equal(readFileSync(path.join(app.missionDir(initial.id),'recovery/attempt-1/files/t1-design/affiche.svg'),'utf8'),SVG);assert.equal(done.tasks[0].outputFingerprints.length,1);
});

 test('une panne disque lors de la réservation de reprise ne bloque ni la mission ni la maintenance',async t=>{
 const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?new Error('Ancienne panne.'):null});const initial=f.app.start({prompt:'Jeu en échec avant une erreur de disque simulée.'}),before=await f.app.wait(initial.id),calls=f.calls.length,original=f.app.save.bind(f.app);f.app.save=mission=>{if(mission.id===initial.id&&mission.phase==='Oscar prépare une reprise ciblée')throw Object.assign(new Error('Disque plein simulé.'),{code:'ENOSPC'});return original(mission);};assert.throws(()=>f.app.resume(initial.id),{code:'ENOSPC'});assert.equal(f.app.runs.has(initial.id),false);assert.equal(f.app.get(initial.id).status,before.status);assert.equal(f.app.get(initial.id).phase,before.phase);assert.equal(f.app.get(initial.id).recovery.canResume,true);assert.equal(f.calls.length,calls);assert.equal(f.app.specialistPool.active,0);f.app.save=original;
});

 test('la relecture manuelle conserve le budget épuisé, relit les fichiers corrigés et reprend seulement l’intégration encore autorisée',async t=>{
 const custom=structuredClone(modelPlan);custom.tasks[1].deliverables.push('notes.md');
 const f=fixture(t,{plan:custom,omit:({task,file})=>task.id==='t2'&&file==='notes.md',fail:({task})=>task.id==='t2'?timeout():null});
 const initial=f.app.start({prompt:'Jeu interrompu à corriger dans le même dossier.'}),before=await f.app.wait(initial.id);
 assert.equal(before.status,'needs_review');assert.equal(before.recovery.canResume,false);assert.equal(before.recovery.canRecheck,true);assert.equal(before.recovery.rechecksUsed,0);assert.equal(before.tasks[1].recoveryWriteRemaining,0);assert.equal(before.tasks[2].recoveryWriteRemaining,1);
 const beforeCalls=f.calls.length,firstBackup=readFileSync(path.join(f.app.missionDir(initial.id),'recovery/attempt-1/manifest.json'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,beforeCalls,'la nouvelle voie ne part jamais automatiquement');
 writeFileSync(path.join(before.workDirectory,'t2-design/notes.md'),'Correction personnelle à relire réellement.');
 const working=f.app.recheck(initial.id);assert.equal(working.recovery.rechecksUsed,1);assert.equal(working.recovery.used,1);assert.equal(working.recovery.canRecheck,false);assert.throws(()=>f.app.recheck(initial.id),{code:'MISSION_RECHECK_UNAVAILABLE'});
 const done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(done.workDirectory,before.workDirectory);assert.equal(done.folderName,before.folderName);assert.equal(done.tasks[1].recoveryWriteRemaining,0);assert.equal(done.tasks[2].recoveryWriteRemaining,0);assert.equal(f.creations.get('t1'),1);assert.equal(f.creations.get('t2'),2);assert.equal(f.creations.get('t3'),1);assert.equal(done.tasks[1].review.approved,true);assert.ok(f.calls.slice(beforeCalls).some(call=>call.readOnly&&call.prompt.includes('t2')));
 assert.deepEqual(readFileSync(path.join(f.app.missionDir(initial.id),'recovery/attempt-1/manifest.json')),firstBackup);
 const backup=path.join(f.app.missionDir(initial.id),'recovery/manual-recheck-1');assert.equal(readFileSync(path.join(backup,'files/t2-design/notes.md'),'utf8'),'Correction personnelle à relire réellement.');assert.equal(JSON.parse(readFileSync(path.join(backup,'previous-state.json'),'utf8')).recovery.rechecksUsed,undefined);assert.ok(!done.files.some(file=>file.path.includes('recovery/')));
 const restored=new Atelier({dataDir:f.dataDir,providers:[{id:'codex',available:true}],runAgent:f.runner});f.app=restored;assert.equal(restored.get(initial.id).recovery.rechecksUsed,1);assert.throws(()=>restored.recheck(initial.id),{code:'MISSION_RECHECK_LIMIT'});
 });

 test('une relecture sans fichier complet ni budget ne relance aucun moteur et reste à revoir',async t=>{
 const custom=structuredClone(modelPlan);custom.tasks[1].deliverables.push('notes.md');const f=fixture(t,{plan:custom,omit:({task,file})=>task.id==='t2'&&file==='notes.md',fail:({task})=>task.id==='t2'?timeout():null});
 const initial=f.app.start({prompt:'Jeu toujours incomplet.'});await f.app.wait(initial.id);const calls=f.calls.length;f.app.recheck(initial.id);const done=await f.app.wait(initial.id);
 assert.equal(done.status,'needs_review');assert.equal(done.recovery.rechecksUsed,1);assert.equal(done.tasks[1].recoveryWriteRemaining,0);assert.equal(done.tasks[1].status,'needs_review');assert.equal(done.tasks[2].status,'blocked');assert.equal(f.calls.length,calls);assert.equal(f.creations.get('t2'),2);assert.equal(f.assembly,0);
 });

 test('Oscar peut refuser les fichiers corrigés sans rendre une nouvelle écriture à un agent déjà épuisé',async t=>{
 const custom=structuredClone(modelPlan);custom.tasks[1].deliverables.push('notes.md');const f=fixture(t,{plan:custom,omit:({task,file})=>task.id==='t2'&&file==='notes.md',fail:({task})=>task.id==='t2'?timeout():null,review:({mission,rows})=>mission.recovery?.rechecksUsed?rows.map(row=>({taskId:row.taskId,approved:false,feedback:'Le contenu corrigé ne satisfait pas la demande.'})):null});
 const initial=f.app.start({prompt:'Des corrections qui doivent rester contrôlées.'}),before=await f.app.wait(initial.id);writeFileSync(path.join(before.workDirectory,'t2-design/notes.md'),'Une correction encore incomplète.');const calls=f.calls.length;f.app.recheck(initial.id);const done=await f.app.wait(initial.id);
 assert.equal(done.status,'needs_review');assert.equal(done.tasks[1].review.approved,false);assert.equal(done.tasks[1].recoveryWriteRemaining,0);assert.equal(f.creations.get('t2'),2);assert.equal(f.calls.length,calls+1);assert.equal(f.assembly,0);
 });

 test('la relecture conserve une correction non consommée après refus de la sauvegarde et ne l’emploie qu’une fois',async t=>{
 let refused=false;const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?timeout():null,review:({mission,rows})=>mission.recovery?.rechecksUsed&&!refused?(refused=true,rows.map(row=>({taskId:row.taskId,approved:row.taskId!=='t2',feedback:'Compléter le dessin.'}))):null});
 const initial=f.app.start({prompt:'Un jeu interrompu avec une correction de graphisme disponible.'});await f.app.wait(initial.id);
 const m=f.app.missions.get(initial.id);m.status='needs_review';m.tasks[1].status='needs_review';m.tasks[1].review={approved:false,feedback:'Relecture explicitement requise.'};assert.equal(m.tasks[1].recoveryWriteRemaining,1);f.app.save(m);
 f.app.recheck(initial.id);const done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(refused,true);assert.equal(f.creations.get('t2'),2);assert.equal(done.tasks[1].recoveryWriteRemaining,0);assert.equal(done.recovery.used,1);assert.equal(done.recovery.rechecksUsed,1);
 });

 test('recheck refuse les autres états, comptes, plans absents et moteurs indisponibles sans appel',async t=>{
 const f=fixture(t,{fail:({task,count})=>task.id==='t2'&&count===1?new Error('Ancienne panne.'):null});const initial=f.app.start({prompt:'Mission à ne pas replanifier.'}),before=await f.app.wait(initial.id),m=f.app.missions.get(initial.id),calls=f.calls.length;
 assert.equal(before.recovery.canRecheck,false);assert.equal(before.recovery.recheckReason,'recovery');assert.throws(()=>f.app.recheck(initial.id),{code:'MISSION_RECHECK_UNAVAILABLE'});
 m.recovery={used:1};const original=structuredClone(m);
 for(const [key,value] of [['assistant',true],['connectorRequired',true],['provider','demo'],['status','cancelled'],['status','completed'],['tasks',[]]]){m[key]=value;assert.throws(()=>f.app.recheck(initial.id),{code:'MISSION_RECHECK_UNAVAILABLE'});for(const key of Object.keys(m))delete m[key];Object.assign(m,structuredClone(original));}
 f.app.providers=[];assert.throws(()=>f.app.recheck(initial.id),{code:'MISSION_RECOVERY_PROVIDER'});assert.equal(f.app.runs.size,0);assert.equal(m.recovery.rechecksUsed,undefined);assert.equal(f.calls.length,calls);
 });

 test('la réservation recheck revient à l’état précédent si le premier enregistrement échoue',async t=>{
 const custom=structuredClone(modelPlan);custom.tasks[1].deliverables.push('notes.md');const f=fixture(t,{plan:custom,omit:({task,file})=>task.id==='t2'&&file==='notes.md',fail:({task})=>task.id==='t2'?timeout():null});const initial=f.app.start({prompt:'Jeu interrompu avant panne disque de relecture.'}),before=await f.app.wait(initial.id),calls=f.calls.length,save=f.app.save.bind(f.app);f.app.save=()=>{throw Object.assign(new Error('Disque plein simulé.'),{code:'ENOSPC'});};assert.throws(()=>f.app.recheck(initial.id),{code:'ENOSPC'});assert.equal(f.app.runs.size,0);assert.equal(f.app.get(initial.id).status,before.status);assert.equal(f.app.get(initial.id).recovery.rechecksUsed,0);assert.equal(f.app.get(initial.id).recovery.canRecheck,true);assert.equal(f.calls.length,calls);f.app.save=save;
 });

 test('le nom du deuxième dossier de sauvegarde est strict et ne peut traverser le dossier de mission',t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'oscar-recheck-bounds-')),work=path.join(dir,'travail');t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(work);writeFileSync(path.join(work,'partiel.svg'),'<svg');
 for(const name of ['../outside','manual-recheck-2','',null])assert.throws(()=>preserveRecoveryFiles({missionDirectory:dir,workDirectory:work,state:{},name}),{code:'MISSION_RECOVERY_FILES'});
 preserveRecoveryFiles({missionDirectory:dir,workDirectory:work,state:{}});const backup=preserveRecoveryFiles({missionDirectory:dir,workDirectory:work,state:{},name:'manual-recheck-1'});assert.equal(backup.directory,'recovery/manual-recheck-1');assert.throws(()=>preserveRecoveryFiles({missionDirectory:dir,workDirectory:work,state:{},name:'manual-recheck-1'}),{code:'MISSION_RECOVERY_LIMIT'});assert.deepEqual(readdirSync(path.join(dir,'recovery')).sort(),['attempt-1','manual-recheck-1']);
 });

 test('la relecture visuelle sans image et sans budget reste honnête et ne passe pas par un moteur générique',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-visual-recheck-empty-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let calls=0;const app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:async input=>{calls++;if(calls===1)throw timeout();return{text:JSON.stringify({title:'Affiche',report:'Le fichier annoncé reste absent.',deliverables:['affiche.svg']})};}});const initial=app.start({prompt:'Dessine une affiche sobre pour un café.'}),before=await app.wait(initial.id);assert.equal(before.recovery.canRecheck,true);assert.equal(before.tasks[0].recoveryWriteRemaining,0);app.recheck(initial.id);const done=await app.wait(initial.id);assert.equal(done.status,'needs_review');assert.equal(calls,2);assert.equal(done.recovery.rechecksUsed,1);assert.equal(done.tasks[0].recoveryWriteRemaining,0);
 });

 test('une image ajoutée manuellement peut être relue strictement sans renouveler le budget de création',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-visual-recheck-fixed-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let creations=0,reviews=0;const app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:async input=>{if(input.schema?.properties.report){creations++;if(creations===1)throw timeout();return{text:JSON.stringify({title:'Affiche',report:'Le fichier reste à fournir.',deliverables:['affiche.svg']})};}if(input.schema?.properties.approved){reviews++;assert.equal(input.readOnly,true);return approved;}assert.fail('Aucun plan ni assemblage générique.');}});const initial=app.start({prompt:'Dessine une affiche sobre pour un café.'}),before=await app.wait(initial.id);writeFileSync(path.join(before.workDirectory,'t1-design/affiche.svg'),SVG);app.recheck(initial.id);const done=await app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(creations,2);assert.equal(reviews,1);assert.equal(done.tasks[0].recoveryWriteRemaining,0);assert.equal(done.recovery.rechecksUsed,1);assert.equal(readFileSync(path.join(done.workDirectory,'Livraison/affiche.svg'),'utf8'),SVG);
 });

 test('la relecture finale d’un assemblage existant ne crée pas un nouvel assemblage lorsque les apports approuvés sont intacts',async t=>{
 const f=fixture(t,{finalTimeout:true});const initial=f.app.start({prompt:'Jeu déjà assemblé à relire explicitement.'});await f.app.wait(initial.id);const m=f.app.missions.get(initial.id);m.status='needs_review';m.finalReview={approved:false,feedback:'Une vérification explicite est demandée.'};f.app.save(m);const assembly=f.assembly,reviews=f.finalReviews;f.app.recheck(initial.id);const done=await f.app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(f.assembly,assembly);assert.equal(f.finalReviews,reviews+1);assert.equal(done.recovery.recheck.taskIds.length,0);assert.equal(done.recovery.used,1);
 });

 test('une relecture ne réinitialise pas les deux assemblages déjà consommés et ne valide pas leur ancien résultat',async t=>{
 const f=fixture(t,{assemblyTimeout:true});const initial=f.app.start({prompt:'Jeu dont les assemblages sont épuisés avant correction.'});await f.app.wait(initial.id);assert.equal(f.assembly,2);const m=f.app.missions.get(initial.id);m.status='needs_review';m.tasks[1].status='needs_review';m.tasks[1].recoveryWriteRemaining=0;m.tasks[1].review={approved:false,feedback:'Fichier personnel corrigé à contrôler.'};writeFileSync(path.join(f.app.workDir(initial.id),'t2-design/dessin.svg'),SVG.replace('#62896d','#336699'));f.app.save(m);const reviews=f.finalReviews;f.app.recheck(initial.id);const done=await f.app.wait(initial.id);assert.equal(done.status,'needs_review');assert.equal(f.assembly,2);assert.equal(f.finalReviews,reviews);assert.equal(done.finalReview.approved,false);assert.match(done.finalReview.feedback,/deux passages d’assemblage/);assert.equal(done.tasks[1].recoveryWriteRemaining,0);
 });

 test('la relecture d’un visuel approuvé conserve la création et remplace seulement sa copie de livraison sauvegardée',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-visual-recheck-delivery-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));let creations=0,reviews=0;const app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent:async input=>{if(input.schema?.properties.report){creations++;writeFileSync(path.join(input.cwd,'affiche.svg'),SVG);throw timeout();}if(input.schema?.properties.approved){reviews++;return approved;}assert.fail('Aucun plan ni assemblage générique.');}});const initial=app.start({prompt:'Dessine une affiche sobre pour un café.'});await app.wait(initial.id);const m=app.missions.get(initial.id),oldSVG=SVG.replace('#62896d','#cc4433');m.status='failed';m.tasks[0].recoveryMode='repair';m.tasks[0].recoveryWriteRemaining=0;writeFileSync(path.join(app.workDir(initial.id),'Livraison/affiche.svg'),oldSVG);app.save(m);app.recheck(initial.id);const done=await app.wait(initial.id);assert.equal(done.status,'completed',done.error);assert.equal(creations,1);assert.equal(reviews,2);assert.equal(done.tasks[0].recoveryWriteRemaining,0);assert.equal(readFileSync(path.join(done.workDirectory,'Livraison/affiche.svg'),'utf8'),SVG);assert.equal(readFileSync(path.join(app.missionDir(initial.id),'recovery/manual-recheck-1/files/Livraison/affiche.svg'),'utf8'),oldSVG);
 });
