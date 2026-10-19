import { spawn } from 'node:child_process';
import { findBinary, detectProviders } from './providers.mjs';
import { runInstaller, subscriptionEnvironment } from '../scripts/install.mjs';

const ENGINES = ['codex', 'claude'];
const connected = info => info?.available !== false && info?.auth?.loggedIn === true && info?.auth?.method !== 'api';
const interrupted = () => Object.assign(new Error('La préparation a été interrompue.'), { name: 'AbortError' });

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(interrupted());
  return new Promise((resolve, reject) => {
    const stop = () => reject(interrupted());
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', stop);
      signal.aborted ? reject(interrupted()) : resolve(value);
    }, error => { signal.removeEventListener('abort', stop); reject(error); });
  });
}

export class BrowserLogin {
  constructor({ onChange = () => {}, find = findBinary, detect = detectProviders, install = runInstaller, installerDependencies = {}, spawnImpl = spawn, timeoutMs = 8 * 60000, killGraceMs = 750 } = {}) {
    this.onChange = onChange; this.find = find; this.detect = detect; this.install = install;
    this.installerDependencies = installerDependencies; this.spawn = spawnImpl;
    this.timeoutMs = timeoutMs; this.killGraceMs = killGraceMs;
    this.logins = {}; this.jobs = new Map(); this.children = new Map();
    this.terminations = new Set(); this.installQueue = Promise.resolve(); this.closed = false;
    this.detectRevision = 0; this.appliedRevision = 0; this.providers = null;
  }

  publish(providers) {
    if (!this.closed) this.onChange(this.logins, providers);
  }

  set(provider, status, message, providers) {
    this.logins[provider] = { status, message };
    this.publish(providers);
    return this.logins[provider];
  }

  validate(provider) {
    if (!ENGINES.includes(provider)) throw new Error('Ce moteur n’est pas reconnu.');
    if (this.closed) throw new Error('Le bureau se ferme. Relancez-le avant de préparer un moteur.');
  }

  async refresh() {
    if (this.closed) throw new Error('Le bureau se ferme.');
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      let providers;
      try { providers = await this.readProviders(); }
      catch { throw new Error('Impossible de vérifier les moteurs pour le moment. Réessayez dans quelques instants.'); }
      if (!Array.isArray(providers)) throw new Error('Les moteurs n’ont pas pu être vérifiés.');
      if (this.closed) return providers;
      for (const provider of providers) {
        if (!ENGINES.includes(provider.id) || this.jobs.has(provider.id)) continue;
        if (connected(provider)) this.logins[provider.id] = { status: 'connected', message: 'Votre abonnement est déjà connecté. Cette connexion est conservée.' };
        else if (this.logins[provider.id]?.status === 'connected') this.logins[provider.id] = { status: 'failed', message: 'La connexion à cet abonnement n’est plus confirmée. Vous pouvez la renouveler dans le navigateur.' };
      }
      this.publish(providers);
      return providers;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async start(provider) { return this.begin(provider, false); }
  async setup(provider) { return this.begin(provider, true); }

  begin(provider, setup) {
    this.validate(provider);
    if (this.jobs.has(provider)) return this.logins[provider];
    const job = { provider, controller: new AbortController(), children: new Set(), phase: setup ? 'installing' : 'connecting', timedOut: false };
    this.jobs.set(provider, job);
    const state = this.set(provider, job.phase, setup ? 'Préparation du moteur sur cet ordinateur. Aucune clé API n’est nécessaire.' : 'Vérification de votre connexion à l’abonnement…');
    const timer = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, this.timeoutMs);
    timer.unref?.();
    job.completion = Promise.resolve().then(() => this.prepare(job, setup)).catch(() => {
      if (this.closed) return;
      this.set(provider, 'failed', job.timedOut
        ? 'La préparation a dépassé le délai prévu. Les programmes ont été arrêtés ; vous pouvez réessayer.'
        : job.phase === 'installing'
          ? 'La préparation locale du moteur n’a pas abouti. Vérifiez votre connexion Internet et réessayez.'
          : 'La connexion à l’abonnement n’a pas été confirmée. Cliquez pour réessayer dans le navigateur.');
    }).finally(() => {
      clearTimeout(timer);
      if (this.jobs.get(provider) === job) this.jobs.delete(provider);
    });
    return state;
  }

  check(job) {
    if (this.closed || job.controller.signal.aborted) throw interrupted();
  }

  async readProviders(signal) {
    const revision = ++this.detectRevision;
    const reading = this.detect();
    const providers = await (signal ? abortable(reading, signal) : reading);
    if (!Array.isArray(providers)) throw new Error('Moteurs indisponibles.');
    if (revision >= this.appliedRevision) { this.appliedRevision = revision; this.providers = providers; }
    return this.providers;
  }

