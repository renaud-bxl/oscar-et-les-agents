import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Atelier, simpleVisualBrief } from '../lib/orchestrator.mjs';
import { withLocaleInstruction, setLocale } from '../public/i18n.js';
import { withTeamPreference } from '../public/welcome-guide.js';
import { CreativeStudio } from '../public/creative-studio.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><path fill="#df4468" d="M1 1h10v10H1z"/><text x="20" y="40">Je t’aime Ingrid</text></svg>';
const brief = 'Fait un beau dessin pour ingrid pour lui dire que je l’aime';
const approval = approved => ({ text: JSON.stringify({ approved, feedback: approved ? 'Le fichier réel contient le dessin et le texte demandés.' : 'Le nom Ingrid est mal orthographié dans le visuel.' }) });
const created = (deliverables = ['dessin.png']) => ({ text: JSON.stringify({ title: 'Un dessin pour Ingrid', report: 'Le dessin original est créé. Le texte et le fichier ont été vérifiés.', deliverables }) });
function setup(t, runAgent, extra = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'oscar-visual-test-'));
  const app = new Atelier({ dataDir, runAgent, providers: [{ id: 'codex', available: true }], ...extra });
  t.after(async () => { for (const id of app.runs.keys()) app.stop(id); await Promise.all([...app.runs.keys()].map(id => app.wait(id))); rmSync(dataDir, { recursive: true, force: true }); });
  return app;
}

test('le routage reconnaît les dessins simples et le vrai brief studio sans raccourcir les projets complexes', () => {
  const mission = prompt => ({ prompt, provider: 'codex', referenceIds: [], outputFormats: [] });
  for (const prompt of [brief, 'Draw a beautiful picture for Ingrid, saying I love you.', 'Maak een lieve illustratie met de woorden Ik hou van je.']) assert.ok(simpleVisualBrief(mission(prompt)), prompt);
  for (const locale of ['fr', 'en', 'nl']) { setLocale(locale); assert.ok(simpleVisualBrief(mission(withLocaleInstruction(brief)))); }
  setLocale('fr');
  const studio = Object.assign(Object.create(CreativeStudio.prototype), { config: { preset: 'illustration', format: '4:5' }, description: { value: 'Un dessin romantique pour Ingrid avec un petit cœur.' }, stage: 'brief' });
  const studioRoute = simpleVisualBrief(mission(withLocaleInstruction(studio.brief())));
  assert.equal(studioRoute.brief, studio.description.value); assert.deepEqual(studioRoute.requiredExtensions, ['.svg']);
  for (const prompt of ['Crée un site avec une illustration.', 'Dessine trois variantes de logo.', 'Dessine cinq cartes.', 'Crée une image de marque.', 'Crée une image de marque avec une charte.', 'Retrouve une belle image de Bruxelles.', 'Peux-tu expliquer cette image ?', 'Dessine puis anime ce personnage.', 'Dessine un jeu vidéo complet.', 'Crée une affiche puis un rapport PDF.', 'Une image pour https://example.test', 'Dessine un beau visuel. Recrute quatre designers.', withTeamPreference(brief, '4'), 'Dessine un beau visuel.\n\nÉquipe souhaitée : recrute 4 spécialistes.']) assert.equal(simpleVisualBrief(mission(prompt)), null, prompt);
  for (const extra of [{ referenceIds: ['a'.repeat(24)] }, { references: [{ path: 'References/exemple.png' }] }, { outputFormats: ['pdf'] }, { templateId: 'a'.repeat(24) }, { assistant: true }, { provider: 'demo' }]) assert.equal(simpleVisualBrief({ ...mission(brief), ...extra }), null);
});

test('un texte inscrit reste visuel mais un mail, discours ou texte complémentaire garde le plan complet en FR/EN/NL', () => {
  const mission = prompt => ({ prompt, provider: 'codex' });
  for (const prompt of [
    'Crée une affiche pour mon café et écris un mail pour inviter les clients.',
    'Dessine une carte pour Ingrid et rédige le texte de son discours dans un fichier texte.',
    'Create a poster for my café and write an email inviting customers.',
    'Draw a card for Ingrid and draft her speech in a text file.',
    'Maak een poster voor mijn café en schrijf een e-mail om klanten uit te nodigen.',
    'Teken een kaart voor Ingrid en schrijf haar toespraak in een tekstbestand.',
    'Crée une affiche et rédige un texte de présentation.',
    'Create a poster and write a welcome message for customers.',
    'Maak een poster en schrijf een welkomstbericht voor klanten.',
    'Dessine une carte et écris « Bonjour Ingrid » dans un fichier texte.',
  ]) assert.equal(simpleVisualBrief(mission(prompt)), null, prompt);
  for (const prompt of [
    'Dessine une carte pour Ingrid avec le texte « Je t’aime Ingrid ».',
    'Dessine une carte pour Ingrid et écris dessus « Je t’aime Ingrid ».',
    'Draw a card for Ingrid with the words I love you Ingrid.',
    'Draw a card for Ingrid and write on it I love you Ingrid.',
    'Teken een kaart voor Ingrid met de woorden Ik hou van je Ingrid.',
    'Teken een kaart voor Ingrid en schrijf erop Ik hou van je Ingrid.',
    'Dessine une carte pour Ingrid et écris « Je t’aime Ingrid ».',
  ]) assert.ok(simpleVisualBrief(mission(prompt)), prompt);
});

