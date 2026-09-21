'use strict';

const DEFAULT_PARENT_PROGRESS_STALE_MS = 120_000;
const DEFAULT_PARENT_PROGRESS_STARTUP_GRACE_MS = 180_000;
const DEFAULT_PARENT_TERMINATION_CONFIRM_MS = 8_000;

function isoMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function parentProgressPath(statePath) {
  return `${String(statePath)}.parent-progress-v1.json`;
}

function evaluateParentProgress({
  state,
  progress,
  nowMs = Date.now(),
  staleMs = DEFAULT_PARENT_PROGRESS_STALE_MS,
  startupGraceMs = DEFAULT_PARENT_PROGRESS_STARTUP_GRACE_MS,
} = {}) {
  const stale = Math.max(30_000, Number(staleMs) || DEFAULT_PARENT_PROGRESS_STALE_MS);
  const startup = Math.max(stale, Number(startupGraceMs) || DEFAULT_PARENT_PROGRESS_STARTUP_GRACE_MS);
  const createdMs = isoMs(state?.created_at);
  const progressMs = isoMs(progress?.progress_at);
  const bound = Boolean(
    progress?.schema === 'metaengine.browser-sentinel.parent-progress.v1'
    && progress?.token === state?.token
    && Number(progress?.parent_pid) === Number(state?.parent_pid)
    && progress?.authority_effect === false
  );
  const ageMs = bound && progressMs != null ? Math.max(0, Number(nowMs) - progressMs) : null;
  const startupAgeMs = createdMs == null ? null : Math.max(0, Number(nowMs) - createdMs);
  const suppressed = Boolean(
    state?.lifecycle === 'PLANNED_SHUTDOWN'
    || state?.expected_restart === true
    || state?.installer_handoff === true
    || ['EXPECTED_RESTART','INSTALLER_HANDOFF'].includes(String(state?.lifecycle || ''))
  );

  const base = {
    schema: 'metaengine.browser-sentinel.parent-liveness-decision.v1',
    state: 'UNKNOWN',
    progress_bound: bound,
    progress_at: bound ? progress?.progress_at || null : null,
    progress_age_ms: ageMs,
    stale_after_ms: stale,
    startup_grace_ms: startup,
    terminate_parent: false,
    relaunch_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };

  if (suppressed) return Object.freeze({ ...base, state: 'SUPPRESSED_EXPECTED_TRANSITION' });
  if (bound && ageMs != null && ageMs <= stale) return Object.freeze({ ...base, state: 'HEALTHY' });
  if (!bound && startupAgeMs != null && startupAgeMs < startup) return Object.freeze({ ...base, state: 'STARTUP_GRACE' });
  if (state?.parent_liveness_termination_attempted === true) {
    return Object.freeze({ ...base, state: 'TERMINATION_ALREADY_ATTEMPTED' });
  }
  return Object.freeze({ ...base, state: bound ? 'PROGRESS_STALE' : 'PROGRESS_MISSING', terminate_parent: true });
}

module.exports = {
  DEFAULT_PARENT_PROGRESS_STALE_MS,
  DEFAULT_PARENT_PROGRESS_STARTUP_GRACE_MS,
  DEFAULT_PARENT_TERMINATION_CONFIRM_MS,
  parentProgressPath,
  evaluateParentProgress,
};
