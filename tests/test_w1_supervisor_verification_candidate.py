from __future__ import annotations

import copy
import unittest

from controller.w1 import github_codespaces_lifecycle_provenance as provenance
from controller.w1 import w1_attestation_verification_receipt as attestation
from controller.w1 import w1_supervisor_verification_candidate as supervisor
from controller.w1 import w1_verification_candidate as offline


MANIFEST_ID = "11111111-1111-4111-8111-111111111111"
LIFECYCLE_ID = "22222222-2222-4222-8222-222222222222"
PROVENANCE_ID = "33333333-3333-4333-8333-333333333333"
STORAGE_ID = "44444444-4444-4444-8444-444444444444"
PROVIDER_SHA = "1" * 64
STOPPED_SHA = "2" * 64
SOURCE = {"git_sha": "3" * 40, "tree_sha": "4" * 40}
BASE_CP = "metaengine-h205f22-recovery-dev-20260821-cp072"


def offline_candidate() -> dict:
    evidence = {
        "pre_persistence_manifest_id": MANIFEST_ID,
        "lifecycle_receipt_id": LIFECYCLE_ID,
        "worker_id": "w1-worker",
        "base_checkpoint_id": BASE_CP,
        "manifest_sha256": "5" * 64,
        "storage_receipt_sha256": "6" * 64,
        "lifecycle_bundle_sha256": "7" * 64,
        "provider_oracle_sha256": PROVIDER_SHA,
        "stopped_snapshot_sha256": STOPPED_SHA,
        "persistent_root": "/workspaces",
        "sentinel_path_sha256": "8" * 64,
        "source": copy.deepcopy(SOURCE),
        "checks": {"all_cross_bound": True},
    }
    return {
        "schema": offline.SCHEMA,
        "status": offline.STATUS,
        "evidence": evidence,
        "candidate_sha256": offline.canonical_hash(evidence),
        "ready_for_authenticated_provider_provenance": True,
        "authenticated_provider_provenance_verified": False,
        "provider_action_verified": False,
        "provider_storage_contract_verified": False,
        "supervisor_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "next_required": [],
    }


def attestation_receipt() -> dict:
    evidence = {
        "repository": attestation.EXPECTED_REPOSITORY,
        "workflow_path": attestation.EXPECTED_WORKFLOW_PATH,
        "source_git_sha": SOURCE["git_sha"],
        "source_tree_sha": SOURCE["tree_sha"],
        "source_ref": "refs/heads/work/w1-sandbox-launcher-prep",
        "manifest_evidence_sha256": "9" * 64,
        "manifest_subject_sha256": "a" * 64,
        "predicate_type": attestation.PREDICATE,
        "oidc_issuer": attestation.OIDC_ISSUER,
        "runner_environment": "github-hosted",
        "rekor_uri": attestation.REKOR_URI,
        "rekor_timestamp": "2026-08-26T07:05:38Z",
        "verified_timestamp_count": 1,
        "immutable_certificate_checks": {"all": True},
    }
    return {
        "schema": attestation.SCHEMA,
        "status": attestation.STATUS,
        "evidence": evidence,
        "receipt_sha256": attestation.canonical_hash(evidence),
        "artifact_attestation_verified": True,
        "cryptographic_source_provenance_verified": True,
        "runtime_safety_verified": False,
        "provider_lifecycle_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "next_required": [],
    }


def provenance_receipt() -> dict:
    evidence = {
        "api_base": "https://api.github.com",
        "api_version": "2026-03-10",
        "provider_oracle_sha256": PROVIDER_SHA,
        "stopped_snapshot_sha256": STOPPED_SHA,
    }
    return {
        "schema": provenance.SCHEMA,
        "mode": "EXECUTE",
        "outcome": "CAPTURED_NONAUTHORITY",
        "evidence": evidence,
        "receipt_sha256": provenance.canonical_hash(evidence),
        "api_authentication_observed": True,
        "provider_identity_verified": False,
        "provider_action_verified": False,
        "authenticated_provider_provenance_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_supabase_persisted_readback": True,
        "requires_supervisor_verification": True,
    }


