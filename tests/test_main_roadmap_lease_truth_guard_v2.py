from __future__ import annotations

import copy
import unittest

from controller.roadmap import roadmap_lease_truth_guard_v2 as guard
from tests.test_main_roadmap_lease_truth_guard import snapshot, claim, directive, W1


def with_v2_alignment(value: dict) -> dict:
    value["alignment_status"]["lease_truth"] = {
        "version": 2,
        "observed_at": value["observed_at"],
        "fresh_active_claim_count": len(value["alignment_status"].get("active_claim_alignment", [])),
        "stale_persisted_active_claim_count": 0,
        "stale_persisted_active_claims": [],
        "cleanup_required": False,
        "stale_rows_authority_effect": False,
        "lease_fence_kind": "CLAIM_ID_MONOTONIC_SEQUENCER",
    }
    return value


class MainRoadmapLeaseTruthGuardV2Tests(unittest.TestCase):
    def test_no_claim_clean_state_passes(self):
        value = with_v2_alignment(snapshot())
        result = guard.evaluate(value)
        self.assertTrue(result["lease_truth_passed"])
        self.assertFalse(result["cleanup_required"])

    def test_expired_raw_claim_is_cleanup_debt_when_all_projections_exclude_it(self):
        value = with_v2_alignment(snapshot())
        value["active_claim_rows"] = [
            claim(
                heartbeat="2026-08-25T20:00:00.637797+00:00",
                expires="2026-08-25T23:00:00.637797+00:00",
            )
        ]
        value["alignment_status"]["lease_truth"].update({
            "stale_persisted_active_claim_count": 1,
            "cleanup_required": True,
        })
        result = guard.evaluate(value)
        self.assertTrue(result["lease_truth_passed"])
        self.assertTrue(result["cleanup_required"])
        self.assertEqual([], result["evidence"]["failed_checks"])

    def test_stale_claim_reference_in_alignment_blocks(self):
        value = with_v2_alignment(snapshot())
        value["active_claim_rows"] = [
            claim(
                heartbeat="2026-08-25T20:00:00.637797+00:00",
                expires="2026-08-25T23:00:00.637797+00:00",
            )
        ]
        value["alignment_status"]["active_claim_alignment"] = [{"claim_id": 32, "milestone_key": W1}]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("alignment_claim_projection_exact", result["evidence"]["failed_checks"])
        self.assertIn("alignment_does_not_reference_stale_claim", result["evidence"]["failed_checks"])

    def test_stale_directive_is_cleanup_debt_when_supervisor_excludes_it(self):
        value = with_v2_alignment(snapshot())
        value["active_directive_rows"] = [
            directive(
                directive_id=25,
                milestone="F1_LIVE_EXTERNAL_FEDERATION",
                expires="2026-08-23T16:35:24.506642+00:00",
            )
        ]
        result = guard.evaluate(value)
        self.assertTrue(result["lease_truth_passed"])
        self.assertTrue(result["cleanup_required"])

    def test_stale_directive_reference_in_supervisor_blocks(self):
        value = with_v2_alignment(snapshot())
        value["active_directive_rows"] = [
            directive(
                directive_id=25,
                milestone="F1_LIVE_EXTERNAL_FEDERATION",
                expires="2026-08-23T16:35:24.506642+00:00",
            )
        ]
        value["supervisor_snapshot"]["directives"] = [{"directive_id": 25}]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("supervisor_active_directive_projection_exact", result["evidence"]["failed_checks"])
        self.assertIn("supervisor_does_not_reference_stale_directive", result["evidence"]["failed_checks"])

    def test_fresh_claim_must_be_present_in_both_authoritative_projections(self):
        value = with_v2_alignment(snapshot())
        value["active_claim_rows"] = [claim()]
        value["alignment_status"]["active_claim_alignment"] = [{"claim_id": 32, "milestone_key": W1}]
        value["supervisor_snapshot"]["active_claims"] = [{"claim_id": 32}]
        value["alignment_status"]["lease_truth"]["fresh_active_claim_count"] = 1
        result = guard.evaluate(value)
        self.assertTrue(result["lease_truth_passed"])

    def test_fresh_directive_must_be_present_in_supervisor_projection(self):
        value = with_v2_alignment(snapshot())
        value["active_directive_rows"] = [directive()]
        value["supervisor_snapshot"]["directives"] = [{"directive_id": 29}]
        result = guard.evaluate(value)
        self.assertTrue(result["lease_truth_passed"])

    def test_missing_alignment_v2_contract_blocks(self):
        value = snapshot()
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("alignment_lease_truth_v2", result["evidence"]["failed_checks"])

    def test_duplicate_fresh_selected_claims_still_block(self):
        value = with_v2_alignment(snapshot())
        value["active_claim_rows"] = [claim(claim_id=32), claim(claim_id=33)]
        value["alignment_status"]["active_claim_alignment"] = [{"claim_id": 32}, {"claim_id": 33}]
        value["supervisor_snapshot"]["active_claims"] = [{"claim_id": 32}, {"claim_id": 33}]
        result = guard.evaluate(value)
        self.assertFalse(result["lease_truth_passed"])
        self.assertIn("selected_active_claim_unique", result["evidence"]["failed_checks"])

    def test_receipt_is_deterministic_and_non_authoritative(self):
        value = with_v2_alignment(snapshot())
        left = guard.evaluate(value)
        right = guard.evaluate(copy.deepcopy(value))
        self.assertEqual(left["evidence_sha256"], right["evidence_sha256"])
        self.assertFalse(left["canonical"])
        self.assertFalse(left["authority_effect"])
        self.assertFalse(left["database_mutation_authorized"])
        self.assertFalse(left["provider_mutation_authorized"])
        self.assertFalse(left["edge_deployment_authorized"])
        self.assertFalse(left["pr_merge_authorized"])
        self.assertFalse(left["checkpoint_promotion_authorized"])


if __name__ == "__main__":
    unittest.main()
