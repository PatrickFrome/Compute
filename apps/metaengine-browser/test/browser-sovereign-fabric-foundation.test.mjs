import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createFabricLedgerEvent,
  reduceFabricEffectLedger,
  browserFabricLedgerContract,
} from '../src/browser-fabric-effect-ledger.mjs';
import {
  BROWSER_FABRIC_CAPABILITY_SCHEMA,
  fabricCapabilitySigningBytes,
  verifyBrowserFabricCapability,
} from '../src/browser-fabric-capability.mjs';
import {
  BROWSER_CELL_SCHEMA,
  BROWSER_CELL_TYPES,
  admitBrowserCell,
} from '../src/browser-fabric-browser-cell.mjs';
import { evaluateBrowserFabricReleaseAuthorityGate } from '../src/browser-fabric-release-authority-gate.mjs';
import { planBrowserFabricGuardianRecovery } from '../src/browser-fabric-guardian-recovery-plan.mjs';
import { evaluateBrowserFabricSlos } from '../src/browser-fabric-slo.mjs';
import { evaluateBrowserFabricGovernance } from '../src/browser-fabric-governance.mjs';

const H64 = (ch) => ch.repeat(64);
const EFFECT_ID = 'effect:session:00000001';
const NOW = new Date('2026-09-05T04:00:30Z');
const CELL_BUDGET = Object.freeze({
  max_tabs: 2,
  max_targets: 4,
  max_memory_mb: 1024,
  max_wall_time_ms: 30 * 60_000,
});

function signedCapability() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const claims = {
    schema: BROWSER_FABRIC_CAPABILITY_SCHEMA,
    capability_id: 'capability:00000001',
    issuer: 'metaengine-control-plane',
    audience: 'guardian-session-actuator',
    subject_device: 'device:supervisor-01',
    effect_id: EFFECT_ID,
    task_id: 'task:00000001',
    claim_generation: 7,
    browser_context_id: 'context:worker-01',
    target_id: 'target:page-01',
    target_incarnation: 'target-incarnation:0001',
    action: 'START_BROKER_EXACT_SESSION',
    issued_at: '2026-09-05T04:00:00Z',
    not_before: '2026-09-05T04:00:00Z',
    deadline: '2026-09-05T04:02:00Z',
    idempotency_key: 'idem:session:00000001',
    policy_hash: H64('a'),
    plan_digest: H64('b'),
    nonce: 'nonce:capability:00000001',
    max_uses: 1,
    retry_budget: 0,
    delegation_depth: 0,
    parent_capability_digest: null,
  };
  const envelope = {
    alg: 'EdDSA',
    key_id: 'key:control-plane-01',
    claims,
    signature: crypto.sign(null, fabricCapabilitySigningBytes(claims), privateKey).toString('base64url'),
  };
  const expected = Object.fromEntries([
    'audience', 'subject_device', 'effect_id', 'task_id', 'claim_generation',
    'browser_context_id', 'target_id', 'target_incarnation', 'action',
    'idempotency_key', 'policy_hash', 'plan_digest', 'nonce', 'max_uses',
    'retry_budget', 'delegation_depth', 'parent_capability_digest',
  ].map((key) => [key, claims[key]]));
  return { publicKey, claims, envelope, expected };
}

function verifiedCapability() {
  const signed = signedCapability();
  const verified = verifyBrowserFabricCapability({
    envelope: signed.envelope,
    trusted_public_keys: { 'key:control-plane-01': signed.publicKey },
    expected: signed.expected,
    now: NOW,
  });
  assert.equal(verified.ok, true);
  return { ...signed, verified };
}

