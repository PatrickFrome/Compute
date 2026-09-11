export const BROWSER_GUARDIAN_CORE_VERSION = '1.0.0';
export const BROWSER_GUARDIAN_PLAN_SCHEMA = 'metaengine.browser-guardian.plan.v1';

const EFFECT_ACTIONS = new Set([
  'START_CHILD',
  'RESTART_EXACT_CHILD',
  'ACTIVATE_CANDIDATE',
  'ROLLBACK_CANDIDATE',
]);
const ACTIONS = new Set([
  'NOOP',
  'START_CHILD',
  'HOLD_STARTUP',
  'HOLD_UNREADY',
  'RESTART_EXACT_CHILD',
  'ESCALATE_TO_SCM',
  'ACTIVATE_CANDIDATE',
  'ROLLBACK_CANDIDATE',
]);

function finiteInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function nonEmpty(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort());
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function output(action, reason, extra = {}) {
  if (!ACTIONS.has(action)) throw new Error('guardian_plan_action_invalid');
  return freeze({
    schema: BROWSER_GUARDIAN_PLAN_SCHEMA,
    version: BROWSER_GUARDIAN_CORE_VERSION,
    action,
    reason,
    process_effect_candidate: EFFECT_ACTIONS.has(action),
    requires_external_executor: EFFECT_ACTIONS.has(action),
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    authority_effect: false,
    ...extra,
  });
}

function releaseIdentity(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return null;
  const releaseId = nonEmpty(release.release_id);
  const artifactSha256 = nonEmpty(release.artifact_sha256)?.toLowerCase() || null;
  const versionEpoch = finiteInt(release.version_epoch, 0);
  const minProtocolGeneration = finiteInt(release.min_protocol_generation, 0);
  if (!releaseId || !/^[0-9a-f]{64}$/.test(artifactSha256 || '') || versionEpoch < 1 || minProtocolGeneration < 1) return null;
  return freeze({
    release_id: releaseId,
    artifact_sha256: artifactSha256,
    version_epoch: versionEpoch,
    min_protocol_generation: minProtocolGeneration,
    required_capabilities: normalizeCapabilities(release.required_capabilities),
    metadata_expires_at_ms: release.metadata_expires_at_ms == null ? null : finiteInt(release.metadata_expires_at_ms, -1),
  });
}

function restartPolicy(policy = {}) {
  const windowMs = Math.max(1_000, finiteInt(policy.window_ms, 60_000));
  const maxRestarts = Math.max(1, finiteInt(policy.max_restarts_in_window, 5));
  const startupGraceMs = Math.max(500, finiteInt(policy.startup_grace_ms, 20_000));
  const livenessTimeoutMs = Math.max(500, finiteInt(policy.liveness_timeout_ms, 15_000));
  const progressTimeoutMs = Math.max(livenessTimeoutMs, finiteInt(policy.progress_timeout_ms, 60_000));
  return freeze({ window_ms: windowMs, max_restarts_in_window: maxRestarts, startup_grace_ms: startupGraceMs, liveness_timeout_ms: livenessTimeoutMs, progress_timeout_ms: progressTimeoutMs });
}

function restartCount(restartHistory, nowMs, windowMs) {
  if (!Array.isArray(restartHistory)) return 0;
  const floor = nowMs - windowMs;
  return restartHistory.reduce((count, value) => {
    const at = finiteInt(value, -1);
    return count + (at >= floor && at <= nowMs ? 1 : 0);
  }, 0);
}

function stormPlan(policy, observed, nowMs, reason, child = null) {
  const count = restartCount(observed?.restart_history_ms, nowMs, policy.window_ms);
  if (count >= policy.max_restarts_in_window) {
    return output('ESCALATE_TO_SCM', 'LOCAL_RESTART_INTENSITY_EXCEEDED', {
      blocked_reason: reason,
      restart_count_in_window: count,
      restart_window_ms: policy.window_ms,
      exact_process_incarnation_id: nonEmpty(child?.process_incarnation_id),
    });
  }
  return null;
}

