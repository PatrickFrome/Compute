import copy
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from coordination.evidence import evidence_bundle as b


SUBJECT_SHA = "0bce991dc5db90a4d515d0ccae9bb696cc345a69d0df958e0db719a68112152b"
BARRIER_SHA = "f1b6532b6f80c3cbb721f286dbb61b1954d960a501c81e9b5b7a86723f1c4164"
GPT_ROOT = "0399229cd4943f7e9faf05505610c59ccad9f695c9e844f5445c797d3a996b1a"
GLM_ROOT = "e88a8e1ade4465a1d76fb3f58060c192c7d0112f387b47004634902fd018612c"
TASK_SHA = "055686f3cf09e99a27e5005ed9079426a9553e5a2e29a664ce3e37fb1cdf7e6e"
EPOCH_SHA = "5c0a35c4123190251059b0c092becd33d44efa9d7ed2466add650c3569938e4c"
GIT_SHA = "f7067c353f319d01b88efa1d83aa691d9d6d5bd1"
TREE_SHA = "65efd906c64b1a7837df607583ed34d518891029"
CONTRACT_SHA = "3426748fddfe813c034a9c369250ca1f7dfbc19163ae6fb787cdc0e4580708de"
RESULT_SHA = "6763d717807057a540b73e761cbef75d33f5bf501598e91774259ec367af612d"
TASK_RESULT_SHA = "097b0e493544dd22d36667b0c24d2317f78da62fcdffe82085a5851c915d728f"


def authority(**extra):
    return {
        "authority_effect": False,
        "canonical": False,
        "project_claim_authority": False,
        **extra,
    }


def fixtures():
    subject = {
        "schema": "metaengine.compute.sync-execution-subject.h205f22.v1",
        "task_id": "SYNC-L4.7-002",
        "task_result_sha256": TASK_RESULT_SHA,
        "task_sha256": TASK_SHA,
        "sync_epoch_sha256": EPOCH_SHA,
        "git_sha": GIT_SHA,
        "tree_sha": TREE_SHA,
        "execution_contract_sha256": CONTRACT_SHA,
        "provider_neutral_result_sha256": RESULT_SHA,
        "cross_provider_evidence_class": "CROSS_PROVIDER_REPRODUCED_VERIFIED",
        "identity_source": "PERSISTED_APPVEYOR_ARTIFACT_BYTES",
        "execution_subject_sha256": SUBJECT_SHA,
        "authority": authority(execution_authority=False),
    }
    cross = {
        "schema": "metaengine.compute.a1.cross-provider-readback.h205f22.v1",
        "evidence_class": "CROSS_PROVIDER_REPRODUCED_VERIFIED",
        "identity_source": "PERSISTED_APPVEYOR_ARTIFACT_BYTES",
        "providers": ["github-actions", "appveyor"],
        "roots": {
            "git_sha": GIT_SHA,
            "tree_sha": TREE_SHA,
            "contract_sha256": CONTRACT_SHA,
            "provider_neutral_result_sha256": RESULT_SHA,
        },
        "authority": authority(execution_authority=False, persistent_worker_proof=False, w1_verified=False),
    }
    gpt = {
        "schema": "metaengine.compute.sync-github-review-ingest.h205f22.v1",
        "execution_subject_sha256": SUBJECT_SHA,
        "review_sha256": GPT_ROOT,
        "disposition": "ACCEPT",
        "blocking_finding_count": 0,
        "identity_source": "GITHUB_PERSISTED_REVIEW_API_BYTES",
        "review": {"review_id": "gpt-sync-l47-002-f7067c35"},
        "authority": authority(),
    }
    glm = {
        "schema": "metaengine.compute.sync-pap-review-ingest.h205f22.v1",
        "execution_subject_sha256": SUBJECT_SHA,
        "review_sha256": GLM_ROOT,
        "disposition": "ACCEPT",
        "blocking_finding_count": 0,
        "identity_source": "PAP_PERSISTED_READ_BYTES",
        "review": {"review_id": "glm-review-sync-l47-002-f7067c35-001"},
        "authority": authority(),
    }
    neutral = {
        "task_id": "SYNC-L4.7-002",
        "execution_subject_sha256": SUBJECT_SHA,
        "task_result_sha256": TASK_RESULT_SHA,
        "task_sha256": TASK_SHA,
        "sync_epoch_sha256": EPOCH_SHA,
        "git_sha": GIT_SHA,
        "tree_sha": TREE_SHA,
        "execution_contract_sha256": CONTRACT_SHA,
        "provider_neutral_result_sha256": RESULT_SHA,
        "review_roots": {"chatgpt": GPT_ROOT, "glm": GLM_ROOT},
        "outcome": "PEER_REVIEW_COMPLETE",
        "blocking_finding_ids": [],
    }
    barrier = {
        "schema": "metaengine.compute.sync-peer-review-barrier.h205f22.v2",
        **neutral,
        "barrier_sha256": b.canonical_hash(neutral),
        "findings": [],
        "authority": authority(),
    }
    self_check = barrier["barrier_sha256"]
    if self_check != BARRIER_SHA:
        raise AssertionError(f"fixture barrier mismatch: {self_check}")
    return subject, cross, gpt, glm, barrier


