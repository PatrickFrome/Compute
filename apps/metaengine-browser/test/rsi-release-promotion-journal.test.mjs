import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiReleasePromotionJournalIntent,
  verifyRsiReleasePromotionJournalIntent,
  admitRsiReleasePromotionCapability,
  verifyRsiReleasePromotionJournalEvents,
  rsiReleasePromotionJournalTrustRootSnapshot,
} from '../src/rsi-release-promotion-journal.mjs';
import {
  createFabricLedgerEvent,
  fabricCapabilitySigningBytes,
} from '../src/browser-fabric-effect-ledger.mjs';
import {
  fabricCapabilityDigest,
  BROWSER_FABRIC_CAPABILITY_SCHEMA,
  BROWSER_FABRIC_CAPABILITY_ALG,
} from '../src/browser-fabric-capability.mjs';

const CANDIDATE_ID='candidate_sha256_'+'c'.repeat(64);
const CANDIDATE_SHA='b'.repeat(40);
const PARENT_SHA='a'.repeat(40);
const RECONCILIATION_DIGEST='sha256:'+'1'.repeat(64);
const NOW='2026-09-18T18:30:00.000Z';

function reconciliation(overrides={}) {
  const core={
    schema:'metaengine.rsi.published-release-reconciliation.v1',
    version:1,
    state:'READY_FOR_EXTERNAL_AUTHORITY_ADVANCE_REVIEW',
    release_handoff_intent_digest:'sha256:'+'2'.repeat(64),
    episode_promotion_review_digest:'sha256:'+'3'.repeat(64),
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE_SHA,
    parent_sha:PARENT_SHA,
    previous_authority_sha:PARENT_SHA,
    candidate_identity_frozen:true,
    release_source_sha_exact:true,
    release_tag:'v0.7.0-dev.99999999999.1',
    release_version:'0.7.0-dev.99999999999.1',
    installer_sha256:'sha256:'+'4'.repeat(64),
    installed_executable_sha256:'sha256:'+'5'.repeat(64),
    manifest_sha256:'sha256:'+'6'.repeat(64),
    immutable_evidence_verifier_id:'release-lock-verifier-v1',
    provenance_verifier_id:'slsa-verifier-v1',
    ancestry_verifier_id:'ancestry-verifier-v1',
    browser_fabric_release_gate_schema:'metaengine.browser-fabric.release-authority-gate.v1',
    browser_fabric_release_gate_digest:'sha256:'+'7'.repeat(64),
    promotion_unit:'IMMUTABLE_VERIFIED_RELEASE',
    immutable_release_verified:true,
    immutable_release_attestation_verified:true,
    slsa_provenance_verified:true,
    source_fast_forward_verified:true,
    installed_executable_binding_verified:true,
    authority_advance_candidate:true,
    authority_advance_authorized:false,
    separate_journaled_promotion_effect_required:true,
    release_authority_mutation_performed:false,
    self_update_handoff_authorized:false,
    direct_install_authorized:false,
    one_attempt_physical_effect_required:true,
    ambiguous_effect_requires_reconciliation:true,
    physical_effect_replay_allowed:false,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    release_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
    ...overrides,
  };
  const copy=structuredClone(core);
  delete copy.reconciliation_digest;
  return {...core,reconciliation_digest:RECONCILIATION_DIGEST};
}

function exactIntent() {
  return createRsiReleasePromotionJournalIntent({
    published_release_reconciliation:reconciliation(),
    generation:1,
    occurred_at:NOW,
  });
}

function signedCapability(intent,{deadline='2026-09-18T18:34:00.000Z'}={}) {
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const expectation=intent.capability_expectation;
  const claims={
    schema:BROWSER_FABRIC_CAPABILITY_SCHEMA,
    capability_id:'release-promotion-capability-v1',
    issuer:'METAENGINE_EXTERNAL_RELEASE_AUTHORITY',
    audience:expectation.audience,
    subject_device:expectation.subject_device,
    effect_id:expectation.effect_id,
    task_id:expectation.task_id,
    claim_generation:expectation.claim_generation,
    browser_context_id:expectation.browser_context_id,
    target_id:expectation.target_id,
    target_incarnation:expectation.target_incarnation,
    action:expectation.action,
    issued_at:'2026-09-18T18:29:59.000Z',
    not_before:'2026-09-18T18:29:59.000Z',
    deadline,
    idempotency_key:expectation.idempotency_key,
    policy_hash:expectation.policy_hash,
    plan_digest:expectation.plan_digest,
    nonce:expectation.nonce,
    max_uses:1,
    retry_budget:0,
    delegation_depth:0,
    parent_capability_digest:null,
  };
  const envelope={
    alg:BROWSER_FABRIC_CAPABILITY_ALG,
    key_id:'release-authority-key-v1',
    claims,
    signature:crypto.sign(null,fabricCapabilitySigningBytes(claims),privateKey).toString('base64url'),
  };
  return {envelope,trusted_public_keys:{'release-authority-key-v1':publicKey}};
}

