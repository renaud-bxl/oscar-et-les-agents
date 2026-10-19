import { EventEmitter } from 'node:events';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';

export const ROLES = {
  recherche: { name: 'Lina', label: 'Recherche', prompt: 'Tu es spécialiste de la recherche. Vérifie les sources, donne leurs liens et leurs dates. Distingue faits, estimations et inconnues. Ne fabrique aucune source.' },
  redaction: { name: 'Noé', label: 'Rédaction', prompt: 'Tu es spécialiste de la rédaction. Produis des textes clairs, précis et adaptés au destinataire, prêts à utiliser.' },
  code: { name: 'Sam', label: 'Code', prompt: 'Tu es spécialiste du développement. Produis des fichiers fonctionnels et explique ce qui a été effectivement testé. N’annonce jamais un test que tu n’as pas exécuté.' },
  design: { name: 'Alma', label: 'Design', prompt: 'Tu es spécialiste du design. Produis des propositions visuelles et des fichiers HTML/CSS/SVG si la mission le demande. Pense à la lisibilité, l’accessibilité et au mobile.' },
  analyse: { name: 'Jules', label: 'Analyse', prompt: 'Tu es spécialiste de l’analyse. Explicite tes calculs, hypothèses et limites. Vérifie les conclusions et distingue les données fournies des estimations.' },
};
const roleNames = Object.keys(ROLES);
export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, approach: { type: 'string' },
    tasks: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { role: { type: 'string', enum: roleNames }, title: { type: 'string' }, instruction: { type: 'string' }, criteria: { type: 'string' }, deliverables: { type: 'array', items: { type: 'string' } } },
      required: ['role', 'title', 'instruction', 'criteria', 'deliverables'] } },
  }, required: ['title', 'approach', 'tasks'],
};
export const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, properties: { approved: { type: 'boolean' }, feedback: { type: 'string' } }, required: ['approved', 'feedback'] };
const terminal = new Set(['completed', 'needs_review', 'failed', 'cancelled']);
export const MAX_CONCURRENT_MISSIONS = 4;
const limit = (v, n = 60000) => typeof v === 'string' ? v.slice(0, n) : '';
const clone = v => structuredClone(v);

export function parseObject(text) {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse structurée invalide.');
  return value;
}
export function validatePlan(text) {
  const p = parseObject(text);
  if (typeof p.title !== 'string' || !p.title.trim() || typeof p.approach !== 'string' || !Array.isArray(p.tasks) || p.tasks.length < 1 || p.tasks.length > 8) throw new Error('Oscar n’a pas fourni un plan valide (1 à 8 tâches).');
  for (const t of p.tasks) {
    if (!roleNames.includes(t.role) || ['title', 'instruction', 'criteria'].some(k => typeof t[k] !== 'string' || !t[k].trim())) throw new Error('Une tâche du plan est incomplète.');
    if (!Array.isArray(t.deliverables) || t.deliverables.length > 12 || t.deliverables.some(file => typeof file !== 'string' || !file.trim() || file.length > 256 || path.isAbsolute(file) || file.includes('\\') || file.includes('\0') || file.split('/').some(s => !s || s.startsWith('.')))) throw new Error('Le plan contient un nom de livrable invalide.');
    if (['code', 'design'].includes(t.role) && !t.deliverables.length) throw new Error('Le plan doit prévoir un fichier concret pour le code et le design.');
  }
  return p;
}
function validateReview(text) {
  const r = parseObject(text);
  if (typeof r.approved !== 'boolean' || typeof r.feedback !== 'string' || !r.feedback.trim()) throw new Error('Oscar n’a pas fourni une validation exploitable.');
  return { approved: r.approved, feedback: limit(r.feedback, 10000) };
}

