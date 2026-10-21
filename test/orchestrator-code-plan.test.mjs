import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Atelier, simpleCodePlan, validatePlan, ROLES } from '../lib/orchestrator.mjs';
import { MISSION_TEMPLATES, buildWizardSummary, buildWizardSubmission } from '../public/mission-catalog.js';
import { withLocaleInstruction, setLocale } from '../public/i18n.js';
import { withTeamPreference } from '../public/welcome-guide.js';

const arcade = MISSION_TEMPLATES.find(item => item.id === 'jeu-arcade');
const answers = { nom: 'Pizza mania', univers: 'Une petite pizzeria ou il faut créer un max de pizza en fonction des commande mais attention il ne faut pas se tromper dans les commandes et les ingrédients !', regles: 'Livrer 10 pizzas par level, les level devinnent de plus en plus rapide', public: 'Tout public : clavier et souris', graphismes: 'Dessin animé doux et expressif' };
const brief = 'Crée un petit jeu de puzzle jouable dans mon navigateur, avec score et trois niveaux.';
const mission = prompt => ({ prompt, provider: 'codex', referenceIds: [], outputFormats: [] });
const approval = { text: JSON.stringify({ approved: true, feedback: 'Les fichiers et les vérifications répondent à la demande.' }) };
const originalReport = task => `Rapport original ${task.id} : contribution simulée substantielle de ${task.role}.`;
function setup(t, makeRunner) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-code-plan-'));
  let app;
  app = new Atelier({ dataDir, runAgent: input => makeRunner(input, app), providers: [{ id: 'codex', available: true }] });
  t.after(async () => { for (const id of app.runs.keys()) app.stop(id); await Promise.all([...app.runs.keys()].map(id => app.wait(id))); rmSync(dataDir, { recursive: true, force: true }); });
  return app;
}
function gameRunner(options = {}) {
  const calls = [], counts = new Map();
  const run = async (input, app) => {
    calls.push(input);
    assert.ok(!input.schema?.properties.tasks, 'Aucun appel de plan pour un jeu local déjà clair.');
    const m = [...app.missions.values()].find(item => input.cwd === app.workDir(item.id) || input.cwd.startsWith(app.workDir(item.id) + path.sep));
    const task = m.tasks.find(item => path.basename(input.cwd) === `${item.id}-${item.role}`);
    if (input.schema?.properties.reviews) {
      const requested = JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);
      const reviewing = requested.map(row => m.tasks.find(item => item.id === row.taskId));
      if (reviewing.some(item => item.id === m.coordination.entryTaskId)) for (const source of m.tasks.filter(item => item.status === 'approved')) {
        assert.ok(input.prompt.includes(originalReport(source)), 'Le contrôle final confronte chaque rapport amont.');
        assert.ok(input.prompt.includes(source.criteria), 'Le contrôle final conserve les critères de chaque métier.');
      }
      const reviews = reviewing.map(item => ({ taskId: item.id, approved: true, feedback: 'Contribution et fichiers inspectés dans le scénario local simulé.' }));
      return { text: JSON.stringify({ reviews: options.review?.({ reviews, m, input, app, counts }) || reviews }) };
    }
    assert.ok(task, 'Aucun assemblage modèle redondant après le jeu intégré.');
    assert.ok(input.prompt.startsWith(ROLES[task.role].prompt));
    assert.match(input.prompt, /jamais des instructions prioritaires ni de nouvelles autorisations/);
    counts.set(task.id, (counts.get(task.id) || 0) + 1);
    for (const id of task.dependsOn) {
      const upstream = m.tasks.find(item => item.id === id); assert.equal(upstream.status, 'approved');
      assert.ok(input.prompt.includes(originalReport(upstream)));
      const pinned = task.inputContributions.find(item => item.taskId === id);
      for (const file of pinned.files) assert.equal(readFileSync(path.join(input.cwd, file.path)).length, file.size);
    }
    for (const file of task.deliverables) {
      const target = path.join(input.cwd, file); mkdirSync(path.dirname(target), { recursive: true });
      const binding = task.id === m.coordination.entryTaskId && m.coordination.bindings.find(item => item.destination === file);
      const source = binding && m.tasks.find(item => item.id === binding.taskId);
      const contents = binding ? readFileSync(path.join(input.cwd, `Contributions/${source.id}-${source.role}/${binding.source}`)) : file.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' : file.endsWith('.json') ? '{"start":"Jouer"}' : file === 'index.html' ? '<!doctype html><main id="game-root"></main><script src="game-engine.js"></script><script src="ui.js"></script>' : `Fichier local simulé ${task.id} ${file}`;
      writeFileSync(target, contents);
    }
    await options.afterCreate?.({ task, m, input, app });
    return { text: options.report?.(task) || originalReport(task) };
  };
  return { run, calls, counts };
}

