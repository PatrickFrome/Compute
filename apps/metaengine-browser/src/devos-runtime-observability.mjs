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
