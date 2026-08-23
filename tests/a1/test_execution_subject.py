import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "coordination" / "sync" / "execution_subject.py"
spec = importlib.util.spec_from_file_location("execution_subject", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def task_result():
    return {
        "schema": "metaengine.compute.sync-task-result.h205f22.v1",
        "task_id": "SYNC-L4.7-002",
        "task_result_sha256": "a" * 64,
        "task_sha256": "b" * 64,
        "sync_epoch_sha256": "c" * 64,
        "authority": {"authority_effect": False, "canonical": False, "execution_authority": False, "project_claim_authority": False},
    }


def github():
    return {
        "schema": "metaengine.compute.a1.zero-spend-execution-evidence.h205f22.v1",
        "provider": {"kind": "github-actions"},
        "source": {"git_sha": "d" * 40, "tree_sha": "e" * 40},
        "contract": {"sha256": "f" * 64, "provider_neutral_result_sha256": "1" * 64},
        "sync_task": {"task_id": "SYNC-L4.7-002", "task_result_sha256": "a" * 64, "task_sha256": "b" * 64, "sync_epoch_sha256": "c" * 64},
        "authority": {"authority_effect": False, "canonical": False, "execution_authority": False, "persistent_worker_proof": False, "w1_verified": False},
    }


def cross():
    return {
        "schema": "metaengine.compute.a1.cross-provider-readback.h205f22.v1",
        "evidence_class": "CROSS_PROVIDER_REPRODUCED_VERIFIED",
        "identity_source": "PERSISTED_APPVEYOR_ARTIFACT_BYTES",
        "providers": ["github-actions", "appveyor"],
        "roots": {"git_sha": "d" * 40, "tree_sha": "e" * 40, "contract_sha256": "f" * 64, "provider_neutral_result_sha256": "1" * 64},
        "authority": {"authority_effect": False, "canonical": False, "execution_authority": False, "persistent_worker_proof": False, "w1_verified": False},
    }


class ExecutionSubjectTests(unittest.TestCase):
    def test_builds_composite_subject(self):
        s = mod.build_subject(task_result(), github(), cross())
        self.assertEqual(s["task_id"], "SYNC-L4.7-002")
        self.assertEqual(s["git_sha"], "d" * 40)
        self.assertEqual(len(s["execution_subject_sha256"]), 64)
        self.assertFalse(s["authority"]["authority_effect"])

    def test_tree_mismatch_fails(self):
        c = cross(); c["roots"]["tree_sha"] = "a" * 40
        with self.assertRaisesRegex(ValueError, "root mismatch"):
            mod.build_subject(task_result(), github(), c)

    def test_task_binding_mismatch_fails(self):
        g = github(); g["sync_task"]["task_result_sha256"] = "2" * 64
        with self.assertRaisesRegex(ValueError, "task binding mismatch"):
            mod.build_subject(task_result(), g, cross())

    def test_derived_cross_provider_evidence_rejected(self):
        c = cross(); c["evidence_class"] = "CROSS_PROVIDER_REPRODUCED_DERIVED"
        with self.assertRaisesRegex(ValueError, "not VERIFIED"):
            mod.build_subject(task_result(), github(), c)

    def test_non_persisted_identity_rejected(self):
        c = cross(); c["identity_source"] = "STATUS_ONLY"
        with self.assertRaisesRegex(ValueError, "persisted artifact bytes"):
            mod.build_subject(task_result(), github(), c)

    def test_authority_overclaim_rejected(self):
        g = github(); g["authority"]["w1_verified"] = True
        with self.assertRaisesRegex(ValueError, "authority overclaim"):
            mod.build_subject(task_result(), g, cross())


if __name__ == "__main__":
    unittest.main()