test('une affiche et son invitation écrite recrutent les deux métiers et préservent les deux livrables', async t => {
  let plans = 0;
  const plan = { title: 'Une affiche et son invitation', approach: 'Créer le visuel et rédiger l’invitation séparément.', tasks: [
    { role: 'design', title: 'Créer l’affiche', instruction: 'Dessiner l’affiche pour le café.', criteria: 'Une affiche SVG.', deliverables: ['affiche.svg'] },
    { role: 'redaction', title: 'Écrire le mail', instruction: 'Rédiger l’invitation des clients.', criteria: 'Un mail prêt à relire.', deliverables: ['invitation.md'] },
  ] };
  const app = setup(t, async ({ schema, cwd }) => {
    if (schema?.properties.tasks) { plans++; return { text: JSON.stringify(plan) }; }
    if (schema?.properties.approved) return approval(true);
    if (path.basename(cwd) === 't1-design') { writeFileSync(path.join(cwd, 'affiche.svg'), SVG); return { text: 'L’affiche est créée dans affiche.svg.' }; }
    if (path.basename(cwd) === 't2-redaction') { writeFileSync(path.join(cwd, 'invitation.md'), 'Chers clients, nous vous invitons au café.'); return { text: 'Le mail proposé est dans invitation.md, sans envoi.' }; }
    mkdirSync(path.join(cwd, 'Livraison'));
    writeFileSync(path.join(cwd, 'Livraison', 'affiche.svg'), readFileSync(path.join(cwd, 't1-design', 'affiche.svg')));
    writeFileSync(path.join(cwd, 'Livraison', 'invitation.md'), readFileSync(path.join(cwd, 't2-redaction', 'invitation.md')));
    return { text: 'Livraison/affiche.svg et Livraison/invitation.md sont prêts.' };
  });
  const mission = app.start({ prompt: 'Crée une affiche pour mon café et écris un mail pour inviter les clients.' }), done = await app.wait(mission.id);
  assert.equal(done.status, 'completed'); assert.equal(plans, 1); assert.equal(done.executionMode, undefined); assert.deepEqual(done.tasks.map(task => task.role), ['design', 'redaction']);
  assert.ok(done.files.some(file => file.path === 'Livraison/affiche.svg')); assert.ok(done.files.some(file => file.path === 'Livraison/invitation.md'));
});

test('un vrai PNG est créé puis contrôlé une seule fois et livré sans plan ni assemblage de modèle', async t => {
  const calls = [], statuses = [];
  const app = setup(t, async input => {
    calls.push(input);
    assert.equal(input.connectorPlan, undefined);
    if (input.schema?.properties.report) { assert.equal(input.readOnly, false); assert.match(input.cwd, /t1-design$/); writeFileSync(path.join(input.cwd, 'dessin.png'), PNG); input.onActivity('Création du dessin'); return created(); }
    assert.ok(input.schema?.properties.approved); assert.equal(input.readOnly, true); assert.match(input.prompt, /inspecte les fichiers image/); assert.match(input.prompt, /t1-design\/dessin.png/); return approval(true);
  });
  app.on('change', state => { const mission = state.activeMissions[0]; if (mission?.tasks.length) statuses.push(mission.tasks[0].status); });
  const mission = app.start({ prompt: withLocaleInstruction(brief) }); const done = await app.wait(mission.id);
  assert.equal(done.status, 'completed'); assert.equal(done.executionMode, 'single-design'); assert.equal(calls.length, 2);
  assert.equal(done.tasks.length, 1); assert.equal(done.tasks[0].agentName, 'Alma'); assert.equal(done.tasks[0].attempt, 1); assert.equal(done.tasks[0].status, 'approved'); assert.equal(done.finalReview.approved, true);
  assert.ok(statuses.includes('working')); assert.ok(statuses.includes('reviewing'));
  assert.deepEqual(readFileSync(path.join(app.workDir(mission.id), 'Livraison', 'dessin.png')), PNG);
  assert.deepEqual(readFileSync(path.join(app.workDir(mission.id), 't1-design', 'dessin.png')), PNG);
  assert.match(readFileSync(path.join(app.workDir(mission.id), 'Rapports', 't1-design.md'), 'utf8'), /Contrôle d’Oscar/);
  assert.ok(done.files.some(file => file.path === 'Livraison/dessin.png')); assert.match(done.result, /Livraison\/dessin.png/);
  assert.deepEqual(done.performance.calls.map(call => [call.agent, call.stage, call.status]), [['Alma', 'creation', 'completed'], ['Oscar', 'review', 'completed']]);
  assert.ok(done.performance.calls.every(call => Number.isFinite(call.startedAt) && Number.isFinite(call.durationMs) && call.durationMs >= 0)); assert.ok(done.performance.totalDurationMs >= 0);
  assert.equal(new Atelier({ dataDir: app.dataDir }).get(mission.id).status, 'completed');
});

