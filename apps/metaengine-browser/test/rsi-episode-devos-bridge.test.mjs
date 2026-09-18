import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiEpisodeDevosCandidateRequest,
  createRsiEpisodeCandidateAdmission,
  rsiEpisodeDevosBridgeTrustRootSnapshot,
} from '../src/rsi-episode-devos-bridge.mjs';

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
}
function digest(v) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(v)), 'utf8').digest('hex');
}

const source = 'a'.repeat(40);
const trust = 'b'.repeat(64);
const hypothesis = 'c'.repeat(64);

const episode = {
  schema: 'metaengine.rsi.episode-snapshot.v1',
  version: 1,
  episode_id: 'episode:bridge:1',
  source_sha: source,
  trust_root_set_digest: trust,
  hypothesis_digest: hypothesis,
  mutation_surface: 'BROWSER_RUNTIME',
  max_candidates: 4,
  candidates: {},
  authority_effect: false,
  automatic_retry_allowed: false,
};

function plan(extra = {}) {
  const value = {
    schema: 'metaengine.rsi.devos-experiment-plan.v1',
    experiment_id: 'rsi_exp_1234567890abcdef12345678',
    source_sha: source,
    target_branch: 'work/rsi/test-aabbccdd',
    hypothesis_id: 'rsi_hyp_1234567890abcdef12345678',
    hypothesis_digest: hypothesis,
    task_spec: {
      rsi: { mutation_surface: 'BROWSER_RUNTIME' },
    },
    requires_existing_devos_scheduler: true,
    lease_created: false,
    agent_assigned: false,
    workspace_bound: false,
    command_created: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  };
  value.plan_digest = digest(value);
  return value;
}

function handoff(extra = {}) {
  return {
    schema: 'metaengine.rsi.isolated-candidate-handoff.v1',
    version: 1,
    parent_sha: source,
    candidate_sha: 'd'.repeat(40),
    mutation_surface: 'BROWSER_RUNTIME',
    handoff_digest: `sha256:${'e'.repeat(64)}`,
    candidate_capsule: { candidate_id: `candidate_sha256_${'f'.repeat(64)}` },
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  };
}

test('request is deterministic and never becomes DevOS dispatch authority', () => {
  const first = createRsiEpisodeDevosCandidateRequest({ episode, experiment_plan: plan() });
  const second = createRsiEpisodeDevosCandidateRequest({ episode, experiment_plan: plan() });
  assert.deepEqual(first, second);
  assert.equal(first.requires_existing_devos_scheduler, true);
  assert.equal(first.external_scheduler_owner_required, true);
  assert.equal(first.dispatch_authorized, false);
  assert.equal(first.scheduler_authority, false);
  assert.equal(first.task_created, false);
  assert.equal(first.automatic_retry_allowed, false);
  assert.equal(first.repeat_after_ambiguous_result_allowed, false);
});

test('request rejects plan authority escalation and source drift', () => {
  const elevated = plan();
  elevated.execution_authority = true;
  assert.throws(
    () => createRsiEpisodeDevosCandidateRequest({ episode, experiment_plan: elevated }),
    /plan_execution_authority_invalid/,
  );
  const drift = plan({ source_sha: '9'.repeat(40) });
  assert.throws(
    () => createRsiEpisodeDevosCandidateRequest({ episode, experiment_plan: drift }),
    /source_mismatch/,
  );
});

test('verified candidate handoff maps to exact episode registration without promotion authority', () => {
  const request = createRsiEpisodeDevosCandidateRequest({ episode, experiment_plan: plan() });
  const admission = createRsiEpisodeCandidateAdmission({ episode, request, candidate_handoff: handoff() });
  assert.equal(admission.registration.episode_id, episode.episode_id);
  assert.equal(admission.registration.parent_sha, source);
  assert.equal(admission.registration.candidate_sha, 'd'.repeat(40));
  assert.equal(admission.external_devos_result_required, true);
  assert.equal(admission.direct_promotion_enabled, false);
  assert.equal(admission.physical_effect_replay_allowed, false);
  assert.equal(admission.scheduler_authority, false);
});

test('candidate handoff remains exact-source, zero-promotion and non-replayable', () => {
  const request = createRsiEpisodeDevosCandidateRequest({ episode, experiment_plan: plan() });
  assert.throws(
    () => createRsiEpisodeCandidateAdmission({
      episode,
      request,
      candidate_handoff: handoff({ parent_sha: '9'.repeat(40) }),
    }),
    /candidate_parent_mismatch/,
  );
  assert.throws(
    () => createRsiEpisodeCandidateAdmission({
      episode,
      request,
      candidate_handoff: handoff({ eligible_for_promotion: true }),
    }),
    /candidate_handoff_policy_invalid/,
  );
  assert.throws(
    () => createRsiEpisodeCandidateAdmission({
      episode,
      request,
      candidate_handoff: handoff({ materialization_replay_authorized: true }),
    }),
    /candidate_handoff_policy_invalid/,
  );
});

test('bridge trust root keeps scheduler ownership external and immutable', () => {
  const root = rsiEpisodeDevosBridgeTrustRootSnapshot();
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-devos-experiment-plan.mjs'));
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-episode-orchestrator.mjs'));
  assert.equal(root.existing_devos_scheduler_only, true);
  assert.equal(root.request_is_not_dispatch_authority, true);
  assert.equal(root.repeat_after_ambiguous_result_allowed, false);
  assert.equal(root.authority_effect, false);
});
