from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from controller.roadmap import roadmap_cycle_oracle as oracle


DEFINITION = "96068a842c7dcb37d216aad6defc7b51e291394e916f76beed447be630024925"
CANONICAL = "bb08794d6887fe394b0e74042e31236140e611b48169f542e5e3026203f06f15"
REMOTE = "1" * 40
LOCAL = "2" * 40
ROOT = Path(__file__).resolve().parents[1]
LIVE_FIXTURE = ROOT / "tests" / "fixtures" / "main_roadmap_live_snapshot_20260827.json"


def milestone(
    key: str,
    *,
    status: str,
    blocked_by: list[str] | None = None,
    critical: bool = True,
    phase: int = 10,
    priority: int = 1,
) -> dict:
    return {
        "milestone_key": key,
        "title": key.replace("_", " ").title(),
        "lane": key.split("_", 1)[0],
        "effective_status": status,
        "blocked_by": blocked_by or [],
        "critical_path": critical,
        "phase_order": phase,
        "priority": priority,
    }


def live_snapshot() -> dict:
    rows = [
        milestone("B0_CONTROL_TRUST_BASELINE", status="VERIFIED", phase=0),
        milestone("W1_PERSISTENT_LINUX_WORKER_SAFETY", status="READY", phase=10, priority=1),
        milestone("T0_HERMETIC_TOOLCHAIN_CONTRACT", status="VERIFIED", phase=10, priority=2),
        milestone("F1_LIVE_EXTERNAL_FEDERATION", status="READY", phase=10, priority=5),
        milestone("R1_CONTINUITY_PLANE_ADOPTION", status="READY", phase=10, priority=10, critical=False),
        milestone("T1_TOOLCHAIN_PARITY_VERIFICATION", status="BLOCKED", blocked_by=["W1_PERSISTENT_LINUX_WORKER_SAFETY"], phase=20),
        milestone("A1_ISOLATED_WORKSPACE_AGENT_ADAPTER", status="BLOCKED", blocked_by=["W1_PERSISTENT_LINUX_WORKER_SAFETY"], phase=20),
        milestone(
            "C1_FIRST_SERIAL_CODING_LOOP",
            status="BLOCKED",
            blocked_by=["W1_PERSISTENT_LINUX_WORKER_SAFETY", "T1_TOOLCHAIN_PARITY_VERIFICATION", "A1_ISOLATED_WORKSPACE_AGENT_ADAPTER"],
            phase=30,
        ),
        milestone("ACC1_BASE_ACCELERATORS", status="BLOCKED", blocked_by=["C1_FIRST_SERIAL_CODING_LOOP"], phase=40, critical=False),
        milestone("R2_TWO_DOMAIN_PERSISTED_READBACK", status="BLOCKED", blocked_by=["R1_CONTINUITY_PLANE_ADOPTION"], phase=20, critical=False),
        milestone("R3_RESTORE_DRILL_QUORUM", status="BLOCKED", blocked_by=["R2_TWO_DOMAIN_PERSISTED_READBACK"], phase=30),
        milestone(
            "P1_PRODUCTION_CORE_ACCEPTANCE",
            status="BLOCKED",
            blocked_by=["C1_FIRST_SERIAL_CODING_LOOP", "F1_LIVE_EXTERNAL_FEDERATION", "R3_RESTORE_DRILL_QUORUM"],
            phase=120,
        ),
    ]
    return {
        "roadmap_status": {
            "roadmap_id": oracle.ROADMAP_ID,
            "definition_integrity": True,
            "sealed_definition_sha256": DEFINITION,
            "current_definition_sha256": DEFINITION,
            "milestones": rows,
            "next_mainline": {
                "milestone_key": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
                "effective_status": "READY",
            },
        },
        "alignment_status": {
            "drift_detected": False,
            "canonical_integrity": True,
            "level2_definition_integrity": True,
            "level2_roadmap": oracle.ROADMAP_ID,
            "canonical_digest": CANONICAL,
            "git_source": {
                "repository": oracle.ROADMAP_REPOSITORY,
                "path": oracle.CANONICAL_ROADMAP_PATH,
                "commit": "f73ac4c7730381b13239744979f8fa4731951109",
            },
            "active_claim_alignment": [
                {
                    "aligned": True,
                    "milestone_key": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
                    "canonical_milestone_key": "C1",
                }
            ],
        },
    }


def plan_rail() -> dict:
    return {
        "remote_ref": "origin/work/w1-sandbox-launcher-prep",
        "local_ref": "HEAD",
        "expected_remote_head_sha": REMOTE,
        "live_remote_head_sha": REMOTE,
        "local_head_sha": REMOTE,
        "relation": "EXACT",
        "working_tree_clean": True,
        "dirty_path_count": 0,
    }