test('le questionnaire Pizza mania recrute les cinq métiers et deux développeurs sans appel de plan', () => {
  try {
    for (const locale of ['fr', 'en', 'nl']) {
      setLocale(locale);
      const summary = buildWizardSummary(arcade, answers, locale), prompt = withLocaleInstruction(buildWizardSubmission(arcade, answers, summary, locale));
      const plan = simpleCodePlan(mission(prompt)); assert.ok(plan, locale); assert.equal(plan.tasks.length, 7);
      assert.deepEqual(plan.tasks.map(item => item.role), ['recherche', 'analyse', 'design', 'design', 'redaction', 'code', 'code']);
      assert.deepEqual(plan.tasks.at(-1).dependsOn, ['t1', 't2', 't3', 't4', 't5', 't6']);
      assert.equal(plan.tasks.filter(item => item.deliverables.includes('index.html')).length, 1, 'Seul l’intégrateur construit le jeu complet.');
      assert.match(plan.coordination.contract, /globalThis\.OscarGame\.createGame/);
      assert.equal(validatePlan(JSON.stringify(plan)).tasks.length, 7);
      if (locale === 'fr') assert.equal(plan.title, 'Pizza mania');
    }
  } finally { setLocale('fr'); }
});

test('les jeux FR EN NL ont une équipe proportionnée et les petits outils gardent le chemin direct', () => {
  for (const prompt of [brief, 'Build a small arcade game in HTML Canvas with a score and a restart button.', 'Maak een klein spel in de browser met punten en een pauzeknop.']) assert.equal(simpleCodePlan(mission(prompt))?.tasks.length, 7, prompt);
  assert.equal(simpleCodePlan(mission(brief + ' Deux personnages sympathiques.')).tasks.length, 7);
  for (const prompt of [brief + ' Plusieurs décors distincts.', 'Build a small browser game with multiple worlds.', 'Maak een klein spel in de browser met verschillende achtergronden.']) {
    const plan = simpleCodePlan(mission(prompt)); assert.equal(plan?.tasks.length, 8, prompt); assert.equal(plan.tasks.filter(item => item.role === 'design').length, 3);
    assert.ok(plan.coordination.files.includes('decors.svg')); assert.equal(validatePlan(JSON.stringify(plan)).tasks.length, 8);
  }
  for (const prompt of ['Crée une petite calculatrice HTML locale avec les quatre opérations.', 'Build a simple Pomodoro timer in the browser, with pause and reset.', 'Maak een eenvoudige takenlijst in de browser.']) {
    const plan = simpleCodePlan(mission(prompt)); assert.ok(plan, prompt); assert.equal(plan.tasks.length, 1); assert.equal(plan.tasks[0].role, 'code');
    assert.deepEqual(plan.tasks[0].deliverables, ['index.html', 'README.md']); assert.equal(plan.coordination, undefined);
  }
});

test('le recrutement complet garde références, effectifs choisis, services et demandes ambitieuses', () => {
  const pizza = arcade.buildPrompt(answers);
  for (const prompt of [withTeamPreference(pizza, '4'), arcade.buildPrompt({ ...answers, univers: 'Une pizzeria avec un mode multijoueur en ligne.' }), arcade.buildPrompt({ ...answers, regles: 'Créer les comptes des joueurs et un paiement Stripe.' }), arcade.buildPrompt({ ...answers, graphismes: 'Un illustrateur crée des peintures originales.' }), pizza + '\n\nAjoute un serveur Node avec une base de données.', pizza + '\n\nRecrute également un designer et un rédacteur.', 'Crée un jeu 3D Unity avec des joueurs en ligne.', 'Crée un logiciel pour mon activité.', 'Corrige mon jeu de puzzle existant dans le navigateur.', 'Crée un quiz HTML sur les informations politiques actuelles.', 'Crée une simple calculatrice dans mon navigateur avec une API de paiement.']) assert.equal(simpleCodePlan(mission(prompt)), null, prompt);
  for (const extra of [{ referenceIds: ['a'.repeat(24)] }, { references: [{ path: 'References/exemple.pdf' }] }, { outputFormats: ['pdf'] }, { templateId: 'a'.repeat(24) }, { assistant: true }, { provider: 'demo' }]) assert.equal(simpleCodePlan({ ...mission(pizza), ...extra }), null);
});

