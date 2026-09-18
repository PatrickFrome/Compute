import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainStreamClock } from '../src/browser-brain-stream-clock.mjs';

test('unchanged source state reuses one immutable row across duplicate observations and snapshots', () => {
  const clock = new BrowserBrainStreamClock();

  const baseline = clock.observe('semantic', 10);
  const duplicate = clock.observe('semantic', 10);
  const firstSnapshot = clock.snapshot();
  const secondSnapshot = clock.snapshot();

  assert.strictEqual(duplicate.source, baseline.source);
  assert.strictEqual(firstSnapshot.sources[0], baseline.source);
  assert.strictEqual(secondSnapshot, firstSnapshot);
  assert.strictEqual(secondSnapshot.sources[0], baseline.source);
  assert.equal(Object.isFrozen(baseline.source), true);
  assert.equal(duplicate.authority_effect, false);
});

test('causal mutation invalidates source row while repeated resync-required delivery reuses the latched row', () => {
  const clock = new BrowserBrainStreamClock();

  const baseline = clock.observe('process-plane', 20);
  const applied = clock.observe('process-plane', 21);
  assert.notStrictEqual(applied.source, baseline.source);
  assert.equal(applied.source.sequence, 21);

  const gap = clock.observe('process-plane', 24);
  assert.notStrictEqual(gap.source, applied.source);
  assert.equal(gap.source.resync_required, true);
  assert.equal(gap.source.resync_minimum_sequence, 24);

  const latched = clock.observe('process-plane', 25);
  assert.equal(latched.disposition, 'RESYNC_REQUIRED');
  assert.strictEqual(latched.source, gap.source);
  assert.strictEqual(clock.snapshot().sources[0], gap.source);
  assert.equal(latched.authority_effect, false);
});

test('canonical resync invalidates latched row and exposes recovered immutable state', () => {
  const clock = new BrowserBrainStreamClock();

  clock.observe('semantic', 7);
  const gap = clock.observe('semantic', 9);
  const belowFloor = clock.resync('semantic', 8);
  assert.strictEqual(belowFloor.source, gap.source);

  const recovered = clock.resync('semantic', 9);
  assert.notStrictEqual(recovered.source, gap.source);
  assert.equal(recovered.source.sequence, 9);
  assert.equal(recovered.source.resync_required, false);
  assert.strictEqual(clock.snapshot().sources[0], recovered.source);
  assert.equal(clock.requiresResync(), false);
  assert.equal(recovered.authority_effect, false);
});
