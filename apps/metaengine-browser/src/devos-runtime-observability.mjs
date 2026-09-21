const clip = (value, max = 240) => {
  const text = String(value ?? '');
  return text ? text.slice(0, max) : null;
};

const boolOrNull = (value) => typeof value === 'boolean' ? value : null;
const intOrNull = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : null;

function promotionProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ state: 'UNOBSERVED', authority_effect: false });
  }
  return Object.freeze({
    state: clip(value.state, 64) || 'UNKNOWN',
    reason: clip(value.reason, 240),
    agent_id: clip(value.agent_id, 96),
    tab_id: clip(value.tab_id, 96),
    target_id: clip(value.target_id, 96),
    agent_generation_epoch: intOrNull(value.agent_generation_epoch ?? value.generation_epoch),
    transport_stage: clip(value.transport_stage, 64),
    local_proof_state: clip(value.local_proof_state, 64),
    release_state: clip(value.release_state, 64),
    release_http_status: intOrNull(value.release_http_status),
    lease_observed: Boolean(value.lease_id),
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function buildDevosRuntimeObservability(snapshot = {}) {
  const idle = snapshot?.idle_background_work && typeof snapshot.idle_background_work === 'object'
    ? snapshot.idle_background_work
    : {};
  const lane = snapshot?.control_fast_lane && typeof snapshot.control_fast_lane === 'object'
    ? snapshot.control_fast_lane
    : {};
  const service = snapshot?.continuous_service && typeof snapshot.continuous_service === 'object'
    ? snapshot.continuous_service
    : {};
  const runtimeControl = service?.runtime_control && typeof service.runtime_control === 'object'
    ? service.runtime_control
    : {};
  const taskCycle = snapshot?.devos_task_cycle && typeof snapshot.devos_task_cycle === 'object'
    ? snapshot.devos_task_cycle
    : {};

  return Object.freeze({
    schema: 'metaengine.devos.runtime-observability.v1',
    scheduler_source: clip(snapshot?.devos_scheduler_source, 96),
    execution_mode: clip(snapshot?.devos_execution_mode, 64),
    last_error: clip(snapshot?.devos_last_error, 240),
    identity_enrolled: Boolean(snapshot?.identity?.device_id),
    idle: Object.freeze({
      in_flight: idle.in_flight === true,
      last_at: clip(idle.last_at, 64),
      last_error: clip(idle.last_error, 240),
      command_lease_precedes_idle_work: idle.command_lease_precedes_idle_work === true,
      read_only_can_overlap: idle.read_only_can_overlap === true,
      authority_effect: false,
    }),
    admission: Object.freeze({
      actuation_allowed: boolOrNull(service.actuation_allowed),
      runtime_control_state: clip(runtimeControl.state, 64),
      runtime_control_reason: clip(runtimeControl.reason, 160),
      generation_floor: intOrNull(runtimeControl.generation_floor),
      authoritative: boolOrNull(runtimeControl.authoritative),
      supervisor_admission_enabled: boolOrNull(runtimeControl.supervisor_admission_enabled),
      authority_effect: false,
    }),
    command_lane: Object.freeze({
      transport: clip(lane.transport, 64),
      last_batch_count: intOrNull(lane.last_batch_count),
      last_wait_batch_wake_reason: clip(lane.last_wait_batch_wake_reason, 120),
      last_wait_batch_elapsed_ms: intOrNull(lane.last_wait_batch_elapsed_ms),
      last_wait_batch_response_at: clip(lane.last_wait_batch_response_at, 64),
      maintenance_in_flight: lane.maintenance_in_flight === true,
      authority_effect: false,
    }),
    transport_promotion: promotionProjection(taskCycle.fleet_transport_promotion),
    // Root-surface dispatch-effect telemetry (2026-09-21): the lease→effect
    // bootstrap (conversation seed / poisoned-draft flush) and the dispatch
    // outcome ride the runtime plane so the operator console can see WHY a
    // leased task is not producing conversations. Bounded scalars only.
    dispatch: Object.freeze({
      last_state: clip(taskCycle.dispatch_effect?.last?.state, 64),
      last_stage: clip(taskCycle.dispatch_effect?.last?.stage, 16),
      last_effect_state: clip(taskCycle.dispatch_effect?.last?.effect_state, 48),
      last_reason: clip(taskCycle.dispatch_effect?.last?.reason, 160),
      last_task_id: clip(taskCycle.dispatch_effect?.last?.task_id, 96),
      last_agent_id: clip(taskCycle.dispatch_effect?.last?.agent_id, 96),
      last_at: clip(taskCycle.dispatch_effect?.last?.at, 64),
      last_composer_chars_before: intOrNull(taskCycle.dispatch_effect?.last?.composer_chars_before),
      dispatches: intOrNull(taskCycle.dispatch_effect?.counters?.dispatches),
      proven: intOrNull(taskCycle.dispatch_effect?.counters?.proven),
      ambiguous: intOrNull(taskCycle.dispatch_effect?.counters?.ambiguous),
      seed_attempts: intOrNull(taskCycle.dispatch_effect?.counters?.seed_attempts),
      seed_proven: intOrNull(taskCycle.dispatch_effect?.counters?.seed_proven),
      flush_over_limit: intOrNull(taskCycle.dispatch_effect?.counters?.flush_over_limit),
      authority_effect: false,
    }),
    // T2-5 addendum: the agent toolbelt and the unified work graph ride the
    // same bounded runtime-observability plane (supervisor_lifecycle is on
    // the edge state whitelist), giving the operator remote live evidence of
    // tool issue flow and the Objective→Task→Claim graph without any new
    // authority surface. Bounded counters only; no payloads.
    agent_toolbelt: Object.freeze({
      state: clip(taskCycle.agent_toolbelt?.state, 64),
      lease_count: intOrNull(taskCycle.agent_toolbelt?.lease_count),
      issued_command_count: intOrNull(taskCycle.agent_toolbelt?.issued_command_count),
      pending_command_count: intOrNull(taskCycle.agent_toolbelt?.pending_command_count),
      served_result_count: intOrNull(taskCycle.agent_toolbelt?.served_result_count),
      requests_parsed: intOrNull(taskCycle.agent_toolbelt?.counters?.requests_parsed),
      requests_issued: intOrNull(taskCycle.agent_toolbelt?.counters?.requests_issued),
      requests_unavailable: intOrNull(taskCycle.agent_toolbelt?.counters?.requests_unavailable),
      results_terminal: intOrNull(taskCycle.agent_toolbelt?.counters?.results_terminal),
      issue_errors: intOrNull(taskCycle.agent_toolbelt?.counters?.issue_errors),
      route_unavailable_streak: intOrNull(taskCycle.agent_toolbelt?.counters?.route_unavailable_streak),
      authority_effect: false,
    }),
    work_graph: taskCycle.work_graph && typeof taskCycle.work_graph === 'object' && !Array.isArray(taskCycle.work_graph)
      ? Object.freeze({
        schema: clip(taskCycle.work_graph.schema, 96),
        roadmap: Object.freeze({
          roadmap_id: clip(taskCycle.work_graph.roadmap?.roadmap_id, 160),
          milestone: clip(taskCycle.work_graph.roadmap?.milestone, 160),
          plan_generation: intOrNull(taskCycle.work_graph.roadmap?.plan_generation),
          plan_state: clip(taskCycle.work_graph.roadmap?.plan_state, 32),
          objective: clip(taskCycle.work_graph.roadmap?.objective, 480),
          node_count: intOrNull(taskCycle.work_graph.roadmap?.node_count),
        }),
        tasks: Object.freeze({
          ready: intOrNull(taskCycle.work_graph.tasks?.ready),
          running: intOrNull(taskCycle.work_graph.tasks?.running),
        }),
        claims: Object.freeze({
          leased_this_cycle: intOrNull(taskCycle.work_graph.claims?.leased_this_cycle),
        }),
        authority_effect: false,
      })
      : null,
    page_text_exposed: false,
    prompt_plaintext_exposed: false,
    raw_payload_exposed: false,
    lease_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function mergeDevosRuntimeObservability(lifecycle, runtimeProjection) {
  const base = lifecycle && typeof lifecycle === 'object' && !Array.isArray(lifecycle)
    ? structuredClone(lifecycle)
    : {};
  if (!runtimeProjection || runtimeProjection.schema !== 'metaengine.devos.runtime-observability.v1') {
    return Object.freeze(base);
  }
  return Object.freeze({ ...base, devos_runtime: structuredClone(runtimeProjection) });
}
