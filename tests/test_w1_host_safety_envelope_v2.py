from __future__ import annotations

import copy
from pathlib import Path
import unittest

from controller.w1 import host_safety_envelope_validator as validator
from worker.native_linux import host_safety_envelope_probe as probe


ROOT = Path(__file__).resolve().parents[1]


def eligible_observation() -> dict:
    value = {
        "schema": probe.SCHEMA,
        "policy_key": probe.POLICY_KEY,
        "source": {"git_sha": "a" * 40, "tree_sha": "b" * 40},
        "host": {
            "os": "linux",
            "arch": "x86_64",
            "effective_uid": 1000,
            "no_new_privs": True,
            "seccomp_mode": 2,
            "seccomp_filters": 1,
            "mount_namespace_isolated": True,
        },
        "seccomp_filter_canary": {
            "arch": "x86_64",
            "arch_checked": True,
            "filter_installed": True,
            "blocked_syscall": True,
            "seccomp_mode": 2,
            "seccomp_filters": 1,
            "policy_digest": "c" * 64,
            "error": None,
        },
        "pidfd_lifecycle": {"open": True, "send_signal": True, "waitid": True, "exit_observed": True, "error": None},
        "cgroup_current": {
            "version": 2,
            "relative_path": "/worker.slice/w1",
            "controllers": ["cpu", "memory", "pids"],
            "cgroup_kill_present": True,
            "cpu_max": "10000 100000",
            "memory_max": "536870912",
            "pids_max": "64",
            "finite_cpu_max": True,
            "finite_memory_max": True,
            "finite_pids_max": True,
        },
        "cgroup_tree_canary": {
            "created": True,
            "limits_written": True,
            "cpu_max": "10000 100000",
            "memory_max": "67108864",
            "pids_max": "8",
            "parent_contained": True,
            "grandchild_contained": True,
            "tree_killed": True,
            "error": None,
        },
        "rlimits": {
            "cpu_seconds": {"soft": 60, "hard": 120, "soft_finite": True, "hard_finite": True},
            "fsize_bytes": {"soft": 1048576, "hard": 1048576, "soft_finite": True, "hard_finite": True},
            "address_space_bytes": {"soft": 1073741824, "hard": 1073741824, "soft_finite": True, "hard_finite": True},
            "nofile": {"soft": 1024, "hard": 4096, "soft_finite": True, "hard_finite": True},
            "nproc": {"soft": 128, "hard": 256, "soft_finite": True, "hard_finite": True},
        },
        "workspace": {
            "dirfd_bound": True,
            "resolve_beneath": True,
            "no_magiclinks": True,
            "no_symlinks": True,
            "no_xdev": True,
            "inside_opened": True,
            "parent_escape_blocked": True,
            "symlink_escape_blocked": True,
            "error": None,
        },
        "network": {
            "network_namespace_isolated": True,
            "interfaces": ["lo"],
            "default_ipv4_route": False,
            "default_ipv6_route": False,
            "default_deny_pass": True,
        },
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "worker_admitted": False,
            "w1_verified": False,
            "persistence_claimed": False,
            "provider_mutation": False,
        },
    }
    value["evidence_sha256"] = probe.canonical_hash(value)
    return value


def rehash(value: dict) -> None:
    value.pop("evidence_sha256", None)
    value["evidence_sha256"] = probe.canonical_hash(value)


