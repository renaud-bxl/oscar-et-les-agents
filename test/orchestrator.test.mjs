import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Atelier, validatePlan, ROLES, PLAN_SCHEMA, readableMissionFolderName } from '../lib/orchestrator.mjs';
const plan = { title: 'Un message utile', approach: 'Rédaction puis contrôle.', tasks: [{ role: 'redaction', title: 'Rédiger le message', instruction: 'Écrire un message complet.', criteria: 'Un message prêt à envoyer.', deliverables: [] }] };
function setup(t, runner, options = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-test-'));
  const app = new Atelier({ dataDir, runAgent: runner, providers:[{id:'codex',available:true}], demoDelay:0, ...options });
  t.after(async () => {
    for (const id of app.runs.keys()) app.stop(id);
    await Promise.all([...app.runs.keys()].map(id => app.wait(id)));
    rmSync(dataDir, {recursive:true,force:true});
  });
  return app;
}
test('une correction doit être revue avant livraison et conserver la trace du refus', async t => {
  let reviews = 0, tasks = 0;
  const app = setup(t, async ({schema,prompt}) => {
    if (schema?.properties.tasks) return {text:JSON.stringify(plan)};
    if (schema?.properties.approved) return {text:JSON.stringify({approved:++reviews > 1,feedback:reviews === 1 ? 'Il manque la date.' : 'La date est présente.'})};
    if (prompt.includes('TU') || prompt.includes('TA TÂCHE')) { tasks++; return {text: tasks === 1 ? 'Message incomplet' : 'Message complet, daté du 19 octobre.'}; }
    return {text:'# Livraison\nMessage complet, daté du 19 octobre.'};
  });
  const m = app.start({prompt:'Prépare un message daté.',provider:'codex'});
  const done = await app.wait(m.id);
  assert.equal(done.status,'completed'); assert.equal(tasks,2); assert.equal(reviews,3);
  assert.equal(done.tasks[0].attempt,2); assert.equal(done.tasks[0].status,'approved');
  assert(done.events.some(e => e.text.includes('Il manque la date.')));
  assert.equal(readFileSync(path.join(app.workDir(m.id),'Livraison.md'),'utf8'),done.result);
});
test('deux refus restent à revoir et ne déclenchent pas de synthèse approuvée', async t => {
  let calls = 0;
  const app = setup(t, async ({schema}) => {
    calls++;
    return {text: schema?.properties.tasks ? JSON.stringify(plan) : schema?.properties.approved ? JSON.stringify({approved:false,feedback:'Critère non satisfait.'}) : 'Rapport incomplet'};
  });
  const m = app.start({prompt:'Écris un message.'}); const done = await app.wait(m.id);
  assert.equal(done.status,'needs_review'); assert.equal(calls,5);
  assert.equal(done.tasks[0].status,'needs_review'); assert(!done.files.some(f=>f.path==='Livraison.md'));
});
test('une panne du moteur ne devient jamais un travail livré', async t => {
  const app = setup(t, async () => { throw new Error('Connexion expirée.'); });
  const m = app.start({prompt:'Bonjour'}); const done = await app.wait(m.id);
  assert.equal(done.status,'failed'); assert.equal(done.error,'Connexion expirée.'); assert.equal(done.result,'');
});
test('annuler arrête le signal et préserve un statut final explicite', async t => {
  const app = setup(t, ({signal}) => new Promise((resolve,reject) => {
    signal.addEventListener('abort',()=>reject(new Error('annulé')),{once:true});
  }));
  const m = app.start({prompt:'Longue mission'}); app.stop(m.id);
  assert.equal((await app.wait(m.id)).status,'cancelled');
});
test('un échec arrête les autres spécialistes encore actifs', async t => {
  let aborted = false;
  const two = {...plan,tasks:[...plan.tasks,{...plan.tasks[0],role:'analyse'}]};
  const app = setup(t, ({schema,prompt,signal}) => {
    if (schema?.properties.tasks) return Promise.resolve({text:JSON.stringify(two)});
    if (prompt.startsWith('Tu es spécialiste de la rédaction')) return new Promise((_,reject)=>setTimeout(()=>reject(new Error('Échec rédacteur')),15));
    return new Promise((_,reject) => signal.addEventListener('abort',()=>{aborted=true;reject(new Error('annulé'));},{once:true}));
  });
  const m=app.start({prompt:'Deux tâches'}); const done=await app.wait(m.id);
  assert.equal(done.status,'failed'); assert.equal(aborted,true);
});
test('le plan refuse une équipe inventée et une liste vide', () => {
  assert.throws(()=>validatePlan(JSON.stringify({...plan,tasks:[]})));
  assert.throws(()=>validatePlan(JSON.stringify({...plan,tasks:[{...plan.tasks[0],role:'magicien'}]})));
});
test('la démo est identifiable et ne consomme aucun appel de moteur', async t => {
  let calls=0; const app=setup(t,()=>{calls++;throw new Error('Ne doit pas être appelé');});
  const m=app.start({prompt:'Découvrir le fonctionnement',provider:'demo'}); const done=await app.wait(m.id);
  assert.equal(done.status,'completed'); assert.equal(calls,0); assert.equal(done.tasks.length,8);
  assert.equal(done.tasks.filter(task => task.role === 'design').length,4);
  assert.deepEqual(done.tasks.filter(task => task.role === 'design').map(task => task.agentName),['Alma','Maya','Jade','Rose']);
  assert(done.result.includes('entièrement simulé')); assert.equal(done.tasks.find(x=>x.role==='design').attempt,2);
});

