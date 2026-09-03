export const BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_GATE_SCHEMA = 'metaengine.browser-guardian.session-broker-effect-gate.v1';
export const BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_GATE_VERSION = '1.0.0';

const PLAN_SCHEMA = 'metaengine.browser-guardian.session-broker-plan.v1';
const JOURNAL_SCHEMA = 'metaengine.browser-guardian.session-broker-effect-journal.v1';
const SID_RE = /^S-\d-\d+(?:-\d+)+$/i;

function text(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function sid(value) {
  const out = String(value ?? '').trim().toUpperCase();
  return SID_RE.test(out) ? out : null;
}

function int(value, fallback = -1) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function bindingFrom(value) {
  const serviceName = text(value?.service_name);
  const brokerExecutable = text(value?.broker_executable);
  const expectedOwnerSid = sid(value?.expected_owner_sid);
  if (!serviceName || !brokerExecutable || !expectedOwnerSid) throw new Error('guardian_session_broker_effect_gate_binding_invalid');
  return Object.freeze({
    service_name: serviceName,
    broker_executable: brokerExecutable,
    expected_owner_sid: expectedOwnerSid,
  });
}

function sameBinding(value, binding) {
  return value?.service_name === binding.service_name
    && value?.broker_executable === binding.broker_executable
    && sid(value?.expected_owner_sid) === binding.expected_owner_sid;
}

function planIdentity(plan, binding) {
  if (!plan || plan.schema !== PLAN_SCHEMA || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('guardian_session_broker_effect_gate_plan_schema_invalid');
  }
  const action = String(plan.action || '').trim().toUpperCase();
  if (action !== 'START_BROKER') return Object.freeze({ action });

  if (plan.process_effect_candidate !== true || plan.requires_user_session_executor !== true) {
    throw new Error('guardian_session_broker_effect_gate_plan_effect_contract_invalid');
  }
  for (const field of [
    'actuation_eligible',
    'automatic_retry_allowed',
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'page_model_text_authority',
    'release_authority',
    'session_token_authority',
    'authority_effect',
  ]) {
    if (plan[field] !== false) throw new Error(`guardian_session_broker_effect_gate_plan_authority_invalid:${field}`);
  }
  if (plan.broker_absence_proven !== true) throw new Error('guardian_session_broker_effect_gate_absence_unproven');

  const selectedSession = plan.selected_session;
  const sessionId = int(selectedSession?.session_id, -1);
  const userSid = sid(selectedSession?.user_sid);
  const state = String(selectedSession?.state || '').trim().toUpperCase();
  if (sessionId < 0 || !userSid || state !== 'ACTIVE' || userSid !== binding.expected_owner_sid) {
    throw new Error('guardian_session_broker_effect_gate_session_invalid');
  }

  return Object.freeze({
    action,
    broker_executable: binding.broker_executable,
    broker_absence_proven: true,
    selected_session: Object.freeze({ session_id: sessionId, user_sid: userSid, state: 'ACTIVE' }),
  });
}

function samePlanIdentity(journalPlan, identity) {
  if (!journalPlan || identity.action !== 'START_BROKER') return false;
  return journalPlan.action === 'START_BROKER'
    && journalPlan.broker_executable === identity.broker_executable
    && journalPlan.broker_absence_proven === true
    && int(journalPlan.selected_session?.session_id, -1) === identity.selected_session.session_id
    && sid(journalPlan.selected_session?.user_sid) === identity.selected_session.user_sid
    && String(journalPlan.selected_session?.state || '').toUpperCase() === 'ACTIVE';
}

function decision(step, reason, extra = {}) {
  return Object.freeze({
    schema: BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_GATE_SCHEMA,
    version: BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_GATE_VERSION,
    step,
    reason,
    ...extra,
    executor_candidate: step === 'ATTEMPT_EXACT_START',
    requires_user_session_executor: step === 'ATTEMPT_EXACT_START',
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    session_token_authority: false,
    process_effect_authority: false,
    authority_effect: false,
  });
}

export function gateBrowserGuardianSessionBrokerEffect({ plan, journal_snapshot = null, binding } = {}) {
  const exactBinding = bindingFrom(binding);
  const identity = planIdentity(plan, exactBinding);

  if (identity.action === 'RESTART_EXACT_BROKER') {
    return decision('HOLD_UNSUPPORTED_RESTART', 'restart_requires_separate_two_phase_protocol');
  }
  if (identity.action !== 'START_BROKER') {
    return decision('HOLD_PLAN', 'planner_did_not_request_start', { planner_action: identity.action || null });
  }

  if (journal_snapshot == null) {
    return decision('RECORD_INTENT', 'durable_start_intent_required_before_effect', { selected_session: identity.selected_session });
  }
  if (!journal_snapshot || journal_snapshot.schema !== JOURNAL_SCHEMA || typeof journal_snapshot !== 'object' || Array.isArray(journal_snapshot)) {
    return decision('HOLD_JOURNAL_INVALID', 'durable_journal_schema_untrusted');
  }
  if (!sameBinding(journal_snapshot, exactBinding)) {
    return decision('HOLD_JOURNAL_BINDING_DRIFT', 'durable_journal_binding_drift');
  }

  const state = String(journal_snapshot.state || '').trim().toUpperCase();
  if (state === 'NO_EFFECT_PROVEN') {
    return decision('RECORD_INTENT', 'previous_generation_proven_no_effect', {
      previous_effect_generation: int(journal_snapshot.effect_generation, 0),
      selected_session: identity.selected_session,
    });
  }
  if (!samePlanIdentity(journal_snapshot.plan, identity)) {
    return decision('HOLD_JOURNAL_PLAN_DRIFT', 'planner_and_durable_intent_identity_differ', {
      journal_state: state || null,
    });
  }

  if (state === 'INTENT_RECORDED') {
    return decision('ATTEMPT_EXACT_START', 'exact_durable_intent_precedes_single_attempt', {
      effect_id: text(journal_snapshot.effect_id),
      effect_generation: int(journal_snapshot.effect_generation, 0),
      selected_session: identity.selected_session,
    });
  }
  if (['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS'].includes(state)) {
    return decision('RECONCILE_ONLY', 'effect_barrier_already_crossed_no_replay', {
      journal_state: state,
      effect_id: text(journal_snapshot.effect_id),
      effect_generation: int(journal_snapshot.effect_generation, 0),
    });
  }
  if (state === 'CONFIRMED') {
    return decision('HOLD_CONFIRMED', 'raw_start_forbidden_after_confirmed_broker');
  }

  return decision('HOLD_JOURNAL_INVALID', 'durable_journal_state_untrusted', { journal_state: state || null });
}