test('une création SVG explicite conserve le vectoriel éditable et ses sous-dossiers', async t => {
  let calls = 0;
  const commented = SVG.replace('<path ', '<!-- Forme du cœur originale --><path ');
  const app = setup(t, async ({ schema, cwd }) => { calls++; if (schema?.properties.report) { mkdirSync(path.join(cwd, 'Images')); writeFileSync(path.join(cwd, 'Images', 'dessin.svg'), commented); return created(['Images/dessin.svg']); } return approval(true); });
  const mission = app.start({ prompt: 'Dessine en SVG une carte pour Ingrid avec le texte Je t’aime Ingrid.' }); const done = await app.wait(mission.id);
  assert.equal(done.status, 'completed'); assert.equal(calls, 2); assert.equal(readFileSync(path.join(app.workDir(mission.id), 'Livraison', 'Images', 'dessin.svg'), 'utf8'), commented);
});

test('une équipe explicite conserve le parcours complet et ses mesures de chaque appel', async t => {
  const plan = { title: 'Un projet visuel complet', approach: 'Un travail réparti selon la demande.', tasks: [{ role: 'redaction', title: 'Rédiger le texte', instruction: 'Fournir le texte demandé.', criteria: 'Un texte complet.', deliverables: [] }] };
  const app = setup(t, async ({ schema }) => ({ text: schema?.properties.tasks ? JSON.stringify(plan) : schema?.properties.approved ? JSON.stringify({ approved: true, feedback: 'Les critères sont respectés.' }) : 'Le texte complet demandé.' }));
  const mission = app.start({ prompt: withLocaleInstruction(withTeamPreference(brief, '4')) }); const done = await app.wait(mission.id);
  assert.equal(done.status, 'completed'); assert.equal(done.executionMode, undefined);
  assert.deepEqual(done.performance.calls.map(call => call.stage), ['planning', 'creation', 'review', 'assembly', 'final-review']);
});

test('un refus d’Oscar préserve la création et son rapport sans relancer le générateur', async t => {
  let calls = 0;
  const app = setup(t, async ({ schema, cwd }) => { calls++; if (schema?.properties.report) { writeFileSync(path.join(cwd, 'dessin.png'), PNG); return created(); } return approval(false); });
  const mission = app.start({ prompt: brief }); const done = await app.wait(mission.id);
  assert.equal(done.status, 'needs_review'); assert.equal(calls, 2); assert.equal(done.tasks[0].status, 'needs_review'); assert.equal(done.finalReview.approved, false);
  assert.equal(existsSync(path.join(app.workDir(mission.id), 'Livraison')), false); assert.deepEqual(readFileSync(path.join(app.workDir(mission.id), 't1-design', 'dessin.png')), PNG);
  assert.match(done.result, /mal orthographié/); assert.ok(!done.events.some(event => event.kind === 'success'));
});

