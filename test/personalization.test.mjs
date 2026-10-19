import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm, symlink } from 'node:fs/promises';
import { Personalization, validateProfile, parseWeatherForecast, metWeatherCode } from '../lib/personalization.mjs';

const START = Date.UTC(2026, 9, 19, 7);
const chosen = { name: 'Renaud', region: 'Bruxelles · Belgique', latitude: 50.850345, longitude: 4.351721, weatherEnabled: true };
function payload(time = START, symbols = ['lightrain_day', 'clearsky_day', 'cloudy']) { return { properties: { meta: { updated_at: new Date(time - 3600000).toISOString() }, timeseries: symbols.map((symbol, index) => ({ time: new Date(time + index * 3600000).toISOString(), data: { instant: { details: { air_temperature: 12.4 + index } }, next_1_hours: { summary: { symbol_code: symbol } } } })) } }; }
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'oscar-profile-')); let time = START; const calls = [];
  const service = new Personalization({ dataDir, now: () => time, random: () => 0, fetchImpl: async (...args) => { calls.push(args); return new Response(JSON.stringify(payload()), { headers: { Expires: new Date(time + 3600000).toUTCString(), 'Last-Modified': new Date(START - 3600000).toUTCString() } }); }, ...options });
  await service.ready; t.after(async () => { await service.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { service, dataDir, calls, setNow: value => { time = value; } };
}

test('default profile, save and local city lookup never call a weather or location service', async t => {
  const f = await fixture(t); assert.deepEqual((await f.service.state()).profile, { name: '', region: '', latitude: null, longitude: null, weatherEnabled: false });
  await assert.rejects(stat(f.service.root), { code: 'ENOENT' });
  await f.service.save({ name: ' Renaud ', region: 'Bruxelles', latitude: null, longitude: null, weatherEnabled: false });
  assert.equal((await f.service.state()).profile.name, 'Renaud'); assert.equal((await f.service.refreshWeather()).weather.status, 'disabled');
  const cities = await f.service.regions('Bruxelles'); assert.equal(cities.regions[0].id, '2800866'); assert.equal(cities.regions[0].latitude, 50.85); assert.equal(cities.source.local, true);
  assert.equal((await f.service.regions('Brussels')).regions[0].id, '2800866'); assert.equal((await f.service.regions('Brussel')).regions[0].id, '2800866');
  assert.equal((await f.service.regions('Namur')).regions[0].id, '2790471'); assert.equal((await f.service.regions('Namen', { language: 'nl' })).regions[0].id, '2790471');
  assert.ok((await f.service.regions('par')).regions.length <= 10); assert.equal(f.calls.length, 0);
  assert.equal((await stat(f.service.file)).mode & 0o777, 0o600);
});

test('profile validation rejects unexpected options, partial positions and silent weather consent', () => {
  assert.deepEqual(validateProfile(chosen), { ...chosen, latitude: 50.85, longitude: 4.35 });
  for (const body of [{ ...chosen, url: 'https://arbitrary.invalid' }, { ...chosen, latitude: 100 }, { ...chosen, longitude: '4.2' }, { ...chosen, longitude: null }, { ...chosen, weatherEnabled: 'yes' }, { ...chosen, latitude: null, longitude: null }, { ...chosen, region: '' }, { ...chosen, name: 'A'.repeat(61) }, { ...chosen, name: 'A\nB' }]) assert.throws(() => validateProfile(body));
});

test('weather starts only after saved consent, with rounded coordinates, identifying headers and no personal name', async t => {
  const f = await fixture(t); await f.service.save(chosen); assert.equal(f.calls.length, 0);
  const state = await f.service.refreshWeather(); assert.equal(state.weather.status, 'ready'); assert.equal(state.weather.code, 'rain'); assert.equal(state.weather.forecast, true); assert.match(state.weather.description.fr, /prévue/);
  assert.equal(f.calls.length, 1); const [url, options] = f.calls[0];
  assert.equal(url, 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=50.85&lon=4.35'); assert.match(options.headers['User-Agent'], /^oscar-agents\/0.6.0/); assert.ok(!JSON.stringify([url, options.headers]).includes('Renaud'));
  assert.equal((await stat(f.service.weatherFile)).mode & 0o777, 0o600); assert.ok((await stat(f.service.weatherFile)).size < 16384);
  await f.service.refreshWeather(); assert.equal(f.calls.length, 1);
});

test('Expires and If-Modified-Since are respected; 304 advances the cached forecast without a duplicate body', async t => {
  const f = await fixture(t); await f.service.save(chosen); await f.service.refreshWeather();
  f.setNow(START + 40 * 60000); await f.service.refreshWeather(); assert.equal(f.calls.length, 1);
  f.setNow(START + 61 * 60000); let request;
  f.service.fetch = async (url, options) => { request = [url, options]; return new Response(null, { status: 304, headers: { Expires: new Date(START + 3 * 3600000).toUTCString() } }); };
  const state = await f.service.refreshWeather(); assert.equal(state.weather.status, 'ready'); assert.equal(state.weather.code, 'sun'); assert.equal(request[1].headers['If-Modified-Since'], new Date(START - 3600000).toUTCString());
  assert.equal(state.weather.validAt, new Date(START + 3600000).toISOString());
  const copy = new Personalization({ dataDir: f.dataDir, now: () => START + 62 * 60000, fetchImpl: () => assert.fail('Loading must not fetch') }); t.after(() => copy.close()); await copy.ready;
  assert.equal((await copy.state()).weather.code, 'sun');
});

test('cache never expires in less than thirty minutes and network failures back off honestly', async t => {
  const f = await fixture(t); await f.service.save(chosen);
  let count = 0; f.service.fetch = async () => { count++; return new Response(JSON.stringify(payload()), { headers: { Expires: new Date(START + 60000).toUTCString() } }); };
  assert.equal((await f.service.refreshWeather()).weather.expiresAt, START + 30 * 60000); f.setNow(START + 10 * 60000); await f.service.refreshWeather(); assert.equal(count, 1);
  f.setNow(START + 31 * 60000); f.service.fetch = async () => { count++; return new Response('rate limited', { status: 429, headers: { 'Retry-After': '7200' } }); };
  const state = await f.service.refreshWeather(); assert.equal(state.weather.status, 'stale'); assert.ok(state.weather.retryAt >= START + 151 * 60000);
  await f.service.refreshWeather(); assert.equal(count, 2);
});

test('concurrent weather requests share one fetch and each receive a complete state', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { fetchImpl: async () => { await wait; return new Response(JSON.stringify(payload())); } }); await f.service.save(chosen);
  const a = f.service.refreshWeather(), b = f.service.refreshWeather(); release(); const results = await Promise.all([a, b]); assert.ok(results.every(state => state.profile.name === 'Renaud' && state.weather.status === 'ready'));
});

