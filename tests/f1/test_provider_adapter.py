from __future__ import annotations
import datetime as dt,os,unittest,uuid
from unittest.mock import patch
import federation.f1.provider_adapter as pa
VID="11111111-2222-4333-8444-555555555555"; NOW=1787492400.0; H,B,C,D,E,F="a"*64,"b"*64,"c"*64,"d"*64,"e"*64,"f"*64
def projection(**o):
 v={"schema":pa.READBACK_SCHEMA,"source_kind":pa.READBACK_SOURCE,"readback_state":"CURRENT","receipt_digest_valid":True,"receipt_recomputed_sha256":H,"canonical":False,"authority_effect":False,"provider_binding":{"provider_id":"github-actions-f1-live","provider_kind":"GITHUB_HOSTED_ACTIONS","lifecycle_state":"READY_FOR_PILOT","scheduler_eligible":False,"authority_effect":False},"verifier_binding":{"verifier_id":"github-actions-f1-sigstore-v1","verifier_kind":"SIGSTORE_BUNDLE","lifecycle_state":"READY_FOR_PILOT","enabled":True,"authority_effect":False,"crypto_channel":"gh-attestation+sigstore","trust_generation":1},"verification":{"verification_id":VID,"verifier_id":"github-actions-f1-sigstore-v1","provider_id":"github-actions-f1-live","external_execution_id":"github-actions:32640000000:1","signed_claims_sha256":B,"envelope_sha256":C,"payload_type":"application/vnd.in-toto+json","signer_identity":{"issuer":"https://token.actions.githubusercontent.com","workflow":"PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml"},"verification_status":"VERIFIED","verified_at":"2026-08-23T13:39:00+00:00","expires_at":"2026-08-23T13:55:00+00:00","evidence":{"provider_kind":"GITHUB_HOSTED_ACTIONS","crypto_channel":"gh-attestation+sigstore","trust_generation":1,"repository":"PatrickFrome/Compute","signer_workflow":"PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml","oidc_issuer":"https://token.actions.githubusercontent.com","sigstore_instance":"public-good","run_id":32640000000,"run_attempt":1,"external_receipt_sha256":D,"cryptographic_verification_sha256":E,"sigstore_bundle_sha256":F,"tuf_chain_verification_sha256":D,"verifier_source_blob_sha256":E,"verifier_workflow_blob_sha256":F,"tuf_chain_status":"FULL_TUF_CHAIN_CRYPTO_VERIFIED","verifier_implementation":"gh version 2.97.0"},"receipt_sha256":H,"canonical":False,"authority_effect":False}}
 for path,val in o.items():
  cur=v; parts=path.split('.')
  for p in parts[:-1]: cur=cur[p]
  cur[parts[-1]]=val
 return v
class CandidateTests(unittest.TestCase):
 def setUp(self): pa.clear_registry_for_tests()
 def test_static_candidate_has_no_proof(self): self.assertFalse(hasattr(pa.GITHUB_ACTIONS_F1,"verification_proof")); self.assertEqual(pa.registered(),[])
 def test_direct_register_forbidden(self):
  with self.assertRaises(pa.AdapterRegistrationError): pa.register(pa.GITHUB_ACTIONS_F1)
 def test_legacy_row_api_absent(self): self.assertFalse(hasattr(pa,"register_from_readback"))
class ProjectionTests(unittest.TestCase):
 def val(self,x=None): return pa._validate_projection(pa.GITHUB_ACTIONS_F1,projection() if x is None else x,verification_id=VID,evaluated_at_epoch=NOW)
 def test_valid_does_not_register(self): self.assertEqual(self.val().verification_id,VID); self.assertEqual(pa.registered(),[])
 def test_wrong_source(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(source_kind="CALLER_DICT"))
 def test_historical(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(readback_state="HISTORICAL"))
 def test_digest_failure(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(receipt_digest_valid=False))
 def test_receipt_mismatch(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.receipt_sha256":B}))
 def test_uuid_mismatch(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.verification_id":str(uuid.uuid4())}))
 def test_provider_mismatch(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.provider_id":"other"}))
 def test_kind_mismatch(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"provider_binding.provider_kind":"OTHER"}))
 def test_scheduler_escalation(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"provider_binding.scheduler_eligible":True}))
 def test_wrong_verifier(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verifier_binding.verifier_kind":"EXTERNAL_DSSE"}))
 def test_disabled_verifier(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verifier_binding.enabled":False}))
 def test_channel_mismatch(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verifier_binding.crypto_channel":"manual-cosign+sigstore"}))
 def test_trust_generation(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verifier_binding.trust_generation":2}))
 def test_nonverified(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.verification_status":"REVOKED"}))
 def test_payload_downgrade(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.payload_type":"text/plain"}))
 def test_exec_confusion(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.external_execution_id":"appveyor:1:1"}))
 def test_evidence_coords(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.evidence.run_attempt":2}))
 def test_signer_alias(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.evidence.signer_workflow":"evil/x"}))
 def test_missing_bundle_hash(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.evidence.sigstore_bundle_sha256":None}))
 def test_expired(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.expires_at":"2026-08-23T13:39:30+00:00"}))
 def test_lifetime_abuse(self):
  with self.assertRaises(pa.AdapterRegistrationError): self.val(projection(**{"verification.expires_at":"2026-08-23T15:30:00+00:00"}))
class ProductionTests(unittest.TestCase):
 def setUp(self): pa.clear_registry_for_tests()
 def test_bad_uuid(self):
  with self.assertRaises(pa.AdapterRegistrationError): pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,"bad")
 def test_missing_key(self):
  with patch.dict(os.environ,{},clear=True):
   with self.assertRaises(pa.AdapterRegistrationError): pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,VID)
 def test_fetches_uuid_and_registers(self):
  now=dt.datetime.now(tz=dt.timezone.utc); x=projection(**{"verification.verified_at":(now-dt.timedelta(minutes=1)).isoformat(),"verification.expires_at":(now+dt.timedelta(minutes=10)).isoformat()})
  with patch.object(pa,"_readback_rpc",return_value=x) as read: e=pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,VID)
  read.assert_called_once_with(VID); self.assertEqual(e.receipt_sha256,H)
 def test_row_argument_rejected(self):
  with self.assertRaises(TypeError): pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,VID,projection())
 def test_time_override_rejected(self):
  with self.assertRaises(TypeError): pa.register_from_supabase(pa.GITHUB_ACTIONS_F1,VID,evaluated_at_epoch=NOW)
class WorkflowTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  from pathlib import Path
  cls.t=(Path(__file__).resolve().parents[2]/'.github/workflows/f1-live-provider-pr.yml').read_text()
 def test_crypto_and_dsse_binding(self):
  for s in ('gh attestation verify','--deny-self-hosted-runners','dsseEnvelope','base64.b64decode',"'signed_claims_sha256'","'envelope_sha256'","'sigstore_bundle_sha256'","'verifier_source_blob_sha256'","'verifier_workflow_blob_sha256'"): self.assertIn(s,self.t)
 def test_action_pin(self): self.assertIn('actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373',self.t)
if __name__=='__main__': unittest.main(verbosity=2)
