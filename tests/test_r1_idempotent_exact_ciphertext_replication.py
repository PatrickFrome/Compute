import hashlib
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from controller.r1.exact_ciphertext_replication_controller import ReplicationError, TARGET_SCHEMA
from controller.r1.idempotent_exact_ciphertext_replication import (
    IdempotentReplicationError,
    build_head_current_command,
    replicate_or_reuse,
)
from controller.r1.recovery_encryption_envelope import (
    AGE_REQUIRED_VERSION,
    ENVELOPE_CLASSIFICATION,
    ENVELOPE_SCHEMA,
    PROFILE_PRODUCTION_PQ,
    _canonical_bytes,
    _sha256_bytes,
)


NOW = datetime(2026, 8, 21, 18, 30, tzinfo=timezone.utc)


class IdempotentExactCiphertextReplicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ciphertext = self.root / "recovery.age"
        self.ciphertext.write_bytes(b"exact encrypted recovery ciphertext\n")
        self.cipher_sha = hashlib.sha256(self.ciphertext.read_bytes()).hexdigest()
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
                "sha256": self.cipher_sha,
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

    def current_head(self, version="existing-v1", metadata_sha=None):
        return {
            "ContentLength": self.ciphertext.stat().st_size,
            "LastModified": (NOW - timedelta(hours=1)).isoformat(),
            "ETag": '"etag-only"',
            "VersionId": version,
            "Metadata": {
                "metaengine-sha256": metadata_sha or self.cipher_sha,
                "metaengine-contract": "h205f22-r1-v1",
            },
        }

    def runner(self, *, put_fails=False, corrupt_get=False):
        retain_until = (NOW + timedelta(days=30)).isoformat()
        ciphertext = self.ciphertext.read_bytes()

        def run(cmd):
            operation = cmd[2]
            if operation == "put-object":
                if put_fails:
                    raise ReplicationError("provider_command_failed:s3api:put-object")
                return {"VersionId": "created-v1", "ETag": '"etag-only"'}
            if operation == "get-object-retention":
                return {"Retention": {"Mode": "COMPLIANCE", "RetainUntilDate": retain_until}}
            if operation == "head-object":
                return {
                    "ContentLength": len(ciphertext),
                    "LastModified": NOW.isoformat(),
                    "ETag": '"etag-only"',
                    "VersionId": "created-v1",
                }
            if operation == "get-object":
                output = Path(cmd[-1])
                output.write_bytes(ciphertext + (b"tamper" if corrupt_get else b""))
                return {"VersionId": "existing-v1"}
            raise AssertionError(cmd)

        return run

    def test_head_current_probe_is_unversioned_and_provider_specific(self):
        aws_target = self.target("AWS_S3")
        b2_target = self.target("BACKBLAZE_B2")
        from controller.r1.exact_ciphertext_replication_controller import validate_target
        aws = validate_target(aws_target, NOW)
        b2 = validate_target(b2_target, NOW)
        aws_cmd = build_head_current_command("aws", aws, f"h205f22/r1/sha256/{self.cipher_sha}.age")
        b2_cmd = build_head_current_command("aws", b2, f"h205f22/r1/sha256/{self.cipher_sha}.age")
        self.assertNotIn("--version-id", aws_cmd)
        self.assertNotIn("--endpoint-url", aws_cmd)
        self.assertIn("--endpoint-url", b2_cmd)

    def test_existing_valid_version_is_reused_without_put(self):
        calls = []
        base_runner = self.runner()

        def runner(cmd):
            calls.append(cmd[2])
            return base_runner(cmd)

        result = replicate_or_reuse(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope_receipt,
            target_raw=self.target("AWS_S3"),
            now=NOW,
            probe_runner=lambda _cmd: self.current_head(),
            runner=runner,
        )
        self.assertNotIn("put-object", calls)
        self.assertEqual(result["replication"]["mode"], "REUSED_EXISTING_VERSION")
        self.assertFalse(result["replication"]["new_provider_write"])
        self.assertEqual(result["ciphertext"]["version_id"], "existing-v1")
        self.assertEqual(result["readback_receipt"]["readback"]["status"], "VERIFIED")
        self.assertFalse(result["r2_proven"])

    def test_missing_current_object_uses_original_conditional_create_path(self):
        result = replicate_or_reuse(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope_receipt,
            target_raw=self.target("AWS_S3"),
            now=NOW,
            probe_runner=lambda _cmd: None,
            runner=self.runner(),
        )
        self.assertEqual(result["replication"]["mode"], "CREATED_NEW_VERSION")
        self.assertTrue(result["replication"]["new_provider_write"])
        self.assertEqual(result["ciphertext"]["version_id"], "created-v1")

    def test_existing_wrong_metadata_or_corrupt_bytes_fail_closed(self):
        with self.assertRaisesRegex(IdempotentReplicationError, "metadata_sha256_mismatch"):
            replicate_or_reuse(
                ciphertext=self.ciphertext,
                envelope_receipt_path=self.envelope_receipt,
                target_raw=self.target("AWS_S3"),
                now=NOW,
                probe_runner=lambda _cmd: self.current_head(metadata_sha="0" * 64),
                runner=self.runner(),
            )
        with self.assertRaisesRegex(IdempotentReplicationError, "materialized_readback_mismatch"):
            replicate_or_reuse(
                ciphertext=self.ciphertext,
                envelope_receipt_path=self.envelope_receipt,
                target_raw=self.target("AWS_S3"),
                now=NOW,
                probe_runner=lambda _cmd: self.current_head(),
                runner=self.runner(corrupt_get=True),
            )

    def test_create_race_falls_back_to_verified_existing_version(self):
        probes = [None, self.current_head(version="race-winner-v1")]

        def probe(_cmd):
            return probes.pop(0)

        result = replicate_or_reuse(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope_receipt,
            target_raw=self.target("AWS_S3"),
            now=NOW,
            probe_runner=probe,
            runner=self.runner(put_fails=True),
        )
        self.assertEqual(result["replication"]["mode"], "REUSED_EXISTING_VERSION")
        self.assertEqual(result["ciphertext"]["version_id"], "race-winner-v1")
        self.assertFalse(result["r2_proven"])

    def test_b2_existing_version_reuse_remains_version_pinned(self):
        result = replicate_or_reuse(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope_receipt,
            target_raw=self.target("BACKBLAZE_B2"),
            now=NOW,
            probe_runner=lambda _cmd: self.current_head(version="4_z-existing"),
            runner=self.runner(),
        )
        self.assertEqual(result["target"]["provider_kind"], "BACKBLAZE_B2")
        self.assertEqual(result["ciphertext"]["version_id"], "4_z-existing")
        self.assertEqual(result["readback_receipt"]["provider_object"]["version_id"], "4_z-existing")


if __name__ == "__main__":
    unittest.main()