function ledgerFixture() {
  const { verified } = verifiedCapability();
  const intent = createFabricLedgerEvent({
    sequence: 1,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'INTENT',
    occurred_at: '2026-09-05T04:00:01Z',
    material: {
      effect_kind: 'START_BROKER',
      idempotency_key: 'idem:session:00000001',
      plan_digest: H64('b'),
      generation: 7,
      policy_hash: H64('a'),
      non_idempotent: true,
      desired_state_digest: H64('c'),
      trace_id: '0123456789abcdef0123456789abcdef',
    },
  });
  const capability = createFabricLedgerEvent({
    sequence: 2,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'CAPABILITY',
    occurred_at: '2026-09-05T04:00:02Z',
    previous_event_sha256: intent.event_sha256,
    material: verified.ledger_material,
  });
  const attempt = createFabricLedgerEvent({
    sequence: 3,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'ATTEMPT',
    occurred_at: '2026-09-05T04:00:03Z',
    previous_event_sha256: capability.event_sha256,
    material: {
      attempt_id: 'attempt:00000001',
      actuator_id: 'guardian-actuator:01',
      dispatched_at: '2026-09-05T04:00:03Z',
      capability_digest: verified.capability_digest,
      nonce: verified.ledger_material.nonce,
      target_incarnation: 'target-incarnation:0001',
    },
  });
  const readback = createFabricLedgerEvent({
    sequence: 4,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'READBACK',
    occurred_at: '2026-09-05T04:00:04Z',
    previous_event_sha256: attempt.event_sha256,
    material: {
      observer_id: 'guardian-readback:independent-01',
      observer_independent: true,
      observed_at: '2026-09-05T04:00:04Z',
      evidence_digest: H64('d'),
      observed_state: 'BROKER_EXACT_SESSION_PRESENT',
      target_incarnation: 'target-incarnation:0001',
    },
  });
  const outcome = createFabricLedgerEvent({
    sequence: 5,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'OUTCOME',
    occurred_at: '2026-09-05T04:00:05Z',
    previous_event_sha256: readback.event_sha256,
    material: {
      state: 'CONFIRMED',
      reason: 'EXACT_INDEPENDENT_READBACK',
      readback_evidence_digest: H64('d'),
      automatic_retry_allowed: false,
    },
  });
  return { intent, capability, attempt, readback, outcome };
}

test('fabric ledger is hash-chained, one-attempt, capability-gated and readback-confirmed', () => {
  const f = ledgerFixture();
  const reduced = reduceFabricEffectLedger([f.intent, f.capability, f.attempt, f.readback, f.outcome]);
  assert.equal(reduced.ok, true);
  assert.equal(reduced.projection[EFFECT_ID].outcome.state, 'CONFIRMED');
  assert.equal(reduced.projection[EFFECT_ID].automatic_retry_allowed, false);
  assert.equal(reduced.queue_delivery_authority, false);
  assert.equal(reduced.realtime_event_authority, false);
  assert.match(reduced.projection_sha256, /^[0-9a-f]{64}$/);
});

test('fabric ledger rejects a second non-idempotent attempt and positive outcome without readback', () => {
  const f = ledgerFixture();
  const second = createFabricLedgerEvent({
    sequence: 4,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'ATTEMPT',
    occurred_at: '2026-09-05T04:00:04Z',
    previous_event_sha256: f.attempt.event_sha256,
    material: { ...f.attempt.material, attempt_id: 'attempt:00000002' },
  });
  assert.equal(reduceFabricEffectLedger([f.intent, f.capability, f.attempt, second]).reason, 'SECOND_ATTEMPT_FORBIDDEN');

  const premature = createFabricLedgerEvent({
    sequence: 4,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'OUTCOME',
    occurred_at: '2026-09-05T04:00:04Z',
    previous_event_sha256: f.attempt.event_sha256,
    material: {
      state: 'CONFIRMED',
      reason: 'SELF_ATTESTED_SUCCESS',
      readback_evidence_digest: H64('e'),
      automatic_retry_allowed: false,
    },
  });
  assert.equal(reduceFabricEffectLedger([f.intent, f.capability, f.attempt, premature]).reason, 'POSITIVE_OUTCOME_WITHOUT_EXACT_READBACK');
});

