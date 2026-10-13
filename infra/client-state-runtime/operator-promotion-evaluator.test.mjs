import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateIndependentCandidate, auditNoHostedFallback, createDenyNetworkProbe } from './operator-promotion-evaluator.mjs';

const NOW = Date.parse('2026-10-13T01:00:00Z');
const BASE = 'a'.repeat(40), CAND = 'b'.repeat(40);
const DIGEST_A = '1'.repeat(64), DIGEST_B = '2'.repeat(64), FIXTURE = '3'.repeat(64), RECEIPT = '4'.repeat(64);
const browser = new URL('../../apps/metaengine-browser/src/', import.meta.url);
const originalSources = () => ({
  supervisorSource: fs.readFileSync(new URL('native-supervisor-endpoints.mjs', browser), 'utf8'),
  bootstrapSource: fs.readFileSync(new URL('local-state-provider-bootstrap.mjs', browser), 'utf8'),
});
const trial = i => ({
  fixture_id: `case-${i}`,
  baseline: { correct: true, latency_ms: 100 + i },
  candidate: { correct: true, latency_ms: 70 + i },
  network_attempts: [], effects: [],
});
const sample = () => ({
  baseline: { source_sha: BASE, artifact_sha256: DIGEST_A, owner_id: 'local-owner', generation: 4 },
  candidate: { source_sha: CAND, artifact_sha256: DIGEST_B, owner_id: 'local-owner', generation: 5 },
  fixture_set_sha256: FIXTURE,
  trials: Array.from({ length: 12 }, (_, i) => trial(i)),
  critic: { actor_id: 'critic-1', implementer_id: 'implementer-2', disposition: 'PASS',
    independent: true, source_sha: CAND, fixture_set_sha256: FIXTURE,
    isolation_receipt_sha256: RECEIPT, observed_at: new Date(NOW - 60_000).toISOString() },
  rollback: { source_sha: BASE, artifact_sha256: DIGEST_A, owner_id: 'local-owner',
    generation: 4, rehearsal: 'PASS', unresolved_effects: 0 },
  transport: originalSources(),
});
const run = x => evaluateIndependentCandidate(x, { nowMs: NOW });
const blocked = (name, update, reason) => test(name, () => {
  const input = sample(); update(input);
  const verdict = run(input);
  assert.equal(verdict.state, 'BLOCKED');
  assert.ok(verdict.reasons.includes(reason), JSON.stringify(verdict));
  assert.equal(verdict.authority_effect, false);
  assert.equal(verdict.promotion_executed, false);
});

