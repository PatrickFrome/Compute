import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
HANDOFF_PATH = ROOT / "controller" / "r1" / "verified_source_handoff.py"
GUARD_PATH = ROOT / "controller" / "r1" / "live_two_domain_orchestration_guard.py"

hspec = importlib.util.spec_from_file_location("r1_verified_source_handoff", HANDOFF_PATH)
h = importlib.util.module_from_spec(hspec)
assert hspec and hspec.loader
hspec.loader.exec_module(h)

gspec = importlib.util.spec_from_file_location("r1_live_guard_for_handoff", GUARD_PATH)
g = importlib.util.module_from_spec(gspec)
assert gspec and gspec.loader
gspec.loader.exec_module(g)

RUN_ID = 9001
HEAD = "1" * 40
VERIFICATION_ARTIFACT_ID = 3003


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def self_hash(value, field):
    core = dict(value)
    core.pop(field, None)
    value[field] = hashlib.sha256(canon(core)).hexdigest()
    return value


def env(name):
    return {
        "name": name,
        "protection_rules": [
            {"type": "required_reviewers", "prevent_self_review": True, "reviewers": [{"type": "User", "reviewer": {"login": "reviewer"}}]},
            {"type": "branch_policy"},
        ],
        "deployment_branch_policy": {"protected_branches": True, "custom_branch_policies": False},
    }


def run():
    return {
        "id": RUN_ID,
        "repository": {"id": 1341371143, "full_name": "PatrickFrome/Compute"},
        "head_repository": {"id": 1341371143, "full_name": "PatrickFrome/Compute"},
        "path": ".github/workflows/r1-live-recovery-source.yml",
        "head_branch": "main",
        "head_sha": HEAD,
        "event": "workflow_dispatch",
        "status": "completed",
        "conclusion": "success",
    }


def artifact(artifact_id, name, size=100, digest="a" * 64):
    return {
        "id": artifact_id,
        "name": name,
        "size_in_bytes": size,
        "expired": False,
        "digest": f"sha256:{digest}",
        "workflow_run": {"id": RUN_ID, "repository_id": 1341371143, "head_repository_id": 1341371143, "head_branch": "main", "head_sha": HEAD},
    }


def build_fixture(root: Path):
    ciphertext = root / "r1-recovery-ciphertext.age"
    ciphertext.write_bytes(b"exact encrypted source bytes")
    cipher_sha = hashlib.sha256(ciphertext.read_bytes()).hexdigest()

    bundle = {
        "bundle_sha256": "b" * 64,
        "bundle_bytes": 321,
        "manifest_sha256": "c" * 64,
        "bundle_receipt_sha256": "d" * 64,
        "storage_api_objects_included": False,
    }
    envelope = {
        "schema": "metaengine.compute.r1-recovery-encryption-envelope.h205f22.v1",
        "classification": "ENCRYPTED_RECOVERY_ARTIFACT_CANDIDATE_NONAUTHORITATIVE",
        "source_bundle": bundle,
        "ciphertext": {"format": "age-encryption.org/v1", "sha256": cipher_sha, "bytes": len(ciphertext.read_bytes())},
        "encryption": {"tool": "age", "required_version": "1.3.1", "observed_version": "1.3.1", "profile": "PRODUCTION_PQ_TWO_RECIPIENT_MIN", "recipient_count": 2, "recipients": [], "post_quantum_required": True, "encrypt_once_required": True, "replication_contract": "COPY_EXACT_CIPHERTEXT_BYTES_DO_NOT_REENCRYPT_PER_PROVIDER"},
        "security": {"plaintext_upload_allowed": False, "plaintext_bundle_must_remain_local": True, "external_storage_ready": True, "identity_material_embedded": False},
        "provenance": {"sender_authenticity_proven": False, "source_attestation_verified": False, "source_attestation_required_before_authority": True, "self_hash_is_not_sender_authentication": True},
        "authority": {"canonical": False, "authority_effect": False, "source_attestation_verified": False, "r2_proven": False, "r3_proven": False, "persisted_seal_allowed": False},
        "required_next": "UPLOAD_IDENTICAL_CIPHERTEXT_TO_TWO_INDEPENDENT_DOMAINS_THEN_MATERIALIZE_AND_HASH_READBACK",
    }
    self_hash(envelope, "receipt_sha256")
    envelope_path = root / "envelope.json"
    envelope_path.write_text(json.dumps(envelope))

    artifacts = {
        "artifacts": [
            artifact(1001, "r1-recovery-ciphertext.age", len(ciphertext.read_bytes()), "2" * 64),
            artifact(1002, "r1-recovery-envelope-receipt.json", len(envelope_path.read_bytes()), "3" * 64),
            artifact(VERIFICATION_ARTIFACT_ID, "r1-recovery-source-verification.json", 900, "4" * 64),
        ]
    }
    preflight = g.validate_preflight(
        source_run=run(), artifacts=artifacts,
        aws_environment=env("r1-aws-durability-proof"), b2_environment=env("r1-b2-durability-proof"),
        source_run_id=RUN_ID, ciphertext_artifact_id=1001, envelope_artifact_id=1002,
    )
    verification = {
        "schema": h.SOURCE_VERIFICATION_SCHEMA,
        "classification": h.SOURCE_VERIFICATION_CLASSIFICATION,
        "source": {"repository_id": 1341371143, "repository": "PatrickFrome/Compute", "workflow_path": ".github/workflows/r1-live-recovery-source.yml", "head_sha": HEAD, "run_id": RUN_ID},
        "predicate_type": "https://github.com/PatrickFrome/Compute/attestations/r1-recovery-source/v1",
        "predicate_sha256": "5" * 64,
        "ciphertext_sha256": cipher_sha,
        "ciphertext_bytes": len(ciphertext.read_bytes()),
        "envelope_receipt_sha256": envelope["receipt_sha256"],
        "semantic_head_at_source": "metaengine-h205f22-recovery-dev-20260821-cp072",
        "canonical_digest_at_source": "6" * 64,
        "migration_ledger_sha256": "7" * 64,
        "verified_timestamp_count": 1,
        "source_attestation_verified": True,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "final_r2_evidence_binding_required": True,
    }
    self_hash(verification, "verification_receipt_sha256")
    return ciphertext, envelope_path, artifacts, preflight, verification


