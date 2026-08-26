#!/usr/bin/env python3
"""Build a deterministic, non-authority manifest for the prepared W1 evidence rail.

The manifest is the subject of a GitHub Artifact Attestation.  It deliberately
contains hashes of the execution/evidence/database contract surface instead of
claiming that those files are safe or that W1 is verified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any, Iterable

SCHEMA = "metaengine.compute.w1-prep-attestation-manifest.h205f22.v1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
INCLUDE_GLOBS = (
    "controller/w1/*.py",
    "worker/native_linux/*.py",
    "supabase/migrations/*w1*.sql",
    "tests/test_w1_*.py",
    ".github/workflows/w1-*.yml",
)
NONCLAIMS = {
    "canonical": False,
    "authority_effect": False,
    "authenticated_provider_provenance_verified": False,
    "persistent_worker_proof": False,
    "worker_admitted": False,
    "w1_verified": False,
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _validate_sha40(value: str, label: str) -> str:
    if not SHA40_RE.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def _safe_relpath(root: Path, path: Path) -> str:
    rel = path.relative_to(root).as_posix()
    pure = PurePosixPath(rel)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError(f"unsafe manifest path: {rel!r}")
    return rel


def selected_files(root: Path, globs: Iterable[str] = INCLUDE_GLOBS) -> list[Path]:
    resolved_root = root.resolve(strict=True)
    found: dict[str, Path] = {}
    for pattern in globs:
        for candidate in resolved_root.glob(pattern):
            if not candidate.is_file() or candidate.is_symlink():
                continue
            rel = _safe_relpath(resolved_root, candidate)
            found[rel] = candidate
    if not found:
        raise RuntimeError("W1 attestation manifest selected no files")
    return [found[key] for key in sorted(found)]


def build_manifest(*, root: Path, git_sha: str, tree_sha: str, source_ref: str) -> dict[str, Any]:
    resolved_root = root.resolve(strict=True)
    git_sha = _validate_sha40(git_sha, "git_sha")
    tree_sha = _validate_sha40(tree_sha, "tree_sha")
    if not isinstance(source_ref, str) or not source_ref.startswith("refs/") or len(source_ref) > 512:
        raise ValueError("source_ref must be a refs/* value")

    files = []
    for path in selected_files(resolved_root):
        raw = path.read_bytes()
        files.append({
            "path": _safe_relpath(resolved_root, path),
            "size_bytes": len(raw),
            "sha256": sha256_bytes(raw),
        })

    evidence = {
        "source": {"git_sha": git_sha, "tree_sha": tree_sha, "ref": source_ref},
        "selection_globs": list(INCLUDE_GLOBS),
        "files": files,
        "file_count": len(files),
        "files_sha256": sha256_bytes(canonical_bytes(files)),
    }
    return {
        "schema": SCHEMA,
        "evidence": evidence,
        "evidence_sha256": sha256_bytes(canonical_bytes(evidence)),
        "artifact_attestation_verified": False,
        **NONCLAIMS,
        "next_required": [
            "github_oidc_sigstore_attestation",
            "gh_attestation_policy_verification",
            "fresh_w1_authority_before_live_execution",
        ],
    }


def validate_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("invalid W1 prep attestation manifest schema")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict):
        raise ValueError("manifest evidence missing")
    if value.get("evidence_sha256") != sha256_bytes(canonical_bytes(evidence)):
        raise ValueError("manifest evidence hash mismatch")
    if value.get("artifact_attestation_verified") is not False:
        raise ValueError("manifest cannot self-assert attestation verification")
    for key, expected in NONCLAIMS.items():
        if value.get(key) is not expected:
            raise ValueError(f"manifest {key} must be {expected!r}")
    files = evidence.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("manifest files missing")
    if evidence.get("file_count") != len(files):
        raise ValueError("manifest file_count mismatch")
    if evidence.get("files_sha256") != sha256_bytes(canonical_bytes(files)):
        raise ValueError("manifest files hash mismatch")
    paths = []
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "size_bytes", "sha256"}:
            raise ValueError("invalid manifest file entry")
        path = item["path"]
        if not isinstance(path, str) or path.startswith("/") or ".." in PurePosixPath(path).parts:
            raise ValueError("unsafe manifest file path")
        if not isinstance(item["size_bytes"], int) or isinstance(item["size_bytes"], bool) or item["size_bytes"] < 0:
            raise ValueError("invalid manifest file size")
        if not isinstance(item["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("invalid manifest file sha256")
        paths.append(path)
    if paths != sorted(set(paths)):
        raise ValueError("manifest file paths must be unique and sorted")
    source = evidence.get("source") or {}
    _validate_sha40(source.get("git_sha", ""), "source git_sha")
    _validate_sha40(source.get("tree_sha", ""), "source tree_sha")
    if not isinstance(source.get("ref"), str) or not source["ref"].startswith("refs/"):
        raise ValueError("invalid source ref")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--git-sha", required=True)
    parser.add_argument("--tree-sha", required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--output", type=Path, required=True)
    ns = parser.parse_args()
    manifest = build_manifest(root=ns.root, git_sha=ns.git_sha, tree_sha=ns.tree_sha, source_ref=ns.source_ref)
    validate_manifest(manifest)
    ns.output.parent.mkdir(parents=True, exist_ok=True)
    ns.output.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
