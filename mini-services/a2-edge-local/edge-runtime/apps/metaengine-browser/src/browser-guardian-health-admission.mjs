import { evaluateBrowserGuardianPlan } from './browser-guardian-core.mjs';
import { evaluateGuardianHeartbeatFence } from './browser-guardian-heartbeat-fence.mjs';

export const BROWSER_GUARDIAN_HEALTH_ADMISSION_VERSION = '1.0.0';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function blockedPlan(reason, fence) {
  return freeze({
    schema: 'metaengine.browser-guardian.health-admission.v1',
    version: BROWSER_GUARDIAN_HEALTH_ADMISSION_VERSION,
    action: 'NOOP',
    reason,
    heartbeat_fence: fence,
    process_effect_candidate: false,
    requires_external_executor: false,
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}

function aggregateFencedHeartbeat(observed, fence) {
  const readiness = observed.heartbeats.readiness;
  return freeze({
    pid: fence.pid,
    process_incarnation_id: fence.process_incarnation_id,
    release_id: fence.release_id,
    artifact_sha256: fence.artifact_sha256,
    observed_at_ms: fence.channels.liveness.observed_at_ms,
    progress_at_ms: fence.channels.progress.observed_at_ms,
    ready: readiness.ready === true,
    protocol_generation: readiness.protocol_generation,
    capabilities: readiness.capabilities,
    arbitrary_eval: readiness.arbitrary_eval,
    page_model_text_authority: readiness.page_model_text_authority,
    automatic_retry_allowed: readiness.automatic_retry_allowed,
    second_scheduler_loop: readiness.second_scheduler_loop,
  });
}

/**
 * Split-heartbeat admission boundary for Browser Guardian planning.
 *
 * A child process may only reach liveness/readiness/progress decisions after all
 * four independently sequenced health channels are exact-bound to the same
 * process incarnation and release. Sequence/binding/timestamp failures quarantine
 * planning instead of being converted into a process effect. Child absence and
 * external-stop handling remain delegated to the pure Guardian core and do not
 * require a heartbeat.
 */
export function evaluateBrowserGuardianHealthAdmission({
  desired = {},
  observed = {},
  sequence_fence = {},
  now_ms = Date.now(),
} = {}) {
  if (!observed?.child) {
    return evaluateBrowserGuardianPlan({ desired, observed, now_ms });
  }

  const fence = evaluateGuardianHeartbeatFence({
    child: observed.child,
    release: desired.release,
    heartbeats: observed.heartbeats,
    sequence_fence,
    now_ms,
  });

  if (!fence.valid) {
    return blockedPlan('SPLIT_HEARTBEAT_FENCE_REJECTED', fence);
  }

  return evaluateBrowserGuardianPlan({
    desired,
    observed: {
      ...observed,
      heartbeat: aggregateFencedHeartbeat(observed, fence),
    },
    now_ms,
  });
}
