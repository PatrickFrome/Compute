from __future__ import annotations

import argparse
import hashlib
import inspect
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from unittest import mock

from worker.native_linux import rootless_sandbox_launcher_v2 as launcher

EXPECTED_SOURCE_SHA256 = "f262cd5468b5eb51754cf397cdb1879c2e90d0670b74f479d3b28af8cd20f521"


class RootlessSandboxLauncherV2ContractTests(unittest.TestCase):
    def test_source_is_sha_bound(self):
        self.assertEqual(hashlib.sha256(Path(launcher.__file__).read_bytes()).hexdigest(), EXPECTED_SOURCE_SHA256)

    def test_direct_file_cli_bootstraps_package_imports(self):
        launcher_path = Path(launcher.__file__).resolve()
        with tempfile.TemporaryDirectory() as td:
            result = subprocess.run(
                [sys.executable, str(launcher_path), "--help"],
                cwd=td,
                env={"PATH": "/usr/bin:/bin"},
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("W1 S2 rootless sandbox launcher v2", result.stdout)

    def test_namespace_composition_is_explicit(self):
        self.assertEqual(launcher.NETWORK_ISOLATION_OWNER, "LAUNCHER_CLONE_NEWNET")
        self.assertEqual(launcher.PID1_ROLE, "DEDICATED_INIT_REAPER")
        for value in (launcher.CLONE_NEWPID, launcher.CLONE_NEWNET, launcher.CLONE_NEWNS, launcher.CLONE_NEWUSER):
            self.assertNotEqual(value, 0)

    def test_inherited_seccomp_policy_remains_substantive(self):
        denied = set(launcher.DENIED_SYSCALLS)
        self.assertGreaterEqual(len(denied), 20)
        for syscall in ("mount", "umount2", "unshare", "setns", "ptrace", "bpf"):
            self.assertIn(syscall, denied)

    def test_runtime_binds_are_minimal(self):
        specs = launcher._runtime_bind_specs()
        targets = {str(spec.target) for spec in specs}
        self.assertNotIn("/etc", targets)
        self.assertNotIn("/opt", targets)
        self.assertIn("/usr", targets)
        self.assertTrue({"/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"}.issubset(targets))
        for spec in specs:
            if str(spec.target).startswith(("/usr", "/etc/", "/bin", "/lib", "/sbin")):
                self.assertTrue(spec.read_only, spec)

    def test_extra_bind_is_fail_closed_and_read_only(self):
        with tempfile.TemporaryDirectory() as td:
            good = launcher._parse_bind(f"{td}:/tool:ro")
            self.assertTrue(good.read_only)
            for raw in (f"{td}:/tool:rw", "/:/host:ro", "/proc:/proc-host:ro", "/run:/run-host:ro"):
                with self.subTest(raw=raw):
                    with self.assertRaises(argparse.ArgumentTypeError):
                        launcher._parse_bind(raw)

    def test_layout_rejects_sensitive_or_overlapping_paths(self):
        with tempfile.TemporaryDirectory() as workspace, tempfile.TemporaryDirectory() as root:
            w, r = launcher._validate_layout(Path(workspace), Path(root))
            self.assertEqual(w, Path(workspace))
            self.assertEqual(r, Path(root))
            with self.assertRaisesRegex(launcher.SandboxUnavailable, "disjoint"):
                launcher._validate_layout(Path(workspace), Path(workspace) / "root")
        with self.assertRaisesRegex(launcher.SandboxUnavailable, "workspace path forbidden"):
            launcher._validate_layout(Path("/"), Path("/tmp/metaengine-test-root"))

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
            "CLONE_NEWPID", "CLONE_NEWNET", "MS_REC | MS_PRIVATE", "pivot_root", "MNT_DETACH",
            "os.waitpid(-1", "os.killpg", "os.pipe2", "pending_signals", 'os.getpid() != 1', '_mount("proc"',
        ):
            self.assertIn(token, source)
        for token in (
            'subprocess.run(["sudo"', 'os.system("sudo', '--privileged', '--network=host', '--pid=host', 'seccomp=unconfined',
        ):
            self.assertNotIn(token, source)

    def test_pid1_reaper_supervises_worker_after_process_group_ready(self):
        src = inspect.getsource(launcher._pid1_reaper)
        self.assertIn("worker_pid = os.fork()", src)
        self.assertIn("os.waitpid(-1, 0)", src)
        self.assertIn("pending_signals", src)
        self.assertIn("os.pipe2", src)


if __name__ == "__main__":
    unittest.main()