test('quatre designers distincts travaillent vraiment en parallèle dans leurs dossiers et remontent à Oscar', async t => {
  const designPlan = { title: 'Quatre directions visuelles', approach: 'Comparer quatre approches complémentaires.', tasks: Array.from({ length: 4 }, (_, i) => ({ role: 'design', title: `Direction visuelle ${i + 1}`, instruction: `Créer une proposition différente selon l’angle ${i + 1}.`, criteria: 'Un fichier visuel lisible et un argumentaire.', deliverables: ['proposition.svg'] })) };
  const waiting = [];
  const assemblyPrompts = [];
  let active = 0, peak = 0;
  let notifyFour;
  const fourStarted = new Promise(resolve => { notifyFour = resolve; });
  const app = setup(t, ({schema,prompt,cwd,signal,onActivity}) => {
    if (schema?.properties.tasks) return Promise.resolve({ text: JSON.stringify(designPlan) });
    if (schema?.properties.approved) return Promise.resolve({ text: JSON.stringify({ approved: true, feedback: 'Le fichier de cette contribution est présent et lisible.' }) });
    if (prompt.startsWith(ROLES.design.prompt)) {
      const name = prompt.match(/Ton nom dans l’équipe est ([^.]+)\./)?.[1];
      active++; peak = Math.max(peak, active);
      writeFileSync(path.join(cwd,'proposition.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><title>${name}</title></svg>`);
      onActivity(`Contribution de ${name} en cours`);
      return new Promise((resolve,reject) => {
        let settled = false;
        const onAbort = () => { if (!settled) { settled = true; active--; reject(new Error('Mission annulée')); } };
        const release = () => {
          if (settled) return;
          settled = true; active--; signal.removeEventListener('abort',onAbort);
          resolve({text:`Rapport complet de ${name}. Le fichier proposition.svg présente cette approche.`});
        };
        signal.addEventListener('abort',onAbort,{once:true});
        waiting.push({name,cwd,prompt,release});
        if (waiting.length === 4) notifyFour();
      });
    }
    assemblyPrompts.push(prompt);
    return Promise.resolve({text:'Les quatre contributions sont comparées et réunies dans cette livraison.'});
  });
  const mission = app.start({prompt:'Recrute quatre designers pour explorer quatre directions visuelles.'});
  let timeout;
  try {
    await Promise.race([fourStarted,new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('Les quatre designers ne se sont pas mis au travail ensemble.')),1500); })]);
  } finally { clearTimeout(timeout); }
  assert.equal(app.concurrency,4);
  assert.equal(active,4); assert.equal(peak,4);
  assert.deepEqual(waiting.map(item=>item.name),ROLES.design.names);
  assert.equal(new Set(waiting.map(item=>item.cwd)).size,4);
  const working = app.get(mission.id);
  assert.equal(working.tasks.filter(task=>task.status==='working').length,4);
  for (const item of waiting) {
    assert.match(item.cwd,/t[1-4]-design$/);
    assert.ok(working.events.some(event=>event.who===item.name && event.text.includes('Contribution')));
    assert.ok(readFileSync(path.join(item.cwd,'proposition.svg'),'utf8').includes(item.name));
    item.release();
  }
  const done = await app.wait(mission.id);
  assert.equal(done.status,'completed');
  assert.equal(done.tasks.length,4); assert.equal(new Set(done.tasks.map(task=>task.agentName)).size,4);
  for (const task of done.tasks) {
    assert.equal(task.status,'approved');
    assert.ok(readFileSync(path.join(app.workDir(mission.id),'Rapports',`${task.id}-design.md`),'utf8').includes(`Spécialiste : ${task.agentName}`));
    assert.ok(assemblyPrompts[0].includes(task.agentName));
  }
});

