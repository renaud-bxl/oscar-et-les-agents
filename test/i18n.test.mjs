import test from 'node:test';
import assert from 'node:assert/strict';
import {LANGUAGES,translate,getLocale,setLocale,withLocaleInstruction} from '../public/i18n.js';
import catalogTranslations from '../public/translations-catalog.js';
import {MISSION_TEMPLATES} from '../public/mission-catalog.js';

test('all mission questionnaires have English and Dutch labels and choices',()=>{
  const visible=new Set();for(const template of MISSION_TEMPLATES){visible.add(template.title);visible.add(template.description);for(const question of template.questions){visible.add(question.label);if(question.placeholder)visible.add(question.placeholder);for(const value of question.options||[])visible.add(value);}}
  for(const text of visible)for(const locale of ['en','nl'])assert.ok(catalogTranslations[text]?.[locale],`${locale}: ${text}`);
});
test('translation preserves whitespace, personal names and dynamic numeric values',()=>{
  assert.equal(translate('  Mes missions  ','en'),'  My missions  ');
  assert.equal(translate('Renaud','nl'),'Renaud');
  assert.match(translate('3 / 4 missions en cours','en'),/3 \/ 4/);
  assert.notEqual(translate('Question 3 sur 7','nl'),'Question 3 sur 7');
});
test('future model work receives the selected language and the request limit is enforced',()=>{
  for(const locale of Object.keys(LANGUAGES)){setLocale(locale);assert.equal(getLocale(),locale);assert.match(withLocaleInstruction('Un projet.'),/Langue demandée/);}
  setLocale('en');assert.match(withLocaleInstruction('Un projet.'),/English/);assert.throws(()=>withLocaleInstruction('x'.repeat(15999)),/16/);setLocale('fr');assert.throws(()=>setLocale('invalid'),/Langue/);
});
