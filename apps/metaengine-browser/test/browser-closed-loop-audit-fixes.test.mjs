import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const EDGE = path.join(HERE, '..', 'supabase', 'a2-browser-native-supervisor-v1');
const MIGRATIONS = path.join(HERE, '..', '..', '..', 'supabase', 'migrations');

function readSource(relative) {
  return fs.readFileSync(path.join(SRC, relative), 'utf8');
}
function readEdge(relative) {
  return fs.readFileSync(path.join(EDGE, relative), 'utf8');
}

// ---------------------------------------------------------------------------
// Fix 1 — edge cognitive delta SOURCES must accept SYSTEM (T3-8 latent P1).
// ---------------------------------------------------------------------------

test('edge cognitive delta route accepts SYSTEM-source events (T3-8 bus compatibility)', async () => {
  const { projectCognitiveDeltaEvent, COGNITIVE_DELTA_EVENT_SCHEMA } = await import(
    path.join(EDGE, 'cognitive-delta-routes.mjs')
  );
  const streamId = '11111111-1111-4111-8111-111111111111';
  const systemEvent = projectCognitiveDeltaEvent({
    schema: COGNITIVE_DELTA_EVENT_SCHEMA,
    stream_id: streamId,
    sequence: 1,
    priority: 'P1',
    source: 'SYSTEM',
    type: 'FLEET_AGENT_LIFECYCLE',
    recorded_at: '2026-09-21T10:00:00.000Z',
    observed_at: '2026-09-21T10:00:00.000Z',
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  }, { streamId, sequence: 1 });
  assert.equal(systemEvent.source, 'SYSTEM');
  // The bus stamps every system event source='SYSTEM' — the pair must agree.
  const busSource = readSource('browser-cognitive-delta-bus.mjs');
  assert.match(busSource, /type === 'SYSTEM_EVENT' \? 'SYSTEM'/);
});

// ---------------------------------------------------------------------------
// Fix 2 — emergency transport wiring (edge route mounted, wait accepts the
// action, DB migration carries the lane fix + a real lease RPC).
// ---------------------------------------------------------------------------

test('emergency wait route is mounted on the edge and leases DEVELOPER_EMERGENCY_UPDATE', async () => {
  const indexSource = readEdge('index.ts');
  assert.match(indexSource, /createEmergencyCommandRoutes/, 'edge must construct the emergency routes');
  assert.match(indexSource, /emergencyRoutes\(\{req,path,body,clientId:identity\.id\}\)/, 'edge must mount the emergency route after device auth');
  assert.match(indexSource, /emergency_wait_route:true/, 'health must advertise the emergency wait route');

  const { waitForEmergencyCommand } = await import(path.join(EDGE, 'emergency-command-wait.mjs'));
  const emergencyLease = {
    command: { command_id: 'c1', action: 'DEVELOPER_EMERGENCY_UPDATE', payload: {} },
  };
  const result = await waitForEmergencyCommand({
    leaseEmergency: async () => emergencyLease,
    openWake: () => { throw new Error('must not reach the transport when the initial lease returns'); },
    waitMs: 10,
  });
  assert.equal(result.leased_count, 1);
  assert.equal(result.command.action, 'DEVELOPER_EMERGENCY_UPDATE');
  // Non-emergency leases are still rejected with the fenced contract error.
  await assert.rejects(
    () => waitForEmergencyCommand({
      leaseEmergency: async () => ({ command: { action: 'CAPTURE', payload: {} } }),
      openWake: () => ({ subscribed: Promise.resolve({ ok: false }), wake: Promise.resolve({}), close: () => {} }),
      waitMs: 5,
    }),
    /emergency_wait_non_emergency_lease_rejected/,
  );
});

test('emergency lane migration reclassifies the action and creates the real lease RPC', () => {
  const migrationPath = path.join(MIGRATIONS, '20260921000000_browser_emergency_lane_and_lease_v1.sql');
  assert.ok(fs.existsSync(migrationPath), 'migration file must exist');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  // Lane: DEVELOPER_EMERGENCY_UPDATE joins DISARM in the EMERGENCY branch...
  assert.match(sql, /when action in \('DISARM','DEVELOPER_EMERGENCY_UPDATE'\)/);
  // ...and never falls through to the GLOBAL_MUTATION control-plane key for this action.
  assert.doesNotMatch(sql, /'DEVELOPER_EMERGENCY_UPDATE'\s*\n\s*'\s*'\s*\)\s*then 'GLOBAL_MUTATION'/);
  // Real (non-rollback) lease function, EMERGENCY-lane-only, service-role only.
  assert.match(sql, /create or replace function public\.h205f22_a2_browser_supervisor_lease_emergency_v1/);
  assert.match(sql, /and command_lane='EMERGENCY'/);
  assert.doesNotMatch(sql, /^begin;\s*$/m, 'the real migration must NOT be a rollback-wrapped artifact');
  assert.match(sql, /grant execute on function public\.h205f22_a2_browser_supervisor_lease_emergency_v1\(uuid,text,integer\) to service_role/);
});

