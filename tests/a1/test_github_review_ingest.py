from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[2] / "coordination" / "sync"
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


barrier = load("peer_review_barrier", MODULE_DIR / "peer_review_barrier.py")
ingest = load("github_review_ingest", MODULE_DIR / "github_review_ingest.py")


def subject():
    neutral = {
        "task_id": "SYNC-L4.7-002",
        "task_result_sha256": "1" * 64,
        "task_sha256": "2" * 64,
        "sync_epoch_sha256": "3" * 64,
        "git_sha": "4" * 40,
        "tree_sha": "5" * 40,
        "execution_contract_sha256": "6" * 64,
        "provider_neutral_result_sha256": "7" * 64,
        "cross_provider_evidence_class": "CROSS_PROVIDER_REPRODUCED_VERIFIED",
        "identity_source": "PERSISTED_APPVEYOR_ARTIFACT_BYTES",
    }
    return {
        "schema": "metaengine.compute.sync-execution-subject.h205f22.v1",
        **neutral,
        "execution_subject_sha256": barrier.canonical_hash(neutral),
        "authority": {
            "authority_effect": False,
            "canonical": False,
            "execution_authority": False,
            "project_claim_authority": False,
        },
    }


def review(s, *, review_id="gpt-r1", disposition="ACCEPT", findings=None):
    return {
        "schema": "metaengine.compute.sync-peer-review.h205f22.v2",
        "review_id": review_id,
        "reviewer": "chatgpt",
        "subject": {"name": s["task_id"], "digest": {"sha256": s["execution_subject_sha256"]}},
        "external_parameters": {
            "task_sha256": s["task_sha256"],
            "sync_epoch_sha256": s["sync_epoch_sha256"],
        },
        "review_kind": "REVIEW",
        "disposition": disposition,
        "findings": findings or [],
        "authority_effect": False,
        "canonical": False,
    }


def gh_entry(receipt, *, rid="101", submitted="2026-08-23T06:00:00Z", fenced=True):
    body = json.dumps(receipt)
    if fenced:
        body = "review evidence\n\n```json\n" + body + "\n```"
    return {"id": rid, "state": "COMMENTED", "body": body, "submitted_at": submitted}


class GithubReviewIngestTests(unittest.TestCase):
    def test_fenced_json_review_passes(self):
        s = subject()
        out = ingest.select_chatgpt_review([gh_entry(review(s))], s)
        self.assertEqual(out["reviewer"], "chatgpt")
        self.assertEqual(out["identity_source"], "GITHUB_PERSISTED_REVIEW_API_BYTES")
        self.assertFalse(out["authority"]["authority_effect"])

    def test_all_json_body_passes(self):
        s = subject()
        r = review(s)
        out = ingest.select_chatgpt_review([gh_entry(r, fenced=False)], s)
        self.assertEqual(out["review_sha256"], ingest.canonical_hash(r))

    def test_stale_subject_is_ignored(self):
        s = subject()
        stale = review(s)
        stale["subject"]["digest"]["sha256"] = "8" * 64
        with self.assertRaisesRegex(ValueError, "CHATGPT_REVIEW_NOT_FOUND"):
            ingest.select_chatgpt_review([gh_entry(stale)], s)

    def test_malformed_current_subject_fails(self):
        s = subject()
        bad = review(s)
        bad["canonical"] = True
        with self.assertRaisesRegex(ValueError, "MALFORMED_CHATGPT_REVIEW"):
            ingest.select_chatgpt_review([gh_entry(bad)], s)

    def test_exact_duplicate_is_idempotent(self):
        s = subject()
        r = review(s)
        a = gh_entry(deepcopy(r), rid="101", submitted="2026-08-23T06:00:00Z")
        b = gh_entry(deepcopy(r), rid="102", submitted="2026-08-23T06:01:00Z")
        out = ingest.select_chatgpt_review([a, b], s)
        self.assertEqual(out["idempotent_replay_count"], 1)
        self.assertEqual(out["github_review_id"], "102")

    def test_distinct_valid_reviews_same_subject_conflict(self):
        s = subject()
        a = gh_entry(review(s, review_id="gpt-a"), rid="101")
        b = gh_entry(review(s, review_id="gpt-b"), rid="102")
        with self.assertRaisesRegex(ValueError, "CONFLICTING_CHATGPT_REVIEWS"):
            ingest.select_chatgpt_review([a, b], s)

    def test_multiple_structured_receipts_in_one_body_fail(self):
        s = subject()
        r = json.dumps(review(s))
        body = f"```json\n{r}\n```\n```json\n{r}\n```"
        with self.assertRaisesRegex(ValueError, "MULTIPLE_STRUCTURED_REVIEWS"):
            ingest.select_chatgpt_review([{"id": "1", "body": body, "state": "COMMENTED"}], s)

    def test_prose_is_not_review(self):
        s = subject()
        with self.assertRaisesRegex(ValueError, "CHATGPT_REVIEW_NOT_FOUND"):
            ingest.select_chatgpt_review([{"id": "1", "body": "ACCEPT", "state": "COMMENTED"}], s)


if __name__ == "__main__":
    unittest.main()
