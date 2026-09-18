
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import {
  createRsiDevosAdmissionEnvelopes,
  verifyRsiDevosAdmissionEnvelope,
  rsiDevosAdmissionAdapterTrustRootSnapshot,
} from '../src/rsi-devos-admission-adapter.mjs';

const SOURCE_SHA = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const TAB = 'tab_00000000-0000-4000-8000-000000000001';

function observation() {
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
  memory.rememberCommandOutcome({
    command_id: 'cmd-admission-test-1',
    action: 'TYPE',
    tab_id: TAB,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
    recorded_at: '2027-01-15T08:01:00.000Z',
  });
  return new RsiShadowObserver({
    source_sha: SOURCE_SHA,
    clock: () => 1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
}

function searchContext() {
  return createRsiSearchContext({
    context_id: 'rsi-context-admission-1',
    mutation_surface: 'BROWSER_RUNTIME',
    problem_class: 'AMBIGUITY_RECONCILIATION',
    budget_class: 'NORMAL',
    skeleton_available: false,
    trace_history_available: true,
    lineage_candidate_count: 2,
    failure_class: 'TRANSPORT_AMBIGUITY',
    novelty_pressure: 0.35,
    external_context_owner: true,
    authored_by_candidate: false,
  });
}

async function runtimeCycle(ledgerPath) {
  const runtime = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
  await runtime.start();
  const obs = observation();
  const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  return runtime.prepareAutonomousEpisodeCycle({
    observation: obs,
    opportunity_id: opportunity.opportunity_id,
    search_context: searchContext(),
    cycle_generation: 1,
    max_candidates: 4,
    proposal_budget_units: 100,
    exploration_fraction: 0.2,
  });
}

test('typed admission envelopes bind exact prepared requests without granting scheduler authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-admission-'));
  try {
    const cycle = await runtimeCycle(path.join(root, 'rsi.jsonl'));
    const envelopes = createRsiDevosAdmissionEnvelopes({
      runtime_cycle: cycle,
      workspace_id: WORKSPACE_ID,
    });
    assert.equal(envelopes.length, 2);
    for (const envelope of envelopes) {
      verifyRsiDevosAdmissionEnvelope(envelope);
      assert.equal(envelope.rpc_name, 'rsi_devos_admit_prepared_request_v1');
      assert.equal(envelope.workspace_id, WORKSPACE_ID);
      assert.equal(envelope.task_role, 'IMPLEMENTER');
      assert.equal(envelope.task_claim_class, 'MUTATING');
      assert.equal(envelope.existing_devos_scheduler_required, true);
      assert.equal(envelope.service_role_execution_required, true);
      assert.equal(envelope.runtime_control_admission_required, true);
      assert.equal(envelope.scheduler_authority, false);
      assert.equal(envelope.task_authority, false);
      assert.equal(envelope.direct_browser_effect_enabled, false);
      assert.equal(envelope.downstream_physical_effect_retry_allowed, false);
      assert.match(envelope.request_material_canonical_json, /^\{/);
      assert.match(envelope.task_spec_canonical_json, /^\{/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runtime preparation exposes admission envelopes but never invokes the service-role RPC', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-admission-'));
  try {
    const runtime = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtime.start();
    const obs = observation();
    const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
    const prepared = await runtime.prepareAutonomousDevosAdmissions({
      workspace_id: WORKSPACE_ID,
      observation: obs,
      opportunity_id: opportunity.opportunity_id,
      search_context: searchContext(),
      cycle_generation: 1,
      max_candidates: 4,
      proposal_budget_units: 100,
      exploration_fraction: 0.2,
    });
    assert.equal(prepared.envelope_count, 2);
    assert.equal(prepared.rpc_name, 'rsi_devos_admit_prepared_request_v1');
    assert.equal(prepared.rpc_invoked, false);
    assert.equal(prepared.scheduler_action_authorized, false);
    assert.equal(prepared.task_created, false);
    assert.equal(prepared.lease_created, false);
    assert.equal(prepared.execution_authority, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('admission envelope rejects workspace, request material and task-spec tampering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-admission-tamper-'));
  try {
    const cycle = await runtimeCycle(path.join(root, 'rsi.jsonl'));
    const [envelope] = createRsiDevosAdmissionEnvelopes({
      runtime_cycle: cycle,
      workspace_id: WORKSPACE_ID,
    });

    const wrongWorkspace = structuredClone(envelope);
    wrongWorkspace.workspace_id = '00000000-0000-4000-8000-000000000001';
    assert.throws(() => verifyRsiDevosAdmissionEnvelope(wrongWorkspace), /envelope_digest_mismatch/);

    const requestTamper = structuredClone(envelope);
    requestTamper.request.target_branch += '-tampered';
    assert.throws(() => verifyRsiDevosAdmissionEnvelope(requestTamper), /request_digest_mismatch|target_branch_mismatch/);

    const taskTamper = structuredClone(envelope);
    taskTamper.request.task_spec.constraints.push('unsafe_override');
    assert.throws(() => verifyRsiDevosAdmissionEnvelope(taskTamper), /task_spec_digest_mismatch/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SQL admission RPC is service-role only and delegates to the existing scheduler after runtime-control fencing', async () => {
  const migrationPath = fileURLToPath(new URL(
    '../../../supabase/migrations/20260918171500_rsi_devos_prepared_request_admission_v1.sql',
    import.meta.url,
  ));
  const sql = await fs.readFile(migrationPath, 'utf8');

  assert.match(sql, /security definer/i);
  assert.match(sql, /devos_fleet_runtime_control_h205f22/);
  assert.match(sql, /refill_enabled/);
  assert.match(sql, /supervisor_admission_enabled/);
  assert.match(sql, /public\.devos_fleet_enqueue_v1\s*\(/);
  assert.match(sql, /'IMPLEMENTER'/);
  assert.match(sql, /'rsi-browser:'\s*\|\|\s*v_request_digest/);
  assert.match(sql, /request_generation'\)::integer,0\) <> 1/);
  assert.match(sql, /repeat_after_ambiguous_result_allowed/);
  assert.match(sql, /grant execute on function public\.rsi_devos_admit_prepared_request_v1\(uuid,jsonb\) to service_role/i);
  assert.match(sql, /revoke all on function public\.rsi_devos_admit_prepared_request_v1\(uuid,jsonb\) from authenticated/i);
  assert.doesNotMatch(sql, /insert\s+into\s+destruktion_meta\.devos_fleet_task_h205f22/i);
});

test('admission trust root keeps workspace, role and claim class outside candidate control', () => {
  const root = rsiDevosAdmissionAdapterTrustRootSnapshot();
  assert.equal(root.existing_devos_scheduler_required, true);
  assert.equal(root.service_role_execution_required, true);
  assert.equal(root.runtime_control_admission_required, true);
  assert.equal(root.idempotency_key_bound_to_request_digest, true);
  assert.equal(root.candidate_can_choose_workspace, false);
  assert.equal(root.candidate_can_choose_role, false);
  assert.equal(root.candidate_can_choose_claim_class, false);
  assert.equal(root.candidate_can_bypass_runtime_control, false);
  assert.equal(root.direct_browser_effect_enabled, false);
  assert.equal(root.downstream_physical_effect_retry_allowed, false);
});
