from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WITNESS_PATH = ROOT / "worker/native_linux/two_plane_safety_witness_v2.py"
LAUNCHER_PATH = ROOT / "worker/native_linux/rootless_worker_launcher_v2.py"

spec = importlib.util.spec_from_file_location("w1_two_plane_v2", WITNESS_PATH)
assert spec and spec.loader
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


def sample():
    return {
        "schema": w.SCHEMA,
        "source": {"git_sha": "a" * 40, "tree_sha": "b" * 40},
        "outer": {"mount_ns_inode": 10, "pid_ns_inode": 20, "net_ns_inode": 30},
        "inner": {
            "mount_ns_inode": 11,
            "pid_ns_inode": 20,
            "net_ns_inode": 31,
            "euid": 1000,
            "no_new_privs": True,
            "seccomp_mode": 2,
            "cap_eff_zero": True,
            "network_default_deny": True,
        },
        "runtime": {
            "worker_rootless": True,
            "worker_has_control_socket": False,
            "host_pid_shared": False,
            "host_network_shared": False,
            "privileged": False,
        },
        "cgroup": {
            "exact_target_valid": True,
            "cpu_limited": True,
            "memory_limited": True,
            "pids_limited": True,
            "tree_kill_proven": True,
            "prebound_before_outer_privilege": True,
            "worker_launch_via_outer_privilege": False,
            "worker_exec_via_outer_privilege": False,
        },
    }


class WitnessV2Tests(unittest.TestCase):
    def test_positive_does_not_require_pid_namespace_difference(self):
        out = w.evaluate(sample())
        self.assertEqual(out["outcome"], "TWO_PLANE_SAFETY_ELIGIBLE_NONAUTHORITY")
        self.assertFalse(out["evidence"]["pid_namespace_distinct_observed"])
        for key in ("safety_verified", "worker_admitted", "w1_verified", "canonical", "authority_effect"):
            self.assertFalse(out[key])

    def test_fails_if_worker_not_rootless(self):
        x = sample(); x["runtime"]["worker_rootless"] = False
        self.assertIn("worker_rootless", w.evaluate(x)["evidence"]["failures"])

    def test_fails_if_outer_control_socket_exposed(self):
        x = sample(); x["runtime"]["worker_has_control_socket"] = True
        self.assertIn("worker_has_no_outer_control_socket", w.evaluate(x)["evidence"]["failures"])

    def test_fails_if_tree_kill_missing(self):
        x = sample(); x["cgroup"]["tree_kill_proven"] = False
        self.assertIn("cgroup_tree_kill", w.evaluate(x)["evidence"]["failures"])

    def test_fails_if_outer_privilege_prebinding_missing(self):
        x = sample(); x["cgroup"]["prebound_before_outer_privilege"] = False
        self.assertIn("outer_privilege_after_prebinding", w.evaluate(x)["evidence"]["failures"])

    def test_fails_if_worker_launched_through_outer_privilege(self):
        x = sample(); x["cgroup"]["worker_launch_via_outer_privilege"] = True
        self.assertIn("worker_not_launched_via_outer_privilege", w.evaluate(x)["evidence"]["failures"])

    def test_rejects_authority_key_injection(self):
        x = sample(); x["w1_verified"] = True
        with self.assertRaises(ValueError):
            w.evaluate(x)

    def test_launcher_has_real_network_namespace_and_pre_unshare_identity(self):
        text = LAUNCHER_PATH.read_text()
        self.assertIn("CLONE_NEWNET", text)
        self.assertIn("CLONE_NEWNS | CLONE_NEWNET", text)
        uid_pos = text.index("uid, gid = os.getuid(), os.getgid()")
        unshare_pos = text.index("libc.unshare(ctypes.c_int(v1.CLONE_NEWUSER))")
        self.assertLess(uid_pos, unshare_pos)
        self.assertIn("_network_default_deny_canary", text)
        self.assertNotIn("CLONE_NEWPID", text)


if __name__ == "__main__":
    unittest.main()
