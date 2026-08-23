from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[2] / "coordination" / "execution" / "zero_spend_runner.py"
SPEC = importlib.util.spec_from_file_location("zero_spend_runner", MODULE_PATH)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class ZeroSpendRunnerTests(unittest.TestCase):
    def test_hash_is_key_order_invariant(self):
        self.assertEqual(
            runner.sha256_json({"b": 2, "a": 1}),
            runner.sha256_json({"a": 1, "b": 2}),
        )

    def test_secret_like_key_is_rejected(self):
        with self.assertRaises(ValueError):
            runner.assert_no_secrets({"api_key": "not-even-a-real-secret"})

    def test_secret_like_value_is_rejected(self):
        with self.assertRaises(ValueError):
            runner.assert_no_secrets({"value": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"})

    def test_both_execution_providers_are_explicit(self):
        self.assertEqual(set(runner.PROVIDERS), {"github-actions", "appveyor"})

    def test_contract_checks_do_not_use_shell_strings(self):
        for command in runner.CHECKS:
            self.assertIsInstance(command, list)
            self.assertGreaterEqual(len(command), 2)
            self.assertNotIn("sh -c", " ".join(command))

    def test_provider_neutral_contract_has_no_authority(self):
        contract = {
            "schema": "metaengine.compute.a1.zero-spend-execution-contract.h205f22.v1",
            "check_commands": runner.CHECKS,
            "source_binding": "EXACT_GIT_SHA_AND_TREE",
            "authority_effect": False,
        }
        self.assertFalse(contract["authority_effect"])
        self.assertEqual(len(runner.sha256_json(contract)), 64)


if __name__ == "__main__":
    unittest.main()
