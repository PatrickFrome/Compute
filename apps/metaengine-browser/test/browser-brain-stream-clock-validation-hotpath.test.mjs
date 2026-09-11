import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainStreamClock } from '../src/browser-brain-stream-clock.mjs';

test('stream clock validation keeps source normalization and numeric sequence compatibility', () => {
  const clock = new BrowserBrainStreamClock();

  const baseline = clock.observe('  process-plane  ', '41');
  assert.equal(baseline.disposition, 'BASELINED');
  assert.equal(baseline.source.source, 'process-plane');
  assert.equal(baseline.source.sequence, 41);

  const applied = clock.observe('process-plane', 42);
  assert.equal(applied.disposition, 'APPLIED');
  assert.equal(applied.epoch, 2);
  assert.equal(applied.authority_effect, false);
});

test('split validation preserves fail-closed source and sequence errors', () => {
  const clock = new BrowserBrainStreamClock();

  assert.throws(
    () => clock.observe('bad source!', 1),
    { name: 'TypeError', message: 'browser_brain_stream_clock_source_invalid' },
  );
  assert.throws(
    () => clock.observe('semantic', -1),
    { name: 'TypeError', message: 'browser_brain_stream_clock_sequence_invalid' },
  );
  assert.throws(
    () => clock.baseline('', 1),
    { name: 'TypeError', message: 'browser_brain_stream_clock_source_invalid' },
  );
  assert.throws(
    () => clock.resync('semantic', Number.POSITIVE_INFINITY),
    { name: 'TypeError', message: 'browser_brain_stream_clock_sequence_invalid' },
  );

  assert.equal(clock.currentEpoch(), 0);
  assert.equal(clock.requiresResync(), false);
});

test('split validation preserves gap latch and canonical resync semantics', () => {
  const clock = new BrowserBrainStreamClock();

  clock.observe('semantic', 10);
  const gap = clock.observe('semantic', 13);
  assert.equal(gap.disposition, 'GAP');
  assert.equal(gap.source.resync_required, true);
  assert.equal(gap.source.resync_minimum_sequence, 13);
  assert.equal(clock.requiresResync(), true);

  const belowFloor = clock.resync('semantic', 12);
  assert.equal(belowFloor.disposition, 'RESYNC_BELOW_REQUIRED_FLOOR');
  assert.equal(clock.requiresResync(), true);

  const recovered = clock.resync('semantic', '13');
  assert.equal(recovered.disposition, 'RESYNCED');
  assert.equal(recovered.source.sequence, 13);
  assert.equal(clock.requiresResync(), false);
  assert.equal(clock.snapshot().gap_requires_resync, false);
  assert.equal(recovered.authority_effect, false);
});
