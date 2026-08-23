import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "coordination" / "execution" / "cross_provider_verify.py"
spec = importlib.util.spec_from_file_location("cross_provider_verify", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def manifest(provider: str, *, git_sha: str = "a" * 40, tree_sha: str = "b" * 40,
             contract_sha: str = "c" * 64, result_sha: str = "d" * 64):
    return {
        "provider": {"kind": provider},
        "source": {"git_sha": git_sha, "tree_sha": tree_sha},
        "contract": {
            "sha256": contract_sha,
            "provider_neutral_result_sha256": result_sha,
        },
        "authority": {
            "execution_authority": False,
            "canonical": False,
            "authority_effect": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
        },
    }


class CrossProviderVerifyTests(unittest.TestCase):
    def test_equal_roots_pass(self):
        roots = mod.compare_manifests(manifest("github-actions"), manifest("appveyor"))
        self.assertEqual(roots["git_sha"], "a" * 40)
        self.assertEqual(roots["provider_neutral_result_sha256"], "d" * 64)

    def test_result_mismatch_fails(self):
        with self.assertRaisesRegex(ValueError, "cross-provider root mismatch"):
            mod.compare_manifests(
                manifest("github-actions"),
                manifest("appveyor", result_sha="e" * 64),
            )

    def test_authority_overclaim_fails(self):
        appveyor = manifest("appveyor")
        appveyor["authority"]["w1_verified"] = True
        with self.assertRaisesRegex(ValueError, "w1_verified must be false"):
            mod.compare_manifests(manifest("github-actions"), appveyor)

    def test_wrong_provider_fails(self):
        with self.assertRaisesRegex(ValueError, "provider.kind mismatch"):
            mod.compare_manifests(manifest("github-actions"), manifest("github-actions"))

    def test_history_url_is_recent_build_catalog(self):
        url = mod.history_url("PatrickFrome", "compute")
        self.assertTrue(url.endswith("/projects/PatrickFrome/compute/history?recordsNumber=30"), url)

    def test_build_version_url_encodes_version(self):
        url = mod.build_version_url("PatrickFrome", "compute", "1.0.17/test")
        self.assertTrue(url.endswith("/build/1.0.17%2Ftest"), url)

    def test_artifact_url_preserves_nested_path(self):
        url = mod.artifact_url("job-1", "evidence/appveyor-zero-spend.json")
        self.assertTrue(url.endswith("/evidence/appveyor-zero-spend.json"), url)

    def test_artifact_identity_beats_metadata_identity(self):
        github = manifest("github-actions", git_sha="1" * 40)
        appveyor = manifest("appveyor", git_sha="1" * 40)
        roots = mod.compare_manifests(github, appveyor)
        self.assertEqual(roots["git_sha"], "1" * 40)


if __name__ == "__main__":
    unittest.main()
