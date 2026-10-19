import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioSvg, validateStudioFilePath, studioFileUrl, sanitizeStudioSvg } from '../public/creative-studio.js';

test('le studio crée quatre compositions originales locales dans les quatre formats proposés', () => {
  const drawings = new Set();
  for (const preset of ['affiche', 'branding', 'social', 'illustration']) {
    for (const [format, width, height] of [['1:1',1080,1080],['4:5',1080,1350],['A4',2480,3508],['16:9',1920,1080]]) {
      const svg = buildStudioSvg({ preset, format, brand:'Ma marque',title:'Mon affiche',subtitle:'Un dessin local',primary:'#123456',secondary:'#abcdef',background:'#fefefe' });
      assert.match(svg, new RegExp(`width="${width}" height="${height}"`));
      assert(svg.includes('Ma marque')); assert(svg.includes('Mon affiche')); assert(svg.includes('#123456')); assert(!/<(?:script|foreignObject|image|style)\b/i.test(svg)); assert(!/(?:href|onload|onclick)=|url\(/i.test(svg));
      drawings.add(svg);
    }
  }
  assert.equal(drawings.size,16);
});

test('les variations changent le dessin sans hasard ni requête externe', () => {
  const variations = Array.from({length:4}, (_,variation) => buildStudioSvg({variation}));
  assert.equal(new Set(variations).size,4); assert.equal(buildStudioSvg({variation:2}),variations[2]); assert.equal(buildStudioSvg({variation:6}),variations[2]);
  assert(!variations.some(svg=>/https?:/.test(svg.replace('http://www.w3.org/2000/svg',''))));
});

test('tout texte saisi est échappé comme texte SVG et les couleurs injectées sont refusées', () => {
  const payload = `"><script>alert('x')</script><image href="https://evil.invalid/x"/> & Éléphant`;
  const svg = buildStudioSvg({brand:payload,title:payload,subtitle:payload});
  assert(!svg.includes('<script>')); assert(!svg.includes('<image')); assert(svg.includes('&lt;script&gt;')); assert(svg.includes('&amp;')); assert(!svg.includes('\x01'));
  assert.throws(()=>buildStudioSvg({primary:'red" onload="alert(1)'}),/couleur/);
  assert.throws(()=>buildStudioSvg({secondary:'url(https://evil.invalid/)'}),/couleur/);
  assert.throws(()=>buildStudioSvg({background:'#123'}),/couleur/);
  assert.throws(()=>buildStudioSvg({format:'90000x90000'}),/format/);
  assert.throws(()=>buildStudioSvg({preset:'__proto__'}),/format/);
  assert(!buildStudioSvg({title:'a\x01b'}).includes('\x01'));
});

test('les fichiers de mission doivent être des images relatives et chaque segment est encodé', () => {
  assert.equal(validateStudioFilePath('Livraison/Mon logo été.svg'),'Livraison/Mon logo été.svg');
  assert.equal(studioFileUrl('mission-123','Livraison/Mon logo été.svg'),'/api/missions/mission-123/files/Livraison/Mon%20logo%20%C3%A9t%C3%A9.svg');
  assert.equal(studioFileUrl('m','image%2Fpartie.png'),'/api/missions/m/files/image%252Fpartie.png');
  for (const file of ['../logo.svg','/logo.svg','a/../logo.png','a/.env.png','a//b.svg','a\\logo.png','https://evil.invalid/x.svg','javascript:logo.svg','logo.html','photo.gif','logo.svg\0','logo.svg?token=secret','C:logo.svg']) assert.throws(()=>validateStudioFilePath(file),/Choisissez/);
  for (const id of ['../mission','m/../m','m?x=1','']) assert.throws(()=>studioFileUrl(id,'logo.svg'),/mission/);
});

test('les déclarations SVG externes et les fichiers excessifs sont rejetés avant tout parseur', () => {
  for (const source of ['<!DOCTYPE svg SYSTEM "https://evil.invalid"><svg/>','<!ENTITY x SYSTEM "file:///etc/passwd"><svg/>','x'.repeat(2*1024*1024+1)]) assert.throws(()=>sanitizeStudioSvg(source),/externe|volumineux/);
  assert.throws(()=>sanitizeStudioSvg('<svg/>',{DOMParserImpl:null,XMLSerializerImpl:null}),/navigateur/);
});