  async inspect(job) {
    this.check(job);
    const providers = await this.readProviders(job.controller.signal);
    this.check(job);
    if (!Array.isArray(providers)) throw new Error('Moteurs indisponibles.');
    this.publish(providers);
    return providers.find(info => info.id === job.provider);
  }

  async prepare(job, setup) {
    let info = await this.inspect(job);
    if (connected(info)) {
      this.set(job.provider, 'connected', 'Votre abonnement est déjà connecté. Cette connexion est conservée.');
      return;
    }
    if (setup && !info?.available) {
      // Both engines share .tools: serialize package installation, not login.
      const installation = this.installQueue.then(async () => {
        this.check(job);
        await abortable(this.install({ engine: job.provider, skipLogin: true, noOpen: true }, {
          ...this.installerDependencies,
          env: subscriptionEnvironment(this.installerDependencies.env || process.env),
          log: () => {},
          capture: (command, args, options) => this.process(job, command, args, options, true),
          interactive: (command, args, options) => this.process(job, command, args, options, false),
        }), job.controller.signal);
      });
      this.installQueue = installation.catch(() => {});
      await abortable(installation, job.controller.signal);
      this.check(job);
      info = await this.inspect(job);
      if (!info?.available) throw new Error('Le moteur installé ne fournit pas les protections nécessaires.');
      if (connected(info)) {
        this.set(job.provider, 'connected', 'Le moteur est prêt et votre abonnement est déjà connecté.');
        return;
      }
    }
    if (!info?.available && setup) throw new Error('Moteur indisponible.');
    job.phase = 'connecting';
    this.set(job.provider, 'connecting', 'Confirmez la connexion dans le navigateur qui vient de s’ouvrir. Aucune clé API n’est demandée.');
    const binary = await abortable(this.find(job.provider), job.controller.signal);
    this.check(job);
    if (!binary) throw new Error('Le moteur est introuvable.');
    const result = await this.process(job, binary, job.provider === 'codex' ? ['login'] : ['auth', 'login', '--claudeai'], { env: subscriptionEnvironment() }, false);
    this.check(job);
    const authenticated = await this.inspect(job);
    if (result.code !== 0 || !connected(authenticated)) throw new Error('Connexion non confirmée.');
    this.set(job.provider, 'connected', 'Votre compte est connecté. Oscar peut maintenant utiliser ce moteur.');
  }

  terminate(child) {
    if (child.oscarTermination) return child.oscarTermination;
    const send = signal => {
      try {
        if (process.platform !== 'win32' && Number.isInteger(child.pid)) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The process may already have exited. */ }
    };
    send('SIGTERM');
    const termination = new Promise(resolve => setTimeout(() => { send('SIGKILL'); resolve(); }, this.killGraceMs));
    child.oscarTermination = termination;
    this.terminations.add(termination);
    termination.finally(() => this.terminations.delete(termination));
    return termination;
  }

  process(job, command, args, options = {}, capture = false) {
    this.check(job);
    return new Promise((resolve, reject) => {
      let child, stdout = '', stderr = '', bytes = 0, finished = false, failed;
      const signal = job.controller.signal;
      const stop = () => { failed = interrupted(); if (child) this.terminate(child); };
      const finish = (code, error) => {
        if (finished) return;
        finished = true;
        clearTimeout(probeTimer);
        signal.removeEventListener('abort', stop);
        job.children.delete(child); this.children.delete(child);
        if (failed || error) reject(failed || error);
        else resolve({ code: code ?? 1, ...(capture ? { stdout, stderr } : {}) });
      };
      let probeTimer;
      try {
        child = this.spawn(command, args, { ...options, env: subscriptionEnvironment(options.env || process.env), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
      } catch { finish(1, new Error('Le programme n’a pas pu démarrer.')); return; }
      job.children.add(child); this.children.set(child, job.provider);
      child.once('error', () => finish(1, new Error('Le programme n’a pas pu démarrer.')));
      child.once('close', (code, exitSignal) => finish(exitSignal ? 1 : code));
      if (capture) {
        const collect = stream => chunk => {
          bytes += chunk.length;
          if (bytes > 256 * 1024) { failed = new Error('La réponse du programme est trop longue.'); this.terminate(child); return; }
          if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
        };
        child.stdout?.on('data', collect('stdout')); child.stderr?.on('data', collect('stderr'));
        probeTimer = setTimeout(() => { failed = new Error('Le programme ne répond pas.'); this.terminate(child); }, 15000);
        probeTimer.unref?.();
      } else {
        // npm and login output may contain sensitive data. Drain without storing.
        child.stdout?.resume(); child.stderr?.resume();
      }
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.controller.abort();
    for (const child of this.children.keys()) this.terminate(child);
    this.closing = (async () => {
      await Promise.allSettled(jobs.map(job => job.completion));
      await Promise.allSettled([...this.terminations]);
    })();
    return this.closing;
  }
}
