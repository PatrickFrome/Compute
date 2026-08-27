from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import unittest

from controller.w1 import provider_dispatch_authority_guard as guard


NOW = datetime(2026, 8, 27, 3, 0, 30, tzinfo=timezone.utc)
EXPECTED = {
    "repository": "PatrickFrome/Compute",
    "repository_id": "1341371143",
    "github_sha": "a" * 40,
    "github_run_id": "33040000000",
    "github_run_attempt": 1,
    "actor_id": "20597814",
    "workflow_ref": "PatrickFrome/Compute/.github/workflows/w1-aws-provider-reboot-proof.yml@refs/heads/main",
    "ref": "refs/heads/main",
    "instance_id": "i-0123456789abcdef0",
    "worker_id": "metaengine-w1-existing-host",
    "claim_id": 40,
    "directive_id": 35,
}


def make_receipt() -> dict:
    receipt = {
        "schema": guard.SCHEMA,
        "outcome": "PASS_W1_PROVIDER_DISPATCH_AUTHORITY",
        "dispatch_gate_passed": True,
        "broker_mints_authority": False,
        "canonical": False,
        "authority_effect": False,
        "broker_observed_at": "2026-08-27T03:00:00Z",
        "receipt_expires_at": "2026-08-27T03:01:30Z",
        "oidc_expires_at": "2026-08-27T03:05:00Z",
        "oidc_jti_sha256": "b" * 64,
        "binding": {
            "action": guard.ACTION,
            "repository": EXPECTED["repository"],
            "repository_id": EXPECTED["repository_id"],
            "github_sha": EXPECTED["github_sha"],
            "github_run_id": EXPECTED["github_run_id"],
            "github_run_attempt": EXPECTED["github_run_attempt"],
            "actor_id": EXPECTED["actor_id"],
            "workflow_ref": EXPECTED["workflow_ref"],
            "ref": EXPECTED["ref"],
            "environment": "w1-persistent-host-proof",
            "instance_id": EXPECTED["instance_id"],
            "worker_id": EXPECTED["worker_id"],
            "claim_id": EXPECTED["claim_id"],
            "directive_id": EXPECTED["directive_id"],
        },
        "effective_execution_preflight": {
            "schema": guard.PREFLIGHT_SCHEMA,
            "outcome": "PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY",
            "effective_execution_preflight_passed": True,
            "provider_mutation_authorized": False,
            "canonical": False,
            "authority_effect": False,
            "evidence": {
                "claim": {"claim_id": EXPECTED["claim_id"], "expires_at": "2026-08-27T03:03:00Z"},
                "directive": {"directive_id": EXPECTED["directive_id"], "expires_at": "2026-08-27T03:02:30Z"},
            },
        },
    }
    receipt["receipt_sha256"] = guard.canonical_hash(receipt)
    return receipt


def rehash(receipt: dict) -> None:
    receipt.pop("receipt_sha256", None)
    receipt["receipt_sha256"] = guard.canonical_hash(receipt)


class ProviderDispatchAuthorityGuardTests(unittest.TestCase):
    def assert_blocked(self, receipt: dict, expected: dict | None = None, now: datetime = NOW):
        result = guard.verify(receipt, expected or EXPECTED, now)
        self.assertFalse(result["dispatch_gate_passed"])
        self.assertEqual(result["outcome"], "BLOCK_W1_PROVIDER_DISPATCH_NONAUTHORITY")
        self.assertFalse(result["provider_mutation_authorized"])
        self.assertFalse(result["authority_effect"])
        return result

    def test_exact_fresh_receipt_passes_as_nonauthority_gate(self):
        result = guard.verify(make_receipt(), EXPECTED, NOW)
        self.assertTrue(result["dispatch_gate_passed"])
        self.assertEqual(result["outcome"], "PASS_W1_PROVIDER_DISPATCH_GUARD_NONAUTHORITY")
        self.assertFalse(result["provider_mutation_authorized"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["authority_effect"])

    def test_expired_receipt_fails_closed(self):
        receipt = make_receipt()
        receipt["receipt_expires_at"] = "2026-08-27T03:00:20Z"
        rehash(receipt)
        result = self.assert_blocked(receipt)
        self.assertIn("receipt_not_expired", result["evidence"]["failed_checks"])

    def test_receipt_older_than_90_seconds_fails_closed(self):
        receipt = make_receipt()
        receipt["broker_observed_at"] = "2026-08-27T02:58:00Z"
        receipt["receipt_expires_at"] = "2026-08-27T03:00:40Z"
        rehash(receipt)
        result = self.assert_blocked(receipt)
        self.assertIn("receipt_age_bounded", result["evidence"]["failed_checks"])
        self.assertIn("receipt_ttl_bounded", result["evidence"]["failed_checks"])

    def test_binding_change_fails_even_with_rehashed_receipt(self):
        receipt = make_receipt()
        receipt["binding"]["github_sha"] = "c" * 40
        rehash(receipt)
        result = self.assert_blocked(receipt)
        self.assertIn("github_sha_exact", result["evidence"]["failed_checks"])

    def test_claim_or_directive_mismatch_fails_closed(self):
        receipt = make_receipt()
        receipt["binding"]["claim_id"] = 41
        receipt["effective_execution_preflight"]["evidence"]["directive"]["directive_id"] = 36
        rehash(receipt)
        result = self.assert_blocked(receipt)
        self.assertIn("claim_id_exact", result["evidence"]["failed_checks"])
        self.assertIn("preflight_directive_id_exact", result["evidence"]["failed_checks"])

    def test_nonpassing_db_preflight_fails_closed(self):
        receipt = make_receipt()
        receipt["effective_execution_preflight"]["effective_execution_preflight_passed"] = False
        receipt["effective_execution_preflight"]["outcome"] = "BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY"
        rehash(receipt)
        result = self.assert_blocked(receipt)
        self.assertIn("preflight_passed", result["evidence"]["failed_checks"])
        self.assertIn("preflight_outcome_pass", result["evidence"]["failed_checks"])

    def test_hash_tamper_fails_closed(self):
        receipt = make_receipt()
        receipt["binding"]["worker_id"] = "tampered-worker"
        result = self.assert_blocked(receipt)
        self.assertIn("receipt_hash_exact", result["evidence"]["failed_checks"])

    def test_malformed_numeric_fields_do_not_raise(self):
        receipt = make_receipt()
        receipt["binding"]["github_run_attempt"] = "not-a-number"
        receipt["binding"]["claim_id"] = "bad"
        receipt["effective_execution_preflight"]["evidence"]["directive"]["directive_id"] = []
        rehash(receipt)
        result = self.assert_blocked(receipt)
        self.assertIn("github_run_attempt_exact", result["evidence"]["failed_checks"])
        self.assertIn("claim_id_exact", result["evidence"]["failed_checks"])
        self.assertIn("preflight_directive_id_exact", result["evidence"]["failed_checks"])


if __name__ == "__main__":
    unittest.main()