class EvidenceBundleTests(unittest.TestCase):
    def test_deterministic_tar_and_non_authority_receipt(self):
        values = fixtures()
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as c:
            r1 = b.build_bundle(
                execution_subject=values[0], cross=values[1], chatgpt_ingest=values[2],
                glm_ingest=values[3], barrier=values[4], output_dir=Path(a),
            )
            r2 = b.build_bundle(
                execution_subject=values[0], cross=values[1], chatgpt_ingest=values[2],
                glm_ingest=values[3], barrier=values[4], output_dir=Path(c),
            )
            self.assertEqual(r1["bundle_sha256"], r2["bundle_sha256"])
            self.assertEqual(
                Path(a, r1["bundle_name"]).read_bytes(),
                Path(c, r2["bundle_name"]).read_bytes(),
            )
            self.assertEqual(r1["evidence_class"], "EVIDENCE_READY_NON_AUTHORITY")
            self.assertFalse(r1["authority_effect"])
            self.assertFalse(r1["canonical"])
            self.assertFalse(r1["w1_verified"])

    def test_archive_has_expected_immutable_members(self):
        values = fixtures()
        with tempfile.TemporaryDirectory() as td:
            receipt = b.build_bundle(
                execution_subject=values[0], cross=values[1], chatgpt_ingest=values[2],
                glm_ingest=values[3], barrier=values[4], output_dir=Path(td),
            )
            with tarfile.open(Path(td, receipt["bundle_name"]), "r") as archive:
                self.assertEqual(
                    archive.getnames(),
                    sorted([
                        "barrier.json", "chatgpt-ingest.json", "cross-provider-readback.json",
                        "evidence-statement.json", "execution-subject.json", "glm-ingest.json",
                        "manifest.json", "schema-version-policy.json",
                    ]),
                )
                statement = json.load(archive.extractfile("evidence-statement.json"))
                policy = json.load(archive.extractfile("schema-version-policy.json"))
                self.assertEqual(statement["_type"], b.STATEMENT_TYPE)
                self.assertEqual(statement["subject"][0]["digest"]["sha256"], SUBJECT_SHA)
                self.assertEqual(statement["predicate"]["evidence_class"], "EVIDENCE_READY_NON_AUTHORITY")
                self.assertEqual(policy["interpretation_policy"], "NO_RETROACTIVE_REINTERPRETATION")

    def test_authority_overclaim_fails_closed(self):
        values = list(fixtures())
        values[3] = copy.deepcopy(values[3])
        values[3]["authority"]["authority_effect"] = True
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "authority"):
                b.build_bundle(
                    execution_subject=values[0], cross=values[1], chatgpt_ingest=values[2],
                    glm_ingest=values[3], barrier=values[4], output_dir=Path(td),
                )

    def test_root_mismatch_fails_closed(self):
        values = list(fixtures())
        values[1] = copy.deepcopy(values[1])
        values[1]["roots"]["tree_sha"] = "0" * 40
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "roots"):
                b.build_bundle(
                    execution_subject=values[0], cross=values[1], chatgpt_ingest=values[2],
                    glm_ingest=values[3], barrier=values[4], output_dir=Path(td),
                )

    def test_incomplete_barrier_fails_closed(self):
        values = list(fixtures())
        values[4] = copy.deepcopy(values[4])
        values[4]["outcome"] = "FIX_REQUIRED"
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "not complete"):
                b.build_bundle(
                    execution_subject=values[0], cross=values[1], chatgpt_ingest=values[2],
                    glm_ingest=values[3], barrier=values[4], output_dir=Path(td),
                )


if __name__ == "__main__":
    unittest.main()