test('le recrutement accepte vingt tâches réparties mais refuse un cinquième agent du même métier', () => {
  const tasks = Object.keys(ROLES).flatMap(role=>Array.from({length:4},(_,i)=>({...plan.tasks[0],role,title:`${role} ${i+1}`,deliverables:['contribution.md']})));
  assert.equal(validatePlan(JSON.stringify({...plan,tasks})).tasks.length,20);
  assert.throws(()=>validatePlan(JSON.stringify({...plan,tasks:[...tasks,tasks[0]]})),/1 à 20/);
  const designers = Array.from({length:5},(_,i)=>({...plan.tasks[0],role:'design',title:`Piste ${i+1}`,deliverables:['piste.svg']}));
  assert.throws(()=>validatePlan(JSON.stringify({...plan,tasks:designers})),/maximum 4 agents/);
  assert.equal(PLAN_SCHEMA.properties.tasks.maxItems,20);
  const taskSchema = PLAN_SCHEMA.properties.tasks.items;
  assert.deepEqual(Object.keys(taskSchema.properties).sort(),[...taskSchema.required].sort());
  assert.equal(Object.hasOwn(taskSchema.properties,'agentName'),false);
  assert.equal(new Set(Object.values(ROLES).flatMap(role=>role.names)).size,20);
});

test('un ancien spécialiste sans agentName conserve son identité dans les appels, événements et rapports', async t => {
  const prompts = [];
  const app = setup(t,async({schema,prompt,onActivity})=>{
    prompts.push(prompt);
    if (schema?.properties.approved) return {text:JSON.stringify({approved:true,feedback:'Le texte répond aux critères.'})};
    onActivity('Rédaction en cours');
    return {text:'Le message complet du spécialiste historique.'};
  });
  const task = { ...plan.tasks[0], id:'t1', report:'', status:'queued', review:null, attempt:0 };
  const mission = {id:'historique',title:'Un ancien dossier',prompt:'Rédiger un message',provider:'codex',createdAt:Date.now(),status:'running',tasks:[task],events:[],files:[]};
  app.missions.set(mission.id,mission);
  await app.performTask(mission,task,new AbortController().signal);
  assert.equal(task.agentName,undefined);
  assert.equal(task.status,'approved');
  assert.ok(prompts[0].includes('Ton nom dans l’équipe est Noé.'));
  assert.ok(prompts[1].includes('rapport de Noé'));
  assert.ok(mission.events.some(event=>event.who==='Noé'));
  assert.ok(readFileSync(path.join(app.workDir(mission.id),'Rapports','t1-redaction.md'),'utf8').includes('Spécialiste : Noé'));
});

