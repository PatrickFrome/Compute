import { buildSupervisorLifecycleStatusSnapshot } from './supervisor-lifecycle-runtime.mjs';
import { buildDevosRuntimeObservability, mergeDevosRuntimeObservability } from './devos-runtime-observability.mjs';

export const CLIENT_WORK_READINESS_SCHEMA = 'metaengine.client.work-readiness.v1';
const SHA256 = /^[a-f0-9]{64}$/i;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

// One observation projection of the existing owners. No polling, commands,
// admission mutations, page content, keys or alternate execution authority.
export function projectNativeRuntimeObservation(snapshot = {}, version = null) {
  return Object.freeze({
    shell_version: version,
    started_at: snapshot.started_at || null,
    heartbeat_at: snapshot.last_heartbeat_at || null,
    supervisor_lifecycle: mergeDevosRuntimeObservability(
      buildSupervisorLifecycleStatusSnapshot(snapshot.lifecycle || {}),
      buildDevosRuntimeObservability(snapshot),
    ),
    control_latency: Object.freeze({ fast_lane: snapshot.control_fast_lane || null, authority_effect: false }),
  });
}

function hasExactAgentOrigin(agent) {
  const proof = agent?.transport_proof;
  return agent?.lifecycle_state === 'ACTIVE'
    && typeof agent.tab_id === 'string' && agent.tab_id.length > 0
    && typeof agent.target_id === 'string' && agent.target_id.length > 0
    && proof?.tab_id === agent.tab_id
    && proof?.target_id === agent.target_id
    && Number.isSafeInteger(agent.generation_epoch) && agent.generation_epoch > 0
    && proof?.generation_epoch === agent.generation_epoch
    && SHA256.test(String(proof?.agent_surface_sha256 || ''))
    && SHA256.test(String(proof?.conversation_url_sha256 || ''));
}

