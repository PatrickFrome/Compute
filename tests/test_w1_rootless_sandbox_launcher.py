from __future__ import annotations

import errno
import unittest
from unittest import mock

from worker.native_linux import rootless_sandbox_launcher as launcher


class RootlessSandboxLauncherPolicyTests(unittest.TestCase):
    def test_policy_is_substantive_and_blocks_namespace_escape_primitives(self):
        denied = set(launcher.DENIED_SYSCALLS)
        self.assertGreaterEqual(len(denied), 20)
        for name in (
            "mount", "umount2", "unshare", "setns", "ptrace", "bpf",
            "open_by_handle_at", "userfaultfd", "keyctl", "reboot",
        ):
            self.assertIn(name, denied)

    def test_policy_never_uses_unconfined_or_allow_all_marker(self):
        joined = " ".join(launcher.DENIED_SYSCALLS).lower()
        self.assertNotIn("unconfined", joined)
        self.assertNotIn("privileged", joined)

    def test_errno_action_is_eprem(self):
        self.assertEqual(
            launcher._seccomp_action_errno(errno.EPERM),
            launcher.SCMP_ACT_ERRNO_BASE | errno.EPERM,
        )

    def test_errno_action_rejects_invalid_values(self):
        for value in (0, -1, 0x10000):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    launcher._seccomp_action_errno(value)

    @mock.patch.object(launcher.os, "geteuid", return_value=0)
    def test_root_caller_fails_closed(self, _geteuid):
        with self.assertRaisesRegex(launcher.SandboxUnavailable, "root caller forbidden"):
            launcher.enter_rootless_namespaces()

    def test_empty_worker_command_rejected(self):
        with self.assertRaisesRegex(ValueError, "worker command required"):
            launcher.launch([])

    @mock.patch.object(launcher.ctypes.util, "find_library", return_value=None)
    def test_missing_libseccomp_fails_closed(self, _find_library):
        with self.assertRaisesRegex(launcher.SandboxUnavailable, "libseccomp unavailable"):
            launcher.install_seccomp_deny_policy()

    def test_tiny_seccomp_policy_refused_as_synthetic(self):
        with self.assertRaisesRegex(launcher.SandboxUnavailable, "policy too small"):
            launcher.install_seccomp_deny_policy(("ptrace",))


if __name__ == "__main__":
    unittest.main()
