// T3-10 Mission Control main screen: one read-only projection that joins the
// DevOS work graph (objectives -> tasks), the agent fleet, the live system
// effect tail (cognitive bus system deltas), artifacts, and cross-plane
// epochs. Presentation-only, fails closed, zero authority anywhere.

export const MISSION_CONTROL_SCHEMA = 'metaengine.browser-shell.mission-control.v1';

const clip = (value, max = 240) => value == null ? null : String(value).slice(0, max);

function safeArray(value, max) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max);
}

function zeroAuthority() {
  return Object.freeze({
    page_data_authority: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function projectAgents(fleet) {
  return Object.freeze(safeArray(fleet?.agents, 64).map((row) => Object.freeze({
    agent_id: clip(row?.agent_id, 160),
    role: clip(row?.role, 96),
    lifecycle_state: clip(row?.lifecycle_state, 48),
    tab_id: clip(row?.tab_id, 96),
    target_id: clip(row?.target_id, 160),
    generation_epoch: Number.isSafeInteger(Number(row?.generation_epoch)) ? Number(row.generation_epoch) : null,
    ...zeroAuthority(),
  })).filter((row) => Boolean(row.agent_id)));
}

function projectObjectives(devos) {
  return Object.freeze(safeArray(devos?.objectives, 32).map((row) => Object.freeze({
    objective_id: clip(row?.objective_id, 160),
    context_id: clip(row?.context_id, 160),
    title: clip(row?.title, 600),
    status: clip(row?.status, 48),
    session_ids: Object.freeze(safeArray(row?.session_ids, 16).map((value) => clip(value, 160)).filter(Boolean)),
    attention_count: Number.isSafeInteger(Number(row?.attention_count)) ? Number(row.attention_count) : 0,
    ...zeroAuthority(),
  })).filter((row) => Boolean(row.objective_id)));
}

function projectTasks(devos) {
  const tasks = [];
  for (const session of safeArray(devos?.sessions, 64)) {
    for (const task of safeArray(session?.tasks, 64)) {
      tasks.push(Object.freeze({
        task_id: clip(task?.task_id, 160),
        objective: clip(task?.objective, 600),
        status: clip(task?.status, 48) || 'UNKNOWN',
        owner_agent_id: clip(task?.owner_agent_id, 160),
        blocker: clip(task?.blocker, 600),
        updated_at: clip(task?.updated_at, 80),
        session_id: clip(session?.session_id, 160),
        ...zeroAuthority(),
      }));
    }
  }
  return Object.freeze(tasks.slice(0, 128));
}

function projectArtifacts(devos) {
  return Object.freeze(safeArray(devos?.artifacts, 64).map((row) => Object.freeze({
    artifact_id: clip(row?.artifact_id, 240),
    objective_id: clip(row?.objective_id, 160),
    session_id: clip(row?.session_id, 160),
    ref: clip(row?.ref, 240),
    kind: clip(row?.kind, 96),
    immutable_reference: true,
    ...zeroAuthority(),
  })).filter((row) => Boolean(row.artifact_id || row.ref)));
}

function projectAttention(devos) {
  return Object.freeze(safeArray(devos?.attention, 32).map((row) => Object.freeze({
    kind: clip(row?.kind, 64),
    severity: clip(row?.severity, 32),
    priority: clip(row?.priority, 32),
    objective_id: clip(row?.objective_id, 160),
    task_id: clip(row?.task_id, 160),
    title: clip(row?.title, 600),
    reason: clip(row?.reason, 600),
    ...zeroAuthority(),
  })));
}

function projectEffects(systemDeltaTail) {
  return Object.freeze(safeArray(systemDeltaTail, 32).map((row) => Object.freeze({
    system_kind: clip(row?.system_kind, 96),
    subject_id: clip(row?.subject_id, 160),
    detail: clip(row?.detail, 240),
    observed_at: clip(row?.observed_at, 64),
    ...zeroAuthority(),
  })));
}

// Closed-loop audit fix (Mission Control honesty): the T2-5 unified Work
// Graph projection (roadmap authority row + compiled plan + backlog + claims)\n// was computed on every cycle but rendered NOWHERE — Mission Control's hero
// claimed to be the unified work graph while projecting only the fabric
// workbench. This projection surfaces the authoritative work graph next to
// the workbench view. Fails closed: malformed shapes drop to null.
function projectWorkGraph(workGraph) {
  if (!workGraph || typeof workGraph !== 'object' || Array.isArray(workGraph)) return null;
  const roadmap = workGraph.roadmap && typeof workGraph.roadmap === 'object' && !Array.isArray(workGraph.roadmap)
    ? workGraph.roadmap
    : null;
  const tasks = workGraph.tasks && typeof workGraph.tasks === 'object' && !Array.isArray(workGraph.tasks)
    ? workGraph.tasks
    : {};
  const claims = workGraph.claims && typeof workGraph.claims === 'object' && !Array.isArray(workGraph.claims)
    ? workGraph.claims
    : {};
  const nodes = Array.isArray(workGraph.nodes) ? workGraph.nodes : null;
  return Object.freeze({
    schema: clip(workGraph.schema, 96) || 'metaengine.devos.work-graph.v1',
    roadmap: roadmap ? Object.freeze({
      roadmap_id: clip(roadmap.roadmap_id, 160),
      milestone: clip(roadmap.milestone, 160),
      objective: clip(roadmap.objective, 480),
      plan_generation: Number.isSafeInteger(Number(roadmap.plan_generation)) ? Number(roadmap.plan_generation) : null,
      plan_state: clip(roadmap.plan_state, 32),
      node_count: Number.isSafeInteger(Number(roadmap.node_count)) ? Number(roadmap.node_count) : null,
    }) : null,
    nodes: nodes ? Object.freeze(safeArray(nodes, 64).map((row) => Object.freeze({
      node_id: clip(row?.node_id ?? row?.id, 160),
      title: clip(row?.title ?? row?.objective, 480),
      state: clip(row?.state ?? row?.status, 48),
      risk: clip(row?.risk, 32),
      ...zeroAuthority(),
    })).filter((row) => Boolean(row.node_id))) : null,
    tasks: Object.freeze({
      ready: Number.isSafeInteger(Number(tasks.ready)) ? Number(tasks.ready) : null,
      running: Number.isSafeInteger(Number(tasks.running)) ? Number(tasks.running) : null,
    }),
    claims: Object.freeze({
      leased_this_cycle: Number.isSafeInteger(Number(claims.leased_this_cycle)) ? Number(claims.leased_this_cycle) : null,
    }),
    ...zeroAuthority(),
  });
}

export function projectMissionControl({
  workspaces = null,
  fleet = null,
  supervisor = null,
  system_delta_tail = null,
  compute = null,
  work_graph = null,
} = {}) {
  const devos = workspaces && typeof workspaces === 'object' ? workspaces.devos : null;
  if (!devos) {
    return Object.freeze({
      schema: MISSION_CONTROL_SCHEMA,
      state: 'UNAVAILABLE',
      reason: 'DEVOS_PROJECTION_NOT_READY',
      objectives: Object.freeze([]),
      tasks: Object.freeze([]),
      agents: Object.freeze([]),
      effects: Object.freeze([]),
      artifacts: Object.freeze([]),
      attention: Object.freeze([]),
      work_graph: null,
      epochs: null,
      counts: Object.freeze({ objectives: 0, tasks: 0, agents: 0, effects: 0, artifacts: 0, attention: 0 }),
      ...zeroAuthority(),
    });
  }
  const objectives = projectObjectives(devos);
  const tasks = projectTasks(devos);
  const agents = projectAgents(fleet);
  const artifacts = projectArtifacts(devos);
  const attention = projectAttention(devos);
  const effects = projectEffects(system_delta_tail);
  const workGraph = projectWorkGraph(work_graph);
  const counts = Object.freeze({
    objectives: objectives.length,
    tasks: tasks.length,
    agents: agents.length,
    effects: effects.length,
    artifacts: artifacts.length,
    attention: attention.length,
  });
  return Object.freeze({
    schema: MISSION_CONTROL_SCHEMA,
    state: 'OK',
    objectives,
    tasks,
    agents,
    effects,
    artifacts,
    attention,
    work_graph: workGraph,
    epochs: Object.freeze({
      fleet_generation_epochs: Object.freeze([...new Set(agents
        .map((row) => row.generation_epoch)
        .filter((epoch) => Number.isSafeInteger(epoch) && epoch > 0))].sort((a, b) => a - b)),
      mesh_epoch: Number.isSafeInteger(Number(supervisor?.mesh_epoch)) && Number(supervisor.mesh_epoch) > 0
        ? Number(supervisor.mesh_epoch)
        : null,
      cognitive_stream: supervisor?.cognitive_stream && typeof supervisor.cognitive_stream === 'object'
        ? Object.freeze({
            stream_id: clip(supervisor.cognitive_stream.stream_id, 160),
            acknowledged_through_sequence: Number.isSafeInteger(Number(supervisor.cognitive_stream.acknowledged_through_sequence))
              ? Number(supervisor.cognitive_stream.acknowledged_through_sequence)
              : 0,
          })
        : null,
      compute_state: clip(compute?.state, 48),
    }),
    counts,
    ...zeroAuthority(),
  });
}
