import copy
import unittest

from worker.native_linux import admission_contract as a

SHA_A = "a" * 64
SHA_B = "b" * 64
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
            "cgroup": {"version": 2, "unified": True, "controllers": ["cpu", "memory", "pids"], "kill_supported": True},
            "pidfd_pass": True,
            "openat2_beneath_pass": True,
        },
        "persistence": {
            "persistent_worker_proof": True,
            "provider_reboot_proof": True,
            "identity_binding_proof": True,
            "same_worker_before_after_reboot": True,
            "before_boot_id_sha256": SHA_A,
            "after_boot_id_sha256": SHA_B,
            "provider_event_sha256": "c" * 64,
            "host_identity_sha256": "d" * 64,
            "provider_event_identity_source": a.ALLOWED_PROVIDER_IDENTITY_SOURCE,
            "host_identity_source": a.ALLOWED_HOST_IDENTITY_SOURCE,
        },
    }


class W1AdmissionContractTests(unittest.TestCase):
    def test_golden_is_non_authority_admission_candidate(self):
        d = a.evaluate(golden())
        self.assertEqual(d["outcome"], "ADMISSION_CANDIDATE")
        self.assertTrue(d["admission_candidate"])
        self.assertFalse(d["authority"]["worker_admitted"])
        self.assertFalse(d["authority"]["w1_verified"])
        self.assertFalse(d["authority"]["authority_effect"])

    def test_ephemeral_ci_is_not_persistent_worker_proof(self):
        o = golden()
        p = o["persistence"]
        for key in ("persistent_worker_proof", "provider_reboot_proof", "identity_binding_proof", "same_worker_before_after_reboot"):
            p[key] = False
        p["before_boot_id_sha256"] = None
        p["after_boot_id_sha256"] = None
        p["provider_event_sha256"] = None
        p["host_identity_sha256"] = None
        p["provider_event_identity_source"] = None
        p["host_identity_source"] = None
        d = a.evaluate(o)
        self.assertEqual(d["outcome"], "SAFETY_ELIGIBLE_NON_PERSISTENT")
        self.assertFalse(d["admission_candidate"])

    def test_hybrid_or_v1_cgroup_fails_closed(self):
        o = golden()
        o["host"]["cgroup"]["version"] = 1
        o["host"]["cgroup"]["unified"] = False
        d = a.evaluate(o)
        self.assertEqual(d["outcome"], "REJECTED_CAPABILITY")
        self.assertIn("cgroup_v2", d["capability_failures"])
        self.assertIn("cgroup_unified", d["capability_failures"])

    def test_missing_controller_fails_closed(self):
        o = golden()
        o["host"]["cgroup"]["controllers"].remove("pids")
        self.assertIn("required_cgroup_controllers", a.evaluate(o)["capability_failures"])

    def test_root_host_fails_closed(self):
        o = golden()
        o["host"]["euid"] = 0
        self.assertIn("rootless", a.evaluate(o)["capability_failures"])

    def test_no_new_privs_and_seccomp_are_required(self):
        o = golden()
        o["host"]["no_new_privs"] = False
        o["host"]["seccomp_mode"] = 0
        d = a.evaluate(o)
        self.assertIn("no_new_privs", d["capability_failures"])
        self.assertIn("seccomp_filter_mode", d["capability_failures"])

    def test_namespace_pidfd_and_openat2_are_required(self):
        o = golden()
        o["host"]["mount_namespace_isolated"] = False
        o["host"]["pidfd_pass"] = False
        o["host"]["openat2_beneath_pass"] = False
        d = a.evaluate(o)
        self.assertEqual(d["outcome"], "REJECTED_CAPABILITY")
        self.assertIn("mount_namespace_isolated", d["capability_failures"])
        self.assertIn("pidfd", d["capability_failures"])
        self.assertIn("openat2_beneath", d["capability_failures"])

    def test_reboot_claim_without_boot_id_change_is_not_candidate(self):
        o = golden()
        o["persistence"]["after_boot_id_sha256"] = SHA_A
        d = a.evaluate(o)
        self.assertEqual(d["outcome"], "SAFETY_ELIGIBLE_NON_PERSISTENT")
        self.assertIn("boot_id_changed", d["persistence_failures"])

    def test_untrusted_provider_identity_source_rejected(self):
        o = golden()
        o["persistence"]["provider_event_identity_source"] = "SELF_REPORTED_HOST_TEXT"
        with self.assertRaisesRegex(ValueError, "untrusted provider event identity source"):
            a.evaluate(o)

    def test_policy_drift_rejected(self):
        o = golden()
        o["policy_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "policy_sha256 mismatch"):
            a.evaluate(o)

    def test_unknown_fields_rejected(self):
        o = golden()
        o["unexpected"] = True
        with self.assertRaisesRegex(ValueError, "observation keys mismatch"):
            a.evaluate(o)

    def test_decision_hash_is_deterministic(self):
        o = golden()
        self.assertEqual(a.evaluate(copy.deepcopy(o))["decision_sha256"], a.evaluate(copy.deepcopy(o))["decision_sha256"])


if __name__ == "__main__":
    unittest.main()
