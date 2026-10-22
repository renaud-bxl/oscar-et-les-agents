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
