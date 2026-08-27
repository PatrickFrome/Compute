from __future__ import annotations

import copy
import unittest

from controller.roadmap import roadmap_lease_truth_guard as guard


OBSERVED = "2026-08-27T20:01:57.264166+00:00"
W1 = "W1_PERSISTENT_LINUX_WORKER_SAFETY"


def snapshot() -> dict:
    return {
        "schema": guard.SNAPSHOT_SCHEMA,
        "observed_at": OBSERVED,
        "roadmap_id": guard.ROADMAP_ID,
        "roadmap_status": {
            "next_mainline": {
                "milestone_key": W1,
                "effective_status": "READY",
            }
        },
        "alignment_status": {
            "active_claim_alignment": [],
        },
        "supervisor_snapshot": {
            "active_claims": [],
        },
        "level2_mapping": [
            {
                "milestone_key": W1,
                "canonical_milestone_key": "C1",
                "mapping_kind": "PRIMARY",
            },
            {
                "milestone_key": "R1_CONTINUITY_PLANE_ADOPTION",
                "canonical_milestone_key": "R1",
                "mapping_kind": "PRIMARY",
            },
        ],
        "active_claim_rows": [],
        "active_directive_rows": [],
    }


def claim(*, claim_id: int = 32, heartbeat: str = "2026-08-27T19:59:00+00:00", expires: str = "2026-08-27T21:00:00+00:00") -> dict:
    return {
        "claim_id": claim_id,
        "milestone_key": W1,
        "holder_id": "aop1:W1_IMPLEMENTER",
        "state": "ACTIVE",
        "heartbeat_at": heartbeat,
        "expires_at": expires,
    }


def directive(*, directive_id: int = 29, expires: str | None = "2026-08-27T21:00:00+00:00", milestone: str = W1) -> dict:
    return {
        "directive_id": directive_id,
        "milestone_key": milestone,
        "directive_kind": "REASSIGN",
        "target_holder_id": "aop1:W1_IMPLEMENTER",
        "status": "ACTIVE",
        "created_at": "2026-08-27T19:55:00+00:00",
        "expires_at": expires,
    }


class MainRoadmapLeaseTruthGuardTests(unittest.TestCase):
    def test_plan_without_claim_uses_durable_level1_mapping(self):
        result = guard.evaluate(snapshot())
        self.assertTrue(result["lease_truth_passed"])
        self.assertEqual(result["evidence"]["selected"]["canonical_milestone_key"], "C1")
        self.assertEqual(result["evidence"]["selected"]["mapping_kind"], "PRIMARY")
        self.assertEqual(result["evidence"]["leases"]["fresh_claims"], [])

    def test_fresh_claim_requires_exact_supervisor_projection(self):
        value = snapshot()
        value["active_claim_rows"] = [claim()]
        value["supervisor_snapshot"]["active_claims"] = [{"claim_id": 32}]
        result = guard.evaluate(value)
        self.assertTrue(result["lease_truth_passed"])
        self.assertEqual([32], result["evidence"]["projections"]["fresh_raw_claim_ids"])

    def test_fresh_directive_passes(self):
        value = snapshot()
        value["active_directive_rows"] = [directive()]
        result = guard.evaluate(value)
        self.assertTrue(result["lease_truth_passed"])

    def test_expired_active_claim_blocks(self):
        value = snapshot()
        value["active_claim_rows"] = [
            claim(heartbeat="2026-08-25T20:00:00.637797+00:00", expires="2026-08-25T23:00:00.637797+00:00")
        ]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("no_stale_active_claims", result["evidence"]["failed_checks"])
        self.assertIsNone(result["checkpoint_payload"])

    def test_current_live_stale_claim_alignment_is_explicitly_rejected(self):
        value = snapshot()
        value["active_claim_rows"] = [
            claim(heartbeat="2026-08-25T20:00:00.637797+00:00", expires="2026-08-25T23:00:00.637797+00:00")
        ]
        value["alignment_status"]["active_claim_alignment"] = [{"claim_id": 32, "milestone_key": W1}]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("alignment_does_not_reference_stale_claim", result["evidence"]["failed_checks"])

    def test_expired_global_directive_blocks_even_on_other_lane(self):
        value = snapshot()
        value["active_directive_rows"] = [
            directive(
                directive_id=25,
                milestone="F1_LIVE_EXTERNAL_FEDERATION",
                expires="2026-08-23T16:35:24.506642+00:00",
            )
        ]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("no_stale_active_directives", result["evidence"]["failed_checks"])

    def test_reassign_without_expiry_blocks(self):
        value = snapshot()
        value["active_directive_rows"] = [directive(expires=None)]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("no_stale_active_directives", result["evidence"]["failed_checks"])

    def test_duplicate_fresh_selected_claims_block(self):
        value = snapshot()
        value["active_claim_rows"] = [claim(claim_id=32), claim(claim_id=33)]
        value["supervisor_snapshot"]["active_claims"] = [{"claim_id": 32}, {"claim_id": 33}]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("selected_active_claim_unique", result["evidence"]["failed_checks"])

    def test_supervisor_projection_mismatch_blocks(self):
        value = snapshot()
        value["active_claim_rows"] = [claim()]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("supervisor_active_claim_projection_exact", result["evidence"]["failed_checks"])

    def test_missing_durable_mapping_fails_closed(self):
        value = snapshot()
        value["level2_mapping"] = []
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("selected_durable_mapping_not_unique", result["evidence"]["error"])

    def test_naive_observation_time_fails_closed(self):
        value = snapshot()
        value["observed_at"] = "2026-08-27T20:01:57"
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("observed_at_timezone_required", result["evidence"]["error"])

    def test_future_heartbeat_is_stale(self):
        value = snapshot()
        value["active_claim_rows"] = [
            claim(heartbeat="2026-08-27T20:30:00+00:00", expires="2026-08-27T21:00:00+00:00")
        ]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("no_stale_active_claims", result["evidence"]["failed_checks"])

    def test_receipt_is_deterministic_and_non_authoritative(self):
        left = guard.evaluate(snapshot())
        right = guard.evaluate(copy.deepcopy(snapshot()))
        self.assertEqual(left["evidence_sha256"], right["evidence_sha256"])
        self.assertEqual(64, len(left["evidence_sha256"]))
        self.assertFalse(left["canonical"])
        self.assertFalse(left["authority_effect"])
        self.assertFalse(left["database_mutation_authorized"])
        self.assertFalse(left["provider_mutation_authorized"])
        self.assertFalse(left["edge_deployment_authorized"])
        self.assertFalse(left["pr_merge_authorized"])
        self.assertFalse(left["checkpoint_promotion_authorized"])
        self.assertFalse(any(left["checkpoint_payload"]["boundaries"].values()))


if __name__ == "__main__":
    unittest.main()
