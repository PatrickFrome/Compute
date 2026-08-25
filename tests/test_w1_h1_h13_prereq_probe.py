from __future__ import annotations

import ctypes
import inspect
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "worker" / "native_linux"
if str(NATIVE) not in sys.path:
    sys.path.insert(0, str(NATIVE))

import h1_h13_prereq_probe as probe  # noqa: E402

CLONE_NEWUSER = 0x10000000


def _can_fork_unprivileged_userns() -> bool:
    if not sys.platform.startswith("linux") or os.geteuid() == 0:
        return False
    libc = ctypes.CDLL(None, use_errno=True)
    pid = os.fork()
    if pid == 0:
        code = 0 if libc.unshare(ctypes.c_int(CLONE_NEWUSER)) == 0 else 1
        os._exit(code)
    _, status = os.waitpid(pid, 0)
    return os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0


class PrereqProbeUidMapIdentityTests(unittest.TestCase):
    """Regression: uid/gid for uid_map/gid_map must be captured BEFORE unshare.

    After unshare(CLONE_NEWUSER) the unmapped process reads the overflow
    identity (typically 65534). An unprivileged process may only write an
    identity mapping of its real parent-namespace uid/gid, so any capture
    performed after the unshare produces a mapping the kernel rejects.
    """

    def test_capture_precedes_unshare_in_canary_source(self):
        source = inspect.getsource(probe._namespace_canary)
        capture_pos = source.find("uid, gid = os.getuid(), os.getgid()")
        unshare_pos = source.find("unshare(ctypes.c_int(CLONE_NEWUSER))")
        self.assertGreaterEqual(capture_pos, 0, "identity capture line not found")
        self.assertGreaterEqual(unshare_pos, 0, "CLONE_NEWUSER unshare call not found")
        self.assertLess(
            capture_pos,
            unshare_pos,
            "identity must be captured before unshare(CLONE_NEWUSER); "
            "after the unshare getuid()/getgid() return the unmapped overflow identity",
        )
        post_capture = source.find("uid, gid = os.getuid()", unshare_pos)
        self.assertEqual(post_capture, -1, "post-unshare identity capture found")

    @unittest.skipUnless(
        _can_fork_unprivileged_userns(),
        "requires linux + non-root + unprivileged user namespaces",
    )
    def test_overflow_identity_cannot_be_mapped_but_pre_unshare_identity_can(self):
        libc = ctypes.CDLL(None, use_errno=True)
        read_fd, write_fd = os.pipe()
        parent_uid = os.getuid()
        pid = os.fork()
        if pid == 0:
            os.close(read_fd)
            result: dict[str, object] = {}
            try:
                if libc.unshare(ctypes.c_int(CLONE_NEWUSER)) != 0:
                    raise OSError(ctypes.get_errno(), "unshare_user")
                overflow_uid = os.getuid()
                result["overflow_uid"] = overflow_uid
                result["overflow_differs_from_parent"] = overflow_uid != parent_uid
                setgroups = Path("/proc/self/setgroups")
                if setgroups.read_text(encoding="ascii").strip() == "allow":
                    setgroups.write_text("deny\n", encoding="ascii")
                try:
                    Path("/proc/self/uid_map").write_text(
                        f"{overflow_uid} {overflow_uid} 1\n", encoding="ascii"
                    )
                    result["overflow_map_accepted"] = True
                except PermissionError:
                    result["overflow_map_accepted"] = False
                try:
                    Path("/proc/self/uid_map").write_text(
                        f"{parent_uid} {parent_uid} 1\n", encoding="ascii"
                    )
                    result["parent_map_accepted"] = True
                except PermissionError:
                    result["parent_map_accepted"] = False
            except Exception as exc:  # child-only diagnostic
                result["error"] = f"{type(exc).__name__}:{exc}"
            os.write(write_fd, json.dumps(result).encode("utf-8"))
            os.close(write_fd)
            os._exit(0)
        os.close(write_fd)
        raw = b""
        while True:
            chunk = os.read(read_fd, 65536)
            if not chunk:
                break
            raw += chunk
        os.close(read_fd)
        os.waitpid(pid, 0)
        result = json.loads(raw.decode("utf-8"))
        self.assertNotIn("error", result, f"child failed: {result.get('error')}")
        self.assertTrue(result["overflow_differs_from_parent"])
        self.assertFalse(
            result["overflow_map_accepted"],
            "kernel unexpectedly accepted the overflow identity mapping",
        )
        self.assertTrue(
            result["parent_map_accepted"],
            "pre-unshare parent identity mapping was rejected",
        )


if __name__ == "__main__":
    unittest.main()
