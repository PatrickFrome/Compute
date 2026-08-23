from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from worker.native_linux import admission_candidate as c


def probe(receipt_id: int, boot_id: str, created_at: str) -> dict:
    payload = {
        "schema": c.PROBE_SCHEMA,
        "os": "linux",
        "arch": "x86_64",
        "boot_id": boot_id,
        "cpu_logical": 4,
        "capabilities": {"posix_process": True, "content_cache": True},
        "memory_bytes": 8_000_000_000,
    }
    return {
        "source": c.READBACK_SOURCE,
        "receipt_id": receipt_id,
        "enrollment_id": "11111111-1111-4111-8111-111111111111",
        "worker_id": "w1-worker-001",
        "probe_schema": c.PROBE_SCHEMA,
        "probe_payload": payload,
        "probe_sha256": c.canonical_hash(payload),
        "verdict": "PASS",
        "receipt_sha256": f"{receipt_id:064x}",
        "created_at": created_at,
    }


def golden() -> dict:
    base = datetime(2026, 8, 23, 8, 0, tzinfo=timezone.utc)
    pre = probe(
        1,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        (base - timedelta(minutes=2)).isoformat(),
    )
    post = probe(
        2,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        (base + timedelta(minutes=3)).isoformat(),
    )
    return {
        "schema": c.INPUT_SCHEMA,
        "evaluated_at": (base + timedelta(minutes=4)).isoformat(),
        "safety_verification": {
            "source": c.READBACK_SOURCE,
            "enrollment_id": pre["enrollment_id"],
            "worker_id": pre["worker_id"],
            "probe_sha256": post["probe_sha256"],
            "policy_sha256": "1" * 64,
            "verification_id": "22222222-2222-4222-8222-222222222222",
            "verification_receipt_sha256": "2" * 64,
            "verification_status": "VERIFIED",
            "expires_at": (base + timedelta(hours=1)).isoformat(),
            "canonical": False,
            "authority_effect": False,
        },
        "backend_binding": {
            "source": c.READBACK_SOURCE,
            "enrollment_id": pre["enrollment_id"],
            "worker_id": pre["worker_id"],
            "backend_kind": "SELF_HOSTED_VM",
            "backend_instance_name": "i-0123456789abcdef0",
            "persistence_mode": "NATIVE_PERSISTENT",
            "execution_state": "PROBED",
            "endpoint_ref": {
                "provider_kind": "AWS_EC2",
                "provider_instance_id": "i-0123456789abcdef0",
            },
            "canonical": False,
            "authority_effect": False,
        },
        "reboot_receipt": {
            "source": c.READBACK_SOURCE,
            "reboot_receipt_id": "33333333-3333-4333-8333-333333333333",
            "worker_id": pre["worker_id"],
            "provider_kind": "AWS_EC2",
            "provider_instance_id": "i-0123456789abcdef0",
            "action_kind": "REBOOT",
            "action_id": "event-1",
            "requested_at": base.isoformat(),
            "completed_at": (base + timedelta(minutes=1)).isoformat(),
            "completed_at_semantics": "PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION",
            "identity_attestation_kind": "SIGNED_PROVIDER_IDENTITY",
            "identity_attestation_verified": True,
            "evidence_sha256": "3" * 64,
            "accepted": True,
            "canonical": False,
            "authority_effect": False,
        },
        "pre_reboot_probe": pre,
        "post_reboot_probe": post,
    }


