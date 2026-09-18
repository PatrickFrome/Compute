import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RsiEpisodeOrchestrator,
  rsiEpisodeOrchestratorTrustRootSnapshot,
} from '../src/rsi-episode-orchestrator.mjs';

const sourceSha = 'a'.repeat(40);
const trustDigest = 'b'.repeat(64);
const d = (c) => c.repeat(64);
const candidateId = \`candidate_sha256_\${'c'.repeat(64)}\`;

function opened(orchestrator, overrides = {}) {
  const event = orchestrator.prepareOpen({
    episode_id: 'episode:test:1',
    observation_digest: d('1'),
    opportunity_id: 'opportunity:test:1',
    hypothesis_digest: d('2'),
    mutation_surface: 'BROWSER_RUNTIME',
    search_context_digest: d('3'),
    max_candidates: 4,
    ...overrides,
  });
  orchestrator.apply(event);
  return event;
}

function candidate(orchestrator, overrides = {}) {
  const event = orchestrator.prepareCandidate({
    episode_id: 'episode:test:1',
    candidate_id: candidateId,
    candidate_sha: 'c'.repeat(40),
    parent_sha: sourceSha,
    build_plan_digest: d('4'),
    mutation_surface: 'BROWSER_RUNTIME',
    ...overrides,
  });
  orchestrator.apply(event);
  return event;
}

function evidence(orchestrator, kind, index, result = 'PASS', extra = {}) {
  const event = orchestrator.prepareEvidence({
    episode_id: 'episode:test:1',
    candidate_id: candidateId,
    evidence_id: \`evidence:test:\${index}\`,
    evidence_kind: kind,
    evidence_digest: String(index).padStart(64, '0'),
    result,
    source_sha: sourceSha,
    trust_root_set_digest: trustDigest,
    ...extra,
  });
  orchestrator.apply(event);
  return event;
}

test('episode requires the complete independent evidence set before nomination readiness', () => {
  const o = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  opened(o);
  candidate(o);
  const kinds = ['HARD_INVARIANTS', 'OBJECTIVES', 'HOLDOUT', 'REGRESSION_REPLAY', 'EVALUATION_INTEGRITY', 'TOURNAMENT'];
  kinds.slice(0, -1).forEach((kind, index) => evidence(o, kind, index + 1));
  let readiness = o.nominationReadiness({ episode_id: 'episode:test:1', candidate_id: candidateId });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing_evidence_kinds, ['TOURNAMENT']);
  evidence(o, 'TOURNAMENT', 6);
  readiness = o.nominationReadiness({ episode_id: 'episode:test:1', candidate_id: candidateId });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.state, 'NOMINATION_READY');
  assert.equal(readiness.requires_external_promotion_gate, true);
  assert.equal(readiness.promotion_authority, false);
});

test('ambiguous evaluation is terminal for the candidate generation and never enables retry', () => {
  const o = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  opened(o);
  candidate(o);
  evidence(o, 'HARD_INVARIANTS', 1, 'AMBIGUOUS', { ambiguous_effect: true });
  const readiness = o.nominationReadiness({ episode_id: 'episode:test:1', candidate_id: candidateId });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.state, 'HELD');
  assert.equal(readiness.automatic_retry_allowed, false);
  assert.equal(readiness.physical_effect_replay_allowed, false);
  assert.deepEqual(readiness.blocking_evidence_kinds, ['HARD_INVARIANTS']);
});

test('evidence must bind the exact source and trust-root set', () => {
  const o = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  opened(o);
  candidate(o);
  assert.throws(() => o.prepareEvidence({
    episode_id: 'episode:test:1',
    candidate_id: candidateId,
    evidence_id: 'evidence:bad:source',
    evidence_kind: 'HARD_INVARIANTS',
    evidence_digest: d('5'),
    result: 'PASS',
    source_sha: 'd'.repeat(40),
    trust_root_set_digest: trustDigest,
  }), /evidence_source_mismatch/);
  assert.throws(() => o.prepareEvidence({
    episode_id: 'episode:test:1',
    candidate_id: candidateId,
    evidence_id: 'evidence:bad:root',
    evidence_kind: 'HARD_INVARIANTS',
    evidence_digest: d('5'),
    result: 'PASS',
    source_sha: sourceSha,
    trust_root_set_digest: d('e'),
  }), /evidence_trust_root_mismatch/);
});

test('candidate generation is fenced to the exact parent and bounded mutation surface', () => {
  const o = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  opened(o);
  assert.throws(() => o.prepareCandidate({
    episode_id: 'episode:test:1', candidate_id: candidateId, candidate_sha: 'c'.repeat(40),
    parent_sha: 'd'.repeat(40), build_plan_digest: d('4'), mutation_surface: 'BROWSER_RUNTIME',
  }), /candidate_parent_not_bound_source/);
  assert.throws(() => o.prepareCandidate({
    episode_id: 'episode:test:1', candidate_id: candidateId, candidate_sha: 'c'.repeat(40),
    parent_sha: sourceSha, build_plan_digest: d('4'), mutation_surface: 'PROMPT_ROUTING',
  }), /candidate_surface_mismatch/);
});

test('one evidence kind cannot be overwritten; a new generation is required', () => {
  const o = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  opened(o);
  candidate(o);
  evidence(o, 'OBJECTIVES', 1);
  assert.throws(() => o.prepareEvidence({
    episode_id: 'episode:test:1', candidate_id: candidateId, evidence_id: 'evidence:test:replacement',
    evidence_kind: 'OBJECTIVES', evidence_digest: d('9'), result: 'PASS', source_sha: sourceSha,
    trust_root_set_digest: trustDigest,
  }), /evidence_kind_already_recorded/);
});

test('event replay reconstructs identical bounded episode state', () => {
  const first = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  const events = [opened(first), candidate(first), evidence(first, 'HARD_INVARIANTS', 1)];
  const second = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  second.replay(events);
  assert.deepEqual(second.snapshot(), first.snapshot());
});

test('episode event digest and zero-authority fields are tamper evident', () => {
  const o = new RsiEpisodeOrchestrator({ source_sha: sourceSha, trust_root_set_digest: trustDigest });
  const event = o.prepareOpen({
    episode_id: 'episode:test:1', observation_digest: d('1'), opportunity_id: 'opportunity:test:1',
    hypothesis_digest: d('2'), mutation_surface: 'BROWSER_RUNTIME', search_context_digest: d('3'),
  });
  assert.throws(() => o.apply({ ...event, promotion_authority: true }), /event_promotion_authority_invalid/);
  assert.throws(() => o.apply({ ...event, opportunity_id: 'opportunity:test:tampered' }), /event_digest_mismatch/);
});

test('orchestrator trust root is immutable and never grants effect authority', () => {
  const root = rsiEpisodeOrchestratorTrustRootSnapshot();
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-episode-orchestrator.mjs'));
  assert.deepEqual(root.required_evidence_kinds, ['HARD_INVARIANTS', 'OBJECTIVES', 'HOLDOUT', 'REGRESSION_REPLAY', 'EVALUATION_INTEGRITY', 'TOURNAMENT']);
  assert.equal(root.candidate_can_promote, false);
  assert.equal(root.candidate_can_invoke_self_update, false);
  assert.equal(root.physical_effect_replay_allowed, false);
  assert.equal(root.authority_effect, false);
});
