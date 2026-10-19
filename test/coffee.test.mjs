import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_OPTIONS, buildDonationUrl } from '../public/coffee-dialog.js';

test('les quatre soutiens conservent exactement les noms et montants demandés', () => {
  assert.deepEqual(SUPPORT_OPTIONS.map(({ label, amount }) => ({ label, amount })), [
    { label: 'Café', amount: '1.00' },
    { label: 'Sandwich', amount: '5.00' },
    { label: 'Snack', amount: '20.00' },
    { label: 'Resto', amount: '50.00' },
  ]);
  assert.ok(Object.isFrozen(SUPPORT_OPTIONS));
  assert.ok(SUPPORT_OPTIONS.every(Object.isFrozen));
});

test('chaque lien PayPal décrit le soutien choisi, son montant exact et son destinataire', () => {
  for (const option of SUPPORT_OPTIONS) {
    const url = new URL(buildDonationUrl({ option: option.id }));
    assert.equal(url.origin, 'https://www.paypal.com');
    assert.equal(url.pathname, '/cgi-bin/webscr');
    assert.equal(url.searchParams.get('cmd'), '_donations');
    assert.equal(url.searchParams.get('business'), 'renaud2005@gmail.com');
    assert.equal(url.searchParams.get('amount'), option.amount);
    assert.equal(url.searchParams.get('currency_code'), 'EUR');
    assert.equal(url.searchParams.get('item_name'), `${option.label} · soutien volontaire à Oscar et les Agents`);
    assert.equal(url.searchParams.get('no_shipping'), '1');
  }
});

test('le lien par défaut propose seulement le café à 1 euro', () => {
  const url = new URL(buildDonationUrl());
  assert.equal(url.searchParams.get('amount'), '1.00');
  assert.match(url.searchParams.get('item_name'), /^Café/);
});

test('les choix inconnus et destinataires invalides sont refusés', () => {
  for (const option of ['unknown', '', 50, { id: 'resto', amount: '500.00' }]) {
    assert.throws(() => buildDonationUrl({ option }), TypeError);
  }
  for (const recipient of ['', 'invalid', 'name@example.com\n', 'name @example.com']) {
    assert.throws(() => buildDonationUrl({ recipient }), TypeError);
  }
});
