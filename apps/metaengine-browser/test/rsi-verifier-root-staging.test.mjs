import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createRsiVerifierRootChangeReview } from '../src/rsi-verifier-root-change-review.mjs';
import {
  createRsiVerifierRootStagingManifest,
  verifyRsiVerifierRootStagingManifest,
  createRsiVerifierRootPropagationReceipt,
  verifyRsiVerifierRootPropagationReceipt,
  createRsiVerifierRootStagingReview,
  verifyRsiVerifierRootStagingReview,
  rsiVerifierRootStagingTrustRootSnapshot,
} from '../src/rsi-verifier-root-staging.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function proposal(){
  const current=7,next=8,predecessor=d('1'),candidate=d('2'),secondary=d('3');
  const historyInput={
    prior_root_history_digest:d('4'),current_root_generation:current,next_root_generation:next,
    predecessor_verifier_root_digest:predecessor,candidate_verifier_root_digest:candidate,
    qualification_digest:d('5'),constitution_digest:d('6'),compatibility_manifest_digest:d('7'),
    compatibility_evidence_digest:d('8'),
  };
  const core={
    schema:'metaengine.rsi.verifier-root-change-proposal.v1',version:1,proposal_id:'staging.root.proposal.1',
    source_sha:SOURCE,qualification_digest:historyInput.qualification_digest,admission_digest:d('9'),
    plan_digest:d('a'),constitution_digest:historyInput.constitution_digest,current_root_generation:current,
    next_root_generation:next,predecessor_verifier_root_digest:predecessor,candidate_verifier_root_digest:candidate,
    secondary_verifier_root_digest:secondary,prior_root_history_digest:historyInput.prior_root_history_digest,
    next_root_history_digest:dg(historyInput),compatibility_manifest_digest:historyInput.compatibility_manifest_digest,
    compatibility_evidence_digest:historyInput.compatibility_evidence_digest,generation_increment_exactly_one:true,
    root_history_hash_chained:true,rollback_to_prior_generation_allowed:false,
    active_verifier_root_digest:predecessor,proposed_verifier_root_digest:candidate,root_change_authorized:false,
    verifier_activation_authorized:false,proposal_is_trust_root_authority:false,candidate_can_choose_generation:false,
    candidate_can_rewrite_root_history:false,candidate_can_modify_constitution:false,
    external_proposal_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,proposal_digest:dg(core)});
}

const CHECKS=[
 'qualification_binding_pass','constitution_unchanged_pass','compatibility_pass','rollback_protection_pass',
 'root_history_continuity_pass','independent_audit_pass','shadow_nonregression_pass',
];

function approval(p,role){
  const approverRoot=role==='PREDECESSOR_TRUST'?p.predecessor_verifier_root_digest:p.secondary_verifier_root_digest;
  const checks=Object.fromEntries(CHECKS.map(x=>[x,true]));
  const core={
    schema:'metaengine.rsi.verifier-root-change-approval.v1',version:1,
    approval_id:`staging.root.${role.toLowerCase()}.approval.1`,source_sha:p.source_sha,
    proposal_digest:p.proposal_digest,qualification_digest:p.qualification_digest,constitution_digest:p.constitution_digest,
    approver_role:role,approver_root_digest:approverRoot,
    predecessor_verifier_root_digest:p.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:p.candidate_verifier_root_digest,
    secondary_verifier_root_digest:p.secondary_verifier_root_digest,
    current_root_generation:p.current_root_generation,next_root_generation:p.next_root_generation,
    prior_root_history_digest:p.prior_root_history_digest,next_root_history_digest:p.next_root_history_digest,
    compatibility_manifest_digest:p.compatibility_manifest_digest,compatibility_evidence_digest:p.compatibility_evidence_digest,
    ...checks,overall_pass:true,approval_evidence_digest:dg({role}),evidence_refs:Object.freeze([`staging:${role.toLowerCase()}`]),
    approval_is_root_change_authority:false,approval_is_activation_authority:false,candidate_self_approval_accepted:false,
    external_approver:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,approval_digest:dg(core)});
}

