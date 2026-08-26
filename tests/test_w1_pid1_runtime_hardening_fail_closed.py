from __future__ import annotations

import ctypes
import errno
from pathlib import Path
import unittest
from unittest import mock

from worker.native_linux import rootless_sandbox_launcher_v2 as launcher


class PID1RuntimeHardeningFailClosedTests(unittest.TestCase):
    def test_pr_set_dumpable_failure_is_terminal_before_environment_scrub(self):
        class FakeLibc:
            def prctl(self, option, *_args):
                if option.value == launcher.PR_SET_DUMPABLE:
                    ctypes.set_errno(errno.EPERM)
                    return -1
                return launcher.SUID_DUMP_DISABLE

        with mock.patch.object(launcher, "_libc", return_value=FakeLibc()), \
             mock.patch.object(launcher, "_worker_environment") as worker_environment, \
             mock.patch.object(launcher.resource, "setrlimit") as setrlimit:
            with self.assertRaisesRegex(launcher.SandboxUnavailable, "PR_SET_DUMPABLE failed"):
                launcher._harden_pid1_runtime(Path("/workspace"))
        worker_environment.assert_not_called()
        setrlimit.assert_not_called()

    def test_dumpable_readback_mismatch_is_terminal_before_rlimit_and_scrub(self):
        class FakeLibc:
            def prctl(self, option, *_args):
                if option.value == launcher.PR_SET_DUMPABLE:
                    return 0
                if option.value == launcher.PR_GET_DUMPABLE:
                    return 1
                raise AssertionError(option.value)

        with mock.patch.object(launcher, "_libc", return_value=FakeLibc()), \
             mock.patch.object(launcher, "_worker_environment") as worker_environment, \
             mock.patch.object(launcher.resource, "setrlimit") as setrlimit:
            with self.assertRaisesRegex(launcher.SandboxUnavailable, "dumpability fence did not persist"):
                launcher._harden_pid1_runtime(Path("/workspace"))
        worker_environment.assert_not_called()
        setrlimit.assert_not_called()

    def test_core_limit_readback_mismatch_is_terminal_before_environment_scrub(self):
        class FakeLibc:
            def prctl(self, option, *_args):
                if option.value == launcher.PR_SET_DUMPABLE:
                    return 0
                if option.value == launcher.PR_GET_DUMPABLE:
                    return launcher.SUID_DUMP_DISABLE
                raise AssertionError(option.value)

        with mock.patch.object(launcher, "_libc", return_value=FakeLibc()), \
             mock.patch.object(launcher.resource, "setrlimit") as setrlimit, \
             mock.patch.object(launcher.resource, "getrlimit", return_value=(1, 1)), \
             mock.patch.object(launcher, "_worker_environment") as worker_environment:
            with self.assertRaisesRegex(launcher.SandboxUnavailable, "core-dump limit did not persist"):
                launcher._harden_pid1_runtime(Path("/workspace"))
        setrlimit.assert_called_once_with(launcher.resource.RLIMIT_CORE, (0, 0))
        worker_environment.assert_not_called()


if __name__ == "__main__":
    unittest.main()