export class Atelier extends EventEmitter {
  constructor({ dataDir = process.env.OSCAR_DATA_DIR || process.env.ATELIER_DATA_DIR || path.join(os.homedir(), 'Documents', 'Oscar et les agents'), runAgent, providers = [], demoDelay = 1800, concurrency = 2 } = {}) {
    super();
    this.dataDir = path.resolve(dataDir);
    this.runAgent = runAgent;
    this.providers = providers;
    this.demoDelay = demoDelay;
    this.concurrency = concurrency;
    this.missions = new Map();
    this.runs = new Map();
    this.logins = {};
    this.preferredProvider = 'codex';
    try { const p = JSON.parse(readFileSync(path.join(this.dataDir, 'preferences.json'), 'utf8')); if (['codex', 'claude'].includes(p.preferredProvider)) this.preferredProvider = p.preferredProvider; } catch { /* Premier démarrage. */ }
    mkdirSync(path.join(this.dataDir, 'missions'), { recursive: true });
    for (const item of readdirSync(path.join(this.dataDir, 'missions'), { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      try {
        const m = JSON.parse(readFileSync(path.join(this.dataDir, 'missions', item.name, 'state.json'), 'utf8'));
        if (m.id !== item.name || !Array.isArray(m.tasks) || !Array.isArray(m.events)) continue;
        if (!terminal.has(m.status)) {
          m.status = 'cancelled'; m.phase = 'Mission interrompue par le redémarrage';
          for (const t of m.tasks) if (!['approved', 'failed', 'needs_review'].includes(t.status)) t.status = 'cancelled';
        }
        this.missions.set(m.id, m);
      } catch { /* Un dossier incomplet ne doit pas bloquer le démarrage. */ }
    }
  }
  get(id) { const m = this.missions.get(id); return m ? clone(m) : null; }
  state() {
    const list = [...this.missions.values()].reverse().sort((a, b) => b.createdAt - a.createdAt);
    const activeMissions = list.filter(m => !terminal.has(m.status));
    return {
      app: 'oscar-et-les-agents',
      dataLocation: 'Documents/Oscar et les agents',
      maxConcurrentMissions: MAX_CONCURRENT_MISSIONS,
      preferredProvider: this.preferredProvider,
      logins: clone(this.logins), providers: clone(this.providers),
      missions: list.map(m => ({ id: m.id, title: m.title, provider: m.provider, status: m.status, createdAt: m.createdAt, updatedAt: m.updatedAt, phase: m.phase })),
      activeMissions: clone(activeMissions),
      active: clone(activeMissions[0] ?? null),
    };
  }
  workDir(id) {
    if (!this.missions.has(id)) throw new Error('Mission inconnue.');
    return path.join(this.dataDir, 'missions', id, 'travail');
  }
  save(m) {
    const dir = path.join(this.dataDir, 'missions', m.id);
    mkdirSync(dir, { recursive: true });
    m.updatedAt = Date.now();
    const file = path.join(dir, 'state.json');
    writeFileSync(file + '.tmp', JSON.stringify(m, null, 2), { mode: 0o600 });
    renameSync(file + '.tmp', file);
    this.emit('change', this.state());
  }
  event(m, who, text, kind = 'info') {
    m.events.push({ at: Date.now(), who, text: limit(text, 2000), kind });
    if (m.events.length > 400) m.events.splice(0, m.events.length - 400);
    this.save(m);
  }
  start({ prompt, provider = 'codex' }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error('Écris une mission entre 1 et 16 000 caractères.');
    if (!['codex', 'claude', 'demo'].includes(provider)) throw new Error('Choisis un moteur disponible.');
    if ([...this.missions.values()].filter(m => !terminal.has(m.status)).length >= MAX_CONCURRENT_MISSIONS) throw Object.assign(new Error('Quatre missions sont déjà en cours. Attends une livraison ou arrête une mission avant d’en lancer une autre.'), { code: 'MISSION_CAPACITY' });
    if (provider !== 'demo' && !this.providers.some(p => p.id === provider && p.available)) throw new Error('Ce moteur n’est pas installé ou sa version est incompatible.');
    const m = { id: randomUUID(), prompt: prompt.trim(), title: prompt.trim().slice(0, 70), provider, status: 'planning', phase: 'Oscar prépare le plan', createdAt: Date.now(), updatedAt: Date.now(), tasks: [], events: [], result: '', files: [], error: null };
    this.missions.set(m.id, m);
    mkdirSync(this.workDir(m.id), { recursive: true });
    const controller = new AbortController();
    this.runs.set(m.id, controller);
    this.event(m, 'Oscar', provider === 'demo' ? 'Démonstration : scénario simulé, aucun appel à une IA.' : 'Je transforme ta demande en tâches et critères de validation.');
    const completion = (provider === 'demo' ? this.demo(m, controller.signal) : this.execute(m, controller.signal))
      .catch(error => {
        const cancelled = controller.signal.aborted;
        // Si un spécialiste échoue, arrêter ses collègues encore en cours aussi.
        controller.abort();
        m.status = cancelled ? 'cancelled' : 'failed';
        m.phase = cancelled ? 'Mission arrêtée' : 'La mission demande ton attention';
        m.error = cancelled ? null : limit(error.message || 'Une erreur a interrompu la mission.', 2000);
        for (const t of m.tasks) if (['working', 'revising', 'reviewing', 'queued'].includes(t.status)) t.status = cancelled ? 'cancelled' : 'failed';
        this.scanFiles(m);
        this.event(m, 'Oscar', cancelled ? 'Mission arrêtée. Les fichiers déjà créés sont conservés.' : m.error, cancelled ? 'info' : 'error');
      }).finally(() => { this.runs.delete(m.id); });
    controller.completion = completion;
    return this.get(m.id);
  }
  async wait(id) { await this.runs.get(id)?.completion; return this.get(id); }
  stop(id) {
    const m = this.missions.get(id);
    if (!m) throw new Error('Mission inconnue.');
    const controller = this.runs.get(id);
    if (controller && !terminal.has(m.status)) {
      controller.abort();
      m.phase = 'Arrêt de l’équipe en cours';
      this.save(m);
    }
    return this.get(id);
  }
  check(signal) { if (signal.aborted) throw new Error('Mission arrêtée.'); }
  async call(m, { prompt, schema, cwd, readOnly = false, who = 'Oscar', task }, signal) {
    this.check(signal);
    const output = await this.runAgent({ provider: m.provider, cwd: cwd ?? this.workDir(m.id), prompt, schema, signal, readOnly,
      onActivity: text => {
        if (signal.aborted) return;
        if (task) task.activity = limit(text, 180);
        this.event(m, who, text, 'activity');
      },
    });
    this.check(signal);
    if (!output || typeof output.text !== 'string' || !output.text.trim()) throw new Error(`${who} n’a pas fourni de réponse.`);
    return output.text;
  }
  async execute(m, signal) {
    const plan = validatePlan(await this.call(m, {
      readOnly: true, schema: PLAN_SCHEMA,
      prompt: `Tu es Oscar, chef de projet de Oscar et les agents. Tu pilotes cinq métiers : recherche, redaction, code, design, analyse. Prépare un plan de 1 à 8 tâches indépendantes pouvant travailler en parallèle. Utilise uniquement les métiers nécessaires. Chaque spécialiste reçoit le contexte complet de la mission, mais pas le résultat des autres tâches. Ne crée pas de dépendances entre tâches. Définis des critères de validation concrets. Dans deliverables, indique les noms relatifs exacts des fichiers à créer (par exemple index.html ou rapport.md). Une tâche de code ou design doit toujours rendre au moins un fichier, même un rapport pour une simple analyse. Pour les autres métiers, une réponse textuelle suffit et deliverables peut être vide, sauf si la mission demande un fichier. Les tâches portent sur le travail demandé, pas sur l’organisation interne. Réponds uniquement au format JSON du schéma. Ne lance aucun outil.\n\nMISSION :\n${m.prompt}`,
    }, signal));
    m.title = limit(plan.title, 100);
    m.approach = limit(plan.approach, 3000);
    m.tasks = plan.tasks.map((t, i) => ({ id: `t${i + 1}`, role: t.role, title: limit(t.title, 160), instruction: limit(t.instruction, 8000), criteria: limit(t.criteria, 4000), deliverables: t.deliverables, status: 'queued', activity: 'Attend les consignes d’Oscar', report: '', review: null, attempt: 0 }));
    m.status = 'running'; m.phase = 'Les spécialistes se mettent au travail';
    this.event(m, 'Oscar', m.approach);
    let index = 0;
    const worker = async () => {
      while (index < m.tasks.length) {
        this.check(signal);
        const task = m.tasks[index++];
        await this.performTask(m, task, signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, m.tasks.length) }, worker));
    this.check(signal);
    this.scanFiles(m);
    if (m.tasks.some(t => t.status !== 'approved')) {
      m.status = 'needs_review'; m.phase = 'Oscar demande une reprise';
      m.result = '# Travail à revoir\n\nOscar n’a pas validé tous les résultats. Les rapports et fichiers sont conservés.\n\n' + m.tasks.filter(t => t.status !== 'approved').map(t => `## ${t.title}\n${t.review?.feedback ?? t.activity}`).join('\n\n');
      this.event(m, 'Oscar', 'Certains résultats ne remplissent pas encore les critères. Je ne les marque pas comme validés.', 'review');
      return;
    }
    m.status = 'reviewing'; m.phase = 'Oscar assemble la livraison'; this.save(m);
    for (let attempt = 1; attempt <= 2; attempt++) {
      m.result = limit(await this.call(m, {
        prompt: `Tu es Oscar, chef de projet. Tu as contrôlé et approuvé les rapports ci-dessous. Assemble une livraison finale cohérente et utile à la demande initiale. Si la mission produit un site, logiciel ou plusieurs fichiers complémentaires, intègre réellement les contributions dans un dossier Livraison/ prêt à utiliser : une liste de fichiers séparés n’est pas une intégration. Tu peux lire les contributions et créer des fichiers dans ce dossier de travail ; ne supprime ni n’écrase les contributions des spécialistes. Pour une mission de texte, assemble directement le texte complet dans ta réponse. Réponds en Markdown. Signale les limites et les points non vérifiés, cite les fichiers par leurs chemins relatifs. Ne prétends jamais avoir exécuté des tests sans preuve.\n\nMISSION :\n${m.prompt}\n\nRAPPORTS VALIDÉS :\n${m.tasks.map(t => `## ${t.title} (${ROLES[t.role].label})\nDossier : ${t.id}-${t.role}/\n${t.report}\nValidation : ${t.review.feedback}`).join('\n\n')}\n\nFICHIERS RÉELLEMENT PRÉSENTS :\n${JSON.stringify(m.files)}${m.finalReview ? `\n\nCORRECTIONS SUR L’ASSEMBLAGE :\n${m.finalReview.feedback}` : ''}`,
      }, signal), 120000);
      writeFileSync(path.join(this.workDir(m.id), 'Livraison.md'), m.result);
      this.scanFiles(m);
      m.phase = 'Oscar vérifie l’ensemble de la livraison'; this.save(m);
      m.finalReview = validateReview(await this.call(m, { readOnly: true, schema: REVIEW_SCHEMA,
        prompt: `Tu es Oscar et tu effectues le contrôle final de la livraison. Vérifie que la demande initiale est satisfaite, que les fichiers nécessaires existent réellement et que les contributions sont intégrées quand il s’agit d’un site ou logiciel. Lis les fichiers si nécessaire. Un résumé qui annonce un fichier absent, ou plusieurs morceaux de logiciel non intégrés, doit être refusé. N’accepte pas des tests sans preuve d’exécution. Ne modifie rien.\n\nMISSION :\n${m.prompt}\n\nLIVRAISON PROPOSÉE :\n${m.result}\n\nINVENTAIRE RÉEL :\n${JSON.stringify(m.files)}`,
      }, signal));
      this.event(m, 'Oscar', `Contrôle final : ${m.finalReview.feedback}`, 'review');
      if (m.finalReview.approved) {
        m.status = 'completed'; m.phase = 'Livraison validée par Oscar';
        this.event(m, 'Oscar', 'J’ai validé chaque résultat, assemblé les contributions et contrôlé la livraison.', 'success');
        return;
      }
      m.phase = 'Oscar corrige l’assemblage'; this.save(m);
    }
    m.status = 'needs_review'; m.phase = 'L’assemblage final reste à revoir';
    m.result = `# Livraison à revoir\n\n${m.finalReview.feedback}\n\n${m.result}`;
    writeFileSync(path.join(this.workDir(m.id), 'Livraison.md'), m.result);
    this.scanFiles(m); this.event(m, 'Oscar', 'Je conserve les résultats, mais je ne valide pas encore la livraison complète.', 'review');
  }
  async performTask(m, task, signal) {
    const role = ROLES[task.role];
    const cwd = path.join(this.workDir(m.id), `${task.id}-${task.role}`);
    mkdirSync(cwd, { recursive: true });
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.check(signal);
      task.attempt = attempt; task.status = attempt === 1 ? 'working' : 'revising';
      task.activity = attempt === 1 ? 'Travaille sur la mission' : 'Corrige selon le retour d’Oscar';
      this.event(m, role.name, `${attempt === 1 ? 'Commence' : 'Reprend'} : ${task.title}`, 'activity');
      task.report = limit(await this.call(m, { cwd, who: role.name, task,
        prompt: `${role.prompt}\nTu travailles pour Oscar, chef de projet. Réponds en français. Travaille uniquement dans ton dossier, ne supprime rien. Les commandes qui nécessitent une autorisation ne sont pas exécutées automatiquement : mentionne ce qui n’a pas pu être testé. Produis un rapport complet, des sources vérifiables si nécessaire et les fichiers demandés. Les fichiers que tu crées sont sous ${task.id}-${task.role}/ dans la livraison. Ne modifie aucun fichier hors de ton dossier.\n\nMISSION GLOBALE :\n${m.prompt}\n\nTA TÂCHE :\n${task.instruction}\n\nFICHIERS OBLIGATOIRES DANS TON DOSSIER :\n${JSON.stringify(task.deliverables)}\n\nCRITÈRES D’ACCEPTATION :\n${task.criteria}${task.review ? `\n\nCORRECTIONS DEMANDÉES PAR OSCAR :\n${task.review.feedback}\n\nTON RAPPORT PRÉCÉDENT :\n${task.report}` : ''}`,
      }, signal));
      task.status = 'reviewing'; task.activity = 'Oscar examine le résultat';
      this.scanFiles(m);
      this.event(m, 'Oscar', `Je vérifie le travail de ${role.name} : ${task.title}.`, 'review');
      task.review = validateReview(await this.call(m, { readOnly: true, schema: REVIEW_SCHEMA,
        prompt: `Tu es Oscar, chef de projet et contrôleur qualité. Examine le rapport avec un regard critique, en fonction de la demande et des critères. Lis les fichiers obligatoires dans le dossier ${task.id}-${task.role} ; ne modifie rien. Approuve uniquement si la tâche est réellement satisfaite et si les résultats sont étayés. Un rapport qui annonce un fichier absent de l’inventaire doit être refusé. Si les preuves manquent, indique les corrections exactes. Réponds uniquement au JSON du schéma.\n\nMISSION :\n${m.prompt}\n\nTÂCHE : ${task.instruction}\nCRITÈRES : ${task.criteria}\nFICHIERS OBLIGATOIRES : ${JSON.stringify(task.deliverables)}\nINVENTAIRE RÉEL DU SPÉCIALISTE : ${JSON.stringify(m.files.filter(f => f.path.startsWith(`${task.id}-${task.role}/`)))}\n\nRAPPORT :\n${task.report}`,
      }, signal));
      const missing = task.deliverables.filter(file => {
        const target = path.resolve(cwd, file);
        try { return !realpathSync(target).startsWith(realpathSync(cwd) + path.sep) || !statSync(target).isFile() || statSync(target).size === 0; } catch { return true; }
      });
      if (missing.length) task.review = { approved: false, feedback: `Fichiers obligatoires absents ou vides : ${missing.join(', ')}. Crée ces fichiers avant de demander la validation.` };
      this.event(m, 'Oscar', `${task.review.approved ? 'Validé' : 'À corriger'} — ${task.title} : ${task.review.feedback}`, 'review');
      const reports = path.join(this.workDir(m.id), 'Rapports'); mkdirSync(reports, { recursive: true });
      writeFileSync(path.join(reports, `${task.id}-${task.role}.md`), `# ${task.title}\n\n${task.report}\n\n## Contrôle d’Oscar\n${task.review.approved ? 'Validé' : 'À reprendre'} — ${task.review.feedback}\n`);
      if (task.review.approved) { task.status = 'approved'; task.activity = 'Validé par Oscar'; this.scanFiles(m); this.save(m); return; }
    }
    task.status = 'needs_review'; task.activity = 'À reprendre après deux passages'; this.save(m);
  }
  scanFiles(m) {
    const root = this.workDir(m.id), files = [];
    function walk(dir, depth = 0) {
      if (depth > 6 || files.length >= 300) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ['node_modules', 'vendor'].includes(entry.name) || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file, depth + 1);
        else if (entry.isFile()) files.push({ path: path.relative(root, file).split(path.sep).join('/'), size: statSync(file).size });
      }
    }
    if (existsSync(root)) walk(root);
    m.files = files;
  }
  async demo(m, signal) {
    const wait = async () => { await pause(this.demoDelay, null, { signal }); this.check(signal); };
    await wait();
    m.title = 'Un lancement préparé en équipe';
    m.tasks = roleNames.map((role, i) => ({ id: `t${i + 1}`, role, title: ['Repérer les informations à vérifier', 'Rédiger un message de lancement', 'Préparer une page de présentation', 'Définir la direction visuelle', 'Comparer les hypothèses'][i], instruction: 'Exemple de tâche dans la démonstration.', criteria: 'Un résultat clair, avec ses limites.', status: 'queued', activity: 'Attend les consignes d’Oscar', report: '', review: null, attempt: 0 }));
    m.status = 'running'; m.phase = 'Démonstration · les cinq spécialistes travaillent';
    this.event(m, 'Oscar', 'Je répartis cinq tâches. Tous les résultats affichés ici sont simulés.');
    for (const t of m.tasks) {
      t.status = 'working'; t.attempt = 1; t.activity = 'Exemple d’activité simulée';
      this.event(m, ROLES[t.role].name, t.title, 'activity'); await wait();
    }
    for (const t of m.tasks) {
      t.status = 'reviewing'; t.activity = 'Oscar examine le résultat simulé';
      this.event(m, 'Oscar', `Je vérifie : ${t.title}.`, 'review'); await wait();
      if (t.role === 'design') {
        t.status = 'revising'; t.attempt = 2; t.activity = 'Améliore le contraste du bouton';
        this.event(m, 'Oscar', 'Alma, améliore le contraste du bouton pour qu’il reste lisible.', 'review'); await wait();
      }
      t.report = `Démonstration uniquement.\n\n${ROLES[t.role].label} : voici un exemple de rapport rendu à Oscar. Dans une mission réelle, ce texte et les fichiers proviennent de l’agent ${m.provider === 'demo' ? 'sélectionné' : m.provider}.\n\nAucune recherche réelle ni vérification externe n’a été effectuée.`;
      t.review = { approved: true, feedback: 'Exemple de validation simulée après contrôle des critères.' };
      t.status = 'approved'; t.activity = 'Validation simulée';
      this.event(m, 'Oscar', `Exemple validé : ${t.title}.`, 'success');
    }
    m.result = '# Démonstration de Oscar et les agents\n\nOscar répartit les tâches entre cinq spécialistes, reçoit leurs rapports, demande une correction quand un critère n’est pas rempli, puis assemble la livraison.\n\nCe parcours était entièrement simulé. Aucun moteur IA n’a été appelé et aucun quota n’a été consommé.\n\nPour une vraie mission, choisis OpenAI · Codex ou Claude Code et décris le résultat attendu.';
    writeFileSync(path.join(this.workDir(m.id), 'Demonstration.md'), m.result);
    this.scanFiles(m); m.status = 'completed'; m.phase = 'Démonstration terminée · aucun appel IA';
    this.event(m, 'Oscar', 'La démonstration est terminée. Tu peux maintenant lancer une vraie mission.', 'success');
  }
}
