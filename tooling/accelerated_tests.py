#!/usr/bin/env python3
"""Run the deterministic Python regression suite within the real CPU budget.

This is an ACC1/C3 PREPARE_ONLY accelerator for the W1 critical path. It does
not admit a worker, establish toolchain parity, enable a shared cache, or grant
roadmap authority. The runner uses argv-only subprocess execution, a locked
environment supplied by uv, and pytest-xdist's work-stealing scheduler.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from typing import Sequence

REPORT_SCHEMA = "metaengine.compute.accelerated-test-report.h205f22.v1"
DEFAULT_CPU_MAX = Path("/sys/fs/cgroup/cpu.max")
DEFAULT_LOCKFILE = Path("uv.lock")
MAX_LOCAL_WORKERS = 32


def _positive_int(raw: str, label: str) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be an integer") from exc
    if value < 1:
        raise ValueError(f"{label} must be positive")
    return value


def cgroup_cpu_quota(path: Path = DEFAULT_CPU_MAX) -> int | None:
    """Return the cgroup-v2 whole-CPU budget, or None for an unlimited group."""
    try:
        fields = path.read_text(encoding="utf-8").strip().split()
    except OSError:
        return None
    if len(fields) != 2:
        raise ValueError("cpu.max must contain quota and period")
    quota_raw, period_raw = fields
    if quota_raw == "max":
        _positive_int(period_raw, "cpu.max period")
        return None
    quota = _positive_int(quota_raw, "cpu.max quota")
    period = _positive_int(period_raw, "cpu.max period")
    return max(1, quota // period)


def available_cpu_budget(cpu_max_path: Path = DEFAULT_CPU_MAX) -> int:
    affinity = None
    sched_getaffinity = getattr(os, "sched_getaffinity", None)
    if callable(sched_getaffinity):
        try:
            affinity = len(sched_getaffinity(0))
        except OSError:
            affinity = None
    online = affinity or os.cpu_count() or 1
    quota = cgroup_cpu_quota(cpu_max_path)
    return max(1, min(online, quota if quota is not None else online))


def resolve_workers(requested: str, cpu_budget: int) -> int:
    if requested == "auto":
        return min(cpu_budget, MAX_LOCAL_WORKERS)
    workers = _positive_int(requested, "workers")
    if workers > cpu_budget:
        raise ValueError(
            f"workers={workers} exceeds detected CPU budget={cpu_budget}; "
            "nested overcommit is rejected"
        )
    if workers > MAX_LOCAL_WORKERS:
        raise ValueError(f"workers exceeds hard limit={MAX_LOCAL_WORKERS}")
    return workers


def build_pytest_command(
    workers: int,
    pytest_args: Sequence[str],
) -> list[str]:
    command = [sys.executable, "-m", "pytest", "-q"]
    if workers > 1:
        command.extend(
            [
                "-n",
                str(workers),
                "--dist",
                "worksteal",
                "--max-worker-restart",
                "0",
            ]
        )
    command.extend(pytest_args)
    return command


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_source(root: Path) -> dict[str, str | None]:
    def read_ref(*args: str) -> str | None:
        try:
            return subprocess.run(
                ["git", "-C", str(root), *args],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            return None

    return {
        "git_sha": read_ref("rev-parse", "HEAD"),
        "tree_sha": read_ref("rev-parse", "HEAD^{tree}"),
    }


def build_report(
    *,
    root: Path,
    command: Sequence[str],
    cpu_budget: int,
    workers: int,
    duration_seconds: float,
    returncode: int,
) -> dict[str, object]:
    lockfile = root / DEFAULT_LOCKFILE
    return {
        "schema": REPORT_SCHEMA,
        "mode": "PREPARE_ONLY",
        "source": git_source(root),
        "environment": {
            "python": sys.version.split()[0],
            "cpu_budget": cpu_budget,
            "workers": workers,
            "scheduler": "pytest-xdist-worksteal" if workers > 1 else "serial",
            "uv_lock_sha256": sha256_file(lockfile) if lockfile.is_file() else None,
        },
        "execution": {
            "argv": list(command),
            "shell": False,
            "duration_seconds": round(duration_seconds, 6),
            "returncode": returncode,
            "outcome": "PASS" if returncode == 0 else "FAIL",
        },
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "worker_admitted": False,
            "w1_verified": False,
            "acc1_verified": False,
            "shared_cache_reuse": False,
        },
    }


def write_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as handle:
        json.dump(report, handle, sort_keys=True, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", default="auto", help="auto or a positive integer")
    parser.add_argument("--report", type=Path)
    parser.add_argument("pytest_args", nargs="*")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    cpu_budget = available_cpu_budget()
    workers = resolve_workers(args.workers, cpu_budget)
    command = build_pytest_command(workers, args.pytest_args)
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=root,
        env={**os.environ, "PYTHONHASHSEED": os.environ.get("PYTHONHASHSEED", "0")},
        check=False,
    )
    report = build_report(
        root=root,
        command=command,
        cpu_budget=cpu_budget,
        workers=workers,
        duration_seconds=time.perf_counter() - started,
        returncode=completed.returncode,
    )
    if args.report is not None:
        write_report(args.report, report)
    print(json.dumps(report, sort_keys=True))
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
