import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EFFECT_EVENT_TYPES,
  EFFECT_OUTCOMES,
  appendEvent,
  classifyReadback,
  intentMaterial,
  queueEnvelope,
  reduceEffect,
} from '../src/sovereign-effect-ledger.mjs';
import { capabilityMaterial, verifyEffectCapability } from '../src/effect-capability.mjs';
import {
  BROWSER_CELL_TYPES,
  assignClaim,
  bindCellTarget,
  createBrowserCellDescriptor,
  planCdpIsolatedContext,
  retireBrowserCell,
} from '../src/browser-cell-model.mjs';
import { GUARDIAN_SLOT_ACTIONS, planGuardianAbSlot } from '../src/guardian-ab-slot-plan.mjs';
import { usefulWorkSlo } from '../src/sovereign-slo.mjs';
import { verifiedReleaseAuthorityGate } from '../src/verified-release-authority-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const effectId = '11111111-1111-4111-8111-111111111111';
const policyHash = 'a'.repeat(64);

function intent() {
  return intentMaterial({
    effect_id: effectId,
    domain: 'WTS_PROCESS',
    idempotency_key: 'start-broker:owner:session:7:g1',
    generation: 1,
    policy_hash: policyHash,
    non_idempotent: true,
    plan: { action: 'START_BROKER', session_id: 7, owner_sid: 'S-1-5-21-1-2-3-1001' },
  });
}

test('queue carries effect_id only and never becomes authority', () => {
  const row = queueEnvelope(intent());
  assert.deepEqual(Object.keys(row).sort(), ['authority_effect', 'contains_authority', 'effect_id', 'schema'].sort());
  assert.equal(row.effect_id, effectId);
  assert.equal(row.contains_authority, false);
  assert.equal(row.authority_effect, false);
});

test('append-only reducer permits at most one non-idempotent attempt and AMBIGUOUS is not retryable', () => {
  let history = [];
  history = appendEvent(history, { event_type: EFFECT_EVENT_TYPES.INTENT, effect_id: effectId, payload: intent() });
  history = appendEvent(history, { event_type: EFFECT_EVENT_TYPES.ATTEMPT, effect_id: effectId, payload: { attempt_id: 'attempt-1' } });
  assert.throws(
    () => appendEvent(history, { event_type: EFFECT_EVENT_TYPES.ATTEMPT, effect_id: effectId, payload: { attempt_id: 'attempt-2' } }),
    /effect_non_idempotent_second_attempt_forbidden/,
  );
  history = appendEvent(history, {
    event_type: EFFECT_EVENT_TYPES.OUTCOME,
    effect_id: effectId,
    payload: { outcome: EFFECT_OUTCOMES.AMBIGUOUS, reason: 'readback unavailable' },
  });
  const projection = reduceEffect(history);
  assert.equal(projection.ambiguous, true);
  assert.equal(projection.retry_eligible, false);
  assert.equal(projection.automatic_retry_allowed, false);
});

test('readback algebra only allows retry from authoritative absence', () => {
  assert.equal(classifyReadback({ effect_present: true, exact: true }), EFFECT_OUTCOMES.CONFIRMED);
  assert.equal(classifyReadback({ conflict: true }), EFFECT_OUTCOMES.CONFLICT);
  assert.equal(classifyReadback({ corrupt: true }), EFFECT_OUTCOMES.CORRUPT);
  assert.equal(
    classifyReadback({ effect_present: false, authoritative_absence: true, readback_complete: true }),
    EFFECT_OUTCOMES.ABSENT_PROVEN,
  );
  assert.equal(classifyReadback({ effect_present: false, authoritative_absence: false }), EFFECT_OUTCOMES.AMBIGUOUS);
});

