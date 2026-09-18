import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildDevosRuntimeObservability,
  mergeDevosRuntimeObservability,
} from '../src/devos-runtime-observability.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('DevOS runtime observability keeps bounded task-cycle and last-failure evidence', () => {
  const runtime = buildDevosRuntimeObservability({
    identity: { device_id: 'device-1' },
    devos_scheduler_source: 'NATIVE_SUPERVISOR_IDLE_FAST_LANE',
    devos_execution_mode: 'BOUNDED_RUN_ONCE',
    devos_last_error: null,
    devos_last_failure: {
      at: '2026-09-18T21:20:00.000Z',
      reason: 'devos_foreground_selection_unproven',
      task_cycle: {
        state: 'OK',
        backlog: { ready: 3, running: 2, by_role: { PLANNER: 1, IMPLEMENTER: 2 } },
        dispatch: {
          state: 'PRE_EFFECT_REQUEUED',
          task_id: 'task-1',
          lease_generation: 7,
          tab_id: 'tab-1',
          target_id: 'webcontents:3',
          retry_via_scheduler: true,
          prompt_sha256: 'do-not-export',
          proof: { secret: 'do-not-export' },
          authority_effect: false,
        },
        pre_effect_reconciliation: {
          state: 'PRE_EFFECT_REQUEUED',
          task_id: 'task-1',
          lease_generation: 7,
          original_error: 'composer_not_ready',
          retry_via_scheduler: true,
          physical_effect_attempted: false,
        },
        attempted_lease_count: 9,
        elastic_idle_cycles: 2,
        durable_effect_delivery_journal: true,
        write_ahead_effect_barrier: 'WRITE_AHEAD_V1',
      },
    },
    idle_background_work: {
      in_flight: false,
      last_at: '2026-09-18T21:20:01.000Z',
      last_error: 'native_supervisor_idle_maintenance_wait_timeout',
      command_lease_precedes_idle_work: true,
      read_only_can_overlap: true,
    },
    control_fast_lane: {
      transport: 'SUPPORTED',
      last_batch_count: 0,
      last_wait_batch_wake_reason: 'DB_POLL_TIMEOUT_FALLBACK',
      last_wait_batch_elapsed_ms: 5700,
      last_wait_batch_response_at: '2026-09-18T21:20:02.000Z',
      maintenance_in_flight: false,
    },
    continuous_service: {
      actuation_allowed: true,
      runtime_control: {
        state: 'OPEN',
        generation_floor: 28,
        authoritative: true,
        supervisor_admission_enabled: true,
      },
    },
    devos_task_cycle: {
      state: 'OK',
      backlog: { ready: 1, running: 6, by_role: { FALSIFIER: 1 } },
      dispatch: {
        state: 'NO_REDISPATCH',
        task_id: 'task-2',
        lease_generation: 1,
        prompt_sha256: 'also-do-not-export',
      },
      ambiguity_recovery: {
        state: 'NO_REDISPATCH_AMBIGUOUS',
        task_id: 'task-3',
        lease_generation: 2,
        reason: 'effect_unknown',
      },
      attempted_lease_count: 12,
      running_observation_fanout_per_cycle: 4,
      durable_effect_delivery_journal: true,
      fleet_transport_promotion: { state: 'NO_ELIGIBLE_CONVERSATION' },
    },
  });

  assert.equal(runtime.schema, 'metaengine.devos.runtime-observability.v1');
  assert.equal(runtime.task_cycle.state, 'OK');
  assert.equal(runtime.task_cycle.backlog.ready, 1);
  assert.equal(runtime.task_cycle.backlog.running, 6);
  assert.equal(runtime.task_cycle.dispatch.state, 'NO_REDISPATCH');
  assert.equal(runtime.task_cycle.dispatch.task_id, 'task-2');
  assert.equal(runtime.task_cycle.ambiguity_recovery.state, 'NO_REDISPATCH_AMBIGUOUS');
  assert.equal(runtime.last_failure.reason, 'devos_foreground_selection_unproven');
  assert.equal(runtime.last_failure.task_cycle.pre_effect_reconciliation.state, 'PRE_EFFECT_REQUEUED');
  assert.equal(runtime.last_failure.task_cycle.pre_effect_reconciliation.retry_via_scheduler, true);
  assert.equal(runtime.last_failure.task_cycle.pre_effect_reconciliation.physical_effect_attempted, false);
  assert.equal(runtime.automatic_retry_allowed, false);
  assert.equal(runtime.authority_effect, false);

  const wire = JSON.stringify(runtime);
  assert.doesNotMatch(wire, /do-not-export/);
  assert.doesNotMatch(wire, /prompt_sha256/);
  assert.doesNotMatch(wire, /"proof"\s*:/);
  assert.doesNotMatch(wire, /"positive_effect_proof"\s*:/);
  assert.equal(runtime.task_cycle.raw_effect_proof_exposed, false);
  assert.equal(runtime.last_failure.task_cycle.raw_effect_proof_exposed, false);
  assert.doesNotMatch(wire, /task_spec/);
});

test('DevOS runtime projection bounds role counts and failure text', () => {
  const byRole = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`ROLE_${String(index).padStart(2, '0')}`, index]));
  const runtime = buildDevosRuntimeObservability({
    devos_last_failure: {
      at: 'x'.repeat(100),
      reason: 'r'.repeat(500),
      task_cycle: {
        state: 'S'.repeat(200),
        backlog: { ready: 1, running: 2, by_role: byRole },
      },
    },
  });
  assert.equal(runtime.last_failure.at.length, 64);
  assert.equal(runtime.last_failure.reason.length, 240);
  assert.equal(runtime.last_failure.task_cycle.state.length, 72);
  assert.equal(Object.keys(runtime.last_failure.task_cycle.backlog.by_role).length, 16);
});

test('DevOS runtime projection merges into lifecycle without becoming authority', () => {
  const runtime = buildDevosRuntimeObservability({ devos_task_cycle: { state: 'IDLE' } });
  const merged = mergeDevosRuntimeObservability({
    schema: 'metaengine.supervisor-lifecycle-runtime.v4',
    keepalive: { cycle_seq: 500 },
    authority_effect: false,
  }, runtime);
  assert.equal(merged.keepalive.cycle_seq, 500);
  assert.equal(merged.devos_runtime.task_cycle.state, 'IDLE');
  assert.equal(merged.devos_runtime.authority_effect, false);
});

test('native client persists the last DevOS failure independently from transient last_error', async () => {
  const source = await fs.readFile(path.join(here, '../src/native-supervisor-client-core-base.mjs'), 'utf8');
  assert.match(source, /#lastDevosFailure = null;/);
  assert.match(source, /this\.#lastDevosFailure = Object\.freeze\(\{/);
  assert.match(source, /task_cycle: this\.#devosTaskCycle\?\.snapshot\?\.\(\) \|\| null/);
  assert.match(source, /devos_last_failure: this\.#lastDevosFailure \? structuredClone/);
  assert.match(source, /automatic_retry_allowed: false/);
});
