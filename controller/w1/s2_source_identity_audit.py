#!/usr/bin/env python3
"""Fail-closed audit for every W1 S2-v2 source SHA binding.

Git/Sigstore provenance proves which bytes a workflow produced, but it does not
prove that every repository-local consumer agrees on the same launcher source
identity. This audit supplies that missing semantic consistency check.

It recomputes the exact launcher SHA-256, validates a closed inventory of known
binding consumers, rejects stale/missing/duplicate bindings, and scans every
small UTF-8 repository file for newly introduced undeclared consumers.
Historical research is excluded from the consumer scan because it is evidence,
not executable/current source identity policy.

PREP / non-authority only. It never mutates a provider or admits/verifies W1.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

SCHEMA = "metaengine.compute.w1-s2-source-identity-audit.h205f22.v2"
SOURCE_PATH = "worker/native_linux/rootless_sandbox_launcher_v2.py"
SOURCE_HINTS = (
    SOURCE_PATH,
    Path(SOURCE_PATH).name,
    Path(SOURCE_PATH).stem,
    "launcher_v2",
)
SHA256_RE = re.compile(r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])")
IGNORED_PARTS = {
    ".git",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".tox",
    ".venv",
    "venv",
    "node_modules",
    ".next",
    "build",
    "dist",
    "coverage",
    "out",
}
MAX_TEXT_BYTES = 2 * 1024 * 1024

# Every current source-identity consumer must be listed here. Counts are exact
# occurrences of the *current* launcher SHA in the file. The docs intentionally
# carry the identity twice: once in the source section and once in the execution
# review checklist.
DECLARED_BINDINGS: dict[str, int] = {
    ".github/workflows/w1-rootless-sandbox-launcher-v2-contract.yml": 1,
    ".github/workflows/w1-rootless-sandbox-runtime-canary.yml": 1,
    ".github/workflows/w1-s2-pid1-resource-shadow-canary.yml": 1,
    "docs/W1_S2_ROOTLESS_SANDBOX_LAUNCHER_V2.md": 2,
    "supabase/migrations/20260826060000_w1_pre_persistence_evidence_manifest_v1.sql": 1,
    "tests/test_w1_pre_persistence_db_contract.py": 1,
    "tests/test_w1_rootless_sandbox_launcher_v2.py": 1,
    "worker/native_linux/w1_lifecycle_evidence_harness.py": 1,
}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def source_sha256(root: Path) -> str:
    source = root / SOURCE_PATH
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"S2 source missing: {SOURCE_PATH}")
    try:
        source.resolve(strict=True).relative_to(root)
    except ValueError as exc:
        raise RuntimeError(f"S2 source escapes audit root: {SOURCE_PATH}") from exc
    return hashlib.sha256(source.read_bytes()).hexdigest()


def _read_text(path: Path) -> str | None:
    if path.is_symlink():
        return None
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if b"\x00" in raw or len(raw) > MAX_TEXT_BYTES:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _repo_text_files(root: Path):
    """Yield every small UTF-8 file, independent of filename suffix.

    A suffix allowlist previously allowed shell wrappers, Dockerfiles/Makefiles,
    .cfg/.txt files and other extensionless policy consumers to evade discovery.
    Binary/large content is rejected by _read_text instead.
    """
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in IGNORED_PARTS for part in rel.parts):
            continue
        if _read_text(path) is None:
            continue
        yield rel, path


def _source_hint(text: str) -> str | None:
    for hint in SOURCE_HINTS:
        if hint in text:
            return hint
    return None


def evaluate(root: Path) -> dict[str, Any]:
    root = root.resolve()
    current = source_sha256(root)
    declared_results: dict[str, Any] = {}
    declared_ok = True

    for rel, expected_count in sorted(DECLARED_BINDINGS.items()):
        path = root / rel
        text = _read_text(path) if path.is_file() else None
        literals = SHA256_RE.findall(text or "")
        current_count = literals.count(current)
        stale_literals = sorted(set(value for value in literals if value != current))
        ok = text is not None and current_count == expected_count and not stale_literals
        declared_results[rel] = {
            "expected_current_sha_occurrences": expected_count,
            "actual_current_sha_occurrences": current_count,
            "stale_sha256_literals": stale_literals,
            "ok": ok,
        }
        declared_ok = declared_ok and ok

    undeclared: list[dict[str, Any]] = []
    declared_paths = set(DECLARED_BINDINGS)
    scanned_text_files = 0
    for rel_path, path in _repo_text_files(root):
        rel = rel_path.as_posix()
        if rel in declared_paths or rel.startswith("research/"):
            continue
        text = _read_text(path)
        if text is None:
            continue
        scanned_text_files += 1
        literals = SHA256_RE.findall(text)
        if not literals:
            continue
        hint = _source_hint(text)
        # Exact current SHA anywhere is necessarily a source-identity reference
        # unless inventoried. Any SHA-256 literal combined with an exact or
        # partial launcher hint is also a potential stale/orphan binding.
        if current in literals or hint is not None:
            undeclared.append({
                "path": rel,
                "contains_current_sha": current in literals,
                "sha256_literals": sorted(set(literals)),
                "source_hint": hint,
            })

    evidence = {
        "source_path": SOURCE_PATH,
        "source_sha256": current,
        "declared_binding_count": len(DECLARED_BINDINGS),
        "declared_bindings": declared_results,
        "scanned_text_file_count": scanned_text_files,
        "undeclared_binding_consumers": undeclared,
        "checks": {
            "all_declared_bindings_exact": declared_ok,
            "no_undeclared_binding_consumers": not undeclared,
        },
    }
    passed = all(evidence["checks"].values())
    return {
        "schema": SCHEMA,
        "outcome": "PASS_EXACT_SOURCE_IDENTITY_AUDIT_NONAUTHORITY" if passed else "FAIL_SOURCE_IDENTITY_DRIFT",
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
    return 0 if result["outcome"] == "PASS_EXACT_SOURCE_IDENTITY_AUDIT_NONAUTHORITY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