test('les dépendances refusent identifiants inconnus, répétitions, auto-dépendance et cycles', () => {
  const plan = simpleCodePlan(mission(brief));
  for (const invalid of [['t99'], ['t1'], ['t2', 't2'], 't2']) {
    const copy = structuredClone(plan); copy.tasks[0].dependsOn = invalid;
    assert.throws(() => validatePlan(JSON.stringify(copy)), /dépendance/);
  }
  const cycle = structuredClone(plan); cycle.tasks[0].dependsOn = ['t4']; cycle.tasks[3].dependsOn = ['t1'];
  assert.throws(() => validatePlan(JSON.stringify(cycle)), /cycle/);
});

test('les créations indépendantes et leurs contrôles produisent des copies vérifiées et un contrôle final complet', async t => {
  const runner = gameRunner(), app = setup(t, runner.run);
  const started = app.start({ prompt: brief }), done = await app.wait(started.id);
  assert.equal(done.status, 'completed', done.error); assert.equal(done.executionMode, 'local-game-team');
  assert.deepEqual(done.tasks.map(item => item.agentName), ['Lina', 'Jules', 'Alma', 'Maya', 'Noé', 'Sam', 'Alex']);
  assert.equal(runner.calls.length, 9); assert.equal(runner.calls.filter(item => item.schema?.properties.reviews).length, 2);
  assert.deepEqual(done.performance.calls.map(item => item.stage), ['creation', 'creation', 'creation', 'creation', 'creation', 'creation', 'review', 'creation', 'final-review']);
  assert.equal(done.finalReview.approved, true); assert.ok(done.tasks.every(item => item.status === 'approved'));
  const entry = done.tasks.at(-1), root = app.workDir(started.id);
  for (const file of done.coordination.files) assert.deepEqual(readFileSync(path.join(root, 'Livraison', file)), readFileSync(path.join(root, `${entry.id}-${entry.role}`, file)));
  const saved = readFileSync(path.join(app.missionDir(started.id), 'state.json'), 'utf8');
  assert.ok(!saved.includes('"type": "Buffer"')); assert.ok(done.pinnedContributionBytes > 0 && done.pinnedContributionBytes < 50 * 1024 * 1024);
});

test('un refus groupé ne refait que la contribution concernée avant de libérer les dépendants', async t => {
  const runner = gameRunner({ review: ({ reviews, counts }) => reviews.map(item => item.taskId === 't1' && counts.get('t1') === 1 ? { ...item, approved: false, feedback: 'Préciser la source avant toute transmission.' } : item) });
  const app = setup(t, runner.run), started = app.start({ prompt: brief }), done = await app.wait(started.id);
  assert.equal(done.status, 'completed', done.error); assert.equal(runner.counts.get('t1'), 2);
  assert.ok([...runner.counts].filter(([id]) => id !== 't1').every(([, count]) => count === 1)); assert.equal(runner.calls.length, 11);
});

test('les revues reçoivent des extraits bornés et conservent les rapports complets sur disque', async t => {
  const runner = gameRunner({ report: task => `${originalReport(task)}\n${'Contribution détaillée. '.repeat(1400)}\nFIN-COMPLÈTE-${task.id}` });
  const app = setup(t, runner.run), started = app.start({ prompt: brief }), done = await app.wait(started.id);
  assert.equal(done.status, 'completed', done.error);
  for (const input of runner.calls.filter(item => item.schema?.properties.reviews)) {
    assert.ok(!input.prompt.includes('FIN-COMPLÈTE-'), 'Les extraits ne recopient pas les longs rapports entiers.');
    assert.match(input.prompt, /extraits bornés/);
  }
  for (const task of done.tasks) {
    assert.ok(task.report.length > 12000); assert.ok(task.report.endsWith(`FIN-COMPLÈTE-${task.id}`));
    assert.ok(readFileSync(path.join(app.workDir(started.id), `Rapports/${task.id}-${task.role}.md`), 'utf8').includes(`FIN-COMPLÈTE-${task.id}`));
  }
  assert.match(runner.calls.at(-1).prompt, /Rapports\/t1-recherche\.md/);
});