test('la démo montre quatre designers simultanés, respecte quatre agents actifs et conserve la correction', async t => {
  const app = setup(t,()=>{throw new Error('Aucun moteur ne doit être appelé dans la démonstration.');});
  let peak = 0, fourDesigners = false;
  app.on('change',state=>{
    const mission = state.activeMissions.find(item=>item.provider==='demo');
    if (!mission) return;
    const active = mission.tasks.filter(task=>['working','revising','reviewing'].includes(task.status));
    peak = Math.max(peak,active.length);
    if (active.filter(task=>task.role==='design').length===4) fourDesigners = true;
  });
  const mission = app.start({prompt:'Découvrir une équipe élargie',provider:'demo'});
  const done = await app.wait(mission.id);
  assert.equal(peak,4); assert.equal(fourDesigners,true);
  assert.equal(done.tasks.length,8); assert.equal(new Set(done.tasks.map(task=>task.agentName)).size,8);
  assert.equal(done.tasks.find(task=>task.agentName==='Alma').attempt,2);
  assert.equal(done.tasks.filter(task=>task.attempt===2).length,1);
  assert.ok(done.events.some(event=>event.text.includes('Alma, améliore le contraste')));
  assert.ok(done.tasks.every(task=>task.report.includes(task.agentName)));
});
test('un redémarrage conserve les livrables et rétablit les missions terminées',async t=>{
  const app=setup(t,()=>{}); const m=app.start({prompt:'Démo',provider:'demo'});await app.wait(m.id);
  const restored=new Atelier({dataDir:app.dataDir,runAgent:()=>{},providers:[]});
  assert.equal(restored.get(m.id).status,'completed');assert.equal(restored.get(m.id).files.length,1);
});
test('un fichier obligatoire absent reste refusé même si le modèle le déclare validé',async t=>{
  const p={...plan,tasks:[{...plan.tasks[0],role:'code',deliverables:['index.html']}]};
  const app=setup(t,async({schema})=>({text:schema?.properties.tasks?JSON.stringify(p):schema?.properties.approved?JSON.stringify({approved:true,feedback:'J’affirme que le fichier existe.'}):'J’ai créé index.html.'}));
  const m=app.start({prompt:'Crée index.html'});const done=await app.wait(m.id);
  assert.equal(done.status,'needs_review');assert.equal(done.tasks[0].review.approved,false);
  assert.match(done.tasks[0].review.feedback,/index.html/);
});
test('un assemblage final refusé ne devient jamais une mission livrée',async t=>{
  let reviews=0;
  const app=setup(t,async({schema})=>({text:schema?.properties.tasks?JSON.stringify(plan):schema?.properties.approved?JSON.stringify({approved:++reviews===1,feedback:reviews===1?'Tâche acceptée.':'Livraison globale insuffisante.'}):'Un rapport'}));
  const m=app.start({prompt:'Un texte'});const done=await app.wait(m.id);
  assert.equal(done.status,'needs_review');assert.equal(done.finalReview.approved,false);
  assert.match(done.result,/Livraison à revoir/);
});