function rootChange(){
  const p=proposal(),predecessor=approval(p,'PREDECESSOR_TRUST'),secondary=approval(p,'SECONDARY_TRUST');
  const review=createRsiVerifierRootChangeReview({
    review_id:'staging.root.change.review.1',proposal:p,predecessor_approval:predecessor,secondary_approval:secondary,
    external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(review.state,'READY_FOR_EXTERNAL_TRUST_ROOT_CONTROLLER_REVIEW');
  return {proposal:p,predecessor,secondary,review};
}

function manifest(){
  const b=rootChange();
  const m=createRsiVerifierRootStagingManifest({
    staging_id:'staging.root.bundle.1',review:b.review,proposal:b.proposal,
    predecessor_approval:b.predecessor,secondary_approval:b.secondary,
    validator_roots:{PROMOTION:d('b'),RUNTIME:d('c'),TOURNAMENT:d('d')},
    external_staging_owner:true,authored_by_candidate:false,
  });
  return {...b,manifest:m};
}

function receipt(m,domain,overrides={}){
  return createRsiVerifierRootPropagationReceipt({
    receipt_id:`staging.root.${domain.toLowerCase()}.receipt.1`,manifest:m,
    validator_domain:domain,validator_root_digest:m.validator_roots[domain],
    observed_bundle_generation:m.staging_bundle_generation,
    observed_staging_bundle_digest:m.staging_bundle_digest,
    observed_active_verifier_root_digest:m.predecessor_verifier_root_digest,
    observed_root_digests:[m.predecessor_verifier_root_digest,m.candidate_verifier_root_digest],
    root_history_digest:m.next_root_history_digest,readback_evidence_digest:dg({domain}),
    evidence_refs:[`staging:readback:${domain.toLowerCase()}`],external_validator:true,authored_by_candidate:false,
    ...overrides,
  });
}

test('overlap staging manifest keeps predecessor active and candidate preloaded only',()=>{
  const {manifest:m}=manifest();
  verifyRsiVerifierRootStagingManifest(m);
  assert.equal(m.staging_bundle_generation,m.current_root_generation+1);
  assert.equal(m.active_verifier_root_digest,m.predecessor_verifier_root_digest);
  assert.equal(m.staged_candidate_root_digest,m.candidate_verifier_root_digest);
  assert.deepEqual(m.overlap_root_digests,[m.predecessor_verifier_root_digest,m.candidate_verifier_root_digest].sort());
  assert.equal(m.predecessor_retirement_authorized,false);
  assert.equal(m.root_change_authorized,false);
  assert.equal(m.verifier_activation_authorized,false);
  assert.equal(m.staging_write_authorized,false);
  assert.equal(m.authority_effect,false);
});

test('all three exact validator-domain readbacks yield review eligibility but no activation',()=>{
  const {manifest:m}=manifest();
  const rows=['PROMOTION','RUNTIME','TOURNAMENT'].map(domain=>receipt(m,domain));
  rows.forEach(row=>verifyRsiVerifierRootPropagationReceipt(row,{manifest:m}));
  const review=createRsiVerifierRootStagingReview({
    review_id:'staging.root.review.1',manifest:m,propagation_receipts:rows,
    external_review_owner:true,authored_by_candidate:false,
  });
  verifyRsiVerifierRootStagingReview(review,{manifest:m,propagation_receipts:rows});
  assert.equal(review.state,'READY_FOR_EXTERNAL_ROOT_ACTIVATION_REVIEW');
  assert.equal(review.all_validator_domains_propagated,true);
  assert.equal(review.active_verifier_root_digest,m.predecessor_verifier_root_digest);
  assert.equal(review.candidate_root_staged_only,true);
  assert.equal(review.predecessor_retirement_authorized,false);
  assert.equal(review.root_change_authorized,false);
  assert.equal(review.verifier_activation_authorized,false);
  assert.equal(review.root_activation_token,null);
  assert.equal(review.authority_effect,false);
});

test('candidate-only bundle cannot satisfy propagation readback',()=>{
  const {manifest:m}=manifest();
  assert.throws(()=>receipt(m,'RUNTIME',{
    observed_root_digests:[m.candidate_verifier_root_digest],
  }),/overlap_readback_required/);
});

test('early candidate activation fails propagation and blocks staging review',()=>{
  const {manifest:m}=manifest();
  const rows=[
    receipt(m,'PROMOTION'),
    receipt(m,'RUNTIME',{observed_active_verifier_root_digest:m.candidate_verifier_root_digest}),
    receipt(m,'TOURNAMENT'),
  ];
  assert.equal(rows[1].propagation_verified,false);
  const review=createRsiVerifierRootStagingReview({
    review_id:'staging.root.review.early-activation',manifest:m,propagation_receipts:rows,
    external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(review.state,'REJECTED_ROOT_STAGING_PROPAGATION');
  assert.equal(review.ready_for_external_root_activation_review,false);
  assert.equal(review.root_change_authorized,false);
});

test('missing validator domain cannot be replaced by duplicate readback',()=>{
  const {manifest:m}=manifest();
  const rows=[receipt(m,'PROMOTION'),receipt(m,'RUNTIME'),receipt(m,'RUNTIME',{receipt_id:'staging.root.runtime.receipt.2',readback_evidence_digest:d('e'),evidence_refs:['staging:readback:runtime:2']})];
  assert.throws(()=>createRsiVerifierRootStagingReview({
    review_id:'staging.root.review.missing-domain',manifest:m,propagation_receipts:rows,
    external_review_owner:true,authored_by_candidate:false,
  }),/domain_coverage_invalid/);
});

test('candidate-authored propagation receipt is rejected',()=>{
  const {manifest:m}=manifest();
  assert.throws(()=>createRsiVerifierRootPropagationReceipt({
    receipt_id:'staging.root.self.receipt',manifest:m,validator_domain:'RUNTIME',
    validator_root_digest:m.validator_roots.RUNTIME,observed_bundle_generation:m.staging_bundle_generation,
    observed_staging_bundle_digest:m.staging_bundle_digest,observed_active_verifier_root_digest:m.predecessor_verifier_root_digest,
    observed_root_digests:m.overlap_root_digests,root_history_digest:m.next_root_history_digest,
    readback_evidence_digest:d('f'),evidence_refs:['staging:self'],external_validator:false,authored_by_candidate:true,
  }),/external_validator_required/);
});

test('staging trust root freezes overlap propagation and forbids actuation',()=>{
  const root=rsiVerifierRootStagingTrustRootSnapshot();
  assert.deepEqual(root.required_validator_domains,['PROMOTION','RUNTIME','TOURNAMENT']);
  assert.equal(root.validator_domain_count,3);
  assert.equal(root.overlap_bundle_required,true);
  assert.equal(root.predecessor_must_remain_active,true);
  assert.equal(root.candidate_root_must_be_preloaded,true);
  assert.equal(root.candidate_only_bundle_forbidden,true);
  assert.equal(root.external_validator_readback_required,true);
  assert.equal(root.all_validator_domains_required,true);
  assert.equal(root.predecessor_retirement_authorized,false);
  assert.equal(root.root_change_authorized,false);
  assert.equal(root.verifier_activation_authorized,false);
  assert.equal(root.existing_runtime_ledger_is_only_staging_review_receipt_plane,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.root_staging_root_digest,/^sha256:[0-9a-f]{64}$/);
});
