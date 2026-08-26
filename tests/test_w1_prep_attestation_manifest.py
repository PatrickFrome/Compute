from __future__ import annotations

import copy
from pathlib import Path
import tempfile
import unittest

from controller.w1 import build_w1_prep_attestation_manifest as manifest


class W1PrepAttestationManifestTests(unittest.TestCase):
    def _fixture_root(self) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        paths = {
            "controller/w1/a.py": b"print('a')\n",
            "worker/native_linux/b.py": b"print('b')\n",
            "supabase/migrations/20260826000000_w1_fixture.sql": b"select 1;\n",
            "tests/test_w1_fixture.py": b"def test_fixture(): pass\n",
            ".github/workflows/w1-fixture.yml": b"name: fixture\n",
            "README.md": b"excluded\n",
        }
        for rel, raw in paths.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        return root

    def test_deterministic_manifest_selects_only_w1_surface(self):
        root = self._fixture_root()
        value = manifest.build_manifest(
            root=root,
            git_sha="1" * 40,
            tree_sha="2" * 40,
            source_ref="refs/heads/work/w1-sandbox-launcher-prep",
        )
        manifest.validate_manifest(value)
        paths = [item["path"] for item in value["evidence"]["files"]]
        self.assertEqual(paths, sorted(paths))
        self.assertEqual(len(paths), 5)
        self.assertNotIn("README.md", paths)
        self.assertFalse(value["artifact_attestation_verified"])
        self.assertFalse(value["w1_verified"])
        self.assertFalse(value["authority_effect"])

    def test_same_inputs_produce_same_hashes(self):
        root = self._fixture_root()
        kwargs = dict(root=root, git_sha="1" * 40, tree_sha="2" * 40, source_ref="refs/heads/x")
        a = manifest.build_manifest(**kwargs)
        b = manifest.build_manifest(**kwargs)
        self.assertEqual(a, b)

    def test_file_change_changes_manifest_hash(self):
        root = self._fixture_root()
        kwargs = dict(root=root, git_sha="1" * 40, tree_sha="2" * 40, source_ref="refs/heads/x")
        a = manifest.build_manifest(**kwargs)
        (root / "controller/w1/a.py").write_text("print('changed')\n")
        b = manifest.build_manifest(**kwargs)
        self.assertNotEqual(a["evidence_sha256"], b["evidence_sha256"])
        self.assertNotEqual(a["evidence"]["files_sha256"], b["evidence"]["files_sha256"])

    def test_manifest_hash_tamper_is_rejected(self):
        root = self._fixture_root()
        value = manifest.build_manifest(root=root, git_sha="1" * 40, tree_sha="2" * 40, source_ref="refs/heads/x")
        value["evidence"]["file_count"] += 1
        with self.assertRaisesRegex(ValueError, "evidence hash mismatch"):
            manifest.validate_manifest(value)

    def test_self_asserted_attestation_is_rejected(self):
        root = self._fixture_root()
        value = manifest.build_manifest(root=root, git_sha="1" * 40, tree_sha="2" * 40, source_ref="refs/heads/x")
        value["artifact_attestation_verified"] = True
        with self.assertRaisesRegex(ValueError, "cannot self-assert"):
            manifest.validate_manifest(value)

    def test_self_asserted_w1_is_rejected(self):
        root = self._fixture_root()
        value = manifest.build_manifest(root=root, git_sha="1" * 40, tree_sha="2" * 40, source_ref="refs/heads/x")
        value["w1_verified"] = True
        with self.assertRaisesRegex(ValueError, "w1_verified"):
            manifest.validate_manifest(value)

    def test_bad_source_ref_is_rejected(self):
        root = self._fixture_root()
        with self.assertRaisesRegex(ValueError, "refs"):
            manifest.build_manifest(root=root, git_sha="1" * 40, tree_sha="2" * 40, source_ref="main")

    def test_symlink_is_not_selected(self):
        root = self._fixture_root()
        target = root / "controller/w1/a.py"
        link = root / "controller/w1/link.py"
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest("symlink unsupported")
        value = manifest.build_manifest(root=root, git_sha="1" * 40, tree_sha="2" * 40, source_ref="refs/heads/x")
        paths = [item["path"] for item in value["evidence"]["files"]]
        self.assertNotIn("controller/w1/link.py", paths)


if __name__ == "__main__":
    unittest.main()