def provenance_readback() -> dict:
    p = provenance_receipt()
    return {
        "schema": supervisor.PROVENANCE_READBACK_SCHEMA,
        "provenance_receipt_id": PROVENANCE_ID,
        "storage_receipt_id": STORAGE_ID,
        "pre_persistence_manifest_id": MANIFEST_ID,
        "lifecycle_receipt_id": LIFECYCLE_ID,
        "worker_id": "w1-worker",
        "base_checkpoint_id": BASE_CP,
        "receipt_sha256": p["receipt_sha256"],
        "recomputed_receipt_sha256": p["receipt_sha256"],
        "recomputed_provider_oracle_sha256": PROVIDER_SHA,
        "persisted_readback_match": True,
        "verification_status": "PENDING_PROVIDER_PROVENANCE_READBACK",
        "api_authentication_observed": True,
        "provider_identity_verified": False,
        "provider_action_verified": False,
        "authenticated_provider_provenance_verified": False,
        "persisted_readback_verified": False,
        "provider_storage_contract_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def compose(**overrides):
    args = {
        "verification_candidate": offline_candidate(),
        "provenance_receipt": provenance_receipt(),
        "provenance_readback": provenance_readback(),
        "attestation_receipt": attestation_receipt(),
    }
    args.update(overrides)
    return supervisor.compose(**args)


class W1SupervisorVerificationCandidateTests(unittest.TestCase):
    def test_valid_graph_stops_at_supervisor(self):
        result = compose()
        self.assertEqual(result["status"], supervisor.STATUS)
        self.assertTrue(result["ready_for_fresh_supervisor_verification"])
        self.assertTrue(result["cryptographic_source_provenance_verified"])
        self.assertFalse(result["supervisor_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["w1_verified"])
        self.assertEqual(result["next_required"], ["fresh_supervisor_w1_verification_under_current_authority"])
        self.assertRegex(result["candidate_sha256"], r"^[0-9a-f]{64}$")

    def test_offline_candidate_hash_tamper_is_rejected(self):
        c = offline_candidate()
        c["evidence"]["worker_id"] = "tampered"
        with self.assertRaisesRegex(ValueError, "candidate hash mismatch"):
            compose(verification_candidate=c)

    def test_attestation_receipt_hash_tamper_is_rejected(self):
        a = attestation_receipt()
        a["evidence"]["runner_environment"] = "self-hosted"
        with self.assertRaisesRegex(ValueError, "attestation receipt hash mismatch"):
            compose(attestation_receipt=a)

    def test_attestation_source_git_rebind_is_rejected(self):
        a = attestation_receipt()
        a["evidence"]["source_git_sha"] = "b" * 40
        a["receipt_sha256"] = attestation.canonical_hash(a["evidence"])
        with self.assertRaisesRegex(ValueError, "source git SHA"):
            compose(attestation_receipt=a)

    def test_attestation_source_tree_rebind_is_rejected(self):
        a = attestation_receipt()
        a["evidence"]["source_tree_sha"] = "c" * 40
        a["receipt_sha256"] = attestation.canonical_hash(a["evidence"])
        with self.assertRaisesRegex(ValueError, "source tree SHA"):
            compose(attestation_receipt=a)

    def test_premature_w1_claim_in_attestation_is_rejected(self):
        a = attestation_receipt()
        a["w1_verified"] = True
        with self.assertRaisesRegex(ValueError, "w1_verified must be false"):
            compose(attestation_receipt=a)

    def test_provenance_receipt_hash_tamper_is_rejected(self):
        p = provenance_receipt()
        p["evidence"]["api_version"] = "2022-11-28"
        with self.assertRaisesRegex(ValueError, "receipt hash mismatch"):
            compose(provenance_receipt=p)

    def test_provider_oracle_cross_binding_is_required(self):
        p = provenance_receipt()
        p["evidence"]["provider_oracle_sha256"] = "9" * 64
        p["receipt_sha256"] = provenance.canonical_hash(p["evidence"])
        rb = provenance_readback()
        rb["receipt_sha256"] = p["receipt_sha256"]
        rb["recomputed_receipt_sha256"] = p["receipt_sha256"]
        with self.assertRaisesRegex(ValueError, "provider oracle hash"):
            compose(provenance_receipt=p, provenance_readback=rb)

    def test_shutdown_snapshot_cross_binding_is_required(self):
        p = provenance_receipt()
        p["evidence"]["stopped_snapshot_sha256"] = "a" * 64
        p["receipt_sha256"] = provenance.canonical_hash(p["evidence"])
        rb = provenance_readback()
        rb["receipt_sha256"] = p["receipt_sha256"]
        rb["recomputed_receipt_sha256"] = p["receipt_sha256"]
        with self.assertRaisesRegex(ValueError, "stopped snapshot hash"):
            compose(provenance_receipt=p, provenance_readback=rb)

    def test_provenance_readback_mismatch_is_rejected(self):
        rb = provenance_readback()
        rb["persisted_readback_match"] = False
        with self.assertRaisesRegex(ValueError, "persisted readback mismatch"):
            compose(provenance_readback=rb)

    def test_manifest_id_rebind_is_rejected(self):
        rb = provenance_readback()
        rb["pre_persistence_manifest_id"] = "55555555-5555-4555-8555-555555555555"
        with self.assertRaisesRegex(ValueError, "pre_persistence_manifest_id mismatch"):
            compose(provenance_readback=rb)

    def test_worker_rebind_is_rejected(self):
        rb = provenance_readback()
        rb["worker_id"] = "other-worker"
        with self.assertRaisesRegex(ValueError, "worker_id mismatch"):
            compose(provenance_readback=rb)

    def test_api_version_rebind_is_rejected(self):
        p = provenance_receipt()
        p["evidence"]["api_version"] = "2022-11-28"
        p["receipt_sha256"] = provenance.canonical_hash(p["evidence"])
        rb = provenance_readback()
        rb["receipt_sha256"] = p["receipt_sha256"]
        rb["recomputed_receipt_sha256"] = p["receipt_sha256"]
        with self.assertRaisesRegex(ValueError, "API contract mismatch"):
            compose(provenance_receipt=p, provenance_readback=rb)

    def test_premature_true_claim_is_rejected(self):
        rb = provenance_readback()
        rb["provider_action_verified"] = True
        with self.assertRaisesRegex(ValueError, "provider_action_verified must be false"):
            compose(provenance_readback=rb)


if __name__ == "__main__":
    unittest.main()
