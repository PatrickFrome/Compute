import copy
import unittest

from worker.native_linux import admission_contract as a

GIT_SHA = "1" * 40
TREE_SHA = "2" * 40


def golden():
    return {
        "schema": a.OBSERVATION_SCHEMA,
        "policy_sha256": a.POLICY_SHA256,
        "source": {"git_sha": GIT_SHA, "tree_sha": TREE_SHA},
        "host": {
            "os": "linux",
            "euid": 1000,
            "no_new_privs": True,
            "seccomp_mode": 2,
            "mount_namespace_isolated": True,
            "cgroup": {
                "version": 2,
                "unified": True,
                "controllers": ["cpu", "memory", "pids"],
                "kill_supported": True,
            },
            "pidfd_pass": True,
            "openat2_beneath_pass": True,
        },
    }


class W1AdmissionContractTests(unittest.TestCase):
    def test_golden_is_only_safety_eligible_non_persistent(self):
        decision = a.evaluate(golden())
        self.assertEqual(decision["outcome"], "SAFETY_ELIGIBLE_NON_PERSISTENT")
        self.assertTrue(decision["safety_eligible"])
        self.assertTrue(decision["requires_independent_persistence_receipts"])
        self.assertFalse(decision["admission_candidate"])
        self.assertFalse(decision["authority"]["worker_admitted"])
        self.assertFalse(decision["authority"]["w1_verified"])
        self.assertFalse(decision["authority"]["authority_effect"])

    def test_host_cannot_self_assert_persistence(self):
        observation = golden()
        observation["persistence"] = {
            "persistent_worker_proof": True,
            "provider_reboot_proof": True,
        }
        with self.assertRaisesRegex(ValueError, "observation keys mismatch"):
            a.evaluate(observation)

    def test_rejected_host_never_enters_persistence_composition(self):
        observation = golden()
        observation["host"]["cgroup"]["version"] = 1
        decision = a.evaluate(observation)
        self.assertEqual(decision["outcome"], "REJECTED_CAPABILITY")
        self.assertFalse(decision["safety_eligible"])
        self.assertFalse(decision["requires_independent_persistence_receipts"])
        self.assertFalse(decision["admission_candidate"])

    def test_hybrid_or_v1_cgroup_fails_closed(self):
        observation = golden()
        observation["host"]["cgroup"]["version"] = 1
        observation["host"]["cgroup"]["unified"] = False
        decision = a.evaluate(observation)
        self.assertEqual(decision["outcome"], "REJECTED_CAPABILITY")
        self.assertIn("cgroup_v2", decision["capability_failures"])
        self.assertIn("cgroup_unified", decision["capability_failures"])

    def test_missing_controller_fails_closed(self):
        observation = golden()
        observation["host"]["cgroup"]["controllers"].remove("pids")
        self.assertIn("required_cgroup_controllers", a.evaluate(observation)["capability_failures"])

    def test_missing_cgroup_kill_fails_closed(self):
        observation = golden()
        observation["host"]["cgroup"]["kill_supported"] = False
        self.assertIn("cgroup_kill", a.evaluate(observation)["capability_failures"])

    def test_root_host_fails_closed(self):
        observation = golden()
        observation["host"]["euid"] = 0
        self.assertIn("rootless", a.evaluate(observation)["capability_failures"])

    def test_no_new_privs_and_seccomp_are_required(self):
        observation = golden()
        observation["host"]["no_new_privs"] = False
        observation["host"]["seccomp_mode"] = 0
        decision = a.evaluate(observation)
        self.assertIn("no_new_privs", decision["capability_failures"])
        self.assertIn("seccomp_filter_mode", decision["capability_failures"])

    def test_namespace_pidfd_and_openat2_are_required(self):
        observation = golden()
        observation["host"]["mount_namespace_isolated"] = False
        observation["host"]["pidfd_pass"] = False
        observation["host"]["openat2_beneath_pass"] = False
        decision = a.evaluate(observation)
        self.assertEqual(decision["outcome"], "REJECTED_CAPABILITY")
        self.assertIn("mount_namespace_isolated", decision["capability_failures"])
        self.assertIn("pidfd", decision["capability_failures"])
        self.assertIn("openat2_beneath", decision["capability_failures"])

    def test_policy_drift_rejected(self):
        observation = golden()
        observation["policy_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "policy_sha256 mismatch"):
            a.evaluate(observation)

    def test_unknown_fields_rejected(self):
        observation = golden()
        observation["unexpected"] = True
        with self.assertRaisesRegex(ValueError, "observation keys mismatch"):
            a.evaluate(observation)

    def test_digest_type_confusion_rejected(self):
        observation = golden()
        observation["source"]["git_sha"] = int("1" * 40)
        with self.assertRaisesRegex(ValueError, "git_sha must be a string"):
            a.evaluate(observation)

    def test_noncanonical_uppercase_digest_rejected(self):
        observation = golden()
        observation["source"]["git_sha"] = "A" * 40
        with self.assertRaisesRegex(ValueError, "canonical lowercase"):
            a.evaluate(observation)

    def test_bool_numeric_type_confusion_rejected(self):
        observation = golden()
        observation["host"]["euid"] = True
        with self.assertRaisesRegex(ValueError, "invalid euid"):
            a.evaluate(observation)
        observation = golden()
        observation["host"]["cgroup"]["version"] = True
        with self.assertRaisesRegex(ValueError, "invalid cgroup version"):
            a.evaluate(observation)

    def test_decision_hash_is_deterministic(self):
        observation = golden()
        first = a.evaluate(copy.deepcopy(observation))["decision_sha256"]
        second = a.evaluate(copy.deepcopy(observation))["decision_sha256"]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
