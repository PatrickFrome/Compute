import assert from 'node:assert/strict';
import test from 'node:test';

import { RsiRuntimeImprovementFrontier } from '../src/rsi-runtime-improvement-frontier.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';

const SOURCE = 'a'.repeat(40);

function brain({ status = 'READY', commandStatus = 'COMPLETED', effectOutcome = 'CONFIRMED', dropped = 0 } = {}) {
  return {
    schema: BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
    global: { process_revision: 2, cognitive_sequence: 3, dropped_events: dropped },
    cells: [{
      tab_id: 'tab_00000000-0000-4000-8000-000000000123',
      status,
      binding: null,
      last_event: null,
      last_command: { status: commandStatus, effect_outcome: effectOutcome },
      last_semantic_sequence: null,
      last_observed_at: '2026-09-18T16:00:00.000Z',
      attention_reason: null,
      execution_authority: false,
      authority_effect: false,
    }],
    raw_dom_stored: false,
    raw_network_stored: false,
    page_text_stored: false,
    input_values_stored: false,
    command_payload_stored: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  };
}

test('frontier converts a verified live opportunity into a precommitted hypothesis and DevOS experiment plan', () => {
  const observer = new RsiShadowObserver({ source_sha: SOURCE, clock: () => Date.parse('2026-09-18T16:00:00Z') });
  const observation = observer.observeBrainSnapshot(brain({ commandStatus: 'AMBIGUOUS', effectOutcome: 'AMBIGUOUS' }));
  const frontier = new RsiRuntimeImprovementFrontier();

  const prepared = frontier.prepare(observation);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].signal, 'AMBIGUOUS_COMMAND_OUTCOMES');
  assert.equal(prepared[0].hypothesis.requires_existing_devos_scheduler, true);
  assert.equal(prepared[0].hypothesis.requires_independent_evaluator, true);
  assert.equal(prepared[0].plan.lease_created, false);
  assert.equal(prepared[0].plan.command_created, false);
  assert.equal(prepared[0].plan.execution_authority, false);
  assert.equal(prepared[0].plan.promotion_authority, false);
  assert.equal(prepared[0].plan.self_update_authority, false);

  frontier.commit(prepared);
  const snapshot = frontier.snapshot();
  assert.equal(snapshot.active_count, 1);
  assert.equal(snapshot.existing_devos_scheduler_required, true);
  assert.equal(snapshot.direct_execution_enabled, false);
  assert.equal(snapshot.authority_effect, false);
});

test('frontier is deterministic and does not duplicate an already committed experiment plan', () => {
  const observer = new RsiShadowObserver({ source_sha: SOURCE, clock: () => Date.parse('2026-09-18T16:00:00Z') });
  const observation = observer.observeBrainSnapshot(brain({ status: 'GONE' }));
  const frontier = new RsiRuntimeImprovementFrontier();

  const first = frontier.prepare(observation);
  frontier.commit(first);
  const second = frontier.prepare(observation);

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(frontier.snapshot().active_count, 1);
  assert.equal(frontier.snapshot().duplicate_count, 1);
});

test('frontier does nothing for a healthy observation', () => {
  const observer = new RsiShadowObserver({ source_sha: SOURCE });
  const observation = observer.observeBrainSnapshot(brain());
  const frontier = new RsiRuntimeImprovementFrontier();
  assert.deepEqual(frontier.prepare(observation), []);
  assert.equal(frontier.snapshot().active_count, 0);
});
