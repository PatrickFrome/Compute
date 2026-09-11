import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainStreamClock } from '../src/browser-brain-stream-clock.mjs';

test('snapshot keeps deterministic lexical source order across unsorted arrival and hot-path updates', () => {
  const clock = new BrowserBrainStreamClock({ maxSources: 64 });
  const arrival = ['semantic:z', 'process:renderer', 'semantic:a', 'process:browser', 'browsercell:09', 'browsercell:01'];

  for (let index = 0; index < arrival.length; index += 1) {
    clock.observe(arrival[index], index + 10);
  }

  const expected = [...arrival].sort((a, b) => a.localeCompare(b));
  const first = clock.snapshot();
  assert.deepEqual(first.sources.map((row) => row.source), expected);

  const renderer = clock.observe('process:renderer', 11);
  assert.equal(renderer.disposition, 'APPLIED');
  const second = clock.snapshot();
  assert.deepEqual(second.sources.map((row) => row.source), expected);
  assert.equal(second.sources.find((row) => row.source === 'process:renderer').sequence, 11);
  assert.equal(second.authority_effect, false);
});

test('late source insertion preserves canonical order without disturbing existing source rows', () => {
  const clock = new BrowserBrainStreamClock();

  clock.observe('semantic:m', 1);
  clock.observe('semantic:z', 1);
  const before = clock.snapshot();
  const mRow = before.sources.find((row) => row.source === 'semantic:m');
  const zRow = before.sources.find((row) => row.source === 'semantic:z');

  clock.observe('semantic:a', 1);
  clock.observe('semantic:t', 1);
  const after = clock.snapshot();

  assert.deepEqual(after.sources.map((row) => row.source), ['semantic:a', 'semantic:m', 'semantic:t', 'semantic:z']);
  assert.strictEqual(after.sources.find((row) => row.source === 'semantic:m'), mRow);
  assert.strictEqual(after.sources.find((row) => row.source === 'semantic:z'), zRow);
  assert.equal(Object.isFrozen(after.sources), true);
  assert.equal(after.authority_effect, false);
});

test('full bounded source set remains deterministically ordered after repeated mutations', () => {
  const clock = new BrowserBrainStreamClock({ maxSources: 64 });
  const names = Array.from({ length: 64 }, (_, index) => `stream:${String(63 - index).padStart(2, '0')}`);

  for (const name of names) clock.observe(name, 100);
  const expected = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(clock.snapshot().sources.map((row) => row.source), expected);

  for (const name of expected) {
    const result = clock.observe(name, 101);
    assert.equal(result.disposition, 'APPLIED');
  }

  const snapshot = clock.snapshot();
  assert.deepEqual(snapshot.sources.map((row) => row.source), expected);
  assert.equal(snapshot.sources.every((row) => row.sequence === 101), true);
  assert.equal(snapshot.source_count, 64);
  assert.equal(snapshot.gap_requires_resync, false);
});