class MainRoadmapCycleOracleTests(unittest.TestCase):
    def test_exact_20260827_live_snapshot_ranks_w1_r1_f1(self):
        snapshot = json.loads(LIVE_FIXTURE.read_text(encoding="utf-8"))
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertTrue(result["cycle_preflight_passed"])
        ranking = result["evidence"]["ranking"]
        self.assertEqual(
            ["W1_PERSISTENT_LINUX_WORKER_SAFETY", "R1_CONTINUITY_PLANE_ADOPTION", "F1_LIVE_EXTERNAL_FEDERATION"],
            [row["milestone_key"] for row in ranking[:3]],
        )
        self.assertEqual(ranking[0]["transitive_dependents"], 21)
        self.assertEqual(ranking[0]["critical_descendants"], 13)
        self.assertEqual(result["evidence"]["roadmap"]["definition_sha256"], DEFINITION)

    def test_live_shape_selects_w1_by_canonical_mainline_and_fanout(self):
        result = oracle.evaluate(live_snapshot(), plan_rail(), phase="PLAN")
        self.assertTrue(result["cycle_preflight_passed"])
        self.assertEqual(result["outcome"], "PASS_MAIN_ROADMAP_CYCLE_NONAUTHORITY")
        selected = result["evidence"]["selected"]
        self.assertEqual(selected["milestone_key"], "W1_PERSISTENT_LINUX_WORKER_SAFETY")
        self.assertEqual(selected["canonical_milestone_key"], "C1")
        self.assertGreaterEqual(selected["transitive_dependents"], 4)
        self.assertEqual(
            selected["direct_unlocks"],
            ["A1_ISOLATED_WORKSPACE_AGENT_ADAPTER", "T1_TOOLCHAIN_PARITY_VERIFICATION"],
        )

    def test_receipt_is_explicitly_non_authoritative(self):
        result = oracle.evaluate(live_snapshot(), plan_rail(), phase="PLAN")
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["provider_mutation_authorized"])
        self.assertFalse(result["database_ddl_authorized"])
        self.assertFalse(result["edge_deployment_authorized"])
        self.assertFalse(result["pr_merge_authorized"])
        self.assertEqual(result["checkpoint_payload"]["kind"], oracle.CHECKPOINT_KIND)
        self.assertFalse(any(result["checkpoint_payload"]["boundaries"].values()))

    def test_receipt_hash_is_deterministic(self):
        left = oracle.evaluate(live_snapshot(), plan_rail(), phase="PLAN")
        right = oracle.evaluate(copy.deepcopy(live_snapshot()), copy.deepcopy(plan_rail()), phase="PLAN")
        self.assertEqual(left["evidence_sha256"], right["evidence_sha256"])
        self.assertEqual(64, len(left["evidence_sha256"]))

    def test_receipt_binds_complete_input_snapshot(self):
        left_snapshot = live_snapshot()
        right_snapshot = copy.deepcopy(left_snapshot)
        right_snapshot["roadmap_status"]["snapshot_marker"] = "different-live-read"
        left = oracle.evaluate(left_snapshot, plan_rail(), phase="PLAN")
        right = oracle.evaluate(right_snapshot, plan_rail(), phase="PLAN")
        self.assertNotEqual(left["evidence"]["input_snapshot_sha256"], right["evidence"]["input_snapshot_sha256"])
        self.assertNotEqual(left["evidence_sha256"], right["evidence_sha256"])

    def test_definition_drift_blocks(self):
        snapshot = live_snapshot()
        snapshot["roadmap_status"]["current_definition_sha256"] = "0" * 64
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertFalse(result["cycle_preflight_passed"])
        self.assertIn("definition_digest_exact", result["evidence"]["failed_checks"])
        self.assertIsNone(result["checkpoint_payload"])

    def test_next_mainline_status_drift_fails_closed(self):
        snapshot = live_snapshot()
        snapshot["roadmap_status"]["next_mainline"]["effective_status"] = "IN_PROGRESS"
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertFalse(result["cycle_preflight_passed"])
        self.assertIn("next_mainline_status_mismatch", result["evidence"]["error"])

    def test_alignment_drift_blocks(self):
        snapshot = live_snapshot()
        snapshot["alignment_status"]["drift_detected"] = True
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertIn("alignment_no_drift", result["evidence"]["failed_checks"])

    def test_canonical_git_source_drift_blocks(self):
        snapshot = live_snapshot()
        snapshot["alignment_status"]["git_source"]["repository"] = "attacker/fork"
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertIn("canonical_git_repository_exact", result["evidence"]["failed_checks"])

    def test_missing_level1_mapping_blocks(self):
        snapshot = live_snapshot()
        snapshot["alignment_status"]["active_claim_alignment"] = []
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertIn("selected_level1_mapping_exact", result["evidence"]["failed_checks"])

    def test_unknown_dependency_fails_closed(self):
        snapshot = live_snapshot()
        snapshot["roadmap_status"]["milestones"][0]["blocked_by"] = ["DOES_NOT_EXIST"]
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertFalse(result["cycle_preflight_passed"])
        self.assertIn("roadmap_dependency_unknown", result["evidence"]["error"])

    def test_oversized_graph_fails_closed(self):
        snapshot = live_snapshot()
        template = snapshot["roadmap_status"]["milestones"][0]
        snapshot["roadmap_status"]["milestones"] = [
            {**template, "milestone_key": f"M{index}", "title": f"Milestone {index}"}
            for index in range(oracle.MAX_MILESTONES + 1)
        ]
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertFalse(result["cycle_preflight_passed"])
        self.assertIn("milestones_invalid", result["evidence"]["error"])

    def test_cycle_fails_closed(self):
        snapshot = live_snapshot()
        rows = snapshot["roadmap_status"]["milestones"]
        rows[0]["blocked_by"] = ["W1_PERSISTENT_LINUX_WORKER_SAFETY"]
        rows[1]["blocked_by"] = ["B0_CONTROL_TRUST_BASELINE"]
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertFalse(result["cycle_preflight_passed"])
        self.assertIn("roadmap_dependency_cycle", result["evidence"]["error"])

    def test_stale_expected_remote_head_blocks(self):
        rail = plan_rail()
        rail["live_remote_head_sha"] = "3" * 40
        result = oracle.evaluate(live_snapshot(), rail, phase="PLAN")
        self.assertIn("remote_head_matches_expectation", result["evidence"]["failed_checks"])

    def test_plan_requires_clean_exact_rail(self):
        rail = plan_rail()
        rail["relation"] = "REMOTE_AHEAD"
        rail["working_tree_clean"] = False
        rail["dirty_path_count"] = 2
        result = oracle.evaluate(live_snapshot(), rail, phase="PLAN")
        self.assertEqual(
            {"phase_relation_exact", "worktree_clean"},
            set(result["evidence"]["failed_checks"]),
        )

    def test_publish_requires_clean_strict_local_descendant(self):
        exact = plan_rail()
        blocked = oracle.evaluate(live_snapshot(), exact, phase="PUBLISH")
        self.assertIn("phase_relation_exact", blocked["evidence"]["failed_checks"])
        self.assertIn("publish_is_strict_descendant", blocked["evidence"]["failed_checks"])

        ahead = plan_rail()
        ahead["local_head_sha"] = LOCAL
        ahead["relation"] = "LOCAL_AHEAD"
        passed = oracle.evaluate(live_snapshot(), ahead, phase="PUBLISH")
        self.assertTrue(passed["cycle_preflight_passed"])

    def test_malformed_timestamp_or_authority_labels_cannot_enter_receipt(self):
        snapshot = live_snapshot()
        snapshot["claim"] = {"state": "ACTIVE", "expires_at": "not-a-time"}
        result = oracle.evaluate(snapshot, plan_rail(), phase="PLAN")
        self.assertTrue(result["cycle_preflight_passed"])
        rendered = json.dumps(result, sort_keys=True)
        self.assertNotIn("not-a-time", rendered)
        self.assertNotIn('"provider_mutation_authorized": true', rendered)


