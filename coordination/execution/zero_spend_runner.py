#!/usr/bin/env python3
"""Provider-neutral PREPARED execution contract for H205F22.

Runs the same deterministic checks on GitHub Actions and AppVeyor, binds the
result to the exact checked-out Git SHA, and emits a credential-free evidence
manifest. This lane is ephemeral CI execution only: it never satisfies W1,
never grants project authority, and never canonicalizes state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SECRET_KEY_RE = re.compile(r"(secret|token|password|credential|api[_-]?key|private[_-]?key)", re.I)
SECRET_VALUE_PATTERNS = [
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\be2b_[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]

PROVIDERS = {
    "github-actions": {
        "expected_sha_env": "GITHUB_SHA",
        "run_id_env": "GITHUB_RUN_ID",
        "run_number_env": "GITHUB_RUN_NUMBER",
        "job_env": "GITHUB_JOB",
    },
    "appveyor": {
        "expected_sha_env": "APPVEYOR_REPO_COMMIT",
        "run_id_env": "APPVEYOR_BUILD_ID",
        "run_number_env": "APPVEYOR_BUILD_NUMBER",
        "job_env": "APPVEYOR_JOB_ID",
    },
}

CHECKS = [
    [sys.executable, "-m", "py_compile", "coordination/e2b/prepared_smoke.py"],
    [sys.executable, "-m", "unittest", "tests.a1.test_e2b_prepared_smoke", "-v"],
    ["node", "--check", "coordination/gpt-worker/src/guards.mjs"],
    ["node", "--check", "coordination/gpt-worker/src/index.mjs"],
    ["node", "--test", "coordination/gpt-worker/test/guards.test.mjs"],
]


def sha256_json(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def run_capture(argv: list[str], *, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, text=True, capture_output=True, timeout=timeout, check=False)


def git(*args: str) -> str:
    p = run_capture(["git", *args], timeout=30)
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr[:500]}")
    return p.stdout.strip()


def read_memory_bytes() -> int | None:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) * 1024
    except Exception:
        return None
    return None


def version_of(argv: list[str]) -> str | None:
    if shutil.which(argv[0]) is None:
        return None
    p = run_capture(argv, timeout=15)
    text = (p.stdout or p.stderr).strip().splitlines()
    return text[0][:300] if text else None


def assert_no_secrets(value: Any, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if SECRET_KEY_RE.search(str(key)):
                raise ValueError(f"secret-like evidence key forbidden at {path}.{key}")
            assert_no_secrets(item, f"{path}.{key}")
        return
    if isinstance(value, list):
        for i, item in enumerate(value):
            assert_no_secrets(item, f"{path}[{i}]")
        return
    if isinstance(value, str):
        for pattern in SECRET_VALUE_PATTERNS:
            if pattern.search(value):
                raise ValueError(f"secret-like evidence value forbidden at {path}")


def run_checks() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for argv in CHECKS:
        p = run_capture(argv)
        item = {
            "command": argv,
            "passed": p.returncode == 0,
            "returncode": p.returncode,
        }
        results.append(item)
        if p.returncode != 0:
            sys.stderr.write(p.stdout[-3000:])
            sys.stderr.write(p.stderr[-3000:])
            raise RuntimeError(f"check failed: {' '.join(argv)}")
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=sorted(PROVIDERS), required=True)
    parser.add_argument("--output", default="evidence/zero-spend-execution.json")
    args = parser.parse_args()

    provider_cfg = PROVIDERS[args.provider]
    expected_sha = os.environ.get(provider_cfg["expected_sha_env"], "").strip().lower()
    if not SHA40_RE.fullmatch(expected_sha):
        raise ValueError(f"{provider_cfg['expected_sha_env']} must be an exact 40-hex commit SHA")

    current_sha = git("rev-parse", "HEAD").lower()
    if current_sha != expected_sha:
        raise RuntimeError(f"stale/wrong checkout: expected {expected_sha}, got {current_sha}")

    tree_sha = git("rev-parse", "HEAD^{tree}").lower()
    tracked_changes = git("status", "--porcelain", "--untracked-files=no")
    if tracked_changes:
        raise RuntimeError("tracked working tree must be clean before execution")

    checks = run_checks()

    contract = {
        "schema": "metaengine.compute.a1.zero-spend-execution-contract.h205f22.v1",
        "check_commands": CHECKS,
        "source_binding": "EXACT_GIT_SHA_AND_TREE",
        "authority_effect": False,
    }
    provider_neutral_result = {
        "contract_sha256": sha256_json(contract),
        "git_sha": current_sha,
        "tree_sha": tree_sha,
        "checks": [{"command": x["command"], "passed": x["passed"]} for x in checks],
    }

    manifest = {
        "schema": "metaengine.compute.a1.zero-spend-execution-evidence.h205f22.v1",
        "mode": "PREPARE_ONLY",
        "evidence_class": "LIVE_EPHEMERAL_CI_EXECUTION_NON_AUTHORITY",
        "provider": {
            "kind": args.provider,
            "execution_class": "EPHEMERAL_CI_VM",
            "run_id": os.environ.get(provider_cfg["run_id_env"]) or None,
            "run_number": os.environ.get(provider_cfg["run_number_env"]) or None,
            "job_id": os.environ.get(provider_cfg["job_env"]) or None,
        },
        "source": {
            "git_sha": current_sha,
            "tree_sha": tree_sha,
            "expected_git_sha": expected_sha,
            "tracked_tree_clean_before_execution": True,
        },
        "contract": {
            "sha256": sha256_json(contract),
            "provider_neutral_result_sha256": sha256_json(provider_neutral_result),
        },
        "runtime": {
            "os": platform.system().lower(),
            "arch": platform.machine(),
            "kernel": platform.release(),
            "cpu_logical": os.cpu_count(),
            "memory_bytes": read_memory_bytes(),
            "python": platform.python_version(),
            "node": version_of(["node", "--version"]),
            "git": version_of(["git", "--version"]),
        },
        "checks": checks,
        "authority": {
            "execution_authority": False,
            "canonical": False,
            "authority_effect": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
        },
    }

    assert_no_secrets(manifest)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": "PASS",
        "provider": args.provider,
        "git_sha": current_sha,
        "provider_neutral_result_sha256": manifest["contract"]["provider_neutral_result_sha256"],
        "authority_effect": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ZERO_SPEND_EXECUTION_FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
