from __future__ import annotations

import copy
import unittest

from controller.w1 import codespaces_persistent_storage_guard
from controller.w1 import pre_persistence_evidence_manifest
from controller.w1 import w1_verification_candidate as candidate


MANIFEST_ID = "11111111-1111-4111-8111-111111111111"
LIFECYCLE_ID = "22222222-2222-4222-8222-222222222222"
SOURCE = {"git_sha": "1" * 40, "tree_sha": "2" * 40}
PROVIDER_SHA = "3" * 64
STOPPED_SHA = "4" * 64
SENTINEL_SHA = "5" * 64
PATH_SHA = "6" * 64
PRE_BOOT = "33333333-3333-4333-8333-333333333333"
POST_BOOT = "44444444-4444-4444-8444-444444444444"


def lifecycle_bundle() -> dict:
    return {
        "schema": "metaengine.compute.w1-lifecycle-evidence-harness.h205f22.v1",
        "outcome": "W1_LIFECYCLE_EVIDENCE_COMPOSED_NONAUTHORITY",
        "evidence": {
            "provider": {
                "oracle_sha256": PROVIDER_SHA,
                "evidence": {"stopped_snapshot_sha256": STOPPED_SHA},
            },
            "lifecycle": {
                "evidence": {
                    "pre_boot_id": PRE_BOOT,
                    "post_boot_id": POST_BOOT,
                    "sentinel_sha256": SENTINEL_SHA,
                }
            },
        },
    }


