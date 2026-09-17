import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';
import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import {
  prepareRsiTargetedCandidateBuild,
  verifyRsiTargetedCandidateBuild,
} from '../src/rsi-targeted-candidate-builder.mjs';
import {
  buildRsiMutationContract,
  verifyRsiMutationContract,
} from '../src/supervisor-rsi-mutation-contract.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';

const SOURCE_SHA = '46b7b838439120f796e932a4f71edcc3915228d8';
const TARGET = 'apps/metaengine-browser/src/result-delivery-transport.mjs';

function l1() {
  const observer = new RsiCommandPlaneLivenessObserver({ source_sha: SOURCE_SHA, clock: () => Date.parse('2026-09-17T10:41:40.000Z'), heartbeat_fresh_ms: 15_000, perception_fresh_ms: 15_000, command_stall_ms: 120_000 });
  const observation = observer.observe({
    schema: RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at: '2026-09-17T10:41:40.000Z',
    heartbeat_at: '2026-09-17T10:41:35.000Z',
    perception_at: '2026-09-17T10:41:36.000Z',
    command_progress_at: '2026-09-17T05:09:49.879Z',
    pending_command_count: 5,
    active_command: { command_id: 'd5d24937-c7e6-4ce1-bf93-134495b1d039', action: 'SCROLL', command_lane: 'TAB_MUTATION', status: 'LEASED', leased_at: '2026-09-17T05:09:48.211Z', effect_bound_at: '2026-09-17T05:09:49.879Z', receipt_recorded_at: null },
    command_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    raw_network_exposed: false,
    execution_authority: false,
    production_mutation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
  const opportunity = observation.opportunities.find((entry) => entry.signal === 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  assert.ok(opportunity);
  const hypothesis = buildRsiExperimentHypothesis({ observation, opportunity_id: opportunity.opportunity_id });
  const plan = buildRsiDevosExperimentPlan({ observation, opportunity_id: opportunity.opportunity_id, hypothesis });
  const contract = buildRsiMutationContract({ hypothesis });
  const snapshot = {
    schema: 'metaengine.devos.packaged-source-snapshot.v1',
    repository: 'PatrickFrome/Compute',
    head: SOURCE_SHA,
    ref: SOURCE_SHA,
    bounded: true,
    arbitrary_path_copy: false,
    process_spawn_used: false,
    authority_effect: false,
    source_files: ['apps/metaengine-browser/src/native-supervisor-client-base.mjs'],
    source_file_count: 1,
  };
  return { hypothesis, plan, contract, snapshot };
}

test('L1 mutation contract binds the frozen hypothesis to exactly one non-authority transport seam', () => {
  const { hypothesis, contract } = l1();
  const verified = verifyRsiMutationContract(contract, { hypothesis });
  assert.equal(verified.ok, true);
  assert.deepEqual(contract.allowed_mutations, [{ path: TARGET, change: 'CREATE' }]);
  assert.deepEqual(contract.immutable_causal_components, ['apps/metaengine-browser/src/native-supervisor-client-core-base.mjs', 'apps/metaengine-browser/src/native-supervisor-client-base.mjs']);
  assert.equal(contract.native_supervisor_mutation_allowed, false);
  assert.equal(contract.supervisor_trust_root_mutation_allowed, false);
  assert.equal(contract.execution_authority, false);
  assert.equal(contract.promotion_authority, false);
  assert.equal(contract.self_update_authority, false);
  assert.equal(contract.automatic_retry_allowed, false);
});

test('targeted builder admits only the exact digest-bound helper mutation', () => {
  const { hypothesis, plan, contract, snapshot } = l1();
  const targeted = prepareRsiTargetedCandidateBuild({ experiment_plan: plan, hypothesis, mutation_contract: contract, source_snapshot: snapshot, mutations: [{ path: TARGET, change: 'CREATE' }], requested_backend: 'VERCEL_SANDBOX' });
  assert.deepEqual(targeted.exact_mutation_set, [{ path: TARGET, change: 'CREATE' }]);
  assert.deepEqual(targeted.generic_build_plan.mutation_manifest, [{ path: TARGET, change: 'CREATE' }]);
  assert.equal(targeted.generic_build_plan.source.parent_sha, SOURCE_SHA);
  assert.equal(targeted.execution_authority, false);
  assert.equal(targeted.promotion_authority, false);
  assert.equal(targeted.self_update_authority, false);
  assert.equal(verifyRsiTargetedCandidateBuild(targeted, { hypothesis, mutation_contract: contract }).ok, true);
});

test('targeted builder rejects extra, substituted and native-supervisor mutations before generic materialization', () => {
  const { hypothesis, plan, contract, snapshot } = l1();
  const cases = [
    [{ path: 'apps/metaengine-browser/src/main.mjs', change: 'MODIFY' }],
    [{ path: TARGET, change: 'CREATE' }, { path: 'apps/metaengine-browser/src/main.mjs', change: 'MODIFY' }],
    [{ path: 'apps/metaengine-browser/src/native-supervisor-client-base.mjs', change: 'MODIFY' }],
  ];
  for (const mutations of cases) {
    assert.throws(() => prepareRsiTargetedCandidateBuild({ experiment_plan: plan, hypothesis, mutation_contract: contract, source_snapshot: snapshot, mutations }), /rsi_targeted_mutation_set_mismatch/);
  }
});

test('mutation contract cannot be widened even when an attacker recomputes superficial fields', () => {
  const { hypothesis, contract } = l1();
  const widened = structuredClone(contract);
  widened.allowed_mutations = [...widened.allowed_mutations, { path: 'apps/metaengine-browser/src/main.mjs', change: 'MODIFY' }];
  assert.throws(() => verifyRsiMutationContract(widened, { hypothesis }), /digest_mismatch|profile_drift|material_mismatch/);
});

test('targeted builder requires CREATE target to be absent from the trusted parent snapshot', () => {
  const { hypothesis, plan, contract, snapshot } = l1();
  const impossibleCreate = { ...snapshot, source_files: [...snapshot.source_files, TARGET], source_file_count: snapshot.source_file_count + 1 };
  assert.throws(() => prepareRsiTargetedCandidateBuild({ experiment_plan: plan, hypothesis, mutation_contract: contract, source_snapshot: impossibleCreate, mutations: [{ path: TARGET, change: 'CREATE' }] }), /rsi_targeted_source_snapshot_create_target_already_exists/);
});

test('digest tampering at hypothesis, plan, contract or targeted envelope fails closed', () => {
  const { hypothesis, plan, contract, snapshot } = l1();
  const badHypothesis = { ...hypothesis, claim: `${hypothesis.claim} tampered` };
  assert.throws(() => buildRsiMutationContract({ hypothesis: badHypothesis }), /hypothesis_digest_mismatch/);
  const badPlan = { ...plan, source_sha: 'f'.repeat(40) };
  assert.throws(() => prepareRsiTargetedCandidateBuild({ experiment_plan: badPlan, hypothesis, mutation_contract: contract, source_snapshot: snapshot, mutations: [{ path: TARGET, change: 'CREATE' }] }), /experiment_plan_digest_mismatch/);
  const targeted = prepareRsiTargetedCandidateBuild({ experiment_plan: plan, hypothesis, mutation_contract: contract, source_snapshot: snapshot, mutations: [{ path: TARGET, change: 'CREATE' }] });
  const forged = structuredClone(targeted);
  forged.execution_authority = true;
  assert.throws(() => verifyRsiTargetedCandidateBuild(forged, { hypothesis, mutation_contract: contract }), /execution_authority_invalid/);
});
