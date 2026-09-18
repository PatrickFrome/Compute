import { loadSelfUpdateSessionContinuity } from './self-update-session-continuity.mjs';
import { qualifyUpdatedSuccessor } from './self-update-handoff.mjs';
import { compareVersions } from './self-update-handoff.mjs';
import { reconcileStaleSelfUpdateSessionContinuity } from './self-update-continuity-watchdog.mjs';
import {
  quarantineSelfUpdateTransaction,
  readSelfUpdateTransaction,
  reopenQuarantinedSelfUpdateTransactionForRequalification,
} from './self-update-transaction-journal.mjs';
import {
  recordSelfUpdateRecoveryQualificationResult,
  recordSelfUpdateRecoveryQuarantineResult,
  recordSelfUpdateRecoveryQuarantineReopenResult,
  selfUpdateRecoveryDiagnosticSnapshot,
} from './self-update-successor-recovery.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Qualification V2 (P0 repair, point 5): AUTH_REQUIRED is a hard continuity
// failure — the successor booted but the user session it promised to preserve
// is gone (auth redirect observed during/after restore). A transaction whose
// install destroyed the user session must quarantine fail-closed instead of
// reporting PROCESS_HEALTHY as if nothing happened.
const HARD_CONTINUITY_FAILURES = new Set(['PARTIAL', 'ERROR', 'TARGET_VERSION_MISMATCH', 'AUTH_REQUIRED']);
const MAX_SENTINEL_HEARTBEAT_AGE_MS = 8_000;
const UNRESOLVED_PRIOR_SUCCESSOR_BOOTED = 'self_update_transaction_unresolved_prior:SUCCESSOR_BOOTED';
let acceptedHeartbeatHealth = null;

function normalized(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizedGitSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  return sha || null;
}

function exactRecoveryTransaction(transaction, recovery) {
  if (!recovery || recovery.state !== 'TARGET_INSTALLED_PENDING_QUALIFICATION') return true;
  if (!transaction || String(transaction.transaction_id || '') !== String(recovery.transaction_id || '')) return false;
  if (String(transaction.target_version || '') !== String(recovery.target_version || '')) return false;
  const expectedGitSha = normalizedGitSha(recovery.target_git_sha);
  if (expectedGitSha && normalizedGitSha(transaction.resolved_git_sha) !== expectedGitSha) return false;
  return transaction.authority_effect === false && transaction.automatic_retry_allowed === false;
}

function recoveryBindingDrift(transaction, recovery) {
  return {
    state: 'RECOVERY_TRANSACTION_BINDING_DRIFT',
    expected_transaction_id: recovery?.transaction_id || null,
    observed_transaction_id: transaction?.transaction_id || null,
    target_version: recovery?.target_version || transaction?.target_version || null,
    authority_effect: false,
  };
}