test('disabling weather cancels a pending request and never restores old cached coordinates', async t => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { fetchImpl: async (_url, { signal }) => { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } });
  await f.service.save(chosen); const pending = f.service.refreshWeather(); await started;
  await f.service.save({ ...chosen, weatherEnabled: false }); await pending;
  assert.equal((await f.service.state()).weather.status, 'disabled'); await assert.rejects(stat(f.service.weatherFile), { code: 'ENOENT' });
});

test('malformed, oversized or redirected weather responses produce no invented forecast', async t => {
  const f = await fixture(t); await f.service.save(chosen);
  for (const response of [new Response('{broken'), new Response(JSON.stringify(payload(START - 24 * 3600000))), new Response('too big', { headers: { 'Content-Length': String(2 * 1024 * 1024) } }), new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } })]) {
    f.service.retryAt = 0; f.service.fetch = async () => response;
    assert.equal((await f.service.refreshWeather()).weather.status, 'unavailable');
  }
});

test('forecast codes distinguish precipitation, fog and clear skies without pretending to be measurements', () => {
  for (const [symbol, code] of [['clearsky_night', 'sun'], ['partlycloudy_day', 'cloud'], ['fog', 'fog'], ['rainshowers_day', 'rain'], ['sleet', 'snow'], ['rainandthunder', 'thunder']]) assert.equal(metWeatherCode(symbol), code);
  assert.equal(metWeatherCode('invented'), null); assert.throws(() => parseWeatherForecast(payload(START - 6 * 3600000), START));
});

test('corrupt profiles and symbolic links are preserved instead of reading or overwriting outside files', async t => {
  const f = await fixture(t); await mkdir(f.service.root); const outside = path.join(f.dataDir, 'private.json'); await writeFile(outside, JSON.stringify({ secret: 'PRIVATE DATA' })); await symlink(outside, f.service.file);
  const copy = new Personalization({ dataDir: f.dataDir, fetchImpl: () => assert.fail('No remote lookup') }); t.after(() => copy.close()); await copy.ready;
  assert.equal((await copy.state()).profile.name, ''); assert.ok(!(JSON.stringify(await copy.state())).includes('PRIVATE DATA'));
  await assert.rejects(copy.save(chosen)); assert.match(await readFile(outside, 'utf8'), /PRIVATE DATA/);
});

test('packaged city resource has a bounded size, original source attribution and reproducible checksum', async () => {
  const resource = new URL('../resources/cities.json', import.meta.url), bytes = await readFile(resource), notice = JSON.parse(await readFile(new URL('../resources/cities-attribution.json', import.meta.url), 'utf8'));
  assert.ok(bytes.length < 8 * 1024 * 1024); assert.equal(notice.sourceUrl, 'https://download.geonames.org/export/dump/cities15000.zip'); assert.equal(notice.license, 'CC BY 4.0'); assert.equal(createHash('sha256').update(bytes).digest('hex'), notice.resourceSHA256); assert.equal(JSON.parse(bytes).cities.length, notice.recordCount);
});
