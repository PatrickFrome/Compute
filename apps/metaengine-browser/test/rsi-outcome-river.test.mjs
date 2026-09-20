import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import {
  RsiOutcomeRiver,
  extractRsiCommandTaskContext,
  rsiOutcomeRiverTrustRootSnapshot,
} from '../src/rsi-outcome-river.mjs';

const SOURCE = 'a'.repeat(40);

function readbackFor(commandId, { status = 'COMPLETED', effectOutcome = 'CONFIRMED', action = 'SCROLL', platform = 'GLM_ZAI', effectKey = null, executionMs = 12.5 } = {}) {
  return {
    schema: 'metaengine.rsi.result-receipt-readback.v1',
    command_id: commandId,
    found: true,
    terminal: true,
    status,
    receipt: {
      schema: 'metaengine.native-supervisor.command-receipt.v2',
      command_id: commandId,
      action,
      platform,
      result: { ok: true },
      effect_outcome: effectOutcome,
      lane: 'MUTATION',
      effect_key: effectKey,
      execution_ms: executionMs,
      recorded_at: '2026-09-20T10:00:00.000Z',
      authority_effect: false,
    },
    error: null,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

async function freshRuntime(root, name) {
  const runtime = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, `${name}.jsonl`) });
  await runtime.start();
  const river = new RsiOutcomeRiver({
    source_sha: SOURCE,
    statePath: path.join(root, `${name}.jsonl.outcome-river.json`),
  }).attach(runtime);
  await river.init();
  return { runtime, river };
}

test('extractRsiCommandTaskContext validates the issuer contract', () => {
  const commandId = '11111111-1111-4111-8111-111111111111';
  assert.equal(extractRsiCommandTaskContext({ command_id: commandId, action: 'SCROLL', payload: {} }), null);
  assert.equal(extractRsiCommandTaskContext({ command_id: commandId, action: 'SCROLL', payload: { rsi_task: { schema: 'wrong.v1', task_id: 'task-1' } } }), null);
  assert.equal(extractRsiCommandTaskContext({ command_id: commandId, action: 'SCROLL', payload: { rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: 'x' } } }), null);
  const ctx = extractRsiCommandTaskContext({
    command_id: commandId,
    action: 'SCROLL',
    payload: {
      rsi_task: {
        schema: 'metaengine.rsi.command-task-context.v1',
        task_id: '550e8400-e29b-41d4-a716-446655440000',
        agent_id: 'agent_fleetabcd',
      },
    },
  });
  assert.equal(ctx.task_id, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(ctx.agent_id, 'agent_fleetabcd');
  assert.equal(ctx.challenge_family, 'DEVOS_FLEET_TASK');
  assert.match(ctx.task_signature_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(ctx.hidden_manifest_digest, /^sha256:[0-9a-f]{64}$/);
  // deterministic derivation: same context, same digests
  const again = extractRsiCommandTaskContext({
    command_id: commandId,
    action: 'SCROLL',
    payload: { rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: '550e8400-e29b-41d4-a716-446655440000', agent_id: 'agent_fleetabcd' } },
  });
  assert.deepEqual(again, ctx);
});

