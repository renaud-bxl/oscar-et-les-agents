// A restart is allowed only after both HTTP work and detached account/model
// operations are idle. This check is synchronous so reserving maintenance and
// rejecting the next request cannot race with a new mission in the same turn.
export function updateBlockers({ engine, calendar, login, connectors, publishing, automations, documents, voice, dictation, questions, preparations, secretaryPending, activeArchive, archiveTasks, requests, responses } = {}) {
  const reasons = [];
  const count = value => value?.size || value?.length || 0;
  if (count(engine?.runs) || engine?.state?.().activeMissions?.length) reasons.push('missions');
  if (count(calendar?.activeJobs)) reasons.push('calendar');
  if (count(login?.jobs) || count(connectors?.active) || count(connectors?.inspections) || count(connectors?.processes)) reasons.push('connections');
  if (count(publishing?.jobs) || count(publishing?.pending) || publishing?.loginJob) reasons.push('publishing');
  if (count(automations?.launching) || count(automations?.pending)) reasons.push('automations');
  if (documents?.runtime?.status === 'installing' || count(documents?.readerControllers) || count(documents?.exportTasks)) reasons.push('documents');
  if ([voice?.studio, voice?.piper].some(value => value?.operation || value?.active || value?.speaking || count(value?.queue))) reasons.push('voice');
  if (dictation?.operation || dictation?.active) reasons.push('dictation');
  if (questions?.countActive || count(preparations) || count(secretaryPending) || activeArchive || count(archiveTasks) || count(requests) || count(responses)) reasons.push('requests');
  return reasons;
}

export class UpdateMaintenance {
  constructor() { this.active = false; this.requests = new Set(); this.responses = new Set(); }
  track(res) {
    const token = {}; this.requests.add(token); this.responses.add(token);
    const responseDone = () => { this.responses.delete(token); res.off('finish', responseDone); res.off('close', responseDone); };
    res.once('finish', responseDone); res.once('close', responseDone);
    return () => this.requests.delete(token);
  }
  reserve(reasons) {
    if (this.active || reasons.length) throw Object.assign(new Error('Terminez les missions, connexions et opérations en cours avant de mettre le bureau à jour.'), { code: 'UPDATE_BUSY' });
    this.active = true;
  }
  release() { this.active = false; }
}