class HostSafetyEnvelopeValidatorTests(unittest.TestCase):
    def test_full_envelope_is_eligible_but_non_persistent(self):
        result = validator.evaluate(eligible_observation())
        self.assertTrue(result["safety_eligible"])
        self.assertEqual("SAFETY_ENVELOPE_ELIGIBLE_NON_PERSISTENT", result["outcome"])
        self.assertTrue(result["requires_independent_persistence_receipts"])
        self.assertFalse(result["authority"]["worker_admitted"])
        self.assertFalse(result["authority"]["w1_verified"])

    def test_each_old_gap_remains_fail_closed(self):
        mutations = {
            "seccomp": lambda x: x["seccomp_filter_canary"].__setitem__("blocked_syscall", False),
            "pidfd": lambda x: x["pidfd_lifecycle"].__setitem__("waitid", False),
            "cgroup_limits": lambda x: x["cgroup_tree_canary"].__setitem__("limits_written", False),
            "workspace": lambda x: x["workspace"].__setitem__("parent_escape_blocked", False),
            "tree": lambda x: x["cgroup_tree_canary"].__setitem__("tree_killed", False),
            "network": lambda x: x["network"].__setitem__("default_ipv4_route", True),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                value = eligible_observation()
                mutate(value)
                rehash(value)
                result = validator.evaluate(value)
                self.assertFalse(result["safety_eligible"])
                self.assertEqual("REJECTED_SAFETY_ENVELOPE", result["outcome"])

    def test_unbounded_rlimit_blocks(self):
        value = eligible_observation()
        value["rlimits"]["address_space_bytes"]["soft_finite"] = False
        rehash(value)
        result = validator.evaluate(value)
        self.assertFalse(result["safety_eligible"])
        self.assertIn("rlimit_address_space_bytes", result["failures"])

    def test_below_policy_minimum_rlimit_blocks(self):
        value = eligible_observation()
        value["rlimits"]["nofile"]["soft"] = 32
        rehash(value)
        result = validator.evaluate(value)
        self.assertFalse(result["safety_eligible"])
        self.assertIn("rlimit_nofile", result["failures"])

    def test_evidence_tamper_blocks(self):
        value = eligible_observation()
        value["network"]["interfaces"].append("eth0")
        result = validator.evaluate(value)
        self.assertFalse(result["safety_eligible"])
        self.assertIn("evidence_integrity", result["failures"])

    def test_authority_injection_blocks(self):
        value = eligible_observation()
        value["authority"]["worker_admitted"] = True
        rehash(value)
        result = validator.evaluate(value)
        self.assertFalse(result["safety_eligible"])
        self.assertIn("authority_neutral", result["failures"])

    def test_missing_controller_blocks(self):
        value = eligible_observation()
        value["cgroup_current"]["controllers"] = ["cpu", "memory"]
        rehash(value)
        result = validator.evaluate(value)
        self.assertFalse(result["safety_eligible"])
        self.assertIn("cgroup_controllers", result["failures"])

    def test_policy_identity_is_live_supabase_policy(self):
        result = validator.evaluate(eligible_observation())
        self.assertEqual("linux-h1-h13-v1", result["policy_key"])
        self.assertEqual("3dba3ce69e945e52ff1a2ab23e2981dd543296c72f229673bcc44c94c9e70122", result["policy_sha256"])


class HostSafetyEnvelopeSourceContractTests(unittest.TestCase):
    def test_probe_has_no_remote_io_or_shell_execution(self):
        source = (ROOT / "worker/native_linux/host_safety_envelope_probe.py").read_text(encoding="utf-8")
        lowered = source.lower()
        for forbidden in ("shell=true", "requests.", "urllib.", "socket.socket", "boto3", "supabase"):
            self.assertNotIn(forbidden, lowered)
        self.assertIn("cgroup.kill", source)
        self.assertIn("pidfd_open", source)
        self.assertIn("PR_SET_SECCOMP", source)
        self.assertIn("_RESOLVE_NO_MAGICLINKS", source)
        self.assertIn("_RESOLVE_NO_SYMLINKS", source)
        self.assertIn("_RESOLVE_NO_XDEV", source)

    def test_bundle_is_local_and_non_authoritative(self):
        source = (ROOT / "controller/w1/host_safety_evidence_bundle.py").read_text(encoding="utf-8")
        self.assertIn('"provider_mutation": False', source)
        self.assertIn('"reboot_authorized": False', source)
        self.assertIn('"worker_admitted": False', source)
        self.assertIn('"w1_verified": False', source)
        self.assertNotIn("shell=True", source)


if __name__ == "__main__":
    unittest.main()
