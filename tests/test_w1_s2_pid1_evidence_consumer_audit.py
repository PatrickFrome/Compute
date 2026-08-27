from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from controller.w1 import s2_pid1_evidence_consumer_audit as audit


class S2Pid1EvidenceConsumerAuditTests(unittest.TestCase):
    def make_root(self) -> tuple[tempfile.TemporaryDirectory, Path]:
        tmp = tempfile.TemporaryDirectory()
        root = Path(tmp.name)
        (root / "current.txt").write_text(audit.CURRENT_PID1_SCHEMA, encoding="utf-8")
        return tmp, root

    def test_clean_v3_consumer_passes(self):
        tmp, root = self.make_root()
        self.addCleanup(tmp.cleanup)
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "PASS_PID1_EVIDENCE_CONSUMER_AUDIT_NONAUTHORITY")
        self.assertTrue(all(result["evidence"]["checks"].values()))
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["w1_verified"])

    def test_legacy_v2_schema_fails_closed(self):
        tmp, root = self.make_root()
        self.addCleanup(tmp.cleanup)
        (root / "stale.py").write_text(audit.LEGACY_PID1_SCHEMA, encoding="utf-8")
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_PID1_EVIDENCE_CONSUMER_DRIFT")
        self.assertEqual(result["evidence"]["legacy_schema_consumers"], ["stale.py"])

    def test_python_old_probe_layout_fails_closed(self):
        tmp, root = self.make_root()
        self.addCleanup(tmp.cleanup)
        (root / "consumer.py").write_text(
            "value = receipt['evidence']['probe']['rlimit_nofile_before']\n",
            encoding="utf-8",
        )
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_PID1_EVIDENCE_CONSUMER_DRIFT")
        self.assertEqual(result["evidence"]["legacy_layout_consumers"][0]["path"], "consumer.py")

    def test_jsonpath_old_checks_layout_fails_closed(self):
        tmp, root = self.make_root()
        self.addCleanup(tmp.cleanup)
        (root / "consumer.cfg").write_text(
            "$.evidence.checks.rlimit_nofile_shadow_verified\n",
            encoding="utf-8",
        )
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_PID1_EVIDENCE_CONSUMER_DRIFT")

    def test_sql_json_path_old_layout_fails_closed(self):
        tmp, root = self.make_root()
        self.addCleanup(tmp.cleanup)
        (root / "consumer.sql").write_text(
            "receipt #>> '{evidence,probe,rlimit_nofile_after}'\n",
            encoding="utf-8",
        )
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_PID1_EVIDENCE_CONSUMER_DRIFT")

    def test_v3_exclusion_metadata_is_not_misclassified(self):
        tmp, root = self.make_root()
        self.addCleanup(tmp.cleanup)
        (root / "metadata.md").write_text(
            "excluded_host_dependent_fields includes rlimit_nofile_before and rlimit_nofile_after\n",
            encoding="utf-8",
        )
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "PASS_PID1_EVIDENCE_CONSUMER_AUDIT_NONAUTHORITY")
        self.assertEqual(result["evidence"]["legacy_layout_consumers"], [])

    def test_research_history_does_not_block_current_contract(self):
        tmp, root = self.make_root()
        self.addCleanup(tmp.cleanup)
        research = root / "research"
        research.mkdir()
        (research / "old.md").write_text(audit.LEGACY_PID1_SCHEMA, encoding="utf-8")
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "PASS_PID1_EVIDENCE_CONSUMER_AUDIT_NONAUTHORITY")

    def test_missing_current_v3_consumer_fails_closed(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / "neutral.txt").write_text("no pid1 schema here", encoding="utf-8")
        result = audit.evaluate(root)
        self.assertEqual(result["outcome"], "FAIL_PID1_EVIDENCE_CONSUMER_DRIFT")
        self.assertFalse(result["evidence"]["checks"]["current_v3_schema_is_consumed"])


if __name__ == "__main__":
    unittest.main()