test('quatre missions indépendantes travaillent ensemble ; annuler l’une préserve les trois autres', async t => {
  const planning = [];
  const app = setup(t, ({ schema, prompt, cwd, signal, provider }) => {
    if (schema?.properties.tasks) {
      const marker = prompt.split('\n\nMISSION :\n').at(-1);
      writeFileSync(path.join(cwd, 'preuve.txt'), marker);
      return new Promise((resolve, reject) => {
        const entry = { cwd, signal, provider, marker, release: () => resolve({ text: JSON.stringify(plan) }) };
        planning.push(entry);
        signal.addEventListener('abort', () => reject(new Error('Mission annulée')), { once: true });
      });
    }
    return Promise.resolve({ text: schema?.properties.approved ? JSON.stringify({ approved: true, feedback: 'Les critères sont respectés.' }) : 'Le rapport de cette mission est prêt.' });
  }, { providers: [{ id: 'codex', available: true }, { id: 'claude', available: true }] });
  const missions = Array.from({ length: 4 }, (_, index) => app.start({ prompt: `Projet indépendant ${index + 1}`, provider: index % 2 === 0 ? 'codex' : 'claude' }));
  await new Promise(resolve => setImmediate(resolve)); // Reference preparation finishes before the runners start.
  assert.equal(planning.length, 4);
  assert.equal(new Set(planning.map(entry => entry.signal)).size, 4);
  assert.equal(new Set(planning.map(entry => entry.cwd)).size, 4);
  assert.equal(app.state().maxConcurrentMissions, 4);
  assert.equal(app.state().activeMissions.length, 4);
  assert.equal(app.state().active.id, missions[3].id);
  assert.equal(app.state().dataLocation, 'Documents/Oscar et les agents');
  assert.throws(() => app.start({ prompt: 'Un cinquième projet' }), error => error.code === 'MISSION_CAPACITY');
  assert.equal(app.state().missions.length, 4);

  app.stop(missions[1].id);
  assert.equal((await app.wait(missions[1].id)).status, 'cancelled');
  assert.equal(planning[1].signal.aborted, true);
  assert.equal(app.state().activeMissions.length, 3);
  for (const index of [0, 2, 3]) {
    assert.equal(planning[index].signal.aborted, false);
    assert.equal(app.get(missions[index].id).status, 'planning');
    planning[index].release();
  }
  const completed = await Promise.all([0, 2, 3].map(index => app.wait(missions[index].id)));
  assert.ok(completed.every(mission => mission.status === 'completed'));
  assert.equal(app.state().active, null);
  assert.deepEqual(app.state().activeMissions, []);
  assert.equal(app.state().missions.length, 4);
  for (let index = 0; index < missions.length; index++) {
    const mission = app.get(missions[index].id);
    assert.equal(mission.prompt, `Projet indépendant ${index + 1}`);
    assert.equal(readFileSync(path.join(app.workDir(mission.id), 'preuve.txt'), 'utf8'), mission.prompt);
    assert.ok(mission.files.some(file => file.path === 'preuve.txt'));
  }
});

test('l’état public est indépendant des objets des missions et les préférences viennent du dossier de données', async t => {
  const app = setup(t, () => {});
  writeFileSync(path.join(app.dataDir, 'preferences.json'), JSON.stringify({ preferredProvider: 'claude' }));
  const restored = new Atelier({ dataDir: app.dataDir, runAgent: () => {}, providers: [], demoDelay: 1800 });
  assert.equal(restored.state().preferredProvider, 'claude');
  assert.equal(restored.demoDelay, 1800);
  const mission = app.start({ prompt: 'Démo', provider: 'demo' });
  const snapshot = app.state();
  snapshot.activeMissions[0].prompt = 'Modification extérieure';
  assert.equal(app.get(mission.id).prompt, 'Démo');
  await app.wait(mission.id);
});

test('les dossiers portent une date et un nom lisible ; les collisions ne montrent aucun UUID',async t=>{
 const app=setup(t,async()=>{throw new Error('Pas de modèle');});
 const first=app.start({prompt:'Mon café à Bruxelles',provider:'demo'}),second=app.start({prompt:'Mon café à Bruxelles',provider:'demo'});
 await Promise.all([app.wait(first.id),app.wait(second.id)]);
 const name=path.basename(app.missionDir(first.id));assert.match(name,/^\d{4}-\d{2}-\d{2} — Mon café à Bruxelles$/);assert.equal(path.basename(app.missionDir(second.id)),name+' (2)');assert(!name.includes(first.id));
 assert.equal(readFileSync(path.join(app.workDir(first.id),'Demonstration.md'),'utf8'),app.get(first.id).result);
 const restored=new Atelier({dataDir:app.dataDir,runAgent:()=>{throw new Error('Pas de modèle');}});assert.equal(restored.get(first.id).id,first.id);assert.equal(restored.workDir(first.id),app.workDir(first.id));
});

