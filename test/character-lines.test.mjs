import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterLines, CHARACTER_LINE_BANKS, dayPeriod, weatherContext } from '../public/character-lines.js';

const now = new Date(2026, 9, 19, 10, 15).getTime();
const forecast = (code = 'rain') => ({ status: 'ready', code, fetchedAt: now, validAt: new Date(now).toISOString(), validUntil: new Date(now + 3600000).toISOString() });

test('each character has at least twenty original lines in each of the three languages', () => {
  for (const locale of ['fr', 'en', 'nl']) for (const role of ['oscar', 'zoe']) {
    const lines = CHARACTER_LINE_BANKS[locale][role]; assert.ok(lines.length >= 20); assert.equal(new Set(lines).size, lines.length); assert.ok(lines.every(line => line.length < 350));
    const generator = new CharacterLines({ random: () => 0.42 });
    const first = Array.from({ length: lines.length }, () => generator.next(role, { locale, now })); assert.equal(new Set(first).size, lines.length);
    const next = generator.next(role, { locale, now }); assert.notEqual(next, first.at(-1));
  }
});

test('character cycles, languages and aliases remain independent without invented task progress', () => {
  const generator = new CharacterLines({ random: () => 0 });
  const oscar = generator.next('oscar', { locale: 'en', now }), zoe = generator.next('zoe', { locale: 'en', now });
  assert.notEqual(oscar, zoe); assert.notEqual(generator.next('secretaire', { locale: 'en', now }), zoe);
  assert.equal(generator.next('recherche', { now }), '');
  assert.match(generator.next('oscar', { locale: 'unsupported', now }), /^Bonjour/);
});

test('greetings use the local hour and a bounded optional first name', () => {
  for (const [hour, period] of [[1, 'night'], [7, 'morning'], [13, 'afternoon'], [19, 'evening'], [23, 'night']]) assert.equal(dayPeriod(new Date(2026, 9, 19, hour)), period);
  const generator = new CharacterLines({ random: () => 0 });
  assert.match(generator.next('oscar', { firstName: ' Renaud ', now }), /^Bonjour, Renaud\./);
  assert.match(generator.next('zoe', { locale: 'nl', now: new Date(2026, 9, 19, 19) }), /^Goedenavond\./);
  assert.match(generator.next('oscar', { locale: 'en', now: new Date(2026, 9, 19, 13) }), /^Good afternoon\./);
  assert.ok(generator.next('oscar', { firstName: 'A'.repeat(1000), now, weather: forecast() }).length <= 500);
});

test('only a fresh known forecast can contribute weather wording', () => {
  for (const code of ['sun', 'cloud', 'rain', 'snow', 'thunder', 'fog']) assert.ok(weatherContext(forecast(code), now));
  for (const weather of [undefined, { ...forecast(), status: 'unavailable' }, { ...forecast(), status: 'stale' }, { ...forecast(), code: 'invented' }, { ...forecast(), fetchedAt: now - 4 * 3600000 }, { ...forecast(), fetchedAt: now + 2 * 60000 }, { ...forecast(), validAt: new Date(now + 2 * 3600000).toISOString() }, { ...forecast(), validUntil: new Date(now - 60000).toISOString() }]) assert.equal(weatherContext(weather, now), null);
  const generator = new CharacterLines({ random: () => 0 });
  assert.match(generator.next('oscar', { now, weather: forecast() }), /prévisions.*pluie/);
  assert.doesNotMatch(generator.next('oscar', { now, weather: { ...forecast(), status: 'stale' } }), /pluie|prévisions/);
  assert.match(generator.next('zoe', { locale: 'en', now, weather: forecast('sun') }), /forecast.*clear skies/);
  assert.match(generator.next('zoe', { locale: 'nl', now, weather: forecast('snow') }), /verwachting.*winterse neerslag/);
});

test('night-time personalities refer to the actual local clock and keep full varied cycles',()=>{
  const night = new Date(2026,9,19,3,7);
  for(const locale of ['fr','en','nl'])for(const role of ['oscar','zoe']){
    const generator = new CharacterLines({random:()=>.42});
    const phrases=Array.from({length:24},()=>generator.next(role,{locale,now:night,firstName:'Renaud'}));
    assert.equal(new Set(phrases).size,24,`${locale}/${role}: context must not collapse the cycle`);
    assert.ok(phrases.some(line=>line.includes('03:07')),`${locale}/${role}: the joke must use the local hour`);
    assert.ok(phrases.every(line=>line.length<=500));
    assert.notEqual(generator.next(role,{locale,now:night,firstName:'Renaud'}),phrases.at(-1));
    if(locale==='fr')assert.ok(phrases.some(line=>role==='oscar'?line.includes('graphiques portent un pyjama'):line.includes('agenda allait se coucher')));
  }
});

test('weather humour never outlives the forecast cache or its validity window',()=>{
  const expired= {...forecast('fog'),expiresAt:now-1};
  assert.equal(weatherContext(expired,now),null);
  assert.equal(weatherContext({...forecast(),expiresAt:now},now),null);
  assert.equal(weatherContext({...forecast(),expiresAt:'not-a-date'},now),null);
  assert.equal(weatherContext({...forecast(),validUntil:new Date(now).toISOString()},now),null);
  const generator=new CharacterLines({random:()=>.42});
  const fresh=Array.from({length:24},()=>generator.next('zoe',{now,weather:{...forecast('fog'),expiresAt:now+60000}}));
  assert.equal(new Set(fresh).size,24);
  assert.ok(fresh.some(line=>/priorités bien visibles/.test(line)));
  const stale=Array.from({length:24},()=>generator.next('oscar',{now,weather:expired}));
  assert.ok(stale.every(line=>!/prévisions|brouillard/.test(line)));
});
