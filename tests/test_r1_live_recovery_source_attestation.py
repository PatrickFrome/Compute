import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / "controller" / "r1" / "live_recovery_source_attestation.py"
spec = importlib.util.spec_from_file_location("r1_live_recovery_source_attestation", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def self_hash(value, field):
    core = dict(value)
    core.pop(field, None)
    value[field] = hashlib.sha256(canon(core)).hexdigest()
    return value


def source_environment():
    return {
        "name": "r1-recovery-source",
        "protection_rules": [
            {
                "type": "required_reviewers",
                "prevent_self_review": True,
                "reviewers": [{"type": "User", "reviewer": {"login": "reviewer"}}],
            },
            {"type": "branch_policy"},
        ],
        "deployment_branch_policy": {"protected_branches": True, "custom_branch_policies": False},
    }


def fence(*, head="metaengine-h205f22-recovery-dev-20260821-cp072", digest="a" * 64, ledger="b" * 64, rows=7, version="20260821125449", captured="2026-08-21T19:00:00Z"):
    return {
        "schema": mod.FENCE_SCHEMA,
        "semantic_head": head,
        "canonical_digest": digest,
        "migration_ledger_sha256": ledger,
        "migration_rows": rows,
        "max_migration_version": version,
        "captured_at": captured,
    }


def build_files(root: Path):
    ciphertext = root / "r1-recovery-ciphertext.age"
    ciphertext.write_bytes(b"encrypted-recovery-ciphertext")
    cipher_sha = hashlib.sha256(ciphertext.read_bytes()).hexdigest()

    bundle = {
        "schema": "metaengine.compute.r1-recovery-bundle-build-receipt.h205f22.v1",
        "classification": "PLAINTEXT_BUNDLE_BUILD_RECEIPT_NONAUTHORITATIVE",
        "manifest_sha256": "c" * 64,
        "bundle_sha256": "d" * 64,
        "bundle_bytes": 1234,
        "storage_api_objects_included": False,
        "external_storage_ready": False,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "required_next": "AGE_OR_EQUIVALENT_REVIEWED_ENCRYPTION_ENVELOPE",
    }
    self_hash(bundle, "receipt_sha256")
    bundle_path = root / "bundle-receipt.json"
    bundle_path.write_text(json.dumps(bundle))

    envelope = {
        "schema": "metaengine.compute.r1-recovery-encryption-envelope.h205f22.v1",
        "classification": "ENCRYPTED_RECOVERY_ARTIFACT_CANDIDATE_NONAUTHORITATIVE",
        "source_bundle": {
            "bundle_sha256": bundle["bundle_sha256"],
            "bundle_bytes": bundle["bundle_bytes"],
            "manifest_sha256": bundle["manifest_sha256"],
            "bundle_receipt_sha256": bundle["receipt_sha256"],
            "storage_api_objects_included": False,
        },
        "ciphertext": {"format": "age-encryption.org/v1", "sha256": cipher_sha, "bytes": len(ciphertext.read_bytes())},
        "encryption": {
            "tool": "age",
            "required_version": "1.3.1",
            "observed_version": "1.3.1",
            "profile": "PRODUCTION_PQ_TWO_RECIPIENT_MIN",
            "recipient_count": 2,
            "recipients": [{"kind": "MLKEM768_X25519_HYBRID", "recipient_sha256": "e" * 64}, {"kind": "MLKEM768_X25519_HYBRID", "recipient_sha256": "f" * 64}],
            "post_quantum_required": True,
            "encrypt_once_required": True,
            "replication_contract": "COPY_EXACT_CIPHERTEXT_BYTES_DO_NOT_REENCRYPT_PER_PROVIDER",
        },
        "security": {"plaintext_upload_allowed": False, "plaintext_bundle_must_remain_local": True, "external_storage_ready": True, "identity_material_embedded": False},
        "provenance": {"sender_authenticity_proven": False, "source_attestation_verified": False, "source_attestation_required_before_authority": True, "self_hash_is_not_sender_authentication": True},
        "authority": {"canonical": False, "authority_effect": False, "source_attestation_verified": False, "r2_proven": False, "r3_proven": False, "persisted_seal_allowed": False},
        "required_next": "UPLOAD_IDENTICAL_CIPHERTEXT_TO_TWO_INDEPENDENT_DOMAINS_THEN_MATERIALIZE_AND_HASH_READBACK",
    }
    self_hash(envelope, "receipt_sha256")
    envelope_path = root / "envelope.json"
    envelope_path.write_text(json.dumps(envelope))

    meta = mod.build_export_metadata(fence(), fence(captured="2026-08-21T19:01:00Z"))
    meta_path = root / "export-metadata.json"
    meta_path.write_text(json.dumps(meta))
    return ciphertext, envelope_path, bundle_path, meta_path


class LiveRecoverySourceAttestationTests(unittest.TestCase):
    def test_source_environment_requires_reviewers_self_review_block_and_branch_policy(self):
        result = mod.validate_source_environment(source_environment())
        self.assertTrue(result["ready_for_source_generation"])
        self.assertFalse(result["authority_effect"])
        bad = source_environment()
        bad["protection_rules"][0]["prevent_self_review"] = False
        with self.assertRaisesRegex(mod.SourceAttestationError, "prevent_self_review_required"):
            mod.validate_source_environment(bad)

    def test_control_fence_accepts_time_change_but_rejects_semantic_or_migration_drift(self):
        stable = mod.validate_control_fences(fence(), fence(captured="2026-08-21T19:02:00Z"))
        self.assertTrue(stable["stable"])
        with self.assertRaisesRegex(mod.SourceAttestationError, "semantic_head"):
            mod.validate_control_fences(fence(), fence(head="metaengine-h205f22-recovery-dev-20260821-cp999"))
        with self.assertRaisesRegex(mod.SourceAttestationError, "migration_ledger_sha256"):
            mod.validate_control_fences(fence(), fence(ledger="1" * 64))

    def test_export_metadata_is_explicit_about_logical_and_storage_coverage(self):
        value = mod.build_export_metadata(fence(), fence(captured="2026-08-21T19:02:00Z"))
        self.assertEqual(value["tool_version"], "2.111.0")
        self.assertEqual(value["export_mode"], "SUPABASE_LOGICAL_ROLES_SCHEMA_DATA")
        self.assertFalse(value["physical_backup_export_claim"])
        self.assertFalse(value["storage_api_objects_included"])

    def test_predicate_binds_ciphertext_envelope_bundle_and_control_identity(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ciphertext, envelope, bundle, meta = build_files(root)
            predicate = mod.build_source_predicate(
                ciphertext=ciphertext,
                envelope_receipt_path=envelope,
                bundle_receipt_path=bundle,
                export_metadata_path=meta,
                source_head_sha="1" * 40,
                run_id=123,
                run_attempt=1,
            )
            self.assertEqual(predicate["source"]["workflow_path"], mod.SOURCE_WORKFLOW_PATH)
            self.assertEqual(predicate["database_export"]["semantic_head"], fence()["semantic_head"])
            self.assertFalse(predicate["coverage"]["storage_api_object_bytes_included"])
            self.assertFalse(predicate["authority"]["r2_proven"])

    def test_predicate_rejects_tampered_ciphertext_or_bundle_binding(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ciphertext, envelope, bundle, meta = build_files(root)
            ciphertext.write_bytes(b"tampered")
            with self.assertRaisesRegex(mod.SourceAttestationError, "ciphertext_receipt_mismatch"):
                mod.build_source_predicate(ciphertext=ciphertext, envelope_receipt_path=envelope, bundle_receipt_path=bundle, export_metadata_path=meta, source_head_sha="1" * 40, run_id=123, run_attempt=1)

    def test_verified_attestation_result_must_be_single_timestamped_and_exactly_bound(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ciphertext, envelope, bundle, meta = build_files(root)
            predicate = mod.build_source_predicate(ciphertext=ciphertext, envelope_receipt_path=envelope, bundle_receipt_path=bundle, export_metadata_path=meta, source_head_sha="1" * 40, run_id=123, run_attempt=1)
            statement = {
                "_type": "https://in-toto.io/Statement/v1",
                "subject": [{"name": "r1-recovery-ciphertext.age", "digest": {"sha256": hashlib.sha256(ciphertext.read_bytes()).hexdigest()}}],
                "predicateType": mod.SOURCE_PREDICATE_TYPE,
                "predicate": predicate,
            }
            verification = [{"verificationResult": {"verifiedTimestamps": [{"type": "tlog"}], "statement": statement}}]
            result = mod.validate_verification_result(verification=verification, ciphertext=ciphertext, envelope_receipt_path=envelope, expected_source_head_sha="1" * 40, expected_source_run_id=123)
            self.assertTrue(result["source_attestation_verified"])
            self.assertFalse(result["authority_effect"])
            self.assertFalse(result["r2_proven"])
            self.assertTrue(result["final_r2_evidence_binding_required"])

            verification[0]["verificationResult"]["statement"]["predicate"]["source"]["run_id"] = 124
            with self.assertRaisesRegex(mod.SourceAttestationError, "source_binding_mismatch:run_id"):
                mod.validate_verification_result(verification=verification, ciphertext=ciphertext, envelope_receipt_path=envelope, expected_source_head_sha="1" * 40, expected_source_run_id=123)

    def test_missing_verified_timestamp_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ciphertext, envelope, _, _ = build_files(root)
            with self.assertRaisesRegex(mod.SourceAttestationError, "verified_timestamp_missing"):
                mod.validate_verification_result(
                    verification=[{"verificationResult": {"verifiedTimestamps": [], "statement": {}}}],
                    ciphertext=ciphertext,
                    envelope_receipt_path=envelope,
                    expected_source_head_sha="1" * 40,
                    expected_source_run_id=123,
                )


if __name__ == "__main__":
    unittest.main()
