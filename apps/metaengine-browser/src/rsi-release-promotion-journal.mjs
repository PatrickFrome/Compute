import crypto from 'node:crypto';

import {
  createFabricLedgerEvent,
  reduceFabricEffectLedger,
  fabricSha256,
  canonicalFabricJson,
} from './browser-fabric-effect-ledger.mjs';
import {
  evaluateBrowserFabricEffectDomain,
  BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP,
} from './browser-fabric-effect-domain-policy.mjs';
import {
  verifyBrowserFabricCapability,
  BROWSER_FABRIC_CAPABILITY_MAX_TTL_MS,
} from './browser-fabric-capability.mjs';
import { verifyRsiPublishedReleaseReconciliation } from './rsi-published-release-reconciliation.mjs';

export const RSI_RELEASE_PROMOTION_JOURNAL_INTENT_SCHEMA = 'metaengine.rsi.release-promotion-journal-intent.v1';
export const RSI_RELEASE_PROMOTION_CAPABILITY_ADMISSION_SCHEMA = 'metaengine.rsi.release-promotion-capability-admission.v1';
export const RSI_RELEASE_PROMOTION_JOURNAL_READBACK_SCHEMA = 'metaengine.rsi.release-promotion-journal-readback.v1';

const DOMAIN = 'RELEASE_PROMOTION';
const EFFECT_KIND = 'BROWSER_FABRIC_RELEASE_AUTHORITY_ADVANCE';
const ACTION = 'ADVANCE_RELEASE_AUTHORITY';
const AUDIENCE = 'RELEASE_PUBLISHER';
const SUBJECT_DEVICE = 'METAENGINE_RELEASE_CONTROL';
const BROWSER_CONTEXT_ID = 'release-control-plane';
const TARGET_ID = 'release-authority';
const SHA40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digestHex(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function digest(value) {
  return 'sha256:' + digestHex(value);
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40.test(out)) throw new Error('rsi_release_journal_' + label + '_sha_invalid');
  return out;
}

function exactHex(value, label) {
  const out = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!HEX64.test(out)) throw new Error('rsi_release_journal_' + label + '_digest_invalid');
  return out;
}

function positiveInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error('rsi_release_journal_' + label + '_invalid');
  return out;
}

