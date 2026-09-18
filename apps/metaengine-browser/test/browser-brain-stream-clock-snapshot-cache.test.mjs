import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserBrainStreamClock } from '../src/browser-brain-stream-clock.mjs';

test('reuses one immutable snapshot while causal clock state is unchanged', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('process', 1);
  clock.observe('semantic', 1);

  const first = clock.snapshot();
  const second = clock.snapshot();
  const third = clock.snapshot();

  assert.equal(second, first);
  assert.equal(third, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.sources), true);
  assert.equal(first.epoch, 2);
  assert.equal(first.source_count, 2);
});

test('idempotent delivery keeps cached projection while applied delivery invalidates it', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('process', 1);
  const before = clock.snapshot();

  const duplicate = clock.observe('process', 1);
  assert.equal(duplicate.disposition, 'DUPLICATE');
  assert.equal(clock.snapshot(), before);

  const applied = clock.observe('process', 2);
  assert.equal(applied.disposition, 'APPLIED');
  const after = clock.snapshot();
  assert.notEqual(after, before);
  assert.equal(after.epoch, 2);
  assert.equal(after.sources[0].sequence, 2);
  assert.equal(clock.snapshot(), after);
});

test('gap invalidates cached projection even when monotonic epoch does not advance', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('semantic', 1);
  const before = clock.snapshot();

  const gap = clock.observe('semantic', 4);
  assert.equal(gap.disposition, 'GAP');
  assert.equal(gap.epoch, before.epoch);

  const latched = clock.snapshot();
  assert.notEqual(latched, before);
  assert.equal(latched.epoch, before.epoch);
  assert.equal(latched.gap_requires_resync, true);
  assert.equal(latched.resync_required_source_count, 1);
  assert.equal(latched.sources[0].resync_required, true);

  const ordinary = clock.observe('semantic', 2);
  assert.equal(ordinary.disposition, 'RESYNC_REQUIRED');
  assert.equal(clock.snapshot(), latched);
});

test('canonical resync invalidates the latched snapshot and preserves fail-closed floor', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('cdp', 10);
  clock.observe('cdp', 8);
  const latched = clock.snapshot();

  const belowFloor = clock.resync('cdp', 9);
  assert.equal(belowFloor.disposition, 'RESYNC_BELOW_REQUIRED_FLOOR');
  assert.equal(clock.snapshot(), latched);

  const recovered = clock.resync('cdp', 10);
  assert.equal(recovered.disposition, 'RESYNCED');
  const after = clock.snapshot();
  assert.notEqual(after, latched);
  assert.equal(after.gap_requires_resync, false);
  assert.equal(after.resync_required_source_count, 0);
  assert.equal(after.authority_effect, false);
  assert.equal(after.scheduler_authority, false);
  assert.equal(after.execution_authority, false);
});
