import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Atelier, validatePlan } from '../lib/orchestrator.mjs';
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
  assert.equal(done.status,'completed'); assert.equal(calls,0); assert.equal(done.tasks.length,5);
  assert(done.result.includes('entièrement simulé')); assert.equal(done.tasks.find(x=>x.role==='design').attempt,2);
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
