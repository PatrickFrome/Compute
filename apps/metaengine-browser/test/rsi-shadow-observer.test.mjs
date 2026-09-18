import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';

const SOURCE_SHA = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const TAB = 'tab_00000000-0000-4000-8000-000000000001';

test('observer turns bounded Brain reliability evidence into zero-authority RSI opportunities', () => {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8, clock: () => 1_800_000_000_000 });
  memory.rememberBinding({
    valid: true,
    tab_id: TAB,
    binding_generation: 1,
    web_contents_id: 7,
    renderer_pid: 77,
    renderer_process_key: '77:1234',
    target_id: 'target-7',
    document_generation: 1,
    semantic_revision: 1,
  });

  for (let i = 1; i <= 70; i += 1) {
    memory.ingestEvent({
      seq: i,
      type: 'SEMANTIC_EVENT',
      tab_id: TAB,
      semantic_sequence: i,
      observed_at: new Date(1_800_000_000_000 + i).toISOString(),
    });
  }
  memory.rememberCommandOutcome({
    command_id: 'cmd-ambiguous-1',
    action: 'TYPE',
    tab_id: TAB,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
    recorded_at: '2027-01-15T08:01:00.000Z',
  });

  const observer = new RsiShadowObserver({ source_sha: SOURCE_SHA, clock: () => 1_800_000_001_000 });
  const observation = observer.observeBrainSnapshot(memory.snapshot());
  const signals = observation.opportunities.map((entry) => entry.signal);

  assert.equal(observation.source_sha, SOURCE_SHA);
  assert.equal(observation.ambiguous_command_count, 1);
  assert.equal(observation.dropped_events, 6);
  assert.ok(signals.includes('AMBIGUOUS_COMMAND_OUTCOMES'));
  assert.ok(signals.includes('CELL_RELIABILITY_PRESSURE'));
  assert.ok(signals.includes('BOUNDED_MEMORY_PRESSURE'));
  assert.equal(observation.execution_authority, false);
  assert.equal(observation.production_mutation_authority, false);
  assert.equal(observation.promotion_authority, false);
  assert.equal(observation.self_update_authority, false);
  assert.equal(observation.automatic_retry_allowed, false);
  assert.equal(observation.page_text_consumed, false);
  assert.equal(observation.command_payload_consumed, false);
  assert.match(observation.observation_digest, /^[0-9a-f]{64}$/);
  assert.ok(observation.opportunities.every((entry) => entry.authority_effect === false));
});

test('observer emits no improvement opportunity for a healthy ready cell without pressure signals', () => {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8 });
  memory.rememberBinding({
    valid: true,
    tab_id: TAB,
    binding_generation: 1,
    web_contents_id: 7,
    renderer_pid: 77,
    renderer_process_key: '77:1234',
    target_id: 'target-7',
  });
  const observer = new RsiShadowObserver({ source_sha: SOURCE_SHA });
  const observation = observer.observeBrainSnapshot(memory.snapshot());
  assert.deepEqual(observation.opportunities, []);
  assert.equal(observation.cell_state_counts.READY, 1);
});

test('observer rejects snapshots that claim execution authority or expose private raw state', () => {
  const memory = new BrowserBrainWorkingMemory();
  const snapshot = memory.snapshot();
  const observer = new RsiShadowObserver({ source_sha: SOURCE_SHA });

  assert.throws(() => observer.observeBrainSnapshot({ ...snapshot, execution_authority: true }), /rsi_observer_brain_snapshot_authority_invalid/);
  assert.throws(() => observer.observeBrainSnapshot({ ...snapshot, page_text_stored: true }), /rsi_observer_brain_snapshot_privacy_invalid/);
});

test('observer requires exact source identity rather than branch aliases', () => {
  assert.throws(() => new RsiShadowObserver({ source_sha: 'release/self-update-ambiguity-live-v2' }), /rsi_observer_exact_source_sha_required/);
});
