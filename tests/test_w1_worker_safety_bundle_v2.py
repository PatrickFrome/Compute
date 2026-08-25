from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "worker/native_linux/worker_safety_bundle_collector_v2.py"
spec = importlib.util.spec_from_file_location("bundle_v2", PATH)
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class BundleV2Tests(unittest.TestCase):
    def test_rlimit_targets_cover_production_minimum_dimensions(self):
        self.assertEqual(set(m.RLIMIT_TARGETS), {"nproc", "nofile", "cpu_seconds", "fsize_bytes", "address_space_bytes"})
        self.assertGreaterEqual(m.RLIMIT_TARGETS["address_space_bytes"][1], 268435456)

    def test_output_source_is_canonical_and_authority_always_false(self):
        result = m.collect({"git_sha": "a" * 40, "tree_sha": "b" * 40})
        self.assertIn(result["outcome"], {"WORKER_SAFETY_BUNDLE_ELIGIBLE_NONAUTHORITY", "REJECTED_WORKER_SAFETY_BUNDLE"})
        for key in ("input_provenance_verified", "provider_identity_verified", "safety_verified", "worker_admitted", "w1_verified", "canonical", "authority_effect"):
            self.assertFalse(result[key])
        self.assertEqual(result["evidence"]["raw"]["source"]["git_sha"], "a" * 40)
        self.assertEqual(len(result["bundle_sha256"]), 64)

    def test_invalid_source_rejected(self):
        with self.assertRaises(ValueError):
            m.collect({"git_sha": "not-a-sha", "tree_sha": "b" * 40})


if __name__ == "__main__":
    unittest.main()
