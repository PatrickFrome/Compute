#!/usr/bin/env python3
"""Shadow canary for inherited-FD leakage across the exact S2 worker exec path.

This canary does not enter namespaces and does not claim runtime isolation.  It
reuses rootless_sandbox_launcher_v2._pid1_reaper() while replacing only the
privilege/security setup calls that cannot run in hosted CI.  The purpose is to
answer one narrow question: can a deliberately inheritable parent FD survive
through S2's current fork -> worker exec path?

The candidate close_range path is implemented only inside this canary.  S2 is
modified only after a real baseline leak and candidate closure are both proven.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any

from worker.native_linux import rootless_sandbox_launcher_v2 as s2

SCHEMA = "metaengine.compute.w1-s2-fd-hygiene-shadow-canary.h205f22.v1"
CLOSE_RANGE_UNSHARE = 1 << 1
UINT_MAX = (1 << 32) - 1


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def close_inherited_fds() -> None:
    """Candidate primitive: unshare FD table and close every descriptor >= 3."""
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, "close_range", None)
    if fn is None:
        raise RuntimeError("libc close_range unavailable")
    fn.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_int]
    fn.restype = ctypes.c_int
    if fn(ctypes.c_uint(3), ctypes.c_uint(UINT_MAX), ctypes.c_int(CLOSE_RANGE_UNSHARE)) != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))


def _probe_script() -> str:
    return (
        "import json, os\n"
        "fd=int(os.environ['W1_FD_PROBE'])\n"
        "try:\n"
        " os.fstat(fd); open_=True\n"
        "except OSError:\n"
        " open_=False\n"
        "print(json.dumps({'fd':fd,'inherited_open':open_},sort_keys=True), flush=True)\n"
    )


def run_exec_probe(*, apply_candidate: bool) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="w1-s2-fd-canary-") as td:
        leak_path = Path(td) / "leak.txt"
        leak_path.write_text("S2_FD_LEAK_CANARY\n", encoding="utf-8")
        leak_fd = os.open(leak_path, os.O_RDONLY)
        os.set_inheritable(leak_fd, True)
        if not os.get_inheritable(leak_fd):
            raise RuntimeError("failed to create deliberately inheritable FD")

        out_r, out_w = os.pipe()
        os.set_inheritable(out_w, True)
        env_before = os.environ.copy()
        env_before["W1_FD_PROBE"] = str(leak_fd)

        # The exact S2 worker branch invokes these names through the imported v1
        # module. Replace only privilege-dependent setup; the S2 fork/setsid/
        # readiness-pipe/exec path remains exact.
        original = (
            s2.v1.set_no_new_privs,
            s2.v1.install_seccomp_deny_policy,
            s2.v1.drop_capability_bounding_set,
            os.execvp,
        )

        def noop(*_args, **_kwargs):
            return None

        def exec_probe(_file: str, _argv: list[str]) -> None:
            if apply_candidate:
                close_inherited_fds()
                # candidate closes out_w too, so reopen stdout to the reporting
                # pipe *after* hygiene. This reporting FD is canary-only and does
                # not model a worker-visible inherited capability.
                report_fd = os.open(f"/proc/{os.getppid()}/fd/{out_w}", os.O_WRONLY)
                os.dup2(report_fd, 1)
                if report_fd != 1:
                    os.close(report_fd)
            else:
                os.dup2(out_w, 1)
            os.execve(sys.executable, [sys.executable, "-c", _probe_script()], env_before)

        s2.v1.set_no_new_privs = noop
        s2.v1.install_seccomp_deny_policy = noop
        s2.v1.drop_capability_bounding_set = noop
        os.execvp = exec_probe
        try:
            os.close(out_r) if False else None
            status = s2._pid1_reaper([sys.executable, "-c", _probe_script()])
        finally:
            s2.v1.set_no_new_privs, s2.v1.install_seccomp_deny_policy, s2.v1.drop_capability_bounding_set, os.execvp = original
            try:
                os.close(leak_fd)
            except OSError:
                pass

        # _pid1_reaper waited for the worker, so the full payload is now ready.
        os.close(out_w)
        chunks = []
        while True:
            chunk = os.read(out_r, 4096)
            if not chunk:
                break
            chunks.append(chunk)
        os.close(out_r)
        raw = b"".join(chunks).decode("utf-8").strip()
        if status != 0:
            raise RuntimeError(f"S2 worker probe exited {status}: {raw!r}")
        if not raw:
            raise RuntimeError("S2 worker probe emitted no result")
        payload = json.loads(raw.splitlines()[-1])
        if not isinstance(payload, dict) or payload.get("fd") != leak_fd:
            raise RuntimeError("S2 worker probe output malformed")
        return payload


def evaluate() -> dict[str, Any]:
    baseline = run_exec_probe(apply_candidate=False)
    candidate = run_exec_probe(apply_candidate=True)
    checks = {
        "baseline_deliberate_inherited_fd_reaches_worker_exec": baseline.get("inherited_open") is True,
        "close_range_unshare_blocks_deliberate_inherited_fd": candidate.get("inherited_open") is False,
    }
    outcome = "ACCEPT_CANARY_CLOSE_RANGE_FD_HYGIENE" if all(checks.values()) else "REJECT_OR_RESEARCH_MORE"
    evidence = {
        "exact_exec_path": "worker.native_linux.rootless_sandbox_launcher_v2._pid1_reaper",
        "candidate_primitive": "close_range(3, UINT_MAX, CLOSE_RANGE_UNSHARE)",
        "baseline": baseline,
        "candidate": candidate,
        "checks": checks,
    }
    return {
        "schema": SCHEMA,
        "outcome": outcome,
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        "runtime_isolation_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args()
    result = evaluate()
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        sys.stdout.write(raw)
    return 0 if result["outcome"].startswith("ACCEPT_CANARY") else 2


if __name__ == "__main__":
    raise SystemExit(main())
