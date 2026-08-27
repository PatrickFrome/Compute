from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

from controller.roadmap import roadmap_projection_guard as guard


class MainRoadmapProjectionGuardTests(unittest.TestCase):
    def git(self, repo: Path, *args: str, check: bool = True) -> str:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=check,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def write(self, repo: Path, path: str, text: str) -> None:
        target = repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def commit(self, repo: Path, message: str) -> str:
        self.git(repo, "add", "-A")
        self.git(repo, "commit", "-m", message)
        return self.git(repo, "rev-parse", "HEAD")

    def fixture(self):
        temp = tempfile.TemporaryDirectory()
        repo = Path(temp.name)
        self.git(repo, "init")
        self.git(repo, "config", "user.email", "projection@example.invalid")
        self.git(repo, "config", "user.name", "Projection Guard")
        self.write(repo, "base.txt", "base\n")
        base = self.commit(repo, "base")

        self.git(repo, "branch", "source-parent", base)
        self.git(repo, "checkout", "-b", "source", base)
        for index, path in enumerate(guard.PROJECTED_PATHS):
            self.write(repo, path, f"projected-{index}\n")
        source = self.commit(repo, "source accelerator")

        self.git(repo, "checkout", "-b", "projection", base)
        for index, path in enumerate(guard.PROJECTED_PATHS):
            self.write(repo, path, f"projected-{index}\n")
        projected = self.commit(repo, "pure projection")

        self.write(
            repo,
            ".github/workflows/main-roadmap-cycle-oracle.yml",
            "projected-0\nwork/main-roadmap-accelerators-v3\n",
        )
        self.write(repo, ".github/workflows/main-roadmap-projection-guard.yml", "guard workflow\n")
        self.write(repo, "controller/roadmap/roadmap_projection_guard.py", "guard source\n")
        self.write(repo, "tests/test_main_roadmap_projection_guard.py", "guard tests\n")
        candidate = self.commit(repo, "projection guard")
        return temp, repo, base, source, projected, candidate

    def evaluate(self, repo: Path, base: str, source: str, projected: str, candidate: str):
        with (
            mock.patch.object(guard, "EXPECTED_SOURCE_PARENT", base),
            mock.patch.object(guard, "EXPECTED_SOURCE_COMMIT", source),
        ):
            return guard.evaluate(
                repo=repo,
                base_ref=base,
                projected_ref=projected,
                candidate_ref=candidate,
                source_parent_ref=base,
                source_commit_ref=source,
            )

    def test_exact_two_commit_projection_passes(self):
        temp, repo, base, source, projected, candidate = self.fixture()
        self.addCleanup(temp.cleanup)
        result = self.evaluate(repo, base, source, projected, candidate)
        self.assertTrue(result["projection_verified"])
        self.assertEqual(result["outcome"], "PASS_MAIN_ROADMAP_PROJECTION_NONAUTHORITY")
        self.assertEqual(result["evidence"]["projection"]["commit_count_from_base"], 2)
        self.assertEqual(
            result["evidence"]["source"]["stable_patch_id"],
            result["evidence"]["projection"]["stable_patch_id"],
        )
        self.assertTrue(all(result["evidence"]["projection"]["blob_match"].values()))
        self.assertIsInstance(result["evidence"]["range_diff_diagnostic"], str)
        self.assertTrue(result["evidence"]["range_diff_diagnostic"])
        self.assertFalse(any(result["boundaries"].values()))

    def test_range_diff_metadata_difference_is_diagnostic_only(self):
        temp, repo, base, source, projected, candidate = self.fixture()
        self.addCleanup(temp.cleanup)
        result = self.evaluate(repo, base, source, projected, candidate)
        diagnostic = result["evidence"]["range_diff_diagnostic"]
        self.assertTrue(result["projection_verified"])
        self.assertIn("!", diagnostic)
        self.assertEqual(
            result["evidence"]["source"]["stable_patch_id"],
            result["evidence"]["projection"]["stable_patch_id"],
        )
        self.assertTrue(all(result["evidence"]["projection"]["blob_match"].values()))

    def test_projection_payload_mutation_blocks(self):
        temp, repo, base, source, _projected, _candidate = self.fixture()
        self.addCleanup(temp.cleanup)
        self.git(repo, "reset", "--hard", base)
        for index, path in enumerate(guard.PROJECTED_PATHS):
            value = "tampered\n" if index == 2 else f"projected-{index}\n"
            self.write(repo, path, value)
        projected = self.commit(repo, "tampered projection")
        self.write(repo, ".github/workflows/main-roadmap-cycle-oracle.yml", "projected-0\nwork/main-roadmap-accelerators-v3\n")
        self.write(repo, ".github/workflows/main-roadmap-projection-guard.yml", "guard workflow\n")
        self.write(repo, "controller/roadmap/roadmap_projection_guard.py", "guard source\n")
        self.write(repo, "tests/test_main_roadmap_projection_guard.py", "guard tests\n")
        candidate = self.commit(repo, "guard")
        result = self.evaluate(repo, base, source, projected, candidate)
        self.assertFalse(result["projection_verified"])
        self.assertIn("projected_blobs_exact", result["evidence"]["failed_checks"])
        self.assertIn("stable_patch_id_exact", result["evidence"]["failed_checks"])

    def test_unexpected_projection_path_blocks(self):
        temp, repo, base, source, _projected, _candidate = self.fixture()
        self.addCleanup(temp.cleanup)
        self.git(repo, "reset", "--hard", base)
        for index, path in enumerate(guard.PROJECTED_PATHS):
            self.write(repo, path, f"projected-{index}\n")
        self.write(repo, "worker/native_linux/forbidden.txt", "not roadmap\n")
        projected = self.commit(repo, "projection plus foreign path")
        self.write(repo, ".github/workflows/main-roadmap-cycle-oracle.yml", "projected-0\nwork/main-roadmap-accelerators-v3\n")
        self.write(repo, ".github/workflows/main-roadmap-projection-guard.yml", "guard workflow\n")
        self.write(repo, "controller/roadmap/roadmap_projection_guard.py", "guard source\n")
        self.write(repo, "tests/test_main_roadmap_projection_guard.py", "guard tests\n")
        candidate = self.commit(repo, "guard")
        result = self.evaluate(repo, base, source, projected, candidate)
        self.assertIn("projection_changed_paths_exact", result["evidence"]["failed_checks"])
        self.assertIn("final_changed_paths_declared", result["evidence"]["failed_checks"])

    def test_guard_cannot_mutate_projected_payload(self):
        temp, repo, base, source, projected, _candidate = self.fixture()
        self.addCleanup(temp.cleanup)
        self.git(repo, "reset", "--hard", projected)
        self.write(repo, ".github/workflows/main-roadmap-cycle-oracle.yml", "projected-0\nwork/main-roadmap-accelerators-v3\n")
        self.write(repo, ".github/workflows/main-roadmap-projection-guard.yml", "guard workflow\n")
        self.write(repo, "controller/roadmap/roadmap_projection_guard.py", "guard source\n")
        self.write(repo, "tests/test_main_roadmap_projection_guard.py", "guard tests\n")
        self.write(repo, "controller/roadmap/roadmap_cycle_oracle.py", "mutated after projection\n")
        candidate = self.commit(repo, "guard mutates payload")
        result = self.evaluate(repo, base, source, projected, candidate)
        self.assertIn("guard_changed_paths_exact", result["evidence"]["failed_checks"])
        self.assertIn("guard_preserves_projected_payload", result["evidence"]["failed_checks"])

    def test_extra_commit_blocks_even_if_final_tree_looks_right(self):
        temp, repo, base, source, _projected, _candidate = self.fixture()
        self.addCleanup(temp.cleanup)
        self.git(repo, "reset", "--hard", base)
        self.write(repo, "temporary.txt", "one\n")
        self.commit(repo, "hidden history")
        self.git(repo, "rm", "temporary.txt")
        for index, path in enumerate(guard.PROJECTED_PATHS):
            self.write(repo, path, f"projected-{index}\n")
        projected = self.commit(repo, "projection")
        self.write(repo, ".github/workflows/main-roadmap-cycle-oracle.yml", "projected-0\nwork/main-roadmap-accelerators-v3\n")
        self.write(repo, ".github/workflows/main-roadmap-projection-guard.yml", "guard workflow\n")
        self.write(repo, "controller/roadmap/roadmap_projection_guard.py", "guard source\n")
        self.write(repo, "tests/test_main_roadmap_projection_guard.py", "guard tests\n")
        candidate = self.commit(repo, "guard")
        result = self.evaluate(repo, base, source, projected, candidate)
        self.assertIn("projection_direct_parent_is_live_base", result["evidence"]["failed_checks"])
        self.assertIn("candidate_two_commits_ahead", result["evidence"]["failed_checks"])

    def test_receipt_is_deterministic_for_same_git_graph(self):
        temp, repo, base, source, projected, candidate = self.fixture()
        self.addCleanup(temp.cleanup)
        left = self.evaluate(repo, base, source, projected, candidate)
        right = self.evaluate(repo, base, source, projected, candidate)
        self.assertEqual(left["evidence_sha256"], right["evidence_sha256"])


if __name__ == "__main__":
    unittest.main()
