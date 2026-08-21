import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from controller.r1.exact_ciphertext_replication_controller import (
    ReplicationError,
    TARGET_SCHEMA,
    build_put_command,
    object_key,
    replicate_and_readback,
    validate_target,
)
from controller.r1.recovery_encryption_envelope import (
    AGE_REQUIRED_VERSION,
    ENVELOPE_CLASSIFICATION,
    ENVELOPE_SCHEMA,
    PROFILE_PRODUCTION_PQ,
    _canonical_bytes,
    _sha256_bytes,
)


NOW = datetime(2026, 8, 21, 16, 40, tzinfo=timezone.utc)


class ExactCiphertextReplicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ciphertext = self.root / "recovery.age"
        self.ciphertext.write_bytes(b"exact encrypted recovery ciphertext\n")
        cipher_sha = hashlib.sha256(self.ciphertext.read_bytes()).hexdigest()
        core = {
            "schema": ENVELOPE_SCHEMA,
            "classification": ENVELOPE_CLASSIFICATION,
            "source_bundle": {
                "bundle_sha256": "b" * 64,
                "bundle_bytes": 1234,
                "manifest_sha256": "c" * 64,
                "bundle_receipt_sha256": "d" * 64,
                "storage_api_objects_included": False,
            },
            "ciphertext": {
                "format": "age-encryption.org/v1",
                "sha256": cipher_sha,
                "bytes": self.ciphertext.stat().st_size,
            },
            "encryption": {
                "tool": "age",
                "required_version": AGE_REQUIRED_VERSION,
                "observed_version": AGE_REQUIRED_VERSION,
                "profile": PROFILE_PRODUCTION_PQ,
                "recipient_count": 2,
                "recipients": [
                    {"kind": "MLKEM768_X25519_HYBRID", "recipient_sha256": "1" * 64},
                    {"kind": "MLKEM768_X25519_HYBRID", "recipient_sha256": "2" * 64},
                ],
                "post_quantum_required": True,
                "encrypt_once_required": True,
                "replication_contract": "COPY_EXACT_CIPHERTEXT_BYTES_DO_NOT_REENCRYPT_PER_PROVIDER",
            },
            "security": {
                "plaintext_upload_allowed": False,
                "plaintext_bundle_must_remain_local": True,
                "external_storage_ready": True,
                "identity_material_embedded": False,
            },
            "provenance": {
                "sender_authenticity_proven": False,
                "source_attestation_verified": False,
                "source_attestation_required_before_authority": True,
                "self_hash_is_not_sender_authentication": True,
            },
            "authority": {
                "canonical": False,
                "authority_effect": False,
                "source_attestation_verified": False,
                "r2_proven": False,
                "r3_proven": False,
                "persisted_seal_allowed": False,
            },
            "required_next": "UPLOAD_IDENTICAL_CIPHERTEXT_TO_TWO_INDEPENDENT_DOMAINS_THEN_MATERIALIZE_AND_HASH_READBACK",
        }
        receipt = dict(core)
        receipt["receipt_sha256"] = _sha256_bytes(_canonical_bytes(core))
        self.envelope_receipt = self.root / "envelope.json"
        self.envelope_receipt.write_bytes(_canonical_bytes(receipt) + b"\n")
        self.cipher_sha = cipher_sha

    def tearDown(self):
        self.tmp.cleanup()

    def target(self, provider="AWS_S3"):
        is_aws = provider == "AWS_S3"
        return {
            "schema": TARGET_SCHEMA,
            "domain_key": "aws-us-east-2" if is_aws else "b2-us-west-004",
            "provider_kind": provider,
            "operator_class": "AMAZON_AWS" if is_aws else "BACKBLAZE",
            "failure_domain": "aws:us-east-2" if is_aws else "b2:us-west-004",
            "independence_basis": "independently operated provider and account boundary",
            "account_scope_sha256": ("a" if is_aws else "b") * 64,
            "bucket": "metaengine-r1-proof-a" if is_aws else "metaengine-r1-proof-b",
            "region": "us-east-2" if is_aws else "us-west-004",
            "endpoint_url": None if is_aws else "https://s3.us-west-004.backblazeb2.com",
            "retain_until": (NOW + timedelta(days=30)).isoformat(),
        }

    def fake_runner(self, *, corrupt_get=False, retention_mode="COMPLIANCE", head_version="v1", missing_version=False):
        ciphertext_bytes = self.ciphertext.read_bytes()
        retain_until = (NOW + timedelta(days=30)).isoformat()

        def run(cmd):
            operation = cmd[2]
            if operation == "put-object":
                return {"ETag": '"provider-etag"'} if missing_version else {"VersionId": "v1", "ETag": '"provider-etag"'}
            if operation == "get-object-retention":
                return {"Retention": {"Mode": retention_mode, "RetainUntilDate": retain_until}}
            if operation == "head-object":
                return {
                    "ContentLength": len(ciphertext_bytes),
                    "LastModified": NOW.isoformat(),
                    "ETag": '"provider-etag"',
                    "VersionId": head_version,
                }
            if operation == "get-object":
                output_path = Path(cmd[-1])
                output_path.write_bytes(ciphertext_bytes + (b"tamper" if corrupt_get else b""))
                return {"VersionId": "v1", "ContentLength": output_path.stat().st_size}
            raise AssertionError(cmd)

        return run

    def test_aws_put_uses_conditional_create_and_b2_does_not_claim_it(self):
        aws = validate_target(self.target("AWS_S3"), NOW)
        b2 = validate_target(self.target("BACKBLAZE_B2"), NOW)
        aws_cmd = build_put_command("aws", aws, self.ciphertext, self.cipher_sha)
        b2_cmd = build_put_command("aws", b2, self.ciphertext, self.cipher_sha)
        self.assertIn("--if-none-match", aws_cmd)
        self.assertNotIn("--endpoint-url", aws_cmd)
        self.assertNotIn("--if-none-match", b2_cmd)
        self.assertIn("--endpoint-url", b2_cmd)
        self.assertIn("--object-lock-mode", aws_cmd)
        self.assertIn("COMPLIANCE", aws_cmd)
        self.assertIn("COMPLIANCE", b2_cmd)

    def test_content_addressed_key(self):
        self.assertEqual(object_key(self.cipher_sha), f"h205f22/r1/sha256/{self.cipher_sha}.age")

    def test_aws_success_emits_verified_non_authoritative_candidate(self):
        result = replicate_and_readback(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope_receipt,
            target_raw=self.target("AWS_S3"),
            aws_bin="aws",
            now=NOW,
            runner=self.fake_runner(),
        )
        self.assertEqual(result["readback_receipt"]["readback"]["status"], "VERIFIED")
        self.assertEqual(result["readback_receipt"]["retention"]["grade"], "COMPLIANCE_NON_SHORTENABLE")
        self.assertEqual(result["ciphertext"]["version_id"], "v1")
        self.assertFalse(result["provenance"]["source_attestation_verified"])
        self.assertTrue(result["provenance"]["source_attestation_required_before_authority"])
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["r2_proven"])
        self.assertFalse(result["persisted_seal_allowed"])

    def test_b2_success_is_version_pinned(self):
        result = replicate_and_readback(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope_receipt,
            target_raw=self.target("BACKBLAZE_B2"),
            now=NOW,
            runner=self.fake_runner(),
        )
        self.assertEqual(result["target"]["provider_kind"], "BACKBLAZE_B2")
        self.assertEqual(result["ciphertext"]["version_id"], "v1")
        self.assertEqual(result["readback_receipt"]["provider_object"]["version_id"], "v1")

    def test_missing_version_id_rejected(self):
        with self.assertRaisesRegex(ReplicationError, "version_id_missing"):
            replicate_and_readback(
                ciphertext=self.ciphertext,
                envelope_receipt_path=self.envelope_receipt,
                target_raw=self.target(),
                now=NOW,
                runner=self.fake_runner(missing_version=True),
            )

    def test_retention_downgrade_rejected(self):
        with self.assertRaisesRegex(ReplicationError, "retention_not_compliance"):
            replicate_and_readback(
                ciphertext=self.ciphertext,
                envelope_receipt_path=self.envelope_receipt,
                target_raw=self.target(),
                now=NOW,
                runner=self.fake_runner(retention_mode="GOVERNANCE"),
            )

    def test_wrong_head_version_rejected(self):
        with self.assertRaisesRegex(ReplicationError, "head_version_id_mismatch"):
            replicate_and_readback(
                ciphertext=self.ciphertext,
                envelope_receipt_path=self.envelope_receipt,
                target_raw=self.target(),
                now=NOW,
                runner=self.fake_runner(head_version="other-version"),
            )

    def test_corrupt_materialized_bytes_rejected(self):
        with self.assertRaisesRegex(ReplicationError, "materialized_readback_mismatch"):
            replicate_and_readback(
                ciphertext=self.ciphertext,
                envelope_receipt_path=self.envelope_receipt,
                target_raw=self.target(),
                now=NOW,
                runner=self.fake_runner(corrupt_get=True),
            )

    def test_operator_spoof_and_bad_endpoint_rejected(self):
        spoof = self.target("BACKBLAZE_B2")
        spoof["operator_class"] = "AMAZON_AWS"
        with self.assertRaisesRegex(ReplicationError, "operator_class_provider_mismatch"):
            validate_target(spoof, NOW)
        endpoint = self.target("BACKBLAZE_B2")
        endpoint["endpoint_url"] = "https://evil.example.com"
        with self.assertRaisesRegex(ReplicationError, "b2_endpoint_host_invalid"):
            validate_target(endpoint, NOW)

    def test_trivial_retention_rejected(self):
        target = self.target()
        target["retain_until"] = (NOW + timedelta(minutes=10)).isoformat()
        with self.assertRaisesRegex(ReplicationError, "at_least_24h"):
            validate_target(target, NOW)


if __name__ == "__main__":
    unittest.main()
