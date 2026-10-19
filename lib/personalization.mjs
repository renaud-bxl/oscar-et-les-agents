import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { VoiceStorage } from './local-voice.mjs';

const CITY_FILE = fileURLToPath(new URL('../resources/cities.json', import.meta.url));
const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const USER_AGENT = 'oscar-agents/0.6.0 (+https://github.com/renaud-bxl/oscar-et-les-agents)';
const HALF_HOUR = 30 * 60000;
const EMPTY = Object.freeze({ name: '', region: '', latitude: null, longitude: null, weatherEnabled: false });
const CODES = new Set(['sun', 'cloud', 'rain', 'snow', 'thunder', 'fog']);
export const PERSONALIZATION_SOURCES = Object.freeze({
  regions: Object.freeze({ name: 'GeoNames', url: 'https://www.geonames.org/', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', local: true }),
  weather: Object.freeze({ name: 'MET Norway', url: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', forecast: true }),
});
const DESCRIPTIONS = {
  sun: { fr: 'Ciel dégagé prévu', en: 'Clear skies forecast', nl: 'Heldere hemel voorspeld' },
  cloud: { fr: 'Nuages prévus', en: 'Clouds forecast', nl: 'Bewolking voorspeld' },
  rain: { fr: 'Pluie prévue', en: 'Rain forecast', nl: 'Regen voorspeld' },
  snow: { fr: 'Neige ou grésil prévus', en: 'Snow or sleet forecast', nl: 'Sneeuw of natte sneeuw voorspeld' },
  thunder: { fr: 'Orages prévus', en: 'Thunderstorms forecast', nl: 'Onweer voorspeld' },
  fog: { fr: 'Brouillard prévu', en: 'Fog forecast', nl: 'Mist voorspeld' },
};
const error = message => Object.assign(new Error(message), { code: 'PROFILE_INVALID' });
const clone = value => structuredClone(value);
const normalize = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const coordinates = profile => `${profile.latitude.toFixed(2)},${profile.longitude.toFixed(2)}`;
const finiteDate = value => { const time = Date.parse(value); return Number.isFinite(time) ? time : null; };
const lastModified = (value, now) => typeof value === 'string' && value.length <= 120 && !/[\r\n]/.test(value) && finiteDate(value) !== null && finiteDate(value) <= now ? value : null;

export function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !Object.hasOwn(EMPTY, key))) throw error('Les options du profil ne sont pas valides.');
  const result = { ...EMPTY, ...body };
  for (const [key, limit] of [['name', 60], ['region', 160]]) {
    if (typeof result[key] !== 'string' || result[key].length > limit || /[\x00-\x1f\x7f]/.test(result[key])) throw error('Le prénom ou la région contient un texte trop long ou inattendu.');
    result[key] = result[key].trim();
  }
  if (typeof result.weatherEnabled !== 'boolean') throw error('Choisissez explicitement si vous souhaitez la météo.');
  if ((result.latitude === null) !== (result.longitude === null)) throw error('Choisissez une ville ou une position complète.');
  if (result.latitude !== null) {
    if (typeof result.latitude !== 'number' || typeof result.longitude !== 'number' || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude) || Math.abs(result.latitude) > 90 || Math.abs(result.longitude) > 180) throw error('La position choisie n’est pas valide.');
    result.latitude = Math.round(result.latitude * 100) / 100; result.longitude = Math.round(result.longitude * 100) / 100;
  }
  if (result.weatherEnabled && (result.latitude === null || !result.region)) throw error('Choisissez une ville ou votre position avant d’activer la météo.');
  return result;
}

export function metWeatherCode(symbol) {
  if (typeof symbol !== 'string' || symbol.length > 80) return null;
  if (symbol.includes('thunder')) return 'thunder';
  if (symbol.includes('snow') || symbol.includes('sleet')) return 'snow';
  if (symbol.includes('rain') || symbol.includes('drizzle')) return 'rain';
  if (symbol.startsWith('fog')) return 'fog';
  if (symbol.startsWith('clearsky')) return 'sun';
  if (/^(fair|partlycloudy|cloudy)(?:_|$)/.test(symbol)) return 'cloud';
  return null;
}

