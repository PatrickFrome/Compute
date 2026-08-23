import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "coordination" / "sync" / "peer_review_barrier.py"
spec = importlib.util.spec_from_file_location("peer_review_barrier", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def execution_subject():
    neutral = {
        "task_id": "SYNC-L4.7-002",
        "task_result_sha256": "a" * 64,
        "task_sha256": "b" * 64,
        "sync_epoch_sha256": "c" * 64,
        "git_sha": "d" * 40,
        "tree_sha": "e" * 40,
        "execution_contract_sha256": "f" * 64,
        "provider_neutral_result_sha256": "1" * 64,
        "cross_provider_evidence_class": "CROSS_PROVIDER_REPRODUCED_VERIFIED",
        "identity_source": "PERSISTED_APPVEYOR_ARTIFACT_BYTES",
    }
    return {
        "schema": "metaengine.compute.sync-execution-subject.h205f22.v1",
        **neutral,
        "execution_subject_sha256": mod.canonical_hash(neutral),
        "authority": {"authority_effect": False, "canonical": False, "execution_authority": False, "project_claim_authority": False},
    }


def review(reviewer: str, *, disposition: str = "ACCEPT", findings=None):
    subject = execution_subject()
    return {
        "schema": "metaengine.compute.sync-peer-review.h205f22.v2",
        "review_id": f"{reviewer}-review-002",
        "reviewer": reviewer,
        "subject": {"name": "SYNC-L4.7-002", "digest": {"sha256": subject["execution_subject_sha256"]}},
        "external_parameters": {"task_sha256": "b" * 64, "sync_epoch_sha256": "c" * 64},
        "review_kind": "REVIEW",
        "disposition": disposition,
        "findings": findings or [],
        "authority_effect": False,
        "canonical": False,
    }


class PeerReviewBarrierTests(unittest.TestCase):
    def test_two_accepts_complete_barrier(self):
        receipt = mod.evaluate(execution_subject(), [review("chatgpt"), review("glm")])
        self.assertEqual(receipt["outcome"], "PEER_REVIEW_COMPLETE")
        self.assertEqual(set(receipt["review_roots"]), {"chatgpt", "glm"})
        self.assertEqual(receipt["git_sha"], "d" * 40)
        self.assertFalse(receipt["authority"]["authority_effect"])

    def test_same_reviewer_twice_fails(self):
        with self.assertRaisesRegex(ValueError, "exactly chatgpt and glm"):
            mod.evaluate(execution_subject(), [review("chatgpt"), review("chatgpt")])

    def test_stale_epoch_fails(self):
        stale = review("glm")
        stale["external_parameters"]["sync_epoch_sha256"] = "2" * 64
        with self.assertRaisesRegex(ValueError, "sync_epoch_sha256 mismatch"):
            mod.evaluate(execution_subject(), [review("chatgpt"), stale])

    def test_wrong_composite_subject_fails(self):
        wrong = review("glm")
        wrong["subject"]["digest"]["sha256"] = "2" * 64
        with self.assertRaisesRegex(ValueError, "subject digest mismatch"):
            mod.evaluate(execution_subject(), [review("chatgpt"), wrong])

    def test_source_change_invalidates_review(self):
        changed = execution_subject()
        changed["git_sha"] = "3" * 40
        with self.assertRaisesRegex(ValueError, "execution_subject_sha256 mismatch"):
            mod.evaluate(changed, [review("chatgpt"), review("glm")])

    def test_high_finding_requires_changes(self):
        bad = review("glm", findings=[{
            "finding_id": "GLM-HIGH-1", "severity": "HIGH",
            "invariant": "same world", "evidence_ref": "artifact:cross-provider",
        }])
        with self.assertRaisesRegex(ValueError, "requires CHANGES_REQUIRED"):
            mod.evaluate(execution_subject(), [review("chatgpt"), bad])

    def test_changes_required_produces_fix_required(self):
        finding = {"finding_id": "GPT-HIGH-1", "severity": "HIGH", "invariant": "execution subject must match", "evidence_ref": "artifact:subject"}
        receipt = mod.evaluate(execution_subject(), [review("chatgpt", disposition="CHANGES_REQUIRED", findings=[finding]), review("glm")])
        self.assertEqual(receipt["outcome"], "FIX_REQUIRED")
        self.assertEqual(receipt["blocking_finding_ids"], ["GPT-HIGH-1"])

    def test_v1_review_rejected(self):
        old = review("glm"); old["schema"] = "metaengine.compute.sync-peer-review.h205f22.v1"
        with self.assertRaisesRegex(ValueError, "unsupported peer-review schema"):
            mod.evaluate(execution_subject(), [review("chatgpt"), old])

    def test_unknown_field_fails_closed(self):
        extra = review("glm"); extra["free_text_command"] = "do something else"
        with self.assertRaisesRegex(ValueError, "review keys mismatch"):
            mod.evaluate(execution_subject(), [review("chatgpt"), extra])


if __name__ == "__main__":
    unittest.main()
