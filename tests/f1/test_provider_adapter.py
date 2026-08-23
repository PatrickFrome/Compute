from __future__ import annotations
import os,unittest,uuid
from unittest.mock import patch
import federation.f1.provider_adapter as pa
VID="11111111-2222-4333-8444-555555555555"; NOW=1787492400.0; H,B,C,D,E,F="a"*64,"b"*64,"c"*64,"d"*64,"e"*64,"f"*64

def projection(**overrides):
    v={"schema":pa.READBACK_SCHEMA,"source_kind":pa.READBACK_SOURCE,"readback_state":"CURRENT","evaluated_at":"2026-08-23T13:40:00+00:00","receipt_digest_valid":True,"receipt_recomputed_sha256":H,"canonical":False,"authority_effect":False,"provider_binding":{"provider_id":"github-actions-f1-live","provider_kind":"GITHUB_HOSTED_ACTIONS","lifecycle_state":"READY_FOR_PILOT","scheduler_eligible":False,"authority_effect":False},"verifier_binding":{"verifier_id":"github-actions-f1-sigstore-v1","verifier_kind":"SIGSTORE_BUNDLE","lifecycle_state":"READY_FOR_PILOT","enabled":True,"authority_effect":False,"crypto_channel":"gh-attestation+sigstore","trust_generation":1},"verification":{"verification_id":VID,"verifier_id":"github-actions-f1-sigstore-v1","provider_id":"github-actions-f1-live","external_execution_id":"github-actions:32640000000:1","signed_claims_sha256":B,"envelope_sha256":C,"payload_type":"application/vnd.in-toto+json","key_id":None,"signer_identity":{"issuer":"https://token.actions.githubusercontent.com","workflow":"PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml"},"verification_status":"VERIFIED","verified_at":"2026-08-23T13:39:00+00:00","expires_at":"2026-08-23T13:55:00+00:00","evidence":{"provider_kind":"GITHUB_HOSTED_ACTIONS","crypto_channel":"gh-attestation+sigstore","trust_generation":1,"repository":"PatrickFrome/Compute","signer_workflow":"PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml","oidc_issuer":"https://token.actions.githubusercontent.com","sigstore_instance":"public-good","run_id":32640000000,"run_attempt":1,"external_receipt_sha256":D,"cryptographic_verification_sha256":E,"sigstore_bundle_sha256":F,"tuf_chain_verification_sha256":D,"verifier_source_blob_sha256":E,"verifier_workflow_blob_sha256":F,"tuf_chain_status":"FULL_TUF_CHAIN_CRYPTO_VERIFIED","verifier_implementation":"gh version 2.97.0 (2026-07-31)"},"receipt_sha256":H,"canonical":False,"authority_effect":False}}
    for path,val in overrides.items():
        cur=v; parts=path.split('.')
        for p in parts[:-1]: cur=cur[p]
        cur[parts[-1]]=val
    return v

class CandidateContractTests(unittest.TestCase):
    def setUp(self): pa.clear_registry_for_tests()
    def test_github_is_candidate_not_preverified(self): self.assertNotIn("github-actions-f1-live",pa.registered()); self.assertFalse(hasattr(pa.GITHUB_ACTIONS_F1,"verification_proof"))
    def test_appveyor_is_candidate(self): self.assertNotIn("appveyor-f1-live",pa.registered())
    def test_direct_registration_is_always_forbidden(self):
        with self.assertRaisesRegex(pa.AdapterRegistrationError,"direct provider registration is forbidden"): pa.register(pa.GITHUB_ACTIONS_F1)
    def test_no_legacy_register_from_readback_surface(self): self.assertFalse(hasattr(pa,"register_from_readback"))
    def test_get_requires_current_persisted_registration(self):
        with self.assertRaises(pa.AdapterRegistrationError): pa.get("github-actions-f1-live")
    def test_github_coordinate_schema_is_exact(self):
        with self.assertRaises(pa.AdapterRegistrationError): pa.ProviderAdapter("github-actions-f1-live","GITHUB_HOSTED_ACTIONS","https://token.actions.githubusercontent.com","public-good",1,"gh-attestation+sigstore",600,"github-actions:{run_id}:{build_id}","PatrickFrome/Compute","PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml")