test('real P0 transport source has guarded loopback-only contract (static proof only)', () => {
  const audit = auditNoHostedFallback(originalSources());
  assert.deepEqual(audit.reasons, []);
  assert.equal(audit.status, 'SOURCE_CONTRACT_PASS');
  assert.equal(audit.runtime_network_proven, false);
});
test('paired quality/latency gains are review-only, never promotions', () => {
  const result = run(sample());
  assert.equal(result.state, 'REVIEW_REQUIRED', JSON.stringify(result.reasons));
  assert.equal(result.metrics.sample_count, 12);
  assert.equal(result.metrics.baseline_quality, 1);
  assert.equal(result.metrics.candidate_quality, 1);
  assert.ok(result.metrics.p95_improvement_fraction >= 0.05);
  assert.equal(result.deployment_qualified, false);
  assert.equal(result.installed_rollback_proven, false);
  assert.equal(result.cloud_fallback_allowed, false);
  assert.equal(result.promotion_executed, false);
  assert.equal(result.rollback_executed, false);
  assert.equal(result.authority_effect, false);
});
blocked('missing baseline artifact is not inferred', x => { delete x.baseline.artifact_sha256; }, 'BUILD_PROVENANCE_OR_GENERATION_INVALID');
blocked('cross-owner generation rejects promotion', x => { x.candidate.owner_id = 'other-owner'; }, 'BUILD_PROVENANCE_OR_GENERATION_INVALID');
blocked('same source SHA is not an upgrade', x => { x.candidate.source_sha = BASE; x.critic.source_sha = BASE; }, 'BUILD_PROVENANCE_OR_GENERATION_INVALID');
blocked('generation skipping is forbidden', x => { x.candidate.generation = 8; }, 'BUILD_PROVENANCE_OR_GENERATION_INVALID');
blocked('no independent critic is fail closed', x => { delete x.critic; }, 'INDEPENDENT_CRITIC_RECEIPT_UNPROVEN');
blocked('self-review of same implementer forbidden', x => { x.critic.actor_id = x.critic.implementer_id; }, 'INDEPENDENT_CRITIC_RECEIPT_UNPROVEN');
blocked('expired critic evidence forbidden', x => { x.critic.observed_at = new Date(NOW - 3_600_001).toISOString(); }, 'INDEPENDENT_CRITIC_RECEIPT_UNPROVEN');
blocked('critic must bind candidate source SHA', x => { x.critic.source_sha = BASE; }, 'INDEPENDENT_CRITIC_RECEIPT_UNPROVEN');
blocked('fixture set must be attested', x => { x.fixture_set_sha256 = null; }, 'FIXTURE_IDENTITY_MISSING');
blocked('rollback artifact mismatch blocks', x => { x.rollback.artifact_sha256 = DIGEST_B; }, 'ROLLBACK_NOT_FENCED_OR_REHEARSED');
blocked('unknown rollback effects block', x => { x.rollback.unresolved_effects = 1; }, 'ROLLBACK_NOT_FENCED_OR_REHEARSED');
blocked('rollback rehearsal absent is unsafe', x => { x.rollback.rehearsal = 'UNKNOWN'; }, 'ROLLBACK_NOT_FENCED_OR_REHEARSED');
blocked('fewer than 8 samples cannot qualify', x => { x.trials = x.trials.slice(0, 7); }, 'TRIAL_COUNT_INVALID');
blocked('duplicate fixture pair cannot inflate outcomes', x => { x.trials[1].fixture_id = x.trials[0].fixture_id; }, 'FIXTURE_PAIRING_AMBIGUOUS');
blocked('missing network witness cannot qualify', x => { delete x.trials[0].network_attempts; }, 'TRIAL_EVIDENCE_INCOMPLETE');
blocked('a single caught outbound attempt fails hermeticity', x => {
  x.trials[0].network_attempts = ['https://example.invalid/legacy'];
}, 'HERMETIC_ISOLATION_VIOLATED');
blocked('unreconciled effect under test invalidates isolation', x => {
  x.trials[1].effects = ['dispatch'];
}, 'HERMETIC_ISOLATION_VIOLATED');
blocked('quality regression on previously passed fixture blocks', x => {
  x.trials[5].candidate.correct = false;
}, 'QUALITY_REGRESSION');
blocked('p95 slowdown with good quality still blocks', x => {
  x.trials[11].candidate.latency_ms = 999;
}, 'LATENCY_REGRESSION');
blocked('no improvement cannot be promoted', x => {
  x.trials.forEach(t => { t.candidate.latency_ms = t.baseline.latency_ms; });
}, 'NO_MEASURED_IMPROVEMENT');
blocked('no owner policy source blocks evaluation', x => { x.transport = {}; }, 'TRANSPORT_SOURCE_MISSING');
blocked('hosted default added again blocks evaluation', x => {
  x.transport.supervisorSource += "\nNATIVE_SUPERVISOR_DEFAULT_BASE = 'https://hosted.invalid';";
}, 'HOSTED_SUPERVISOR_FALLBACK_DETECTED');
blocked('old hosted bootstrap assignment blocks evaluation', x => {
  x.transport.bootstrapSource += "\nMETAENGINE_FALLBACK_SUPERVISOR_BASE_URL = 'https://hosted.invalid';";
}, 'HOSTED_BOOTSTRAP_FALLBACK_DETECTED');
blocked('removing loopback check blocks evaluation', x => {
  x.transport.supervisorSource = x.transport.supervisorSource.replace("parsed.hostname !== '127.0.0.1'", 'true');
}, 'LOCAL_OWNER_TRANSPORT_CONTRACT_MISSING');
test('network probe records attempts, even if caller handles rejection', async () => {
  const probe = createDenyNetworkProbe();
  await assert.rejects(probe.fetch('https://legacy.invalid'), /hermetic_network_denied/);
  assert.equal(probe.attempts.length, 1);
});
test('invalid clock throws without effects or state changes', () => {
  assert.throws(() => evaluateIndependentCandidate(sample(), { nowMs: NaN }), /critic_clock_invalid/);
});