test('ambiguous effect can converge only through a newer independent readback and never a retry', () => {
  const f = ledgerFixture();
  const ambiguous = createFabricLedgerEvent({
    sequence: 4,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'OUTCOME',
    occurred_at: '2026-09-05T04:00:04Z',
    previous_event_sha256: f.attempt.event_sha256,
    material: {
      state: 'AMBIGUOUS',
      reason: 'DISPATCH_ACK_UNKNOWN',
      readback_evidence_digest: null,
      automatic_retry_allowed: false,
    },
  });
  const retry = createFabricLedgerEvent({
    sequence: 5,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'ATTEMPT',
    occurred_at: '2026-09-05T04:00:05Z',
    previous_event_sha256: ambiguous.event_sha256,
    material: { ...f.attempt.material, attempt_id: 'attempt:00000002', dispatched_at: '2026-09-05T04:00:05Z' },
  });
  assert.equal(
    reduceFabricEffectLedger([f.intent, f.capability, f.attempt, ambiguous, retry]).reason,
    'AMBIGUOUS_EFFECT_RECONCILIATION_ONLY',
  );

  const reconciledReadback = createFabricLedgerEvent({
    sequence: 5,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'READBACK',
    occurred_at: '2026-09-05T04:00:06Z',
    previous_event_sha256: ambiguous.event_sha256,
    material: {
      ...f.readback.material,
      observed_at: '2026-09-05T04:00:06Z',
      evidence_digest: H64('e'),
      observed_state: 'BROKER_EXACT_SESSION_PRESENT_AFTER_RECONCILIATION',
    },
  });
  const resolved = createFabricLedgerEvent({
    sequence: 6,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'OUTCOME',
    occurred_at: '2026-09-05T04:00:07Z',
    previous_event_sha256: reconciledReadback.event_sha256,
    material: {
      state: 'CONFIRMED',
      reason: 'NEW_INDEPENDENT_READBACK',
      readback_evidence_digest: H64('e'),
      automatic_retry_allowed: false,
    },
  });
  const out = reduceFabricEffectLedger([f.intent, f.capability, f.attempt, ambiguous, reconciledReadback, resolved]);
  assert.equal(out.ok, true);
  assert.equal(out.projection[EFFECT_ID].terminal, true);
  assert.equal(out.projection[EFFECT_ID].terminal_ambiguous, false);
  assert.equal(out.projection[EFFECT_ID].ambiguity_reconciled, true);
  assert.equal(out.projection[EFFECT_ID].outcomes.length, 2);
});

test('ledger binds one domain and monotonic time to an effect identity', () => {
  const f = ledgerFixture();
  const domainDrift = createFabricLedgerEvent({
    ...{
      sequence: 2,
      effect_id: EFFECT_ID,
      domain: 'PROCESS',
      type: 'CAPABILITY',
      occurred_at: '2026-09-05T04:00:02Z',
      previous_event_sha256: f.intent.event_sha256,
      material: f.capability.material,
    },
  });
  assert.equal(reduceFabricEffectLedger([f.intent, domainDrift]).reason, 'EFFECT_DOMAIN_DRIFT');

  const timeRegression = createFabricLedgerEvent({
    sequence: 2,
    effect_id: EFFECT_ID,
    domain: 'SESSION_BROKER',
    type: 'CAPABILITY',
    occurred_at: '2026-09-05T04:00:00Z',
    previous_event_sha256: f.intent.event_sha256,
    material: f.capability.material,
  });
  assert.equal(reduceFabricEffectLedger([f.intent, timeRegression]).reason, 'EVENT_TIME_REGRESSION');
  assert.equal(reduceFabricEffectLedger([{ ...f.intent, untrusted_extra: true }]).reason, 'EVENT_SCHEMA_INVALID');
  const unregisteredDomain = createFabricLedgerEvent({
    sequence: 1,
    effect_id: 'effect:unknown:00000001',
    domain: 'MODEL_PURCHASE',
    type: 'INTENT',
    occurred_at: '2026-09-05T04:00:01Z',
    material: f.intent.material,
  });
  assert.equal(reduceFabricEffectLedger([unregisteredDomain]).reason, 'EFFECT_DOMAIN_NOT_REGISTERED');
});

test('ledger chains each effect independently without a fleet-wide serialization point', () => {
  const f = ledgerFixture();
  const other = createFabricLedgerEvent({
    sequence: 1,
    effect_id: 'effect:process:00000002',
    domain: 'PROCESS',
    type: 'INTENT',
    occurred_at: '2026-09-05T04:00:01.500Z',
    material: {
      ...f.intent.material,
      effect_kind: 'START_BROWSER',
      idempotency_key: 'idem:process:00000002',
    },
  });
  const out = reduceFabricEffectLedger([f.intent, other, f.capability]);
  assert.equal(out.ok, true);
  assert.equal(out.per_effect_chain_heads[EFFECT_ID], f.capability.event_sha256);
  assert.equal(out.per_effect_chain_heads['effect:process:00000002'], other.event_sha256);
});

