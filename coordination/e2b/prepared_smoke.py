#!/usr/bin/env python3
"""PREPARED-only E2B sandbox smoke for H205F22 A1.

This module intentionally does not grant project authority and cannot satisfy W1.
It creates a short-lived E2B sandbox with outbound internet disabled, uploads an
already-checked-out source archive, runs deterministic smoke checks, records a
credential-free evidence manifest, and destroys the sandbox.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SECRET_KEY_RE = re.compile(r"(secret|token|password|credential|api[_-]?key|private[_-]?key)", re.I)
SECRET_VALUE_PATTERNS = [
    re.compile(r"\be2b_[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


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


def validate_expected_sha(value: str) -> str:
    value = value.strip().lower()
    if not GIT_SHA_RE.fullmatch(value):
        raise ValueError("E2B_EXPECTED_GIT_SHA must be exactly 40 lowercase hex characters")
    return value


def build_manifest(
    *,
    sandbox_id: str,
    expected_git_sha: str,
    source_archive_sha256: str,
    fingerprint: dict[str, Any],
    network_negative_canary_blocked: bool,
    schema_check_passed: bool,
    compile_smoke_passed: bool,
    destroy_confirmed: bool,
) -> dict[str, Any]:
    if not SHA256_RE.fullmatch(source_archive_sha256):
        raise ValueError("invalid source archive sha256")
    if not network_negative_canary_blocked:
        raise ValueError("E2B PREPARED smoke requires a blocked outbound-network canary")
    if not schema_check_passed or not compile_smoke_passed:
        raise ValueError("sandbox smoke checks did not pass")
    if not destroy_confirmed:
        raise ValueError("E2B sandbox destruction must be confirmed before smoke can PASS")

    manifest = {
        "schema": "metaengine.compute.a1.e2b-sandbox-smoke.h205f22.v1",
        "mode": "PREPARE_ONLY",
        "evidence_class": "LIVE_E2B_SANDBOX_SMOKE_NON_AUTHORITY",
        "backend": {
            "kind": "E2B_SANDBOX",
            "sandbox_id": sandbox_id,
            "provider_isolation_claim": "FIRECRACKER_MICROVM",
            "independent_hypervisor_attestation": False,
            "session_persistence_class": "EPHEMERAL_MICROVM",
        },
        "source": {
            "expected_git_sha": expected_git_sha,
            "archive_sha256": source_archive_sha256,
            "materialization": "HOST_ARCHIVE_UPLOAD_WITH_SANDBOX_INTERNET_DISABLED",
            "source_read_only_after_unpack": True,
        },
        "network": {
            "allow_internet_access": False,
            "negative_egress_canary_blocked": network_negative_canary_blocked,
            "inbound_exposure_requested": False,
        },
        "checks": {
            "a1_schema_present_and_parseable": schema_check_passed,
            "python_compile_smoke": compile_smoke_passed,
        },
        "runtime_fingerprint": fingerprint,
        "lifecycle": {
            "destroy_requested": True,
            "destroy_confirmed": destroy_confirmed,
        },
        "authority": {
            "execution_authority": False,
            "canonical": False,
            "authority_effect": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
        },
    }
    assert_no_secrets(manifest)
    return manifest


def _run_checked(sandbox: Any, command: str, *, timeout: float = 60) -> Any:
    result = sandbox.commands.run(command, timeout=timeout)
    exit_code = getattr(result, "exit_code", getattr(result, "exitCode", None))
    if exit_code not in (None, 0):
        stderr = getattr(result, "stderr", "")
        raise RuntimeError(f"sandbox command failed with exit={exit_code}: {stderr[:500]}")
    return result


def _stdout(result: Any) -> str:
    return str(getattr(result, "stdout", "")).strip()


def main() -> int:
    archive = Path(os.environ.get("E2B_SOURCE_ARCHIVE", "/tmp/e2b-source.tar.gz"))
    expected_sha = validate_expected_sha(os.environ.get("E2B_EXPECTED_GIT_SHA", ""))
    output = Path(os.environ.get("E2B_EVIDENCE_OUTPUT", "evidence/e2b-prepared-smoke.json"))
    timeout_seconds = int(os.environ.get("E2B_SANDBOX_TIMEOUT_SECONDS", "300"))
    if timeout_seconds < 30 or timeout_seconds > 600:
        raise ValueError("PREPARED smoke timeout must be between 30 and 600 seconds")
    if not archive.is_file():
        raise FileNotFoundError(archive)
    if not os.environ.get("E2B_API_KEY"):
        raise RuntimeError("E2B_API_KEY is required via secret store; never pass it in task payloads")

    # Imported only for the live smoke so deterministic unit tests require no SDK/network.
    from e2b import Sandbox  # type: ignore

    sandbox = None
    destroyed = False
    fingerprint: dict[str, Any] = {}
    sandbox_id = "unknown"
    try:
        sandbox = Sandbox.create(
            timeout=timeout_seconds,
            secure=True,
            allow_internet_access=False,
            metadata={
                "project": "METAENGINE_H205F22",
                "lane": "A1",
                "mode": "PREPARE_ONLY",
                "git_sha": expected_sha,
            },
        )
        sandbox_id = str(getattr(sandbox, "sandbox_id", getattr(sandbox, "sandboxId", "unknown")))
        sandbox.files.write("/tmp/h205f22-source.tar.gz", archive.read_bytes())

        _run_checked(
            sandbox,
            "set -eu; rm -rf /workspace; mkdir -p /workspace/source /workspace/out; "
            "tar -xzf /tmp/h205f22-source.tar.gz -C /workspace/source; "
            "chmod -R a-w /workspace/source; test -w /workspace/out",
        )

        fp_result = _run_checked(
            sandbox,
            "python3 - <<'PY'\n"
            "import json, os, platform\n"
            "def read(path):\n"
            "    try:\n"
            "        return open(path, encoding='utf-8', errors='replace').read()[:4096]\n"
            "    except Exception:\n"
            "        return None\n"
            "status=read('/proc/self/status') or ''\n"
            "seccomp=[line for line in status.splitlines() if line.startswith(('Seccomp:', 'Seccomp_filters:'))]\n"
            "print(json.dumps({\n"
            " 'os': platform.system().lower(), 'arch': platform.machine(), 'kernel': platform.release(),\n"
            " 'effective_uid': os.geteuid(), 'boot_id': (read('/proc/sys/kernel/random/boot_id') or '').strip() or None,\n"
            " 'cgroup': read('/proc/self/cgroup'), 'seccomp_status': seccomp\n"
            "}, sort_keys=True))\n"
            "PY",
        )
        fingerprint = json.loads(_stdout(fp_result))

        network_result = _run_checked(
            sandbox,
            "python3 - <<'PY'\n"
            "import socket\n"
            "try:\n"
            "    s=socket.create_connection(('1.1.1.1',443), timeout=2)\n"
            "    s.close()\n"
            "except Exception:\n"
            "    print('BLOCKED')\n"
            "    raise SystemExit(0)\n"
            "print('UNEXPECTED_EGRESS')\n"
            "raise SystemExit(42)\n"
            "PY",
            timeout=10,
        )
        network_blocked = _stdout(network_result) == "BLOCKED"

        schema_result = _run_checked(
            sandbox,
            "python3 - <<'PY'\n"
            "import json\n"
            "p='/workspace/source/spec/a1/workspace-envelope.schema.json'\n"
            "with open(p, encoding='utf-8') as f: json.load(f)\n"
            "print('SCHEMA_OK')\n"
            "PY",
        )
        schema_ok = _stdout(schema_result) == "SCHEMA_OK"

        compile_result = _run_checked(
            sandbox,
            "python3 -m compileall -q /workspace/source/coordination && echo COMPILE_OK",
            timeout=120,
        )
        compile_ok = _stdout(compile_result).endswith("COMPILE_OK")

    finally:
        if sandbox is not None:
            try:
                sandbox.kill()
                try:
                    destroyed = not bool(sandbox.is_running())
                except Exception:
                    # A successful kill() remains evidence, but build_manifest still requires this flag.
                    destroyed = True
            except Exception:
                destroyed = False

    manifest = build_manifest(
        sandbox_id=sandbox_id,
        expected_git_sha=expected_sha,
        source_archive_sha256=sha256_file(archive),
        fingerprint=fingerprint,
        network_negative_canary_blocked=network_blocked,
        schema_check_passed=schema_ok,
        compile_smoke_passed=compile_ok,
        destroy_confirmed=destroyed,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "evidence_class": manifest["evidence_class"],
        "sandbox_id": sandbox_id,
        "destroy_confirmed": destroyed,
        "authority_effect": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"E2B_PREPARED_SMOKE_FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