function fullConfirmedEvents(intent,admission) {
  const capabilityEvent=admission.capability_event;
  const attempt=createFabricLedgerEvent({
    sequence:3,effect_id:intent.effect_id,domain:'RELEASE_PROMOTION',type:'ATTEMPT',
    occurred_at:'2026-09-18T18:30:01.000Z',previous_event_sha256:capabilityEvent.event_sha256,
    material:{
      attempt_id:'release-promotion-attempt-v1',
      actuator_id:'RELEASE_PUBLISHER',
      dispatched_at:'2026-09-18T18:30:00.500Z',
      capability_digest:admission.capability_digest,
      nonce:intent.capability_expectation.nonce,
      target_incarnation:intent.capability_expectation.target_incarnation,
    },
  });
  const readback=createFabricLedgerEvent({
    sequence:4,effect_id:intent.effect_id,domain:'RELEASE_PROMOTION',type:'READBACK',
    occurred_at:'2026-09-18T18:30:03.000Z',previous_event_sha256:attempt.event_sha256,
    material:{
      observer_id:'RELEASE_PROMOTION_RECONCILER',
      observer_independent:true,
      observed_at:'2026-09-18T18:30:02.500Z',
      evidence_digest:'8'.repeat(64),
      observed_state:'AUTHORITY_EXACT_CANDIDATE',
      target_incarnation:intent.capability_expectation.target_incarnation,
    },
  });
  const outcome=createFabricLedgerEvent({
    sequence:5,effect_id:intent.effect_id,domain:'RELEASE_PROMOTION',type:'OUTCOME',
    occurred_at:'2026-09-18T18:30:04.000Z',previous_event_sha256:readback.event_sha256,
    material:{
      state:'CONFIRMED',
      reason:'INDEPENDENT_AUTHORITY_READBACK_EXACT',
      readback_evidence_digest:'8'.repeat(64),
      automatic_retry_allowed:false,
    },
  });
  return [intent.intent_event,capabilityEvent,attempt,readback,outcome];
}

test('release-promotion intent binds exact reconciliation into the pre-authority fabric journal',()=>{
  const intent=exactIntent();
  verifyRsiReleasePromotionJournalIntent(intent);
  assert.equal(intent.effect_domain,'RELEASE_PROMOTION');
  assert.equal(intent.journal_owner,'RELEASE_PROMOTION_JOURNAL');
  assert.equal(intent.actuator_owner,'RELEASE_PUBLISHER');
  assert.equal(intent.reconcile_owner,'RELEASE_PROMOTION_RECONCILER');
  assert.equal(intent.external_signed_capability_required,true);
  assert.equal(intent.candidate_can_mint_capability,false);
  assert.equal(intent.rsi_can_mint_capability,false);
  assert.equal(intent.rsi_can_invoke_release_publisher,false);
  assert.equal(intent.attempt_recorded,false);
  assert.equal(intent.release_authority,false);
  assert.equal(intent.physical_effect_replay_allowed,false);
});

test('only an exact externally signed single-use capability can advance journal state to capability-verified',()=>{
  const intent=exactIntent();
  const signed=signedCapability(intent);
  const admission=admitRsiReleasePromotionCapability({
    journal_intent:intent,
    capability_envelope:signed.envelope,
    trusted_public_keys:signed.trusted_public_keys,
    now:new Date(NOW),
  });
  assert.equal(admission.external_signed_capability_verified,true);
  assert.equal(admission.single_use,true);
  assert.equal(admission.max_uses,1);
  assert.equal(admission.retry_budget,0);
  assert.equal(admission.rsi_can_invoke_release_publisher,false);
  assert.equal(admission.release_publisher_invocation_authorized_by_rsi,false);
  assert.equal(admission.physical_effect_attempted,false);
  assert.equal(admission.authority_advance_performed,false);

  const readback=verifyRsiReleasePromotionJournalEvents({
    journal_intent:intent,
    events:[intent.intent_event,admission.capability_event],
  });
  assert.equal(readback.state,'CAPABILITY_VERIFIED_NOT_ATTEMPTED');
  assert.equal(readback.attempt_present,false);
});

test('confirmed promotion requires one attempt plus independent exact readback',()=>{
  const intent=exactIntent();
  const signed=signedCapability(intent);
  const admission=admitRsiReleasePromotionCapability({
    journal_intent:intent,
    capability_envelope:signed.envelope,
    trusted_public_keys:signed.trusted_public_keys,
    now:new Date(NOW),
  });
  const readback=verifyRsiReleasePromotionJournalEvents({
    journal_intent:intent,
    events:fullConfirmedEvents(intent,admission),
  });
  assert.equal(readback.state,'CONFIRMED_BY_INDEPENDENT_READBACK');
  assert.equal(readback.capability_present,true);
  assert.equal(readback.attempt_present,true);
  assert.equal(readback.terminal,true);
  assert.equal(readback.confirmed_external_effect,true);
  assert.equal(readback.release_authority_mutation_inferred_from_delivery,false);
  assert.equal(readback.second_attempt_allowed,false);
  assert.equal(readback.physical_effect_replay_allowed,false);
});

