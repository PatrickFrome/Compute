#!/usr/bin/env python3
"""Shadow canary for inherited-FD leakage across the exact S2 worker exec path.

This canary does not enter namespaces and does not claim runtime isolation. It
reuses rootless_sandbox_launcher_v2._pid1_reaper() while replacing only the
privilege/security setup calls that cannot run in hosted CI. The purpose is to
answer one narrow question: does S2's integrated close_range barrier prevent a
deliberately inheritable parent FD from reaching the worker exec path?

The baseline disables only S2's exact FD barrier. The candidate executes the
current launcher implementation without duplicating the security primitive in
the canary, so drift between the canary and production path fails visibly.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
from typing import Any

# Support direct-file execution from controller/w1 without relying on PYTHONPATH.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from worker.native_linux import rootless_sandbox_launcher_v2 as s2

SCHEMA = "metaengine.compute.w1-s2-fd-hygiene-shadow-canary.h205f22.v2"


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _probe_script(leak_fd: int) -> str:
    return (
        "import json, os\n"
        f"fd={leak_fd}\n"
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
        base_fd = os.open(leak_path, os.O_RDONLY)
        leak_fd = fcntl.fcntl(base_fd, fcntl.F_DUPFD, 200)
        os.close(base_fd)
        os.set_inheritable(leak_fd, True)
        if not os.get_inheritable(leak_fd):
            raise RuntimeError("failed to create deliberately inheritable FD")

        out_r, out_w = os.pipe()
        os.set_inheritable(out_w, True)

        # The exact S2 worker branch invokes these names through the imported v1
        # module. Replace only privilege-dependent setup; the S2 fork/setsid/
        # readiness-pipe/exec path remains exact.
        original_security = (
            s2.v1.set_no_new_privs,
            s2.v1.install_seccomp_deny_policy,
            s2.v1.drop_capability_bounding_set,
        )
        original_close_inherited_fds = s2._close_inherited_fds
        original_handlers = {sig: signal.getsignal(sig) for sig in s2.HANDLED_SIGNALS}

        def noop(*_args, **_kwargs):
            return None

        s2.v1.set_no_new_privs = noop
        s2.v1.install_seccomp_deny_policy = noop
        s2.v1.drop_capability_bounding_set = noop
        if not apply_candidate:
            s2._close_inherited_fds = noop
        original_mask = signal.pthread_sigmask(signal.SIG_BLOCK, s2.HANDLED_SIGNALS)
        saved_stdout = os.dup(1)
        os.dup2(out_w, 1)
        try:
            status = s2._pid1_reaper(
                [sys.executable, "-c", _probe_script(leak_fd)],
                Path(td),
                original_mask,
            )
        finally:
            signal.pthread_sigmask(signal.SIG_BLOCK, s2.HANDLED_SIGNALS)
            for sig, handler in original_handlers.items():
                signal.signal(sig, handler)
            signal.pthread_sigmask(signal.SIG_SETMASK, original_mask)
            s2.v1.set_no_new_privs, s2.v1.install_seccomp_deny_policy, s2.v1.drop_capability_bounding_set = original_security
            s2._close_inherited_fds = original_close_inherited_fds
            os.dup2(saved_stdout, 1)
            os.close(saved_stdout)
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
        "candidate_primitive": "rootless_sandbox_launcher_v2._close_inherited_fds",
        "baseline_mutation": "only _close_inherited_fds replaced with noop",
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
