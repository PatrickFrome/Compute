import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

import { compileMetaObjectivePlan, META_OBJECTIVE_MAX_NODES } from '../src/meta-objective-compiler.mjs';
import { createMetaSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/meta-routes.mjs';
import { createDevosSupervisorRoutes, projectDevosWorkGraph } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const WORKSPACE = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const AUTHORITY = Object.freeze({
  roadmap_id: 'metaengine-development-os-v1',
  active_milestone_key: 'DEVOS_IDE_V1',
  integration_line: 'integration/metaengine-development-os-v1',
  baseline_sha: 'b69f6629ddc696daf19c122f8c0a3e7a9be44f63',
  alignment_epoch: 87,
});
const NO_PLAN = Object.freeze({ found: false, plan_generation: 0 });

function authoritativeInputs({ planState = NO_PLAN, tasks = [] } = {}) {
  return {
    schema: 'metaengine.meta-orchestrator.authoritative-inputs.v1',
    workspace_id: WORKSPACE,
    roadmap_id: AUTHORITY.roadmap_id,
    roadmap_authority: { ...AUTHORITY },
    plan_state: { ...planState },
    tasks,
    roadmap_receipts: [],
    capacity: { source: 'UNSPECIFIED_FAIL_CLOSED', available_slots: 0, authority_effect: false },
    task_meta_projection_only: true,
    task_payload_exposed: false,
    result_summary_exposed: false,
    scheduler_identity_exposed: false,
    receipt_summary_exposed: false,
    receipt_evidence_exposed: false,
    automatic_retry_allowed: false,
    task_content_authority: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
}

function activationReadback(generation) {
  return {
    schema: 'metaengine.meta-orchestrator.plan-state.v1',
    workspace_id: WORKSPACE,
    roadmap_id: AUTHORITY.roadmap_id,
    plan_generation: generation,
    alignment_epoch: AUTHORITY.alignment_epoch,
    baseline_sha: AUTHORITY.baseline_sha,
    plan_sha256: 'a'.repeat(64),
    state: 'ACTIVE',
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
}

async function call(routes, { method = 'POST', path, body = {} } = {}) {
  const response = await routes({ req: { method }, path, body, clientId: 'client-test-1' });
  return { status: response.status, body: await response.json() };
}

// ---------------------------------------------------------------------------
// compileMetaObjectivePlan
// ---------------------------------------------------------------------------

test('objective compiler synthesizes a single IMPLEMENTER node bound to the roadmap authority', () => {
  const { plan, expected_current_generation, point_ids } = compileMetaObjectivePlan({
    authority: AUTHORITY,
    planState: NO_PLAN,
    objective: 'Ship the DevOS IDE v1 workbench',
  });
  assert.equal(plan.schema, 'metaengine.meta-orchestrator.plan.v1');
  assert.equal(plan.plan_generation, 1);
  assert.equal(expected_current_generation, 0);
  assert.equal(plan.roadmap_id, AUTHORITY.roadmap_id);
  assert.equal(plan.active_milestone_key, AUTHORITY.active_milestone_key);
  assert.equal(plan.integration_line, AUTHORITY.integration_line);
  assert.equal(plan.baseline_sha, AUTHORITY.baseline_sha);
  assert.equal(plan.alignment_epoch, AUTHORITY.alignment_epoch);
  assert.equal(plan.nodes.length, 1);
  assert.equal(plan.nodes[0].role, 'IMPLEMENTER');
  assert.equal(plan.nodes[0].base_sha, AUTHORITY.baseline_sha);
  assert.ok(point_ids[0].startsWith('obj.'));
  for (const flag of ['task_content_authority', 'scheduler_authority', 'browser_authority', 'release_authority', 'authority_effect', 'automatic_retry_allowed']) {
    assert.equal(plan[flag], false);
  }
});

test('objective compiler increments plan_generation from the current active plan', () => {
  const { plan, expected_current_generation } = compileMetaObjectivePlan({
    authority: AUTHORITY,
    planState: { found: true, plan_generation: 3 },
    objective: 'Next objective',
  });
  assert.equal(expected_current_generation, 3);
  assert.equal(plan.plan_generation, 4);
});

test('objective compiler validates explicit nodes: dependencies, duplicates, companions, cycles', () => {
  const nodes = [
    { point_id: 'devos.ide.a.v1', role: 'RESEARCHER', objective: 'Research A', dependencies: [] },
    { point_id: 'devos.ide.b.v1', role: 'IMPLEMENTER', objective: 'Build B', dependencies: ['devos.ide.a.v1'] },
  ];
  const { plan } = compileMetaObjectivePlan({ authority: AUTHORITY, planState: NO_PLAN, objective: 'Two nodes', nodes });
  assert.equal(plan.nodes.length, 2);
  assert.deepEqual(plan.nodes[1].dependencies, ['devos.ide.a.v1']);

  // unknown dependency
  assert.throws(() => compileMetaObjectivePlan({
    authority: AUTHORITY, planState: NO_PLAN, objective: 'x',
    nodes: [{ point_id: 'devos.ide.a.v1', role: 'IMPLEMENTER', objective: 'A', dependencies: ['devos.ide.missing.v1'] }],
  }), /meta_objective_dependency_unknown/);

  // cycle
  assert.throws(() => compileMetaObjectivePlan({
    authority: AUTHORITY, planState: NO_PLAN, objective: 'x',
    nodes: [
      { point_id: 'devos.ide.a.v1', role: 'IMPLEMENTER', objective: 'A', dependencies: ['devos.ide.b.v1'] },
      { point_id: 'devos.ide.b.v1', role: 'IMPLEMENTER', objective: 'B', dependencies: ['devos.ide.a.v1'] },
    ],
  }), /meta_objective_dependencies_cyclic/);

  // duplicate point
  assert.throws(() => compileMetaObjectivePlan({
    authority: AUTHORITY, planState: NO_PLAN, objective: 'x',
    nodes: [
      { point_id: 'devos.ide.a.v1', role: 'IMPLEMENTER', objective: 'A' },
      { point_id: 'devos.ide.a.v1', role: 'CRITIC', objective: 'A again' },
    ],
  }), /meta_objective_node_1_point_duplicate/);

  // companion suffix forbidden as a primary point
  assert.throws(() => compileMetaObjectivePlan({
    authority: AUTHORITY, planState: NO_PLAN, objective: 'x',
    nodes: [{ point_id: 'devos.ide.a.v1.critic', role: 'CRITIC', objective: 'A' }],
  }), /meta_objective_node_0_companion_suffix_forbidden/);

  // node budget
  const many = Array.from({ length: META_OBJECTIVE_MAX_NODES + 1 }, (_, i) => ({
    point_id: `devos.ide.n${i}.v1`, role: 'IMPLEMENTER', objective: `N${i}`,
  }));
  assert.throws(() => compileMetaObjectivePlan({ authority: AUTHORITY, planState: NO_PLAN, objective: 'x', nodes: many }), /meta_objective_nodes_invalid/);
});

test('objective compiler rejects scheduler identity keys at any nesting depth', () => {
  assert.throws(() => compileMetaObjectivePlan({
    authority: AUTHORITY, planState: NO_PLAN, objective: 'x',
    nodes: [{ point_id: 'devos.ide.a.v1', role: 'IMPLEMENTER', objective: 'A', evidence_contract: { deep: { deeper: { tab_id: 'tab_123' } } } }],
  }), /meta_objective_scheduler_identity_forbidden/);
  // Structured constraint items are rejected outright (string-only) — they
  // could otherwise smuggle scheduler identity past the deep scan.
  assert.throws(() => compileMetaObjectivePlan({
    authority: AUTHORITY, planState: NO_PLAN, objective: 'x',
    nodes: [{ point_id: 'devos.ide.a.v1', role: 'IMPLEMENTER', objective: 'A', constraints: [{ lease_generation: 3 }] }],
  }), /meta_objective_node_0_constraint_0_invalid/);
  assert.throws(() => compileMetaObjectivePlan({
    authority: AUTHORITY, planState: NO_PLAN, objective: 'x',
    nodes: [{ point_id: 'devos.ide.a.v1', role: 'IMPLEMENTER', objective: 'A', required_capabilities: [42] }],
  }), /meta_objective_node_0_capability_0_invalid/);
});

// ---------------------------------------------------------------------------
// POST /v1/meta/objective (edge route)
// ---------------------------------------------------------------------------

test('POST /v1/meta/objective compiles, activates and readbacks the next plan generation', async () => {
  const calls = [];
  const routes = createMetaSupervisorRoutes({
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'meta_orchestrator_authoritative_inputs_v1') return authoritativeInputs();
      if (name === 'meta_orchestrator_plan_activate_v1') {
        assert.equal(args.p_expected_current_generation, 0);
        assert.equal(args.p_plan.plan_generation, 1);
        return activationReadback(1);
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    workspaceId: WORKSPACE,
  });
  const { status, body } = await call(routes, { path: '/v1/meta/objective', body: { objective: 'Ship the workbench' } });
  assert.equal(status, 200);
  assert.equal(body.schema, 'metaengine.meta-orchestrator.objective-activation.v1');
  assert.equal(body.operator_initiated, true);
  assert.equal(body.plan_generation, 1);
  assert.equal(body.node_count, 1);
  assert.equal(body.authority_effect, false);
  assert.equal(body.activation.state, 'ACTIVE');
  assert.deepEqual(calls.map((row) => row.name), ['meta_orchestrator_authoritative_inputs_v1', 'meta_orchestrator_plan_activate_v1']);
});

test('POST /v1/meta/objective rejects unknown fields, bad objectives and compiler errors with 400', async () => {
  const routes = createMetaSupervisorRoutes({
    rpc: async (name) => {
      if (name === 'meta_orchestrator_authoritative_inputs_v1') return authoritativeInputs();
      if (name === 'meta_orchestrator_plan_activate_v1') return activationReadback(1);
      throw new Error(`unexpected rpc ${name}`);
    },
    workspaceId: WORKSPACE,
  });
  const forbidden = await call(routes, { path: '/v1/meta/objective', body: { objective: 'x', workspace_id: WORKSPACE } });
  assert.equal(forbidden.status, 400);
  assert.equal(forbidden.body.error, 'workspace_override_forbidden');

  const empty = await call(routes, { path: '/v1/meta/objective', body: { objective: '   ' } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'meta_objective_invalid');

  const badNode = await call(routes, {
    path: '/v1/meta/objective',
    body: { objective: 'x', nodes: [{ point_id: 'BAD POINT', role: 'IMPLEMENTER', objective: 'A' }] },
  });
  assert.equal(badNode.status, 400);
  assert.match(badNode.body.error, /meta_objective_node_0_point_id/);
});

test('POST /v1/meta/objective maps activation CAS conflicts to 409', async () => {
  const routes = createMetaSupervisorRoutes({
    rpc: async (name) => {
      if (name === 'meta_orchestrator_authoritative_inputs_v1') return authoritativeInputs();
      if (name === 'meta_orchestrator_plan_activate_v1') throw new Error('meta_plan_generation_fenced');
      throw new Error(`unexpected rpc ${name}`);
    },
    workspaceId: WORKSPACE,
  });
  const { status, body } = await call(routes, { path: '/v1/meta/objective', body: { objective: 'x' } });
  assert.equal(status, 409);
  assert.equal(body.error, 'meta_objective_activation_fenced');
});

// ---------------------------------------------------------------------------
// POST /v1/devos/resume-admission (edge route)
// ---------------------------------------------------------------------------

function environmentState({ floor = 28, admission = false } = {}) {
  return {
    schema: 'metaengine.devos.environment-state.v1',
    workspace_id: WORKSPACE,
    generation_floor: floor,
    refill_enabled: true,
    supervisor_admission_enabled: admission,
    authority_effect: false,
  };
}

function devosRoutesWith(rpc) {
  return createDevosSupervisorRoutes({
    rpc,
    workspaceId: WORKSPACE,
    readRuntimeControl: async () => null,
  });
}

test('POST /v1/devos/resume-admission requires explicit operator confirmation', async () => {
  const routes = devosRoutesWith(async () => { throw new Error('must not be called'); });
  const { status, body } = await call(routes, { path: '/v1/devos/resume-admission', body: {} });
  assert.equal(status, 400);
  assert.equal(body.error, 'devos_resume_confirmation_required');
  assert.equal(body.authority_effect, false);
});

test('POST /v1/devos/resume-admission resumes through the generation-floor CAS with before/after readback', async () => {
  let admission = false;
  const calls = [];
  const routes = devosRoutesWith(async (name, args) => {
    calls.push({ name, args });
    if (name === 'devos_environment_state_v1') return environmentState({ floor: 28, admission });
    if (name === 'devos_environment_resume_v1') {
      assert.equal(args.p_expected_generation_floor, 28);
      admission = true;
      return { supervisor_admission_enabled: true };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const { status, body } = await call(routes, { path: '/v1/devos/resume-admission', body: { confirm: true } });
  assert.equal(status, 200);
  assert.equal(body.schema, 'metaengine.devos.environment-resume.v1');
  assert.equal(body.resumed, true);
  assert.equal(body.operator_initiated, true);
  assert.equal(body.before.supervisor_admission_enabled, false);
  assert.equal(body.after.supervisor_admission_enabled, true);
  assert.equal(body.after.continuous_service_allowed, true);
  assert.equal(body.authority_effect, false);
});

test('POST /v1/devos/resume-admission maps a stale generation floor to 409', async () => {
  const routes = devosRoutesWith(async (name) => {
    if (name === 'devos_environment_state_v1') return environmentState({ floor: 28 });
    if (name === 'devos_environment_resume_v1') throw new Error('devos_environment_resume_generation_mismatch');
    throw new Error(`unexpected rpc ${name}`);
  });
  const { status, body } = await call(routes, { path: '/v1/devos/resume-admission', body: { confirm: true, expected_generation_floor: 27 } });
  assert.equal(status, 409);
  assert.equal(body.error, 'devos_resume_generation_mismatch');
  assert.equal(body.requested_floor, 27);
});

// ---------------------------------------------------------------------------
// Work Graph projection
// ---------------------------------------------------------------------------

test('work graph projection composes roadmap/tasks/claims/planes with zero authority', () => {
  const graph = projectDevosWorkGraph({
    planSnapshot: {
      found: true,
      roadmap_id: AUTHORITY.roadmap_id,
      plan_generation: 2,
      state: 'ACTIVE',
      plan_spec: {
        schema: 'metaengine.meta-orchestrator.plan.v1',
        active_milestone_key: AUTHORITY.active_milestone_key,
        objective: 'Ship the DevOS IDE',
        nodes: [{ point_id: 'a.v1' }, { point_id: 'b.v1' }],
      },
    },
    metaOrchestrator: { state: 'OBSERVING' },
    backlog: { ready: 3, by_role: { IMPLEMENTER: 2, RESEARCHER: 1 } },
    running: [{ task_id: 't1' }, { task_id: 't2' }],
    leases: [{}, {}],
    planes: {
      fleet_generation_epochs: [28, 28, 29],
      mesh_epoch: 25,
      cognitive_stream: { stream_id: 'stream-1', acknowledged_through_sequence: 8313 },
    },
  });
  assert.equal(graph.schema, 'metaengine.devos.work-graph.v1');
  assert.equal(graph.roadmap.objective, 'Ship the DevOS IDE');
  assert.equal(graph.roadmap.milestone, 'DEVOS_IDE_V1');
  assert.equal(graph.roadmap.plan_generation, 2);
  assert.equal(graph.roadmap.node_count, 2);
  assert.equal(graph.tasks.ready, 3);
  assert.equal(graph.tasks.running, 2);
  assert.equal(graph.claims.leased_this_cycle, 2);
  assert.deepEqual(graph.planes.fleet_generation_epochs, [28, 29]);
  assert.equal(graph.planes.mesh_epoch, 25);
  assert.equal(graph.planes.cognitive_stream.acknowledged_through_sequence, 8313);
  assert.equal(graph.planes.meta_orchestrator_state, 'OBSERVING');
  for (const flag of ['task_content_authority', 'scheduler_authority', 'browser_authority', 'release_authority', 'automatic_retry_allowed', 'authority_effect']) {
    assert.equal(graph[flag], false);
  }
});

test('work graph projection degrades to NONE when no active plan exists', () => {
  const graph = projectDevosWorkGraph({
    planSnapshot: { found: false, roadmap_id: AUTHORITY.roadmap_id, plan_generation: 0 },
    planes: {},
  });
  assert.equal(graph.roadmap.plan_state, 'NONE');
  assert.equal(graph.roadmap.objective, null);
  assert.deepEqual(graph.planes.fleet_generation_epochs, []);
  assert.equal(graph.planes.mesh_epoch, null);
  assert.equal(graph.planes.cognitive_stream, null);
});

// ---------------------------------------------------------------------------
// Cycle response carries the work graph (route-level)
// ---------------------------------------------------------------------------

test('POST /v1/devos/cycle OPEN response carries the work_graph projection with browser planes', async () => {
  const routes = createDevosSupervisorRoutes({
    rpc: async (name) => {
      if (name === 'devos_fleet_reconcile_v1') return { ok: true };
      if (name === 'devos_fleet_snapshot_v1') return { active_tasks: [], tasks: [], schema: 'metaengine.devos.fleet-coordination.v1' };
      if (name === 'devos_fleet_capacity_snapshot_v1') return { source: 'DEVOS_SCHEDULER_SNAPSHOT', available_slots: 4 };
      if (name === 'meta_orchestrator_controller_lease_v1') return { leased: false, leader_epoch: 1, expires_at: null, schema: 'metaengine.meta-orchestrator.controller-lease.v1', workspace_id: WORKSPACE, roadmap_id: 'metaengine-development-os-v1' };
      if (name === 'meta_orchestrator_plan_snapshot_v1') {
        return {
          found: true,
          roadmap_id: 'metaengine-development-os-v1',
          plan_generation: 1,
          state: 'ACTIVE',
          plan_spec: {
            schema: 'metaengine.meta-orchestrator.plan.v1',
            active_milestone_key: 'DEVOS_IDE_V1',
            objective: 'Operator objective',
            nodes: [{ point_id: 'a.v1' }],
          },
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    workspaceId: WORKSPACE,
    readRuntimeControl: async () => ({
      schema: 'metaengine.devos.environment-state.v1',
      state: 'OPEN',
      workspace_id: WORKSPACE,
      generation_floor: 28,
      refill_enabled: true,
      supervisor_admission_enabled: true,
      continuous_service_allowed: true,
      authoritative: true,
      automatic_retry_allowed: false,
      authority_effect: false,
    }),
  });
  const { status, body } = await call(routes, {
    path: '/v1/devos/cycle',
    body: {
      fleet: { agents: [] },
      planes: {
        fleet_generation_epochs: [28],
        mesh_epoch: 26,
        cognitive_stream: { stream_id: 'stream-9', acknowledged_through_sequence: 14430 },
      },
    },
  });
  assert.equal(status, 200);
  assert.equal(body.state, 'OPEN');
  assert.equal(body.work_graph.schema, 'metaengine.devos.work-graph.v1');
  assert.equal(body.work_graph.roadmap.objective, 'Operator objective');
  assert.equal(body.work_graph.planes.mesh_epoch, 26);
  assert.equal(body.work_graph.planes.cognitive_stream.acknowledged_through_sequence, 14430);
  assert.deepEqual(body.work_graph.planes.fleet_generation_epochs, [28]);
  assert.equal(body.work_graph.authority_effect, false);
});

// ---------------------------------------------------------------------------
// Client transport methods + shell wiring pins
// ---------------------------------------------------------------------------

test('supervisor client exposes devosResumeAdmission and metaObjectiveSet on the signed rail', async () => {
  const posted = [];
  const { NativeSupervisorClient } = await import('../src/native-supervisor-client-base.mjs');
  const identity = {
    ensure: async () => ({ device_id: 'device-1' }),
    deviceHeaders: async () => ({ 'x-test': 'signed' }),
    snapshot: () => ({}),
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl: async (url, init) => {
      posted.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ resumed: true, schema: 'metaengine.devos.environment-resume.v1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    getState: async () => ({}),
    executeCommand: async () => ({}),
    version: 'test',
  });
  const resumed = await client.devosResumeAdmission({ expected_generation_floor: 28 });
  assert.equal(resumed.resumed, true);
  assert.equal(posted.length, 1);
  assert.ok(posted[0].url.includes('/v1/devos/resume-admission'));
  assert.deepEqual(posted[0].body, { confirm: true, expected_generation_floor: 28 });

  posted.length = 0;
  const activation = await client.metaObjectiveSet({ objective: 'Ship it' });
  assert.equal(activation.resumed, true); // stub echoes the same body
  assert.ok(posted[0].url.includes('/v1/meta/objective'));
  assert.deepEqual(posted[0].body, { objective: 'Ship it' });

  // Floor validation fails BEFORE any transport.
  posted.length = 0;
  await assert.rejects(() => client.devosResumeAdmission({ expected_generation_floor: -1 }), /native_supervisor_devos_resume_floor_invalid/);
  await assert.rejects(() => client.devosResumeAdmission({ expected_generation_floor: 'x' }), /native_supervisor_devos_resume_floor_invalid/);
  await assert.rejects(() => client.devosResumeAdmission({ expected_generation_floor: 1.5 }), /native_supervisor_devos_resume_floor_invalid/);
  assert.equal(posted.length, 0);
});

test('shell wiring pins DEVOS_RESUME / DEVOS_OBJECTIVE_SET and the cycle planes stamp', async () => {
  const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /command === 'DEVOS_RESUME'/);
  assert.match(main, /nativeSupervisor\?\.devosResumeAdmission\(/);
  assert.match(main, /command === 'DEVOS_OBJECTIVE_SET'/);
  assert.match(main, /nativeSupervisor\?\.metaObjectiveSet\(/);
  const cycleCore = await fs.readFile(new URL('../src/devos-native-task-cycle-core.mjs', import.meta.url), 'utf8');
  assert.match(cycleCore, /planes: workGraphPlanes/);
  assert.match(cycleCore, /fleet_generation_epochs/);
  assert.match(cycleCore, /work_graph: plan\.work_graph/);
  const coreBase = await fs.readFile(new URL('../src/native-supervisor-client-core-base.mjs', import.meta.url), 'utf8');
  assert.match(coreBase, /work_graph_planes/);
});

test('runtime observability carries bounded agent toolbelt + work graph planes (remote live-check surface)', async () => {
  const { buildDevosRuntimeObservability } = await import('../src/devos-runtime-observability.mjs');
  const projection = buildDevosRuntimeObservability({
    devos_task_cycle: {
      agent_toolbelt: {
        state: 'READY',
        lease_count: 2,
        issued_command_count: 3,
        pending_command_count: 1,
        served_result_count: 2,
        counters: {
          requests_parsed: 3, requests_issued: 3, requests_unavailable: 0,
          results_terminal: 2, issue_errors: 0, route_unavailable_streak: 0,
        },
      },
      work_graph: {
        schema: 'metaengine.devos.work-graph.v1',
        roadmap: { roadmap_id: 'metaengine-development-os-v1', milestone: 'DEVOS_IDE_V1', plan_generation: 1, plan_state: 'ACTIVE', objective: 'Ship it', node_count: 2 },
        tasks: { ready: 1, running: 1 },
        claims: { leased_this_cycle: 1 },
      },
    },
  });
  assert.equal(projection.agent_toolbelt.state, 'READY');
  assert.equal(projection.agent_toolbelt.requests_issued, 3);
  assert.equal(projection.agent_toolbelt.pending_command_count, 1);
  assert.equal(projection.agent_toolbelt.authority_effect, false);
  assert.equal(projection.work_graph.roadmap.objective, 'Ship it');
  assert.equal(projection.work_graph.roadmap.plan_generation, 1);
  assert.equal(projection.work_graph.tasks.ready, 1);
  assert.equal(projection.work_graph.authority_effect, false);

  // Absent planes degrade to null without throwing.
  const empty = buildDevosRuntimeObservability({});
  assert.equal(empty.work_graph, null);
  assert.equal(empty.agent_toolbelt.state, null);
  assert.equal(empty.agent_toolbelt.requests_issued, null);

  // The edge state whitelist passes the rsi planes through boundedObject.
  const edge = await fs.readFile(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /if\('rsi'in s\)row\.rsi=boundedObject\(s\.rsi,16384\)/);
  assert.match(edge, /if\('rsi_outcome_river'in s\)row\.rsi_outcome_river=boundedObject\(s\.rsi_outcome_river,16384\)/);
  assert.match(edge, /if\('rsi_operator_steering'in s\)row\.rsi_operator_steering=boundedObject\(s\.rsi_operator_steering,16384\)/);
});
