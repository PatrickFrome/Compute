import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / "controller" / "r1" / "source_environment_approval_evidence.py"
spec = importlib.util.spec_from_file_location("r1_source_environment_approval_evidence", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def history(reviewer_id=22, state="approved", env="r1-recovery-source", comment="approved", login="reviewer-user"):
    return [{
        "state": state,
        "comment": comment,
        "environments": [{"id": 991, "name": env}],
        "user": {"id": reviewer_id, "login": login},
    }]


class SourceEnvironmentApprovalEvidenceTests(unittest.TestCase):
    def test_valid_approval_is_normalized_without_timestamp_claim(self):
        out = mod.build_approval_evidence(history(), 11)
        self.assertEqual(out["environment"], mod.ENVIRONMENT)
        self.assertEqual(out["approved_review_count"], 1)
        self.assertTrue(out["self_review_absent"])
        self.assertTrue(out["approval_event_observed"])
        self.assertFalse(out["approval_timestamp_claimed"])
        self.assertEqual(out["approvals"][0]["reviewer_user_id"], 22)
        self.assertEqual(out["approvals"][0]["comment_sha256"], hashlib.sha256(b"approved").hexdigest())
        self.assertFalse(out["r2_proven"])

    def test_self_approval_is_rejected_by_stable_actor_id(self):
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "self_approval"):
            mod.build_approval_evidence(history(reviewer_id=11), 11)

    def test_missing_approved_review_for_exact_environment_is_rejected(self):
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "approved_review_missing"):
            mod.build_approval_evidence(history(state="rejected"), 11)
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "approved_review_missing"):
            mod.build_approval_evidence(history(env="other"), 11)

    def test_multiple_approvals_are_sorted_and_deduplicated(self):
        h = history(reviewer_id=33, comment="b", login="r33") + history(reviewer_id=22, comment="a", login="r22") + history(reviewer_id=22, comment="a", login="r22")
        out = mod.build_approval_evidence(h, 11)
        self.assertEqual(out["approved_review_count"], 2)
        self.assertEqual([x["reviewer_user_id"] for x in out["approvals"]], [22, 33])

    def test_validation_rejects_forged_evidence_even_with_recomputed_hash(self):
        evidence = mod.build_approval_evidence(history(), 11)
        forged = copy.deepcopy(evidence)
        forged["approvals"][0]["reviewer_user_id"] = 44
        core = dict(forged)
        core.pop("approval_receipt_sha256", None)
        forged["approval_receipt_sha256"] = hashlib.sha256(json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "not_present_in_fresh_history"):
            mod.validate_approval_evidence(forged, history(), 11)

    def test_validation_rejects_recorded_review_missing_from_fresh_history(self):
        evidence = mod.build_approval_evidence(history(comment="one"), 11)
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "not_present_in_fresh_history"):
            mod.validate_approval_evidence(evidence, history(comment="two"), 11)

    def test_validation_allows_additional_non_self_approvals_in_fresh_history(self):
        evidence = mod.build_approval_evidence(history(reviewer_id=22, comment="first", login="r22"), 11)
        fresh = history(reviewer_id=22, comment="first", login="r22") + history(reviewer_id=33, comment="later", login="r33")
        validated = mod.validate_approval_evidence(evidence, fresh, 11)
        self.assertEqual(validated["approved_review_count"], 1)
        self.assertEqual(validated["approvals"][0]["reviewer_user_id"], 22)

    def test_validation_still_rejects_self_approval_added_later(self):
        evidence = mod.build_approval_evidence(history(reviewer_id=22), 11)
        fresh = history(reviewer_id=22) + history(reviewer_id=11, login="initiator")
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "self_approval"):
            mod.validate_approval_evidence(evidence, fresh, 11)

    def test_malformed_actor_or_user_ids_fail_closed(self):
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "initiator_actor_id"):
            mod.build_approval_evidence(history(), 0)
        bad = history()
        bad[0]["user"]["id"] = 0
        with self.assertRaisesRegex(mod.ApprovalEvidenceError, "approval_user_id"):
            mod.build_approval_evidence(bad, 11)


if __name__ == "__main__":
    unittest.main()
