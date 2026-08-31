import { loadSelfUpdateSessionContinuity } from './self-update-session-continuity.mjs';
import { qualifyUpdatedSuccessor } from './self-update-handoff.mjs';
import { quarantineSelfUpdateTransaction, readSelfUpdateTransaction } from './self-update-transaction-journal.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HARD_CONTINUITY_FAILURES = new Set(['PARTIAL', 'ERROR', 'TARGET_VERSION_MISMATCH']);
const MAX_SENTINEL_HEARTBEAT_AGE_MS = 8_000;
let acceptedHeartbeatHealth = null;

function normalized(value) {
  return String(value || '').trim().toUpperCase();
}

export async function recordAcceptedSignedSupervisorHeartbeat({ app, state, acceptedAtMs = Date.now() } = {}) {
  if (!app || typeof app.getVersion !== 'function') throw new Error('self_update_heartbeat_app_invalid');
  const version = String(app.getVersion() || '');
  const transaction = await readSelfUpdateTransaction(app).catch(() => null);
  if (!transaction || transaction.state !== 'SUCCESSOR_BOOTED' || transaction.target_version !== version) {
    acceptedHeartbeatHealth = null;
    return { state: 'NOT_PENDING', authority_effect: false };
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || String(state.shell_version || '') !== version) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_VERSION_MISMATCH', authority_effect: false };
  }

  const continuityState = normalized(state.self_update_session_continuity?.state);
  if (HARD_CONTINUITY_FAILURES.has(continuityState)) {
    acceptedHeartbeatHealth = null;
    await quarantineSelfUpdateTransaction(app, `session_continuity_${continuityState.toLowerCase()}`);
    return { state: 'QUARANTINED', reason: `session_continuity_${continuityState.toLowerCase()}`, authority_effect: false };
  }
  if (continuityState !== 'RESTORED') {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_CONTINUITY_NOT_RESTORED', continuity_state: continuityState || null, authority_effect: false };
  }

  const updater = state.self_update;
  if (!updater || typeof updater !== 'object' || Array.isArray(updater) || String(updater.current_version || '') !== version) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_UPDATER_NOT_BOUND', authority_effect: false };
  }
  if ((updater.last_error != null && String(updater.last_error).trim() !== '') || ['ERROR','FAILED'].includes(normalized(updater.state))) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_UPDATER_UNHEALTHY', authority_effect: false };
  }
  const resilience = updater.host_resilience;
  const sentinel = resilience?.sentinel;
  const sentinelHeartbeatAge = Number(sentinel?.worker_heartbeat_age_ms);
  const sentinelHealthy = normalized(resilience?.state) === 'ACTIVE'
    && resilience?.sentinel_worker_healthy === true
    && normalized(sentinel?.lifecycle) === 'ARMED'
    && sentinel?.worker_ready === true
    && Number.isFinite(sentinelHeartbeatAge)
    && sentinelHeartbeatAge >= 0
    && sentinelHeartbeatAge <= MAX_SENTINEL_HEARTBEAT_AGE_MS;
  if (!sentinelHealthy) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_RESILIENCE_NOT_READY', authority_effect: false };
  }

  acceptedHeartbeatHealth = Object.freeze({
    version,
    accepted_at_ms: Number(acceptedAtMs),
    signed_heartbeat_accepted: true,
    session_continuity_restored: true,
    self_update_runtime_healthy: true,
    host_resilience_active: true,
    sentinel_armed: true,
    sentinel_worker_healthy: true,
    sentinel_worker_heartbeat_age_ms: sentinelHeartbeatAge,
    authority_effect: false,
  });
  return { state: 'HEARTBEAT_HEALTHY', ...acceptedHeartbeatHealth };
}

export function acceptedSignedSupervisorHeartbeatSnapshot() {
  return acceptedHeartbeatHealth ? structuredClone(acceptedHeartbeatHealth) : null;
}

export async function probeUpdatedSuccessorQualification({
  app,
  userDataPath = null,
  uptimeMs = () => Math.round(process.uptime() * 1000),
  minUptimeMs = 3000,
  nowMs = () => Date.now(),
  maxHeartbeatAgeMs = 10_000,
} = {}) {
  if (!app || typeof app.getVersion !== 'function' || typeof app.hasSingleInstanceLock !== 'function') {
    throw new Error('self_update_qualification_app_invalid');
  }
  const transaction = await readSelfUpdateTransaction(app);
  if (!transaction || transaction.state !== 'SUCCESSOR_BOOTED') {
    return { state: 'NOT_PENDING', transaction_state: transaction?.state || null, authority_effect: false };
  }
  const version = String(app.getVersion() || '');
  if (version !== transaction.target_version) throw new Error('self_update_qualification_target_mismatch');
  if (app.hasSingleInstanceLock() !== true) {
    return { state: 'PENDING_SINGLETON', target_version: version, authority_effect: false };
  }
  const age = Math.max(0, Number(uptimeMs()) || 0);
  if (age < Math.max(1000, Number(minUptimeMs) || 3000)) {
    return { state: 'PENDING_UPTIME', target_version: version, uptime_ms: age, authority_effect: false };
  }
  const userData = userDataPath || app.getPath?.('userData');
  if (!userData) throw new Error('self_update_qualification_user_data_missing');
  const continuity = await loadSelfUpdateSessionContinuity(userData);
  if (continuity) {
    return {
      state: 'PENDING_CONTINUITY',
      target_version: version,
      pending_tab_count: Array.isArray(continuity.tabs) ? continuity.tabs.length : null,
      authority_effect: false,
    };
  }

  const heartbeat = acceptedHeartbeatHealth;
  const heartbeatAge = heartbeat ? Math.max(0, Number(nowMs()) - Number(heartbeat.accepted_at_ms)) : null;
  if (!heartbeat || heartbeat.version !== version || heartbeatAge > Math.max(2000, Number(maxHeartbeatAgeMs) || 10_000)) {
    return {
      state: 'PENDING_SIGNED_HEARTBEAT',
      target_version: version,
      heartbeat_age_ms: heartbeatAge,
      authority_effect: false,
    };
  }

  const qualified = await qualifyUpdatedSuccessor(app, {
    primary_instance: true,
    persistent_profile: true,
    session_continuity_cleared: true,
    process_uptime_ms: age,
    signed_heartbeat_accepted: true,
    self_update_runtime_healthy: true,
    host_resilience_active: true,
    sentinel_armed: true,
    sentinel_worker_healthy: true,
    sentinel_worker_heartbeat_age_ms: heartbeat.sentinel_worker_heartbeat_age_ms,
    heartbeat_age_ms: heartbeatAge,
  });
  acceptedHeartbeatHealth = null;
  return { state: 'QUALIFIED', transaction: qualified, authority_effect: false };
}

export async function qualifyUpdatedSuccessorWhenHealthy({
  app,
  timeoutMs = 30_000,
  pollMs = 1000,
  minUptimeMs = 3000,
  uptimeMs = () => Math.round(process.uptime() * 1000),
} = {}) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 30_000);
  let last = null;
  while (Date.now() <= deadline) {
    last = await probeUpdatedSuccessorQualification({ app, uptimeMs, minUptimeMs });
    if (['QUALIFIED','NOT_PENDING','QUARANTINED'].includes(last.state)) return last;
    await sleep(Math.max(100, Number(pollMs) || 1000));
  }
  return { ...(last || {}), state: 'QUALIFICATION_PENDING_TIMEOUT', authority_effect: false };
}
