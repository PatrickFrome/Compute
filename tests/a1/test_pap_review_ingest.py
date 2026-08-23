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

SUBJECT_PATH = MODULE_DIR / "execution_subject.py"
BARRIER_PATH = MODULE_DIR / "peer_review_barrier.py"
INGEST_PATH = MODULE_DIR / "pap_review_ingest.py"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


barrier = load("peer_review_barrier", BARRIER_PATH)
ingest = load("pap_review_ingest", INGEST_PATH)


def execution_subject():
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


def review(subject, *, review_id="glm-review-1", disposition="ACCEPT", findings=None):
    return {
        "schema": "metaengine.compute.sync-peer-review.h205f22.v2",
        "review_id": review_id,
        "reviewer": "glm",
        "subject": {
            "name": subject["task_id"],
            "digest": {"sha256": subject["execution_subject_sha256"]},
        },
        "external_parameters": {
            "task_sha256": subject["task_sha256"],
            "sync_epoch_sha256": subject["sync_epoch_sha256"],
        },
        "review_kind": "REVIEW",
        "disposition": disposition,
        "findings": findings or [],
        "authority_effect": False,
        "canonical": False,
    }


def envelope(receipt, *, seq=1, message_id=None):
    return {
        "schema": "metaengine.agent-message.h205f22.v1",
        "id": message_id or f"glm-{seq:04d}",
        "from": "glm",
        "to": "chatgpt",
        "kind": "REVIEW",
        "evidence_class": "LIVE",
        "authority_effect": False,
        "canonical": False,
        "requires_response": False,
        "ts": "2026-08-23T06:00:00Z",
        "expires_at": "2026-08-23T07:00:00Z",
        "mode": "INTEGRATION",
        "thread_id": "SYNC-L4.7-002",
        "seq": seq,
        "peer_review_receipt": receipt,
    }


def pap(messages, *, gap=False):
    return {"peer": "glm", "after_seq": 0, "gap_detected": gap, "messages": messages}


class PapReviewIngestTests(unittest.TestCase):
    def test_valid_structured_glm_review_passes(self):
        subject = execution_subject()
        result = ingest.select_glm_review(pap([envelope(review(subject))]), subject)
        self.assertEqual(result["reviewer"], "glm")
        self.assertEqual(result["disposition"], "ACCEPT")
        self.assertEqual(result["identity_source"], "PAP_PERSISTED_READ_BYTES")
        self.assertFalse(result["authority"]["authority_effect"])

    def test_sequence_gap_fails_closed(self):
        subject = execution_subject()
        with self.assertRaisesRegex(ValueError, "PAP_SEQUENCE_GAP"):
            ingest.select_glm_review(pap([envelope(review(subject))], gap=True), subject)

    def test_stale_other_subject_is_not_accepted(self):
        subject = execution_subject()
        stale = review(subject)
        stale["subject"]["digest"]["sha256"] = "8" * 64
        with self.assertRaisesRegex(ValueError, "GLM_REVIEW_NOT_FOUND"):
            ingest.select_glm_review(pap([envelope(stale)]), subject)

    def test_malformed_review_for_current_subject_fails(self):
        subject = execution_subject()
        bad = review(subject)
        bad["authority_effect"] = True
        with self.assertRaisesRegex(ValueError, "MALFORMED_GLM_REVIEW"):
            ingest.select_glm_review(pap([envelope(bad)]), subject)

    def test_exact_duplicate_review_is_idempotent_replay(self):
        subject = execution_subject()
        same = review(subject)
        first = envelope(deepcopy(same), seq=4, message_id="glm-0018")
        second = envelope(deepcopy(same), seq=7, message_id="glm-0020")
        result = ingest.select_glm_review(pap([first, second]), subject)
        self.assertEqual(result["idempotent_replay_count"], 1)
        self.assertEqual(result["pap_sequence"], 7)
        self.assertEqual(result["pap_message_id"], "glm-0020")

    def test_distinct_reviews_same_subject_conflict(self):
        subject = execution_subject()
        first = envelope(review(subject, review_id="glm-a"), seq=1, message_id="glm-0001")
        second = envelope(review(subject, review_id="glm-b"), seq=2, message_id="glm-0002")
        with self.assertRaisesRegex(ValueError, "CONFLICTING_GLM_REVIEWS"):
            ingest.select_glm_review(pap([first, second]), subject)

    def test_exact_json_content_compatibility(self):
        subject = execution_subject()
        receipt = review(subject)
        env = envelope(receipt)
        env.pop("peer_review_receipt")
        env["content"] = json.dumps(receipt)
        result = ingest.select_glm_review(pap([env]), subject)
        self.assertEqual(result["review_sha256"], ingest.canonical_hash(receipt))

    def test_prose_content_is_never_interpreted_as_review(self):
        subject = execution_subject()
        env = envelope(review(subject))
        env.pop("peer_review_receipt")
        env["content"] = "ACCEPT: looks good"
        with self.assertRaisesRegex(ValueError, "GLM_REVIEW_NOT_FOUND"):
            ingest.select_glm_review(pap([env]), subject)


if __name__ == "__main__":
    unittest.main()