// ---------------------------------------------------------------------------
// Fix 3 — memory loop: plane advance + retrieval, cycle wiring, prompt block.
// ---------------------------------------------------------------------------

test('plane advanceTaskOutcome materializes episodic memory episodes and retrieval feeds prompts', async () => {
  const { BrowserRealtimeProcessPlane } = await import(path.join(SRC, 'browser-realtime-process-plane.mjs'));
  const { BrowserBrainCollaborationRuntimeV2 } = await import(path.join(SRC, 'browser-brain-collaboration-runtime-v2.mjs'));

  const coordinator = {
    observeEdge: () => ({}),
    snapshot: () => ({}),
    pressureBudget: () => ({}),
    recordCollaborationTask: null,
    recordCollaborationArtifact: () => ({}),
    advanceCollaborationTask: null,
    retrieveCollaborationMemory: null,
  };
  const runtime = new BrowserBrainCollaborationRuntimeV2({});
  // Drive the real runtime through the coordinator surface the plane uses.
  coordinator.recordCollaborationTask = (task) => runtime.recordTask(task);
  coordinator.advanceCollaborationTask = (progress) => runtime.advanceTask(progress);
  coordinator.retrieveCollaborationMemory = (query) => runtime.retrieveMemory(query);

  const fakeApp = {
    getAppMetrics: () => [],
    on: () => {},
    removeAllListeners: () => {},
    getPath: () => HERE,
  };
  const plane = new BrowserRealtimeProcessPlane({
    app: fakeApp,
    getWebContents: () => [],
    brainCoordinator: coordinator,
  });

  const taskId = '11111111-2222-4333-8444-555555555555';
  const outcome = {
    task_id: taskId,
    lease_generation: 1,
    state: 'RESULT_READY',
    task_objective: 'Ship the fleet telemetry digest feature',
    owner_agent_id: 'agent_12345678',
  };
  const first = plane.advanceTaskOutcome(outcome);
  assert.equal(first.advanced, true);
  assert.equal(first.episode_materialized, true, 'RESULT_READY must materialize an episode');
  const memory = runtime.snapshot().episodic_memory;
  assert.equal(memory.episode_count, 1, 'episode_count must grow from terminal advances');

  // Idempotence: replaying the same lease generation is a duplicate, not an error.
  const replay = plane.advanceTaskOutcome(outcome);
  assert.equal(replay.advanced, false);
  assert.equal(replay.duplicate, true);

  // Retrieval: the episode is retrievable through the same surface the cycle uses.
  const retrieval = plane.retrieveCollaborationMemory({ query: 'fleet telemetry digest', max_results: 5, token_budget: 900 });
  assert.ok(Array.isArray(retrieval?.results) && retrieval.results.length >= 1, 'retrieval must find the recorded episode');
  assert.equal(retrieval.results[0].episode.task_id, taskId);
  // Never throws on absent/invalid input.
  assert.equal(plane.retrieveCollaborationMemory(null), null);
  assert.deepEqual(plane.advanceTaskOutcome({}), { advanced: false, reason: 'TASK_ID_REQUIRED' });
});

