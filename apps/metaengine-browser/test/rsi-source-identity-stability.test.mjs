import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSourceIdentityConvergenceEvidence,
} from '../src/rsi-source-identity-convergence.mjs';
import {
  createRsiFreshSourceIdentityConvergenceCertificate,
} from '../src/rsi-source-identity-freshness.mjs';
import {
  createRsiStableSourceIdentityConvergenceCertificate,
  verifyRsiStableSourceIdentityConvergenceCertificate,
  rsiSourceIdentityStabilityTrustRootSnapshot,
} from '../src/rsi-source-identity-stability.mjs';

const a='a'.repeat(40);
const b='b'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function convergence({
  sha=a,
  epoch=87,
  evidenceId='source.identity.stability.evidence',
  observedAt='2026-09-19T16:00:00Z',
  githubDigest=d('1'),
  dbDigest=d('2'),
  runtimeDigest=d('3'),
}={}){
  return createRsiSourceIdentityConvergenceEvidence({
    evidence_id:evidenceId,
    github_source_sha:sha,
    db_authority_baseline_sha:sha,
    runtime_target_git_sha:sha,
    github_ref:'refs/heads/main',
    db_authority_key:'METAENGINE_DEVOS',
    runtime_client_id:'runtime-client-1',
    db_alignment_epoch:epoch,
    github_readback_digest:githubDigest,
    db_authority_readback_digest:dbDigest,
    runtime_readback_digest:runtimeDigest,
    observed_at:observedAt,
    external_github_reader:true,
    external_db_reader:true,
    external_runtime_reader:true,
    authored_by_candidate:false,
  });
}

function freshRound({
  id,
  baseSecond,
  sha=a,
  epoch=87,
  process='process-incarnation-1',
  evidenceId,
  githubDigest=d('1'),
  dbDigest=d('2'),
  runtimeDigest=d('3'),
}){
  const s=(n)=>String(n).padStart(2,'0');
  const t=(offset)=>`2026-09-19T16:00:${s(baseSecond+offset)}Z`;
  return createRsiFreshSourceIdentityConvergenceCertificate({
    certificate_id:id,
    convergence_evidence:convergence({
      sha,epoch,evidenceId,observedAt:t(0),githubDigest,dbDigest,runtimeDigest,
    }),
    github_readback:{
      source_kind:'GITHUB_API_MAIN_REF',
      repository:'PatrickFrome/Compute',
      ref:'refs/heads/main',
      head_sha:sha,
      readback_digest:githubDigest,
      read_at:t(1),
      authored_by_candidate:false,
    },
    db_authority_readback:{
      source_kind:'SUPABASE_ROADMAP_AUTHORITY_ROW',
      project_ref:'xpeibufgzjknrhbhpffp',
      authority_key:'METAENGINE_DEVOS',
      baseline_sha:sha,
      alignment_epoch:epoch,
      readback_digest:dbDigest,
      read_at:t(2),
      authored_by_candidate:false,
    },
    runtime_readback:{
      source_kind:'DURABLE_RUNTIME_STATE_ROW',
      project_ref:'xpeibufgzjknrhbhpffp',
      client_id:'runtime-client-1',
      process_incarnation_id:process,
      target_git_sha:sha,
      last_seen_at:t(3),
      readback_digest:runtimeDigest,
      read_at:t(4),
      authored_by_candidate:false,
    },
    evaluated_at:t(5),
    authored_by_candidate:false,
  });
}

function rounds(overrides={}){
  return {
    certificate_id:'source.identity.stability.1',
    first_round:freshRound({
      id:'fresh.round.1',
      baseSecond:0,
      evidenceId:'source.identity.stability.evidence.1',
    }),
    second_round:freshRound({
      id:'fresh.round.2',
      baseSecond:8,
      evidenceId:'source.identity.stability.evidence.2',
    }),
    evaluated_at:'2026-09-19T16:00:14Z',
    authored_by_candidate:false,
    ...overrides,
  };
}

