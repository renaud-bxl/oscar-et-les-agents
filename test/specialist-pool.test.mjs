import test from 'node:test';
import assert from 'node:assert/strict';
import { SpecialistPool } from '../lib/specialist-pool.mjs';

test('nine independent colleagues can start together without waiting for a slow researcher', async () => {
  const pool = new SpecialistPool();
  const seats = await Promise.all(Array.from({ length: 9 }, () => pool.acquire()));
  assert.equal(pool.active, 9);
  assert.equal(pool.pending, 0);
  seats.forEach(release => release());
  assert.equal(pool.active, 0);
});

test('several missions share twenty seats, with waiting work admitted in arrival order', async () => {
  const pool = new SpecialistPool();
  const missionOne = await Promise.all(Array.from({ length: 12 }, () => pool.acquire()));
  const missionTwo = await Promise.all(Array.from({ length: 8 }, () => pool.acquire()));
  const started = [];
  const third = pool.acquire().then(release => { started.push('third'); return release; });
  const fourth = pool.acquire().then(release => { started.push('fourth'); return release; });
  assert.equal(pool.active, 20);
  assert.equal(pool.pending, 2);
  missionOne[0]();
  const thirdRelease = await third;
  assert.deepEqual(started, ['third']);
  assert.equal(pool.active, 20);
  assert.equal(pool.pending, 1);
  thirdRelease();
  const fourthRelease = await fourth;
  assert.deepEqual(started, ['third', 'fourth']);
  fourthRelease();
  missionOne.forEach(release => release());
  missionTwo.forEach(release => release());
  assert.equal(pool.active, 0);
});

test('cancelling a waiting mission does not start it or interrupt another mission', async () => {
  const pool = new SpecialistPool({ limit: 1 });
  const release = await pool.acquire();
  const cancelled = new AbortController();
  const rejected = assert.rejects(pool.acquire(cancelled.signal), { name: 'AbortError' });
  const next = pool.acquire();
  cancelled.abort();
  await rejected;
  assert.equal(pool.active, 1);
  assert.equal(pool.pending, 1);
  release();
  release();
  const nextRelease = await next;
  assert.equal(pool.active, 1);
  nextRelease();
  assert.equal(pool.active, 0);
});

test('a running operation keeps its seat until it really ends after cancellation', async () => {
  const pool = new SpecialistPool({ limit: 1 });
  const running = new AbortController();
  const release = await pool.acquire(running.signal);
  const next = pool.acquire();
  running.abort();
  assert.equal(pool.active, 1);
  assert.equal(pool.pending, 1);
  release();
  const nextRelease = await next;
  nextRelease();
  await assert.rejects(pool.acquire(running.signal), { name: 'AbortError' });
  assert.equal(pool.active, 0);
});
