import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBrainStreamClock } from '../src/browser-brain-stream-clock.mjs';

test('ordered state vector preserves canonical order and unaffected row identity across hot updates', () => {
  const clock = new BrowserBrainStreamClock({ maxSources: 64 });
  const names = Array.from({ length: 64 }, (_, index) => `stream:${String(63 - index).padStart(2, '0')}`);
  for (const source of names) clock.observe(source, 1);

  const first = clock.snapshot();
  const expected = [...names].sort();
  assert.deepEqual(first.sources.map((row) => row.source), expected);

  const stableSource = 'stream:17';
  const hotSource = 'stream:31';
  const stableBefore = first.sources.find((row) => row.source === stableSource);
  const hotBefore = first.sources.find((row) => row.source === hotSource);

  const applied = clock.observe(hotSource, 2);
  assert.equal(applied.disposition, 'APPLIED');
  assert.equal(applied.authority_effect, false);

  const second = clock.snapshot();
  assert.deepEqual(second.sources.map((row) => row.source), expected);
  assert.strictEqual(second.sources.find((row) => row.source === stableSource), stableBefore);
  assert.notStrictEqual(second.sources.find((row) => row.source === hotSource), hotBefore);
  assert.equal(second.sources.find((row) => row.source === hotSource).sequence, 2);
  assert.equal(second.gap_requires_resync, false);
  assert.equal(second.authority_effect, false);
});

test('late admission inserts one state into canonical position without perturbing existing cached rows', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('stream:a', 1);
  clock.observe('stream:c', 1);
  const before = clock.snapshot();
  const a = before.sources[0];
  const c = before.sources[1];

  const admitted = clock.observe('stream:b', 7);
  assert.equal(admitted.disposition, 'BASELINED');

  const after = clock.snapshot();
  assert.deepEqual(after.sources.map((row) => row.source), ['stream:a', 'stream:b', 'stream:c']);
  assert.strictEqual(after.sources[0], a);
  assert.strictEqual(after.sources[2], c);
  assert.equal(after.sources[1].sequence, 7);
  assert.equal(after.execution_authority, false);
  assert.equal(after.scheduler_authority, false);
});