function exactHeartbeatBinding(heartbeat, child, release) {
  if (!heartbeat || typeof heartbeat !== 'object' || Array.isArray(heartbeat)) return false;
  return nonEmpty(heartbeat.process_incarnation_id) === nonEmpty(child.process_incarnation_id)
    && finiteInt(heartbeat.pid, 0) === finiteInt(child.pid, 0)
    && nonEmpty(heartbeat.release_id) === release.release_id
    && String(heartbeat.artifact_sha256 || '').toLowerCase() === release.artifact_sha256;
}

function compatibility(heartbeat, release) {
  const generation = finiteInt(heartbeat?.protocol_generation, 0);
  const available = new Set(normalizeCapabilities(heartbeat?.capabilities));
  const missing = release.required_capabilities.filter((cap) => !available.has(cap));
  const safe = heartbeat?.arbitrary_eval === false
    && heartbeat?.page_model_text_authority === false
    && heartbeat?.automatic_retry_allowed === false
    && heartbeat?.second_scheduler_loop === false;
  return freeze({
    compatible: generation >= release.min_protocol_generation && missing.length === 0 && safe,
    protocol_generation: generation,
    missing_capabilities: Object.freeze(missing),
    safety_contract_valid: safe,
  });
}

function exactChild(child) {
  if (!child || typeof child !== 'object' || Array.isArray(child)) return false;
  return finiteInt(child.pid, 0) > 0 && Boolean(nonEmpty(child.process_incarnation_id));
}

function rollbackCandidate(desired, observed) {
  const activation = observed?.release_activation;
  if (activation?.state !== 'CANDIDATE_FAILED' || activation?.rollback_eligible !== true) return null;
  const previous = releaseIdentity(activation.previous_release);
  if (!previous) return output('NOOP', 'ROLLBACK_PREVIOUS_RELEASE_INVALID');
  if (observed?.effect_journal?.state === 'AMBIGUOUS') return output('NOOP', 'PROCESS_EFFECT_AMBIGUOUS');
  return output('ROLLBACK_CANDIDATE', 'CANDIDATE_FAILED_PREVIOUS_RELEASE_PROVEN', {
    target_release: previous,
    failed_release_id: releaseIdentity(desired?.release)?.release_id || null,
  });
}

/**
 * Pure decision function. It never starts, kills, promotes, rolls back or dispatches.
 * Any returned process effect must be executed by a separate durable effect executor
 * that revalidates the exact process/release incarnation and persists intent/readback.
 */