test('outcome river closes bind -> ingest -> credit -> experience case (one attributed command = one case)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-outcome-river-'));
  try {
    const { runtime, river } = await freshRuntime(root, 'river-a');
    const commandId = '33333333-3333-4333-8333-333333333333';
    const command = {
      command_id: commandId,
      action: 'SEMANTIC_TYPE',
      platform: 'GLM_ZAI',
      effect_key: null,
      payload: {
        tab_id: 'tab-1',
        rsi_task: {
          schema: 'metaengine.rsi.command-task-context.v1',
          task_id: '550e8400-e29b-41d4-a716-446655440000',
          agent_id: 'agent_fleetabcd',
        },
      },
    };
    const bound = await river.bindLeasedCommand(command, { environment_fingerprint: 'metaengine-browser-0.7.0' });
    assert.equal(bound.bound, true);
    assert.equal(bound.duplicate, false);
    assert.equal(runtime.snapshot().command_attribution.binding_count, 1);
    assert.equal(runtime.snapshot().command_attribution.pending_count, 1);

    // Idempotent rebind of the same leased command (crash/re-lease path).
    const rebind = await river.bindLeasedCommand(command, { environment_fingerprint: 'metaengine-browser-0.7.0' });
    assert.equal(rebind.bound, true);
    assert.equal(rebind.duplicate, true);
    assert.equal(runtime.snapshot().command_attribution.binding_count, 1);

    // Wiring decision: peek finds the trusted binding -> ingest resolves it.
    const peeked = runtime.peekCommandAttribution({ command_id: commandId, action: 'SEMANTIC_TYPE', platform: 'GLM_ZAI', effect_key: null });
    assert.ok(peeked, 'peek must find the bound command');
    assert.equal(peeked.task_id, '550e8400-e29b-41d4-a716-446655440000');
    const episode = await runtime.ingestBrowserOutcome({ readback: readbackFor(commandId, { action: 'SEMANTIC_TYPE' }), attribution: null });
    assert.equal(episode.eligible_for_experience_graph, true);
    assert.equal(episode.eligible_for_credit_assignment, true);
    assert.match(episode.candidate_id, /^candidate_sha256_[0-9a-f]{64}$/);
    assert.equal(episode.trajectory_id, 'trajectory.550e8400-e29b-41d4-a716-446655440000');
    assert.equal(episode.step_index, 1);
    assert.equal(runtime.snapshot().command_attribution.pending_count, 0);
    assert.equal(runtime.snapshot().command_attribution.consumed_count, 1);

    const credited = await river.creditIngestedEpisode(episode, { environment_fingerprint: 'metaengine-browser-0.7.0' });
    assert.equal(credited.credited, true);
    assert.equal(credited.case_appended, true);
    assert.equal(credited.outcome, 'SUCCESS');
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.runtime_experience_store.case_count, 1);
    assert.equal(snapshot.runtime_experience_store.graph_present, true);
    assert.equal(snapshot.browser_outcome_ingest.learning_eligible_count, 1);
    assert.equal(snapshot.authority_effect, false);

    // Credit is idempotent per episode.
    const again = await river.creditIngestedEpisode(episode, { environment_fingerprint: 'metaengine-browser-0.7.0' });
    assert.equal(again.credited, true);
    assert.equal(again.duplicate, true);
    assert.equal(runtime.snapshot().runtime_experience_store.case_count, 1);

    const riverSnap = river.snapshot();
    assert.equal(riverSnap.state, 'READY');
    assert.equal(riverSnap.task_anchor_count, 1);
    assert.equal(riverSnap.bound_command_count, 1);
    assert.equal(riverSnap.credited_command_count, 1);
    assert.equal(riverSnap.case_materialized_count, 1);
    assert.equal(riverSnap.counters.bind_error_count, 0);
    assert.equal(riverSnap.authority_effect, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('second attributed command on the same task advances the trajectory and materializes another case', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-outcome-river-steps-'));
  try {
    const { runtime, river } = await freshRuntime(root, 'river-b');
    const taskId = '660e8400-e29b-41d4-a716-446655440000';
    const rsiTask = { schema: 'metaengine.rsi.command-task-context.v1', task_id: taskId, agent_id: 'agent_fleetabcd' };
    const first = '44444444-4444-4444-8444-444444444444';
    const second = '44444444-4444-4444-8444-444444444445';
    // Realistic sequential execution order: bind → execute/ingest → credit,
    // then the next command binds with the predecessor episode known.
    await river.bindLeasedCommand({ command_id: first, action: 'CAPTURE', platform: 'GLM_ZAI', payload: { rsi_task: rsiTask } }, { environment_fingerprint: 'env-1' });
    const e1 = await runtime.ingestBrowserOutcome({ readback: readbackFor(first, { action: 'CAPTURE', effectOutcome: null }), attribution: null });
    await river.creditIngestedEpisode(e1, { environment_fingerprint: 'env-1' });
    await river.bindLeasedCommand({ command_id: second, action: 'SEMANTIC_TYPE', platform: 'GLM_ZAI', payload: { rsi_task: rsiTask } }, { environment_fingerprint: 'env-1' });
    const e2 = await runtime.ingestBrowserOutcome({ readback: readbackFor(second, { action: 'SEMANTIC_TYPE' }), attribution: null });
    assert.equal(e1.step_index, 1);
    assert.equal(e2.step_index, 2);
    assert.equal(e2.predecessor_episode_digest, e1.episode_digest);
    await river.creditIngestedEpisode(e2, { environment_fingerprint: 'env-1' });
    assert.equal(runtime.snapshot().runtime_experience_store.case_count, 2);
    const anchorConflict = river.snapshot();
    assert.equal(anchorConflict.task_anchor_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('failed attributed command receives negative credit with a failure code and a FAILURE case', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-outcome-river-fail-'));
  try {
    const { runtime, river } = await freshRuntime(root, 'river-c');
    const commandId = '55555555-5555-4555-8555-555555555555';
    await river.bindLeasedCommand({
      command_id: commandId,
      action: 'TYPED_CLICK',
      platform: 'GLM_ZAI',
      payload: { rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: 'task-fail-1', agent_id: 'agent_fleetabcd' } },
    }, { environment_fingerprint: 'env-1' });
    const episode = await runtime.ingestBrowserOutcome({ readback: readbackFor(commandId, { status: 'FAILED', effectOutcome: 'PRE_EFFECT_FAILURE', action: 'TYPED_CLICK' }), attribution: null });
    assert.equal(episode.eligible_for_credit_assignment, true);
    const credited = await river.creditIngestedEpisode(episode, { environment_fingerprint: 'env-1' });
    assert.equal(credited.credited, true);
    assert.equal(credited.outcome, 'FAILURE');
    assert.equal(runtime.snapshot().runtime_experience_store.case_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('generic queued commands without task context are never bound and stay learning-inert', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-outcome-river-generic-'));
  try {
    const { runtime, river } = await freshRuntime(root, 'river-d');
    const commandId = '66666666-6666-4666-8666-666666666666';
    const result = await river.bindLeasedCommand({ command_id: commandId, action: 'SCROLL', platform: 'GLM_ZAI', payload: { tab_id: 'tab-1' } }, { environment_fingerprint: 'env-1' });
    assert.equal(result.bound, false);
    assert.equal(result.reason, 'NO_TASK_CONTEXT');
    const notQueued = await river.bindLeasedCommand({ action: 'CAPTURE', payload: { rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: 'task-x' } } }, { environment_fingerprint: 'env-1' });
    assert.equal(notQueued.bound, false);
    assert.equal(notQueued.reason, 'NOT_QUEUED_COMMAND');
    // Generic ingest keeps the synthetic candidate-less attribution contract.
    const episode = await runtime.ingestBrowserOutcome({
      readback: readbackFor(commandId),
      attribution: {
        task_id: `browser.command.${commandId}`,
        task_signature_digest: 'sha256:' + 'a'.repeat(64),
        environment_fingerprint: 'metaengine-browser-0.7.0',
        model_family: 'NATIVE_SUPERVISOR',
        candidate_id: null,
        candidate_sha: null,
        proposal_digest: null,
        skill_digests: [],
        external_attribution: true,
        authored_by_candidate: false,
      },
    });
    assert.equal(episode.candidate_id, null);
    assert.equal(episode.eligible_for_experience_graph, false);
    const credited = await river.creditIngestedEpisode(episode, { environment_fingerprint: 'env-1' });
    assert.equal(credited.credited, false);
    assert.equal(runtime.snapshot().runtime_experience_store.case_count, 0);
    assert.equal(runtime.snapshot().command_attribution.binding_count, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('river state is durable across restarts and anchor conflicts fail closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-outcome-river-durable-'));
  try {
    const statePath = path.join(root, 'river.jsonl.outcome-river.json');
    const runtimeA = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtimeA.start();
    const riverA = new RsiOutcomeRiver({ source_sha: SOURCE, statePath }).attach(runtimeA);
    await riverA.init();
    const commandId = '77777777-7777-4777-8777-777777777777';
    await riverA.bindLeasedCommand({
      command_id: commandId,
      action: 'CAPTURE',
      platform: 'GLM_ZAI',
      payload: { rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: 'task-durable-1', agent_id: 'agent_fleetabcd' } },
    }, { environment_fingerprint: 'env-1' });

    // Fresh instances on the same paths see the durable river state.
    const runtimeB = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtimeB.start();
    const riverB = new RsiOutcomeRiver({ source_sha: SOURCE, statePath }).attach(runtimeB);
    await riverB.init();
    assert.equal(riverB.snapshot().task_anchor_count, 1);
    assert.equal(riverB.snapshot().bound_command_count, 1);
    assert.equal(riverB.hasCommand(commandId), true);
    // Rebind is idempotent after restart (new candidate proposed into the new
    // in-process archive, identical binding digest accepted by the registry).
    const rebind = await riverB.bindLeasedCommand({
      command_id: commandId,
      action: 'CAPTURE',
      platform: 'GLM_ZAI',
      payload: { rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: 'task-durable-1', agent_id: 'agent_fleetabcd' } },
    }, { environment_fingerprint: 'env-1' });
    assert.equal(rebind.bound, true);
    assert.equal(rebind.duplicate, true);

    // A conflicting anchor for the same task_id is refused.
    const conflicted = await riverB.bindLeasedCommand({
      command_id: '88888888-8888-4888-8888-888888888888',
      action: 'CAPTURE',
      platform: 'GLM_ZAI',
      payload: { rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: 'task-durable-1', task_signature_digest: 'sha256:' + 'f'.repeat(64) } },
    }, { environment_fingerprint: 'env-1' });
    assert.equal(conflicted.bound, false);
    assert.equal(riverB.snapshot().counters.bind_error_count, 1);
    assert.ok(riverB.snapshot().last_errors.length >= 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('outcome river trust root pins the zero-authority bridge contract', () => {
  const root = rsiOutcomeRiverTrustRootSnapshot();
  assert.equal(root.schema, 'metaengine.rsi.outcome-river-root.v1');
  assert.equal(root.bind_failure_never_gates_execution, true);
  assert.equal(root.one_attributed_command_one_experience_case, true);
  assert.equal(root.candidate_authored_credit_forbidden, true);
  assert.equal(root.raw_command_payload_stored, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.outcome_river_root_digest, /^sha256:[0-9a-f]{64}$/);
});