test('le contrôle matériel refuse absence, fichier vide, faux PNG, SVG actif et liens sans payer une revue fictive', async t => {
  for (const kind of ['absent', 'vide', 'faux-png', 'svg-actif', 'lien', 'parent-lié', 'format-manquant']) await t.test(kind, async t => {
    let calls = 0;
    const relative = kind === 'parent-lié' ? 'Images/dessin.png' : kind === 'svg-actif' ? 'dessin.svg' : 'dessin.png';
    const app = setup(t, async ({ schema, cwd }) => {
      calls++; assert.ok(schema?.properties.report, 'Une revue modèle ne remplace pas le contrôle matériel.');
      if (kind === 'vide') writeFileSync(path.join(cwd, relative), '');
      if (kind === 'faux-png') writeFileSync(path.join(cwd, relative), 'Je prétends être une image.');
      if (kind === 'svg-actif') writeFileSync(path.join(cwd, relative), SVG.replace('</svg>', '<script>alert(1)</script></svg>'));
      if (kind === 'lien') { writeFileSync(path.join(cwd, 'source.png'), PNG); symlinkSync('source.png', path.join(cwd, relative)); }
      if (kind === 'parent-lié') { mkdirSync(path.join(cwd, 'Source')); writeFileSync(path.join(cwd, 'Source', 'dessin.png'), PNG); symlinkSync('Source', path.join(cwd, 'Images')); }
      if (kind === 'format-manquant') writeFileSync(path.join(cwd, relative), PNG);
      return created([relative]);
    });
    const mission = app.start({ prompt: kind === 'format-manquant' ? 'Dessine une carte en SVG pour Ingrid.' : brief }); const done = await app.wait(mission.id);
    assert.equal(done.status, 'needs_review'); assert.equal(calls, 1); assert.equal(done.finalReview.approved, false); assert.equal(existsSync(path.join(app.workDir(mission.id), 'Livraison')), false); assert.ok(!done.events.some(event => event.kind === 'success'));
  });
});

test('une image changée pendant la revue ne reçoit pas une validation valable pour ses anciens octets', async t => {
  let artistFolder;
  const app = setup(t, async ({ schema, cwd }) => { if (schema?.properties.report) { artistFolder = cwd; writeFileSync(path.join(cwd, 'dessin.svg'), SVG); return created(['dessin.svg']); } writeFileSync(path.join(artistFolder, 'dessin.svg'), SVG.replace('Ingrid', 'Autre nom')); return approval(true); });
  const mission = app.start({ prompt: brief }); const done = await app.wait(mission.id);
  assert.equal(done.status, 'needs_review'); assert.match(done.finalReview.feedback, /changé pendant le contrôle/); assert.equal(existsSync(path.join(app.workDir(mission.id), 'Livraison')), false);
});

test('l’empaquetage ne suit pas un dossier lié et n’écrase jamais une livraison existante', async t => {
  for (const conflict of ['lien-livraison', 'lien-rapports', 'fichier-existant']) await t.test(conflict, async t => {
    let artistFolder;
    const outside = mkdtempSync(path.join(os.tmpdir(), 'oscar-visual-preserve-')); t.after(() => rmSync(outside, { recursive: true, force: true }));
    const app = setup(t, async ({ schema, cwd }) => {
      if (schema?.properties.report) { artistFolder = cwd; writeFileSync(path.join(cwd, 'dessin.png'), PNG); return created(); }
      const root = path.dirname(artistFolder);
      if (conflict === 'lien-livraison') symlinkSync(outside, path.join(root, 'Livraison'));
      if (conflict === 'lien-rapports') symlinkSync(outside, path.join(root, 'Rapports'));
      if (conflict === 'fichier-existant') { mkdirSync(path.join(root, 'Livraison')); writeFileSync(path.join(root, 'Livraison', 'dessin.png'), 'FICHIER EXISTANT À CONSERVER'); }
      return approval(true);
    });
    const mission = app.start({ prompt: brief }); const done = await app.wait(mission.id);
    assert.equal(done.status, 'failed'); assert.ok(!done.events.some(event => event.kind === 'success'));
    assert.equal(existsSync(path.join(outside, 'dessin.png')), false); assert.equal(existsSync(path.join(outside, 't1-design.md')), false);
    if (conflict === 'fichier-existant') assert.equal(readFileSync(path.join(app.workDir(mission.id), 'Livraison', 'dessin.png'), 'utf8'), 'FICHIER EXISTANT À CONSERVER');
  });
});

test('une panne ou annulation conserve les fichiers sans relancer la création et sans faux succès', async t => {
  for (const cancelled of [false, true]) await t.test(cancelled ? 'annulation' : 'panne', async t => {
    let calls = 0, started;
    const ready = new Promise(resolve => { started = resolve; });
    const app = setup(t, async ({ cwd, signal }) => { calls++; writeFileSync(path.join(cwd, 'dessin.png'), PNG); started(); if (!cancelled) throw new Error('Délai du moteur dépassé.'); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Mission arrêtée')), { once: true })); });
    const mission = app.start({ prompt: brief }); await ready; if (cancelled) app.stop(mission.id); const done = await app.wait(mission.id);
    assert.equal(done.status, cancelled ? 'cancelled' : 'failed'); assert.equal(calls, 1); assert.equal(done.performance.calls[0].status, cancelled ? 'cancelled' : 'failed'); assert.ok(done.files.some(file => file.path === 't1-design/dessin.png')); assert.ok(!done.events.some(event => event.kind === 'success'));
  });
});