export function evaluateBrowserGuardianPlan({ desired = {}, observed = {}, now_ms = Date.now() } = {}) {
  const nowMs = finiteInt(now_ms, -1);
  if (nowMs < 0) return output('NOOP', 'CLOCK_INVALID');

  if (desired.external_stop_requested === true || String(desired.state || '').toUpperCase() === 'STOPPED') {
    return output('NOOP', 'EXTERNAL_STOP_RECORDED');
  }
  if (String(desired.state || 'RUNNING').toUpperCase() !== 'RUNNING') return output('NOOP', 'DESIRED_STATE_INVALID');

  const release = releaseIdentity(desired.release);
  if (!release) return output('HOLD_UNREADY', 'DESIRED_RELEASE_INVALID');
  if (release.metadata_expires_at_ms != null && release.metadata_expires_at_ms < nowMs) {
    return output('HOLD_UNREADY', 'RELEASE_METADATA_EXPIRED', { target_release: release });
  }

  const activeEpoch = finiteInt(observed.active_release_version_epoch, 0);
  if (activeEpoch > 0 && release.version_epoch < activeEpoch && observed?.release_activation?.rollback_eligible !== true) {
    return output('HOLD_UNREADY', 'ROLLBACK_NOT_AUTHORIZED', { target_release: release, active_release_version_epoch: activeEpoch });
  }
  if (activeEpoch === release.version_epoch && activeEpoch > 0
      && nonEmpty(observed.active_release_id)
      && nonEmpty(observed.active_release_id) !== release.release_id) {
    return output('HOLD_UNREADY', 'RELEASE_EPOCH_COLLISION', { target_release: release, active_release_id: nonEmpty(observed.active_release_id) });
  }

  if (observed?.effect_journal?.state === 'AMBIGUOUS') {
    return output('NOOP', 'PROCESS_EFFECT_AMBIGUOUS', {
      unresolved_effect_id: nonEmpty(observed.effect_journal.effect_id),
      target_release: release,
    });
  }

  const rollback = rollbackCandidate(desired, observed);
  if (rollback) return rollback;

  const policy = restartPolicy(desired.restart_policy);
  const child = observed.child;
  if (!child) {
    if (observed.process_absence_proven !== true) {
      return output('NOOP', 'CHILD_ABSENCE_UNPROVEN', { target_release: release });
    }
    const storm = stormPlan(policy, observed, nowMs, 'CHILD_ABSENT', null);
    if (storm) return storm;
    return output('START_CHILD', 'EXACT_CHILD_ABSENCE_PROVEN', {
      target_release: release,
      process_absence_proven: true,
    });
  }

  if (!exactChild(child)) return output('NOOP', 'CHILD_IDENTITY_INCOMPLETE', { target_release: release });

  const childAgeMs = Math.max(0, nowMs - finiteInt(child.started_at_ms, nowMs));
  const heartbeat = observed.heartbeat;
  const bound = exactHeartbeatBinding(heartbeat, child, release);

  if (!bound) {
    if (childAgeMs <= policy.startup_grace_ms) {
      return output('HOLD_STARTUP', heartbeat ? 'HEARTBEAT_BINDING_MISMATCH' : 'STARTUP_HEARTBEAT_PENDING', {
        exact_process_incarnation_id: nonEmpty(child.process_incarnation_id),
        child_age_ms: childAgeMs,
        startup_grace_ms: policy.startup_grace_ms,
        target_release: release,
      });
    }
    const storm = stormPlan(policy, observed, nowMs, 'STARTUP_PROOF_TIMEOUT', child);
    if (storm) return storm;
    return output('RESTART_EXACT_CHILD', 'STARTUP_PROOF_TIMEOUT', {
      exact_process_incarnation_id: nonEmpty(child.process_incarnation_id),
      exact_pid: finiteInt(child.pid, 0),
      target_release: release,
    });
  }

  const heartbeatAt = finiteInt(heartbeat.observed_at_ms, -1);
  const progressAt = finiteInt(heartbeat.progress_at_ms, heartbeatAt);
  const heartbeatAgeMs = heartbeatAt >= 0 ? Math.max(0, nowMs - heartbeatAt) : Number.POSITIVE_INFINITY;
  const progressAgeMs = progressAt >= 0 ? Math.max(0, nowMs - progressAt) : Number.POSITIVE_INFINITY;

  if (heartbeatAgeMs > policy.liveness_timeout_ms || progressAgeMs > policy.progress_timeout_ms) {
    const reason = heartbeatAgeMs > policy.liveness_timeout_ms ? 'LIVENESS_TIMEOUT' : 'USEFUL_PROGRESS_TIMEOUT';
    const storm = stormPlan(policy, observed, nowMs, reason, child);
    if (storm) return storm;
    return output('RESTART_EXACT_CHILD', reason, {
      exact_process_incarnation_id: nonEmpty(child.process_incarnation_id),
      exact_pid: finiteInt(child.pid, 0),
      heartbeat_age_ms: heartbeatAgeMs,
      progress_age_ms: progressAgeMs,
      target_release: release,
    });
  }

  const compat = compatibility(heartbeat, release);
  if (heartbeat.ready !== true || !compat.compatible) {
    return output('HOLD_UNREADY', heartbeat.ready !== true ? 'READINESS_NOT_PROVEN' : 'RUNTIME_CAPABILITY_SKEW', {
      exact_process_incarnation_id: nonEmpty(child.process_incarnation_id),
      compatibility: compat,
      target_release: release,
    });
  }

  const activeReleaseId = nonEmpty(observed.active_release_id);
  if (activeReleaseId !== release.release_id) {
    return output('ACTIVATE_CANDIDATE', 'EXACT_READY_CANDIDATE_PROVEN', {
      exact_process_incarnation_id: nonEmpty(child.process_incarnation_id),
      exact_pid: finiteInt(child.pid, 0),
      previous_active_release_id: activeReleaseId,
      target_release: release,
      compatibility: compat,
    });
  }

  return output('NOOP', 'EXACT_READY_RELEASE_HEALTHY', {
    exact_process_incarnation_id: nonEmpty(child.process_incarnation_id),
    exact_pid: finiteInt(child.pid, 0),
    target_release: release,
    compatibility: compat,
  });
}
