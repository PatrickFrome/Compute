import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from tooling import accelerated_tests as a


class AcceleratedTestRunnerTests(unittest.TestCase):
    def test_finite_cgroup_quota_uses_whole_cpu_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cpu.max"
            path.write_text("800000 100000\n", encoding="utf-8")
            self.assertEqual(a.cgroup_cpu_quota(path), 8)

    def test_unlimited_cgroup_quota_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cpu.max"
            path.write_text("max 100000\n", encoding="utf-8")
            self.assertIsNone(a.cgroup_cpu_quota(path))

    def test_malformed_or_zero_cgroup_budget_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cpu.max"
            path.write_text("0 100000\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "positive"):
                a.cgroup_cpu_quota(path)

    def test_worker_override_cannot_exceed_detected_budget(self):
        with self.assertRaisesRegex(ValueError, "overcommit"):
            a.resolve_workers("9", 8)

    def test_parallel_command_is_argv_only_and_disables_restart(self):
        command = a.build_pytest_command(4, ["tests/test_w1_admission_contract.py"])
        self.assertEqual(command[:4], [sys.executable, "-m", "pytest", "-q"])
        self.assertIn("worksteal", command)
        self.assertIn("--max-worker-restart", command)
        self.assertEqual(command[-1], "tests/test_w1_admission_contract.py")

    def test_report_is_explicitly_non_authority(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "uv.lock").write_text("version = 1\n", encoding="utf-8")
            with mock.patch.object(a, "git_source", return_value={"git_sha": "a" * 40, "tree_sha": "b" * 40}):
                report = a.build_report(
                    root=root,
                    command=["python", "-m", "pytest"],
                    cpu_budget=8,
                    workers=4,
                    duration_seconds=1.25,
                    returncode=0,
                )
            self.assertEqual(report["mode"], "PREPARE_ONLY")
            self.assertEqual(report["execution"]["outcome"], "PASS")
            self.assertFalse(report["execution"]["shell"])
            self.assertEqual(
                report["authority"],
                {
                    "canonical": False,
                    "authority_effect": False,
                    "worker_admitted": False,
                    "w1_verified": False,
                    "acc1_verified": False,
                    "shared_cache_reuse": False,
                },
            )

    def test_report_write_is_valid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "evidence" / "report.json"
            a.write_report(path, {"schema": a.REPORT_SCHEMA, "ok": True})
            self.assertEqual(json.loads(path.read_text()), {"schema": a.REPORT_SCHEMA, "ok": True})

    def test_workflow_pins_tools_and_preserves_non_authority_boundary(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/w1-accelerated-regression.yml").read_text()
        self.assertIn("astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d", workflow)
        self.assertIn("version: '0.11.33'", workflow)
        self.assertIn("uv sync --locked --group dev", workflow)
        self.assertIn("uv run --locked", workflow)
        self.assertIn("cancel-in-progress: true", workflow)
        self.assertIn("authority_effect': False", workflow)
        self.assertIn("shared_cache_reuse': False", workflow)
        self.assertNotIn("secrets.", workflow)


if __name__ == "__main__":
    unittest.main()