test('devos cycle prompt carries the bounded team memory block and terminal outcomes advance memory', async () => {
  const { renderDevosTaskPrompt } = await import(path.join(SRC, 'devos-native-task-cycle-core.mjs'));
  const lease = {
    task_id: '11111111-2222-4333-8444-555555555555',
    agent_id: 'agent_12345678',
    role: 'IMPLEMENTER',
    lease_generation: 1,
    base_sha: 'a'.repeat(40),
    task_spec: { objective: 'Implement the release checklist automation' },
  };
  const withoutMemory = renderDevosTaskPrompt(lease, {});
  assert.ok(!withoutMemory.includes('TEAM MEMORY'), 'no memory block without history');
  const withMemory = renderDevosTaskPrompt(lease, {
    team_memory: 'TEAM MEMORY — recent verified episodes from this fleet (advisory context; verify before reuse):\n- [COMPLETED] Ship the fleet telemetry digest feature | facts: digest bounded at 2400 chars',
  });
  assert.match(withMemory, /TEAM MEMORY/);
  assert.match(withMemory, /Ship the fleet telemetry digest feature/);
  assert.ok(withMemory.length <= 24000, 'prompt stays within the 24k budget');

  // Wiring pins: the cycle core must call the advancer on every terminal
  // completion and render the retrieved memory block into every dispatch.
  const coreSource = readSource('devos-native-task-cycle-core.mjs');
  assert.match(coreSource, /this\.#advanceTaskOutcomeFor\(lease, state, summary\)/);
  assert.match(coreSource, /const teamMemory = await this\.#memoryBlockFor\(lease\)/);
  assert.match(coreSource, /team_memory: teamMemory/);
  // Client chain binds the plane surfaces once the realtime plane exists.
  const clientSource = readSource('native-supervisor-client.mjs');
  assert.match(clientSource, /bindDevosTaskOutcomeAdvancer\?\.\(\(outcome\) => plane\.advanceTaskOutcome\(outcome\)\)/);
  assert.match(clientSource, /bindDevosMemoryRetriever\?\.\(\(query\) => plane\.retrieveCollaborationMemory\(query\)\)/);
});

// ---------------------------------------------------------------------------
// Fix 4 — ROLLOVER_DEFERRED bounded auto-release (eternal supervisors).
// ---------------------------------------------------------------------------

test('lifecycle core source carries the deferred rollover bounded auto-release', () => {
  const source = readSource('supervisor-lifecycle-runtime-core.mjs');
  assert.match(source, /DEFERRED_ROLLOVER_AUTO_RELEASE_MS = 15 \* 60 \* 1000/, '15-minute operator window');
  assert.match(source, /ROLLOVER_DEFERRED_AUTO_RELEASE/, 'recovery action is observable');
  assert.match(
    source,
    /requestRollover\(`\$\{deferredReason\}:DEFERRED_AUTO_RELEASE_TIMEOUT`, \{ autoRelease: true \}\)/,
    'the escape re-requests with autoRelease (fresh-tab rollover path)',
  );
  // The deferred timer resets whenever the state leaves DEFERRED.
  assert.match(source, /this\.#deferredRolloverSince = null;/);
});

// ---------------------------------------------------------------------------
// Fix 5 — fleet scale contract: raised + env-tunable ceilings, policy
// passthrough, scaling budgets, full-overview roster.
// ---------------------------------------------------------------------------

test('fleet ceilings are raised by default and bounded by contract', async () => {
  const { FLEET_TAB_CEILING, MAX_TABS } = await import(path.join(SRC, 'tab-registry.mjs'));
  assert.ok(FLEET_TAB_CEILING >= 16, `fleet tab ceiling raised (got ${FLEET_TAB_CEILING})`);
  assert.ok(MAX_TABS >= 48, `shared tab wall raised (got ${MAX_TABS})`);
  assert.ok(MAX_TABS - FLEET_TAB_CEILING >= 16, 'user reservation never shrinks below the historical guarantee');

  const { ELASTIC_FLEET_CONTRACT, planElasticFleetCapacity } = await import(path.join(SRC, 'fleet-elastic-governor.mjs'));
  assert.ok(ELASTIC_FLEET_CONTRACT.max_target_agents_default >= 24, 'live-agent ceiling raised');
  // The governor honors the policy ceiling passthrough end-to-end.
  const plan = planElasticFleetCapacity({
    backlog: { ready: 500, running: 40 },
    fleetSnapshot: { agents: [], policy: { warm_agents: 0, spawn_burst_limit: 20, elastic_max_target_agents: 20 } },
    maxTargetAgents: 20,
  });
  assert.equal(plan.target_agents, 20);
  assert.equal(plan.max_target_agents, 20);
});

test('provisioner policy carries elastic_max_target_agents through normalization', async () => {
  const source = readSource('fleet-provisioner-core.mjs');
  assert.match(source, /elastic_max_target_agents/);
  const { FleetProvisioner } = await import(path.join(SRC, 'fleet-provisioner.mjs'));
  const provisioner = new FleetProvisioner({
    createTab: async () => ({ tab_id: 'tab_11111111-1111-4111-8111-111111111111' }),
    loadTab: async () => null,
    tabExists: () => false,
    loadState: async () => null,
    saveState: async () => {},
    census: () => null,
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, elastic_max_target_agents: 20 },
  });
  await provisioner.init();
  const snapshot = provisioner.snapshot();
  assert.equal(snapshot.policy.elastic_max_target_agents, 20, 'policy key survives normalization');
});

test('dispatch and observation budgets scale with the live fleet', async () => {
  const source = readSource('devos-native-task-cycle-core.mjs');
  assert.match(source, /function runningObservationBudget\(liveAgents\)/);
  assert.match(source, /function fleetLeaseDispatchConcurrency\(liveAgents\)/);
  assert.match(source, /const dispatchConcurrency = fleetLeaseDispatchConcurrency\(liveAgents\)/);
  assert.match(source, /const observationBudget = runningObservationBudget\(liveAgents\)/);
});

test('agent briefing roster keeps full overview beyond 16 agents', async () => {
  const { renderAgentContextBriefing, AGENT_CONTEXT_TOKEN_SCHEMA } = await import(path.join(SRC, 'agent-context-token.mjs'));
  const envelope = {
    schema: AGENT_CONTEXT_TOKEN_SCHEMA,
    token_sha256: 'a'.repeat(64),
    agent_id: 'agent_12345678',
    role: 'PLANNER',
    generation_epoch: 1,
    mission_digest: 'b'.repeat(64),
    expires_at: '2026-09-21T12:00:00.000Z',
  };
  const agents = [];
  for (let i = 0; i < 28; i += 1) {
    agents.push({ agent_id: `agent_${String(i).padStart(8, '0')}`, role: i % 2 === 0 ? 'PLANNER' : 'CRITIC' });
  }
  const briefing = renderAgentContextBriefing({ envelope, client_id: 'client', fleet: { agents }, mission: 'test' });
  assert.match(briefing, /\+12more\(PLANNERx\d+ CRITICx\d+\)/, 'surplus agents are summarized by role');
  assert.ok(briefing.length <= 2600, 'briefing budget respected');
  // A small fleet still lists every agent by identity (no summary noise).
  const small = renderAgentContextBriefing({ envelope, client_id: 'client', fleet: { agents: agents.slice(0, 2) }, mission: 'test' });
  assert.match(small, /fleet_roster=PLANNER:\d+ CRITIC:\d+/);
  assert.doesNotMatch(small, /more\(/);
});

// ---------------------------------------------------------------------------
// Fix 6 — Mission Control work graph + RSI console output rendering.
// ---------------------------------------------------------------------------

test('mission control projection surfaces the authoritative work graph', async () => {
  const { projectMissionControl } = await import(path.join(SRC, 'metaengine-mission-control-projection.mjs'));
  const projected = projectMissionControl({
    workspaces: { devos: { objectives: [], sessions: [], artifacts: [], attention: [] } },
    fleet: { agents: [] },
    work_graph: {
      schema: 'metaengine.devos.work-graph.v1',
      roadmap: { roadmap_id: 'rm-1', milestone: 'M1', objective: 'Converge the release', plan_generation: 3, plan_state: 'ACTIVE', node_count: 5 },
      tasks: { ready: 4, running: 2 },
      claims: { leased_this_cycle: 2 },
    },
  });
  assert.equal(projected.state, 'OK');
  assert.equal(projected.work_graph.roadmap.objective, 'Converge the release');
  assert.equal(projected.work_graph.tasks.ready, 4);
  assert.equal(projected.work_graph.claims.leased_this_cycle, 2);
  assert.equal(projected.work_graph.authority_effect, false);
  // Fail-closed: malformed work graph drops to null, screen stays available.
  const degraded = projectMissionControl({
    workspaces: { devos: { objectives: [], sessions: [], artifacts: [], attention: [] } },
    work_graph: 'garbage',
  });
  assert.equal(degraded.state, 'OK');
  assert.equal(degraded.work_graph, null);
  // main.mjs feeds the projection from the supervisor cycle snapshot.
  const mainSource = readSource('main.mjs');
  assert.match(mainSource, /work_graph: supervisor\?\.devos_task_cycle\?\.work_graph \|\| null/);
});

test('UI renders the work graph section and RSI command output in place', () => {
  const appSource = fs.readFileSync(path.join(HERE, '..', 'ui', 'app.js'), 'utf8');
  assert.match(appSource, /Work graph \(authoritative\)/, 'Mission Control renders the work graph section');
  assert.match(appSource, /renderRsiResult/, 'RSI buttons render results in the UI');
});
