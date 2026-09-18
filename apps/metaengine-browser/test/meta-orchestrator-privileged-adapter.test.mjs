import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMetaPlan } from '../src/meta-orchestrator-core.mjs';
import { MetaOrchestratorPrivilegedAdapter } from '../src/meta-orchestrator-privileged-adapter.mjs';

const workspace = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const baseline = '84a71aaedc49186c24a992f507ca1d3f14767181';
const digest = 'a'.repeat(64);
const authority = {
  authority_key: 'METAENGINE_DEVOS',
  roadmap_id: 'metaengine-development-os-v1',
  active_milestone_key: 'DEVOS_IDE_V1',
  integration_line: 'integration/metaengine-development-os-v1',
  baseline_sha: baseline,
  alignment_epoch: 1,
  updated_at: '2026-08-31T19:50:00.000Z',
};
const plan = compileMetaPlan({
  authority,
  plan_generation: 1,
  nodes: [{
    point_id: 'devos_ide_v1', role: 'IMPLEMENTER', objective: 'Implement IDE convergence.',
    dependencies: [], required_capabilities: ['repo.write'], risk: 'NORMAL', priority: 50,
    evidence_contract: { required: ['roadmap_receipt:mainline_seal'], min_verified: 1 },
  }],
});

function planState(overrides = {}) {
  return {
    schema: 'metaengine.meta-orchestrator.plan-state.v1',
    found: true,
    workspace_id: workspace,
    roadmap_id: plan.roadmap_id,
    plan_generation: plan.plan_generation,
    alignment_epoch: plan.alignment_epoch,
    baseline_sha: plan.baseline_sha,
    plan_sha256: digest,
    plan_spec: plan,
    state: 'ACTIVE',
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

function task() {
  return {
    task_id: '98903ffd-dc3f-4a3e-ab09-55931c5100a9',
    point_id: 'devos_ide_v1',
    state: 'COMPLETED',
    base_sha: baseline,
    lease_generation: 1,
    lease_agent_id: 'agent_should_not_cross',
    lease_tab_id: 'tab_should_not_cross',
    lease_target_id: 'webcontents:999',
    result_summary: { untrusted: 'worker/model text' },
    task_spec: {
      objective: 'untrusted task text',
      meta_orchestrator: {
        roadmap_id: plan.roadmap_id,
        alignment_epoch: plan.alignment_epoch,
        plan_generation: plan.plan_generation,
        parent_plan_point: 'devos_ide_v1',
        parent_point_id: null,
      },
    },
    authority_effect: false,
    updated_at: '2026-08-31T19:55:00.000Z',
  };
}

function receipt() {
  return {
    receipt_id: 200,
    roadmap_id: plan.roadmap_id,
    milestone_key: 'DEVOS_IDE_V1',
    step_kind: 'MAINLINE_SEAL',
    status: 'VERIFIED',
    result_checkpoint_id: 'devos-ide-verified-001',
    created_at: '2026-08-31T19:56:00.000Z',
  };
}

function adapter(overrides = {}) {
  return new MetaOrchestratorPrivilegedAdapter({
    readRoadmapAuthority: async () => authority,
    readPlanState: async () => planState(),
    readDevosTasks: async () => [task()],
    readRoadmapReceipts: async () => [receipt()],
    readCapacity: async () => ({ source: 'DEVOS_SCHEDULER_SNAPSHOT', available_slots: 3 }),
    activatePlan: async ({ p_workspace_id, p_roadmap_id, p_expected_current_generation, p_plan }) => ({
      schema: 'metaengine.meta-orchestrator.plan-state.v1',
      workspace_id: p_workspace_id,
      roadmap_id: p_roadmap_id,
      plan_generation: p_plan.plan_generation,
      alignment_epoch: p_plan.alignment_epoch,
      baseline_sha: p_plan.baseline_sha,
      plan_sha256: digest,
      state: 'ACTIVE',
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
      expected_generation_seen: p_expected_current_generation,
    }),
    ...overrides,
  });
}

test('privileged read adapter obtains ACTIVE durable plan then returns only sanitized authoritative bundle', async () => {
  const calls = [];
  const a = adapter({
    readRoadmapAuthority: async (args) => { calls.push(['roadmap', args]); return authority; },
    readPlanState: async (args) => { calls.push(['plan', args]); return planState(); },
    readDevosTasks: async (args) => { calls.push(['tasks', args]); return [task()]; },
    readRoadmapReceipts: async (args) => { calls.push(['receipts', args]); return [receipt()]; },
    readCapacity: async (args) => { calls.push(['capacity', args]); return { source: 'DEVOS_SCHEDULER_SNAPSHOT', available_slots: 3 }; },
  });
  const bundle = await a.readAuthoritativeBundle({
    workspace_id: workspace,
    roadmap_id: plan.roadmap_id,
    worker_observer: { signals: [{ generation_state: 'IDLE' }], counts: { ACTIVE: 999 } },
  });
  assert.deepEqual(calls.map((row) => row[0]), ['roadmap', 'plan', 'tasks', 'receipts', 'capacity']);
  assert.equal(bundle.plan.plan_generation, 1);
  assert.equal(bundle.snapshot.tasks.length, 1);
  assert.equal(bundle.snapshot.evidence.length, 1);
  assert.equal(bundle.snapshot.capacity.available_slots, 3);
  assert.equal(bundle.snapshot.capacity.worker_observer_contribution, 0);
  assert.equal(bundle.snapshot.tasks[0].task_spec_included, false);
  assert.equal(bundle.snapshot.tasks[0].result_summary_included, false);
  assert.equal('lease_agent_id' in bundle.snapshot.tasks[0], false);
  assert.equal(bundle.scheduler_authority, false);
  assert.equal(bundle.authority_effect, false);
});

test('privileged read path rejects stale durable plan before task/evidence reconciliation', async () => {
  let tasksRead = false;
  const a = adapter({
    readPlanState: async () => planState({ alignment_epoch: 2 }),
    readDevosTasks: async () => { tasksRead = true; return [task()]; },
  });
  await assert.rejects(
    a.readAuthoritativeBundle({ workspace_id: workspace, roadmap_id: plan.roadmap_id }),
    /meta_privileged_plan_alignment_drift/,
  );
  assert.equal(tasksRead, false);
});

test('reconcile uses DB-owned active plan and converges only through sanitized verified evidence', async () => {
  const out = await adapter().reconcile({
    workspace_id: workspace,
    roadmap_id: plan.roadmap_id,
    leader: { expected_epoch: 1, observed_epoch: 1 },
  });
  assert.equal(out.state, 'CONVERGED');
  assert.equal(out.authority_effect, false);
});

test('plan activation is optimistic, exact-next-generation and zero-authority before privileged RPC', async () => {
  let activationArgs = null;
  const a = adapter({ activatePlan: async (args) => {
    activationArgs = structuredClone(args);
    return {
      schema: 'metaengine.meta-orchestrator.plan-state.v1',
      workspace_id: args.p_workspace_id,
      roadmap_id: args.p_roadmap_id,
      plan_generation: args.p_plan.plan_generation,
      alignment_epoch: args.p_plan.alignment_epoch,
      baseline_sha: args.p_plan.baseline_sha,
      plan_sha256: digest,
      state: 'ACTIVE',
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    };
  }});
  const readback = await a.activateCompiledPlan({ workspace_id: workspace, compiled_plan: plan, expected_current_generation: 0 });
  assert.equal(readback.plan_generation, 1);
  assert.equal(readback.authority_effect, false);
  assert.equal(activationArgs.p_expected_current_generation, 0);
  assert.equal(activationArgs.p_workspace_id, workspace);
  assert.equal('agent_id' in activationArgs.p_plan, false);
});

test('bad next generation or scheduler-owned identity is rejected before privileged activation RPC', async () => {
  let calls = 0;
  const a = adapter({ activatePlan: async () => { calls += 1; throw new Error('should_not_run'); } });
  await assert.rejects(
    a.activateCompiledPlan({ workspace_id: workspace, compiled_plan: plan, expected_current_generation: 1 }),
    /meta_privileged_next_generation_mismatch/,
  );
  const tainted = structuredClone(plan);
  tainted.nodes[0].agent_id = 'agent_12345678';
  await assert.rejects(
    a.activateCompiledPlan({ workspace_id: workspace, compiled_plan: tainted, expected_current_generation: 0 }),
    /meta_scheduler_owned_field_forbidden/,
  );
  assert.equal(calls, 0);
});

test('unrecognized capacity source is fail-closed to zero before reconcile', async () => {
  const a = adapter({ readCapacity: async () => ({ source: 'WORKER_OBSERVER', available_slots: 999 }) });
  const bundle = await a.readAuthoritativeBundle({ workspace_id: workspace, roadmap_id: plan.roadmap_id });
  assert.equal(bundle.snapshot.capacity.source, 'UNSPECIFIED_FAIL_CLOSED');
  assert.equal(bundle.snapshot.capacity.available_slots, 0);
});