test('signed capability is exact, short-lived and cannot be replayed for another target/action', () => {
  const { publicKey, envelope, expected } = signedCapability();
  const keys = { 'key:control-plane-01': publicKey };
  assert.equal(verifyBrowserFabricCapability({ envelope, trusted_public_keys: keys, expected, now: NOW }).ok, true);
  assert.equal(verifyBrowserFabricCapability({
    envelope,
    trusted_public_keys: keys,
    expected: { ...expected, target_id: 'target:other' },
    now: NOW,
  }).reason, 'CAPABILITY_BINDING_MISMATCH:target_id');
  assert.equal(verifyBrowserFabricCapability({ envelope, trusted_public_keys: keys, expected, now: new Date('2026-09-05T04:10:00Z') }).reason, 'CAPABILITY_EXPIRED');
});

test('capability rejects non-canonical signatures, caller-expanded TTL and the exact deadline', () => {
  const { publicKey, envelope, expected } = signedCapability();
  const keys = { 'key:control-plane-01': publicKey };
  assert.equal(verifyBrowserFabricCapability({
    envelope: { ...envelope, signature: `${envelope.signature}=` },
    trusted_public_keys: keys,
    expected,
    now: NOW,
  }).reason, 'CAPABILITY_SIGNATURE_ENCODING_INVALID');
  assert.equal(verifyBrowserFabricCapability({
    envelope,
    trusted_public_keys: keys,
    expected,
    now: NOW,
    max_ttl_ms: 10 * 60_000,
  }).reason, 'CAPABILITY_MAX_TTL_POLICY_INVALID');
  assert.equal(verifyBrowserFabricCapability({
    envelope,
    trusted_public_keys: keys,
    expected,
    now: new Date(envelope.claims.deadline),
  }).reason, 'CAPABILITY_EXPIRED');
  assert.equal(verifyBrowserFabricCapability({
    envelope: { ...envelope, claims: { ...envelope.claims, max_uses: 2 } },
    trusted_public_keys: keys,
    expected,
    now: NOW,
  }).reason, 'CAPABILITY_USE_OR_RETRY_BUDGET_INVALID');
});

