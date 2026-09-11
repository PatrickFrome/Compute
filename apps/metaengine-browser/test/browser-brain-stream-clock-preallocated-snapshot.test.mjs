import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBrainStreamClock } from '../src/browser-brain-stream-clock.mjs';

test('preallocated snapshot projection preserves exact width, canonical order, and frozen rows', () => {
  const clock = new BrowserBrainStreamClock({ maxSources: 64 });
  const empty = clock.snapshot();
  assert.equal(empty.source_count, 0);
  assert.deepEqual(empty.sources, []);
  assert.equal(Object.isFrozen(empty.sources), true);

  const names = Array.from({ length: 64 }, (_, index) => `stream:${String(63 - index).padStart(2, '0')}`);
  for (const source of names) clock.observe(source, 1);

  const snapshot = clock.snapshot();
  assert.equal(snapshot.source_count, 64);
  assert.equal(snapshot.sources.length, 64);
  assert.deepEqual(snapshot.sources.map((row) => row.source), [...names].sort());
  assert.equal(snapshot.sources.every((row) => Object.isFrozen(row)), true);
  assert.equal(Object.isFrozen(snapshot.sources), true);
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.execution_authority, false);
});

test('snapshot rebuild after one causal mutation preserves unaffected row identity and exact indexes', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('stream:a', 1);
  clock.observe('stream:b', 1);
  clock.observe('stream:c', 1);

  const before = clock.snapshot();
  const a = before.sources[0];
  const b = before.sources[1];
  const c = before.sources[2];

  const applied = clock.observe('stream:b', 2);
  assert.equal(applied.disposition, 'APPLIED');

  const after = clock.snapshot();
  assert.equal(after.source_count, 3);
  assert.strictEqual(after.sources[0], a);
  assert.notStrictEqual(after.sources[1], b);
  assert.strictEqual(after.sources[2], c);
  assert.equal(after.sources[1].source, 'stream:b');
  assert.equal(after.sources[1].sequence, 2);
  assert.equal(after.epoch, before.epoch + 1);
});

test('gap rebuild projects the latched row without changing vector width or ordering', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('stream:a', 5);
  clock.observe('stream:b', 5);

  const gap = clock.observe('stream:a', 8);
  assert.equal(gap.disposition, 'GAP');

  const snapshot = clock.snapshot();
  assert.equal(snapshot.source_count, 2);
  assert.deepEqual(snapshot.sources.map((row) => row.source), ['stream:a', 'stream:b']);
  assert.equal(snapshot.sources[0].sequence, 5);
  assert.equal(snapshot.sources[0].resync_required, true);
  assert.equal(snapshot.sources[0].gap_from, 6);
  assert.equal(snapshot.sources[0].gap_to, 7);
  assert.equal(snapshot.gap_requires_resync, true);
  assert.equal(snapshot.resync_required_source_count, 1);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.authority_effect, false);
});
