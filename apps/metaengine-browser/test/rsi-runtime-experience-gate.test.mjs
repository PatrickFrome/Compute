import assert from 'node:assert/strict';
import test from 'node:test';

import { RsiRuntimeExperienceGate } from '../src/rsi-runtime-experience-gate.mjs';

const SOURCE = 'a'.repeat(40);

function observation({
  digest = 'b'.repeat(64),
  sequence = 1,
  processRevision = 1,
  state = 'READY',
  ambiguous = 0,
  dropped = 0,
  opportunities = [],
  authority_effect = false,
} = {}) {
  return {
    schema: 'metaengine.rsi.shadow-observation.v1',
    source_sha: SOURCE,
    observation_digest: digest,
    observed_at: '2026-09-18T16:00:00.000Z',
    brain_snapshot_schema: 'metaengine.browser-brain.working-memory.v1',
    brain_process_revision: processRevision,
    brain_cognitive_sequence: sequence,
    cell_count: 1,
    cell_state_counts: {
      UNKNOWN: 0,
      READY: state === 'READY' ? 1 : 0,
      WORKING: state === 'WORKING' ? 1 : 0,
      NEEDS_ATTENTION: 0,
      DEGRADED: 0,
      GONE: 0,
    },
    ambiguous_command_count: ambiguous,
    dropped_events: dropped,
    opportunities,
    raw_dom_consumed: false,
    raw_network_consumed: false,
    page_text_consumed: false,
    input_values_consumed: false,
    command_payload_consumed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect,
  };
}

test('experience gate deduplicates semantic no-change even when cognitive sequence advances', () => {
  let now = 1_000;
  const gate = new RsiRuntimeExperienceGate({
    source_sha: SOURCE,
    clock: () => now,
    min_persist_interval_ms: 1_000,
  });

  const first = gate.offer(observation({ digest: 'b'.repeat(64), sequence: 1 }));
  assert.equal(first.action, 'PERSIST');
  assert.equal(first.reason, 'FIRST_OBSERVATION');
  gate.commitPersist(first);

  now = 1_100;
  const duplicate = gate.offer(observation({ digest: 'c'.repeat(64), sequence: 2 }));
  assert.equal(duplicate.action, 'DEDUPLICATE');
  assert.equal(duplicate.reason, 'UNCHANGED_FROM_PERSISTED');

  const snapshot = gate.snapshot();
  assert.equal(snapshot.persisted_count, 1);
  assert.equal(snapshot.deduplicated_count, 1);
  assert.equal(snapshot.pending, false);
});

test('experience gate coalesces noncritical changes and flushes the latest observation', () => {
  let now = 2_000;
  const gate = new RsiRuntimeExperienceGate({
    source_sha: SOURCE,
    clock: () => now,
    min_persist_interval_ms: 1_000,
  });

  const first = gate.offer(observation({ digest: 'd'.repeat(64), state: 'READY' }));
  gate.commitPersist(first);

  now = 2_100;
  const changed = gate.offer(observation({ digest: 'e'.repeat(64), sequence: 2, state: 'WORKING' }));
  assert.equal(changed.action, 'COALESCE');
  assert.equal(changed.reason, 'BOUNDED_COALESCE');
  assert.equal(gate.snapshot().pending, true);

  const flush = gate.flush();
  assert.equal(flush.action, 'PERSIST');
  assert.equal(flush.reason, 'FLUSH_PENDING');
  assert.equal(flush.observation.observation_digest, 'e'.repeat(64));
  gate.commitPersist(flush);

  const snapshot = gate.snapshot();
  assert.equal(snapshot.persisted_count, 2);
  assert.equal(snapshot.coalesced_count, 1);
  assert.equal(snapshot.pending, false);
});

test('critical ambiguity and P0 pressure bypass coalescing without gaining authority', () => {
  let now = 3_000;
  const gate = new RsiRuntimeExperienceGate({
    source_sha: SOURCE,
    clock: () => now,
    min_persist_interval_ms: 10_000,
  });

  const first = gate.offer(observation({ digest: 'f'.repeat(64) }));
  gate.commitPersist(first);

  now = 3_050;
  const critical = gate.offer(observation({
    digest: '1'.repeat(64),
    sequence: 2,
    ambiguous: 1,
    opportunities: [{
      opportunity_id: 'opp:critical',
      signal: 'AMBIGUOUS_COMMAND_OUTCOMES',
      mutation_surface: 'BROWSER_RUNTIME',
      priority: 'P0',
      evidence: { ambiguous_command_count: 1 },
    }],
  }));
  assert.equal(critical.action, 'PERSIST');
  assert.equal(critical.reason, 'CRITICAL_CHANGE');
  assert.equal(critical.critical, true);
  assert.equal(critical.authority_effect, false);
  assert.equal(critical.automatic_retry_allowed, false);
});

test('experience gate rejects authority-bearing observations', () => {
  const gate = new RsiRuntimeExperienceGate({ source_sha: SOURCE });
  assert.throws(
    () => gate.offer(observation({ authority_effect: true })),
    /authority_effect_invalid/,
  );
});