test('ambiguous promotion attempt can only reconcile through new readback and never permits a second attempt',()=>{
  const intent=exactIntent();
  const signed=signedCapability(intent);
  const admission=admitRsiReleasePromotionCapability({
    journal_intent:intent,
    capability_envelope:signed.envelope,
    trusted_public_keys:signed.trusted_public_keys,
    now:new Date(NOW),
  });
  const capabilityEvent=admission.capability_event;
  const attempt=createFabricLedgerEvent({
    sequence:3,effect_id:intent.effect_id,domain:'RELEASE_PROMOTION',type:'ATTEMPT',
    occurred_at:'2026-09-18T18:30:01.000Z',previous_event_sha256:capabilityEvent.event_sha256,
    material:{
      attempt_id:'release-promotion-attempt-ambiguous',
      actuator_id:'RELEASE_PUBLISHER',
      dispatched_at:'2026-09-18T18:30:00.500Z',
      capability_digest:admission.capability_digest,
      nonce:intent.capability_expectation.nonce,
      target_incarnation:intent.capability_expectation.target_incarnation,
    },
  });
  const ambiguous=createFabricLedgerEvent({
    sequence:4,effect_id:intent.effect_id,domain:'RELEASE_PROMOTION',type:'OUTCOME',
    occurred_at:'2026-09-18T18:30:02.000Z',previous_event_sha256:attempt.event_sha256,
    material:{state:'AMBIGUOUS',reason:'PUBLISHER_RETURNED_WITHOUT_INDEPENDENT_READBACK',readback_evidence_digest:null,automatic_retry_allowed:false},
  });
  const readback=verifyRsiReleasePromotionJournalEvents({
    journal_intent:intent,
    events:[intent.intent_event,capabilityEvent,attempt,ambiguous],
  });
  assert.equal(readback.state,'AMBIGUOUS_RECONCILIATION_ONLY');
  assert.equal(readback.reconciliation_required,true);
  assert.equal(readback.second_attempt_allowed,false);

  const secondAttempt=createFabricLedgerEvent({
    sequence:5,effect_id:intent.effect_id,domain:'RELEASE_PROMOTION',type:'ATTEMPT',
    occurred_at:'2026-09-18T18:30:03.000Z',previous_event_sha256:ambiguous.event_sha256,
    material:{
      attempt_id:'release-promotion-attempt-illegal-retry',
      actuator_id:'RELEASE_PUBLISHER',
      dispatched_at:'2026-09-18T18:30:02.500Z',
      capability_digest:admission.capability_digest,
      nonce:intent.capability_expectation.nonce,
      target_incarnation:intent.capability_expectation.target_incarnation,
    },
  });
  assert.throws(
    ()=>verifyRsiReleasePromotionJournalEvents({
      journal_intent:intent,
      events:[intent.intent_event,capabilityEvent,attempt,ambiguous,secondAttempt],
    }),
    /AMBIGUOUS_EFFECT_RECONCILIATION_ONLY/,
  );
});

test('capability drift, untrusted signer and expired capability fail before any attempt exists',()=>{
  const intent=exactIntent();
  const signed=signedCapability(intent);
  const wrong=structuredClone(signed.envelope);
  wrong.claims.target_incarnation=PARENT_SHA+':'+PARENT_SHA;
  assert.throws(
    ()=>admitRsiReleasePromotionCapability({
      journal_intent:intent,capability_envelope:wrong,trusted_public_keys:signed.trusted_public_keys,now:new Date(NOW),
    }),
    /capability_rejected/,
  );
  assert.throws(
    ()=>admitRsiReleasePromotionCapability({
      journal_intent:intent,capability_envelope:signed.envelope,trusted_public_keys:{},now:new Date(NOW),
    }),
    /CAPABILITY_KEY_UNTRUSTED/,
  );
  const expired=signedCapability(intent,{deadline:'2026-09-18T18:29:59.500Z'});
  assert.throws(
    ()=>admitRsiReleasePromotionCapability({
      journal_intent:intent,capability_envelope:expired.envelope,trusted_public_keys:expired.trusted_public_keys,now:new Date(NOW),
    }),
    /CAPABILITY_EXPIRED/,
  );
});

test('release-promotion journal trust root cannot mint or actuate authority',()=>{
  const root=rsiReleasePromotionJournalTrustRootSnapshot();
  assert.equal(root.effect_domain,'RELEASE_PROMOTION');
  assert.equal(root.journal_owner,'RELEASE_PROMOTION_JOURNAL');
  assert.equal(root.actuator_owner,'RELEASE_PUBLISHER');
  assert.equal(root.reconcile_owner,'RELEASE_PROMOTION_RECONCILER');
  assert.equal(root.one_attempt_only,true);
  assert.equal(root.verified_external_capability_required,true);
  assert.equal(root.capability_max_uses,1);
  assert.equal(root.capability_retry_budget,0);
  assert.equal(root.independent_readback_required,true);
  assert.equal(root.ambiguous_reconciliation_only,true);
  assert.equal(root.candidate_can_mint_capability,false);
  assert.equal(root.rsi_can_mint_capability,false);
  assert.equal(root.rsi_can_invoke_release_publisher,false);
  assert.equal(root.release_authority,false);
  assert.equal(root.physical_effect_replay_allowed,false);
});