def manifest() -> dict:
    bindings = {
        "source": copy.deepcopy(SOURCE),
        "lifecycle_bundle_sha256": pre_persistence_evidence_manifest.canonical_hash(lifecycle_bundle()),
    }
    return {
        "schema": pre_persistence_evidence_manifest.SCHEMA,
        "status": pre_persistence_evidence_manifest.STATUS,
        "bindings": bindings,
        "manifest_sha256": pre_persistence_evidence_manifest.canonical_hash(bindings),
        "authenticated_provenance_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def manifest_readback() -> dict:
    m = manifest()
    return {
        "schema": candidate.MANIFEST_READBACK_SCHEMA,
        "pre_persistence_manifest_id": MANIFEST_ID,
        "worker_id": "w1-codespace-worker",
        "lifecycle_receipt_id": LIFECYCLE_ID,
        "claim_id": 40,
        "directive_id": 41,
        "base_checkpoint_id": "metaengine-h205f22-recovery-dev-20260821-cp072",
        "manifest_sha256": m["manifest_sha256"],
        "recomputed_lifecycle_bundle_sha256": pre_persistence_evidence_manifest.canonical_hash(lifecycle_bundle()),
        "recomputed_outer_cgroup_witness_sha256": "7" * 64,
        "recomputed_manifest_sha256": m["manifest_sha256"],
        "persisted_readback_match": True,
        "verification_status": "PENDING_PERSISTED_READBACK",
        "authenticated_provenance_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def storage_receipt() -> dict:
    evidence = {
        "provider_kind": "GITHUB_CODESPACES",
        "provider_object_id": "49833829",
        "provider_object_name": "psychic-goggles-p79456q477c6wvq",
        "persistent_root": "/workspaces",
        "sentinel_path": "/workspaces/.metaengine-w1/persistent-sentinel.bin",
        "sentinel_path_sha256": PATH_SHA,
        "sentinel_sha256": SENTINEL_SHA,
        "source": copy.deepcopy(SOURCE),
        "pre_boot_id": PRE_BOOT,
        "post_boot_id": POST_BOOT,
        "pre_storage_capture_sha256": "8" * 64,
        "post_storage_capture_sha256": "9" * 64,
        "provider_oracle_sha256": PROVIDER_SHA,
        "stopped_snapshot_sha256": STOPPED_SHA,
        "checks": {
            "persistent_root_is_workspaces": True,
            "sentinel_path_stable": True,
            "sentinel_path_hash_stable": True,
            "sentinel_content_stable": True,
            "source_identity_stable": True,
            "kernel_boot_id_changed": True,
            "provider_sequence_eligible": True,
        },
    }
    return {
        "schema": codespaces_persistent_storage_guard.RECEIPT_SCHEMA,
        "outcome": "CODESPACES_PERSISTENT_STORAGE_BOUND_NONAUTHORITY",
        "evidence": evidence,
        "receipt_sha256": codespaces_persistent_storage_guard.canonical_hash(evidence),
        "provider_storage_contract_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_authenticated_github_provenance": True,
        "requires_persisted_db_composition": True,
    }


def storage_readback() -> dict:
    s = storage_receipt()
    return {
        "schema": candidate.STORAGE_READBACK_SCHEMA,
        "storage_receipt_id": "55555555-5555-4555-8555-555555555555",
        "pre_persistence_manifest_id": MANIFEST_ID,
        "worker_id": "w1-codespace-worker",
        "lifecycle_receipt_id": LIFECYCLE_ID,
        "base_checkpoint_id": "metaengine-h205f22-recovery-dev-20260821-cp072",
        "receipt_sha256": s["receipt_sha256"],
        "recomputed_receipt_sha256": s["receipt_sha256"],
        "recomputed_sentinel_path_sha256": PATH_SHA,
        "persisted_readback_match": True,
        "verification_status": "PENDING_STORAGE_PROVENANCE_READBACK",
        "provider_storage_contract_verified": False,
        "authenticated_github_provenance_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def compose() -> dict:
    return candidate.compose(
        pre_persistence_manifest=manifest(),
        manifest_readback=manifest_readback(),
        storage_receipt=storage_receipt(),
        storage_readback=storage_readback(),
        lifecycle_bundle=lifecycle_bundle(),
    )


class W1VerificationCandidateTests(unittest.TestCase):
    def test_valid_inputs_stop_at_authenticated_provider_provenance(self):
        result = compose()
        self.assertEqual(result["status"], candidate.STATUS)
        self.assertTrue(result["ready_for_authenticated_provider_provenance"])
        self.assertFalse(result["authenticated_provider_provenance_verified"])
        self.assertFalse(result["provider_action_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["w1_verified"])
        self.assertIn("authenticated_github_stop_action_receipt", result["next_required"])
        self.assertRegex(result["candidate_sha256"], r"^[0-9a-f]{64}$")

    def test_manifest_hash_tamper_is_rejected(self):
        m = manifest()
        m["bindings"]["source"]["git_sha"] = "a" * 40
        with self.assertRaisesRegex(ValueError, "manifest hash mismatch"):
            candidate.compose(
                pre_persistence_manifest=m,
                manifest_readback=manifest_readback(),
                storage_receipt=storage_receipt(),
                storage_readback=storage_readback(),
                lifecycle_bundle=lifecycle_bundle(),
            )

    def test_manifest_readback_false_is_rejected(self):
        rb = manifest_readback()
        rb["persisted_readback_match"] = False
        with self.assertRaisesRegex(ValueError, "manifest persisted readback mismatch"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=rb, storage_receipt=storage_receipt(), storage_readback=storage_readback(), lifecycle_bundle=lifecycle_bundle())

    def test_storage_readback_false_is_rejected(self):
        rb = storage_readback()
        rb["persisted_readback_match"] = False
        with self.assertRaisesRegex(ValueError, "storage persisted readback mismatch"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=storage_receipt(), storage_readback=rb, lifecycle_bundle=lifecycle_bundle())

    def test_storage_receipt_tamper_is_rejected(self):
        s = storage_receipt()
        s["evidence"]["sentinel_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "storage receipt hash mismatch"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=s, storage_readback=storage_readback(), lifecycle_bundle=lifecycle_bundle())

    def test_lifecycle_bundle_rebind_is_rejected(self):
        lb = lifecycle_bundle()
        lb["evidence"]["lifecycle"]["evidence"]["pre_boot_id"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        with self.assertRaisesRegex(ValueError, "does not match persisted manifest readback"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=storage_receipt(), storage_readback=storage_readback(), lifecycle_bundle=lb)

    def test_provider_oracle_hash_cross_binding_is_required(self):
        s = storage_receipt()
        s["evidence"]["provider_oracle_sha256"] = "b" * 64
        s["receipt_sha256"] = codespaces_persistent_storage_guard.canonical_hash(s["evidence"])
        rb = storage_readback()
        rb["receipt_sha256"] = s["receipt_sha256"]
        rb["recomputed_receipt_sha256"] = s["receipt_sha256"]
        with self.assertRaisesRegex(ValueError, "storage/provider oracle hash mismatch"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=s, storage_readback=rb, lifecycle_bundle=lifecycle_bundle())

    def test_raw_shutdown_hash_cross_binding_is_required(self):
        s = storage_receipt()
        s["evidence"]["stopped_snapshot_sha256"] = "c" * 64
        s["receipt_sha256"] = codespaces_persistent_storage_guard.canonical_hash(s["evidence"])
        rb = storage_readback()
        rb["receipt_sha256"] = s["receipt_sha256"]
        rb["recomputed_receipt_sha256"] = s["receipt_sha256"]
        with self.assertRaisesRegex(ValueError, "storage stopped snapshot hash mismatch"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=s, storage_readback=rb, lifecycle_bundle=lifecycle_bundle())

    def test_storage_boot_cross_binding_is_required(self):
        s = storage_receipt()
        s["evidence"]["pre_boot_id"] = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        s["receipt_sha256"] = codespaces_persistent_storage_guard.canonical_hash(s["evidence"])
        rb = storage_readback()
        rb["receipt_sha256"] = s["receipt_sha256"]
        rb["recomputed_receipt_sha256"] = s["receipt_sha256"]
        with self.assertRaisesRegex(ValueError, "storage/lifecycle pre_boot_id mismatch"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=s, storage_readback=rb, lifecycle_bundle=lifecycle_bundle())

    def test_storage_manifest_id_mismatch_is_rejected(self):
        rb = storage_readback()
        rb["pre_persistence_manifest_id"] = "66666666-6666-4666-8666-666666666666"
        with self.assertRaisesRegex(ValueError, "manifest id mismatch"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=storage_receipt(), storage_readback=rb, lifecycle_bundle=lifecycle_bundle())

    def test_any_w1_true_claim_is_rejected(self):
        rb = storage_readback()
        rb["w1_verified"] = True
        with self.assertRaisesRegex(ValueError, "w1_verified must be false"):
            candidate.compose(pre_persistence_manifest=manifest(), manifest_readback=manifest_readback(), storage_receipt=storage_receipt(), storage_readback=rb, lifecycle_bundle=lifecycle_bundle())


if __name__ == "__main__":
    unittest.main()