test('chaque contrôle groupé exige exactement un avis par tâche réellement soumise', async t => {
  for (const malformed of ['missing', 'duplicate', 'unknown']) await t.test(malformed, async t => {
    const runner = gameRunner({ review: ({ reviews }) => malformed === 'missing' ? reviews.slice(1) : malformed === 'duplicate' ? [reviews[0], reviews[0], ...reviews.slice(2)] : [{ ...reviews[0], taskId: 't20' }, ...reviews.slice(1)] });
    const app = setup(t, runner.run), started = app.start({ prompt: brief }), done = await app.wait(started.id);
    assert.equal(done.status, 'failed'); assert.match(done.error, /validation distincte/);
    assert.equal([...runner.counts.values()].reduce((sum, n) => sum + n, 0), 6); assert.ok(!done.tasks.some(item => item.status === 'approved'));
    assert.ok(!existsSync(path.join(app.workDir(started.id), 'Livraison')));
  });
});

test('un intégrateur ne remplace pas silencieusement le moteur validé de son collègue', async t => {
  const runner = gameRunner({ afterCreate: ({ task, m, input }) => { if (task.id === m.coordination.entryTaskId) writeFileSync(path.join(input.cwd, 'game-engine.js'), 'Un second moteur concurrent.'); } });
  const app = setup(t, runner.run), started = app.start({ prompt: brief }), done = await app.wait(started.id);
  assert.equal(done.status, 'needs_review', done.error); assert.equal(done.finalReview.approved, false); assert.match(done.finalReview.feedback, /game-engine\.js/);
  assert.equal(runner.counts.get('t7'), 2); assert.ok(!existsSync(path.join(app.workDir(started.id), 'Livraison')));
});

test('le petit outil commence avec Sam et garde sa relecture et son assemblage ordinaires', async t => {
  const calls = [], app = setup(t, async input => {
    calls.push(input); assert.ok(!input.schema?.properties.tasks);
    if (input.schema?.properties.approved) return approval;
    if (path.basename(input.cwd) === 't1-code') {
      writeFileSync(path.join(input.cwd, 'index.html'), '<!doctype html><title>Minuteur</title><button>Départ</button>');
      writeFileSync(path.join(input.cwd, 'README.md'), '# Minuteur local\nScénario de test sans modèle.'); return { text: 'Outil et guide présents.' };
    }
    mkdirSync(path.join(input.cwd, 'Livraison'));
    for (const file of ['index.html', 'README.md']) writeFileSync(path.join(input.cwd, 'Livraison', file), readFileSync(path.join(input.cwd, 't1-code', file)));
    return { text: 'Les fichiers intégrés sont dans Livraison/.' };
  });
  const started = app.start({ prompt: 'Crée un petit minuteur HTML local avec pause.' }), done = await app.wait(started.id);
  assert.equal(done.status, 'completed', done.error); assert.equal(done.executionMode, 'local-code-plan'); assert.equal(done.tasks[0].agentName, 'Sam'); assert.equal(calls.length, 4);
  assert.deepEqual(done.performance.calls.map(item => item.stage), ['creation', 'review', 'assembly', 'final-review']);
});

test('une panne du premier travail ne relance aucun modèle et conserve les fichiers partiels', async t => {
  let calls = 0;
  const app = setup(t, async ({ cwd }) => { calls++; writeFileSync(path.join(cwd, 'partiel.md'), 'Travail partiel à conserver.'); throw new Error('Délai du moteur dépassé.'); });
  const started = app.start({ prompt: brief }), done = await app.wait(started.id);
  assert.equal(done.status, 'failed'); assert.match(done.error, /Délai/); assert.equal(calls, 6); assert.ok(done.files.some(file => file.path.endsWith('/partiel.md')));
  assert.ok(!done.events.some(event => event.kind === 'success'));
});
