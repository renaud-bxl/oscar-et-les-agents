import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { StateStream } from '../lib/state-stream.mjs';
import { createAtelierServer } from '../server.mjs';

class Response extends EventEmitter {
  writes = []; writableNeedDrain = false; destroyed = false; writableEnded = false;
  write(value) { this.writes.push(value); return !this.writableNeedDrain; }
  end() { this.writableEnded = true; this.emit('close'); }
  states() { return this.writes.filter(value => value.startsWith('event: state')).map(value => JSON.parse(value.split('\ndata: ')[1])); }
}
const until = async predicate => {
  const end = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > end) throw new Error('État du flux non atteint.'); await new Promise(resolve => setTimeout(resolve, 10)); }
};

test('un onglet lent retrouve le dernier état sans accumuler les étapes intermédiaires', () => {
  const stream = new StateStream(), slow = new Response(), fast = new Response();
  try {
    stream.add(slow, { status: 'planning' }); stream.add(fast, { status: 'planning' });
    slow.writableNeedDrain = true;
    for (let i = 0; i < 100; i++) { stream.publish({ status: 'running', i }); stream.flush(); }
    stream.publish({ status: 'completed', files: ['livraison.pdf'] }); stream.flush();
    assert.equal(slow.states().length, 1); assert.equal(fast.states().length, 102);
    slow.writableNeedDrain = false; slow.emit('drain');
    assert.deepEqual(slow.states(), [{ status: 'planning' }, { status: 'completed', files: ['livraison.pdf'] }]);
    slow.emit('drain'); assert.equal(slow.states().length, 2);
  } finally { stream.close(); }
});

test('les rafales se regroupent et fermer le dernier onglet libère les instantanés et écouteurs', async () => {
  let serializations = 0;
  const stream = new StateStream({ delay: 5, snapshot: state => { serializations++; return { ...state, version: 'test' }; } }), response = new Response();
  stream.add(response, { i: 0 });
  for (let i = 1; i <= 100; i++) stream.publish({ i });
  await until(() => response.states().length === 2);
  assert.equal(serializations, 2); assert.deepEqual(response.states().at(-1), { i: 100, version: 'test' });
  response.end(); assert.equal(stream.clients.size, 0); assert.equal(stream.latest, null); assert.equal(response.listenerCount('drain'), 0);
  stream.publish({ i: 101 }); assert.equal(stream.timer, null);
  const reopened = new Response(); stream.add(reopened, { i: 102 }); assert.equal(reopened.states()[0].i, 102);
  stream.close(); stream.close(); stream.publish({ i: 103 });
  assert.equal(reopened.writableEnded, true); assert.equal(stream.clients.size, 0); assert.equal(stream.timer, null);
});

test('le serveur borne la file SSE d’un vrai onglet suspendu et conserve sa dernière livraison', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'oscar-sse-backpressure-'));
  const app = await createAtelierServer({ port: 0, dataDir, providers: [] });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let output;
  app.server.on('request', (req, res) => { if (req.url === '/api/events') output = res; });
  const client = http.get(`http://127.0.0.1:${app.server.address().port}/api/events`);
  t.after(async () => { client.destroy(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const incoming = await new Promise((resolve, reject) => { client.once('response', response => { response.pause(); resolve(response); }); client.once('error', reject); });
  const state = app.engine.state(); state.activeMissions = Array.from({ length: 4 }, (_, i) => ({ id: `test-${i}`, status: 'running', tasks: Array.from({ length: 20 }, (_, j) => ({ id: `t${j}`, report: 'a'.repeat(10000) })) }));
  state.active = state.activeMissions[0];
  let peakBuffered = 0, blocked = false;
  for (let i = 0; i < 20; i++) {
    app.engine.emit('change', { ...state, testSequence: i });
    await new Promise(resolve => setTimeout(resolve, 90));
    peakBuffered = Math.max(peakBuffered, output.writableLength);
    blocked ||= output.writableNeedDrain;
  }
  app.engine.emit('change', { ...state, testSequence: 40, activeMissions: [], active: null, delivery: 'livraison.pdf' });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(blocked, true, 'Le scénario doit remplir le socket lent.');
  assert.ok(peakBuffered < 2 * 1024 * 1024, `File SSE excessive : ${peakBuffered}`);
  let bytes = '', latest;
  incoming.setEncoding('utf8'); incoming.on('data', chunk => {
    bytes += chunk;
    let boundary;
    while ((boundary = bytes.indexOf('\n\n')) >= 0) {
      const event = bytes.slice(0, boundary); bytes = bytes.slice(boundary + 2);
      if (event.startsWith('event: state\ndata: ')) latest = JSON.parse(event.slice('event: state\ndata: '.length));
    }
  }); incoming.resume();
  await until(() => latest?.testSequence === 40);
  assert.equal(latest.delivery, 'livraison.pdf'); assert.deepEqual(latest.activeMissions, []);
});
