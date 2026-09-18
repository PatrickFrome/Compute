import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createRsiExternalReleaseHandoffIntent } from '../src/rsi-external-release-handoff-intent.mjs';
import {
  createRsiPublishedReleaseReconciliation,
  verifyRsiPublishedReleaseReconciliation,
  rsiPublishedReleaseReconciliationTrustRootSnapshot,
} from '../src/rsi-published-release-reconciliation.mjs';

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function hashHex(value){
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex');
}
function digest(value){return 'sha256:'+hashHex(value)}

const CANDIDATE_ID='candidate_sha256_'+'c'.repeat(64);
const CANDIDATE_SHA='b'.repeat(40);
const PARENT_SHA='a'.repeat(40);
const NOW='2026-09-18T18:20:00.000Z';
const VERSION='0.7.0-dev.99999999999.1';
const TAG='v'+VERSION;
const INSTALLER='METAENGINE-Browser-Test-Setup-'+VERSION+'-x64.exe';
const INSTALLER_SHA='1'.repeat(64);
const INSTALLED_SHA='2'.repeat(64);
const MANIFEST_SHA='3'.repeat(64);

function review(){
  const core={
    schema:'metaengine.rsi.episode-promotion-review.v1',version:1,
    state:'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW',
    episode_id:'rsi_episode_0123456789abcdef01234567',
    candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE_SHA,parent_sha:PARENT_SHA,source_sha:PARENT_SHA,
    trust_root_set_digest:'sha256:'+'4'.repeat(64),
    evaluation_bundle_digest:'sha256:'+'5'.repeat(64),
    promotion_gate_digest:'sha256:'+'6'.repeat(64),
    risk_review_digest:'sha256:'+'7'.repeat(64),
    risk_confirmation_digest:'sha256:'+'8'.repeat(64),
    artifact_digest:'sha256:'+'9'.repeat(64),
    provenance_digest:'sha256:'+'a'.repeat(64),
    rollback:{
      predecessor_sha:PARENT_SHA,artifact_digest:'sha256:'+'b'.repeat(64),ready:true,
      ambiguous_effect_replay_allowed:false,automatic_replay_authorized:false,
    },
    all_episode_evidence_pass:true,ordinary_promotion_gate_pass:true,statistical_confirmation_pass:true,rollback_ready:true,
    external_release_handoff_review_required:true,release_handoff_authorized:false,direct_install_authorized:false,
    direct_promotion_authorized:false,existing_self_update_handoff_authorized:false,promotion_token:null,
    physical_effect_replay_allowed:false,execution_authority:false,browser_authority:false,scheduler_authority:false,
    task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,review_digest:digest(core)};
}
function attestation(){
  const core={
    schema:'metaengine.rsi.promotion-review-attestation-verification.v1',
    classification:'CRYPTOGRAPHICALLY_VERIFIED_RSI_PROMOTION_REVIEW_NONAUTHORITATIVE',
    source:{repository_id:1341371143,repository:'PatrickFrome/Compute',workflow_path:'.github/workflows/rsi-promotion-attestation.yml',head_sha:'d'.repeat(40),run_id:12345},
    predicate_type:'https://github.com/PatrickFrome/Compute/attestations/rsi-promotion-review/v1',
    predicate_sha256:'c'.repeat(64),attested_file_sha256:'d'.repeat(64),attested_file_bytes:2048,
    promotion_subject_sha256:'e'.repeat(64),candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE_SHA,parent_sha:PARENT_SHA,
    artifact_sha256:'9'.repeat(64),promotion_gate_sha256:'6'.repeat(64),verified_timestamp_count:1,
    source_attestation_verified:true,promotion_authority:false,self_update_authority:false,direct_install_authorized:false,
    authority_effect:false,required_next:'EXTERNAL_PROMOTION_AUTHORITY_MUST_CONSUME_THIS_RECEIPT_AND_REVALIDATE_LIVE_RELEASE_STATE',
  };
  return {...core,verification_receipt_sha256:hashHex(core)};
}
function intent(){
  return createRsiExternalReleaseHandoffIntent({
    episode_promotion_review:review(),
    promotion_attestation_verification:attestation(),
  });
}
function trustedRelease(overrides={}){
  return {
    schema:'metaengine.trusted-dev-release.v1',
    version:VERSION,tag:TAG,git_sha:CANDIDATE_SHA,
    feed_url:'https://github.com/PatrickFrome/Compute/releases/download/'+TAG+'/',
    installer_name:INSTALLER,installer_sha256:INSTALLER_SHA,installer_sha512:'A'.repeat(86)+'==',
    manifest_sha256:MANIFEST_SHA,dev_yml_sha256:'4'.repeat(64),
    installed_executable_sha256:INSTALLED_SHA,target_present_proof_supported:true,
    authority_effect:false,...overrides,
  };
}
function immutable(overrides={}){
  return {
    schema:'metaengine.browser-fabric.immutable-release-evidence.v1',
    verifier_id:'release-lock-verifier-v1',verified_at:NOW,enabled:true,tag_locked:true,assets_locked:true,
    attestation_verified:true,release_tag:TAG,commit_sha:CANDIDATE_SHA,manifest_sha256:MANIFEST_SHA,
    installer_sha256:INSTALLER_SHA,installed_executable_sha256:INSTALLED_SHA,authority_effect:false,...overrides,
  };
}
function provenance(overrides={}){
  return {
    schema:'metaengine.browser-fabric.provenance-evidence.v1',
    verifier_id:'slsa-verifier-v1',verified_at:NOW,verified:true,builder_trusted:true,builder_id:'github-actions',
    source_sha:CANDIDATE_SHA,subject_name:INSTALLER,subject_sha256:INSTALLER_SHA,
    predicate_type:'https://slsa.dev/provenance/v1',authority_effect:false,...overrides,
  };
}
function ancestry(overrides={}){
  return {
    schema:'metaengine.browser-fabric.source-ancestry-evidence.v1',
    verifier_id:'git-ancestry-verifier-v1',verified_at:NOW,base_sha:PARENT_SHA,candidate_sha:CANDIDATE_SHA,
    fast_forward_verified:true,authority_effect:false,...overrides,
  };
}
function reconcile(overrides={}){
  return createRsiPublishedReleaseReconciliation({
    release_handoff_intent:intent(),
    current_authority_sha:PARENT_SHA,
    trusted_release:trustedRelease(),
    immutable_release_evidence:immutable(),
    provenance_evidence:provenance(),
    source_ancestry_evidence:ancestry(),
    now:new Date(NOW),
    ...overrides,
  });
}

