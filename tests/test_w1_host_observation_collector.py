from __future__ import annotations

import io
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "worker" / "native_linux"
if str(NATIVE) not in sys.path:
    sys.path.insert(0, str(NATIVE))

import admission_contract  # noqa: E402
import host_observation_collector as collector  # noqa: E402

SOURCE = {"git_sha": "a" * 40, "tree_sha": "b" * 40}
GOOD_CGROUP = {
    "version": 2,
    "unified": True,
    "controllers": ["cpu", "memory", "pids"],
    "kill_supported": True,
}


class HostObservationCollectorTests(unittest.TestCase):
    def _collect(self, *, cgroup=None, euid=1000):
        with (
            mock.patch.object(collector, "_read_proc_status", return_value=(True, 2)),
            mock.patch.object(collector, "_mount_namespace_isolated", return_value=True),
            mock.patch.object(collector, "_collect_cgroup", return_value=cgroup or GOOD_CGROUP),
            mock.patch.object(collector, "_pidfd_canary", return_value=True),
            mock.patch.object(collector, "_openat2_beneath_canary", return_value=True),
            mock.patch.object(collector.os, "geteuid", return_value=euid),
            mock.patch.object(collector.sys, "platform", "linux"),
        ):
            return collector.collect_observation(SOURCE)

    def test_emits_exact_admission_observation_schema(self):
        observation = self._collect()
        admission_contract.validate_observation(observation)
        self.assertEqual(set(observation), admission_contract.TOP_KEYS)
        self.assertEqual(set(observation["source"]), admission_contract.SOURCE_KEYS)
        self.assertEqual(set(observation["host"]), admission_contract.HOST_KEYS)
        self.assertEqual(set(observation["host"]["cgroup"]), admission_contract.CGROUP_KEYS)
        self.assertEqual(observation["policy_sha256"], admission_contract.POLICY_SHA256)

    def test_happy_path_is_only_safety_eligible_non_persistent(self):
        decision = admission_contract.evaluate(self._collect())
        self.assertEqual(decision["outcome"], "SAFETY_ELIGIBLE_NON_PERSISTENT")
        self.assertFalse(decision["admission_candidate"])
        self.assertFalse(decision["authority"]["worker_admitted"])
        self.assertFalse(decision["authority"]["w1_verified"])
        self.assertFalse(decision["authority"]["canonical"])
        self.assertFalse(decision["authority"]["authority_effect"])

    def test_cgroup_v1_fails_closed(self):
        bad = {
            "version": 1,
            "unified": False,
            "controllers": [],
            "kill_supported": False,
        }
        decision = admission_contract.evaluate(self._collect(cgroup=bad))
        self.assertEqual(decision["outcome"], "REJECTED_CAPABILITY")
        self.assertIn("cgroup_v2", decision["capability_failures"])
        self.assertIn("cgroup_unified", decision["capability_failures"])
        self.assertIn("required_cgroup_controllers", decision["capability_failures"])
        self.assertIn("cgroup_kill", decision["capability_failures"])

    def test_root_euid_fails_closed(self):
        decision = admission_contract.evaluate(self._collect(euid=0))
        self.assertEqual(decision["outcome"], "REJECTED_CAPABILITY")
        self.assertIn("rootless", decision["capability_failures"])

    def test_input_rejects_any_host_or_authority_claim(self):
        forbidden = {
            "source": SOURCE,
            "host": {"pidfd_pass": True},
            "provider_reboot_proof": True,
            "canonical": True,
        }
        with self.assertRaisesRegex(ValueError, "input keys mismatch"):
            collector._validate_input(forbidden)

    def test_input_rejects_extra_source_fields(self):
        with self.assertRaisesRegex(ValueError, "source keys mismatch"):
            collector._validate_input({"source": {**SOURCE, "identity_source": "SELF_ASSERTED"}})

    def test_invalid_source_digest_fails_before_output_contract(self):
        with self.assertRaises(ValueError):
            with (
                mock.patch.object(collector, "_read_proc_status", return_value=(True, 2)),
                mock.patch.object(collector, "_mount_namespace_isolated", return_value=True),
                mock.patch.object(collector, "_collect_cgroup", return_value=GOOD_CGROUP),
                mock.patch.object(collector, "_pidfd_canary", return_value=True),
                mock.patch.object(collector, "_openat2_beneath_canary", return_value=True),
                mock.patch.object(collector.os, "geteuid", return_value=1000),
                mock.patch.object(collector.sys, "platform", "linux"),
            ):
                collector.collect_observation({"git_sha": "NOTHEX", "tree_sha": "b" * 40})

    def test_main_is_stdin_stdout_and_contains_no_authority_fields(self):
        stdin = io.StringIO(json.dumps({"source": SOURCE}))
        stdout = io.StringIO()
        with (
            mock.patch.object(collector.sys, "stdin", stdin),
            mock.patch.object(collector.sys, "stdout", stdout),
            mock.patch.object(collector, "_read_proc_status", return_value=(True, 2)),
            mock.patch.object(collector, "_mount_namespace_isolated", return_value=True),
            mock.patch.object(collector, "_collect_cgroup", return_value=GOOD_CGROUP),
            mock.patch.object(collector, "_pidfd_canary", return_value=True),
            mock.patch.object(collector, "_openat2_beneath_canary", return_value=True),
            mock.patch.object(collector.os, "geteuid", return_value=1000),
            mock.patch.object(collector.sys, "platform", "linux"),
        ):
            self.assertEqual(collector.main(), 0)
        payload = json.loads(stdout.getvalue())
        for forbidden in (
            "canonical",
            "authority_effect",
            "worker_admitted",
            "w1_verified",
            "admission_candidate",
            "provider_reboot_proof",
            "identity_source",
        ):
            self.assertNotIn(forbidden, payload)

    def test_pidfd_canary_fails_closed_without_kernel_support(self):
        with mock.patch.object(collector.os, "pidfd_open", new=None, create=True):
            # hasattr remains true when patched to None; invoking must still fail closed.
            self.assertFalse(collector._pidfd_canary())

    def test_openat2_unknown_architecture_fails_closed(self):
        fake_uname = mock.Mock(machine="mystery-arch")
        with mock.patch.object(collector.os, "uname", return_value=fake_uname):
            with self.assertRaises(OSError):
                collector._openat2_call(-1, ".", 0, collector._RESOLVE_BENEATH)


if __name__ == "__main__":
    unittest.main()
