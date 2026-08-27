from __future__ import annotations

import copy
import unittest

from controller.w1 import s2_pid1_resource_hardening_shadow_canary as canary


SOURCE = """
PR_SET_DUMPABLE PR_GET_DUMPABLE SUID_DUMP_DISABLE _harden_pid1_runtime
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
os.environ.clear()
os.environ.update(sanitized)
_harden_pid1_runtime(workspace)
return _pid1_reaper(argv, workspace, original_mask)
"""
SOURCE_SHA = "1" * 64


def base_probe() -> dict:
    return {
        "secret_present_before_live_scrub": True,
        "secret_present_after_live_scrub": False,
        "dumpable_after": 0,
        "rlimit_core_after": [0, 0],
        "rlimit_nofile_before": [1048576, 1048576],
        "rlimit_nofile_shadow_target": 4096,
        "rlimit_nofile_shadow_probe_applied": True,
        "rlimit_nofile_after": [4096, 4096],
    }


class S2Pid1ResourceHardeningShadowCanaryTests(unittest.TestCase):
    def test_adopted_hardening_passes(self):
        result = canary.compose(base_probe(), SOURCE, SOURCE_SHA)
        self.assertEqual(result["outcome"], "ACCEPT_ADOPTED_PID1_DUMPABLE_CORE")
        self.assertTrue(all(result["evidence"]["checks"].values()))
        self.assertTrue(result["environment"]["nofile_shadow_target_reached"])
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["w1_verified"])

    def test_host_dependent_nofile_values_do_not_change_adopted_evidence_hash(self):
        high = base_probe()
        low = copy.deepcopy(high)
        low["rlimit_nofile_before"] = [128, 128]
        low["rlimit_nofile_shadow_target"] = 128
        low["rlimit_nofile_shadow_probe_applied"] = False
        low["rlimit_nofile_after"] = [128, 128]

        high_result = canary.compose(high, SOURCE, SOURCE_SHA)
        low_result = canary.compose(low, SOURCE, SOURCE_SHA)

        self.assertEqual(high_result["outcome"], "ACCEPT_ADOPTED_PID1_DUMPABLE_CORE")
        self.assertEqual(low_result["outcome"], "ACCEPT_ADOPTED_PID1_DUMPABLE_CORE")
        self.assertEqual(high_result["evidence_sha256"], low_result["evidence_sha256"])
        self.assertNotEqual(high_result["environment_sha256"], low_result["environment_sha256"])
        self.assertTrue(high_result["environment"]["nofile_shadow_target_reached"])
        self.assertFalse(low_result["environment"]["nofile_shadow_target_reached"])

    def test_host_dependent_values_are_not_in_deterministic_probe_or_checks(self):
        result = canary.compose(base_probe(), SOURCE, SOURCE_SHA)
        self.assertEqual(
            set(result["evidence"]["probe"]),
            set(canary.ADOPTED_PROBE_FIELDS),
        )
        for field in canary.ENVIRONMENT_PROBE_FIELDS:
            self.assertNotIn(field, result["evidence"]["probe"])
            self.assertNotIn(field, result["evidence"]["checks"])
        self.assertEqual(
            result["evidence"]["excluded_host_dependent_fields"],
            list(canary.ENVIRONMENT_PROBE_FIELDS),
        )

    def test_environment_block_is_integrity_hashed(self):
        result = canary.compose(base_probe(), SOURCE, SOURCE_SHA)
        self.assertEqual(result["environment_sha256"], canary.canonical_hash(result["environment"]))
        self.assertEqual(
            result["environment"]["classification"],
            "HOST_DEPENDENT_SHADOW_OBSERVATION_NONAUTHORITY",
        )

    def test_dumpability_failure_still_blocks(self):
        probe = base_probe()
        probe["dumpable_after"] = 1
        result = canary.compose(probe, SOURCE, SOURCE_SHA)
        self.assertEqual(result["outcome"], "REGRESSION_BLOCKED")
        self.assertFalse(result["evidence"]["checks"]["pr_set_dumpable_zero_verified"])

    def test_core_limit_failure_still_blocks(self):
        probe = base_probe()
        probe["rlimit_core_after"] = [0, 1024]
        result = canary.compose(probe, SOURCE, SOURCE_SHA)
        self.assertEqual(result["outcome"], "REGRESSION_BLOCKED")
        self.assertFalse(result["evidence"]["checks"]["rlimit_core_zero_verified"])

    def test_missing_probe_field_fails_closed(self):
        probe = base_probe()
        del probe["rlimit_nofile_before"]
        with self.assertRaisesRegex(ValueError, "missing probe fields"):
            canary.compose(probe, SOURCE, SOURCE_SHA)

    def test_source_composition_failure_still_blocks(self):
        result = canary.compose(base_probe(), "return _pid1_reaper(argv, workspace, original_mask)", SOURCE_SHA)
        self.assertEqual(result["outcome"], "REGRESSION_BLOCKED")
        self.assertFalse(result["evidence"]["checks"]["integrated_dumpability_fence_present"])


if __name__ == "__main__":
    unittest.main()
