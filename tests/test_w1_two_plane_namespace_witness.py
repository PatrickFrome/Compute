from __future__ import annotations

import copy
import unittest

from worker.native_linux import two_plane_namespace_witness as witness


def fixture():
    return {
        "schema": witness.SCHEMA,
        "source": {"git_sha": "a" * 40, "tree_sha": "b" * 40},
        "outer": {
            "mount_ns_inode": 100,
            "pid_ns_inode": 200,
            "euid": 1000,
            "no_new_privs": False,
            "seccomp_mode": 0,
        },
        "inner": {
            "mount_ns_inode": 101,
            "pid_ns_inode": 201,
            "euid": 1000,
            "no_new_privs": True,
            "seccomp_mode": 2,
        },
        "runtime": {
            "container_runtime": "docker",
            "rootless_runtime": True,
            "host_pid_shared": False,
            "host_network_shared": False,
            "privileged": False,
        },
    }


class TwoPlaneNamespaceWitnessTests(unittest.TestCase):
    def test_valid_distinct_rootless_runtime_is_nonauthority_only(self):
        result = witness.evaluate(fixture())
        self.assertEqual(result["outcome"], "TWO_PLANE_NAMESPACE_ELIGIBLE_NONAUTHORITY")
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["provider_identity_verified"])
        self.assertTrue(result["requires_authenticated_outer_collector"])

    def test_host_pid_sharing_is_rejected_even_if_namespaces_look_distinct(self):
        value = fixture()
        value["runtime"]["host_pid_shared"] = True
        result = witness.evaluate(value)
        self.assertEqual(result["outcome"], "REJECTED_TWO_PLANE_NAMESPACE")
        self.assertIn("no_host_pid_sharing", result["evidence"]["failures"])

    def test_host_network_sharing_rejected(self):
        value = fixture()
        value["runtime"]["host_network_shared"] = True
        result = witness.evaluate(value)
        self.assertIn("no_host_network_sharing", result["evidence"]["failures"])

    def test_privileged_rejected(self):
        value = fixture()
        value["runtime"]["privileged"] = True
        result = witness.evaluate(value)
        self.assertIn("not_privileged", result["evidence"]["failures"])

    def test_rootful_runtime_rejected_even_for_nonroot_inner_process(self):
        value = fixture()
        value["runtime"]["rootless_runtime"] = False
        self.assertNotEqual(value["inner"]["euid"], 0)
        result = witness.evaluate(value)
        self.assertIn("runtime_rootless", result["evidence"]["failures"])

    def test_same_mount_namespace_rejected(self):
        value = fixture()
        value["inner"]["mount_ns_inode"] = value["outer"]["mount_ns_inode"]
        result = witness.evaluate(value)
        self.assertIn("mount_namespace_distinct_outer_inner", result["evidence"]["failures"])

    def test_same_pid_namespace_rejected(self):
        value = fixture()
        value["inner"]["pid_ns_inode"] = value["outer"]["pid_ns_inode"]
        result = witness.evaluate(value)
        self.assertIn("pid_namespace_distinct_outer_inner", result["evidence"]["failures"])

    def test_inner_security_controls_required(self):
        for key, bad in (("euid", 0), ("no_new_privs", False), ("seccomp_mode", 0)):
            with self.subTest(key=key):
                value = fixture()
                value["inner"][key] = bad
                result = witness.evaluate(value)
                self.assertEqual(result["outcome"], "REJECTED_TWO_PLANE_NAMESPACE")

    def test_extra_trust_field_rejected(self):
        value = fixture()
        value["runtime"]["trust_me"] = True
        with self.assertRaisesRegex(ValueError, "keys mismatch"):
            witness.evaluate(value)


if __name__ == "__main__":
    unittest.main()
