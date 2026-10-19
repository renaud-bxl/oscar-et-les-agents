// Drafts contain only unfinished writing. Accounts, connector selections,
// passwords, files and coordinates never belong in this store.
const PREFIX = 'oscar.writing-drafts.v1';
const TTL = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 96 * 1024;
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,100}$/;
const SLOTS = new Set(['oscar', 'secretary', 'routine', 'studio']);
const textFields = new Set(['text', 'title', 'subject']);
const clone = value => value ? { ...value } : null;

export function draftScope(location = globalThis.location, session) {
  try {
    const mission = new URL(location.href).searchParams.get('mission');
    const storage = session === undefined ? globalThis.sessionStorage : session;
    if (!storage) return mission && /^[a-zA-Z0-9_-]{1,100}$/.test(mission) ? mission : 'home';
    let office = storage.getItem('oscar.draft-office.v1');
    if (!/^office_[a-zA-Z0-9_-]{8,80}$/.test(office || '')) {
      office = `office_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
      storage.setItem('oscar.draft-office.v1', office);
    }
    return office;
  } catch { return 'home'; }
}

function sanitize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = {};
  for (const key of textFields) if (typeof input[key] === 'string') value[key] = input[key].slice(0, key === 'text' ? 16000 : 200);
  if (['mail', 'calendar', 'service', 'free'].includes(input.mode)) value.mode = input.mode;
  if (['auto', 'codex', 'claude'].includes(input.provider)) value.provider = input.provider;
  if (['auto','4','8','12','15','20'].includes(input.teamSize)) value.teamSize=input.teamSize;
  if (typeof input.requestId === 'string' && REQUEST_ID.test(input.requestId)) value.requestId = input.requestId;
  if (typeof input.requestHash === 'string' && /^[a-f0-9]{64}$/.test(input.requestHash)) value.requestHash = input.requestHash;
  return Object.values(value).some(item => typeof item === 'string' && item.trim()) ? value : null;
}

export class DraftStorage {
  constructor({ scope = draftScope(), storage, now = Date.now, ttl = TTL, maxEntries = 12, maxBytes = LIMIT } = {}) {
    this.scope = /^[a-zA-Z0-9_-]{1,100}$/.test(scope) ? scope : 'home';
    try { this.storage = storage === undefined ? globalThis.localStorage : storage; } catch { this.storage = null; }
    Object.assign(this, { now, ttl: Math.min(Math.max(ttl, 1000), TTL), maxEntries: Math.min(Math.max(maxEntries, 1), 20), maxBytes: Math.min(Math.max(maxBytes, 2048), LIMIT) });
    this.available = Boolean(this.storage);
  }
  readAll() {
    const entries = [];
    try {
      const raw = this.storage?.getItem(PREFIX);
      if (!raw) return entries;
      if (raw.length > this.maxBytes) { this.storage.removeItem(PREFIX); return entries; }
      const record = JSON.parse(raw);
      if (record?.version !== 1 || !Array.isArray(record.entries) || record.entries.length > 20) return entries;
      for (const row of record.entries) {
        if (!row || typeof row.scope !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.scope) || !SLOTS.has(row.slot) || !Number.isFinite(row.updatedAt) || row.updatedAt > this.now() + 60000 || this.now() - row.updatedAt >= this.ttl) continue;
        const value = sanitize(row.value); if (value) entries.push({ scope: row.scope, slot: row.slot, updatedAt: row.updatedAt, value });
      }
    } catch { this.available = false; }
    return entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, this.maxEntries);
  }
  persist(entries) {
    if (!this.storage) return false;
    const sorted = entries.sort((a,b) => b.updatedAt - a.updatedAt).slice(0, this.maxEntries);
    let raw = JSON.stringify({ version: 1, entries: sorted });
    while (raw.length > this.maxBytes && sorted.length) { sorted.pop(); raw = JSON.stringify({ version: 1, entries: sorted }); }
    try { if (sorted.length) this.storage.setItem(PREFIX, raw); else this.storage.removeItem(PREFIX); this.available = true; return true; }
    catch { this.available = false; return false; }
  }
  read(slot) {
    if (!SLOTS.has(slot)) return null;
    const entries = this.readAll();
    // Access also purges expired and corrupt records, without launching work.
    this.persist(entries);
    return clone(entries.find(row => row.scope === this.scope && row.slot === slot)?.value);
  }
  write(slot, input) {
    if (!SLOTS.has(slot)) return false;
    const entries = this.readAll().filter(row => row.scope !== this.scope || row.slot !== slot), value = sanitize(input);
    if (value) entries.unshift({ scope: this.scope, slot, updatedAt: this.now(), value });
    return this.persist(entries);
  }
  remove(slot) { return SLOTS.has(slot) && this.persist(this.readAll().filter(row => row.scope !== this.scope || row.slot !== slot)); }
}