class AdmissionCandidateTests(unittest.TestCase):
    def test_golden_forms_non_authority_candidate(self):
        result = c.compose(golden())
        self.assertEqual(result["outcome"], "ADMISSION_CANDIDATE_NON_AUTHORITY")
        self.assertTrue(result["admission_candidate"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["evidence"]["provider_action_completion_proven"])

    def test_requires_persisted_readback(self):
        value = golden()
        value["reboot_receipt"]["source"] = "HOST_SELF_REPORT"
        with self.assertRaisesRegex(ValueError, "persisted readback"):
            c.compose(value)

    def test_safety_verification_must_be_verified(self):
        value = golden()
        value["safety_verification"]["verification_status"] = "PREPARED"
        with self.assertRaisesRegex(ValueError, "dedicated safety verification required"):
            c.compose(value)

    def test_expired_safety_fails(self):
        value = golden()
        value["safety_verification"]["expires_at"] = "2026-08-23T08:03:00+00:00"
        with self.assertRaisesRegex(ValueError, "safety verification expired"):
            c.compose(value)

    def test_ephemeral_backend_fails(self):
        value = golden()
        value["backend_binding"]["persistence_mode"] = "EPHEMERAL"
        with self.assertRaisesRegex(ValueError, "non-ephemeral persistence mode required"):
            c.compose(value)

    def test_unobserved_backend_fails(self):
        value = golden()
        value["backend_binding"]["execution_state"] = "CONTRACT_READY"
        with self.assertRaisesRegex(ValueError, "live/probed backend binding required"):
            c.compose(value)

    def test_provider_instance_aliasing_fails(self):
        value = golden()
        value["reboot_receipt"]["provider_instance_id"] = "i-0badbadbadbadbad0"
        with self.assertRaisesRegex(ValueError, "provider binding mismatch"):
            c.compose(value)

    def test_cross_worker_receipt_fails(self):
        value = golden()
        value["post_reboot_probe"]["worker_id"] = "w1-worker-002"
        with self.assertRaisesRegex(ValueError, "cross-worker"):
            c.compose(value)

    def test_same_boot_id_fails(self):
        value = golden()
        value["post_reboot_probe"]["probe_payload"]["boot_id"] = value["pre_reboot_probe"]["probe_payload"]["boot_id"]
        value["post_reboot_probe"]["probe_sha256"] = c.canonical_hash(value["post_reboot_probe"]["probe_payload"])
        value["safety_verification"]["probe_sha256"] = value["post_reboot_probe"]["probe_sha256"]
        with self.assertRaisesRegex(ValueError, "boot_id must change"):
            c.compose(value)

    def test_post_probe_before_provider_request_fails(self):
        value = golden()
        value["post_reboot_probe"]["created_at"] = "2026-08-23T07:59:00+00:00"
        with self.assertRaisesRegex(ValueError, "ordering invalid"):
            c.compose(value)

    def test_safety_must_bind_post_probe(self):
        value = golden()
        value["safety_verification"]["probe_sha256"] = value["pre_reboot_probe"]["probe_sha256"]
        with self.assertRaisesRegex(ValueError, "bind post-reboot probe"):
            c.compose(value)

    def test_provider_request_is_not_completion(self):
        value = golden()
        value["reboot_receipt"]["completed_at_semantics"] = "REBOOT_COMPLETED"
        with self.assertRaisesRegex(ValueError, "non-completion"):
            c.compose(value)

    def test_reboot_receipt_must_be_accepted(self):
        value = golden()
        value["reboot_receipt"]["accepted"] = False
        with self.assertRaisesRegex(ValueError, "must be accepted"):
            c.compose(value)

    def test_unsigned_provider_identity_fails(self):
        value = golden()
        value["reboot_receipt"]["identity_attestation_kind"] = "PROVIDER_METADATA"
        value["reboot_receipt"]["identity_attestation_verified"] = False
        with self.assertRaisesRegex(ValueError, "signed provider identity required"):
            c.compose(value)

    def test_probe_hash_tamper_fails(self):
        value = golden()
        value["post_reboot_probe"]["probe_payload"]["cpu_logical"] = 99
        with self.assertRaisesRegex(ValueError, "probe_sha256 mismatch"):
            c.compose(value)

    def test_authority_escalation_fails(self):
        value = golden()
        value["backend_binding"]["authority_effect"] = True
        with self.assertRaisesRegex(ValueError, "non-authority"):
            c.compose(value)

    def test_unknown_input_field_fails(self):
        value = golden()
        value["persistence_proven"] = True
        with self.assertRaisesRegex(ValueError, "composition keys mismatch"):
            c.compose(value)


if __name__ == "__main__":
    unittest.main()
