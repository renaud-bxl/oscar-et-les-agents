import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, copyFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Atelier } from '../lib/orchestrator.mjs';

// Deliberately independent of the planner's prompt wording and task titles.
// The runner is simulated; files and the mission scheduler are real and local.
const brief = 'Crée un jeu d’arcade 2D jouable localement dans le navigateur : préparer des pizzas avec les bons ingrédients, un score, trois niveaux et un bouton recommencer.';
const entryFiles = ['index.html', 'ui.js', 'game-engine.js', 'ui-theme.css', 'illustrations.svg', 'texts.json', 'README.md'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = id => `Contribution locale simulée et vérifiée ${id} — ORIGINAL-${id}.`;
function contribution(root, relative) {
  if (!existsSync(root)) return null;
  for (const item of readdirSync(root, {withFileTypes:true})) {
    assert.equal(item.isSymbolicLink(),false,'Approved copies must not contain symbolic links.');
    const target=path.join(root,item.name);
    if (item.isDirectory()) { const match=contribution(target,relative);if(match)return match; }
    else if (item.isFile() && target.endsWith(path.sep+relative)) return target;
  }
  return null;
}

function setup(t, options = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-recruitment-check-'));
  const trace = [], held = [];
  let app, active = 0, maximum = 0, firstHeld;
  const heldStarted = new Promise(resolve => { firstHeld = resolve; });
  const locate = cwd => [...app.missions.values()].find(mission => cwd === app.workDir(mission.id) || cwd.startsWith(app.workDir(mission.id) + path.sep));
  const runner = async input => {
    active++; maximum = Math.max(maximum, active);
    try {
      const mission = locate(input.cwd);
      assert.ok(mission, 'Each call must belong to exactly one local mission.');
      const folder = path.basename(input.cwd), task = mission.tasks.find(item => `${item.id}-${item.role}` === folder);
      if (input.schema?.properties.tasks) assert.fail('A clear local game should receive the real built-in team plan, not a simulated model plan.');
      if (input.schema?.properties.reviews) {
        const reviewing = mission.tasks.filter(item => item.status === 'reviewing');
        assert.ok(reviewing.length, 'A batch review must inspect actual submitted contributions.');
        trace.push({ missionId: mission.id, kind: 'batch-review', ids: reviewing.map(item => item.id) });
        options.beforeBatchReview?.({mission,input,app,reviewing});
        return { text: JSON.stringify({ reviews: reviewing.map(item => ({ taskId: item.id, approved: !(options.rejectResearch && item.role === 'recherche'), feedback: options.rejectResearch && item.role === 'recherche' ? 'Sources insuffisantes, à reprendre.' : 'Le fichier et le rapport simulés sont présents.' })) }) };
      }
      if (input.schema?.properties.approved) return { text: JSON.stringify({ approved: true, feedback: 'Contrôle modèle simulé favorable ; les postconditions matérielles doivent encore s’appliquer.' }) };
      if (task) {
        trace.push({ missionId: mission.id, kind: 'creation', taskId: task.id, role: task.role, folder });
        for (const dependencyId of task.dependsOn || []) {
          const dependency = mission.tasks.find(item => item.id === dependencyId);
          assert.equal(dependency?.status, 'approved', `Task ${task.id} cannot start before ${dependencyId} is approved.`);
          assert.ok(input.prompt.includes(report(dependencyId)), `Task ${task.id} must receive ${dependencyId}'s actual approved report.`);
        }
        for (const relative of task.deliverables) {
          if(options.omitEntry && relative==='index.html')continue;
          const target = path.join(input.cwd, relative);
          assert.ok(target.startsWith(input.cwd + path.sep));
          mkdirSync(path.dirname(target), { recursive: true });
          const approved=contribution(path.join(input.cwd,'Contributions'),relative);
          if(approved){
            if(!existsSync(target)||!readFileSync(target).equals(readFileSync(approved)))copyFileSync(approved,target);
            continue;
          }
          const contents = relative==='index.html' ? '<!doctype html><html lang="fr"><head><title>Jeu simulé</title><link rel="stylesheet" href="ui-theme.css"></head><body><main id="game-root"></main><script src="game-engine.js"></script><script src="ui.js"></script></body></html>' : relative.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' : relative.endsWith('.json') ? '{"start":"Jouer"}' : `Fichier simulé ${task.id} : ${relative}`;
          writeFileSync(target, contents);
        }
        options.afterOutputs?.({task,input,mission,app});
        if (options.shouldHold?.(mission)) {
          held.push({ missionId: mission.id, taskId: task.id, signal: input.signal }); firstHeld();
          await new Promise((resolve, reject) => {
            const stop = () => reject(new Error('Arrêt local simulé.'));
            input.signal.addEventListener('abort', stop, { once: true });
            if (input.signal.aborted) stop();
          });
        }
        await delay(2);
        return { text: report(task.id) };
      }
      trace.push({ missionId: mission.id, kind: 'assembly' });
      assert.fail('An approved assembled game must be copied locally, without a redundant assembly model call.');
    } finally { active--; }
  };
  app = new Atelier({ dataDir, providers: [{ id: 'codex', available: true }], runAgent: runner, concurrency: 4 });
  t.after(async () => {
    for (const id of app.runs.keys()) app.stop(id);
    await Promise.all([...app.runs.keys()].map(id => app.wait(id)));
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, trace, held, heldStarted, get maximum() { return maximum; } };
}

test('independent recruitment check: all game trades contribute before dependent code, with four calls maximum', async t => {
  const fixture = setup(t), started = fixture.app.start({ prompt: brief }), done = await fixture.app.wait(started.id);
  assert.equal(done.status, 'completed', done.error || done.finalReview?.feedback);
  assert.equal(done.executionMode, 'local-game-team');
  assert.deepEqual([...new Set(done.tasks.map(item => item.role))].sort(), ['analyse', 'code', 'design', 'recherche', 'redaction']);
  const coders = done.tasks.filter(item => item.role === 'code'); assert.ok(coders.length >= 2);
  const duplicated=coders[0].deliverables.filter(file=>coders.at(-1).deliverables.includes(file));
  for(const filename of duplicated){
    const source=path.join(fixture.app.workDir(started.id),`${coders[0].id}-code`,filename),integrated=path.join(fixture.app.workDir(started.id),`${coders.at(-1).id}-code`,filename);
    assert.deepEqual(readFileSync(integrated),readFileSync(source),'An integration copy must preserve the approved module.');
  }
  assert.ok(done.tasks.every(item => item.status === 'approved')); assert.ok(fixture.maximum > 1 && fixture.maximum <= 4);
  for (const role of ['analyse', 'code', 'design', 'recherche', 'redaction']) assert.ok(done.tasks.filter(item => item.role === role).length <= 4);
  for (const filename of entryFiles) assert.ok(readFileSync(path.join(fixture.app.workDir(started.id), 'Livraison', filename)).length > 0);
  assert.ok(!fixture.trace.some(item => item.kind === 'assembly'));
  assert.equal(done.finalReview?.approved,true);
  assert.equal(done.performance.calls.at(-1)?.stage,'final-review');
  assert.equal(done.performance.calls.length,done.tasks.length+3,'Normal progress needs the creations, two grouped reviews and the final game review.');
});

test('independent recruitment check: rejected research cannot silently feed code or become a completed game', async t => {
  const fixture = setup(t, { rejectResearch: true }), started = fixture.app.start({ prompt: brief }), done = await fixture.app.wait(started.id);
  assert.equal(done.status, 'needs_review', done.error);
  assert.ok(done.tasks.some(item => item.role === 'recherche' && item.status !== 'approved'));
  assert.ok(!fixture.trace.some(item => item.kind === 'creation' && item.role === 'code'));
  assert.ok(!fixture.trace.some(item => item.kind === 'assembly')); assert.ok(!done.events.some(item => item.kind === 'success'));
  assert.ok(done.files.length > 0, 'The submitted contributions must remain available.');
});

test('independent recruitment check: a favorable model cannot approve a missing playable delivery', async t => {
  const fixture = setup(t, { omitEntry: true }), started = fixture.app.start({ prompt: brief }), done = await fixture.app.wait(started.id);
  assert.equal(done.status, 'needs_review', done.error);
  assert.equal(existsSync(path.join(fixture.app.workDir(started.id), 'Livraison', 'index.html')), false);
  assert.ok(done.tasks.some(item => item.status !== 'approved'));
  assert.equal(done.finalReview?.approved, false); assert.ok(!done.events.some(item => item.kind === 'success'));
  assert.ok(done.files.some(item => item.path.endsWith('/game-engine.js')), 'The approved engine must be preserved.');
});

test('independent recruitment check: cancelling a game stops its queued dependencies and preserves another mission', async t => {
  let heldMissionId;
  const fixture = setup(t, { shouldHold: mission => mission.id === heldMissionId });
  const first = fixture.app.start({ prompt: brief }); heldMissionId = first.id;
  await Promise.race([fixture.heldStarted, fixture.app.wait(first.id).then(done => assert.fail(`The first game ended before starting a contribution: ${done.error || done.status}`))]);
  const second = fixture.app.start({ prompt: brief + ' Appelle le jeu Pizzas du deuxième bureau.' });
  const secondDone = await fixture.app.wait(second.id); assert.equal(secondDone.status, 'completed', secondDone.error);
  fixture.app.stop(first.id); const firstDone = await fixture.app.wait(first.id);
  assert.equal(firstDone.status, 'cancelled'); assert.ok(fixture.held.every(item => item.signal.aborted));
  assert.ok(!fixture.trace.some(item => item.missionId === first.id && item.kind === 'creation' && item.role === 'code'));
  assert.ok(!fixture.trace.some(item => item.missionId === first.id && item.kind === 'assembly'));
  assert.equal(fixture.app.get(second.id).status, 'completed'); assert.ok(firstDone.files.length > 0);
});

test('independent recruitment check: changed input copies never become an approved contribution', async t => {
  let attacked;
  const fixture=setup(t,{afterOutputs:({task,input,mission,app})=>{
    if(attacked||task.role!=='design'||!task.inputContributions?.length)return;
    const inputFile=task.inputContributions[0].files[0],copy=path.join(input.cwd,inputFile.path);
    const sourceTask=mission.tasks.find(item=>item.id===task.inputContributions[0].taskId);
    const relative=inputFile.path.slice(`Contributions/${sourceTask.id}-${sourceTask.role}/`.length);
    const source=path.join(app.workDir(mission.id),`${sourceTask.id}-${sourceTask.role}`,relative);
    attacked={taskId:task.id,sourceTaskId:sourceTask.id,source,original:readFileSync(source)};
    chmodSync(copy,0o600);writeFileSync(copy,'COPIE MODIFIÉE À REFUSER');
  }});
  const started=fixture.app.start({prompt:brief}),done=await fixture.app.wait(started.id);
  assert.ok(attacked);assert.equal(done.status,'needs_review',done.error);
  assert.notEqual(done.tasks.find(item=>item.id===attacked.taskId).status,'approved');
  assert.equal(done.tasks.find(item=>item.id===attacked.sourceTaskId).status,'approved','A damaged recipient copy must not accuse the unchanged source specialist.');
  assert.deepEqual(readFileSync(attacked.source),attacked.original);
  assert.equal(existsSync(path.join(fixture.app.workDir(started.id),'Livraison')),false);
  assert.ok(!done.events.some(item=>item.kind==='success'));
});

test('independent recruitment check: a linked Contributions parent cannot redirect approved copies', async t => {
  const outside=mkdtempSync(path.join(os.tmpdir(),'oscar-recruitment-outside-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  writeFileSync(path.join(outside,'sentinel.txt'),'FICHIER À CONSERVER');
  let attacked;
  const fixture=setup(t,{beforeBatchReview:({mission,app})=>{
    if(attacked)return;
    const task=mission.tasks.find(item=>item.role==='design'&&item.dependsOn.length);
    const folder=path.join(app.workDir(mission.id),`${task.id}-${task.role}`);mkdirSync(folder);
    symlinkSync(outside,path.join(folder,'Contributions'));attacked=task.id;
  }});
  const started=fixture.app.start({prompt:brief}),done=await fixture.app.wait(started.id);
  assert.ok(attacked);assert.equal(done.status,'needs_review',done.error);
  assert.notEqual(done.tasks.find(item=>item.id===attacked).status,'approved');
  assert.deepEqual(readdirSync(outside),['sentinel.txt']);assert.equal(readFileSync(path.join(outside,'sentinel.txt'),'utf8'),'FICHIER À CONSERVER');
  assert.ok(!done.events.some(item=>item.kind==='success'));
});

test('independent recruitment check: an upstream change between sibling preparations prevents every stale dispatch', async t => {
  const fixture=setup(t),original=fixture.app.dependencyInputs.bind(fixture.app);
  let changed;
  fixture.app.dependencyInputs=(mission,task,cwd)=>{
    const inputs=original(mission,task,cwd);
    if(!changed && task.dependsOn.length){
      const sourceTask=mission.tasks.find(item=>item.id===task.dependsOn[0]);
      const source=path.join(fixture.app.workDir(mission.id),`${sourceTask.id}-${sourceTask.role}`,sourceTask.outputFingerprints[0].path);
      writeFileSync(source,'SOURCE MODIFIÉE ENTRE DEUX PRÉPARATIONS');
      changed={sourceTaskId:sourceTask.id,preparedTaskId:task.id};
    }
    return inputs;
  };
  const started=fixture.app.start({prompt:brief}),done=await fixture.app.wait(started.id);
  assert.ok(changed);assert.equal(done.status,'needs_review',done.error);
  assert.equal(done.tasks.find(item=>item.id===changed.sourceTaskId).status,'needs_review');
  assert.ok(!fixture.trace.some(item=>item.kind==='creation'&&item.taskId===changed.preparedTaskId),'A previously prepared task must not run after a shared prerequisite is invalidated.');
  assert.ok(!fixture.trace.some(item=>item.kind==='creation'&&done.tasks.find(task=>task.id===item.taskId).dependsOn.length));
  assert.ok(!done.events.some(item=>item.kind==='success'));
});
