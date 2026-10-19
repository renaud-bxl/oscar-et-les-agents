import test from 'node:test';
import assert from 'node:assert/strict';
import {withTeamPreference} from '../public/welcome-guide.js';

test('automatic team leaves the brief unchanged',()=>assert.equal(withTeamPreference('  Mon projet.  '),'Mon projet.'));
test('requested team adds real task limits without changing the original idea',()=>{
  const brief=withTeamPreference('Un jeu de puzzle.','15');
  assert.ok(brief.startsWith('Un jeu de puzzle.\n\n'));
  assert.match(brief,/recrute 15 spécialistes distincts/);
  assert.match(brief,/quatre agents par métier/);
  assert.match(brief,/Quatre|quatre spécialistes travaillent simultanément/);
});
test('invalid sizes and oversized enriched briefs fail before submission',()=>{
  assert.throws(()=>withTeamPreference('Une idée','30'),/effectif/);
  assert.throws(()=>withTeamPreference('x'.repeat(15900),'20'),/16 000/);
  assert.equal(withTeamPreference('x'.repeat(16000)).length,16000);
});