class VerifiedSourceHandoffTests(unittest.TestCase):
    def test_valid_handoff_makes_provider_credentials_only_eligible(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            out=h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)
            self.assertTrue(out["source_attestation_verified"])
            self.assertTrue(out["provider_credentials_eligible_after_environment_and_readiness_gates"])
            self.assertFalse(out["provider_execution_authorized"])
            self.assertFalse(out["r2_proven"])
            self.assertFalse(out["persisted_seal_allowed"])

    def test_wrong_or_expired_verification_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            artifacts["artifacts"][2]["name"]="other.json"
            with self.assertRaisesRegex(h.HandoffError,"artifact_name_mismatch"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

            artifacts["artifacts"][2]["name"]="r1-recovery-source-verification.json"
            artifacts["artifacts"][2]["expired"]=True
            with self.assertRaisesRegex(h.HandoffError,"artifact_expired"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

    def test_artifact_must_belong_to_exact_source_run_and_head(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            artifacts["artifacts"][2]["workflow_run"]["head_sha"]="9"*40
            with self.assertRaisesRegex(h.HandoffError,"workflow_binding_mismatch:head_sha"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

    def test_receipt_self_hash_tamper_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            verification["semantic_head_at_source"]="forged"
            with self.assertRaisesRegex(h.HandoffError,"verification_receipt_sha256_mismatch"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

    def test_forged_run_after_rehash_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            verification["source"]["run_id"]=RUN_ID+1
            self_hash(verification,"verification_receipt_sha256")
            with self.assertRaisesRegex(h.HandoffError,"source_binding_mismatch:run_id"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

    def test_ciphertext_or_envelope_binding_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            verification["ciphertext_sha256"]="8"*64
            self_hash(verification,"verification_receipt_sha256")
            with self.assertRaisesRegex(h.HandoffError,"ciphertext_binding_mismatch"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

    def test_attestation_verified_false_or_authority_escalation_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            verification["source_attestation_verified"]=False
            self_hash(verification,"verification_receipt_sha256")
            with self.assertRaisesRegex(h.HandoffError,"source_attestation_not_verified"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

            _,_,artifacts,preflight,verification=build_fixture(Path(td))
            verification["r2_proven"]=True
            self_hash(verification,"verification_receipt_sha256")
            with self.assertRaisesRegex(h.HandoffError,"authority_boundary_invalid"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)

    def test_preflight_must_remain_nonauthoritative(self):
        with tempfile.TemporaryDirectory() as td:
            ciphertext,envelope,artifacts,preflight,verification=build_fixture(Path(td))
            preflight["provider_execution_authorized"]=True
            self_hash(preflight,"preflight_sha256")
            with self.assertRaisesRegex(h.HandoffError,"preflight_must_not_authorize_provider"):
                h.validate_handoff(preflight=preflight,artifacts=artifacts,source_verification_artifact_id=VERIFICATION_ARTIFACT_ID,source_verification=verification,ciphertext=ciphertext,envelope_receipt=envelope)


if __name__ == "__main__":
    unittest.main()
