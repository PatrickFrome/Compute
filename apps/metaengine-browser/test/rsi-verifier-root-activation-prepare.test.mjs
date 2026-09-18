import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiVerifierRootPropagationReceipt,
  createRsiVerifierRootStagingReview,
} from '../src/rsi-verifier-root-staging.mjs';
import {
  createRsiVerifierRootActivationPrepare,
  verifyRsiVerifierRootActivationPrepare,
  createRsiVerifierRootActivationReadinessReceipt,
  verifyRsiVerifierRootActivationReadinessReceipt,
  createRsiVerifierRootActivationPrepareReview,
  verifyRsiVerifierRootActivationPrepareReview,
  rsiVerifierRootActivationPrepareTrustRootSnapshot,
} from '../src/rsi-verifier-root-activation-prepare.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function stagingManifest(){
  const oldRoot=d('1'),candidate=d('2'),secondary=d('3'),history=d('4'),constitution=d('5');
  const overlap=[oldRoot,candidate].sort();
  const bundleCore={
    bundle_generation:8,active_verifier_root_digest:oldRoot,staged_candidate_root_digest:candidate,
    overlap_root_digests:overlap,root_history_digest:history,constitution_digest:constitution,
  };
  const core={
    schema:'metaengine.rsi.verifier-root-staging-manifest.v1',version:1,staging_id:'activation.prepare.staging.1',
    source_sha:SOURCE,root_change_review_digest:d('6'),root_change_proposal_digest:d('7'),qualification_digest:d('8'),
    constitution_digest:constitution,current_root_generation:7,staging_bundle_generation:8,
    predecessor_verifier_root_digest:oldRoot,candidate_verifier_root_digest:candidate,secondary_verifier_root_digest:secondary,
    prior_root_history_digest:d('9'),next_root_history_digest:history,overlap_root_digests:overlap,
    active_verifier_root_digest:oldRoot,staged_candidate_root_digest:candidate,staging_bundle_digest:dg(bundleCore),
    required_validator_domains:['PROMOTION','RUNTIME','TOURNAMENT'],
    validator_roots:{PROMOTION:d('a'),RUNTIME:d('b'),TOURNAMENT:d('c')},
    overlap_mode:'PREDECESSOR_ACTIVE_CANDIDATE_STAGED',predecessor_must_remain_active:true,
    candidate_must_be_preloaded_before_activation:true,candidate_only_bundle_forbidden:true,
    predecessor_retirement_authorized:false,root_change_authorized:false,verifier_activation_authorized:false,
    staging_write_authorized:false,external_staging_controller_required:true,propagation_readback_required:true,
    candidate_can_choose_validator_domains:false,candidate_can_choose_validator_roots:false,candidate_can_change_overlap:false,
    external_staging_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,manifest_digest:dg(core)});
}
function propagationReceipt(manifest,domain){
  return createRsiVerifierRootPropagationReceipt({
    receipt_id:`activation.prepare.propagation.${domain.toLowerCase()}`,manifest,
    validator_domain:domain,validator_root_digest:manifest.validator_roots[domain],
    observed_bundle_generation:manifest.staging_bundle_generation,
    observed_staging_bundle_digest:manifest.staging_bundle_digest,
    observed_active_verifier_root_digest:manifest.predecessor_verifier_root_digest,
    observed_root_digests:manifest.overlap_root_digests,root_history_digest:manifest.next_root_history_digest,
    readback_evidence_digest:dg({propagation:domain}),evidence_refs:[`activation:prepare:propagation:${domain.toLowerCase()}`],
    external_validator:true,authored_by_candidate:false,
  });
}
function stagingBundle(){
  const manifest=stagingManifest();
  const propagationReceipts=['PROMOTION','RUNTIME','TOURNAMENT'].map(x=>propagationReceipt(manifest,x));
  const stagingReview=createRsiVerifierRootStagingReview({
    review_id:'activation.prepare.staging.review.1',manifest,propagation_receipts:propagationReceipts,
    external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(stagingReview.state,'READY_FOR_EXTERNAL_ROOT_ACTIVATION_REVIEW');
  return {manifest,propagationReceipts,stagingReview};
}
function prepare(){
  const b=stagingBundle();
  const p=createRsiVerifierRootActivationPrepare({
    prepare_id:'activation.prepare.1',staging_review:b.stagingReview,manifest:b.manifest,
    propagation_receipts:b.propagationReceipts,
    readiness_roots:{PROMOTION:d('d'),RUNTIME:d('e'),TOURNAMENT:d('f')},
    external_prepare_owner:true,authored_by_candidate:false,
  });
  return {...b,prepare:p};
}
function readinessReceipt(p,domain,overrides={}){
  return createRsiVerifierRootActivationReadinessReceipt({
    receipt_id:`activation.prepare.readiness.${domain.toLowerCase()}`,prepare:p,
    readiness_domain:domain,readiness_root_digest:p.readiness_roots[domain],
    predecessor_liveness_pass:true,candidate_catchup_pass:true,joint_validation_pass:true,
    rollback_path_pass:true,root_history_freshness_pass:true,incident_free:true,no_pending_effect:true,
    observed_active_verifier_root_digest:p.predecessor_verifier_root_digest,
    observed_staging_bundle_digest:p.staging_bundle_digest,
    readiness_evidence_digest:dg({readiness:domain}),evidence_refs:[`activation:prepare:readiness:${domain.toLowerCase()}`],
    external_readiness_auditor:true,authored_by_candidate:false,...overrides,
  });
}

test('activation prepare keeps candidate learner non-authoritative and predecessor active',()=>{
  const {prepare:p}=prepare();verifyRsiVerifierRootActivationPrepare(p);
  assert.equal(p.mode,'JOINT_TRUST_PREPARE');
  assert.equal(p.candidate_role,'LEARNER_NON_AUTHORITATIVE');
  assert.equal(p.active_verifier_root_digest,p.predecessor_verifier_root_digest);
  assert.equal(p.candidate_can_vote,false);
  assert.equal(p.candidate_can_be_active,false);
  assert.equal(p.candidate_can_self_promote,false);
  assert.equal(p.predecessor_retirement_authorized,false);
  assert.equal(p.root_activation_commit_authorized,false);
  assert.equal(p.verifier_activation_authorized,false);
  assert.equal(p.activation_commit_token,null);
  assert.equal(p.authority_effect,false);
});

test('all readiness domains pass joint trust prepare without minting commit authority',()=>{
  const {prepare:p}=prepare();
  const rows=['PROMOTION','RUNTIME','TOURNAMENT'].map(x=>readinessReceipt(p,x));
  rows.forEach(row=>verifyRsiVerifierRootActivationReadinessReceipt(row,{prepare:p}));
  const review=createRsiVerifierRootActivationPrepareReview({
    review_id:'activation.prepare.review.1',prepare:p,readiness_receipts:rows,
    external_review_owner:true,authored_by_candidate:false,
  });
  verifyRsiVerifierRootActivationPrepareReview(review,{prepare:p,readiness_receipts:rows});
  assert.equal(review.state,'PREPARED_FOR_EXTERNAL_ROOT_ACTIVATION_COMMIT_REVIEW');
  assert.equal(review.all_readiness_domains_pass,true);
  assert.equal(review.active_verifier_root_digest,p.predecessor_verifier_root_digest);
  assert.equal(review.candidate_role,'LEARNER_NON_AUTHORITATIVE');
  assert.equal(review.root_activation_commit_authorized,false);
  assert.equal(review.verifier_activation_authorized,false);
  assert.equal(review.activation_commit_token,null);
  assert.equal(review.authority_effect,false);
});

test('candidate not caught up fails prepare review while predecessor remains active',()=>{
  const {prepare:p}=prepare();
  const rows=[
    readinessReceipt(p,'PROMOTION'),
    readinessReceipt(p,'RUNTIME',{candidate_catchup_pass:false}),
    readinessReceipt(p,'TOURNAMENT'),
  ];
  assert.equal(rows[1].overall_pass,false);
  const review=createRsiVerifierRootActivationPrepareReview({
    review_id:'activation.prepare.review.catchup-fail',prepare:p,readiness_receipts:rows,
    external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(review.state,'REJECTED_ROOT_ACTIVATION_PREPARE');
  assert.equal(review.prepared_for_external_root_activation_commit_review,false);
  assert.equal(review.active_verifier_root_digest,p.predecessor_verifier_root_digest);
  assert.equal(review.root_activation_commit_authorized,false);
});

test('early active-root change fails readiness identity even when other checks pass',()=>{
  const {prepare:p}=prepare();
  const row=readinessReceipt(p,'RUNTIME',{observed_active_verifier_root_digest:p.candidate_verifier_root_digest});
  assert.equal(row.active_root_identity_pass,false);
  assert.equal(row.overall_pass,false);
});

test('missing readiness domain cannot be replaced by duplicate',()=>{
  const {prepare:p}=prepare();
  const rows=[
    readinessReceipt(p,'PROMOTION'),
    readinessReceipt(p,'RUNTIME'),
    readinessReceipt(p,'RUNTIME',{receipt_id:'activation.prepare.readiness.runtime.2',readiness_evidence_digest:d('0'),evidence_refs:['activation:prepare:runtime:2']}),
  ];
  assert.throws(()=>createRsiVerifierRootActivationPrepareReview({
    review_id:'activation.prepare.review.missing',prepare:p,readiness_receipts:rows,
    external_review_owner:true,authored_by_candidate:false,
  }),/readiness_coverage_invalid/);
});

test('candidate cannot self-report readiness',()=>{
  const {prepare:p}=prepare();
  assert.throws(()=>createRsiVerifierRootActivationReadinessReceipt({
    receipt_id:'activation.prepare.readiness.self',prepare:p,readiness_domain:'RUNTIME',
    readiness_root_digest:p.readiness_roots.RUNTIME,predecessor_liveness_pass:true,candidate_catchup_pass:true,
    joint_validation_pass:true,rollback_path_pass:true,root_history_freshness_pass:true,incident_free:true,no_pending_effect:true,
    observed_active_verifier_root_digest:p.predecessor_verifier_root_digest,observed_staging_bundle_digest:p.staging_bundle_digest,
    readiness_evidence_digest:d('0'),evidence_refs:['activation:prepare:self'],
    external_readiness_auditor:false,authored_by_candidate:true,
  }),/external_readiness_auditor_required/);
});

test('activation prepare trust root encodes learner and joint-consensus safety',()=>{
  const root=rsiVerifierRootActivationPrepareTrustRootSnapshot();
  assert.equal(root.phase24_staging_review_required,true);
  assert.equal(root.mode,'JOINT_TRUST_PREPARE');
  assert.equal(root.candidate_role,'LEARNER_NON_AUTHORITATIVE');
  assert.deepEqual(root.required_readiness_domains,['PROMOTION','RUNTIME','TOURNAMENT']);
  assert.equal(root.all_readiness_domains_required,true);
  assert.equal(root.predecessor_must_remain_active,true);
  assert.equal(root.joint_old_new_validation_required,true);
  assert.equal(root.candidate_catchup_required,true);
  assert.equal(root.rollback_path_required,true);
  assert.equal(root.candidate_can_vote,false);
  assert.equal(root.candidate_can_self_promote,false);
  assert.equal(root.root_activation_commit_authorized,false);
  assert.equal(root.verifier_activation_authorized,false);
  assert.equal(root.existing_runtime_ledger_is_only_prepare_review_receipt_plane,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.root_activation_prepare_root_digest,/^sha256:[0-9a-f]{64}$/);
});
