import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Atelier, simpleCodePlan, ROLES } from '../lib/orchestrator.mjs';
import { MISSION_TEMPLATES, buildWizardSummary, buildWizardSubmission } from '../public/mission-catalog.js';
import { withLocaleInstruction, setLocale } from '../public/i18n.js';
import { withTeamPreference } from '../public/welcome-guide.js';

const arcade = MISSION_TEMPLATES.find(item => item.id === 'jeu-arcade');
const answers = { nom: 'Pizza mania', univers: 'Une petite pizzeria ou il faut créer un max de pizza en fonction des commande mais attention il ne faut pas se tromper dans les commandes et les ingrédients !', regles: 'Livrer 10 pizzas par level, les level devinnent de plus en plus rapide', public: 'Tout public : clavier et souris', graphismes: 'Dessin animé doux et expressif' };
const mission = prompt => ({ prompt, provider: 'codex', referenceIds: [], outputFormats: [] });
const approval = { text: JSON.stringify({ approved: true, feedback: 'Les fichiers et les vérifications répondent à la demande.' }) };
function setup(t, runAgent) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-code-plan-'));
  const app = new Atelier({ dataDir, runAgent, providers: [{ id: 'codex', available: true }] });
  t.after(async () => { for (const id of app.runs.keys()) app.stop(id); await Promise.all([...app.runs.keys()].map(id => app.wait(id))); rmSync(dataDir, { recursive: true, force: true }); });
  return app;
}

test('le vrai questionnaire Pizza mania prépare un seul développeur et ses fichiers concrets sans appel de plan', () => {
  for (const locale of ['fr', 'en', 'nl']) {
    setLocale(locale);
    const summary = buildWizardSummary(arcade, answers, locale), prompt = withLocaleInstruction(buildWizardSubmission(arcade, answers, summary, locale));
    const plan = simpleCodePlan(mission(prompt));
    assert.ok(plan, `Le questionnaire ${locale} doit être reconnu.`); assert.equal(plan.tasks.length, 1); assert.equal(plan.tasks[0].role, 'code');
    assert.deepEqual(plan.tasks[0].deliverables, ['index.html', 'README.md']); assert.equal(plan.tasks[0].instruction, prompt); assert.match(plan.approach, /Sam/);
    if (locale === 'fr') assert.equal(plan.title, 'Pizza mania');
  }
  setLocale('fr');
});

test('les jeux locaux clairs et petits outils de navigateur ont un plan proportionné', () => {
  for (const prompt of ['Crée un petit jeu de puzzle jouable dans mon navigateur, avec score et trois niveaux.', 'Build a small arcade game in HTML Canvas with a score and a restart button.', 'Maak een klein spel in de browser met punten en een pauzeknop.', 'Crée une petite calculatrice HTML locale avec les quatre opérations.', 'Build a simple Pomodoro timer in the browser, with pause and reset.', 'Maak een eenvoudige takenlijst in de browser.']) {
    const plan = simpleCodePlan(mission(prompt)); assert.ok(plan, prompt); assert.equal(plan.tasks.length, 1); assert.equal(plan.tasks[0].role, 'code');
  }
});

test('le recrutement complet reste nécessaire pour références, équipe, services, jeux ambitieux ou demandes vagues', () => {
  const pizza = arcade.buildPrompt(answers);
  for (const prompt of [
    withTeamPreference(pizza, '4'),
    arcade.buildPrompt({ ...answers, univers: 'Une pizzeria avec un mode multijoueur en ligne.' }),
    arcade.buildPrompt({ ...answers, regles: 'Créer les comptes des joueurs et un paiement Stripe.' }),
    arcade.buildPrompt({ ...answers, graphismes: 'Un illustrateur crée des peintures originales.' }),
    pizza + '\n\nAjoute un serveur Node avec une base de données.',
    pizza + '\n\nRecrute également un designer et un rédacteur.',
    'Crée un jeu 3D Unity avec des joueurs en ligne.',
    'Crée un logiciel pour mon activité.',
    'Corrige mon jeu de puzzle existant dans le navigateur.',
    'Crée un quiz HTML sur les informations politiques actuelles.',
    'Crée une simple calculatrice dans mon navigateur avec une API de paiement.',
  ]) assert.equal(simpleCodePlan(mission(prompt)), null, prompt);
  for (const extra of [{ referenceIds: ['a'.repeat(24)] }, { references: [{ path: 'References/exemple.pdf' }] }, { outputFormats: ['pdf'] }, { templateId: 'a'.repeat(24) }, { assistant: true }, { provider: 'demo' }]) assert.equal(simpleCodePlan({ ...mission(pizza), ...extra }), null);
});

