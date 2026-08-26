from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest

from controller.w1 import s2_source_identity_audit as audit


class S2SourceIdentityAuditTests(unittest.TestCase):
    def _tree(self, root: Path) -> str:
        source = root / audit.SOURCE_PATH
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("print('exact-s2')\n", encoding="utf-8")
        sha = hashlib.sha256(source.read_bytes()).hexdigest()
        for rel, count in audit.DECLARED_BINDINGS.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text((sha + "\n") * count, encoding="utf-8")
        return sha

    def test_exact_declared_inventory_passes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            sha = self._tree(root)
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "PASS_EXACT_SOURCE_IDENTITY_AUDIT_NONAUTHORITY")
        self.assertEqual(result["evidence"]["source_sha256"], sha)
        self.assertEqual(result["evidence"]["undeclared_binding_consumers"], [])
        self.assertTrue(all(result["evidence"]["checks"].values()))
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["w1_verified"])

    def test_stale_declared_binding_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            current = self._tree(root)
            rel = next(iter(audit.DECLARED_BINDINGS))
            path = root / rel
            text = path.read_text(encoding="utf-8")
            path.write_text(text.replace(current, "0" * 64, 1), encoding="utf-8")
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_SOURCE_IDENTITY_DRIFT")
        self.assertFalse(result["evidence"]["declared_bindings"][rel]["ok"])
        self.assertIn("0" * 64, result["evidence"]["declared_bindings"][rel]["stale_sha256_literals"])

    def test_missing_declared_binding_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._tree(root)
            rel = next(iter(audit.DECLARED_BINDINGS))
            (root / rel).unlink()
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_SOURCE_IDENTITY_DRIFT")
        self.assertFalse(result["evidence"]["declared_bindings"][rel]["ok"])

    def test_symlinked_declared_binding_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._tree(root)
            rel = next(iter(audit.DECLARED_BINDINGS))
            path = root / rel
            target = root / "outside-binding.txt"
            target.write_bytes(path.read_bytes())
            path.unlink()
            try:
                path.symlink_to(target)
            except OSError:
                self.skipTest("symlink unsupported")
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_SOURCE_IDENTITY_DRIFT")
        self.assertFalse(result["evidence"]["declared_bindings"][rel]["ok"])

    def test_symlinked_source_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._tree(root)
            source = root / audit.SOURCE_PATH
            target = root / "outside-launcher.py"
            target.write_bytes(source.read_bytes())
            source.unlink()
            try:
                source.symlink_to(target)
            except OSError:
                self.skipTest("symlink unsupported")
            with self.assertRaisesRegex(RuntimeError, "S2 source missing"):
                audit.evaluate(root)

    def test_duplicate_declared_binding_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            current = self._tree(root)
            rel = next(iter(audit.DECLARED_BINDINGS))
            path = root / rel
            path.write_text(path.read_text(encoding="utf-8") + current + "\n", encoding="utf-8")
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_SOURCE_IDENTITY_DRIFT")
        self.assertFalse(result["evidence"]["declared_bindings"][rel]["ok"])

    def test_new_undeclared_consumer_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            current = self._tree(root)
            consumer = root / ".github/workflows/unregistered-s2-consumer.yml"
            consumer.parent.mkdir(parents=True, exist_ok=True)
            consumer.write_text(
                f"source: {audit.SOURCE_PATH}\nexpected: {current}\n",
                encoding="utf-8",
            )
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_SOURCE_IDENTITY_DRIFT")
        self.assertEqual(
            result["evidence"]["undeclared_binding_consumers"][0]["path"],
            ".github/workflows/unregistered-s2-consumer.yml",
        )

    def test_shell_consumer_with_stale_sha_is_not_suffix_blind(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._tree(root)
            consumer = root / "scripts/ghost_pin.sh"
            consumer.parent.mkdir(parents=True, exist_ok=True)
            consumer.write_text(
                f"# source={audit.SOURCE_PATH}\nEXPECTED={'f' * 64}\n",
                encoding="utf-8",
            )
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_SOURCE_IDENTITY_DRIFT")
        self.assertEqual(result["evidence"]["undeclared_binding_consumers"][0]["path"], "scripts/ghost_pin.sh")

    def test_extensionless_partial_launcher_hint_with_stale_sha_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._tree(root)
            consumer = root / "Dockerfile"
            consumer.write_text(
                f"# launcher_v2 expected {'e' * 64}\nFROM scratch\n",
                encoding="utf-8",
            )
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_SOURCE_IDENTITY_DRIFT")
        hit = result["evidence"]["undeclared_binding_consumers"][0]
        self.assertEqual(hit["path"], "Dockerfile")
        self.assertEqual(hit["source_hint"], "launcher_v2")

    def test_binary_file_with_nul_is_ignored(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._tree(root)
            binary = root / "scripts/blob.bin"
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes((audit.SOURCE_PATH + " " + "d" * 64).encode() + b"\x00tail")
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "PASS_EXACT_SOURCE_IDENTITY_AUDIT_NONAUTHORITY")

    def test_unrelated_sha_without_source_hint_is_not_consumer(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._tree(root)
            note = root / "Makefile"
            note.write_text("OTHER_COMPONENT_SHA=" + "c" * 64 + "\n", encoding="utf-8")
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "PASS_EXACT_SOURCE_IDENTITY_AUDIT_NONAUTHORITY")

    def test_historical_research_reference_is_not_current_policy_consumer(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            current = self._tree(root)
            research = root / "research/historical.md"
            research.parent.mkdir(parents=True, exist_ok=True)
            research.write_text(
                f"historical {audit.SOURCE_PATH} {current}\n",
                encoding="utf-8",
            )
            result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "PASS_EXACT_SOURCE_IDENTITY_AUDIT_NONAUTHORITY")


if __name__ == "__main__":
    unittest.main()
