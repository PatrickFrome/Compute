import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "coordination" / "sync" / "peer_review_barrier.py"
spec = importlib.util.spec_from_file_location("peer_review_barrier", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

TASK_RESULT = {
    "schema": "metaengine.compute.sync-task-result.h205f22.v1",
    "task_id": "SYNC-L4.7-001",
    "task_result_sha256": "a" * 64,
    "task_sha256": "b" * 64,
    "sync_epoch_sha256": "c" * 64,
    "authority": {
        "authority_effect": False,
        "canonical": False,
        "execution_authority": False,
        "project_claim_authority": False,
    },
}


def review(reviewer: str, *, disposition: str = "ACCEPT", findings=None):
    return {
        "schema": "metaengine.compute.sync-peer-review.h205f22.v1",
        "review_id": f"{reviewer}-review-001",
        "reviewer": reviewer,
        "subject": {"name": "SYNC-L4.7-001", "digest": {"sha256": "a" * 64}},
        "external_parameters": {"task_sha256": "b" * 64, "sync_epoch_sha256": "c" * 64},
        "review_kind": "REVIEW",
        "disposition": disposition,
        "findings": findings or [],
        "authority_effect": False,
        "canonical": False,
    }


class PeerReviewBarrierTests(unittest.TestCase):
    def test_two_accepts_complete_barrier(self):
        receipt = mod.evaluate(TASK_RESULT, [review("chatgpt"), review("glm")])
        self.assertEqual(receipt["outcome"], "PEER_REVIEW_COMPLETE")
        self.assertEqual(set(receipt["review_roots"]), {"chatgpt", "glm"})
        self.assertFalse(receipt["authority"]["authority_effect"])

    def test_same_reviewer_twice_fails(self):
        with self.assertRaisesRegex(ValueError, "exactly chatgpt and glm"):
            mod.evaluate(TASK_RESULT, [review("chatgpt"), review("chatgpt")])

    def test_stale_epoch_fails(self):
        stale = review("glm")
        stale["external_parameters"]["sync_epoch_sha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "sync_epoch_sha256 mismatch"):
            mod.evaluate(TASK_RESULT, [review("chatgpt"), stale])

    def test_wrong_subject_digest_fails(self):
        wrong = review("glm")
        wrong["subject"]["digest"]["sha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "subject digest mismatch"):
            mod.evaluate(TASK_RESULT, [review("chatgpt"), wrong])

    def test_high_finding_requires_changes(self):
        bad = review("glm", findings=[{
            "finding_id": "GLM-HIGH-1",
            "severity": "HIGH",
            "invariant": "same world",
            "evidence_ref": "sha256:deadbeef",
        }])
        with self.assertRaisesRegex(ValueError, "requires CHANGES_REQUIRED"):
            mod.evaluate(TASK_RESULT, [review("chatgpt"), bad])

    def test_changes_required_produces_fix_required(self):
        finding = {
            "finding_id": "GPT-HIGH-1",
            "severity": "HIGH",
            "invariant": "task digest must match",
            "evidence_ref": "artifact:1",
        }
        receipt = mod.evaluate(TASK_RESULT, [
            review("chatgpt", disposition="CHANGES_REQUIRED", findings=[finding]),
            review("glm"),
        ])
        self.assertEqual(receipt["outcome"], "FIX_REQUIRED")
        self.assertEqual(receipt["blocking_finding_ids"], ["GPT-HIGH-1"])

    def test_unknown_field_fails_closed(self):
        extra = review("glm")
        extra["free_text_command"] = "do something else"
        with self.assertRaisesRegex(ValueError, "review keys mismatch"):
            mod.evaluate(TASK_RESULT, [review("chatgpt"), extra])


if __name__ == "__main__":
    unittest.main()
