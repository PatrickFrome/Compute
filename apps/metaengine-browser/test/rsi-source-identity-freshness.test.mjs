import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSourceIdentityConvergenceEvidence,
} from '../src/rsi-source-identity-convergence.mjs';
import {
  createRsiFreshSourceIdentityConvergenceCertificate,
  verifyRsiFreshSourceIdentityConvergenceCertificate,
  rsiSourceIdentityFreshnessTrustRootSnapshot,
} from '../src/rsi-source-identity-freshness.mjs';

const a='a'.repeat(40);
const b='b'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function convergence(overrides={}){
  return createRsiSourceIdentityConvergenceEvidence({
    evidence_id:'source.identity.evidence.fresh.1',
    github_source_sha:a,
    db_authority_baseline_sha:a,
    runtime_target_git_sha:a,
    github_ref:'refs/heads/main',
    db_authority_key:'METAENGINE_DEVOS',
    runtime_client_id:'runtime-client-1',
    db_alignment_epoch:87,
    github_readback_digest:d('1'),
    db_authority_readback_digest:d('2'),
    runtime_readback_digest:d('3'),
    observed_at:'2026-09-19T16:00:00Z',
    external_github_reader:true,
    external_db_reader:true,
    external_runtime_reader:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function args(overrides={}){
  return {
    certificate_id:'source.identity.freshness.1',
    convergence_evidence:convergence(),
    github_readback:{
      source_kind:'GITHUB_API_MAIN_REF',
      repository:'PatrickFrome/Compute',
      ref:'refs/heads/main',
      head_sha:a,
      readback_digest:d('1'),
      read_at:'2026-09-19T16:00:10Z',
      authored_by_candidate:false,
    },
    db_authority_readback:{
      source_kind:'SUPABASE_ROADMAP_AUTHORITY_ROW',
      project_ref:'xpeibufgzjknrhbhpffp',
      authority_key:'METAENGINE_DEVOS',
      baseline_sha:a,
      alignment_epoch:87,
      readback_digest:d('2'),
      read_at:'2026-09-19T16:00:15Z',
      authored_by_candidate:false,
    },
    runtime_readback:{
      source_kind:'DURABLE_RUNTIME_STATE_ROW',
      project_ref:'xpeibufgzjknrhbhpffp',
      client_id:'runtime-client-1',
      process_incarnation_id:'process-incarnation-1',
      target_git_sha:a,
      last_seen_at:'2026-09-19T16:00:18Z',
      readback_digest:d('3'),
      read_at:'2026-09-19T16:00:20Z',
      authored_by_candidate:false,
    },
    evaluated_at:'2026-09-19T16:00:25Z',
    authored_by_candidate:false,
    ...overrides,
  };
}

test('fresh typed readbacks preserve exact source convergence without granting authority',()=>{
  const certificate=createRsiFreshSourceIdentityConvergenceCertificate(args());
  assert.equal(certificate.state,'FRESH_SOURCE_IDENTITY_CONVERGED');
  assert.equal(certificate.fresh_source_identity_converged,true);
  assert.equal(certificate.eligible_for_external_admission_review,true);
  assert.deepEqual(certificate.blockers,[]);
  assert.equal(certificate.readbacks.runtime.process_incarnation_id,'process-incarnation-1');
  assert.equal(certificate.freshness_policy.caller_configurable,false);
  assert.equal(certificate.execution_authority,false);
  assert.equal(certificate.browser_authority,false);
  assert.equal(certificate.scheduler_authority,false);
  assert.equal(certificate.promotion_authority,false);
  assert.equal(certificate.authority_effect,false);
  assert.equal(
    verifyRsiFreshSourceIdentityConvergenceCertificate(certificate).certificate_digest,
    certificate.certificate_digest,
  );
});

test('stale github readback blocks admission even when all three SHAs match',()=>{
  const input=args();
  input.github_readback={...input.github_readback,read_at:'2026-09-19T15:58:00Z'};
  const certificate=createRsiFreshSourceIdentityConvergenceCertificate(input);
  assert.equal(certificate.fresh_source_identity_converged,false);
  assert.equal(certificate.eligible_for_external_admission_review,false);
  assert.ok(certificate.blockers.includes('GITHUB_READBACK_STALE'));
});

test('cross-plane readback span is bounded independently of individual age',()=>{
  const input=args({
    evaluated_at:'2026-09-19T16:00:55Z',
  });
  input.github_readback={...input.github_readback,read_at:'2026-09-19T16:00:00Z'};
  input.db_authority_readback={...input.db_authority_readback,read_at:'2026-09-19T16:00:25Z'};
  input.runtime_readback={
    ...input.runtime_readback,
    read_at:'2026-09-19T16:00:40Z',
    last_seen_at:'2026-09-19T16:00:38Z',
  };
  const certificate=createRsiFreshSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('READBACK_TIME_SPAN_EXCEEDED'));
  assert.equal(certificate.eligible_for_external_admission_review,false);
});

test('future readback beyond frozen skew fails closed',()=>{
  const input=args();
  input.db_authority_readback={...input.db_authority_readback,read_at:'2026-09-19T16:00:40Z'};
  const certificate=createRsiFreshSourceIdentityConvergenceCertificate(input);
  assert.ok(certificate.blockers.includes('DB_AUTHORITY_READBACK_FUTURE'));
});

test('runtime heartbeat must be fresh at the runtime read itself',()=>{
  const input=args();
  input.runtime_readback={
    ...input.runtime_readback,
    last_seen_at:'2026-09-19T15:58:00Z',
  };
  assert.throws(
    ()=>createRsiFreshSourceIdentityConvergenceCertificate(input),
    /runtime_heartbeat_stale_at_read/,
  );
});

test('typed readback identity must bind the exact parent convergence evidence',()=>{
  const input=args();
  input.runtime_readback={...input.runtime_readback,target_git_sha:b};
  assert.throws(
    ()=>createRsiFreshSourceIdentityConvergenceCertificate(input),
    /runtime_target_mismatch/,
  );
});

test('candidate-authored freshness certificate is rejected',()=>{
  assert.throws(
    ()=>createRsiFreshSourceIdentityConvergenceCertificate(args({authored_by_candidate:true})),
    /external_certificate_owner_required/,
  );
});

test('canonical verifier rejects derived-state tampering even with a recomputed-looking payload',()=>{
  const certificate=createRsiFreshSourceIdentityConvergenceCertificate(args());
  assert.throws(
    ()=>verifyRsiFreshSourceIdentityConvergenceCertificate({
      ...certificate,
      state:'SOURCE_IDENTITY_FRESHNESS_BLOCKED',
    }),
    /canonical_mismatch|digest_mismatch/,
  );
});

test('parent SHA drift remains a blocker after fresh readbacks',()=>{
  const input=args({
    convergence_evidence:convergence({runtime_target_git_sha:b}),
  });
  input.runtime_readback={...input.runtime_readback,target_git_sha:b};
  const certificate=createRsiFreshSourceIdentityConvergenceCertificate(input);
  assert.equal(certificate.fresh_source_identity_converged,false);
  assert.ok(certificate.blockers.includes('SOURCE_IDENTITY_NOT_CONVERGED'));
});

test('trust root freezes freshness budget and preserves zero authority',()=>{
  const root=rsiSourceIdentityFreshnessTrustRootSnapshot();
  assert.equal(root.max_readback_age_ms,60_000);
  assert.equal(root.max_readback_span_ms,30_000);
  assert.equal(root.max_future_skew_ms,5_000);
  assert.equal(root.candidate_cannot_configure_freshness,true);
  assert.equal(root.candidate_cannot_author_certificate,true);
  assert.equal(root.runtime_process_incarnation_required,true);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.authority_effect,false);
});