test('capability is audience/device/task/claim/context/target/action/deadline bound', async () => {
  const cap = capabilityMaterial({
    capability_id: 'cap-1',
    issuer: 'metaengine-pdp',
    audience: 'browser-cell-actuator',
    subject: 'workload://guardian/broker-1',
    device_id: 'device-key-1',
    task_id: 'task-42',
    claim_generation: 3,
    browser_context_id: 'ctx-7',
    target_id: 'target-9',
    target_incarnation: 'incarnation-2',
    action: 'SEND',
    idempotency_key: 'send:task-42:g3:target-9:inc2',
    policy_hash: policyHash,
    not_before_ms: 1_000,
    expires_at_ms: 2_000,
    restrictions: { max_sends: 1 },
  });
  const verified = await verifyEffectCapability({
    capability: cap,
    signature: 'test-signature',
    now_ms: 1_500,
    expected: {
      audience: cap.audience,
      device_id: cap.device_id,
      task_id: cap.task_id,
      claim_generation: 3,
      browser_context_id: cap.browser_context_id,
      target_id: cap.target_id,
      target_incarnation: cap.target_incarnation,
      action: 'SEND',
      idempotency_key: cap.idempotency_key,
      policy_hash: cap.policy_hash,
    },
    verifier: async ({ digest, signature }) => /^[0-9a-f]{64}$/.test(digest) && signature === 'test-signature',
  });
  assert.equal(verified.signature_verified, true);
  assert.equal(verified.location_implies_trust, false);
  await assert.rejects(
    () => verifyEffectCapability({ capability: cap, signature: 'test-signature', now_ms: 2_001, verifier: async () => true }),
    /capability_expired/,
  );
});

test('BrowserCells enforce isolated partitions, one claim, exact target incarnation and bounded ephemeral cleanup', () => {
  const worker = createBrowserCellDescriptor({
    cell_id: 'cell-worker-1',
    type: BROWSER_CELL_TYPES.AUTHENTICATED_WORKER,
    browser_context_id: 'ctx-worker-1',
    storage_partition: 'persist:worker-1',
    created_at_ms: 100,
  });
  const claimed = assignClaim(worker, { task_id: 'task-1', claim_generation: 1, capability_digest: 'c'.repeat(64), claimed_at_ms: 110 });
  assert.throws(() => assignClaim(claimed, { task_id: 'task-2', claim_generation: 1, capability_digest: 'd'.repeat(64) }), /already_active/);
  const targeted = bindCellTarget(claimed, { target_id: 'target-1', incarnation: 'target-1@12345' });
  assert.equal(targeted.target.incarnation, 'target-1@12345');

  const research = createBrowserCellDescriptor({
    cell_id: 'research-1',
    type: BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH,
    browser_context_id: 'ctx-research-1',
    storage_partition: 'ephemeral:research-1',
    created_at_ms: 100,
    expires_at_ms: 10_000,
    network_allowlist: ['https://example.com'],
  });
  assert.throws(() => retireBrowserCell(research, { now_ms: 500 }), /evidence_required/);
  assert.equal(retireBrowserCell(research, { now_ms: 500, evidence_uploaded: true }).dispose_context, true);

  const cdp = planCdpIsolatedContext({ cell_type: BROWSER_CELL_TYPES.RECOVERY_PROBE, browser_context_id: 'ctx-probe', target_url: 'about:blank' });
  assert.equal(cdp.create.method, 'Target.createBrowserContext');
  assert.equal(cdp.dispose.method, 'Target.disposeBrowserContext');
  assert.equal(cdp.page_effect_authority, false);
});

function desiredArtifact() {
  return {
    release_id: 'guardian-release-2',
    source_revision: 'f'.repeat(40),
    digest_sha256: '1'.repeat(64),
    size: 12345,
    provenance_digest_sha256: '2'.repeat(64),
    provenance_verified: true,
    signature_verified: true,
    transparency_verified: true,
    freshness_verified: true,
    rollback_protected: true,
  };
}