export async function recordAcceptedSignedSupervisorHeartbeat({ app, state, acceptedAtMs = Date.now() } = {}) {
  if (!app || typeof app.getVersion !== 'function') throw new Error('self_update_heartbeat_app_invalid');
  const version = String(app.getVersion() || '');
  const transaction = await readSelfUpdateTransaction(app).catch(() => null);
  const recovery = selfUpdateRecoveryDiagnosticSnapshot();
  if (!exactRecoveryTransaction(transaction, recovery)) {
    acceptedHeartbeatHealth = null;
    return recoveryBindingDrift(transaction, recovery);
  }
  if (!transaction || transaction.state !== 'SUCCESSOR_BOOTED' || transaction.target_version !== version) {
    // D-Q1 liveness repair: a QUARANTINED transaction whose ONLY failure was
    // session-continuity auth loss used to be a permanent dead end — the
    // quarantine latched forever even after the user logged back in, and the
    // updater stayed blocked (unresolved_prior:QUARANTINED) until a human ran
    // an installer by hand. When the CURRENT heartbeat carries positive
    // metadata-only auth evidence (the supervisor maintenance lane refreshes
    // the continuity projection once auth is restored), reopen the exact
    // transaction and resume the normal fail-closed qualification pipeline.
    // This is NOT a retry of a failed effect: the install physically
    // succeeded, and a wrong heal simply re-quarantines on the next beat.
    if (
      transaction?.state === 'QUARANTINED'
      && version
      && transaction.target_version === version
      && String(transaction.evidence?.quarantine_reason || '') === 'session_continuity_auth_required'
    ) {
      const continuity = state?.self_update_session_continuity;
      const healedAuth = String(continuity?.auth_readback_state || '').toUpperCase() === 'AUTHENTICATED'
        && String(continuity?.user_session_continuity || '').toUpperCase() !== 'LOST';
      if (healedAuth) {
        const reopened = await reopenQuarantinedSelfUpdateTransactionForRequalification(app, {
          reason: 'session_continuity_auth_required_healed',
          healedEvidence: {
            auth_readback_state: 'AUTHENTICATED',
            user_session_continuity: String(continuity?.user_session_continuity || '').toUpperCase() || null,
            chatgpt_tab_count: Number(continuity?.auth_heal_chatgpt_tab_count ?? continuity?.tab_count ?? 0) || 0,
            authenticated_tab_count: Number(continuity?.auth_heal_authenticated_tab_count ?? 0) || 0,
            metadata_only: true,
            cookie_values_read: false,
          },
          requireTargetVersion: version,
        }).catch(() => null);
        if (reopened?.state === 'SUCCESSOR_BOOTED' && reopened?.evidence?.quarantine_reopened === true) {
          recordSelfUpdateRecoveryQuarantineReopenResult(reopened);
          if (!globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__) {
            startSuccessorQualificationReprobeLoop({
              app,
              onResult: (row) => console.log(JSON.stringify({
                schema: 'metaengine.browser.self-update-qualification-reprobe.v1',
                version,
                origin: 'quarantine_auth_heal',
                ...row,
                authority_effect: false,
              })),
              onError: (error) => console.error(JSON.stringify({
                schema: 'metaengine.browser.self-update-qualification-reprobe.v1',
                version,
                origin: 'quarantine_auth_heal',
                state: 'REPROBE_ERROR',
                error,
                authority_effect: false,
              })),
            });
          }
          acceptedHeartbeatHealth = null;
          return { state: 'QUARANTINE_HEALED_REOPENED', transaction: reopened, authority_effect: false };
        }
      }
    }
    acceptedHeartbeatHealth = null;
    return { state: 'NOT_PENDING', authority_effect: false };
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || String(state.shell_version || '') !== version) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_VERSION_MISMATCH', authority_effect: false };
  }

  const continuityState = normalized(state.self_update_session_continuity?.state);
  if (HARD_CONTINUITY_FAILURES.has(continuityState)) {
    // A TARGET_VERSION_MISMATCH whose capsule target is strictly OLDER than the
    // running version is a leftover of an already-superseded attempt, not a live
    // continuity failure of this successor. The durable capsule is reconciled
    // (archived as superseded) by the qualification re-probe loop / watchdog;
    // quarantining the transaction for a stale leftover would mark a physically
    // successful install as failed. Any other hard failure (PARTIAL, ERROR,
    // mismatch with equal-or-newer capsule target) still quarantines fail-closed.
    const capsuleTarget = String(state.self_update_session_continuity?.target_version || '');
    const staleLeftover = continuityState === 'TARGET_VERSION_MISMATCH'
      && capsuleTarget
      && compareVersions(version, capsuleTarget) > 0;
    if (!staleLeftover) {
      acceptedHeartbeatHealth = null;
      const quarantineReason = `session_continuity_${continuityState.toLowerCase()}`;
      const quarantined = await quarantineSelfUpdateTransaction(app, quarantineReason);
      recordSelfUpdateRecoveryQuarantineResult(quarantined);
      return { state: 'QUARANTINED', reason: quarantineReason, authority_effect: false };
    }
  }
  const continuitySettled = continuityState === 'RESTORED'
    || continuityState === 'NONE'
    || (continuityState === 'TARGET_VERSION_MISMATCH' && (() => {
      const capsuleTarget = String(state.self_update_session_continuity?.target_version || '');
      return capsuleTarget && compareVersions(version, capsuleTarget) > 0;
    })());
  if (!continuitySettled) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_CONTINUITY_NOT_RESTORED', continuity_state: continuityState || null, authority_effect: false };
  }

  // Qualification V2 (P0 repair, point 5): a RESTORED projection must carry
  // positive user-session and tab-cardinality evidence. The 2026-09-17
  // incident reported RESTORED with 7 -> 32 tab amplification and every
  // ChatGPT tab parked on /auth/login while the process heartbeat stayed
  // green. Explicit negative evidence now quarantines fail-closed; UNKNOWN /
  // blank fields (older payloads, undeterminable pre-state) stay settled —
  // punishment requires proof, mirroring the rest of this predicate.
  if (continuityState === 'RESTORED') {
    const projection = state.self_update_session_continuity || {};
    const userSessionContinuity = String(projection.user_session_continuity || '').toUpperCase();
    if (userSessionContinuity === 'LOST') {
      acceptedHeartbeatHealth = null;
      const quarantineReason = 'session_continuity_user_session_lost';
      const quarantined = await quarantineSelfUpdateTransaction(app, quarantineReason);
      recordSelfUpdateRecoveryQuarantineResult(quarantined);
      return { state: 'QUARANTINED', reason: quarantineReason, authority_effect: false };
    }
    const tabCardinalityContinuity = String(projection.tab_cardinality_continuity || '').toUpperCase();
    if (tabCardinalityContinuity === 'VIOLATED') {
      acceptedHeartbeatHealth = null;
      const quarantineReason = 'session_continuity_tab_cardinality_violated';
      const quarantined = await quarantineSelfUpdateTransaction(app, quarantineReason);
      recordSelfUpdateRecoveryQuarantineResult(quarantined);
      return { state: 'QUARANTINED', reason: quarantineReason, authority_effect: false };
    }
  }

  const updater = state.self_update;
  if (!updater || typeof updater !== 'object' || Array.isArray(updater) || String(updater.current_version || '') !== version) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_UPDATER_NOT_BOUND', authority_effect: false };
  }
  const updaterError = updater.last_error != null && String(updater.last_error).trim() !== '' ? String(updater.last_error).trim() : null;
  const updaterState = normalized(updater.state);
  // The updater legitimately reports ERROR unresolved_prior:SUCCESSOR_BOOTED
  // while THIS transaction is the pending one being qualified: its install
  // attempts for the next release are refused exactly because qualification
  // has not completed yet. Treating that self-referential error as unhealthiness
  // created a permanent deadlock (qualification needs a healthy updater; the
  // updater stays errored until qualification completes). Any other error, any
  // FAILED state, or an ERROR state without that exact signature is still a
  // hard rejection.
  const toleratedPendingPrior = updaterError === UNRESOLVED_PRIOR_SUCCESSOR_BOOTED && updaterState !== 'FAILED';
  const updaterHealthy = toleratedPendingPrior
    || (updaterError == null && !['ERROR','FAILED'].includes(updaterState));
  if (!updaterHealthy) {
    acceptedHeartbeatHealth = null;
    return { state: 'HEARTBEAT_UPDATER_UNHEALTHY', updater_state: updaterState || null, updater_error: updaterError, authority_effect: false };
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
  const recovery = selfUpdateRecoveryDiagnosticSnapshot();
  if (!exactRecoveryTransaction(transaction, recovery)) {
    acceptedHeartbeatHealth = null;
    return recoveryBindingDrift(transaction, recovery);
  }
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
  const result = { state: 'QUALIFIED', transaction: qualified, authority_effect: false };
  recordSelfUpdateRecoveryQualificationResult(result);
  return result;
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
    if (['QUALIFIED','NOT_PENDING','QUARANTINED','RECOVERY_TRANSACTION_BINDING_DRIFT'].includes(last.state)) return last;
    await sleep(Math.max(100, Number(pollMs) || 1000));
  }
  return { ...(last || {}), state: 'QUALIFICATION_PENDING_TIMEOUT', authority_effect: false };
}

