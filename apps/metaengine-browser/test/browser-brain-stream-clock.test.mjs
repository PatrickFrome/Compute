import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBrainStreamClock } from '../src/browser-brain-stream-clock.mjs';

test('merges independent realtime source sequences into one monotonic local epoch', () => {
  const clock = new BrowserBrainStreamClock();
  assert.equal(clock.observe('process', 1).epoch, 1);
  assert.equal(clock.observe('semantic:tab_a', 1).epoch, 2);
  assert.equal(clock.observe('cdp:tab_a', 1).epoch, 3);
  assert.equal(clock.observe('command-wake', 1).epoch, 4);
  const snapshot = clock.snapshot();
  assert.equal(snapshot.epoch, 4);
  assert.equal(snapshot.source_count, 4);
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.scheduler_authority, false);
});

test('duplicate delivery is idempotent and never advances the local epoch', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('process', 1);
  const duplicate = clock.observe('process', 1);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.disposition, 'DUPLICATE');
  assert.equal(duplicate.epoch, 1);
  assert.equal(clock.snapshot().epoch, 1);
});

test('sequence gap fails closed and requires canonical resync without synthetic replay', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('semantic:tab_a', 1);
  const gap = clock.observe('semantic:tab_a', 4);
  assert.equal(gap.accepted, false);
  assert.equal(gap.disposition, 'GAP');
  assert.equal(gap.source.sequence, 1);
  assert.equal(gap.source.gap_from, 2);
  assert.equal(gap.source.gap_to, 3);
  assert.equal(clock.snapshot().gap_requires_resync, true);

  const recovered = clock.resync('semantic:tab_a', 4);
  assert.equal(recovered.disposition, 'RESYNCED');
  assert.equal(recovered.source.sequence, 4);
  assert.equal(clock.snapshot().gap_requires_resync, false);
});

test('regression is rejected and cannot roll a source clock backward', () => {
  const clock = new BrowserBrainStreamClock();
  clock.observe('cdp:tab_a', 1);
  clock.observe('cdp:tab_a', 2);
  const result = clock.observe('cdp:tab_a', 1);
  assert.equal(result.accepted, false);
  assert.equal(result.disposition, 'REGRESSION');
  assert.equal(result.source.sequence, 2);
  assert.equal(clock.snapshot().epoch, 2);
});

test('source cardinality is bounded before accepting another stream', () => {
  const clock = new BrowserBrainStreamClock({ maxSources: 2 });
  clock.observe('process', 1);
  clock.observe('semantic', 1);
  assert.throws(() => clock.observe('cdp', 1), /source_capacity_exceeded/);
  assert.equal(clock.snapshot().source_count, 2);
});

test('clock exposes no timer, scheduler, lease, execution or retry authority', () => {
  const snapshot = new BrowserBrainStreamClock().snapshot();
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.execution_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.dedicated_timer, false);
  assert.equal(snapshot.authority_effect, false);
});
