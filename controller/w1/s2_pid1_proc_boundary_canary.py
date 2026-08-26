#!/usr/bin/env python3
"""Direct non-authority kernel canary for the W1 PID1 proc-read fence.

This does not enter provider namespaces and does not claim S2 runtime success.
It measures the exact Linux primitive used by S2: a same-UID parent can read a
control child's initial /proc/<pid>/environ, while the same relationship is
denied after the child installs PR_SET_DUMPABLE=0. Secret bytes are never
included in the receipt or logs.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import resource
import secrets
import subprocess
import sys
from typing import Any

SCHEMA = "metaengine.compute.w1-s2-pid1-proc-boundary-canary.h205f22.v1"
PR_GET_DUMPABLE = 3
PR_SET_DUMPABLE = 4
SUID_DUMP_DISABLE = 0
SECRET_KEY = "W1_PID1_PROC_BOUNDARY_SECRET"


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _child(*, harden: bool) -> int:
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.restype = ctypes.c_int
    if harden:
        if libc.prctl(ctypes.c_int(PR_SET_DUMPABLE), ctypes.c_ulong(SUID_DUMP_DISABLE), 0, 0, 0) != 0:
            err = ctypes.get_errno()
            print(json.dumps({"ready": False, "error": f"prctl-set:{err}"}), flush=True)
            return 2
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    dumpable = libc.prctl(ctypes.c_int(PR_GET_DUMPABLE), 0, 0, 0, 0)
    core = resource.getrlimit(resource.RLIMIT_CORE)
    print(json.dumps({"ready": True, "dumpable": int(dumpable), "core_zero": core == (0, 0)}), flush=True)
    sys.stdin.readline()
    return 0


def _start_child(*, harden: bool, secret: str) -> tuple[subprocess.Popen[str], dict[str, Any]]:
    env = os.environ.copy()
    env[SECRET_KEY] = secret
    mode = "--child-hardened" if harden else "--child-control"
    process = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), mode],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    assert process.stdout is not None
    line = process.stdout.readline()
    if not line:
        stderr = process.stderr.read() if process.stderr is not None else ""
        process.kill()
        process.wait(timeout=5)
        raise RuntimeError(f"child did not become ready rc={process.returncode}: {stderr[-1000:]}")
    state = json.loads(line)
    if state.get("ready") is not True:
        process.kill()
        process.wait(timeout=5)
        raise RuntimeError(f"child hardening failed: {state}")
    return process, state


def _finish(process: subprocess.Popen[str]) -> None:
    if process.stdin is not None:
        try:
            process.stdin.write("done\n")
            process.stdin.flush()
            process.stdin.close()
        except BrokenPipeError:
            pass
    rc = process.wait(timeout=5)
    if rc != 0:
        stderr = process.stderr.read() if process.stderr is not None else ""
        raise RuntimeError(f"child exit rc={rc}: {stderr[-1000:]}")


def _read_environ(pid: int, needle: bytes) -> dict[str, Any]:
    path = Path(f"/proc/{pid}/environ")
    try:
        data = path.read_bytes()
    except OSError as exc:
        return {
            "readable": False,
            "secret_visible": False,
            "errno": int(exc.errno or 0),
            "denied": exc.errno in (errno.EACCES, errno.EPERM),
        }
    return {
        "readable": True,
        "secret_visible": needle in data,
        "errno": 0,
        "denied": False,
    }


def evaluate() -> dict[str, Any]:
    secret = secrets.token_hex(32)
    needle = f"{SECRET_KEY}={secret}".encode("ascii")

    control, control_state = _start_child(harden=False, secret=secret)
    try:
        control_probe = _read_environ(control.pid, needle)
    finally:
        _finish(control)

    hardened, hardened_state = _start_child(harden=True, secret=secret)
    try:
        hardened_probe = _read_environ(hardened.pid, needle)
    finally:
        _finish(hardened)

    checks = {
        "control_dumpable_nonzero": control_state["dumpable"] != SUID_DUMP_DISABLE,
        "control_environ_readable": control_probe["readable"] is True,
        "control_secret_visible": control_probe["secret_visible"] is True,
        "hardened_dumpable_zero": hardened_state["dumpable"] == SUID_DUMP_DISABLE,
        "hardened_core_zero": hardened_state["core_zero"] is True,
        "hardened_environ_denied": hardened_probe["denied"] is True,
        "hardened_secret_not_visible": hardened_probe["secret_visible"] is False,
    }
    evidence = {
        "checks": checks,
        "control": {
            "dumpable": control_state["dumpable"],
            "proc_environ": control_probe,
        },
        "hardened": {
            "dumpable": hardened_state["dumpable"],
            "core_zero": hardened_state["core_zero"],
            "proc_environ": hardened_probe,
        },
        "secret_material_persisted": False,
        "scope": "HOST_KERNEL_PR_SET_DUMPABLE_PRIMITIVE_ONLY_NOT_S2_NAMESPACE_RUNTIME",
    }
    return {
        "schema": SCHEMA,
        "outcome": "PASS_DIRECT_PROC_BOUNDARY_NONAUTHORITY" if all(checks.values()) else "FAIL_BOUNDARY_NOT_PROVEN",
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
    parser.add_argument("--child-control", action="store_true")
    parser.add_argument("--child-hardened", action="store_true")
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args()
    if ns.child_control:
        return _child(harden=False)
    if ns.child_hardened:
        return _child(harden=True)
    result = evaluate()
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        sys.stdout.write(raw)
    return 0 if result["outcome"] == "PASS_DIRECT_PROC_BOUNDARY_NONAUTHORITY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
