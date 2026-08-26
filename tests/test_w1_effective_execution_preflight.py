from __future__ import annotations

import copy
import unittest

from controller.w1 import effective_execution_preflight as preflight


ROOT_SHA = "14ef848e935dd12a6b3ada23f7fed6016788fcbaf2856c1490fd4e45caeed140"
CHECKPOINT = "metaengine-h205f22-recovery-dev-20260821-cp072"


def fresh_snapshot() -> dict:
    return {
        "db_now": "2026-08-26T18:00:00Z",
        "semantic_head": {
            "checkpoint_id": CHECKPOINT,
            "payload_root_sha256": ROOT_SHA,
        },
        "roadmap": {
            "definition_integrity": True,
            "canonical_integrity": True,
            "w1_effective_status": "READY",
        },
        "claim": {
            "claim_id": 33,
            "roadmap_id": preflight.ROADMAP_ID,
            "milestone_key": preflight.MILESTONE_KEY,
            "holder_id": preflight.HOLDER_ID,
            "state": "ACTIVE",
            "expires_at": "2026-08-26T19:00:00Z",
            "base_checkpoint_id": CHECKPOINT,
            "base_payload_root_sha256": ROOT_SHA,
        },
        "directive": {
            "directive_id": 30,
            "roadmap_id": preflight.ROADMAP_ID,
            "milestone_key": preflight.MILESTONE_KEY,
            "directive_kind": "REASSIGN",
            "target_holder_id": preflight.HOLDER_ID,
            "status": "ACTIVE",
            "expires_at": "2026-08-26T18:59:00Z",
            "superseded_at": None,
            "base_checkpoint_id": CHECKPOINT,
        },
    }


class W1EffectiveExecutionPreflightTests(unittest.TestCase):
    def test_fresh_aligned_snapshot_passes_but_does_not_authorize_mutation(self):
        result = preflight.evaluate(fresh_snapshot())
        self.assertEqual(result["outcome"], "PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY")
        self.assertTrue(result["effective_execution_preflight_passed"])
        self.assertTrue(all(result["evidence"]["checks"].values()))
        self.assertFalse(result["provider_mutation_authorized"])
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["w1_verified"])

    def test_active_label_with_expired_claim_is_blocked(self):
        snap = fresh_snapshot()
        snap["claim"]["expires_at"] = "2026-08-25T23:00:00Z"
        result = preflight.evaluate(snap)
        self.assertFalse(result["effective_execution_preflight_passed"])
        self.assertIn("claim_not_expired", result["evidence"]["failed_checks"])

    def test_active_label_with_expired_directive_is_blocked(self):
        snap = fresh_snapshot()
        snap["directive"]["expires_at"] = "2026-08-25T22:59:47Z"
        result = preflight.evaluate(snap)
        self.assertFalse(result["effective_execution_preflight_passed"])
        self.assertIn("directive_not_expired", result["evidence"]["failed_checks"])

    def test_current_live_contradiction_shape_is_blocked(self):
        snap = fresh_snapshot()
        snap["claim"]["claim_id"] = 32
        snap["claim"]["expires_at"] = "2026-08-25T23:00:00.637797Z"
        snap["directive"]["directive_id"] = 29
        snap["directive"]["expires_at"] = "2026-08-25T22:59:47.410995Z"
        result = preflight.evaluate(snap)
        self.assertEqual(result["outcome"], "BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY")
        self.assertEqual(
            {"claim_not_expired", "directive_not_expired"},
            set(result["evidence"]["failed_checks"]),
        )

    def test_holder_mismatch_is_blocked(self):
        snap = fresh_snapshot()
        snap["claim"]["holder_id"] = "someone-else"
        result = preflight.evaluate(snap)
        self.assertIn("claim_holder_exact", result["evidence"]["failed_checks"])

    def test_directive_target_mismatch_is_blocked(self):
        snap = fresh_snapshot()
        snap["directive"]["target_holder_id"] = "someone-else"
        result = preflight.evaluate(snap)
        self.assertIn("directive_target_holder_exact", result["evidence"]["failed_checks"])

    def test_checkpoint_and_payload_root_drift_are_blocked(self):
        snap = fresh_snapshot()
        snap["claim"]["base_checkpoint_id"] = "stale-checkpoint"
        snap["claim"]["base_payload_root_sha256"] = "0" * 64
        snap["directive"]["base_checkpoint_id"] = "stale-checkpoint"
        result = preflight.evaluate(snap)
        failed = set(result["evidence"]["failed_checks"])
        self.assertIn("claim_checkpoint_matches_head", failed)
        self.assertIn("claim_payload_root_matches_head", failed)
        self.assertIn("directive_checkpoint_matches_head", failed)

    def test_integrity_failure_is_blocked(self):
        snap = fresh_snapshot()
        snap["roadmap"]["definition_integrity"] = False
        snap["roadmap"]["canonical_integrity"] = False
        result = preflight.evaluate(snap)
        failed = set(result["evidence"]["failed_checks"])
        self.assertIn("definition_integrity", failed)
        self.assertIn("canonical_integrity", failed)

    def test_superseded_directive_is_blocked(self):
        snap = fresh_snapshot()
        snap["directive"]["superseded_at"] = "2026-08-26T17:30:00Z"
        result = preflight.evaluate(snap)
        self.assertIn("directive_not_superseded", result["evidence"]["failed_checks"])

    def test_blocked_roadmap_state_is_blocked(self):
        snap = fresh_snapshot()
        snap["roadmap"]["w1_effective_status"] = "BLOCKED"
        result = preflight.evaluate(snap)
        self.assertIn("roadmap_state_allows_w1_execution", result["evidence"]["failed_checks"])

    def test_naive_timestamp_fails_closed(self):
        snap = fresh_snapshot()
        snap["db_now"] = "2026-08-26T18:00:00"
        result = preflight.evaluate(snap)
        self.assertEqual(result["outcome"], "BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY")
        self.assertFalse(result["evidence"]["checks"]["input_valid"])

    def test_receipt_hash_is_deterministic(self):
        left = preflight.evaluate(fresh_snapshot())
        right = preflight.evaluate(copy.deepcopy(fresh_snapshot()))
        self.assertEqual(left["evidence_sha256"], right["evidence_sha256"])


if __name__ == "__main__":
    unittest.main()