class PersistedProjectionTests(unittest.TestCase):
    def setUp(self): pa.clear_registry_for_tests()
    def validate(self,obj=None): return pa._validate_projection(pa.GITHUB_ACTIONS_F1,projection() if obj is None else obj,verification_id=VID,evaluated_at_epoch=NOW)
    def test_valid_projection_validates_without_registering(self): self.assertEqual(self.validate().verification_id,VID); self.assertEqual(pa.registered(),[])
    def test_wrong_source_kind_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(source_kind="CALLER_DICT"))
    def test_historical_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(readback_state="HISTORICAL"))
    def test_db_digest_failure_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(receipt_digest_valid=False))
    def test_receipt_object_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.receipt_sha256":B}))
    def test_verification_id_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.verification_id":str(uuid.uuid4())}))
    def test_provider_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.provider_id":"other"}))
    def test_provider_kind_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"provider_binding.provider_kind":"OTHER"}))
    def test_scheduler_authority_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"provider_binding.scheduler_eligible":True}))
    def test_wrong_verifier_kind_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verifier_binding.verifier_kind":"EXTERNAL_DSSE"}))
    def test_disabled_verifier_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verifier_binding.enabled":False}))
    def test_crypto_channel_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verifier_binding.crypto_channel":"manual-cosign+sigstore"}))
    def test_trust_generation_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verifier_binding.trust_generation":2}))
    def test_nonverified_status_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.verification_status":"REVOKED"}))
    def test_bad_payload_type_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.payload_type":"text/plain"}))
    def test_execution_family_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.external_execution_id":"appveyor:1:1"}))
    def test_evidence_coordinate_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.evidence.run_attempt":2}))
    def test_evidence_signer_workflow_mismatch_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.evidence.signer_workflow":"evil/repo/.github/workflows/x.yml"}))
    def test_missing_bundle_digest_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.evidence.sigstore_bundle_sha256":None}))
    def test_expired_receipt_rejected_even_if_db_labels_current(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.expires_at":"2026-08-23T13:39:30+00:00"}))
    def test_lifetime_abuse_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): self.validate(projection(**{"verification.expires_at":"2026-08-23T15:30:00+00:00"}))

class ProductionReadbackTests(unittest.TestCase):
    def setUp(self): pa.clear_registry_for_tests()
    def test_invalid_uuid_rejected_before_network(self):
        with self.assertRaises(pa.AdapterRegistrationError): pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,"not-a-uuid",evaluated_at_epoch=NOW)
    def test_missing_service_role_key_fails_closed(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaisesRegex(pa.AdapterRegistrationError,"SUPABASE_SERVICE_ROLE_KEY"): pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,VID,evaluated_at_epoch=NOW)
    def test_production_api_fetches_by_uuid_then_registers(self):
        with patch.object(pa,"_readback_rpc",return_value=projection()) as read: entry=pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,VID,evaluated_at_epoch=NOW)
        read.assert_called_once(); self.assertEqual(entry.receipt_sha256,H); self.assertIn("github-actions-f1-live",pa.registered())
    def test_production_api_does_not_accept_row_argument(self):
        with self.assertRaises(TypeError): pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,VID,projection(),evaluated_at_epoch=NOW)

class ExpectedContextTests(unittest.TestCase):
    def setUp(self): pa.clear_registry_for_tests(); pa._REGISTRY[pa.GITHUB_ACTIONS_F1.provider_id]=pa._validate_projection(pa.GITHUB_ACTIONS_F1,projection(),verification_id=VID,evaluated_at_epoch=NOW)
    def test_native_github_coordinates(self):
        ctx=pa.expected_context("github-actions-f1-live",repository="PatrickFrome/Compute",source_digest="1"*64,source_ref="refs/pull/8/merge",coords={"run_id":12,"run_attempt":2},signer_workflow="PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml",now_epoch=NOW); self.assertEqual(ctx["external_execution_id"],"github-actions:12:2"); self.assertFalse(ctx["authority_effect"])
    def test_cross_provider_coords_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): pa.expected_context("github-actions-f1-live",repository="PatrickFrome/Compute",source_digest="1"*64,source_ref="ref",coords={"build_id":12,"build_number":2},signer_workflow="PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml",now_epoch=NOW)
    def test_repository_alias_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): pa.expected_context("github-actions-f1-live",repository="other/repo",source_digest="1"*64,source_ref="ref",coords={"run_id":12,"run_attempt":2},signer_workflow="PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml",now_epoch=NOW)
    def test_signer_alias_rejected(self):
        with self.assertRaises(pa.AdapterRegistrationError): pa.expected_context("github-actions-f1-live",repository="PatrickFrome/Compute",source_digest="1"*64,source_ref="ref",coords={"run_id":12,"run_attempt":2},signer_workflow="PatrickFrome/Compute/.github/workflows/evil.yml",now_epoch=NOW)

class WorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pathlib import Path
        cls.text=(Path(__file__).resolve().parents[2]/".github"/"workflows"/"f1-live-provider-pr.yml").read_text()
    def test_attestation_verification_remains_cryptographic(self): self.assertIn("gh attestation verify federation/f1/provider-evidence.json",self.text); self.assertIn("--deny-self-hosted-runners",self.text)
    def test_verified_bundle_dsse_material_is_hashed(self):
        for s in ("dsseEnvelope","base64.b64decode","'signed_claims_sha256'","'envelope_sha256'","'sigstore_bundle_sha256'"): self.assertIn(s,self.text)
    def test_verifier_and_workflow_bytes_are_pinned_in_receipt(self): self.assertIn("'verifier_source_blob_sha256'",self.text); self.assertIn("'verifier_workflow_blob_sha256'",self.text)
    def test_attestation_action_is_immutable_pin(self): self.assertIn("actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373",self.text)

if __name__=="__main__": unittest.main(verbosity=2)
