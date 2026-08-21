import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "controller" / "r1" / "materialized_readback_verifier.py"
spec = importlib.util.spec_from_file_location("r1_materialized_readback_verifier", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

PAYLOAD = b"METAENGINE-H205F22-R1-materialized-readback\n"
EXPECTED_SHA = __import__("hashlib").sha256(PAYLOAD).hexdigest()
ACCOUNT_SHA = "a" * 64
CONTROLLER_SHA = "b" * 64
OBSERVED_AT = "2026-08-21T15:00:00+00:00"
RETAIN_UNTIL = "2026-09-21T15:00:00+00:00"


def descriptor(provider_kind="AWS_S3", domain="r1-aws-a", operator="AMAZON_AWS", failure="aws-us-east-2-account-a"):
    retention = {
        "mode": "COMPLIANCE",
        "retain_until": RETAIN_UNTIL,
        "source": "GET_OBJECT_RETENTION",
    }
    if provider_kind == "CLOUDFLARE_R2":
        retention = {
            "lock_rule_active": True,
            "retain_until": RETAIN_UNTIL,
            "indefinite": False,
            "source": "R2_BUCKET_LOCK_RULES_API",
        }
    return {
        "schema": "metaengine.compute.r1-readback-descriptor.h205f22.v1",
        "domain_key": domain,
        "provider_kind": provider_kind,
        "operator_class": operator,
        "failure_domain": failure,
        "independence_basis": "independent provider/operator account and separately materialized readback",
        "account_scope_sha256": ACCOUNT_SHA,
        "object": {
            "subject_kind": "BACKUP_SET",
            "subject_id": "pgbackrest-set-20260821-150000F",
            "expected_sha256": EXPECTED_SHA,
            "expected_bytes": len(PAYLOAD),
            "payload_root_sha256": "c" * 64,
            "manifest_checkpoint_id": "metaengine-h205f22-recovery-dev-20260821-cp072",
        },
        "provider_object": {
            "endpoint_host": "s3.us-east-2.amazonaws.com",
            "bucket": "metaengine-r1-a",
            "key": "backup/manifest.bin",
            "version_id": "version-1",
            "etag": '"misleading-etag-that-is-not-content-proof"',
            "content_length": len(PAYLOAD),
            "last_modified": "2026-08-21T14:59:00+00:00",
            "retention": retention,
        },
        "controller": {
            "kind": "PROVIDER_API_PLUS_MATERIALIZED_GET",
            "observed_at": OBSERVED_AT,
            "evidence_sha256": CONTROLLER_SHA,
        },
    }


def verify_with_payload(d, payload=PAYLOAD):
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "readback.bin"
        path.write_bytes(payload)
        return mod.verify_materialized_readback(path, d)


class MaterializedReadbackVerifierTests(unittest.TestCase):
    def test_aws_compliance_exact_bytes_is_strong_candidate(self):
        receipt = verify_with_payload(descriptor())
        self.assertEqual(receipt["readback"]["status"], "VERIFIED")
        self.assertTrue(receipt["eligible_for_quorum_candidate"])
        self.assertEqual(receipt["retention"]["grade"], "COMPLIANCE_NON_SHORTENABLE")
        self.assertTrue(receipt["retention"]["strong_immutability"])
        self.assertFalse(receipt["provenance"]["etag_used_as_content_proof"])
        self.assertEqual(receipt["provenance"]["content_proof"], "LOCALLY_COMPUTED_SHA256_OVER_MATERIALIZED_BYTES")
        self.assertFalse(receipt["r2_proven"])
        self.assertFalse(receipt["persisted_seal_allowed"])

    def test_backblaze_compliance_exact_bytes_is_strong_candidate(self):
        d = descriptor("BACKBLAZE_B2", "r1-b2-b", "BACKBLAZE", "backblaze-account-b")
        d["provider_object"]["endpoint_host"] = "s3.us-west-004.backblazeb2.com"
        d["provider_object"]["retention"]["source"] = "B2_S3_GET_OBJECT_RETENTION"
        receipt = verify_with_payload(d)
        self.assertEqual(receipt["readback"]["status"], "VERIFIED")
        self.assertTrue(receipt["retention"]["strong_immutability"])
        self.assertTrue(receipt["eligible_for_quorum_candidate"])

    def test_cloudflare_r2_lock_is_explicitly_admin_revocable(self):
        d = descriptor("CLOUDFLARE_R2", "r1-r2-b", "CLOUDFLARE", "cloudflare-account-b")
        d["provider_object"]["endpoint_host"] = "account-id.r2.cloudflarestorage.com"
        receipt = verify_with_payload(d)
        self.assertEqual(receipt["retention"]["grade"], "ADMIN_REVOCABLE_BUCKET_RULE")
        self.assertFalse(receipt["retention"]["strong_immutability"])
        self.assertTrue(receipt["eligible_for_quorum_candidate"])

    def test_wrong_content_is_mismatch_even_when_etag_looks_trusted(self):
        d = descriptor()
        d["provider_object"]["etag"] = EXPECTED_SHA
        receipt = verify_with_payload(d, b"tampered bytes")
        self.assertEqual(receipt["readback"]["status"], "MISMATCH")
        self.assertFalse(receipt["readback"]["hash_match"])
        self.assertFalse(receipt["eligible_for_quorum_candidate"])
        self.assertFalse(receipt["provenance"]["etag_used_as_content_proof"])

    def test_provider_content_length_mismatch_is_not_eligible(self):
        d = descriptor()
        d["provider_object"]["content_length"] = len(PAYLOAD) + 1
        receipt = verify_with_payload(d)
        self.assertFalse(receipt["readback"]["provider_size_match"])
        self.assertEqual(receipt["readback"]["status"], "MISMATCH")
        self.assertFalse(receipt["eligible_for_quorum_candidate"])

    def test_expired_compliance_retention_is_not_eligible(self):
        d = descriptor()
        d["provider_object"]["retention"]["retain_until"] = "2026-08-20T15:00:00+00:00"
        receipt = verify_with_payload(d)
        self.assertEqual(receipt["retention"]["grade"], "EXPIRED")
        self.assertFalse(receipt["retention"]["active"])
        self.assertFalse(receipt["eligible_for_quorum_candidate"])

    def test_spoofed_known_provider_operator_is_rejected(self):
        d = descriptor(operator="NOT_AWS")
        with self.assertRaisesRegex(mod.ReceiptError, "operator_class_provider_mismatch"):
            verify_with_payload(d)

    def test_aws_plus_b2_is_two_strong_domain_quorum_candidate_but_not_r2(self):
        a = verify_with_payload(descriptor())
        b_desc = descriptor("BACKBLAZE_B2", "r1-b2-b", "BACKBLAZE", "backblaze-account-b")
        b_desc["provider_object"]["endpoint_host"] = "s3.us-west-004.backblazeb2.com"
        b = verify_with_payload(b_desc)
        quorum = mod.evaluate_quorum([a, b])
        self.assertTrue(quorum["candidate_ready"])
        self.assertEqual(quorum["distinct_domains"], 2)
        self.assertEqual(quorum["distinct_operator_classes"], 2)
        self.assertEqual(quorum["distinct_failure_domains"], 2)
        self.assertEqual(quorum["strong_immutability_domains"], 2)
        self.assertEqual(quorum["warnings"], [])
        self.assertFalse(quorum["r2_proven"])
        self.assertFalse(quorum["persisted_seal_allowed"])

    def test_aws_plus_r2_is_candidate_with_retention_strength_warning(self):
        a = verify_with_payload(descriptor())
        r2_desc = descriptor("CLOUDFLARE_R2", "r1-r2-b", "CLOUDFLARE", "cloudflare-account-b")
        r2_desc["provider_object"]["endpoint_host"] = "account-id.r2.cloudflarestorage.com"
        b = verify_with_payload(r2_desc)
        quorum = mod.evaluate_quorum([a, b])
        self.assertTrue(quorum["candidate_ready"])
        self.assertEqual(quorum["strong_immutability_domains"], 1)
        self.assertIn("ONE_OR_MORE_DOMAINS_USE_ADMIN_REVOCABLE_OR_GOVERNANCE_RETENTION", quorum["warnings"])
        self.assertFalse(quorum["r2_proven"])

    def test_same_operator_or_failure_domain_does_not_make_quorum(self):
        a = verify_with_payload(descriptor())
        b_desc = descriptor("AWS_S3", "r1-aws-b", "AMAZON_AWS", "aws-us-east-2-account-a")
        b_desc["account_scope_sha256"] = "d" * 64
        b = verify_with_payload(b_desc)
        quorum = mod.evaluate_quorum([a, b])
        self.assertFalse(quorum["candidate_ready"])
        self.assertEqual(quorum["distinct_operator_classes"], 1)
        self.assertEqual(quorum["distinct_failure_domains"], 1)

    def test_receipt_tamper_is_rejected_before_quorum(self):
        a = verify_with_payload(descriptor())
        b_desc = descriptor("BACKBLAZE_B2", "r1-b2-b", "BACKBLAZE", "backblaze-account-b")
        b_desc["provider_object"]["endpoint_host"] = "s3.us-west-004.backblazeb2.com"
        b = verify_with_payload(b_desc)
        tampered = copy.deepcopy(b)
        tampered["failure_domain"] = "attacker-rewritten-domain"
        with self.assertRaisesRegex(mod.ReceiptError, "receipt_digest_mismatch"):
            mod.evaluate_quorum([a, tampered])


if __name__ == "__main__":
    unittest.main()
