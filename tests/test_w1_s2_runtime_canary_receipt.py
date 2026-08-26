from __future__ import annotations

import unittest

from controller.w1 import s2_runtime_canary_receipt as receipt


RUNNER = {
    "run_id": "123",
    "run_attempt": "1",
    "runner_os": "Linux",
    "runner_arch": "X64",
    "head_sha": "a" * 40,
}
SOURCE_SHA = "b" * 64
PASS_OUTPUT = "\n".join(
    [
        "EUID=1001",
        "PID=2",
        "PPID=1",
        "WORKER_IS_NOT_PID1=true",
        "PARENT_IS_NAMESPACE_PID1=true",
        "NO_NEW_PRIVS=1",
        "SECCOMP=2",
        "ROOT_FS=tmpfs",
        "OLDROOT_DETACHED=true",
        "WORKSPACE_RW=true",
        "NETWORK_DEFAULT_DENY=true",
        "CANONICAL=false",
        "AUTHORITY_EFFECT=false",
        "WORKER_ADMITTED=false",
        "W1_VERIFIED=false",
    ]
) + "\n"


class S2RuntimeCanaryReceiptTests(unittest.TestCase):
    def test_full_runtime_markers_produce_pass_nonauthority(self):
        result = receipt.compose(launcher_rc=0, output=PASS_OUTPUT, source_sha256=SOURCE_SHA, runner=RUNNER)
        self.assertEqual(result["status"], "PASS_NONAUTHORITY")
        self.assertEqual(result["evidence"]["missing_or_bad_pass_markers"], [])
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["w1_verified"])

    def test_rc_zero_without_all_markers_is_failed(self):
        result = receipt.compose(launcher_rc=0, output="W1_VERIFIED=false\n", source_sha256=SOURCE_SHA, runner=RUNNER)
        self.assertEqual(result["status"], "FAILED")
        self.assertIn("NO_NEW_PRIVS", result["evidence"]["missing_or_bad_pass_markers"])

    def test_setgroups_denial_is_explicit_unavailable(self):
        output = "W1_S2_SANDBOX_UNAVAILABLE: cannot write /proc/self/setgroups: [Errno 13] Permission denied\n"
        result = receipt.compose(launcher_rc=78, output=output, source_sha256=SOURCE_SHA, runner=RUNNER)
        self.assertEqual(result["status"], "UNAVAILABLE_FAIL_CLOSED")
        self.assertEqual(result["evidence"]["reason_class"], "USER_NAMESPACE_SETGROUPS_DENIED")
        self.assertFalse(result["persistent_worker_proof"])

    def test_rc_78_without_launcher_diagnostic_is_failed(self):
        result = receipt.compose(launcher_rc=78, output="permission denied\n", source_sha256=SOURCE_SHA, runner=RUNNER)
        self.assertEqual(result["status"], "FAILED")

    def test_unexpected_nonzero_is_failed_even_with_diagnostic(self):
        output = "W1_S2_SANDBOX_UNAVAILABLE: pivot_root failed: Operation not permitted\n"
        result = receipt.compose(launcher_rc=1, output=output, source_sha256=SOURCE_SHA, runner=RUNNER)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["evidence"]["reason_class"], "PIVOT_ROOT_DENIED")

    def test_receipt_hash_is_deterministic(self):
        a = receipt.compose(launcher_rc=0, output=PASS_OUTPUT, source_sha256=SOURCE_SHA, runner=RUNNER)
        b = receipt.compose(launcher_rc=0, output=PASS_OUTPUT, source_sha256=SOURCE_SHA, runner=RUNNER)
        self.assertEqual(a["receipt_sha256"], b["receipt_sha256"])


if __name__ == "__main__":
    unittest.main()