export const DEFAULT_SUCCESSOR_QUALIFICATION_REPROBE_MS = 60_000;
const REPROBE_TERMINAL_STATES = new Set(['QUALIFIED','NOT_PENDING','QUARANTINED','RECOVERY_TRANSACTION_BINDING_DRIFT']);

// Structural liveness repair: qualification used to be a single 30-second
// startup window — if any predicate (capsule presence, signed-heartbeat
// freshness, updater health) was not satisfied within it, the transaction
// stayed SUCCESSOR_BOOTED forever while nothing ever re-probed. A live host was
// observed stuck in exactly that state for 13+ hours with every other subsystem
// healthy.
//
// This loop is a deterministic reconciliation tick, not a second scheduler:
//  - it re-runs the SAME fail-closed probe predicate on an interval;
//  - it stops on every terminal state and when the recovery diagnostic no
//    longer reports TARGET_INSTALLED_PENDING_QUALIFICATION;
//  - on PENDING_CONTINUITY it reconciles a strictly-older (superseded) capsule
//    so the blocker is removed durably instead of being observed forever;
//  - it performs no installer effect and carries no authority.
export function startSuccessorQualificationReprobeLoop({
  app,
  intervalMs = DEFAULT_SUCCESSOR_QUALIFICATION_REPROBE_MS,
  maxProbes = 600,
  probe = probeUpdatedSuccessorQualification,
  onResult = () => {},
  onError = () => {},
  setTimer = setTimeout,
} = {}) {
  if (!app) throw new Error('self_update_qualification_app_invalid');
  const delay = Math.max(5_000, Number(intervalMs) || DEFAULT_SUCCESSOR_QUALIFICATION_REPROBE_MS);
  const limit = Math.max(1, Math.min(10_000, Number(maxProbes) || 600));
  let timer = null;
  let probes = 0;
  let cancelled = false;
  let stopped = false;

  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__ === handle) {
      delete globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__;
    }
    onResult({ schema: 'metaengine.self-update.qualification-reprobe.v1', state: 'LOOP_STOPPED', reason, probes, authority_effect: false });
  };

  const tick = async () => {
    if (cancelled || stopped) return;
    probes += 1;
    try {
      const result = await probe({ app });
      onResult({ schema: 'metaengine.self-update.qualification-reprobe.v1', probe_index: probes, ...result });
      if (REPROBE_TERMINAL_STATES.has(result?.state)) {
        stop(`terminal:${result.state}`);
        return;
      }
      if (result?.state === 'PENDING_CONTINUITY') {
        // Remove a strictly-older superseded capsule durably; equal/newer
        // targets stay fail-closed (handled by the probe itself).
        const reconciled = await reconcileStaleSelfUpdateSessionContinuity({
          userDataPath: app.getPath?.('userData'),
          currentVersion: app.getVersion?.(),
        }).catch(() => null);
        if (reconciled?.state) {
          onResult({ schema: 'metaengine.self-update.qualification-reprobe.v1', probe_index: probes, state: 'CONTINUITY_RECONCILED', reconcile: reconciled });
        }
      }
      const diagnostic = selfUpdateRecoveryDiagnosticSnapshot();
      if (diagnostic && diagnostic.state !== 'TARGET_INSTALLED_PENDING_QUALIFICATION') {
        stop(`diagnostic:${diagnostic.state}`);
        return;
      }
    } catch (error) {
      onError(String(error?.message || error).slice(0, 300));
    }
    if (probes >= limit) {
      stop('probe_limit_reached');
      return;
    }
    if (cancelled || stopped) return;
    timer = setTimer(() => { timer = null; void tick(); }, delay);
    timer?.unref?.();
  };

  const handle = Object.freeze({
    schema: 'metaengine.self-update.qualification-reprobe-loop.v1',
    interval_ms: delay,
    max_probes: limit,
    cancel: () => stop('cancelled'),
    authority_effect: false,
  });
  globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__ = handle;
  timer = setTimer(() => { timer = null; void tick(); }, delay);
  timer?.unref?.();
  return handle;
}
