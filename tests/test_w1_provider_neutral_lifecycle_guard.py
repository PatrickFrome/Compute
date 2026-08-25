from __future__ import annotations

import copy
import unittest

from controller.w1 import provider_neutral_lifecycle_guard as guard


FALSE_NONCLAIMS = {
    "canonical": False,
    "authority_effect": False,
    "persistent_worker_proof": False,
    "worker_admitted": False,
    "w1_verified": False,
}


def fixture(provider_kind="VERCEL_SANDBOX", action_kind="STOP_RESUME"):
    return {
        "schema": guard.INPUT_SCHEMA,
        "provider": {
            "provider_kind": provider_kind,
            "pre_object_id": "metaengine-w1-persistent-sandbox",
            "post_object_id": "metaengine-w1-persistent-sandbox",
            "pre_session_id": "session-pre-001",
            "post_session_id": "session-post-002",
            "action_kind": action_kind,
            "requested_at": "2026-08-25T00:00:10Z",
            "completed_at": "2026-08-25T00:00:20Z",
            "provider_readback_sha256": "a" * 64,
        },
        "pre": {
            "captured_at": "2026-08-25T00:00:00Z",
            "os": "linux",
            "boot_id": "11111111-1111-4111-8111-111111111111",
            "sentinel_sha256": "b" * 64,
        },
        "post": {
            "captured_at": "2026-08-25T00:00:30Z",
            "os": "linux",
            "boot_id": "22222222-2222-4222-8222-222222222222",
            "sentinel_sha256": "b" * 64,
        },
        "nonclaims": dict(FALSE_NONCLAIMS),
    }


class ProviderNeutralLifecycleGuardTests(unittest.TestCase):
    def test_valid_vercel_stop_resume_is_non_authority_only(self):
        result = guard.evaluate(fixture())
        self.assertEqual(result["outcome"], "LIFECYCLE_EVIDENCE_STRUCTURALLY_ELIGIBLE_NONAUTHORITY")
        self.assertFalse(result["input_provenance_verified"])
        self.assertFalse(result["provider_identity_verified"])
        self.assertFalse(result["provider_action_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])
        self.assertTrue(result["requires_server_side_provider_validation"])

    def test_valid_codespaces_stop_resume_is_non_authority_only(self):
        value = fixture("GITHUB_CODESPACES", "STOP_RESUME")
        value["provider"]["pre_object_id"] = "codespace-name-abc"
        value["provider"]["post_object_id"] = "codespace-name-abc"
        result = guard.evaluate(value)
        self.assertEqual(result["outcome"], "LIFECYCLE_EVIDENCE_STRUCTURALLY_ELIGIBLE_NONAUTHORITY")

    def test_valid_aws_reboot_is_structurally_supported_but_not_provider_verified(self):
        value = fixture("AWS_EC2", "REBOOT")
        value["provider"]["pre_object_id"] = "i-0123456789abcdef0"
        value["provider"]["post_object_id"] = "i-0123456789abcdef0"
        result = guard.evaluate(value)
        self.assertEqual(result["outcome"], "LIFECYCLE_EVIDENCE_STRUCTURALLY_ELIGIBLE_NONAUTHORITY")
        self.assertFalse(result["provider_identity_verified"])

    def test_provider_object_drift_rejected(self):
        value = fixture()
        value["provider"]["post_object_id"] = "different-sandbox"
        result = guard.evaluate(value)
        self.assertEqual(result["outcome"], "REJECTED_LIFECYCLE_EVIDENCE")
        self.assertIn("provider_object_identity_stable", result["evidence"]["failures"])

    def test_session_must_change(self):
        value = fixture()
        value["provider"]["post_session_id"] = value["provider"]["pre_session_id"]
        result = guard.evaluate(value)
        self.assertIn("provider_session_identity_changed", result["evidence"]["failures"])

    def test_boot_id_must_change(self):
        value = fixture()
        value["post"]["boot_id"] = value["pre"]["boot_id"]
        result = guard.evaluate(value)
        self.assertIn("kernel_boot_id_changed", result["evidence"]["failures"])

    def test_sentinel_must_survive(self):
        value = fixture()
        value["post"]["sentinel_sha256"] = "c" * 64
        result = guard.evaluate(value)
        self.assertIn("persistent_sentinel_hash_equal_pre_post", result["evidence"]["failures"])

    def test_chronology_must_hold(self):
        value = fixture()
        value["provider"]["requested_at"] = "2026-08-24T23:59:59Z"
        result = guard.evaluate(value)
        self.assertIn("chronology", result["evidence"]["failures"])

    def test_unknown_provider_fails_closed(self):
        value = fixture()
        value["provider"]["provider_kind"] = "UNTRUSTED_VM"
        with self.assertRaisesRegex(ValueError, "unsupported provider_kind"):
            guard.evaluate(value)

    def test_wrong_action_for_provider_fails_closed(self):
        value = fixture("VERCEL_SANDBOX", "REBOOT")
        with self.assertRaisesRegex(ValueError, "provider/action combination not allowed"):
            guard.evaluate(value)

    def test_authority_escalation_is_rejected(self):
        for key in FALSE_NONCLAIMS:
            with self.subTest(key=key):
                value = fixture()
                value["nonclaims"][key] = True
                with self.assertRaisesRegex(ValueError, f"{key} must be false"):
                    guard.evaluate(value)

    def test_extra_keys_are_rejected(self):
        value = fixture()
        value["provider"]["trust_me"] = True
        with self.assertRaisesRegex(ValueError, "provider keys mismatch"):
            guard.evaluate(value)

    def test_invalid_readback_digest_rejected(self):
        value = fixture()
        value["provider"]["provider_readback_sha256"] = "not-a-digest"
        with self.assertRaisesRegex(ValueError, "provider_readback_sha256"):
            guard.evaluate(value)

    def test_non_linux_rejected(self):
        value = fixture()
        value["post"]["os"] = "darwin"
        with self.assertRaisesRegex(ValueError, "real Linux"):
            guard.evaluate(value)


if __name__ == "__main__":
    unittest.main()