test('Sam commence le travail utile au premier appel, puis Oscar conserve relecture et contrôle final', async t => {
  const calls = []; let release, started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  const app = setup(t, async input => {
    calls.push(input);
    assert.equal(Boolean(input.schema?.properties.tasks), false, 'Aucun appel ne doit être consacré à un plan déjà clair.');
    if (input.schema?.properties.approved) return approval;
    if (path.basename(input.cwd) === 't1-code') {
      assert.ok(input.prompt.startsWith(ROLES.code.prompt)); assert.match(input.prompt, /Pizza mania/); assert.match(input.prompt, /README\.md/); assert.equal(input.readOnly, false);
      writeFileSync(path.join(input.cwd, 'index.html'), '<!doctype html><title>Pizza mania</title><button id="pizza">Pizza</button><script src="game.js"></script>');
      writeFileSync(path.join(input.cwd, 'game.js'), 'document.querySelector("#pizza").onclick=event=>{event.target.textContent="Pizza livrée"};');
      writeFileSync(path.join(input.cwd, 'README.md'), '# Pizza mania\nOuvrir index.html.\nTest simulé, aucun jeu réel ne provient du moteur de test.');
      started(); return new Promise(resolve => { release = () => resolve({ text: 'Le jeu, ses graphismes et son mode d’emploi sont intégrés dans index.html, game.js et README.md.' }); });
    }
    mkdirSync(path.join(input.cwd, 'Livraison'));
    for (const file of ['index.html', 'game.js', 'README.md']) writeFileSync(path.join(input.cwd, 'Livraison', file), readFileSync(path.join(input.cwd, 't1-code', file)));
    return { text: 'Les fichiers intégrés se trouvent dans Livraison/index.html, Livraison/game.js et Livraison/README.md.' };
  });
  const initial = app.start({ prompt: withLocaleInstruction(arcade.buildPrompt(answers)) }); await firstStarted;
  const running = app.get(initial.id); assert.equal(running.status, 'running'); assert.equal(running.executionMode, 'local-code-plan');
  assert.equal(running.tasks.length, 1); assert.equal(running.tasks[0].agentName, 'Sam'); assert.equal(running.tasks[0].status, 'working'); assert.equal(calls.length, 1);
  assert.deepEqual(running.performance.calls.map(call => [call.agent, call.stage, call.status]), [['Sam', 'creation', 'running']]);
  release(); const done = await app.wait(initial.id);
  assert.equal(done.status, 'completed'); assert.equal(done.tasks[0].status, 'approved'); assert.equal(done.finalReview.approved, true);
  assert.deepEqual(done.performance.calls.map(call => call.stage), ['creation', 'review', 'assembly', 'final-review']);
  assert.match(readFileSync(path.join(app.workDir(initial.id), 'Livraison', 'index.html'), 'utf8'), /game\.js/);
});

test('un plan local n’approuve pas un code sans ses fichiers obligatoires et garde les corrections normales', async t => {
  let creations = 0, assemblies = 0;
  const app = setup(t, async ({ schema, cwd }) => {
    assert.equal(Boolean(schema?.properties.tasks), false);
    if (schema?.properties.approved) return approval;
    if (path.basename(cwd) === 't1-code') { creations++; writeFileSync(path.join(cwd, 'index.html'), '<h1>Jeu incomplet</h1>'); return { text: 'Le jeu est prêt.' }; }
    assemblies++; return { text: 'La livraison est prête.' };
  });
  const started = app.start({ prompt: arcade.buildPrompt(answers) }); const done = await app.wait(started.id);
  assert.equal(done.status, 'needs_review'); assert.equal(creations, 2); assert.equal(assemblies, 0); assert.match(done.tasks[0].review.feedback, /README\.md/);
  assert.ok(!done.events.some(event => event.kind === 'success'));
});

test('une panne ou un arrêt pendant le premier travail local ne relance aucun appel et conserve les fichiers partiels', async t => {
  for (const cancel of [false, true]) await t.test(cancel ? 'arrêt' : 'panne', async t => {
    let calls = 0, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const app = setup(t, async ({ cwd, signal }) => { calls++; writeFileSync(path.join(cwd, 'index.html'), '<h1>Travail partiel conservé</h1>'); entered(); if (!cancel) throw new Error('Délai du moteur dépassé.'); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Mission arrêtée')), { once: true })); });
    const started = app.start({ prompt: arcade.buildPrompt(answers) }); await ready; if (cancel) app.stop(started.id); const done = await app.wait(started.id);
    assert.equal(done.status, cancel ? 'cancelled' : 'failed'); assert.equal(calls, 1); assert.ok(done.files.some(file => file.path === 't1-code/index.html')); assert.ok(!done.events.some(event => event.kind === 'success'));
  });
});
