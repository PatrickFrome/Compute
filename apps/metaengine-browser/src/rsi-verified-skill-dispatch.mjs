import crypto from 'node:crypto';
import { AGENT_RESULT_PROTOCOL_SCHEMA, AGENT_RESULT_CLAIM_MARKER } from './agent-result-protocol.mjs';
import { AGENT_PLATFORM_ID, AGENT_PLATFORM_MODEL } from './browser-agent-platform.mjs';
import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';

// This is an implementation adapter, NOT an approval manifest or a trust root.
// The shipped code contains no approved skill. The existing adopted library,
// active governance and exact-context credited evidence must authorize selection.
// No library/model/page text is loaded as instructions and no code is evaluated.
const INSTRUCTIONS = [
  'VERIFIER EVIDENCE CHECKLIST — advisory; existing task scope and permissions remain unchanged.',
  'Compare each requested deliverable with independently observed evidence; keep unverified worker claims separate.',
  'For each acceptance claim, identify the exact artifact or test result and its source revision. Missing or contradictory evidence is a blocker, not a pass.',
  `Use the existing ${AGENT_RESULT_CLAIM_MARKER} protocol. Report checks not run and unresolved limitations. Do not infer success from dispatch, model confidence, or this checklist.`,
].join('\n');
const sha = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => `sha256:${sha(JSON.stringify(stable(value)))}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const MAX_PENDING = 128;
const STAGES = new Set(['SELECTED', 'LOADED', 'APPLIED_TO_PROMPT', 'DELIVERY_OBSERVED', 'OUTCOME_OBSERVED', 'TRACKING_RELEASED']);
const EFFECT_STATES = new Set(['PROVEN_COMPOSER_CLEARED', 'PROVEN_NEW_CONVERSATION', 'PROVEN_GENERATING']);
const OUTCOME_STATES = new Set(['COMPLETED', 'FAILED', 'BLOCKED', 'RESULT_READY', 'AMBIGUOUS']);
export const RSI_DISPATCH_VERIFIER_IMPLEMENTATION = Object.freeze({
  skill_id: 'metaengine.verifier.evidence-checklist',
  skill_version: 1,
  role: 'VERIFIER',
  capabilities: Object.freeze(['CHECK_TYPED_OUTPUT', 'READ_VERIFIED_CONTEXT']),
  input_schema_digest: digest({ schema: 'metaengine.devos.task.v1', role: ['CRITIC', 'FALSIFIER'], adapter_version: 1 }),
  output_schema_digest: digest({ schema: AGENT_RESULT_PROTOCOL_SCHEMA, disposition: ['ACCEPT', 'REJECT', 'BLOCKED'], adapter_version: 1 }),
  implementation_digest: `sha256:${sha(INSTRUCTIONS)}`,
});

export function rsiVerifierDispatchContext(lease, sourceSha) {
  if (!SHA.test(sourceSha) || !UUID.test(lease?.task_id || '')
    || !Number.isSafeInteger(lease?.lease_generation) || lease.lease_generation < 1
    || !['CRITIC', 'FALSIFIER'].includes(lease.role)
    || lease?.task_spec?.schema !== 'metaengine.devos.task.v1') return null;
  // Hash task data; never interpret task text as a skill id, approval or policy.
  return Object.freeze({
    context_id: `dispatch:${lease.task_id}:${lease.lease_generation}`,
    task_signature_digest: digest({ role: lease.role, task_spec: lease.task_spec }),
    environment_fingerprint: `devos-${AGENT_PLATFORM_ID.toLowerCase()}-verifier-v1:${sourceSha}`,
    model_family: AGENT_PLATFORM_MODEL,
    challenge_family: 'DEVOS_VERIFIER_TASK',
    required_role: RSI_DISPATCH_VERIFIER_IMPLEMENTATION.role,
    required_capabilities: RSI_DISPATCH_VERIFIER_IMPLEMENTATION.capabilities,
    input_schema_digest: RSI_DISPATCH_VERIFIER_IMPLEMENTATION.input_schema_digest,
    output_schema_digest: RSI_DISPATCH_VERIFIER_IMPLEMENTATION.output_schema_digest,
    max_selected: 1, exploration_slots: 0, external_planner: true, authored_by_candidate: false,
  });
}

function leaseKey(lease) {
  return digest({ task_id: lease.task_id, lease_generation: lease.lease_generation, agent_id: lease.agent_id,
    agent_generation_epoch: lease.agent_generation_epoch, tab_id: lease.tab_id, target_id: lease.target_id });
}
function readCurrent(runtime) {
  const readback = runtime.verifiedSkillStateReadback();
  const library = verifyRsiVerifiedSkillLibrary(readback.library);
  const governance = verifyRsiSkillLibraryGovernance(readback.governance, library);
  return { library, governance };
}
function supports(entry, sourceSha) {
  const impl = RSI_DISPATCH_VERIFIER_IMPLEMENTATION;
  const capsule = entry.capsule;
  return entry.skill_id === impl.skill_id && entry.skill_version === impl.skill_version
    && entry.source_candidate_sha === sourceSha && entry.role === impl.role
    && capsule.implementation_digest === impl.implementation_digest
    && entry.input_schema_digest === impl.input_schema_digest && entry.output_schema_digest === impl.output_schema_digest
    && JSON.stringify([...entry.capabilities].sort()) === JSON.stringify(impl.capabilities)
    && capsule.deterministic_interface === true && entry.max_context_tokens >= INSTRUCTIONS.length;
}

// The runtime ledger records lineage only. No event, including COMPLETED,
// satisfies the independent credit/acceptance gates or promotes a library.
export function normalizeRsiSkillDispatchObservation(raw) {
  if (!STAGES.has(raw?.stage)) throw new Error('rsi_skill_dispatch_stage_invalid');
  const result = { schema: 'metaengine.rsi.skill-dispatch-observation.v1', stage: raw.stage };
  for (const key of ['dispatch_digest', 'task_signature_digest', 'plan_digest', 'library_digest', 'governance_digest',
    'skill_digest', 'evidence_digest', 'implementation_digest']) {
    if (!DIGEST.test(raw[key] || '')) throw new Error(`rsi_skill_dispatch_${key}_invalid`);
    result[key] = raw[key];
  }
  if (!UUID.test(raw.task_id || '') || !Number.isSafeInteger(raw.lease_generation) || raw.lease_generation < 1
    || !Number.isSafeInteger(raw.skill_version) || raw.skill_version < 1) throw new Error('rsi_skill_dispatch_binding_invalid');
  Object.assign(result, { task_id: raw.task_id, lease_generation: raw.lease_generation, skill_version: raw.skill_version });
  if (['APPLIED_TO_PROMPT', 'DELIVERY_OBSERVED', 'OUTCOME_OBSERVED', 'TRACKING_RELEASED'].includes(raw.stage)) {
    if (!/^[0-9a-f]{64}$/.test(raw.prompt_sha256 || '')) throw new Error('rsi_skill_dispatch_prompt_hash_invalid');
    result.prompt_sha256 = raw.prompt_sha256;
  }
  if (raw.stage === 'DELIVERY_OBSERVED') {
    if (!EFFECT_STATES.has(raw.effect_state) || !/^[0-9a-f]{64}$/.test(raw.conversation_url_sha256 || '')) throw new Error('rsi_skill_dispatch_delivery_invalid');
    Object.assign(result, { effect_state: raw.effect_state, conversation_url_sha256: raw.conversation_url_sha256 });
  }
  if (raw.stage === 'TRACKING_RELEASED') {
    if (!['OBSERVATION_CACHE_CAPACITY', 'COMPOSITION_DISCARDED'].includes(raw.release_reason)) throw new Error('rsi_skill_dispatch_release_reason_invalid');
    Object.assign(result, { release_reason: raw.release_reason, outcome_status: 'UNOBSERVED',
      task_lifecycle_changed: false, effect_state_changed: false, unknown_effect_resolved: false, delivery_observed: raw.delivery_observed === true });
    if (result.delivery_observed) {
      if (!EFFECT_STATES.has(raw.effect_state) || !/^[0-9a-f]{64}$/.test(raw.conversation_url_sha256 || '')) throw new Error('rsi_skill_dispatch_release_delivery_invalid');
      Object.assign(result, { effect_state: raw.effect_state, conversation_url_sha256: raw.conversation_url_sha256 });
    }
  }
  if (raw.stage === 'OUTCOME_OBSERVED') {
    if (!OUTCOME_STATES.has(raw.outcome_state)) throw new Error('rsi_skill_dispatch_outcome_invalid');
    result.outcome_state = raw.outcome_state;
  }
  return Object.freeze({ ...result, application_means_prompt_composition_only: true,
    independent_skill_effect_accepted: false, outcome_is_skill_usage_evidence: false, credit_assigned: false, weight_training: false,
    execution_authority: false, promotion_authority: false, self_update_authority: false,
    scheduler_authority: false, automatic_retry_allowed: false, authority_effect: false });
}

export class RsiVerifiedSkillDispatch {
  #ensureRuntime; #allowsRouting; #pending = new Map(); #prepared = new WeakMap();
  #trackingTail = Promise.resolve();
  constructor({ ensureRuntime, allowsRouting } = {}) {
    if (typeof ensureRuntime !== 'function' || typeof allowsRouting !== 'function') throw new Error('rsi_skill_dispatch_dependencies_required');
    this.#ensureRuntime = ensureRuntime;
    this.#allowsRouting = allowsRouting;
  }
  #current(row) {
    if (this.#allowsRouting() !== true || row.runtime.snapshot().state !== 'READY' || row.runtime.snapshot().source_sha !== row.source_sha) return false;
    const current = readCurrent(row.runtime);
    return current.library.library_digest === row.lineage.library_digest
      && current.governance.governance_digest === row.lineage.governance_digest
      && current.governance.entries.some(entry => entry.skill_digest === row.lineage.skill_digest && entry.active_for_composition === true);
  }
  async prepare(lease) {
    try {
      if (!['CRITIC', 'FALSIFIER'].includes(lease?.role)) return null;
      const runtime = await this.#ensureRuntime();
      if (this.#allowsRouting() !== true || runtime.snapshot().state !== 'READY') return null;
      const source = runtime.snapshot().source_sha;
      const context = rsiVerifierDispatchContext(lease, source);
      if (!context) return null;
      const { library, governance } = readCurrent(runtime);
      const plan = await runtime.routeVerifiedSkills(context);
      if (plan.library_digest !== library.library_digest || plan.governance_digest !== governance.governance_digest
        || plan.routing_is_execution_authority !== false || plan.selected.length !== 1) return null;
      const selected = plan.selected[0];
      // No exploratory activation or synthetic success-from-send fallback.
      if (selected.reason !== 'CONTEXT_EVIDENCE' || !(selected.context_utility?.exact_positive_count >= 1)
        || selected.context_utility?.exact_negative_count !== 0) return null;
      const entry = library.entries.find(row => row.skill_digest === selected.skill_digest);
      if (!entry || !supports(entry, source)) return null;
      const lineage = { dispatch_digest: leaseKey(lease), task_id: lease.task_id, lease_generation: lease.lease_generation,
        task_signature_digest: context.task_signature_digest, plan_digest: plan.plan_digest,
        library_digest: library.library_digest, governance_digest: governance.governance_digest,
        skill_digest: entry.skill_digest, skill_version: entry.skill_version, evidence_digest: entry.evidence_digest,
        implementation_digest: entry.capsule.implementation_digest };
      const row = { runtime, source_sha: source, lineage };
      if (!this.#current(row)) return null;
      await runtime.recordSkillDispatchObservation({ ...lineage, stage: 'SELECTED' });
      await runtime.recordSkillDispatchObservation({ ...lineage, stage: 'LOADED' });
      if (!this.#current(row)) return null;
      const selection = Object.freeze({ block: `${INSTRUCTIONS}\nSkill version: ${entry.skill_version}; digest: ${entry.skill_digest}` });
      this.#prepared.set(selection, row);
      return selection;
    } catch {
      // Skill availability/approval never gates an otherwise authorized task.
      return null;
    }
  }
  current(selection) {
    try { const row = this.#prepared.get(selection); return Boolean(row && this.#current(row)); } catch { return false; }
  }
  // Serialize bookkeeping only, never tasks/effects. Awaited ledger writes can
  // otherwise make simultaneous insertions exceed the bounded observation map.
  #track(operation) {
    const pending = this.#trackingTail.then(operation);
    this.#trackingTail = pending.catch(() => {});
    return pending;
  }
  async #release(key, reason, recovered = null) {
    const row = this.#pending.get(key) || recovered;
    if (!row) return;
    try {
      await row.runtime.recordSkillDispatchObservation({ ...row.lineage, stage: 'TRACKING_RELEASED', release_reason: reason });
    } finally {
      // APPLIED_TO_PROMPT was durable before insertion. Even a failed release
      // audit cannot retain a permanent availability veto. Removal is metadata
      // cleanup only: no task completion, effect resolution, retry or credit.
      this.#pending.delete(key);
    }
  }
  async #findObservation(lease, { allowComposed = false, promptSha256 = null } = {}) {
    if (!['CRITIC', 'FALSIFIER'].includes(lease?.role)) return null;
    const key = leaseKey(lease);
    const cached = this.#pending.get(key);
    if (cached) return cached;
    // Recovery is deliberately bounded to the runtime's recent verified ledger
    // window. An older/absent observation stays unknown, never invented.
    const runtime = await this.#ensureRuntime();
    const lineage = runtime.skillDispatchObservationReadback(key);
    if (!lineage || !['APPLIED_TO_PROMPT', 'DELIVERY_OBSERVED', 'TRACKING_RELEASED'].includes(lineage.stage)
      || lineage.release_reason === 'COMPOSITION_DISCARDED') return null;
    const delivered = lineage.stage === 'DELIVERY_OBSERVED' || lineage.delivery_observed === true;
    if (!allowComposed && !delivered && lineage.prompt_sha256 !== promptSha256) return null;
    return { runtime, source_sha: runtime.snapshot().source_sha, lineage };
  }
  async applied(lease, selection, prompt) {
    const row = this.#prepared.get(selection);
    if (!row || leaseKey(lease) !== row.lineage.dispatch_digest || !this.current(selection)
      || rsiVerifierDispatchContext(lease, row.source_sha)?.task_signature_digest !== row.lineage.task_signature_digest
      || !String(prompt).endsWith(`\n${selection.block}`)) return false;
    return this.#track(async () => {
      if (!this.current(selection)) return false;
      const key = row.lineage.dispatch_digest;
      while (!this.#pending.has(key) && this.#pending.size >= MAX_PENDING) {
        await this.#release(this.#pending.keys().next().value, 'OBSERVATION_CACHE_CAPACITY');
      }
      row.lineage = { ...row.lineage, prompt_sha256: sha(prompt) };
      await row.runtime.recordSkillDispatchObservation({ ...row.lineage, stage: 'APPLIED_TO_PROMPT' });
      this.#pending.set(key, row);
      return true;
    });
  }
  discard(lease) {
    // The caller's baseline fallback never waits for optional audit cleanup.
    return this.#track(async () => {
      const row = await this.#findObservation(lease, { allowComposed: true });
      await this.#release(leaseKey(lease), 'COMPOSITION_DISCARDED', row);
    }).catch(() => false);
  }
  delivery(lease, proof) {
    return this.#track(async () => {
      const row = await this.#findObservation(lease, { promptSha256: proof?.prompt_sha256 });
      if (!row || row.lineage.prompt_sha256 !== proof?.prompt_sha256) return false;
      await row.runtime.recordSkillDispatchObservation({ ...row.lineage, stage: 'DELIVERY_OBSERVED',
        effect_state: proof.effect_state, conversation_url_sha256: proof.conversation_url_sha256 });
      row.lineage = { ...row.lineage, delivery_observed: true, effect_state: proof.effect_state, conversation_url_sha256: proof.conversation_url_sha256 };
      return true;
    });
  }
  outcome(lease, outcomeState) {
    return this.#track(async () => {
      if (!OUTCOME_STATES.has(outcomeState)) return false;
      const row = await this.#findObservation(lease);
      if (!row) return false;
      const delivered = row.lineage.stage === 'DELIVERY_OBSERVED' || row.lineage.delivery_observed === true;
      // A retained pre-send row is no stronger than a recovered one: a new
      // cycle may legitimately send a baseline prompt after pre-barrier failure.
      // Only ambiguity of this still-tracked attempt can be noted without a
      // delivery binding; successful/blocked task results remain unattributed.
      if (!delivered && outcomeState !== 'AMBIGUOUS') return false;
      await row.runtime.recordSkillDispatchObservation({ ...row.lineage, stage: 'OUTCOME_OBSERVED', outcome_state: outcomeState });
      this.#pending.delete(leaseKey(lease));
      return true;
    });
  }
  snapshot() {
    return Object.freeze({ pending_observation_count: this.#pending.size, max_pending_observations: MAX_PENDING,
      cache_is_task_or_effect_authority: false, unknown_effect_resolved: false, authority_effect: false });
  }
}