export function parseWeatherForecast(payload, now) {
  return selectForecast(forecastEntries(payload, now), now);
}
function forecastEntries(payload, now) {
  const series = payload?.properties?.timeseries;
  if (!Array.isArray(series) || series.length > 500) throw error('La prévision météo n’est pas disponible pour le moment.');
  const candidates = series.map(row => ({ row, time: finiteDate(row?.time) })).filter(item => item.time !== null && item.time <= now + 24 * 3600000 && item.time >= now - 90 * 60000).sort((a, b) => a.time - b.time);
  const entries = [];
  for (const { row, time } of candidates) {
    const summary = row.data?.next_1_hours || row.data?.next_6_hours || row.data?.next_12_hours;
    const code = metWeatherCode(summary?.summary?.symbol_code);
    const temperatureC = row.data?.instant?.details?.air_temperature;
    if (!code || typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC < -100 || temperatureC > 70) continue;
    const hours = row.data?.next_1_hours ? 1 : row.data?.next_6_hours ? 6 : 12;
    entries.push({ code, temperatureC: Math.round(temperatureC * 10) / 10, validAt: new Date(time).toISOString(), validUntil: new Date(time + hours * 3600000).toISOString(), modelUpdatedAt: finiteDate(payload.properties?.meta?.updated_at) === null ? null : payload.properties.meta.updated_at });
    if (entries.length === 28) break;
  }
  return entries;
}
function selectForecast(entries, now) {
  const current = entries.filter(row => finiteDate(row.validAt) >= now - 90 * 60000 && finiteDate(row.validAt) <= now + 3600000 && finiteDate(row.validUntil) >= now).sort((a, b) => Math.abs(finiteDate(a.validAt) - now) - Math.abs(finiteDate(b.validAt) - now))[0];
  if (current) return current;
  throw error('La prévision météo n’est pas disponible pour le moment.');
}
function storedForecast(row) {
  if (!row || !CODES.has(row.code) || !Number.isFinite(row.temperatureC) || row.temperatureC < -100 || row.temperatureC > 70 || finiteDate(row.validAt) === null || finiteDate(row.validUntil) === null) return null;
  return { code: row.code, temperatureC: row.temperatureC, validAt: row.validAt, validUntil: row.validUntil, modelUpdatedAt: finiteDate(row.modelUpdatedAt) === null ? null : row.modelUpdatedAt };
}

