#!/usr/bin/env python3
"""Fail-closed proof that a roadmap accelerator is a clean main projection.

This is PREP/SHADOW evidence only. It proves Git ancestry, exact projected
content, declared changed paths and stable patch identity. It never grants
merge, database, Edge, provider, checkpoint, or milestone authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

SCHEMA = "metaengine.compute.main-roadmap-projection-guard.h205f22.v1"
EXPECTED_SOURCE_PARENT = "e7c4bac9f1d71f2bc967f533ec4572abf9c1e507"
EXPECTED_SOURCE_COMMIT = "17c9667651aee19a2207e8ade86451e17ed556fd"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")

PROJECTED_PATHS = (
    ".github/workflows/main-roadmap-cycle-oracle.yml",
    "controller/roadmap/__init__.py",
    "controller/roadmap/roadmap_cycle_oracle.py",
    "docs/ROADMAP_EXECUTION_PROTOCOL.md",
    "research/main-roadmap-accelerators/report-source.md",
    "tests/fixtures/main_roadmap_live_snapshot_20260827.json",
    "tests/test_main_roadmap_cycle_oracle.py",
)

GUARD_COMMIT_PATHS = (
    ".github/workflows/main-roadmap-cycle-oracle.yml",
    ".github/workflows/main-roadmap-projection-guard.yml",
    "controller/roadmap/roadmap_projection_guard.py",
    "tests/test_main_roadmap_projection_guard.py",
)

FINAL_DECLARED_PATHS = tuple(sorted(set(PROJECTED_PATHS) | set(GUARD_COMMIT_PATHS)))


class ProjectionError(ValueError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _git(repo: Path, *args: str, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=check,
        capture_output=True,
        text=True,
        input=input_text,
    )


def _sha(repo: Path, ref: str) -> str:
    value = _git(repo, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}").stdout.strip()
    if SHA40_RE.fullmatch(value) is None:
        raise ProjectionError(f"invalid_commit_sha:{ref}")
    return value


def _parents(repo: Path, ref: str) -> tuple[str, ...]:
    fields = _git(repo, "rev-list", "--parents", "-n", "1", ref).stdout.strip().split()
    if not fields:
        raise ProjectionError(f"missing_commit:{ref}")
    return tuple(fields[1:])


def _changed_paths(repo: Path, left: str, right: str) -> tuple[str, ...]:
    rows = _git(repo, "diff", "--name-only", "--no-renames", left, right, "--").stdout.splitlines()
    return tuple(sorted(row for row in rows if row))


def _blob(repo: Path, ref: str, path: str) -> str:
    value = _git(repo, "rev-parse", "--verify", f"{ref}:{path}").stdout.strip()
    if SHA40_RE.fullmatch(value) is None:
        raise ProjectionError(f"invalid_blob:{ref}:{path}")
    return value


def _stable_patch_id(repo: Path, left: str, right: str, paths: tuple[str, ...]) -> str:
    diff = _git(repo, "diff", "--binary", "--full-index", left, right, "--", *paths).stdout
    if not diff:
        raise ProjectionError("empty_projection_patch")
    result = _git(repo, "patch-id", "--stable", input_text=diff).stdout.strip().split()
    if not result or re.fullmatch(r"[0-9a-f]{40,64}", result[0]) is None:
        raise ProjectionError("stable_patch_id_failed")
    return result[0]


def _range_diff(repo: Path, source_parent: str, source_commit: str, base: str, projected: str) -> str:
    result = _git(
        repo,
        "range-diff",
        "--no-color",
        f"{source_parent}..{source_commit}",
        f"{base}..{projected}",
        check=False,
    )
    text = (result.stdout + result.stderr).strip()
    return text[:8192]


def evaluate(
    *,
    repo: Path,
    base_ref: str,
    projected_ref: str,
    candidate_ref: str,
    source_parent_ref: str,
    source_commit_ref: str,
) -> dict[str, Any]:
    try:
        repo = repo.resolve()
        if not (repo / ".git").exists() and not (repo / ".git").is_file():
            raise ProjectionError("repo_not_git_worktree")

        base = _sha(repo, base_ref)
        projected = _sha(repo, projected_ref)
        candidate = _sha(repo, candidate_ref)
        source_parent = _sha(repo, source_parent_ref)
        source_commit = _sha(repo, source_commit_ref)

        source_parents = _parents(repo, source_commit_ref)
        projected_parents = _parents(repo, projected_ref)
        candidate_parents = _parents(repo, candidate_ref)

        source_paths = _changed_paths(repo, source_parent_ref, source_commit_ref)
        projection_paths = _changed_paths(repo, base_ref, projected_ref)
        guard_paths = _changed_paths(repo, projected_ref, candidate_ref)
        final_paths = _changed_paths(repo, base_ref, candidate_ref)

        source_patch_id = _stable_patch_id(repo, source_parent_ref, source_commit_ref, PROJECTED_PATHS)
        projected_patch_id = _stable_patch_id(repo, base_ref, projected_ref, PROJECTED_PATHS)

        blob_match = {
            path: _blob(repo, source_commit_ref, path) == _blob(repo, projected_ref, path)
            for path in PROJECTED_PATHS
        }
        final_immutable_blob_match = {
            path: _blob(repo, source_commit_ref, path) == _blob(repo, candidate_ref, path)
            for path in PROJECTED_PATHS
            if path != ".github/workflows/main-roadmap-cycle-oracle.yml"
        }

        count_text = _git(repo, "rev-list", "--count", f"{base_ref}..{candidate_ref}").stdout.strip()
        try:
            commit_count = int(count_text)
        except ValueError as exc:
            raise ProjectionError("commit_count_invalid") from exc

        ancestor = _git(repo, "merge-base", "--is-ancestor", base_ref, candidate_ref, check=False).returncode == 0
        checks = {
            "source_commit_exact": source_commit == EXPECTED_SOURCE_COMMIT,
            "source_parent_exact": source_parent == EXPECTED_SOURCE_PARENT,
            "source_single_parent_exact": source_parents == (source_parent,),
            "projection_direct_parent_is_live_base": projected_parents == (base,),
            "guard_direct_parent_is_projection": candidate_parents == (projected,),
            "candidate_two_commits_ahead": commit_count == 2,
            "base_is_candidate_ancestor": ancestor,
            "source_changed_paths_exact": source_paths == tuple(sorted(PROJECTED_PATHS)),
            "projection_changed_paths_exact": projection_paths == tuple(sorted(PROJECTED_PATHS)),
            "guard_changed_paths_exact": guard_paths == tuple(sorted(GUARD_COMMIT_PATHS)),
            "final_changed_paths_declared": final_paths == FINAL_DECLARED_PATHS,
            "projected_blobs_exact": all(blob_match.values()),
            "guard_preserves_projected_payload": all(final_immutable_blob_match.values()),
            "stable_patch_id_exact": source_patch_id == projected_patch_id,
        }
        failed = sorted(key for key, value in checks.items() if value is not True)
        evidence = {
            "source": {
                "parent_sha": source_parent,
                "commit_sha": source_commit,
                "stable_patch_id": source_patch_id,
                "changed_paths": list(source_paths),
            },
            "projection": {
                "base_sha": base,
                "projected_commit_sha": projected,
                "candidate_commit_sha": candidate,
                "stable_patch_id": projected_patch_id,
                "commit_count_from_base": commit_count,
                "projection_changed_paths": list(projection_paths),
                "guard_changed_paths": list(guard_paths),
                "final_changed_paths": list(final_paths),
                "blob_match": blob_match,
                "final_immutable_blob_match": final_immutable_blob_match,
            },
            "checks": checks,
            "failed_checks": failed,
            "range_diff_diagnostic": _range_diff(repo, source_parent_ref, source_commit_ref, base_ref, projected_ref),
        }
        passed = not failed
        return {
            "schema": SCHEMA,
            "outcome": "PASS_MAIN_ROADMAP_PROJECTION_NONAUTHORITY" if passed else "BLOCK_MAIN_ROADMAP_PROJECTION_NONAUTHORITY",
            "projection_verified": passed,
            "evidence": evidence,
            "evidence_sha256": canonical_hash(evidence),
            "boundaries": {
                "canonical": False,
                "authority_effect": False,
                "pr_merge_authorized": False,
                "checkpoint_promotion_authorized": False,
                "database_ddl_authorized": False,
                "edge_deployment_authorized": False,
                "provider_mutation_authorized": False,
                "milestone_acceptance_authorized": False,
            },
        }
    except Exception as exc:
        evidence = {"error": f"{type(exc).__name__}:{exc}"}
        return {
            "schema": SCHEMA,
            "outcome": "BLOCK_MAIN_ROADMAP_PROJECTION_NONAUTHORITY",
            "projection_verified": False,
            "evidence": evidence,
            "evidence_sha256": canonical_hash(evidence),
            "boundaries": {
                "canonical": False,
                "authority_effect": False,
                "pr_merge_authorized": False,
                "checkpoint_promotion_authorized": False,
                "database_ddl_authorized": False,
                "edge_deployment_authorized": False,
                "provider_mutation_authorized": False,
                "milestone_acceptance_authorized": False,
            },
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--base-ref", required=True)
    parser.add_argument("--projected-ref", required=True)
    parser.add_argument("--candidate-ref", required=True)
    parser.add_argument("--source-parent-ref", required=True)
    parser.add_argument("--source-commit-ref", required=True)
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    result = evaluate(
        repo=Path(args.repo),
        base_ref=args.base_ref,
        projected_ref=args.projected_ref,
        candidate_ref=args.candidate_ref,
        source_parent_ref=args.source_parent_ref,
        source_commit_ref=args.source_commit_ref,
    )
    rendered = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0 if result["projection_verified"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
