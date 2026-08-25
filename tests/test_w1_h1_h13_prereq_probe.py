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


def _can_map_parent_identity_in_unprivileged_userns() -> bool:
    """Return true only when this CI/runtime can exercise uid/gid mapping.

    Some hosted runners allow CLONE_NEWUSER but fence /proc/self/setgroups or
    uid_map/gid_map. That is an environment limitation, not a regression in the
    probe's source ordering, so the live kernel test must skip there rather than
    report a false code failure.
    """
    if not sys.platform.startswith("linux") or os.geteuid() == 0:
        return False
    libc = ctypes.CDLL(None, use_errno=True)
    parent_uid, parent_gid = os.getuid(), os.getgid()
    pid = os.fork()
    if pid == 0:
        try:
            if libc.unshare(ctypes.c_int(CLONE_NEWUSER)) != 0:
                os._exit(1)
            setgroups = Path("/proc/self/setgroups")
            if setgroups.exists():
                current = setgroups.read_text(encoding="ascii").strip()
                if current == "allow":
                    setgroups.write_text("deny\n", encoding="ascii")
                elif current != "deny":
                    os._exit(1)
            Path("/proc/self/uid_map").write_text(
                f"{parent_uid} {parent_uid} 1\n", encoding="ascii"
            )
            Path("/proc/self/gid_map").write_text(
                f"{parent_gid} {parent_gid} 1\n", encoding="ascii"
            )
            os._exit(0)
        except (OSError, PermissionError):
            os._exit(1)
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
        _can_map_parent_identity_in_unprivileged_userns(),
        "requires a runtime that permits unprivileged userns uid/gid mapping",
    )
    def test_overflow_identity_cannot_be_mapped_but_pre_unshare_identity_can(self):
        libc = ctypes.CDLL(None, use_errno=True)
        read_fd, write_fd = os.pipe()
        parent_uid, parent_gid = os.getuid(), os.getgid()
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
                if setgroups.exists():
                    current = setgroups.read_text(encoding="ascii").strip()
                    if current == "allow":
                        setgroups.write_text("deny\n", encoding="ascii")
                    elif current != "deny":
                        raise RuntimeError(f"unexpected_setgroups:{current}")
                try:
                    Path("/proc/self/uid_map").write_text(
                        f"{overflow_uid} {overflow_uid} 1\n", encoding="ascii"
                    )
                    result["overflow_map_accepted"] = True
                except PermissionError:
                    result["overflow_map_accepted"] = False
                Path("/proc/self/uid_map").write_text(
                    f"{parent_uid} {parent_uid} 1\n", encoding="ascii"
                )
                Path("/proc/self/gid_map").write_text(
                    f"{parent_gid} {parent_gid} 1\n", encoding="ascii"
                )
                result["parent_map_accepted"] = True
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
