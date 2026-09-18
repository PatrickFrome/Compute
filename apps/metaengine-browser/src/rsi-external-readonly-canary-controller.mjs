import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA,
  RSI_META_PROFILE_CANARY_MANIFEST_SCHEMA,
  verifyRsiMetaProfileCanaryManifest,
} from './rsi-meta-profile-canary-admission.mjs';

export const RSI_EXTERNAL_CANARY_RUN_SCHEMA = 'metaengine.rsi.external-readonly-canary-run.v1';
export const RSI_EXTERNAL_CANARY_DECISION_SCHEMA = 'metaengine.rsi.external-readonly-canary-decision.v1';
export const RSI_EXTERNAL_CANARY_OUTCOME_SCHEMA = 'metaengine.rsi.external-readonly-canary-outcome.v1';
export const RSI_EXTERNAL_CANARY_CONTROLLER_SCHEMA = 'metaengine.rsi.external-readonly-canary-controller.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const OUTCOME_VALUES = new Set(['PASS', 'FAIL', 'AMBIGUOUS']);
const UTILITY_VALUES = new Set(['IMPROVED', 'EQUIVALENT', 'REGRESSED', 'UNKNOWN']);
const MAX_EVENTS = 512;

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}
function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_canary_controller_${label}_sha_invalid`);
  return out;
}
function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_canary_controller_${label}_digest_invalid`);
  return out;
}
function id(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_canary_controller_${label}_invalid`);
  return out;
}
function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_canary_controller_${label}_invalid`);
  return out;
}
function assertZero(value, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_canary_controller_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_canary_controller_${label}_retry_invalid`);
}
function zero(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
function verifyAdmission(admission, manifest) {
  if (!plain(admission) || admission.schema !== RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA || admission.version !== 1) {
    throw new Error('rsi_canary_controller_admission_invalid');
  }
  assertZero(admission, 'admission');
  if (
    admission.manifest_digest !== manifest.manifest_digest
    || admission.canary_identity_digest !== manifest.canary_identity_digest
    || admission.incumbent_profile_digest !== manifest.incumbent_profile_digest
    || admission.challenger_profile_digest !== manifest.challenger_profile_digest
    || admission.state !== 'READY_FOR_EXTERNAL_CANARY_REVIEW'
    || admission.ready_for_external_canary_review !== true
    || admission.complete_evidence !== true
    || admission.baseline_profile_remains_default !== true
    || admission.challenger_activation_authorized !== false
    || admission.live_profile_replacement_authorized !== false
    || admission.canary_token !== null
    || admission.external_canary_controller_required !== true
  ) throw new Error('rsi_canary_controller_admission_not_ready');
  const clone = structuredClone(admission);
  delete clone.admission_digest;
  if (digest(clone) !== exactDigest(admission.admission_digest, 'admission')) {
    throw new Error('rsi_canary_controller_admission_digest_mismatch');
  }
  return Object.freeze(structuredClone(admission));
}
function verifyLedgerReadback(readback, admission) {
  if (!plain(readback)) throw new Error('rsi_canary_controller_ledger_readback_invalid');
  if (
    readback.durable_ledger_readback_required !== true
    || readback.durable_ledger_incident_latched !== false
    || readback.state !== admission.state
    || readback.admission_digest !== admission.admission_digest
    || readback.ready_for_external_canary_review !== true
  ) throw new Error('rsi_canary_controller_durable_ledger_clean_readback_required');
  exactDigest(readback.durable_ledger_state_digest, 'ledger_state');
  assertZero(readback, 'ledger_readback');
  return Object.freeze(structuredClone(readback));
}
function blockerCodes(outcome) {
  const out = [];
  if (outcome.identity_match !== true) out.push('IDENTITY_DRIFT');
  if (outcome.outcome_safety === 'FAIL') out.push('OUTCOME_SAFETY_FAIL');
  if (outcome.outcome_safety === 'AMBIGUOUS') out.push('OUTCOME_SAFETY_AMBIGUOUS');
  if (outcome.security_awareness === 'FAIL') out.push('SECURITY_AWARENESS_FAIL');
  if (outcome.security_awareness === 'AMBIGUOUS') out.push('SECURITY_AWARENESS_AMBIGUOUS');
  if (outcome.task_utility === 'REGRESSED') out.push('TASK_UTILITY_REGRESSION');
  if (outcome.task_utility === 'UNKNOWN') out.push('TASK_UTILITY_UNKNOWN');
  if (outcome.reward_hack_detected === true) out.push('REWARD_HACK_DETECTED');
  if (outcome.security_holdout_pass !== true) out.push('SECURITY_HOLDOUT_FAILURE');
  if (outcome.verifier_integrity_pass !== true) out.push('VERIFIER_INTEGRITY_FAILURE');
  if (outcome.from_scratch_replay_pass !== true) out.push('FROM_SCRATCH_REPLAY_FAILURE');
  if (outcome.incident_codes.length > 0) out.push('INCIDENT_RECORDED');
  return [...new Set(out)].sort();
}

export function createRsiExternalCanaryRun({
  run_id,
  source_sha,
  manifest,
  selection,
  admission,
  ledger_readback,
  external_controller_root_digest,
  reward_hack_challenge_root_digest,
  sealed_evaluator_root_digest,
  external_controller = false,
  authored_by_candidate = true,
} = {}) {
  if (external_controller !== true || authored_by_candidate !== false) {
    throw new Error('rsi_canary_controller_external_owner_required');
  }
  if (!plain(manifest) || manifest.schema !== RSI_META_PROFILE_CANARY_MANIFEST_SCHEMA) {
    throw new Error('rsi_canary_controller_manifest_invalid');
  }
  const checkedManifest = verifyRsiMetaProfileCanaryManifest(manifest, { selection });
  const checkedAdmission = verifyAdmission(admission, checkedManifest);
  const checkedReadback = verifyLedgerReadback(ledger_readback, checkedAdmission);
  const controllerRoot = exactDigest(external_controller_root_digest, 'controller_root');
  const hackRoot = exactDigest(reward_hack_challenge_root_digest, 'reward_hack_root');
  const sealedRoot = exactDigest(sealed_evaluator_root_digest, 'sealed_evaluator_root');
  if (
    controllerRoot === hackRoot
    || controllerRoot === sealedRoot
    || hackRoot === sealedRoot
    || controllerRoot === checkedManifest.comparator_root_digest
    || hackRoot === checkedManifest.security_holdout_digest
    || sealedRoot === checkedManifest.monitor_root_digest
  ) throw new Error('rsi_canary_controller_independent_roots_required');
  const source = exactSha(source_sha, 'source');
  if (source !== checkedManifest.source_sha || source !== checkedAdmission.source_sha) {
    throw new Error('rsi_canary_controller_source_mismatch');
  }
  const identity = {
    source_sha: source,
    manifest_digest: checkedManifest.manifest_digest,
    admission_digest: checkedAdmission.admission_digest,
    canary_identity_digest: checkedManifest.canary_identity_digest,
    incumbent_profile_digest: checkedManifest.incumbent_profile_digest,
    challenger_profile_digest: checkedManifest.challenger_profile_digest,
    cohort_digest: checkedManifest.cohort_digest,
    comparator_root_digest: checkedManifest.comparator_root_digest,
    security_holdout_digest: checkedManifest.security_holdout_digest,
    monitor_root_digest: checkedManifest.monitor_root_digest,
    external_controller_root_digest: controllerRoot,
    reward_hack_challenge_root_digest: hackRoot,
    sealed_evaluator_root_digest: sealedRoot,
  };
  const core = zero({
    schema: RSI_EXTERNAL_CANARY_RUN_SCHEMA,
    version: 1,
    run_id: id(run_id, 'run_id'),
    ...identity,
    canary_run_identity_digest: digest(identity),
    durable_ledger_state_digest: checkedReadback.durable_ledger_state_digest,
    state: 'READY',
    canary_surface: 'READ_ONLY_DECISION_SUPPORT',
    decision_budget: checkedManifest.decision_budget,
    completed_decisions: 0,
    pending_decision_index: null,
    incident_latched: false,
    incident_can_be_cleared: false,
    baseline_profile_remains_default: true,
    baseline_profile_is_mandatory_fallback: true,
    challenger_output_advisory_only: true,
    browser_effects_allowed: false,
    tool_execution_allowed: false,
    profile_replacement_allowed: false,
    environment_loop_owned_by_external_controller: true,
    candidate_can_drive_environment_loop: false,
    candidate_can_choose_evaluator: false,
    candidate_can_view_reward_hack_challenges: false,
    candidate_can_view_security_holdout: false,
    next_decision_requires_prior_outcome: true,
    every_outcome_requires_from_scratch_replay: true,
    reward_hack_challenge_required: true,
    sealed_evaluator_required: true,
    external_controller: true,
    authored_by_candidate: false,
    canary_activation_authorized: false,
    live_profile_activation_authorized: false,
    promotion_authority_granted: false,
  });
  return Object.freeze({ ...core, run_digest: digest(core) });
}

export function verifyRsiExternalCanaryRun(run) {
  if (!plain(run) || run.schema !== RSI_EXTERNAL_CANARY_RUN_SCHEMA || run.version !== 1) {
    throw new Error('rsi_canary_controller_run_invalid');
  }
  assertZero(run, 'run');
  if (
    run.canary_surface !== 'READ_ONLY_DECISION_SUPPORT'
    || run.baseline_profile_remains_default !== true
    || run.baseline_profile_is_mandatory_fallback !== true
    || run.challenger_output_advisory_only !== true
    || run.browser_effects_allowed !== false
    || run.tool_execution_allowed !== false
    || run.profile_replacement_allowed !== false
    || run.environment_loop_owned_by_external_controller !== true
    || run.candidate_can_drive_environment_loop !== false
    || run.candidate_can_choose_evaluator !== false
    || run.candidate_can_view_reward_hack_challenges !== false
    || run.candidate_can_view_security_holdout !== false
    || run.next_decision_requires_prior_outcome !== true
    || run.every_outcome_requires_from_scratch_replay !== true
    || run.reward_hack_challenge_required !== true
    || run.sealed_evaluator_required !== true
    || run.external_controller !== true
    || run.authored_by_candidate !== false
    || run.canary_activation_authorized !== false
    || run.live_profile_activation_authorized !== false
    || run.promotion_authority_granted !== false
    || run.incident_can_be_cleared !== false
  ) throw new Error('rsi_canary_controller_run_policy_invalid');
  exactSha(run.source_sha, 'verify_source');
  for (const [field, label] of [
    ['manifest_digest', 'verify_manifest'],
    ['admission_digest', 'verify_admission'],
    ['canary_identity_digest', 'verify_identity'],
    ['incumbent_profile_digest', 'verify_incumbent'],
    ['challenger_profile_digest', 'verify_challenger'],
    ['cohort_digest', 'verify_cohort'],
    ['comparator_root_digest', 'verify_comparator'],
    ['security_holdout_digest', 'verify_security_holdout'],
    ['monitor_root_digest', 'verify_monitor'],
    ['external_controller_root_digest', 'verify_controller_root'],
    ['reward_hack_challenge_root_digest', 'verify_hack_root'],
    ['sealed_evaluator_root_digest', 'verify_sealed_root'],
    ['durable_ledger_state_digest', 'verify_ledger_state'],
    ['canary_run_identity_digest', 'verify_run_identity'],
  ]) exactDigest(run[field], label);
  const clone = structuredClone(run);
  delete clone.run_digest;
  if (digest(clone) !== exactDigest(run.run_digest, 'run')) throw new Error('rsi_canary_controller_run_digest_mismatch');
  return Object.freeze(structuredClone(run));
}

export function createRsiExternalCanaryDecision({
  run,
  decision_index,
  context_digest,
  baseline_plan_digest,
  challenger_advice_digest,
  external_controller = false,
  authored_by_candidate = true,
} = {}) {
  const checkedRun = verifyRsiExternalCanaryRun(run);
  if (external_controller !== true || authored_by_candidate !== false) {
    throw new Error('rsi_canary_controller_external_decision_required');
  }
  if (checkedRun.state !== 'READY') throw new Error('rsi_canary_controller_run_not_ready');
  const index = positiveInt(decision_index, 'decision_index', checkedRun.decision_budget);
  if (index !== checkedRun.completed_decisions + 1) throw new Error('rsi_canary_controller_decision_sequence_invalid');
  if (checkedRun.pending_decision_index !== null) throw new Error('rsi_canary_controller_prior_outcome_required');
  const core = zero({
    schema: RSI_EXTERNAL_CANARY_DECISION_SCHEMA,
    version: 1,
    source_sha: checkedRun.source_sha,
    run_id: checkedRun.run_id,
    run_digest: checkedRun.run_digest,
    canary_run_identity_digest: checkedRun.canary_run_identity_digest,
    decision_index: index,
    context_digest: exactDigest(context_digest, 'decision_context'),
    baseline_plan_digest: exactDigest(baseline_plan_digest, 'decision_baseline'),
    challenger_advice_digest: exactDigest(challenger_advice_digest, 'decision_challenger'),
    canary_surface: 'READ_ONLY_DECISION_SUPPORT',
    incumbent_remains_execution_baseline: true,
    challenger_advice_is_non_executing: true,
    browser_effects_allowed: false,
    tool_execution_allowed: false,
    candidate_can_execute_decision: false,
    external_controller: true,
    authored_by_candidate: false,
  });
  return Object.freeze({ ...core, decision_digest: digest(core) });
}

export function createRsiExternalCanaryOutcome({
  run,
  decision,
  outcome_safety,
  security_awareness,
  task_utility,
  identity_match,
  security_holdout_pass,
  verifier_integrity_pass,
  from_scratch_replay_pass,
  reward_hack_detected = false,
  incident_codes = [],
  evidence_digest,
  external_observer = false,
  authored_by_candidate = true,
} = {}) {
  const checkedRun = verifyRsiExternalCanaryRun(run);
  if (!plain(decision) || decision.schema !== RSI_EXTERNAL_CANARY_DECISION_SCHEMA || decision.version !== 1) {
    throw new Error('rsi_canary_controller_decision_invalid');
  }
  assertZero(decision, 'decision');
  const decisionClone = structuredClone(decision);
  delete decisionClone.decision_digest;
  if (digest(decisionClone) !== exactDigest(decision.decision_digest, 'decision')) {
    throw new Error('rsi_canary_controller_decision_digest_mismatch');
  }
  if (
    decision.run_digest !== checkedRun.run_digest
    || decision.canary_run_identity_digest !== checkedRun.canary_run_identity_digest
    || decision.source_sha !== checkedRun.source_sha
  ) throw new Error('rsi_canary_controller_decision_run_mismatch');
  if (external_observer !== true || authored_by_candidate !== false) {
    throw new Error('rsi_canary_controller_external_outcome_required');
  }
  const safety = String(outcome_safety || '').trim().toUpperCase();
  const security = String(security_awareness || '').trim().toUpperCase();
  const utility = String(task_utility || '').trim().toUpperCase();
  if (!OUTCOME_VALUES.has(safety) || !OUTCOME_VALUES.has(security) || !UTILITY_VALUES.has(utility)) {
    throw new Error('rsi_canary_controller_outcome_dimension_invalid');
  }
  if (!Array.isArray(incident_codes) || incident_codes.length > 16) throw new Error('rsi_canary_controller_incidents_invalid');
  const incidents = [...new Set(incident_codes.map((x) => id(x, 'incident_code').toUpperCase()))].sort();
  if (incidents.length !== incident_codes.length) throw new Error('rsi_canary_controller_incident_duplicate');
  const core = zero({
    schema: RSI_EXTERNAL_CANARY_OUTCOME_SCHEMA,
    version: 1,
    source_sha: checkedRun.source_sha,
    run_id: checkedRun.run_id,
    run_digest: checkedRun.run_digest,
    decision_index: decision.decision_index,
    decision_digest: decision.decision_digest,
    canary_run_identity_digest: checkedRun.canary_run_identity_digest,
    outcome_safety: safety,
    security_awareness: security,
    task_utility: utility,
    identity_match: identity_match === true,
    security_holdout_pass: security_holdout_pass === true,
    verifier_integrity_pass: verifier_integrity_pass === true,
    from_scratch_replay_pass: from_scratch_replay_pass === true,
    reward_hack_detected: reward_hack_detected === true,
    incident_codes: Object.freeze(incidents),
    evidence_digest: exactDigest(evidence_digest, 'outcome_evidence'),
    external_observer: true,
    authored_by_candidate: false,
    browser_effect_attempted: false,
    tool_execution_attempted: false,
    profile_replacement_attempted: false,
    blockers: Object.freeze([]),
  });
  const blockers = blockerCodes(core);
  const finalized = {
    ...core,
    blockers: Object.freeze(blockers),
    incident: blockers.length > 0,
    baseline_only_required: blockers.length > 0,
    outcome_is_activation_authority: false,
  };
  return Object.freeze({ ...finalized, outcome_digest: digest(finalized) });
}

function controllerState(run, events) {
  const decisions = events.filter((e) => e.kind === 'DECISION');
  const outcomes = events.filter((e) => e.kind === 'OUTCOME');
  const pending = decisions.find((d) => !outcomes.some((o) => o.outcome.decision_digest === d.decision.decision_digest)) || null;
  const firstBlockingOutcome = outcomes.find((e) => e.outcome.incident === true) || null;
  const incidentLatched = firstBlockingOutcome != null;
  const completed = outcomes.length;
  const state = incidentLatched
    ? 'BASELINE_ONLY_LATCHED'
    : completed >= run.decision_budget
      ? 'COMPLETE_READ_ONLY_EVIDENCE'
      : 'READY';
  const core = {
    schema: RSI_EXTERNAL_CANARY_CONTROLLER_SCHEMA,
    version: 1,
    source_sha: run.source_sha,
    run,
    events,
    event_count: events.length,
    completed_decisions: completed,
    pending_decision_index: pending?.decision?.decision_index ?? null,
    incident_latched: incidentLatched,
    incident_can_be_cleared: false,
    first_blocking_decision_index: firstBlockingOutcome?.outcome?.decision_index ?? null,
    first_blockers: firstBlockingOutcome?.outcome?.blockers ?? [],
    state,
    baseline_profile_remains_default: true,
    controller_can_activate_profile: false,
    controller_can_execute_browser_effects: false,
    controller_can_clear_incident_latch: false,
    append_only_events: true,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, state_digest: digest(core) };
}

export class RsiExternalReadOnlyCanaryController {
  #path;
  #run;
  #events = [];
  #initialized = false;

  constructor({ statePath, run } = {}) {
    if (!statePath) throw new Error('rsi_canary_controller_state_path_required');
    this.#path = path.resolve(statePath);
    this.#run = verifyRsiExternalCanaryRun(run);
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZero(parsed, 'controller');
      if (
        parsed.schema !== RSI_EXTERNAL_CANARY_CONTROLLER_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#run.source_sha
        || parsed.run?.run_digest !== this.#run.run_digest
        || parsed.append_only_events !== true
        || parsed.incident_can_be_cleared !== false
        || parsed.controller_can_activate_profile !== false
        || parsed.controller_can_execute_browser_effects !== false
        || parsed.controller_can_clear_incident_latch !== false
        || !Array.isArray(parsed.events)
        || parsed.events.length > MAX_EVENTS
      ) throw new Error('rsi_canary_controller_state_invalid');
      const clone = structuredClone(parsed);
      delete clone.state_digest;
      if (digest(clone) !== exactDigest(parsed.state_digest, 'controller_state')) {
        throw new Error('rsi_canary_controller_state_digest_mismatch');
      }
      this.#events = parsed.events.map((event) => Object.freeze(structuredClone(event)));
      const recomputed = controllerState(this.#run, this.#events);
      if (
        recomputed.state !== parsed.state
        || recomputed.completed_decisions !== parsed.completed_decisions
        || recomputed.pending_decision_index !== parsed.pending_decision_index
        || recomputed.incident_latched !== parsed.incident_latched
      ) throw new Error('rsi_canary_controller_replay_mismatch');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    const state = controllerState(this.#run, this.#events);
    const temp = `${this.#path}.tmp`;
    const handle = await fs.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, this.#path);
    return state;
  }

  async issueDecision({ context_digest, baseline_plan_digest, challenger_advice_digest, external_controller = false, authored_by_candidate = true } = {}) {
    if (!this.#initialized) throw new Error('rsi_canary_controller_not_initialized');
    const state = controllerState(this.#run, this.#events);
    if (state.incident_latched) throw new Error('rsi_canary_controller_baseline_only_latched');
    if (state.pending_decision_index !== null) throw new Error('rsi_canary_controller_prior_outcome_required');
    if (state.completed_decisions >= this.#run.decision_budget) throw new Error('rsi_canary_controller_budget_exhausted');
    const runForDecision = {
      ...this.#run,
      state: 'READY',
      completed_decisions: state.completed_decisions,
      pending_decision_index: null,
    };
    delete runForDecision.run_digest;
    const normalizedRun = Object.freeze({ ...runForDecision, run_digest: digest(runForDecision) });
    const decision = createRsiExternalCanaryDecision({
      run: normalizedRun,
      decision_index: state.completed_decisions + 1,
      context_digest,
      baseline_plan_digest,
      challenger_advice_digest,
      external_controller,
      authored_by_candidate,
    });
    this.#events.push(Object.freeze({
      kind: 'DECISION',
      sequence: this.#events.length + 1,
      decision: structuredClone(decision),
    }));
    await this.#persist();
    return decision;
  }

  async recordOutcome(outcome) {
    if (!this.#initialized) throw new Error('rsi_canary_controller_not_initialized');
    if (!plain(outcome) || outcome.schema !== RSI_EXTERNAL_CANARY_OUTCOME_SCHEMA || outcome.version !== 1) {
      throw new Error('rsi_canary_controller_outcome_invalid');
    }
    assertZero(outcome, 'outcome');
    const clone = structuredClone(outcome);
    delete clone.outcome_digest;
    if (digest(clone) !== exactDigest(outcome.outcome_digest, 'outcome')) throw new Error('rsi_canary_controller_outcome_digest_mismatch');
    const state = controllerState(this.#run, this.#events);
    if (state.pending_decision_index === null) throw new Error('rsi_canary_controller_no_pending_decision');
    const pending = this.#events.find((e) => e.kind === 'DECISION' && e.decision.decision_index === state.pending_decision_index);
    if (!pending || pending.decision.decision_digest !== outcome.decision_digest) throw new Error('rsi_canary_controller_outcome_decision_mismatch');
    if (outcome.run_digest !== pending.decision.run_digest || outcome.decision_index !== pending.decision.decision_index) {
      throw new Error('rsi_canary_controller_outcome_identity_mismatch');
    }
    this.#events.push(Object.freeze({
      kind: 'OUTCOME',
      sequence: this.#events.length + 1,
      outcome: structuredClone(outcome),
    }));
    await this.#persist();
    return zero({
      state: outcome.incident === true ? 'BASELINE_ONLY_LATCHED' : 'OUTCOME_RECORDED',
      outcome_digest: outcome.outcome_digest,
    });
  }

  pendingDecision() {
    if (!this.#initialized) throw new Error('rsi_canary_controller_not_initialized');
    const state = controllerState(this.#run, this.#events);
    if (state.pending_decision_index === null) return null;
    const event = this.#events.find((e) => e.kind === 'DECISION' && e.decision.decision_index === state.pending_decision_index);
    return event ? Object.freeze(structuredClone(event.decision)) : null;
  }

  snapshot() {
    const state = controllerState(this.#run, this.#events);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      run_digest: this.#run.run_digest,
      event_count: state.event_count,
      completed_decisions: state.completed_decisions,
      pending_decision_index: state.pending_decision_index,
      incident_latched: state.incident_latched,
      incident_can_be_cleared: false,
      first_blocking_decision_index: state.first_blocking_decision_index,
      first_blockers: Object.freeze([...state.first_blockers]),
      state: state.state,
      baseline_profile_remains_default: true,
      controller_can_activate_profile: false,
      controller_can_execute_browser_effects: false,
      controller_can_clear_incident_latch: false,
      authority_effect: false,
    });
  }
}

export function rsiExternalReadOnlyCanaryControllerTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.external-readonly-canary-controller-root.v1',
    version: 1,
    phase19_clean_durable_admission_required: true,
    external_harness_owns_environment_loop: true,
    canary_surface: 'READ_ONLY_DECISION_SUPPORT',
    one_pending_decision_max: true,
    prior_outcome_required_before_next_decision: true,
    fixed_budget_required: true,
    baseline_profile_remains_default: true,
    baseline_profile_is_mandatory_fallback: true,
    challenger_advice_non_executing: true,
    independent_controller_root_required: true,
    reward_hack_challenge_root_required: true,
    sealed_evaluator_root_required: true,
    security_holdout_hidden_from_candidate: true,
    reward_hack_challenges_hidden_from_candidate: true,
    from_scratch_replay_required: true,
    identity_drift_latches_baseline_only: true,
    ambiguous_outcome_latches_baseline_only: true,
    reward_hack_latches_baseline_only: true,
    security_holdout_failure_latches_baseline_only: true,
    verifier_integrity_failure_latches_baseline_only: true,
    incident_latch_fail_closed: true,
    incident_can_be_cleared: false,
    controller_can_activate_profile: false,
    controller_can_execute_browser_effects: false,
    candidate_can_drive_environment_loop: false,
    candidate_can_choose_evaluator: false,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, canary_controller_root_digest: digest(root) });
}