test('immutable published release becomes only an authority-advance candidate',()=>{
  const row=reconcile();
  verifyRsiPublishedReleaseReconciliation(row);
  assert.equal(row.state,'READY_FOR_EXTERNAL_AUTHORITY_ADVANCE_REVIEW');
  assert.equal(row.candidate_sha,CANDIDATE_SHA);
  assert.equal(row.previous_authority_sha,PARENT_SHA);
  assert.equal(row.release_source_sha_exact,true);
  assert.equal(row.immutable_release_attestation_verified,true);
  assert.equal(row.slsa_provenance_verified,true);
  assert.equal(row.source_fast_forward_verified,true);
  assert.equal(row.installed_executable_binding_verified,true);
  assert.equal(row.authority_advance_candidate,true);
  assert.equal(row.authority_advance_authorized,false);
  assert.equal(row.separate_journaled_promotion_effect_required,true);
  assert.equal(row.release_authority,false);
  assert.equal(row.self_update_handoff_authorized,false);
  assert.equal(row.direct_install_authorized,false);
});

test('published release source, executable binding, provenance and ancestry drift all fail closed',()=>{
  const cases=[
    {trusted_release:trustedRelease({git_sha:'f'.repeat(40)})},
    {immutable_release_evidence:immutable({installed_executable_sha256:'f'.repeat(64)})},
    {provenance_evidence:provenance({subject_sha256:'f'.repeat(64)})},
    {source_ancestry_evidence:ancestry({base_sha:'f'.repeat(40)})},
  ];
  for(const extra of cases){
    assert.throws(()=>reconcile(extra),/rsi_release_reconcile_gate_blocked/);
  }
});

test('already-advanced authority must use the separate readback path instead of fabricating a fresh promotion effect',()=>{
  assert.throws(
    ()=>reconcile({current_authority_sha:CANDIDATE_SHA,source_ancestry_evidence:ancestry({base_sha:CANDIDATE_SHA})}),
    /authority_already_exact_requires_readback_path/,
  );
});

test('reconciliation receipt cannot be widened into release or install authority',()=>{
  const row=structuredClone(reconcile());
  row.release_authority=true;
  assert.throws(()=>verifyRsiPublishedReleaseReconciliation(row),/release_authority_invalid/);

  const install=structuredClone(reconcile());
  install.direct_install_authorized=true;
  assert.throws(()=>verifyRsiPublishedReleaseReconciliation(install),/policy_invalid/);

  const replay=structuredClone(reconcile());
  replay.physical_effect_replay_allowed=true;
  assert.throws(()=>verifyRsiPublishedReleaseReconciliation(replay),/policy_invalid/);
});

test('published-release reconciliation trust root explicitly reuses the existing release gate',()=>{
  const root=rsiPublishedReleaseReconciliationTrustRootSnapshot();
  assert.equal(root.candidate_identity_frozen,true);
  assert.equal(root.trusted_release_required,true);
  assert.equal(root.immutable_release_attestation_required,true);
  assert.equal(root.slsa_provenance_required,true);
  assert.equal(root.independent_fast_forward_proof_required,true);
  assert.equal(root.installed_executable_binding_required,true);
  assert.equal(root.authority_advance_is_candidate_only,true);
  assert.equal(root.separate_journaled_promotion_effect_required,true);
  assert.equal(root.direct_authority_mutation_allowed,false);
  assert.equal(root.release_authority,false);
  assert.equal(root.self_update_authority,false);
});