test('two strictly newer fresh rounds prove stable source identity without authority',()=>{
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(rounds());
  assert.equal(certificate.state,'STABLE_SOURCE_IDENTITY_CONVERGED');
  assert.equal(certificate.stable_source_identity_converged,true);
  assert.equal(certificate.eligible_for_external_admission_review,true);
  assert.deepEqual(certificate.blockers,[]);
  assert.equal(certificate.stable_window_ms,5_000);
  assert.equal(certificate.stability_policy.caller_configurable,false);
  assert.equal(certificate.execution_authority,false);
  assert.equal(certificate.browser_authority,false);
  assert.equal(certificate.scheduler_authority,false);
  assert.equal(certificate.promotion_authority,false);
  assert.equal(certificate.authority_effect,false);
  assert.equal(
    verifyRsiStableSourceIdentityConvergenceCertificate(certificate).certificate_digest,
    certificate.certificate_digest,
  );
});

test('reusing one fresh certificate as both rounds is blocked as replay',()=>{
  const input=rounds();
  input.second_round=input.first_round;
  input.evaluated_at='2026-09-19T16:00:06Z';
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('REPLAYED_ROUND_CERTIFICATE'));
  assert.ok(certificate.blockers.includes('ROUND_EVALUATION_ORDER_INVALID'));
  assert.equal(certificate.eligible_for_external_admission_review,false);
});

test('overlapping readback rounds do not establish a stability interval',()=>{
  const input=rounds({
    second_round:freshRound({
      id:'fresh.round.overlap',
      baseSecond:3,
      evidenceId:'source.identity.stability.evidence.overlap',
    }),
    evaluated_at:'2026-09-19T16:00:09Z',
  });
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('STABILITY_WINDOW_TOO_SHORT_OR_OVERLAPPING'));
});

test('a converged source tuple that changes between rounds is blocked',()=>{
  const input=rounds({
    second_round:freshRound({
      id:'fresh.round.changed',
      baseSecond:8,
      sha:b,
      evidenceId:'source.identity.stability.evidence.changed',
      githubDigest:d('4'),
      dbDigest:d('5'),
      runtimeDigest:d('6'),
    }),
  });
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('SOURCE_IDENTITY_CHANGED_BETWEEN_ROUNDS'));
  assert.equal(certificate.stable_source_identity_converged,false);
});

test('DB epoch movement blocks stability even when the exact source SHA is unchanged',()=>{
  const input=rounds({
    second_round:freshRound({
      id:'fresh.round.epoch',
      baseSecond:8,
      epoch:88,
      evidenceId:'source.identity.stability.evidence.epoch',
    }),
  });
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('DB_ALIGNMENT_EPOCH_CHANGED_BETWEEN_ROUNDS'));
});

test('runtime reincarnation blocks stability even on the same target SHA',()=>{
  const input=rounds({
    second_round:freshRound({
      id:'fresh.round.restart',
      baseSecond:8,
      process:'process-incarnation-2',
      evidenceId:'source.identity.stability.evidence.restart',
    }),
  });
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('RUNTIME_PROCESS_INCARNATION_CHANGED_BETWEEN_ROUNDS'));
});

test('an old second-round certificate cannot be repackaged as a current stable witness',()=>{
  const input=rounds({evaluated_at:'2026-09-19T16:02:00Z'});
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('SECOND_ROUND_CERTIFICATE_STALE'));
});

test('candidate-authored stability certificate is rejected',()=>{
  assert.throws(
    ()=>createRsiStableSourceIdentityConvergenceCertificate(
      rounds({authored_by_candidate:true}),
    ),
    /external_certificate_owner_required/,
  );
});

test('canonical verifier rejects derived-state tampering',()=>{
  const certificate=createRsiStableSourceIdentityConvergenceCertificate(rounds());
  assert.throws(
    ()=>verifyRsiStableSourceIdentityConvergenceCertificate({
      ...certificate,
      state:'SOURCE_IDENTITY_STABILITY_BLOCKED',
    }),
    /canonical_mismatch|digest_mismatch/,
  );
});

test('trust root freezes the double-collect policy and remains zero-authority',()=>{
  const root=rsiSourceIdentityStabilityTrustRootSnapshot();
  assert.equal(root.min_stability_window_ms,1_000);
  assert.equal(root.max_stability_window_ms,60_000);
  assert.equal(root.strictly_newer_readback_round_required,true);
  assert.equal(root.exact_db_alignment_epoch_stable_required,true);
  assert.equal(root.exact_runtime_process_incarnation_stable_required,true);
  assert.equal(root.candidate_cannot_author_certificate,true);
  assert.equal(root.stable_witness_grants_effect_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.authority_effect,false);
});
