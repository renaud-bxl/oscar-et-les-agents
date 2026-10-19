import { EventEmitter } from 'node:events';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, realpathSync, lstatSync, rmdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';

export const ROLES = {
  recherche: { name: 'Lina', names: ['Lina', 'Camille', 'Nora', 'Iris'], label: 'Recherche', prompt: 'Tu es spécialiste de la recherche. Vérifie les sources, donne leurs liens et leurs dates. Distingue faits, estimations et inconnues. Ne fabrique aucune source.' },
  redaction: { name: 'Noé', names: ['Noé', 'Hugo', 'Inès', 'Lou'], label: 'Rédaction', prompt: 'Tu es spécialiste de la rédaction. Produis des textes clairs, précis et adaptés au destinataire, prêts à utiliser.' },
  code: { name: 'Sam', names: ['Sam', 'Alex', 'Théo', 'Rémi'], label: 'Code', prompt: 'Tu es spécialiste du développement. Produis des fichiers fonctionnels et explique ce qui a été effectivement testé. N’annonce jamais un test que tu n’as pas exécuté.' },
  design: { name: 'Alma', names: ['Alma', 'Maya', 'Jade', 'Rose'], label: 'Design', prompt: 'Tu es spécialiste du design. Produis des propositions visuelles et des fichiers HTML/CSS/SVG si la mission le demande. Pense à la lisibilité, l’accessibilité et au mobile.' },
  analyse: { name: 'Jules', names: ['Jules', 'Léon', 'Éva', 'Nils'], label: 'Analyse', prompt: 'Tu es spécialiste de l’analyse. Explicite tes calculs, hypothèses et limites. Vérifie les conclusions et distingue les données fournies des estimations.' },
};
const roleNames = Object.keys(ROLES);
export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, approach: { type: 'string' },
    tasks: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', additionalProperties: false,
      properties: { role: { type: 'string', enum: roleNames }, title: { type: 'string' }, instruction: { type: 'string' }, criteria: { type: 'string' }, deliverables: { type: 'array', items: { type: 'string' } } },
      required: ['role', 'title', 'instruction', 'criteria', 'deliverables'] } },
  }, required: ['title', 'approach', 'tasks'],
};
export const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, properties: { approved: { type: 'boolean' }, feedback: { type: 'string' } }, required: ['approved', 'feedback'] };
const terminal = new Set(['completed', 'needs_review', 'failed', 'cancelled']);
export const MAX_CONCURRENT_MISSIONS = 4;
export const MAX_AGENTS_PER_ROLE = 4;
export const MAX_CONCURRENT_AGENTS = 4;
const limit = (v, n = 60000) => typeof v === 'string' ? v.slice(0, n) : '';
const clone = v => structuredClone(v);
const agentName = task => task.agentName || ROLES[task.role].name;
function nameTasks(tasks) {
  const counts = new Map();
  return tasks.map(task => {
    const index = counts.get(task.role) ?? 0;
    counts.set(task.role, index + 1);
    return { ...task, agentName: ROLES[task.role].names[index] ?? ROLES[task.role].name };
  });
}

