import { evaluateGuardianSessionBrokerPlan } from './browser-guardian-session-broker-core.mjs';
import { gateBrowserGuardianSessionBrokerEffect } from './browser-guardian-session-broker-effect-gate.mjs';

export const BROWSER_GUARDIAN_SESSION_BROKER_CONTROLLER_SCHEMA = 'metaengine.browser-guardian.session-broker-controller.v1';
export const BROWSER_GUARDIAN_SESSION_BROKER_CONTROLLER_VERSION = '1.0.0';

const STEPS = new Set(['HOLD', 'RECORD_INTENT', 'ONE_ATTEMPT_CANDIDATE', 'RECONCILE']);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function output(step, reason, extra = {}) {
  if (!STEPS.has(step)) throw new Error('guardian_session_broker_controller_step_invalid');
  return freeze({
    schema: BROWSER_GUARDIAN_SESSION_BROKER_CONTROLLER_SCHEMA,
    version: BROWSER_GUARDIAN_SESSION_BROKER_CONTROLLER_VERSION,
    step,
    reason: String(reason || 'unspecified').slice(0, 240),
    ...extra,
    record_intent_candidate: step === 'RECORD_INTENT',
    one_attempt_candidate: step === 'ONE_ATTEMPT_CANDIDATE',
    reconcile_required: step === 'RECONCILE',
    physical_effect_attempted: false,
    wts_execution_allowed: false,
    scm_start_allowed: false,
    process_effect_allowed: false,
    journal_mutation_allowed: false,
    automatic_retry_allowed: false,
    retry_loop_allowed: false,
    second_scheduler_allowed: false,
    browser_authority: false,
    task_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    session_token_authority: false,
    authority_effect: false,
  });
}

function projectGate(gate, plan) {
  switch (gate?.step) {
    case 'RECORD_INTENT':
      return output('RECORD_INTENT', gate.reason, {
        planner_action: plan.action,
        gate_step: gate.step,
        selected_session: gate.selected_session || plan.selected_session || null,
        previous_effect_generation: gate.previous_effect_generation || null,
      });
    case 'ATTEMPT_EXACT_START':
      return output('ONE_ATTEMPT_CANDIDATE', gate.reason, {
        planner_action: plan.action,
        gate_step: gate.step,
        effect_id: gate.effect_id || null,
        effect_generation: gate.effect_generation || null,
        selected_session: gate.selected_session || plan.selected_session || null,
      });
    case 'RECONCILE_ONLY':
      return output('RECONCILE', gate.reason, {
        planner_action: plan.action,
        gate_step: gate.step,
        journal_state: gate.journal_state || null,
        effect_id: gate.effect_id || null,
        effect_generation: gate.effect_generation || null,
      });
    default:
      return output('HOLD', gate?.reason || 'effect_gate_hold', {
        planner_action: plan.action,
        gate_step: gate?.step || null,
      });
  }
}

/**
 * Pure, level-triggered Session Broker controller.
 *
 * It observes current state, evaluates the existing planner, and projects the existing
 * durable-effect gate into one of four bounded orchestration steps. It does not acquire
 * a WTS token, mutate the durable journal, start/restart a service, launch/terminate a
 * process, schedule a retry, or execute any Browser/page/task/release effect.
 *
 * A caller may use RECORD_INTENT as a request for a separate durable journal adapter.
 * ONE_ATTEMPT_CANDIDATE is evidence that the existing gate sees an exact durable intent;
 * it is deliberately NOT authority to call WTSQueryUserToken/CreateProcessAsUser.
 */
export function evaluateGuardianSessionBrokerController({
  desired = {},
  observed = {},
  journal_snapshot = null,
  binding = {},
  now_ms = Date.now(),
} = {}) {
  const plan = evaluateGuardianSessionBrokerPlan({ desired, observed, now_ms });

  if (plan.action === 'ESCALATE_TO_SCM_RECOVERY') {
    return output('HOLD', 'scm_recovery_is_outside_controller_authority', {
      planner_action: plan.action,
      planner_reason: plan.reason,
    });
  }

  let gate;
  try {
    gate = gateBrowserGuardianSessionBrokerEffect({ plan, journal_snapshot, binding });
  } catch (error) {
    return output('HOLD', 'effect_gate_rejected_input', {
      planner_action: plan.action,
      planner_reason: plan.reason,
      gate_error: String(error?.message || error).slice(0, 180),
    });
  }

  return projectGate(gate, plan);
}