function exactUtc(value, label) {
  const out = String(value || '');
  if (!UTC.test(out) || !Number.isFinite(Date.parse(out))) {
    throw new Error('rsi_release_journal_' + label + '_time_invalid');
  }
  return new Date(Date.parse(out)).toISOString();
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'release_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, field) && value[field] !== false) {
      throw new Error('rsi_release_journal_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_release_journal_' + label + '_automatic_retry_invalid');
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function domainProof() {
  const owner = BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP[DOMAIN];
  return Object.freeze({
    domain: DOMAIN,
    one_attempt_journal: true,
    independent_readback: true,
    automatic_retry_allowed: false,
    journal_owner: owner.journal_owner,
    actuator_owner: owner.actuator_owner,
    reconcile_owner: owner.reconcile_owner,
  });
}

function policyMaterial() {
  const owner = BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP[DOMAIN];
  return Object.freeze({
    schema: 'metaengine.rsi.release-promotion-journal-policy.v1',
    domain: DOMAIN,
    journal_owner: owner.journal_owner,
    actuator_owner: owner.actuator_owner,
    reconcile_owner: owner.reconcile_owner,
    one_attempt_only: true,
    verified_external_capability_required: true,
    max_capability_uses: 1,
    retry_budget: 0,
    independent_readback_required: true,
    ambiguous_reconciliation_only: true,
    candidate_can_mint_capability: false,
    rsi_can_invoke_release_publisher: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function capabilityExpectation(intent) {
  const targetIncarnation = intent.previous_authority_sha + ':' + intent.candidate_sha;
  const nonce = digestHex({
    reconciliation_digest: intent.reconciliation_digest,
    candidate_sha: intent.candidate_sha,
    target_incarnation: targetIncarnation,
  }).slice(0, 32);
  return Object.freeze({
    audience: AUDIENCE,
    subject_device: SUBJECT_DEVICE,
    effect_id: intent.effect_id,
    task_id: intent.task_id,
    claim_generation: intent.generation,
    browser_context_id: BROWSER_CONTEXT_ID,
    target_id: TARGET_ID,
    target_incarnation: targetIncarnation,
    action: ACTION,
    idempotency_key: intent.idempotency_key,
    policy_hash: intent.policy_hash,
    plan_digest: intent.plan_digest,
    nonce,
    max_uses: 1,
    retry_budget: 0,
    delegation_depth: 0,
    parent_capability_digest: null,
  });
}

export function createRsiReleasePromotionJournalIntent({
  published_release_reconciliation,
  generation = 1,
  occurred_at = new Date().toISOString(),
} = {}) {
  const reconciliation = verifyRsiPublishedReleaseReconciliation(published_release_reconciliation);
  const domain = evaluateBrowserFabricEffectDomain(DOMAIN, { existing_domain_proof: domainProof() });
  if (domain.allowed !== true || domain.reason !== 'EXISTING_EFFECT_DOMAIN_RECOGNIZED') {
    throw new Error('rsi_release_journal_effect_domain_not_recognized');
  }

  const generationValue = positiveInt(generation, 'generation');
  const occurredAt = exactUtc(occurred_at, 'occurred_at');
  const reconciliationHex = exactHex(reconciliation.reconciliation_digest, 'reconciliation');
  const policyHash = digestHex(policyMaterial());
  const effectId = 'release-promotion:' + reconciliation.candidate_sha.slice(0, 16) + ':' + reconciliationHex.slice(0, 16);
  const taskId = 'rsi-release-' + reconciliation.candidate_sha.slice(0, 20);
  const idempotencyKey = 'release-promotion:' + reconciliationHex;
  const desiredStateDigest = digestHex({
    candidate_sha: reconciliation.candidate_sha,
    previous_authority_sha: reconciliation.previous_authority_sha,
    release_tag: reconciliation.release_tag,
    release_version: reconciliation.release_version,
    installer_sha256: reconciliation.installer_sha256,
    installed_executable_sha256: reconciliation.installed_executable_sha256,
    manifest_sha256: reconciliation.manifest_sha256,
  });
  const traceId = digestHex({ effect_id: effectId, reconciliation_digest: reconciliation.reconciliation_digest }).slice(0, 32);

  const event = createFabricLedgerEvent({
    sequence: 1,
    effect_id: effectId,
    domain: DOMAIN,
    type: 'INTENT',
    occurred_at: occurredAt,
    previous_event_sha256: null,
    material: {
      effect_kind: EFFECT_KIND,
      idempotency_key: idempotencyKey,
      plan_digest: reconciliationHex,
      generation: generationValue,
      policy_hash: policyHash,
      non_idempotent: true,
      desired_state_digest: desiredStateDigest,
      trace_id: traceId,
    },
  });
  const reduced = reduceFabricEffectLedger([event]);
  if (reduced.ok !== true) throw new Error('rsi_release_journal_intent_ledger_invalid:' + reduced.reason);

  const core = zeroAuthority({
    schema: RSI_RELEASE_PROMOTION_JOURNAL_INTENT_SCHEMA,
    version: 1,
    state: 'INTENT_RECORDED_NO_CAPABILITY',
    reconciliation_digest: reconciliation.reconciliation_digest,
    candidate_id: reconciliation.candidate_id,
    candidate_sha: reconciliation.candidate_sha,
    previous_authority_sha: reconciliation.previous_authority_sha,
    release_tag: reconciliation.release_tag,
    release_version: reconciliation.release_version,
    effect_domain: DOMAIN,
    effect_id: effectId,
    task_id: taskId,
    generation: generationValue,
    idempotency_key: idempotencyKey,
    plan_digest: reconciliationHex,
    policy_hash: policyHash,
    desired_state_digest: desiredStateDigest,
    trace_id: traceId,
    intent_event: event,
    intent_event_sha256: event.event_sha256,
    capability_expectation: capabilityExpectation({
      reconciliation_digest: reconciliation.reconciliation_digest,
      previous_authority_sha: reconciliation.previous_authority_sha,
      candidate_sha: reconciliation.candidate_sha,
      effect_id: effectId,
      task_id: taskId,
      generation: generationValue,
      idempotency_key: idempotencyKey,
      policy_hash: policyHash,
      plan_digest: reconciliationHex,
    }),
    journal_owner: domain.ownership.journal_owner,
    actuator_owner: domain.ownership.actuator_owner,
    reconcile_owner: domain.ownership.reconcile_owner,
    existing_effect_domain: true,
    one_attempt_journal_required: true,
    independent_readback_required: true,
    external_signed_capability_required: true,
    candidate_can_mint_capability: false,
    rsi_can_mint_capability: false,
    rsi_can_invoke_release_publisher: false,
    attempt_recorded: false,
    authority_advance_authorized: false,
    release_publisher_invocation_authorized: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, journal_intent_digest: digest(core) });
}

export function verifyRsiReleasePromotionJournalIntent(intent) {
  if (
    !intent
    || typeof intent !== 'object'
    || Array.isArray(intent)
    || intent.schema !== RSI_RELEASE_PROMOTION_JOURNAL_INTENT_SCHEMA
    || intent.version !== 1
  ) throw new Error('rsi_release_journal_intent_schema_invalid');
  assertZeroAuthority(intent, 'intent');

  if (
    intent.state !== 'INTENT_RECORDED_NO_CAPABILITY'
    || intent.effect_domain !== DOMAIN
    || intent.journal_owner !== 'RELEASE_PROMOTION_JOURNAL'
    || intent.actuator_owner !== 'RELEASE_PUBLISHER'
    || intent.reconcile_owner !== 'RELEASE_PROMOTION_RECONCILER'
    || intent.existing_effect_domain !== true
    || intent.one_attempt_journal_required !== true
    || intent.independent_readback_required !== true
    || intent.external_signed_capability_required !== true
    || intent.candidate_can_mint_capability !== false
    || intent.rsi_can_mint_capability !== false
    || intent.rsi_can_invoke_release_publisher !== false
    || intent.attempt_recorded !== false
    || intent.authority_advance_authorized !== false
    || intent.release_publisher_invocation_authorized !== false
    || intent.physical_effect_replay_allowed !== false
  ) throw new Error('rsi_release_journal_intent_policy_invalid');

  exactSha(intent.candidate_sha, 'candidate');
  exactSha(intent.previous_authority_sha, 'previous_authority');
  exactHex(intent.reconciliation_digest, 'reconciliation');
  exactHex(intent.plan_digest, 'plan');
  exactHex(intent.policy_hash, 'policy');
  exactHex(intent.desired_state_digest, 'desired_state');
  exactHex(intent.intent_event_sha256, 'intent_event');
  positiveInt(intent.generation, 'generation');

  const reduced = reduceFabricEffectLedger([intent.intent_event]);
  if (reduced.ok !== true) throw new Error('rsi_release_journal_intent_event_invalid:' + reduced.reason);
  const projection = reduced.projection[intent.effect_id];
  if (
    !projection
    || projection.domain !== DOMAIN
    || projection.intent?.plan_digest !== intent.plan_digest
    || projection.intent?.policy_hash !== intent.policy_hash
    || projection.intent?.idempotency_key !== intent.idempotency_key
    || projection.intent?.desired_state_digest !== intent.desired_state_digest
    || projection.attempt !== null
  ) throw new Error('rsi_release_journal_intent_projection_mismatch');

  const expectedCapability = capabilityExpectation(intent);
  if (JSON.stringify(stable(expectedCapability)) !== JSON.stringify(stable(intent.capability_expectation))) {
    throw new Error('rsi_release_journal_capability_expectation_mismatch');
  }

  const clone = structuredClone(intent);
  const claimed = exactHex(clone.journal_intent_digest, 'journal_intent');
  delete clone.journal_intent_digest;
  if (digestHex(clone) !== claimed) throw new Error('rsi_release_journal_intent_digest_mismatch');
  return intent;
}

export function admitRsiReleasePromotionCapability({
  journal_intent,
  capability_envelope,
  trusted_public_keys = {},
  now = new Date(),
} = {}) {
  const intent = verifyRsiReleasePromotionJournalIntent(journal_intent);
  const verified = verifyBrowserFabricCapability({
    envelope: capability_envelope,
    trusted_public_keys,
    expected: intent.capability_expectation,
    now,
    max_ttl_ms: BROWSER_FABRIC_CAPABILITY_MAX_TTL_MS,
  });
  if (verified.ok !== true) throw new Error('rsi_release_journal_capability_rejected:' + verified.reason);

  const event = createFabricLedgerEvent({
    sequence: 2,
    effect_id: intent.effect_id,
    domain: DOMAIN,
    type: 'CAPABILITY',
    occurred_at: new Date(now instanceof Date ? now.getTime() : Number(now)).toISOString(),
    previous_event_sha256: intent.intent_event.event_sha256,
    material: verified.ledger_material,
  });
  const reduced = reduceFabricEffectLedger([intent.intent_event, event]);
  if (reduced.ok !== true) throw new Error('rsi_release_journal_capability_event_invalid:' + reduced.reason);

  const core = zeroAuthority({
    schema: RSI_RELEASE_PROMOTION_CAPABILITY_ADMISSION_SCHEMA,
    version: 1,
    journal_intent_digest: intent.journal_intent_digest,
    effect_id: intent.effect_id,
    candidate_sha: intent.candidate_sha,
    previous_authority_sha: intent.previous_authority_sha,
    capability_id: capability_envelope.claims.capability_id,
    capability_digest: verified.capability_digest,
    capability_event: event,
    capability_event_sha256: event.event_sha256,
    external_signed_capability_verified: true,
    single_use: true,
    max_uses: 1,
    retry_budget: 0,
    delegation_depth: 0,
    rsi_can_invoke_release_publisher: false,
    release_publisher_invocation_authorized_by_rsi: false,
    attempt_recorded: false,
    physical_effect_attempted: false,
    authority_advance_performed: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, admission_digest: digest(core) });
}

export function verifyRsiReleasePromotionJournalEvents({
  journal_intent,
  events,
} = {}) {
  const intent = verifyRsiReleasePromotionJournalIntent(journal_intent);
  if (!Array.isArray(events) || events.length < 1) throw new Error('rsi_release_journal_events_invalid');
  if (JSON.stringify(events[0]) !== JSON.stringify(intent.intent_event)) {
    throw new Error('rsi_release_journal_first_event_not_exact_intent');
  }
  const reduced = reduceFabricEffectLedger(events);
  if (reduced.ok !== true) throw new Error('rsi_release_journal_ledger_invalid:' + reduced.reason);
  const projection = reduced.projection[intent.effect_id];
  if (!projection) throw new Error('rsi_release_journal_projection_missing');

  let state = 'INTENT_RECORDED_NO_CAPABILITY';
  if (projection.capability && !projection.attempt) state = 'CAPABILITY_VERIFIED_NOT_ATTEMPTED';
  if (projection.attempt && !projection.outcome) state = 'ATTEMPTED_READBACK_REQUIRED';
  if (projection.outcome?.state === 'AMBIGUOUS') state = 'AMBIGUOUS_RECONCILIATION_ONLY';
  if (projection.outcome?.state === 'CONFIRMED') state = 'CONFIRMED_BY_INDEPENDENT_READBACK';
  if (projection.outcome?.state === 'ABSENT_PROVEN') state = 'ABSENCE_PROVEN_BY_INDEPENDENT_READBACK';
  if (['CONFLICT','CORRUPT'].includes(projection.outcome?.state)) state = 'TERMINAL_FAIL_CLOSED';

  const core = zeroAuthority({
    schema: RSI_RELEASE_PROMOTION_JOURNAL_READBACK_SCHEMA,
    version: 1,
    journal_intent_digest: intent.journal_intent_digest,
    effect_id: intent.effect_id,
    candidate_sha: intent.candidate_sha,
    previous_authority_sha: intent.previous_authority_sha,
    state,
    event_count: events.length,
    ledger_projection_sha256: reduced.projection_sha256,
    chain_head_sha256: reduced.per_effect_chain_heads[intent.effect_id],
    capability_present: projection.capability != null,
    attempt_present: projection.attempt != null,
    terminal: projection.terminal === true,
    terminal_ambiguous: projection.terminal_ambiguous === true,
    ambiguity_reconciled: projection.ambiguity_reconciled === true,
    reconciliation_required: projection.reconciliation_required === true,
    confirmed_external_effect: projection.outcome?.state === 'CONFIRMED',
    release_authority_mutation_inferred_from_delivery: false,
    independent_readback_required: true,
    second_attempt_allowed: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, readback_digest: digest(core) });
}

export function rsiReleasePromotionJournalTrustRootSnapshot() {
  const owner = BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP[DOMAIN];
  const root = {
    schema: 'metaengine.rsi.release-promotion-journal-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-release-promotion-journal.mjs',
    fabric_ledger_path: 'apps/metaengine-browser/src/browser-fabric-effect-ledger.mjs',
    capability_verifier_path: 'apps/metaengine-browser/src/browser-fabric-capability.mjs',
    domain_policy_path: 'apps/metaengine-browser/src/browser-fabric-effect-domain-policy.mjs',
    effect_domain: DOMAIN,
    journal_owner: owner.journal_owner,
    actuator_owner: owner.actuator_owner,
    reconcile_owner: owner.reconcile_owner,
    existing_effect_domain_only: true,
    one_attempt_only: true,
    verified_external_capability_required: true,
    capability_max_uses: 1,
    capability_retry_budget: 0,
    independent_readback_required: true,
    ambiguous_reconciliation_only: true,
    candidate_can_mint_capability: false,
    rsi_can_mint_capability: false,
    rsi_can_invoke_release_publisher: false,
    release_authority_mutation_inferred_from_delivery: false,
    physical_effect_replay_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, release_promotion_journal_root_digest: digest(root) });
}
