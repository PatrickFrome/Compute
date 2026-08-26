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
