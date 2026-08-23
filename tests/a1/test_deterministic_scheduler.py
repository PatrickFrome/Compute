from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[2] / "coordination" / "sync" / "deterministic_scheduler.py"
SPEC = importlib.util.spec_from_file_location("deterministic_scheduler", MODULE_PATH)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

EPOCH = "a" * 64


def task(task_id: str, *, risk=2, kind="IMPLEMENTATION", reads=(), writes=()):
    return {
        "schema": "metaengine.compute.sync-scheduler-task.h205f22.v1",
        "task_id": task_id,
        "sync_epoch_sha256": EPOCH,
        "risk_level": risk,
        "task_kind": kind,
        "read_domains": list(reads),
        "write_domains": list(writes),
        "authority_effect": False,
        "canonical": False,
    }


class DeterministicSchedulerTests(unittest.TestCase):
    def test_disjoint_writes_share_wave(self):
        s = mod.build_schedule([
            task("T-A", writes=("federation",)),
            task("T-B", writes=("continuity",)),
        ], sync_epoch_sha256=EPOCH, epoch_generation=7)
        self.assertEqual(len(s["waves"]), 1)
        self.assertEqual([x["task_id"] for x in s["waves"][0]["assignments"]], ["T-A", "T-B"])

    def test_write_write_conflict_serializes(self):
        s = mod.build_schedule([
            task("T-A", writes=("scheduler",)),
            task("T-B", writes=("scheduler",)),
        ], sync_epoch_sha256=EPOCH, epoch_generation=7)
        self.assertEqual(len(s["waves"]), 2)

    def test_write_read_conflict_serializes(self):
        s = mod.build_schedule([
            task("T-A", writes=("provider",)),
            task("T-B", reads=("provider",)),
        ], sync_epoch_sha256=EPOCH, epoch_generation=7)
        self.assertEqual(len(s["waves"]), 2)

    def test_read_read_is_parallel(self):
        s = mod.build_schedule([
            task("T-A", reads=("evidence",)),
            task("T-B", reads=("evidence",)),
        ], sync_epoch_sha256=EPOCH, epoch_generation=7)
        self.assertEqual(len(s["waves"]), 1)

    def test_roadmap_write_is_global_barrier(self):
        s = mod.build_schedule([
            task("T-A", risk=4, kind="AUTHORITY", writes=("roadmap",)),
            task("T-B", reads=("continuity",)),
            task("T-C", writes=("federation",)),
        ], sync_epoch_sha256=EPOCH, epoch_generation=7)
        roadmap_wave = next(w["wave"] for w in s["waves"] if any(a["task_id"] == "T-A" for a in w["assignments"]))
        self.assertEqual(len(s["waves"][roadmap_wave]["assignments"]), 1)

    def test_input_order_does_not_change_schedule_hash(self):
        tasks = [
            task("T-C", writes=("continuity",)),
            task("T-A", writes=("federation",)),
            task("T-B", reads=("federation",)),
        ]
        a = mod.build_schedule(tasks, sync_epoch_sha256=EPOCH, epoch_generation=7)
        b = mod.build_schedule(list(reversed(tasks)), sync_epoch_sha256=EPOCH, epoch_generation=7)
        self.assertEqual(a["schedule_sha256"], b["schedule_sha256"])
        self.assertEqual(a["waves"], b["waves"])

    def test_builder_adversary_flip_next_generation(self):
        a = mod.role_assignment("T-A", 7)
        b = mod.role_assignment("T-A", 8)
        self.assertEqual(a["builder"], b["adversary"])
        self.assertEqual(a["adversary"], b["builder"])
        self.assertEqual({a["builder"], a["adversary"]}, {"chatgpt", "glm"})

    def test_risk_quorum(self):
        low = mod.witness_policy(task("LOW", risk=0, kind="DOCS"), EPOCH)
        medium = mod.witness_policy(task("MED", risk=2), EPOCH)
        authority = mod.witness_policy(task("AUTH", risk=4, kind="AUTHORITY", writes=("roadmap",)), EPOCH)
        self.assertEqual(low["providers"][0], "github-actions")
        self.assertFalse(low["peer_review_required"])
        self.assertEqual(medium["providers"], ["github-actions", "appveyor"])
        self.assertTrue(medium["peer_review_required"])
        self.assertFalse(medium["supervisor_review_required"])
        self.assertTrue(authority["supervisor_review_required"])

    def test_low_risk_audit_is_deterministic_and_reachable(self):
        selected = None
        for i in range(200):
            candidate = task(f"DOC-{i}", risk=0, kind="DOCS")
            p = mod.witness_policy(candidate, EPOCH)
            if p["appveyor_reason"] == "DETERMINISTIC_AUDIT_10PCT":
                selected = (candidate, p)
                break
        self.assertIsNotNone(selected)
        candidate, first = selected
        second = mod.witness_policy(candidate, EPOCH)
        self.assertEqual(first, second)
        self.assertEqual(first["providers"], ["github-actions", "appveyor"])

    def test_mixed_epoch_rejected(self):
        bad = task("T-B")
        bad["sync_epoch_sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "mixed or stale sync epoch"):
            mod.build_schedule([task("T-A"), bad], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_duplicate_task_id_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate task_id"):
            mod.build_schedule([task("T-A"), task("T-A")], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_unknown_domain_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown mutation domains"):
            mod.build_schedule([task("T-A", writes=("federaton",))], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_authority_overclaim_rejected(self):
        bad = task("T-A")
        bad["authority_effect"] = True
        with self.assertRaisesRegex(ValueError, "non-authority"):
            mod.build_schedule([bad], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_risk4_reserved_for_authority(self):
        with self.assertRaisesRegex(ValueError, "risk 4 is reserved"):
            mod.build_schedule([task("T-A", risk=4)], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_implementation_cannot_downgrade_to_risk1(self):
        with self.assertRaisesRegex(ValueError, "risk downgrade"):
            mod.build_schedule([task("T-A", risk=1, kind="IMPLEMENTATION")], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_schema_and_security_require_risk3(self):
        for kind in ("SCHEMA", "SECURITY"):
            with self.assertRaisesRegex(ValueError, "risk downgrade"):
                mod.build_schedule([task(f"T-{kind}", risk=2, kind=kind)], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_low_risk_domain_write_rejected(self):
        with self.assertRaisesRegex(ValueError, "domain writes require risk >= 2"):
            mod.build_schedule([task("T-DOC", risk=0, kind="DOCS", writes=("evidence",))], sync_epoch_sha256=EPOCH, epoch_generation=7)

    def test_roadmap_write_cannot_hide_in_non_authority_kind(self):
        with self.assertRaisesRegex(ValueError, "roadmap writes require AUTHORITY/risk 4"):
            mod.build_schedule([task("T-ROADMAP", risk=3, kind="SECURITY", writes=("roadmap",))], sync_epoch_sha256=EPOCH, epoch_generation=7)


if __name__ == "__main__":
    unittest.main()