class GitRailInspectionTests(unittest.TestCase):
    def git(self, repo: Path, *args: str) -> str:
        return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, repo: Path, name: str) -> str:
        (repo / name).write_text(name, encoding="utf-8")
        self.git(repo, "add", name)
        self.git(repo, "commit", "-m", name)
        return self.git(repo, "rev-parse", "HEAD")

    def test_inspect_rail_proves_exact_then_local_ahead(self):
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            self.git(repo, "init")
            self.git(repo, "config", "user.email", "oracle@example.invalid")
            self.git(repo, "config", "user.name", "Roadmap Oracle")
            base = self.commit(repo, "base")
            self.git(repo, "branch", "remote-rail", base)

            exact = oracle.inspect_rail(
                repo=repo, remote_ref="remote-rail", local_ref="HEAD", expected_remote_head=base
            )
            self.assertEqual(exact["relation"], "EXACT")
            self.assertTrue(exact["working_tree_clean"])

            local = self.commit(repo, "local")
            ahead = oracle.inspect_rail(
                repo=repo, remote_ref="remote-rail", local_ref="HEAD", expected_remote_head=base
            )
            self.assertEqual(ahead["relation"], "LOCAL_AHEAD")
            self.assertEqual(ahead["local_head_sha"], local)
            self.assertTrue(ahead["working_tree_clean"])

            (repo / "dirty").write_text("dirty", encoding="utf-8")
            dirty = oracle.inspect_rail(
                repo=repo, remote_ref="remote-rail", local_ref="HEAD", expected_remote_head=base
            )
            self.assertFalse(dirty["working_tree_clean"])
            self.assertEqual(dirty["dirty_path_count"], 1)

    def test_revision_expression_ref_is_rejected_before_git(self):
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            self.git(repo, "init")
            with self.assertRaisesRegex(oracle.OracleInputError, "remote_ref_invalid"):
                oracle.inspect_rail(
                    repo=repo,
                    remote_ref="HEAD~1",
                    local_ref="HEAD",
                    expected_remote_head="1" * 40,
                )


if __name__ == "__main__":
    unittest.main()
