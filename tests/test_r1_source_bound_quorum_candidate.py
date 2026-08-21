import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).parents[1]
PATH=ROOT/'controller'/'r1'/'source_bound_quorum_candidate.py'
spec=importlib.util.spec_from_file_location('r1_source_bound_quorum',PATH)
mod=importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def canon(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def seal(v,field):
    core=dict(v); core.pop(field,None); v[field]=hashlib.sha256(canon(core)).hexdigest(); return v


def base():
    v={
        'schema':mod.BASE_SCHEMA,
        'classification':'TWO_DOMAIN_PROVIDER_READBACK_CANDIDATE_NONAUTHORITATIVE',
        'source':{'run_id':9001,'head_sha':'1'*40,'workflow_path':'.github/workflows/r1-live-recovery-source.yml'},
        'ciphertext':{'sha256':'2'*64,'bytes':1234},
        'provider_results':{'aws_result_sha256':'3'*64,'b2_result_sha256':'4'*64},
        'quorum':{'candidate_ready':True,'distinct_domains':2,'distinct_operator_classes':2,'distinct_provider_kinds':2,'strong_immutability_domains':2},
        'source_attestation_verified':False,
        'source_attestation_required_before_authority':True,
        'canonical':False,'authority_effect':False,'r2_proven':False,'r3_proven':False,'persisted_seal_allowed':False,
        'required_next':'VERIFY_DSSE_IN_TOTO_SIGSTORE_SOURCE_ATTESTATION_THEN_SUPERVISOR_INGEST_PROVIDER_EVIDENCE_AND_REEVALUATE_R2',
    }
    return seal(v,'orchestration_result_sha256')


def handoff():
    v={
        'schema':mod.HANDOFF_SCHEMA,
        'classification':'VERIFIED_SOURCE_HANDOFF_PROVIDER_ELIGIBILITY_NONAUTHORITATIVE',
        'source':{
            'run_id':9001,'head_sha':'1'*40,'workflow_path':'.github/workflows/r1-live-recovery-source.yml',
            'preflight_sha256':'5'*64,'ciphertext_sha256':'2'*64,'ciphertext_bytes':1234,
            'envelope_receipt_sha256':'6'*64,
            'source_verification_artifact':{'id':3003,'name':'r1-recovery-source-verification.json','size_in_bytes':900,'digest_sha256':'7'*64},
            'source_verification_receipt_sha256':'8'*64,'predicate_sha256':'9'*64,
            'semantic_head_at_source':'metaengine-h205f22-recovery-dev-20260821-cp072',
            'canonical_digest_at_source':'a'*64,'migration_ledger_sha256':'b'*64,
            'source_environment_readiness_artifact_id':4004,
            'source_environment_readiness_sha256':'c'*64,
            'source_environment_approval_artifact_id':4005,
            'source_environment_approval_sha256':'d'*64,
            'source_environment_approved_review_count':1,
        },
        'source_attestation_verified':True,
        'source_environment_binding_verified':True,
        'source_environment_approval_verified':True,
        'provider_credentials_eligible_after_environment_and_readiness_gates':True,
        'provider_execution_authorized':False,
        'final_r2_evidence_binding_required':True,
        'canonical':False,'authority_effect':False,'r2_proven':False,'r3_proven':False,'persisted_seal_allowed':False,
    }
    return seal(v,'handoff_sha256')


class SourceBoundQuorumTests(unittest.TestCase):
    def test_valid_binding_keeps_r2_false_and_propagates_environment_evidence(self):
        out=mod.bind_candidate(base(),handoff())
        self.assertTrue(out['source_attestation_verified'])
        self.assertTrue(out['source_environment_binding_verified'])
        self.assertTrue(out['source_environment_approval_verified'])
        self.assertTrue(out['final_r2_evidence_binding_required'])
        self.assertFalse(out['r2_proven'])
        self.assertFalse(out['persisted_seal_allowed'])
        self.assertEqual(out['source_provenance']['source_verification_receipt_sha256'],'8'*64)
        self.assertEqual(out['source_provenance']['source_environment_readiness_sha256'],'c'*64)
        self.assertEqual(out['source_provenance']['source_environment_approval_sha256'],'d'*64)
        self.assertEqual(out['source_provenance']['source_environment_approved_review_count'],1)

    def test_source_run_or_ciphertext_mismatch_rejected(self):
        h=handoff(); h['source']['run_id']=9002; seal(h,'handoff_sha256')
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'source_identity_mismatch:run_id'):
            mod.bind_candidate(base(),h)
        h=handoff(); h['source']['ciphertext_sha256']='f'*64; seal(h,'handoff_sha256')
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'ciphertext_identity_mismatch'):
            mod.bind_candidate(base(),h)

    def test_missing_environment_approval_rejected(self):
        h=handoff(); h['source_environment_approval_verified']=False; seal(h,'handoff_sha256')
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'source_environment_evidence_not_verified'):
            mod.bind_candidate(base(),h)
        h=handoff(); h['source']['source_environment_approved_review_count']=0; seal(h,'handoff_sha256')
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'approved_review_count'):
            mod.bind_candidate(base(),h)

    def test_handoff_authority_escalation_rejected_even_after_rehash(self):
        h=handoff(); h['r2_proven']=True; seal(h,'handoff_sha256')
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'handoff_authority_boundary_invalid'):
            mod.bind_candidate(base(),h)

    def test_base_or_handoff_self_hash_tamper_rejected(self):
        b=base(); b['ciphertext']['bytes']=999
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'base_orchestration_result_sha256_mismatch'):
            mod.bind_candidate(b,handoff())
        h=handoff(); h['source']['semantic_head_at_source']='forged'
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'handoff_handoff_sha256_mismatch'):
            mod.bind_candidate(base(),h)

    def test_unready_quorum_or_unverified_source_rejected(self):
        b=base(); b['quorum']['candidate_ready']=False; seal(b,'orchestration_result_sha256')
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'base_quorum_not_ready'):
            mod.bind_candidate(b,handoff())
        h=handoff(); h['source_attestation_verified']=False; seal(h,'handoff_sha256')
        with self.assertRaisesRegex(mod.SourceBoundQuorumError,'handoff_source_attestation_not_verified'):
            mod.bind_candidate(base(),h)


if __name__=='__main__': unittest.main()