const validMissionId = value => typeof value === 'string' && /^[a-z\d-]{1,100}$/i.test(value);
const uuidFolder = value => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
export function readableMissionFolderName(title, createdAt = Date.now()) {
  let date = new Date(Number.isFinite(createdAt) ? createdAt : Date.now());
  if (!Number.isFinite(date.getTime())) date = new Date();
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let label = String(title || 'Mission').split(/[\r\n]/, 1)[0].normalize('NFKC').replace(/[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069/\\.:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  label = [...label].slice(0, 72).join('');
  while (Buffer.byteLength(label, 'utf8') > 200) label = [...label].slice(0, -1).join('');
  return `${stamp} — ${label.trim() || 'Mission'}`;
}

export function parseObject(text) {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse structurée invalide.');
  return value;
}
export function validatePlan(text) {
  const p = parseObject(text);
  if (typeof p.title !== 'string' || !p.title.trim() || typeof p.approach !== 'string' || !Array.isArray(p.tasks) || p.tasks.length < 1 || p.tasks.length > 20) throw new Error('Oscar n’a pas fourni un plan valide (1 à 20 tâches).');
  const counts = new Map();
  for (const t of p.tasks) {
    if (!t || !roleNames.includes(t.role) || ['title', 'instruction', 'criteria'].some(k => typeof t[k] !== 'string' || !t[k].trim())) throw new Error('Une tâche du plan est incomplète.');
    counts.set(t.role, (counts.get(t.role) ?? 0) + 1);
    if (counts.get(t.role) > MAX_AGENTS_PER_ROLE) throw new Error(`Oscar peut recruter au maximum 4 agents pour le métier « ${ROLES[t.role].label} ».`);
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
  constructor({ dataDir = process.env.OSCAR_DATA_DIR || process.env.ATELIER_DATA_DIR || path.join(os.homedir(), 'Documents', 'Oscar et les agents'), runAgent, providers = [], demoDelay = 1800, concurrency = MAX_CONCURRENT_AGENTS } = {}) {
    super();
    this.dataDir = path.resolve(dataDir);
    this.runAgent = runAgent;
    this.providers = providers;
    this.demoDelay = demoDelay;
    this.concurrency = Number.isFinite(concurrency) ? Math.max(1, Math.min(MAX_CONCURRENT_AGENTS, Math.floor(concurrency))) : MAX_CONCURRENT_AGENTS;
    this.missions = new Map();
    this.folderNames = new Map();
    this.runs = new Map();
    this.logins = {};
    this.preferredProvider = 'codex';
    try { const p = JSON.parse(readFileSync(path.join(this.dataDir, 'preferences.json'), 'utf8')); if (['codex', 'claude'].includes(p.preferredProvider)) this.preferredProvider = p.preferredProvider; } catch { /* Premier démarrage. */ }
    mkdirSync(path.join(this.dataDir, 'missions'), { recursive: true });
    for (const item of readdirSync(path.join(this.dataDir, 'missions'), { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      try {
        if (item.name.startsWith('.')) continue;
        const stateFile = path.join(this.dataDir, 'missions', item.name, 'state.json');
        if (!lstatSync(stateFile).isFile() || lstatSync(stateFile).isSymbolicLink()) continue;
        const m = JSON.parse(readFileSync(stateFile, 'utf8'));
        if (!validMissionId(m.id) || this.missions.has(m.id) || !Array.isArray(m.tasks) || !Array.isArray(m.events)) continue;
        const wasActive = !terminal.has(m.status);
        if (wasActive) {
          m.status = 'cancelled'; m.phase = 'Mission interrompue par le redémarrage';
          for (const t of m.tasks) if (!['approved', 'failed', 'needs_review'].includes(t.status)) t.status = 'cancelled';
        }
        let folderName = item.name;
        // A possibly active legacy working directory keeps its path for this startup.
        // Completed UUID folders are migrated only here, never during a running mission.
        if (!wasActive && folderName === m.id && uuidFolder(folderName)) {
          const targetName = this.allocateFolder(m);
          const target = path.join(this.dataDir, 'missions', targetName);
          try { renameSync(path.join(this.dataDir, 'missions', folderName), target); folderName = targetName; }
          catch { try { rmdirSync(target); } catch { /* Keep both folders if anything was added. */ } }
        }
        m.folderName = folderName;
        this.folderNames.set(m.id, folderName);
        this.missions.set(m.id, m);
      } catch { /* Un dossier incomplet ne doit pas bloquer le démarrage. */ }
    }
  }
  get(id) { const m = this.missions.get(id); return m ? { ...clone(m), workDirectory: this.workDir(id) } : null; }
  state() {
    const list = [...this.missions.values()].reverse().sort((a, b) => b.createdAt - a.createdAt);
    const activeMissions = list.filter(m => !terminal.has(m.status));
    return {
      app: 'oscar-et-les-agents',
      dataLocation: 'Documents/Oscar et les agents',
      maxConcurrentMissions: MAX_CONCURRENT_MISSIONS,
      preferredProvider: this.preferredProvider,
      logins: clone(this.logins), providers: clone(this.providers),
      missions: list.map(m => ({ id: m.id, title: m.title, folderName: m.folderName, provider: m.provider, status: m.status, createdAt: m.createdAt, updatedAt: m.updatedAt, phase: m.phase })),
      activeMissions: activeMissions.map(m => this.get(m.id)),
      active: activeMissions.length ? this.get(activeMissions[0].id) : null,
    };
  }
  allocateFolder(m) {
    const base = readableMissionFolderName(m.title || m.prompt, m.createdAt);
    for (let suffix = 1; suffix < 10000; suffix++) {
      const name = suffix === 1 ? base : `${base} (${suffix})`;
      try { mkdirSync(path.join(this.dataDir, 'missions', name), { mode: 0o700 }); return name; }
      catch (error) { if (error.code !== 'EEXIST') throw new Error('Le dossier de la mission n’a pas pu être créé.'); }
    }
    throw new Error('Trop de missions portent déjà ce nom à cette date.');
  }
  missionDir(id) {
    const m = this.missions.get(id);
    if (!m || !validMissionId(id)) throw new Error('Mission inconnue.');
    if (!this.folderNames.has(id)) { const name = this.allocateFolder(m); this.folderNames.set(id, name); m.folderName = name; }
    const dir = path.join(this.dataDir, 'missions', this.folderNames.get(id));
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Le dossier de cette mission n’est pas un dossier local accessible.');
    return dir;
  }
  workDir(id) {
    const dir = path.join(this.missionDir(id), 'travail');
    if (existsSync(dir)) { const stat = lstatSync(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Le dossier de travail de cette mission n’est pas accessible.'); }
    return dir;
  }
  save(m) {
    const dir = this.missionDir(m.id);
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
  start({ prompt, provider = 'codex' }, { connectorPlan } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error('Écris une mission entre 1 et 16 000 caractères.');
    if (!['codex', 'claude', 'demo'].includes(provider)) throw new Error('Choisis un moteur disponible.');
    if ([...this.missions.values()].filter(m => !terminal.has(m.status)).length >= MAX_CONCURRENT_MISSIONS) throw Object.assign(new Error('Quatre missions sont déjà en cours. Attends une livraison ou arrête une mission avant d’en lancer une autre.'), { code: 'MISSION_CAPACITY' });
    if (provider !== 'demo' && !this.providers.some(p => p.id === provider && p.available)) throw new Error('Ce moteur n’est pas installé ou sa version est incompatible.');
    const m = { id: randomUUID(), prompt: prompt.trim(), title: prompt.trim().slice(0, 70), provider, status: 'planning', phase: 'Oscar prépare le plan', createdAt: Date.now(), updatedAt: Date.now(), tasks: [], events: [], result: '', files: [], error: null };
    this.missions.set(m.id, m);
    mkdirSync(this.workDir(m.id), { recursive: true });
    const controller = new AbortController();
    // Only internal callers can supply a verified, ephemeral connector capability.
    controller.connectorPlan = connectorPlan;
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
    const output = await this.runAgent({ provider: m.provider, cwd: cwd ?? this.workDir(m.id), prompt, schema, signal, readOnly, connectorPlan: this.runs.get(m.id)?.connectorPlan,
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
      prompt: `Tu es Oscar, chef de projet de Oscar et les agents. Tu pilotes cinq métiers : recherche, redaction, code, design, analyse. Prépare un plan utile de 1 à 20 tâches indépendantes, avec au maximum 4 tâches par métier. Chaque tâche recrute un spécialiste distinct. Tu peux recruter jusqu’à 4 spécialistes du même métier si leurs approches ou leurs contributions sont complémentaires ; par exemple quatre designers peuvent explorer quatre directions visuelles différentes. Respecte une demande explicite de plusieurs spécialistes du même métier. N’impose ni 20 tâches ni 4 agents quand une équipe plus petite suffit. Utilise uniquement les métiers nécessaires. Quatre agents au maximum travailleront en même temps dans cette mission, les autres attendront leur tour. Chaque spécialiste reçoit le contexte complet de la mission, mais pas le résultat des autres tâches. Ne crée pas de dépendances entre tâches ; tu rapprocheras et intégreras toi-même leurs contributions lors de la livraison finale. Définis des critères de validation concrets. Dans deliverables, indique les noms relatifs exacts des fichiers à créer (par exemple index.html ou rapport.md). Une tâche de code ou design doit toujours rendre au moins un fichier, même un rapport pour une simple analyse. Pour les autres métiers, une réponse textuelle suffit et deliverables peut être vide, sauf si la mission demande un fichier. Les tâches portent sur le travail demandé, pas sur l’organisation interne. Réponds uniquement au format JSON du schéma. Ne lance aucun outil.\n\nMISSION :\n${m.prompt}`,
    }, signal));
    m.title = limit(plan.title, 100);
    m.approach = limit(plan.approach, 3000);
    m.tasks = nameTasks(plan.tasks.map((t, i) => ({ id: `t${i + 1}`, role: t.role, title: limit(t.title, 160), instruction: limit(t.instruction, 8000), criteria: limit(t.criteria, 4000), deliverables: t.deliverables, status: 'queued', activity: 'Attend les consignes d’Oscar', report: '', review: null, attempt: 0 })));
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
      m.result = '# Travail à revoir\n\nOscar n’a pas validé tous les résultats. Les rapports et fichiers sont conservés.\n\n' + m.tasks.filter(t => t.status !== 'approved').map(t => `## ${t.title} — ${agentName(t)}\n${t.review?.feedback ?? t.activity}`).join('\n\n');
      this.event(m, 'Oscar', 'Certains résultats ne remplissent pas encore les critères. Je ne les marque pas comme validés.', 'review');
      return;
    }
    m.status = 'reviewing'; m.phase = 'Oscar assemble la livraison'; this.save(m);
    for (let attempt = 1; attempt <= 2; attempt++) {
      m.result = limit(await this.call(m, {
        prompt: `Tu es Oscar, chef de projet. Tu as contrôlé et approuvé les rapports ci-dessous. Assemble une livraison finale cohérente et utile à la demande initiale. Rapproche les contributions des collègues d’un même métier : compare leurs approches, explique tes choix et réunis les éléments complémentaires. Si la mission produit un site, logiciel ou plusieurs fichiers complémentaires, intègre réellement les contributions dans un dossier Livraison/ prêt à utiliser : une liste de fichiers séparés n’est pas une intégration. Tu peux lire les contributions et créer des fichiers dans ce dossier de travail ; ne supprime ni n’écrase les contributions des spécialistes. Pour une mission de texte, assemble directement le texte complet dans ta réponse. Réponds en Markdown. Signale les limites et les points non vérifiés, cite les fichiers par leurs chemins relatifs. Ne prétends jamais avoir exécuté des tests sans preuve.\n\nMISSION :\n${m.prompt}\n\nRAPPORTS VALIDÉS :\n${m.tasks.map(t => `## ${t.title} — ${agentName(t)} (${ROLES[t.role].label})\nDossier : ${t.id}-${t.role}/\n${t.report}\nValidation : ${t.review.feedback}`).join('\n\n')}\n\nFICHIERS RÉELLEMENT PRÉSENTS :\n${JSON.stringify(m.files)}${m.finalReview ? `\n\nCORRECTIONS SUR L’ASSEMBLAGE :\n${m.finalReview.feedback}` : ''}`,
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
    const name = agentName(task);
    const cwd = path.join(this.workDir(m.id), `${task.id}-${task.role}`);
    mkdirSync(cwd, { recursive: true });
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.check(signal);
      task.attempt = attempt; task.status = attempt === 1 ? 'working' : 'revising';
      task.activity = attempt === 1 ? 'Travaille sur la mission' : 'Corrige selon le retour d’Oscar';
      this.event(m, name, `${attempt === 1 ? 'Commence' : 'Reprend'} : ${task.title}`, 'activity');
      task.report = limit(await this.call(m, { cwd, who: name, task,
        prompt: `${role.prompt}\nTon nom dans l’équipe est ${name}. Tu travailles pour Oscar, chef de projet. Réponds en français. Travaille uniquement dans ton dossier, ne supprime rien. Les commandes qui nécessitent une autorisation ne sont pas exécutées automatiquement : mentionne ce qui n’a pas pu être testé. Produis un rapport complet, des sources vérifiables si nécessaire et les fichiers demandés. Les fichiers que tu crées sont sous ${task.id}-${task.role}/ dans la livraison. Ne modifie aucun fichier hors de ton dossier.\n\nMISSION GLOBALE :\n${m.prompt}\n\nTA TÂCHE :\n${task.instruction}\n\nFICHIERS OBLIGATOIRES DANS TON DOSSIER :\n${JSON.stringify(task.deliverables)}\n\nCRITÈRES D’ACCEPTATION :\n${task.criteria}${task.review ? `\n\nCORRECTIONS DEMANDÉES PAR OSCAR :\n${task.review.feedback}\n\nTON RAPPORT PRÉCÉDENT :\n${task.report}` : ''}`,
      }, signal));
      task.status = 'reviewing'; task.activity = 'Oscar examine le résultat';
      this.scanFiles(m);
      this.event(m, 'Oscar', `Je vérifie le travail de ${name} : ${task.title}.`, 'review');
      task.review = validateReview(await this.call(m, { readOnly: true, schema: REVIEW_SCHEMA,
        prompt: `Tu es Oscar, chef de projet et contrôleur qualité. Examine le rapport de ${name}, spécialiste ${role.label}, avec un regard critique, en fonction de la demande et des critères. Lis les fichiers obligatoires dans le dossier ${task.id}-${task.role} ; ne modifie rien. Approuve uniquement si la tâche est réellement satisfaite et si les résultats sont étayés. Un rapport qui annonce un fichier absent de l’inventaire doit être refusé. Si les preuves manquent, indique les corrections exactes. Réponds uniquement au JSON du schéma.\n\nMISSION :\n${m.prompt}\n\nTÂCHE : ${task.instruction}\nCRITÈRES : ${task.criteria}\nFICHIERS OBLIGATOIRES : ${JSON.stringify(task.deliverables)}\nINVENTAIRE RÉEL DU SPÉCIALISTE : ${JSON.stringify(m.files.filter(f => f.path.startsWith(`${task.id}-${task.role}/`)))}\n\nRAPPORT :\n${task.report}`,
      }, signal));
      const missing = task.deliverables.filter(file => {
        const target = path.resolve(cwd, file);
        try { return !realpathSync(target).startsWith(realpathSync(cwd) + path.sep) || !statSync(target).isFile() || statSync(target).size === 0; } catch { return true; }
      });
      if (missing.length) task.review = { approved: false, feedback: `Fichiers obligatoires absents ou vides : ${missing.join(', ')}. Crée ces fichiers avant de demander la validation.` };
      this.event(m, 'Oscar', `${task.review.approved ? 'Validé' : 'À corriger'} — ${name}, ${task.title} : ${task.review.feedback}`, 'review');
      const reports = path.join(this.workDir(m.id), 'Rapports'); mkdirSync(reports, { recursive: true });
      writeFileSync(path.join(reports, `${task.id}-${task.role}.md`), `# ${task.title}\n\nSpécialiste : ${name} (${role.label})\n\n${task.report}\n\n## Contrôle d’Oscar\n${task.review.approved ? 'Validé' : 'À reprendre'} — ${task.review.feedback}\n`);
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
    const demoTasks = [
      { role: 'design', title: 'Explorer une direction visuelle chaleureuse' },
      { role: 'design', title: 'Proposer une palette et des caractères lisibles' },
      { role: 'design', title: 'Composer une page adaptée au téléphone' },
      { role: 'design', title: 'Imaginer les visuels de lancement' },
      { role: 'recherche', title: 'Repérer les informations à vérifier' },
      { role: 'redaction', title: 'Rédiger un message de lancement' },
      { role: 'code', title: 'Préparer une page de présentation' },
      { role: 'analyse', title: 'Comparer les hypothèses' },
    ];
    m.tasks = nameTasks(demoTasks.map((task, i) => ({ ...task, id: `t${i + 1}`, instruction: 'Exemple de tâche dans la démonstration.', criteria: 'Un résultat clair, avec ses limites.', deliverables: [], status: 'queued', activity: 'Attend les consignes d’Oscar', report: '', review: null, attempt: 0 })));
    m.status = 'running'; m.phase = 'Démonstration · huit spécialistes, dont quatre designers';
    this.event(m, 'Oscar', 'Je recrute huit spécialistes, dont Alma, Maya, Jade et Rose pour quatre contributions de design complémentaires. Quatre agents travaillent à la fois. Tous les résultats affichés ici sont simulés.');
    const perform = async t => {
      t.status = 'working'; t.attempt = 1; t.activity = 'Exemple d’activité simulée';
      this.event(m, agentName(t), t.title, 'activity');
      await wait(); await wait();
      t.status = 'reviewing'; t.activity = 'Oscar examine le résultat simulé';
      this.event(m, 'Oscar', `Je vérifie le travail de ${agentName(t)} : ${t.title}.`, 'review'); await wait();
      if (t.role === 'design' && agentName(t) === ROLES.design.name) {
        t.status = 'revising'; t.attempt = 2; t.activity = 'Améliore le contraste du bouton';
        this.event(m, 'Oscar', `${agentName(t)}, améliore le contraste du bouton pour qu’il reste lisible.`, 'review'); await wait();
        t.status = 'reviewing'; t.activity = 'Oscar vérifie la correction simulée';
        this.event(m, 'Oscar', `Je vérifie la correction de ${agentName(t)}.`, 'review'); await wait();
      }
      t.report = `Démonstration uniquement.\n\nRapport simulé de ${agentName(t)}, spécialiste ${ROLES[t.role].label} : voici un exemple de contribution rendue à Oscar. Dans une mission réelle, ce texte et les fichiers proviennent du moteur sélectionné.\n\nAucune recherche réelle ni vérification externe n’a été effectuée.`;
      t.review = { approved: true, feedback: 'Exemple de validation simulée après contrôle des critères.' };
      t.status = 'approved'; t.activity = 'Validation simulée';
      this.event(m, 'Oscar', `Exemple validé : ${agentName(t)}, ${t.title}.`, 'success');
    };
    let index = 0;
    const worker = async () => {
      while (index < m.tasks.length) {
        this.check(signal);
        await perform(m.tasks[index++]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, m.tasks.length) }, worker));
    this.check(signal);
    m.result = '# Démonstration de Oscar et les agents\n\nOscar recrute huit spécialistes, dont quatre designers aux contributions complémentaires : Alma, Maya, Jade et Rose. Il fait travailler quatre agents à la fois, reçoit leurs rapports, demande une correction quand un critère n’est pas rempli, puis assemble la livraison.\n\nCe parcours était entièrement simulé. Aucun moteur IA n’a été appelé et aucun quota n’a été consommé.\n\nPour une vraie mission, choisis OpenAI · Codex ou Claude Code et décris le résultat attendu.';
    writeFileSync(path.join(this.workDir(m.id), 'Demonstration.md'), m.result);
    this.scanFiles(m); m.status = 'completed'; m.phase = 'Démonstration terminée · aucun appel IA';
    this.event(m, 'Oscar', 'La démonstration est terminée. Tu peux maintenant lancer une vraie mission.', 'success');
  }
}