async function boundedJson(response, limit = 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw error('La prévision météo n’est pas disponible pour le moment.');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > limit) throw error('La prévision météo n’est pas disponible pour le moment.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}

export class Personalization {
  constructor({ dataDir, fetchImpl = fetch, now = Date.now, random = Math.random, citiesFile = CITY_FILE } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw error('Le dossier du bureau est nécessaire.');
    this.storage = new VoiceStorage(dataDir, 'personnalisation'); this.root = this.storage.root;
    this.file = path.join(this.root, 'profil.json'); this.weatherFile = path.join(this.root, 'prevision.json');
    Object.assign(this, { fetch: fetchImpl, now, random, citiesFile });
    this.profile = { ...EMPTY }; this.cache = null; this.revision = 0; this.failures = 0; this.retryAt = 0; this.closed = false;
    this.saveQueue = Promise.resolve(); this.ready = this.load();
  }
  async load() {
    try { this.profile = validateProfile(JSON.parse((await this.storage.read(this.file, 16384)).toString('utf8'))); }
    catch (failure) { if (failure.code !== 'ENOENT') this.loadError = 'Le profil enregistré n’a pas pu être lu. Les données sont conservées ; aucun accès météo n’est lancé.'; return; }
    try {
      const saved = JSON.parse((await this.storage.read(this.weatherFile, 16384)).toString('utf8'));
      const weather = storedForecast(saved.weather);
      if (this.profile.weatherEnabled && saved.key === coordinates(this.profile) && weather && Number.isFinite(saved.weather.fetchedAt) && Number.isFinite(saved.expiresAt)) {
        this.cache = { key: saved.key, weather: { ...weather, fetchedAt: saved.weather.fetchedAt }, forecasts: Array.isArray(saved.forecasts) ? saved.forecasts.slice(0, 28).map(storedForecast).filter(Boolean) : [weather], expiresAt: saved.expiresAt, lastModified: lastModified(saved.lastModified, this.now()) };
      }
    } catch { /* The optional cached forecast never replaces a saved profile. */ }
  }
  weatherState() {
    const base = { source: PERSONALIZATION_SOURCES.weather, forecast: true };
    if (!this.profile.weatherEnabled) return { ...base, status: 'disabled' };
    if (this.profile.latitude === null || !this.profile.region) return { ...base, status: 'not_configured' };
    if (!this.cache || this.cache.key !== coordinates(this.profile)) return { ...base, status: this.pending ? 'loading' : 'unavailable', retryAt: this.retryAt || null };
    const now = this.now(); let current = this.cache.weather;
    try { current = { ...selectForecast(this.cache.forecasts, now), fetchedAt: this.cache.weather.fetchedAt }; } catch { /* Retain an explicitly stale forecast when no current slot exists. */ }
    const valid = finiteDate(current.validAt);
    const fresh = now <= this.cache.expiresAt && current.fetchedAt <= now + 60000 && now - current.fetchedAt <= 3 * 3600000 && valid >= now - 3 * 3600000 && valid <= now + 3600000 && finiteDate(current.validUntil) >= now;
    return { ...base, ...clone(current), status: fresh ? 'ready' : 'stale', description: clone(DESCRIPTIONS[current.code]), expiresAt: this.cache.expiresAt, retryAt: this.retryAt || null };
  }
  async state() { await this.ready; return { profile: clone(this.profile), weather: this.weatherState(), sources: clone(PERSONALIZATION_SOURCES), ...(this.loadError ? { message: this.loadError } : {}) }; }
  async write(file, value) {
    await this.storage.directory(this.root, { create: true });
    const temporary = path.join(this.root, `.profil-${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await this.storage.directory(this.root); await rename(temporary, file); }
    finally { await this.storage.remove(temporary).catch(() => {}); }
  }
  async save(body) {
    await this.ready; if (this.closed) throw error('Le bureau se ferme.'); if (this.loadError) throw error(this.loadError);
    const profile = validateProfile(body);
    const operation = this.saveQueue.then(async () => {
      try { await this.write(this.file, profile); } catch { throw error('Le profil n’a pas pu être enregistré. Vos saisies sont conservées.'); }
      const changed = profile.weatherEnabled !== this.profile.weatherEnabled || profile.latitude !== this.profile.latitude || profile.longitude !== this.profile.longitude;
      this.profile = profile;
      if (changed) { this.revision++; this.controller?.abort(); this.cache = null; this.failures = 0; this.retryAt = 0; await this.storage.remove(this.weatherFile).catch(() => {}); }
      return this.state();
    });
    this.saveQueue = operation.catch(() => {}); return operation;
  }
  async cities() {
    if (!this.cityPromise) this.cityPromise = (async () => {
      const bytes = await readFile(this.citiesFile); if (bytes.length > 8 * 1024 * 1024) throw error('Le catalogue local des villes n’est pas disponible.');
      const data = JSON.parse(bytes.toString('utf8')); if (data.version !== 1 || !Array.isArray(data.cities) || data.cities.length > 100000) throw error('Le catalogue local des villes n’est pas disponible.');
      return data.cities.map(row => ({ id: String(row[0]), name: row[1], country: row[2], latitude: row[3], longitude: row[4], population: row[5], names: [...new Set([row[1], ...(Array.isArray(row[6]) ? row[6] : [])].map(normalize))] }));
    })().catch(() => { this.cityPromise = null; throw error('Le catalogue local des villes n’est pas disponible.'); });
    return this.cityPromise;
  }
  async regions(query, { language = 'fr' } = {}) {
    if (typeof query !== 'string' || query.length > 100 || /[\x00-\x1f\x7f]/.test(query)) throw error('Écrivez un nom de ville de 2 à 100 caractères.');
    const q = normalize(query); if (q.length < 2) return { regions: [], source: clone(PERSONALIZATION_SOURCES.regions) };
    const locale = ['fr', 'en', 'nl'].includes(language) ? language : 'fr', countryNames = new Intl.DisplayNames([locale], { type: 'region' });
    const matches = [];
    for (const city of await this.cities()) {
      let rank = Infinity;
      for (const candidate of city.names) { if (candidate === q) { rank = 0; break; } if (candidate.startsWith(q)) rank = Math.min(rank, 1); else if (candidate.includes(q)) rank = Math.min(rank, 2); }
      if (Number.isFinite(rank)) matches.push({ city, rank });
    }
    matches.sort((a, b) => a.rank - b.rank || b.city.population - a.city.population);
    return { regions: matches.slice(0, 10).map(({ city }) => ({ id: city.id, name: city.name, country: city.country, label: `${city.name} · ${countryNames.of(city.country) || city.country}`, latitude: city.latitude, longitude: city.longitude })), source: clone(PERSONALIZATION_SOURCES.regions) };
  }
  async refreshWeather({ signal } = {}) {
    await this.ready;
    if (this.closed || !this.profile.weatherEnabled || this.profile.latitude === null || signal?.aborted) return this.state();
    const now = this.now(), key = coordinates(this.profile);
    if ((this.cache?.key === key && now < this.cache.expiresAt) || now < this.retryAt) return this.state();
    if (this.pending) { await this.pending; return this.state(); }
    const revision = this.revision, controller = new AbortController(); this.controller = controller;
    const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    this.pending = (async () => {
      try {
        const url = new URL(MET_URL); url.searchParams.set('lat', this.profile.latitude.toFixed(2)); url.searchParams.set('lon', this.profile.longitude.toFixed(2));
        const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' };
        if (this.cache?.key === key && this.cache.lastModified) headers['If-Modified-Since'] = this.cache.lastModified;
        let target = url, response;
        for (let redirect = 0; redirect < 4; redirect++) {
          response = await this.fetch(target.href, { headers, signal: combined, redirect: 'manual' });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          target = new URL(response.headers.get('location'), target);
          if (target.origin !== 'https://api.met.no' || !target.pathname.startsWith('/weatherapi/locationforecast/2.0/') || target.username || target.password) throw error('La prévision météo n’est pas disponible pour le moment.');
        }
        if (response.status === 429 || response.status >= 500) {
          const retry = response.headers.get('retry-after'), date = finiteDate(retry);
          this.retryAt = Math.max(this.now() + HALF_HOUR, /^\d+$/.test(retry || '') ? this.now() + Number(retry) * 1000 : date || 0); throw error('La prévision météo n’est pas disponible pour le moment.');
        }
        if (!response.ok && response.status !== 304) throw error('La prévision météo n’est pas disponible pour le moment.');
        const forecasts = response.status === 304 && this.cache?.key === key ? this.cache.forecasts : forecastEntries(await boundedJson(response), this.now());
        const forecast = selectForecast(forecasts, this.now());
        if (!forecast || revision !== this.revision || combined.aborted || !this.profile.weatherEnabled) return;
        const fetchedAt = this.now(), expiresAt = Math.max(fetchedAt + HALF_HOUR, finiteDate(response.headers.get('expires')) || 0) + Math.floor(Math.max(0, Math.min(1, this.random())) * 120000);
        const cache = { key, weather: { ...forecast, fetchedAt }, forecasts, expiresAt, lastModified: lastModified(response.headers.get('last-modified'), fetchedAt) || this.cache?.lastModified || null };
        await this.write(this.weatherFile, cache);
        if (revision !== this.revision || combined.aborted) { await this.storage.remove(this.weatherFile).catch(() => {}); return; }
        this.cache = cache; this.failures = 0; this.retryAt = 0;
      } catch {
        if (revision === this.revision && !controller.signal.aborted && !signal?.aborted) { this.failures++; this.retryAt = Math.max(this.retryAt, this.now() + Math.min(6 * 3600000, HALF_HOUR * 2 ** Math.min(5, this.failures - 1))); }
      }
    })().finally(() => { this.pending = null; if (this.controller === controller) this.controller = null; });
    await this.pending; return this.state();
  }
  async close() { this.closed = true; this.controller?.abort(); await this.ready; await this.pending; await this.saveQueue; }
}
export default Personalization;