test('les noms neutralisent traversée, points et contrôles en conservant accents et taille sûre',()=>{
 const name=readableMissionFolderName(' ../Été/../../Café\\ : nom?\0\u202e\nLigne ignorée',new Date(2026,9,19).getTime());
 assert.equal(name,'2026-10-19 — Été Café nom');assert(!/[./\\\x00]/.test(name));
 const long=readableMissionFolderName('🎨'.repeat(200));assert(Buffer.byteLength(long,'utf8')<240);assert.match(readableMissionFolderName('.../..'),/ — Mission$/);
});

function seedMissionFolder(root,id,{status='completed',title='Ancien café à Liège',createdAt=new Date(2026,9,18).getTime(),folder=id}={}){
 const dir=path.join(root,'missions',folder);mkdirSync(path.join(dir,'travail'),{recursive:true});const value={id,title,prompt:title,status,provider:'demo',createdAt,updatedAt:createdAt,tasks:[],events:[],files:[{path:'preuve.txt',size:8}],result:'Livraison existante'};writeFileSync(path.join(dir,'state.json'),JSON.stringify(value));writeFileSync(path.join(dir,'travail','preuve.txt'),'PRÉSERVÉ');return dir;
}

test('migration au démarrage : anciens UUID terminés, état et livrables conservés sans écraser un homonyme',t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'oscar-readable-migration-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const existing=readableMissionFolderName('Ancien café à Liège',new Date(2026,9,18).getTime());seedMissionFolder(root,other,{folder:existing});const old=seedMissionFolder(root,id);
 const app=new Atelier({dataDir:root});assert.equal(path.basename(app.missionDir(id)),existing+' (2)');assert(!existsSync(old));assert.equal(readFileSync(path.join(app.workDir(id),'preuve.txt'),'utf8'),'PRÉSERVÉ');assert.equal(readFileSync(path.join(app.workDir(other),'preuve.txt'),'utf8'),'PRÉSERVÉ');assert.equal(app.get(id).id,id);
 const again=new Atelier({dataDir:root});assert.equal(again.workDir(id),app.workDir(id));assert.equal(again.get(id).result,'Livraison existante');
});

test('un ancien dossier peut encore être utilisé : son chemin actif ne change pas au redémarrage',t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'oscar-readable-active-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const id='33333333-3333-4333-8333-333333333333';const old=seedMissionFolder(root,id,{status:'running'});const app=new Atelier({dataDir:root});assert.equal(app.missionDir(id),old);assert.equal(app.get(id).status,'cancelled');assert.equal(readFileSync(path.join(old,'travail','preuve.txt'),'utf8'),'PRÉSERVÉ');
});

test('les missions actives gardent leur dossier quand Oscar change le titre ; les liens symboliques ne sont pas suivis',async t=>{
 let release;const app=setup(t,({signal})=>new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(new Error('Arrêt')),{once:true});}));const m=app.start({prompt:'Titre initial'}),before=app.workDir(m.id);app.missions.get(m.id).title='Titre final d’Oscar';app.save(app.missions.get(m.id));assert.equal(app.workDir(m.id),before);app.stop(m.id);await app.wait(m.id);
 const outside=mkdtempSync(path.join(os.tmpdir(),'oscar-folder-link-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));const expected=readableMissionFolderName('Mission liée');symlinkSync(outside,path.join(app.dataDir,'missions',expected));const linked=app.start({prompt:'Mission liée',provider:'demo'});await app.wait(linked.id);assert.equal(path.basename(app.missionDir(linked.id)),expected+' (2)');assert.deepEqual(readdirSync(outside),[]);
 const malicious='44444444-4444-4444-8444-444444444444';symlinkSync(outside,path.join(app.dataDir,'missions',malicious));const restored=new Atelier({dataDir:app.dataDir});assert.equal(restored.get(malicious),null);
});
