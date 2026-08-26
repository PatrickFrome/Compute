from __future__ import annotations

import argparse
import hashlib
import inspect
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from unittest import mock

from worker.native_linux import rootless_sandbox_launcher_v2 as launcher

EXPECTED_SOURCE_SHA256 = "8c5570faaabb3b44056fc2954224036ae0d342c57d79053fceffb8ebefe1ecca"


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

    def test_recursive_mount_hardening_uses_mount_setattr(self):
        calls: list[tuple[object, ...]] = []

        class FakeLibc:
            def syscall(self, *args):
                calls.append(args)
                return 0

        with mock.patch.object(launcher, "_libc", return_value=FakeLibc()), \
             mock.patch.object(launcher, "_syscall_number", return_value=442):
            launcher._recursive_mount_attributes(
                Path("/bounded"), read_only=True, no_exec=True
            )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0].value, 442)
        self.assertEqual(calls[0][3].value, launcher.AT_RECURSIVE)

    def test_supported_syscall_numbers_cover_x86_and_arm(self):
        with mock.patch.object(launcher.platform, "machine", return_value="x86_64"):
            self.assertEqual(launcher._syscall_number("pivot_root"), 155)
            self.assertEqual(launcher._syscall_number("close_range"), 436)
            self.assertEqual(launcher._syscall_number("mount_setattr"), 442)
        with mock.patch.object(launcher.platform, "machine", return_value="aarch64"):
            self.assertEqual(launcher._syscall_number("pivot_root"), 41)
            self.assertEqual(launcher._syscall_number("close_range"), 436)
            self.assertEqual(launcher._syscall_number("mount_setattr"), 442)

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

    def test_launch_requires_fresh_sandbox_root_and_exact_cleanup(self):
        source = inspect.getsource(launcher.launch)
        self.assertIn("sandbox root must not exist before launch", source)
        self.assertIn("sandbox_root.rmdir()", source)
        self.assertNotIn("rmtree", source)
        setup = inspect.getsource(launcher.setup_sandbox_root)
        self.assertIn("exist_ok=False", setup)

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

    def test_command_is_bounded_and_resolved_only_from_fixed_path(self):
        with mock.patch.object(launcher.shutil, "which", return_value="/usr/bin/python3") as which:
            value = launcher._validated_command(["python3", "-V"])
        self.assertEqual(value[0], "/usr/bin/python3")
        which.assert_called_once_with("python3", path=launcher.FIXED_WORKER_PATH)
        with self.assertRaisesRegex(ValueError, "invalid argument"):
            launcher._validated_command(["/bin/echo", "bad\x00arg"])
        with self.assertRaisesRegex(ValueError, "too many arguments"):
            launcher._validated_command(["/bin/true", *(["x"] * launcher.MAX_COMMAND_ARGS)])

    def test_worker_environment_strips_credentials_and_proxies(self):
        value = launcher._worker_environment(Path("/workspace"), {
            "LANG": "C.UTF-8",
            "GITHUB_TOKEN": "secret",
            "SUPABASE_SERVICE_ROLE_KEY": "secret",
            "HTTPS_PROXY": "http://credential@example.invalid",
            "PATH": "/attacker/bin",
        })
        self.assertEqual(value["PATH"], launcher.FIXED_WORKER_PATH)
        self.assertEqual(value["GITHUB_WORKSPACE"], "/workspace")
        self.assertEqual(value["LANG"], "C.UTF-8")
        for key in ("GITHUB_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "HTTPS_PROXY"):
            self.assertNotIn(key, value)

    def test_inherited_fd_cleanup_uses_atomic_close_range(self):
        calls: list[tuple[object, ...]] = []

        class FakeLibc:
            def syscall(self, *args):
                calls.append(args)
                return 0

        with mock.patch.object(launcher, "_libc", return_value=FakeLibc()), \
             mock.patch.object(launcher, "_syscall_number", return_value=436):
            launcher._close_inherited_fds()
        self.assertEqual(calls[0][1].value, 3)
        self.assertEqual(calls[0][2].value, launcher.UINT_MAX)
        self.assertEqual(calls[0][3].value, launcher.CLOSE_RANGE_UNSHARE)

    def test_worker_exec_boundary_is_private_and_credential_free(self):
        source = inspect.getsource(launcher._pid1_reaper)
        self.assertLess(source.index("v1.set_no_new_privs"), source.index("_worker_environment"))
        self.assertLess(source.index("_worker_environment"), source.index("_close_inherited_fds"))
        self.assertLess(source.index("_close_inherited_fds"), source.index("os.execve"))
        self.assertIn("os.umask(0o077)", source)
        self.assertNotIn("os.execvp", source)

    def test_signals_are_blocked_across_outer_fork_and_parent_death_is_fenced(self):
        source = inspect.getsource(launcher.launch)
        self.assertLess(source.index("signal.SIG_BLOCK"), source.index("pid1 = os.fork()"))
        self.assertIn("_set_parent_death_signal()", source)
        pdeath = inspect.getsource(launcher._set_parent_death_signal)
        self.assertIn("PR_SET_PDEATHSIG", pdeath)
        self.assertGreaterEqual(pdeath.count("os.getppid()"), 2)

    def test_pidfd_preconditions_are_checked_before_namespace_mutation(self):
        source = inspect.getsource(launcher.launch)
        self.assertLess(source.index("_require_pidfd_supervision()"), source.index("enter_user_namespace()"))
        with mock.patch.object(launcher.threading, "active_count", return_value=2):
            with self.assertRaisesRegex(launcher.SandboxUnavailable, "single main thread"):
                launcher._require_pidfd_supervision()
        with mock.patch.object(launcher.threading, "active_count", return_value=1), \
             mock.patch.object(launcher.threading, "current_thread", return_value=launcher.threading.main_thread()), \
             mock.patch.object(launcher.signal, "getsignal", return_value=launcher.signal.SIG_IGN):
            with self.assertRaisesRegex(launcher.SandboxUnavailable, "default SIGCHLD"):
                launcher._require_pidfd_supervision()

    def test_pidfd_signal_forwarding_uses_stable_process_reference(self):
        with mock.patch.object(launcher.signal, "pidfd_send_signal") as send:
            launcher._forward_pidfd_signal(17, launcher.signal.SIGTERM)
        send.assert_called_once_with(17, launcher.signal.SIGTERM, None, 0)

    def test_pidfd_open_failure_is_terminal(self):
        with mock.patch.object(launcher.os, "pidfd_open", side_effect=OSError("blocked")):
            with self.assertRaisesRegex(launcher.SandboxUnavailable, "pidfd_open failed"):
                launcher._open_pidfd(123)

    @unittest.skipUnless(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"), "pidfd APIs required")
    def test_real_kernel_pidfd_signal_targets_exact_child(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        pidfd = os.pidfd_open(process.pid, 0)
        try:
            signal.pidfd_send_signal(pidfd, signal.SIGTERM, None, 0)
            self.assertEqual(process.wait(timeout=5), -signal.SIGTERM)
        finally:
            os.close(pidfd)
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)

    def test_source_contains_pid1_reaper_pivot_and_no_unsafe_shortcuts(self):
        source = Path(launcher.__file__).read_text()
        for token in (
            "CLONE_NEWPID", "CLONE_NEWNET", "MS_REC | MS_PRIVATE", "pivot_root", "MNT_DETACH",
            "os.waitpid(-1", "os.killpg", "os.pipe2", "pending_signals", 'os.getpid() != 1', '_mount("proc"',
            "mount_setattr", "AT_RECURSIVE", "PR_SET_PDEATHSIG", "close_range", "os.execve",
            "pidfd_open", "pidfd_send_signal",
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
