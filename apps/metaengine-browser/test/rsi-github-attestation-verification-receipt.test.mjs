import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiGithubAttestationVerificationReceipt,
  verifyRsiGithubAttestationVerificationReceipt,
  rsiGithubAttestationVerificationReceiptTrustRootSnapshot,
  RSI_GITHUB_ATTESTATION_EXPECTED_REPOSITORY,
  RSI_GITHUB_ATTESTATION_EXPECTED_ISSUER,
} from '../src/rsi-github-attestation-verification-receipt.mjs';

const SHA='a'.repeat(40);
function digest(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}
function args(overrides={}){
  return {
    verification_id:'rsi.github.attestation.verification.1',
    subject_digest:digest('subject'),
    provenance_bundle_digest:digest('bundle'),
    structural_attestation_digest:digest('structural'),
    repository:RSI_GITHUB_ATTESTATION_EXPECTED_REPOSITORY,
    signer_workflow:'.github/workflows/rsi-lineage-provenance-attestation.yml',
    signer_digest:SHA,
    source_ref:'refs/heads/main',
    source_digest:SHA,
    cert_oidc_issuer:RSI_GITHUB_ATTESTATION_EXPECTED_ISSUER,
    predicate_type:'https://github.com/PatrickFrome/Compute/attestations/rsi-lineage-provenance/v1',
    trusted_root_digest:digest('fresh-trusted-root'),
    verification_json_digest:digest('gh-verification-json'),
    verification_result_count:1,
    gh_attestation_verify_executed:true,
    signature_verified:true,
    signer_identity_verified:true,
    subject_digest_verified:true,
    trusted_root_verified:true,
    deny_self_hosted_runners:true,
    external_attestation_verifier:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('R9 accepts only an exact existing-plane GitHub attestation verification receipt',()=>{
  const receipt=createRsiGithubAttestationVerificationReceipt(args());
  assert.equal(receipt.repository,'PatrickFrome/Compute');
  assert.equal(receipt.verification_result_count,1);
  assert.equal(receipt.signature_verified,true);
  assert.equal(receipt.signer_identity_verified,true);
  assert.equal(receipt.trusted_root_verified,true);
  assert.equal(receipt.deny_self_hosted_runners,true);
  assert.equal(receipt.provenance_does_not_imply_safety,true);
  assert.equal(receipt.verification_receipt_is_effect_authority,false);
  assert.equal(receipt.this_module_does_not_verify_signature_bytes,true);
  assert.equal(receipt.authority_effect,false);
  assert.equal(verifyRsiGithubAttestationVerificationReceipt(receipt).receipt_digest,receipt.receipt_digest);
});

test('R9 verification receipt fails closed on source signer issuer and repository drift',()=>{
  assert.throws(()=>createRsiGithubAttestationVerificationReceipt(args({
    repository:'example/other',
  })),/repository_mismatch/);
  assert.throws(()=>createRsiGithubAttestationVerificationReceipt(args({
    cert_oidc_issuer:'https://issuer.example',
  })),/oidc_issuer_mismatch/);
  assert.throws(()=>createRsiGithubAttestationVerificationReceipt(args({
    source_digest:'b'.repeat(40),
  })),/signer_source_digest_mismatch/);
  assert.throws(()=>createRsiGithubAttestationVerificationReceipt(args({
    signer_workflow:'scripts/sign.sh',
  })),/signer_workflow_invalid/);
});

test('R9 requires actual external verification claims including signer identity trusted root and subject',()=>{
  for(const field of [
    'gh_attestation_verify_executed',
    'signature_verified',
    'signer_identity_verified',
    'subject_digest_verified',
    'trusted_root_verified',
    'deny_self_hosted_runners',
  ]){
    assert.throws(
      ()=>createRsiGithubAttestationVerificationReceipt(args({[field]:false})),
      /external_verification_incomplete/,
    );
  }
  assert.throws(
    ()=>createRsiGithubAttestationVerificationReceipt(args({verification_result_count:2})),
    /verification_result_count_invalid/,
  );
});

test('R9 candidate cannot author or turn provenance receipt into semantic or effect authority',()=>{
  assert.throws(
    ()=>createRsiGithubAttestationVerificationReceipt(args({
      external_attestation_verifier:false,
      authored_by_candidate:true,
    })),
    /external_verifier_required/,
  );

  const receipt=createRsiGithubAttestationVerificationReceipt(args());
  assert.throws(
    ()=>verifyRsiGithubAttestationVerificationReceipt({
      ...receipt,
      verification_receipt_is_semantic_acceptance:true,
    }),
    /receipt_policy_invalid/,
  );
  assert.throws(
    ()=>verifyRsiGithubAttestationVerificationReceipt({
      ...receipt,
      authority_effect:true,
    }),
    /authority_effect_must_be_false/,
  );
});

test('R9 attestation receipt trust root reuses GitHub plane and forbids a second signer',()=>{
  const root=rsiGithubAttestationVerificationReceiptTrustRootSnapshot();
  assert.equal(root.existing_github_attestation_plane_reused,true);
  assert.equal(root.second_signing_authority_created,false);
  assert.equal(root.exact_signer_workflow_required,true);
  assert.equal(root.exact_signer_digest_required,true);
  assert.equal(root.fresh_trusted_root_digest_required,true);
  assert.equal(root.deny_self_hosted_runners_required,true);
  assert.equal(root.exactly_one_verification_result_required,true);
  assert.equal(root.browser_identity_signer_reused_for_arbitrary_rsi_signing,false);
  assert.equal(root.this_module_does_not_verify_signature_bytes,true);
  assert.equal(root.verification_receipt_is_effect_authority,false);
  assert.equal(root.authority_effect,false);
});
