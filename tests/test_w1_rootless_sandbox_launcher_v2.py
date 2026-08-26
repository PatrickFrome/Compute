from __future__ import annotations

import argparse
import hashlib
import inspect
from pathlib import Path, PurePosixPath
import unittest
from unittest import mock

from worker.native_linux import rootless_sandbox_launcher_v2 as launcher

EXPECTED_SOURCE_SHA256 = "231afd6a58b1be50549ee4cdfa99c914bff474ae3950c7af2396d3b2519413b9"


class RootlessSandboxLauncherV2ContractTests(unittest.TestCase):
    def test_source_is_sha_bound(self):
        path = Path(launcher.__file__)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), EXPECTED_SOURCE_SHA256)

    def test_namespace_composition_is_explicit(self):
        self.assertEqual(launcher.NETWORK_ISOLATION_OWNER, "LAUNCHER_CLONE_NEWNET")
        self.assertEqual(launcher.PID1_ROLE, "DEDICATED_INIT_REAPER")
        for value in (
            launcher.CLONE_NEWPID, launcher.CLONE_NEWNET,
            launcher.CLONE_NEWNS, launcher.CLONE_NEWUSER,
        ):
            self.assertNotEqual(value, 0)

    def test_inherited_seccomp_policy_remains_substantive(self):
        denied = set(launcher.DENIED_SYSCALLS)
        self.assertGreaterEqual(len(denied), 20)
        for syscall in ("mount", "umount2", "unshare", "setns", "ptrace", "bpf"):
            self.assertIn(syscall, denied)

    def test_runtime_binds_are_read_only_and_devices_are_explicit(self):
        specs = launcher._runtime_bind_specs()
        for spec in specs:
            if str(spec.source).startswith(("/usr", "/opt", "/etc", "/bin", "/lib", "/sbin")):
                self.assertTrue(spec.read_only, spec)
        device_targets = {str(spec.target) for spec in specs if str(spec.target).startswith("/dev/")}
        self.assertTrue({"/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"}.issubset(device_targets))

    def test_bind_parser_is_fail_closed(self):
        good = launcher._parse_bind("/tmp:/work:rw")
        self.assertEqual(good.source, Path("/tmp"))
        self.assertEqual(good.target, PurePosixPath("/work"))
        self.assertFalse(good.read_only)
        for raw in ("relative:/work:ro", "/tmp:relative:ro", "/tmp:/:ro", "/tmp:/x:bad"):
            with self.subTest(raw=raw):
                with self.assertRaises(argparse.ArgumentTypeError):
                    launcher._parse_bind(raw)

    def test_sandbox_target_rejects_root_and_parent_escape(self):
        root = Path("/tmp/root")
        with self.assertRaises(ValueError):
            launcher._sandbox_target(root, PurePosixPath("/"))
        with self.assertRaises(ValueError):
            launcher._sandbox_target(root, PurePosixPath("/x/../y"))

    def test_wait_status_is_deterministic(self):
        self.assertEqual(launcher._decode_wait_status(0), 0)
        self.assertEqual(launcher._decode_wait_status(7 << 8), 7)

    @mock.patch.object(launcher.os, "geteuid", return_value=0)
    def test_root_caller_is_rejected_before_namespace_mutation(self, _geteuid):
        with self.assertRaisesRegex(launcher.SandboxUnavailable, "root caller forbidden"):
            launcher.enter_user_namespace()

    def test_empty_command_rejected(self):
        with self.assertRaisesRegex(ValueError, "worker command required"):
            launcher.launch([], workspace=Path.cwd(), sandbox_root=Path("/tmp/nope"))

    def test_source_contains_pid1_reaper_pivot_and_no_unsafe_shortcuts(self):
        source = Path(launcher.__file__).read_text()
        for token in (
            "CLONE_NEWPID", "CLONE_NEWNET", "MS_REC | MS_PRIVATE",
            "pivot_root", "MNT_DETACH", "os.waitpid(-1", "os.killpg",
            'os.getpid() != 1', '_mount("proc"',
        ):
            self.assertIn(token, source)
        for token in (
            'subprocess.run(["sudo"', 'os.system("sudo', '--privileged',
            '--network=host', '--pid=host', 'seccomp=unconfined',
        ):
            self.assertNotIn(token, source)

    def test_pid1_reaper_supervises_worker_not_direct_exec(self):
        src = inspect.getsource(launcher._pid1_reaper)
        self.assertIn("worker_pid = os.fork()", src)
        self.assertIn("os.waitpid(-1, 0)", src)
        self.assertIn("os.killpg", inspect.getsource(launcher._terminate_worker_group))


if __name__ == "__main__":
    unittest.main()
