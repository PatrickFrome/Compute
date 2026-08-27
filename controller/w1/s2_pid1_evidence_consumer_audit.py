#!/usr/bin/env python3
"""Fail-closed whole-repo audit for W1 PID1 resource evidence consumers.

PID1 resource evidence schema v3 separates deterministic adopted evidence from
host-dependent RLIMIT_NOFILE observations. This PREP-only audit prevents a
current downstream consumer from silently retaining the legacy v2 schema or
reading NOFILE fields from evidence.probe/evidence.checks.

Historical research is excluded. The audit itself and its fixture tests are
excluded because they necessarily encode the forbidden patterns as policy data.
No provider mutation, worker admission, or W1 verification occurs here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

SCHEMA = "metaengine.compute.w1-s2-pid1-evidence-consumer-audit.h205f22.v1"
PID1_SCHEMA_PREFIX = "metaengine.compute.w1-s2-pid1-resource-regression.h205f22"
CURRENT_PID1_SCHEMA = PID1_SCHEMA_PREFIX + ".v3"
LEGACY_PID1_SCHEMA = PID1_SCHEMA_PREFIX + ".v2"
MAX_TEXT_BYTES = 2 * 1024 * 1024
IGNORED_PARTS = {
    ".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".tox",
    ".venv", "venv", "node_modules", ".next", "build", "dist",
    "coverage", "out",
}
POLICY_FIXTURE_PATHS = {
    "controller/w1/s2_pid1_evidence_consumer_audit.py",
    "tests/test_w1_s2_pid1_evidence_consumer_audit.py",
}

# Common programmatic forms of the old layout. These deliberately target reads
# under evidence.probe/evidence.checks rather than mere field-name mentions in
# migration notes or the v3 excluded_host_dependent_fields metadata.
LEGACY_LAYOUT_PATTERNS = (
    re.compile(r"\[\s*['\"]evidence['\"]\s*\].{0,160}\[\s*['\"](?:probe|checks)['\"]\s*\].{0,160}\[\s*['\"]rlimit_nofile_", re.S),
    re.compile(r"\$\.evidence\.(?:probe|checks)\.rlimit_nofile_"),
    re.compile(r"\{\s*evidence\s*,\s*(?:probe|checks)\s*,\s*rlimit_nofile_"),
)


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _read_text(path: Path) -> str | None:
    if path.is_symlink():
        return None
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if len(raw) > MAX_TEXT_BYTES or b"\x00" in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _repo_text_files(root: Path):
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in IGNORED_PARTS for part in rel.parts):
            continue
        text = _read_text(path)
        if text is not None:
            yield rel.as_posix(), text


def _legacy_layout_matches(text: str) -> list[str]:
    labels = []
    for index, pattern in enumerate(LEGACY_LAYOUT_PATTERNS, start=1):
        if pattern.search(text):
            labels.append(f"legacy_layout_pattern_{index}")
    return labels


def evaluate(root: Path) -> dict[str, Any]:
    root = root.resolve()
    legacy_schema_consumers: list[str] = []
    legacy_layout_consumers: list[dict[str, Any]] = []
    current_schema_consumers: list[str] = []
    scanned = 0

    for rel, text in _repo_text_files(root):
        if rel.startswith("research/") or rel in POLICY_FIXTURE_PATHS:
            continue
        scanned += 1
        if LEGACY_PID1_SCHEMA in text:
            legacy_schema_consumers.append(rel)
        layout = _legacy_layout_matches(text)
        if layout:
            legacy_layout_consumers.append({"path": rel, "matches": layout})
        if CURRENT_PID1_SCHEMA in text:
            current_schema_consumers.append(rel)

    legacy_schema_consumers.sort()
    legacy_layout_consumers.sort(key=lambda item: item["path"])
    current_schema_consumers.sort()
    evidence = {
        "current_pid1_schema": CURRENT_PID1_SCHEMA,
        "legacy_pid1_schema": LEGACY_PID1_SCHEMA,
        "scanned_text_file_count": scanned,
        "current_schema_consumers": current_schema_consumers,
        "legacy_schema_consumers": legacy_schema_consumers,
        "legacy_layout_consumers": legacy_layout_consumers,
        "checks": {
            "no_legacy_v2_schema_consumers": not legacy_schema_consumers,
            "no_legacy_nofile_reads_under_adopted_evidence": not legacy_layout_consumers,
            "current_v3_schema_is_consumed": bool(current_schema_consumers),
        },
    }
    passed = all(evidence["checks"].values())
    return {
        "schema": SCHEMA,
        "outcome": "PASS_PID1_EVIDENCE_CONSUMER_AUDIT_NONAUTHORITY" if passed else "FAIL_PID1_EVIDENCE_CONSUMER_DRIFT",
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
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args()
    result = evaluate(ns.root)
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        print(raw, end="")
    return 0 if result["outcome"] == "PASS_PID1_EVIDENCE_CONSUMER_AUDIT_NONAUTHORITY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