export function projectClientWorkReadiness({ connection = {}, snapshot = {}, fleet = {}, development = {}, guardian = {}, isCurrentBinding = () => false, now = Date.now() } = {}) {
  const runtime = snapshot.continuous_service?.runtime_control || {};
  const keepalive = snapshot.lifecycle?.keepalive || {};
  const heartbeatMs = Date.parse(snapshot.last_heartbeat_at || '');
  const heartbeatFresh = Number.isFinite(heartbeatMs) && now >= heartbeatMs - 5_000 && now - heartbeatMs <= 30_000;
  const agents = Array.isArray(fleet.agents) ? fleet.agents : [];
  const provenAgents = agents.filter((agent) => hasExactAgentOrigin(agent) && isCurrentBinding({
    tab_id: agent.tab_id, target_id: agent.target_id,
    conversation_url_sha256: agent.transport_proof.conversation_url_sha256,
  }));
  const implementers = provenAgents.filter((agent) => agent.role === 'IMPLEMENTER');
  const independentVerifier = provenAgents.some((agent) => agent.role === 'CRITIC'
    && implementers.some((worker) => worker.target_id !== agent.target_id && worker.agent_id !== agent.agent_id));
  let state = 'BLOCKED';
  let reason;
  let label;
  let detail;
  if (connection.local_runtime_ready !== true) {
    reason = 'LOCAL_RUNTIME_STARTING'; label = 'Starting'; detail = 'Native Browser is starting.';
  } else if (connection.admin_ready !== true || connection.cloud_control_state !== 'CONNECTED') {
    reason = 'ADMIN_CONNECTION_UNAVAILABLE'; label = 'Reconnecting'; detail = 'Waiting for the Native Supervisor connection.';
  } else if (!heartbeatFresh) {
    reason = 'HEARTBEAT_READBACK_STALE'; label = 'Status unavailable'; detail = 'The last accepted heartbeat is unavailable or stale.';
  } else if (snapshot.supervisor_mode !== 'CONTROL' || snapshot.armed !== true) {
    reason = 'NATIVE_CONTROL_NOT_ARMED'; label = 'Control unavailable'; detail = 'Native control must be armed before dispatch.';
  } else if (runtime.authoritative !== true || runtime.authority_effect !== false) {
    reason = runtime.reason === 'GENERATION_FLOOR_REGRESSION' ? 'GENERATION_FLOOR_REGRESSION' : 'WORKSPACE_AUTHORITY_UNAVAILABLE';
    label = 'Recovery required'; detail = 'Workspace authority must be reconciled before execution can continue.';
  } else if (count(runtime.generation_floor) === null || count(keepalive.admission_generation_floor) === null
    || runtime.generation_floor < keepalive.admission_generation_floor) {
    reason = 'GENERATION_FLOOR_REGRESSION'; label = 'Recovery required'; detail = 'Workspace generation does not match the durable profile.';
  } else if (runtime.state !== 'OPEN' || runtime.continuous_service_allowed !== true
    || runtime.refill_enabled !== true || runtime.supervisor_admission_enabled !== true) {
    state = 'PAUSED'; reason = 'WORKSPACE_EXECUTION_PAUSED'; label = 'Execution paused'; detail = 'Workspace execution is paused. Queued work will not run.';
  } else if (keepalive.admission_state !== 'OPEN') {
    reason = 'SUPERVISOR_ADMISSION_NOT_OBSERVED'; label = 'Recovery required'; detail = 'Supervisor admission has not reconciled with workspace authority.';
  } else if (snapshot.continuous_service?.actuation_allowed !== true) {
    reason = 'NATIVE_CONTROL_NOT_ARMED'; label = 'Control unavailable'; detail = 'Native actuation is held. Dispatch cannot proceed.';
  } else if (!['WAITING', 'GENERATING', 'DONE'].includes(keepalive.state)
    || typeof keepalive.conversation_url !== 'string' || !keepalive.conversation_url
    || !isCurrentBinding({ tab_id: keepalive.tab_id, conversation_url: keepalive.conversation_url })) {
    reason = 'SUPERVISOR_RECOVERY_REQUIRED'; label = 'Recovery required'; detail = 'The Supervisor needs a verified conversation recovery before dispatch.';
  } else if (provenAgents.length === 0) {
    reason = 'AGENT_ORIGIN_UNVERIFIED'; label = 'Agents unverified'; detail = 'No active Agent session has matching origin and generation evidence.';
  } else {
    state = 'READY'; reason = null; label = 'Chats ready'; detail = 'Chat dispatch is ready. Coding and continuous autonomy have separate readiness requirements.';
  }
  const backendReady = development.schema === 'metaengine.development-plane.snapshot.v1'
    && development.state === 'READY' && development.sandbox_backend_bound === true
    && development.verification_sandbox_execution === true && development.verification_sandbox_prepare_only === false
    && development.candidate_capsules_executable === true;
  const expires = Date.parse(guardian.expires_at || '');
  const observed = Date.parse(guardian.observed_at || '');
  const guardianReady = guardian.schema === 'metaengine.browser-guardian.machine-bootstrap-launcher.v1'
    && guardian.state === 'READY' && guardian.ready === true && guardian.stale === false
    && Number.isFinite(expires) && Number.isFinite(observed) && observed <= now + 5_000 && expires > now
    && guardian.guardian_service_ready === true && guardian.owner_binding_proven === true
    && guardian.device_binding_proven === true && guardian.authority_effect === false;
  const capability = (ready, blockedReason) => Object.freeze({ ready, reason: ready ? null : blockedReason });
  const codingReady = state === 'READY' && backendReady && implementers.length > 0;
  const codingReason = state !== 'READY' ? reason : !backendReady ? 'CODING_BACKEND_NOT_EXECUTABLE' : 'IMPLEMENTER_ORIGIN_UNVERIFIED';
  const autonomyReady = codingReady && guardianReady && independentVerifier;
  const capabilities = Object.freeze({
    chat_dispatch: capability(state === 'READY', reason),
    coding_execution: capability(codingReady, codingReason),
    host_continuity: capability(guardianReady, 'GUARDIAN_CONTINUITY_NOT_PROVEN'),
    continuous_autonomy: capability(autonomyReady, !codingReady ? codingReason
      : !guardianReady ? 'GUARDIAN_CONTINUITY_NOT_PROVEN' : 'INDEPENDENT_VERIFIER_UNAVAILABLE'),
  });
  return Object.freeze({
    schema: CLIENT_WORK_READINESS_SCHEMA,
    observed_at: new Date(now).toISOString(),
    state, reason, label, detail,
    execution_ready: state === 'READY',
    readiness_scope: 'CHAT_DISPATCH',
    capabilities,
    continuous_autonomy_ready: autonomyReady,
    heartbeat_fresh: heartbeatFresh,
    generation_floor: count(runtime.generation_floor),
    local_generation_floor: count(keepalive.admission_generation_floor),
    supervisor_state: typeof keepalive.state === 'string' ? keepalive.state.slice(0, 48) : null,
    supervisor_cycle_seq: count(keepalive.cycle_seq),
    proven_agent_count: provenAgents.length,
    active_agent_count: agents.filter((agent) => agent.lifecycle_state === 'ACTIVE').length,
    bound_unverified_agent_count: agents.filter((agent) => agent.lifecycle_state === 'BOUND_UNVERIFIED').length,
    ambiguous_agent_count: agents.filter((agent) => agent.lifecycle_state === 'PROVISIONING_AMBIGUOUS').length,
    useful_work_verified: false,
    verified_self_improvement: false,
    recovery_effect_exposed: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