test('Guardian A/B planner stages inactive slot, requires independent health, then promotes by pointer and can rollback by pointer', () => {
  const base = {
    desired_artifact: desiredArtifact(),
    active_slot: 'A',
    slot_a: { release_id: 'guardian-release-1', digest_sha256: '3'.repeat(64), healthy: true, owner_session_verified: true, control_plane_handshake_verified: true },
  };
  assert.equal(planGuardianAbSlot(base).action, GUARDIAN_SLOT_ACTIONS.STAGE_INACTIVE);
  const staged = { ...base, slot_b: { release_id: 'guardian-release-2', digest_sha256: '1'.repeat(64), healthy: false, owner_session_verified: false, control_plane_handshake_verified: false } };
  assert.equal(planGuardianAbSlot(staged).action, GUARDIAN_SLOT_ACTIONS.HEALTH_CHALLENGE);
  const healthy = { ...staged, slot_b: { ...staged.slot_b, healthy: true, owner_session_verified: true, control_plane_handshake_verified: true } };
  assert.equal(planGuardianAbSlot(healthy).action, GUARDIAN_SLOT_ACTIONS.PROMOTE_POINTER);
  assert.equal(planGuardianAbSlot({ ...healthy, promotion_readback_verified: true, post_promotion_health_failed: true }).action, GUARDIAN_SLOT_ACTIONS.ROLLBACK_POINTER);
});

test('authority does not advance from a Git SHA without verified immutable artifact evidence', () => {
  const sha = 'e'.repeat(40);
  const held = verifiedReleaseAuthorityGate({ desired_source_sha: sha, release: { target_commitish: sha } });
  assert.equal(held.action, 'HOLD_AUTHORITY');
  const candidate = verifiedReleaseAuthorityGate({
    desired_source_sha: sha,
    current_authority_sha: 'd'.repeat(40),
    release: {
      release_id: 'release-1', target_commitish: sha, immutable: true, draft: false,
      verified_physical_update: true, manifest_verified: true, provenance_verified: true,
      signature_verified: true, freshness_verified: true, artifact_sha256: '9'.repeat(64), artifact_size: 4096,
    },
  });
  assert.equal(candidate.action, 'AUTHORITY_ADVANCE_CANDIDATE');
  assert.equal(candidate.authority_advance_allowed, false);
  assert.equal(candidate.requires_external_authority_executor, true);
});

test('SLO model measures useful work rather than heartbeat', () => {
  const report = usefulWorkSlo({
    ready_to_claim_ms: [5_000, 8_000, 10_000, 15_000, 20_000],
    recovery_ms: [30_000, 60_000, 100_000],
    effect_attempts: [{ attempted: true, outcome: 'CONFIRMED' }, { attempted: true, outcome: 'CONFIRMED' }],
    source_live_drift_ms: [10_000, 30_000],
    traces: [{ task: 1, claim: 1, effect: 1, target: 1, release: 1, readback: 1 }],
    branch_age_ms: [3_600_000, 7_200_000],
  });
  assert.equal(report.gates.useful_work_latency, true);
  assert.equal(report.gates.duplicate_effects, true);
  assert.equal(report.gates.traceability, true);
});

test('Postgres pilot is append-only, service-role scoped, queue-reference-only, and not SECURITY DEFINER', async () => {
  const migration = await fs.readFile(path.join(root, 'supabase/migrations/20260905041000_sovereign_effect_ledger_pilot_v1.sql'), 'utf8');
  assert.match(migration, /devos_effect_event_v1/);
  assert.match(migration, /before update or delete/i);
  assert.match(migration, /one_attempt/);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all on table public\.devos_effect_event_v1 from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert on table public\.devos_effect_event_v1 to service_role/i);
  assert.match(migration, /devos_effect_delivery_outbox_v1/);
  assert.doesNotMatch(migration, /security\s+definer/i);
  assert.doesNotMatch(migration, /task_id\s+uuid|prompt|send_payload/i);
});