test('BrowserCells isolate human, authenticated, research and recovery lanes', () => {
  const { verified } = verifiedCapability();
  const worker = admitBrowserCell({
    now: NOW,
    cell: {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.AUTHENTICATED_WORKER,
      cell_id: 'cell:worker-01',
      cell_generation: 3,
      browser_context_id: 'context:worker-01',
      browser_process_incarnation: 'browser-process:0003',
      runtime_observed_at: '2026-09-05T04:00:20Z',
      isolated_from_human: true,
      active_claim_count: 0,
      fleet_capacity: true,
      persistent_partition: true,
      storage_partition_id: 'partition:worker-01',
      resource_budget: CELL_BUDGET,
      expires_at: '2026-09-05T04:20:00Z',
    },
    claim: {
      task_id: 'task:00000001',
      claim_generation: 7,
      browser_context_id: 'context:worker-01',
      cell_generation: 3,
      browser_process_incarnation: 'browser-process:0003',
      target_id: 'target:page-01',
      target_incarnation: 'target-incarnation:0001',
    },
    capability: verified,
    ledger_reservation: {
      schema: 'metaengine.browser-fabric.capability-reservation.v1',
      effect_id: verified.ledger_material.effect_id,
      capability_digest: verified.capability_digest,
      nonce: verified.ledger_material.nonce,
      task_id: 'task:00000001',
      claim_generation: 7,
      cell_id: 'cell:worker-01',
      cell_generation: 3,
      reservation_generation: 1,
      deadline: verified.ledger_material.deadline,
      reserved: true,
      consumed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
  });
  assert.equal(worker.ok, true);
  assert.equal(worker.one_claim_per_cell, true);
  assert.equal(worker.send_allowed, false);

  const researchCell = {
    schema: BROWSER_CELL_SCHEMA,
    type: BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH,
    cell_id: 'cell:research-01',
    cell_generation: 1,
    browser_context_id: 'context:research-01',
    browser_process_incarnation: 'browser-process:research-01',
    runtime_observed_at: '2026-09-05T04:00:20Z',
    isolated_from_human: true,
    active_claim_count: 0,
    fleet_capacity: true,
    persistent_partition: false,
    user_data_allowed: false,
    prompt_access_allowed: false,
    send_allowed: false,
    read_only: true,
    network_allowlist: ['docs.example.test'],
    resource_budget: CELL_BUDGET,
    expires_at: '2026-09-05T04:05:00Z',
  };
  const researchClaim = {
    task_id: 'task:research-01',
    claim_generation: 1,
    browser_context_id: 'context:research-01',
    cell_generation: 1,
    browser_process_incarnation: 'browser-process:research-01',
    requested_actions: ['READ_WEB'],
  };
  const research = admitBrowserCell({ now: NOW, cell: researchCell, claim: researchClaim });
  assert.equal(research.ok, true);
  assert.equal(research.destroy_after_evidence_upload, true);

  const arbitraryResearch = admitBrowserCell({
    now: NOW,
    cell: {
      ...researchCell,
      cell_id: 'cell:research-02',
      browser_context_id: 'context:research-02',
      browser_process_incarnation: 'browser-process:research-02',
    },
    claim: {
      ...researchClaim,
      task_id: 'task:research-02',
      browser_context_id: 'context:research-02',
      browser_process_incarnation: 'browser-process:research-02',
      requested_actions: ['EXEC_ARBITRARY'],
    },
  });
  assert.equal(arbitraryResearch.reason, 'RESEARCH_CELL_ACTION_SCOPE_INVALID');
  assert.equal(admitBrowserCell({
    now: NOW,
    cell: { ...researchCell, network_allowlist: ['169.254.169.254'] },
    claim: researchClaim,
  }).reason, 'RESEARCH_CELL_READ_ONLY_ALLOWLIST_REQUIRED');

  const recoverySend = admitBrowserCell({
    now: NOW,
    cell: {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.RECOVERY_PROBE,
      cell_id: 'cell:recovery-01',
      cell_generation: 1,
      browser_context_id: 'context:recovery-01',
      browser_process_incarnation: 'browser-process:recovery-01',
      runtime_observed_at: '2026-09-05T04:00:20Z',
      isolated_from_human: true,
      active_claim_count: 0,
      fleet_capacity: false,
      persistent_partition: false,
      user_data_allowed: false,
      prompt_access_allowed: false,
      send_allowed: false,
      network_allowlist: [],
      resource_budget: CELL_BUDGET,
      expires_at: '2026-09-05T04:05:00Z',
    },
    claim: {
      task_id: 'task:recovery-01',
      claim_generation: 1,
      browser_context_id: 'context:recovery-01',
      cell_generation: 1,
      browser_process_incarnation: 'browser-process:recovery-01',
      requested_actions: ['SEND'],
    },
  });
  assert.equal(recoverySend.ok, false);
  assert.equal(recoverySend.reason, 'RECOVERY_PROBE_ACTION_SCOPE_INVALID');
});

test('authority cannot advance on Git SHA alone and requires immutable release plus provenance', () => {
  const candidate = '1'.repeat(40);
  const current = '2'.repeat(40);
  const trusted = {
    schema: 'metaengine.trusted-dev-release.v1',
    git_sha: candidate,
    tag: 'v0.6.6-dev.1.1',
    version: '0.6.6-dev.1.1',
    installer_name: 'METAENGINE-Browser-Setup.exe',
    installer_sha256: H64('a'),
    manifest_sha256: H64('b'),
    dev_yml_sha256: H64('c'),
    installed_executable_sha256: H64('d'),
    target_present_proof_supported: true,
    authority_effect: false,
  };
  assert.equal(evaluateBrowserFabricReleaseAuthorityGate({
    candidate_sha: candidate,
    current_authority_sha: current,
    trusted_release: trusted,
  }).reason, 'IMMUTABLE_RELEASE_PROOF_REQUIRED');
  assert.equal(evaluateBrowserFabricReleaseAuthorityGate({
    candidate_sha: candidate,
    current_authority_sha: current,
    trusted_release: { ...trusted, installer_name: '../METAENGINE-Browser-Setup.exe' },
  }).reason, 'RELEASE_INSTALLER_NAME_INVALID');

  const out = evaluateBrowserFabricReleaseAuthorityGate({
    candidate_sha: candidate,
    current_authority_sha: current,
    trusted_release: trusted,
    immutable_release_evidence: {
      schema: 'metaengine.browser-fabric.immutable-release-evidence.v1',
      verifier_id: 'github-release-verifier:01',
      verified_at: '2026-09-05T04:00:20Z',
      enabled: true,
      tag_locked: true,
      assets_locked: true,
      attestation_verified: true,
      release_tag: trusted.tag,
      commit_sha: candidate,
      manifest_sha256: trusted.manifest_sha256,
      installer_sha256: trusted.installer_sha256,
      installed_executable_sha256: trusted.installed_executable_sha256,
      authority_effect: false,
    },
    provenance_evidence: {
      schema: 'metaengine.browser-fabric.provenance-evidence.v1',
      verifier_id: 'slsa-verifier:01',
      verified_at: '2026-09-05T04:00:20Z',
      verified: true,
      builder_trusted: true,
      builder_id: 'github-actions:browser-release',
      source_sha: candidate,
      subject_name: trusted.installer_name,
      subject_sha256: trusted.installer_sha256,
      predicate_type: 'https://slsa.dev/provenance/v1',
      authority_effect: false,
    },
    source_ancestry_evidence: {
      schema: 'metaengine.browser-fabric.source-ancestry-evidence.v1',
      verifier_id: 'github-ancestry-verifier:01',
      verified_at: '2026-09-05T04:00:20Z',
      base_sha: current,
      candidate_sha: candidate,
      fast_forward_verified: true,
      authority_effect: false,
    },
    now: NOW,
  });
  assert.equal(out.action, 'AUTHORITY_ADVANCE_CANDIDATE');
  assert.equal(out.requires_separate_journaled_promotion_effect, true);
  assert.equal(out.release_authority, false);
});

test('Guardian A/B planner stages inactive slot, health-probes, promotes, and never retries installer', () => {
  const releaseGate = {
    schema: 'metaengine.browser-fabric.release-authority-gate.v1',
    action: 'AUTHORITY_ADVANCE_CANDIDATE',
    authority_advance_candidate: true,
    requires_separate_journaled_promotion_effect: true,
    candidate_sha: '1'.repeat(40),
    release_tag: 'v0.6.6-dev.42.1',
    installed_executable_sha256: H64('a'),
    manifest_sha256: H64('b'),
    release_authority: false,
    authority_effect: false,
  };
  const activationEvidence = {
    schema: 'metaengine.browser-fabric.guardian-activation-evidence.v1',
    release_tag: releaseGate.release_tag,
    source_sha: releaseGate.candidate_sha,
    browser_exe_sha256: releaseGate.installed_executable_sha256,
    manifest_sha256: releaseGate.manifest_sha256,
    platform_signature_verified: true,
    rollback_freshness_verified: true,
    platform_verifier_id: 'windows-authenticode-verifier:01',
    freshness_verifier_id: 'guardian-rollback-verifier:01',
    verified_at: '2026-09-05T04:00:20Z',
    authority_effect: false,
  };
  const release = {
    source_sha: releaseGate.candidate_sha,
    browser_exe_sha256: releaseGate.installed_executable_sha256,
    manifest_sha256: releaseGate.manifest_sha256,
  };
  const base = {
    active_slot: 'A',
    inactive_slot: 'B',
    last_known_good_slot: 'A',
    slots: [
      {
        slot_id: 'A', source_sha: '2'.repeat(40), browser_exe_sha256: H64('c'), manifest_sha256: H64('d'),
        bytes_exact: true, machine_secure: true, final_path_exact: true, health_challenge_passed: true,
        owner_session_handshake_exact: true, control_plane_handshake_exact: true,
        rollback_evidence: {
          schema: 'metaengine.browser-fabric.guardian-rollback-evidence.v1',
          slot_id: 'A', source_sha: '2'.repeat(40), browser_exe_sha256: H64('c'), manifest_sha256: H64('d'),
          platform_signature_verified: true, receipt_sha256: H64('e'),
          verifier_id: 'guardian-slot-verifier:01', verified_at: '2026-09-05T04:00:20Z',
          authority_effect: false,
        },
      },
      {
        slot_id: 'B', source_sha: '', browser_exe_sha256: '', manifest_sha256: '',
        bytes_exact: false, machine_secure: true, final_path_exact: true, health_challenge_passed: false,
        owner_session_handshake_exact: false, control_plane_handshake_exact: false,
        rollback_evidence: null,
      },
    ],
  };
  const stage = planBrowserFabricGuardianRecovery({
    release_gate: releaseGate,
    activation_evidence: activationEvidence,
    observed: base,
    now: NOW,
  });
  assert.equal(stage.action, 'STAGE_INACTIVE_SLOT_CANDIDATE');
  assert.equal(stage.installer_retry_allowed, false);
  assert.equal(stage.direct_effect_allowed, false);

  const exactB = {
    ...base,
    slots: [base.slots[0], {
      slot_id: 'B', source_sha: release.source_sha, browser_exe_sha256: release.browser_exe_sha256,
      manifest_sha256: release.manifest_sha256, bytes_exact: true, machine_secure: true, final_path_exact: true,
      health_challenge_passed: true, owner_session_handshake_exact: true, control_plane_handshake_exact: true,
      rollback_evidence: null,
    }],
  };
  const promote = planBrowserFabricGuardianRecovery({
    release_gate: releaseGate,
    activation_evidence: activationEvidence,
    observed: exactB,
    now: NOW,
  });
  assert.equal(promote.action, 'PROMOTE_POINTER_CANDIDATE');
  assert.equal(promote.pointer_switch_must_be_atomic, true);
  assert.equal(promote.prior_slot_retained_as_rollback, true);

  const rollback = planBrowserFabricGuardianRecovery({
    release_gate: releaseGate,
    activation_evidence: activationEvidence,
    observed: {
      ...exactB,
      active_slot: 'B',
      inactive_slot: 'A',
      last_known_good_slot: 'A',
      active_runtime_unhealthy: true,
    },
    now: NOW,
  });
  assert.equal(rollback.action, 'ROLLBACK_POINTER_CANDIDATE');
  assert.equal(rollback.to_slot, 'A');
  assert.equal(rollback.installer_retry_allowed, false);

  const missingRollbackReceipt = planBrowserFabricGuardianRecovery({
    release_gate: releaseGate,
    activation_evidence: activationEvidence,
    observed: {
      ...exactB,
      slots: [{ ...exactB.slots[0], rollback_evidence: null }, exactB.slots[1]],
    },
    now: NOW,
  });
  assert.equal(missingRollbackReceipt.action, 'HOLD');
  assert.equal(missingRollbackReceipt.reason, 'PRIOR_SLOT_ROLLBACK_EVIDENCE_REQUIRED');

  const invalidTopology = planBrowserFabricGuardianRecovery({
    release_gate: releaseGate,
    activation_evidence: activationEvidence,
    observed: { ...exactB, inactive_slot: 'A' },
    now: NOW,
  });
  assert.equal(invalidTopology.reason, 'AB_SLOT_IDENTITY_COLLISION');

  const staleEvidence = planBrowserFabricGuardianRecovery({
    release_gate: releaseGate,
    activation_evidence: { ...activationEvidence, verified_at: '2026-09-05T03:40:00Z' },
    observed: exactB,
    now: NOW,
  });
  assert.equal(staleEvidence.reason, 'PLATFORM_AND_ROLLBACK_EVIDENCE_REQUIRED');
});

test('SLO health is based on useful work, not fresh heartbeat', () => {
  const good = evaluateBrowserFabricSlos({
    heartbeat_fresh: true,
    ready_to_claim_latency_ms: [1000, 2000, 5000, 10_000],
    verified_recovery_duration_ms: [60_000, 120_000],
    effect_domains: {
      BROWSER_SEND: { attempted: 1000, ambiguous: 2, duplicates: 0, ambiguous_with_reconcile_owner: 2 },
      SESSION_BROKER: { attempted: 1000, ambiguous: 1, duplicates: 0, ambiguous_with_reconcile_owner: 1 },
    },
    affected_claims_per_cell_failure: [1, 1, 0],
    source_live_drift_lag_ms: [10_000, 20_000],
    integration_to_verified_artifact_lag_ms: [60_000, 120_000],
    total_effects: 2000,
    effects_with_full_causal_chain: 2000,
    open_pr_age_ms: [60_000, 120_000],
  });
  assert.equal(good.healthy, true);
  assert.equal(good.heartbeat_fresh_is_health_proof, false);

  const stuck = evaluateBrowserFabricSlos({ ...{
    ready_to_claim_latency_ms: [31_000],
    verified_recovery_duration_ms: [60_000],
    effect_domains: { BROWSER_SEND: { attempted: 1, ambiguous: 0, duplicates: 0, ambiguous_with_reconcile_owner: 0 } },
    affected_claims_per_cell_failure: [1],
    source_live_drift_lag_ms: [10_000],
    integration_to_verified_artifact_lag_ms: [60_000],
    total_effects: 1,
    effects_with_full_causal_chain: 1,
    open_pr_age_ms: [60_000],
  }, heartbeat_fresh: true });
  assert.equal(stuck.healthy, false);
  assert.ok(stuck.failed_metrics.includes('READY_TO_CLAIM_P95_MS'));
});

test('SLO evaluation fails closed on orphan ambiguity and invalid counters', () => {
  const base = {
    ready_to_claim_latency_ms: [1000],
    verified_recovery_duration_ms: [60_000],
    affected_claims_per_cell_failure: [1],
    source_live_drift_lag_ms: [10_000],
    integration_to_verified_artifact_lag_ms: [60_000],
    total_effects: 1,
    effects_with_full_causal_chain: 1,
    open_pr_age_ms: [60_000],
  };
  const orphan = evaluateBrowserFabricSlos({
    ...base,
    effect_domains: {
      BROWSER_SEND: { attempted: 0, ambiguous: 1, duplicates: 0, ambiguous_with_reconcile_owner: 1 },
    },
  });
  assert.equal(orphan.healthy, false);
  assert.equal(orphan.input_valid, false);
  assert.ok(orphan.input_violations.includes('EFFECT_DOMAIN_COUNTER_RELATION_INVALID:BROWSER_SEND'));

  const negative = evaluateBrowserFabricSlos({
    ...base,
    effect_domains: {
      BROWSER_SEND: { attempted: 1, ambiguous: 0, duplicates: -1, ambiguous_with_reconcile_owner: 0 },
    },
  });
  assert.equal(negative.healthy, false);
  assert.ok(negative.input_violations.includes('EFFECT_DOMAIN_COUNTER_INVALID:BROWSER_SEND'));
});

test('governance detects stale refs, patch equivalents and competing authority PRs without mutating GitHub', () => {
  const out = evaluateBrowserFabricGovernance({
    now: new Date('2026-09-05T04:00:00Z'),
    pull_requests: [
      {
        number: 1, state: 'open', title: 'a', head: 'work/a', updated_at: '2026-09-01T00:00:00Z',
        effect_domains: ['SESSION_BROKER'], effect_domains_verified: true, authority_changing: true,
        physical_effect_changing: true, patch_id: 'a'.repeat(40), patch_id_verified: true,
      },
      {
        number: 2, state: 'open', title: 'b', head: 'work/b', updated_at: '2026-09-05T03:00:00Z',
        effect_domains: ['SESSION_BROKER'], effect_domains_verified: true, authority_changing: true,
        physical_effect_changing: true, patch_id: 'a'.repeat(40), patch_id_verified: true,
      },
    ],
  });
  assert.equal(out.ok, true);
  assert.equal(out.stale.length, 1);
  assert.equal(out.patch_equivalents.length, 1);
  assert.equal(out.authority_domain_conflicts[0].domain, 'SESSION_BROKER');
  assert.equal(out.physical_effect_domain_conflicts[0].domain, 'SESSION_BROKER');
  assert.equal(out.repository_setting_mutation_allowed, false);
});

test('governance rejects caller-only domain labels, patch IDs and future timestamps', () => {
  const now = new Date('2026-09-05T04:00:00Z');
  const unverified = evaluateBrowserFabricGovernance({
    now,
    pull_requests: [{
      number: 7,
      state: 'open',
      head: 'work/unverified',
      updated_at: '2026-09-05T03:00:00Z',
      effect_domains: ['SESSION_BROKER'],
      authority_changing: true,
      patch_id: 'b'.repeat(40),
    }],
  });
  assert.equal(unverified.ok, false);
  assert.ok(unverified.input_violations.includes('PR_EFFECT_DOMAIN_EVIDENCE_INVALID:7'));

  const future = evaluateBrowserFabricGovernance({
    now,
    pull_requests: [{
      number: 8,
      state: 'open',
      head: 'work/future',
      updated_at: '2026-09-05T04:00:01Z',
      effect_domains: [],
      effect_domains_verified: true,
    }],
  });
  assert.equal(future.ok, false);
  assert.ok(future.input_violations.includes('PR_UPDATED_AT_INVALID:8'));
});

test('contracts preserve evidence-rich/effect-poor boundary', () => {
  const contract = browserFabricLedgerContract();
  assert.equal(contract.queue_delivery_authority, false);
  assert.equal(contract.realtime_event_authority, false);
  assert.equal(contract.ambiguous_retry_allowed, false);
  assert.equal(contract.one_attempt_per_effect, true);
});
