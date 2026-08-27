#!/usr/bin/env python3
"""Deterministic main-roadmap cycle oracle (PREP / non-authority).

The oracle turns a live Supabase roadmap/alignment snapshot plus exact Git rail
facts into a reproducible planning or publication receipt.  It deliberately
does not grant provider, database, Edge, merge, or canonical authority.

The two supported phases are intentionally narrow:

* PLAN requires a clean worktree at the exact live remote head.
* PUBLISH requires a clean local commit that is a strict descendant of the
  unchanged live remote head.

Any remote advancement, divergence, roadmap drift, malformed dependency graph,
or missing Level-1 mapping fails closed before a semantic step is claimed.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any, Iterable


SCHEMA = "metaengine.compute.main-roadmap-cycle-oracle.h205f22.v1"
CHECKPOINT_KIND = "MAIN_ROADMAP_CYCLE_ORACLE_RECEIPT_V1"
ROADMAP_ID = "compute-fabric-roadmap-v1"
ROADMAP_REPOSITORY = "PatrickFrome/Compute"
CANONICAL_ROADMAP_PATH = "docs/CANONICAL_ROADMAP.md"
PHASES = {"PLAN", "PUBLISH"}
ELIGIBLE_STATUSES = {"READY", "IN_PROGRESS"}
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,299}$")
MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
MAX_MILESTONES = 256
MAX_DEPENDENCIES_PER_MILESTONE = 64


class OracleInputError(ValueError):
    """Raised for a malformed or internally inconsistent oracle input."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _require_dict(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise OracleInputError(f"{name}_must_be_object")
    return value


def _require_text(value: Any, name: str, *, maximum: int = 300) -> str:
    if not isinstance(value, str) or not value or value.strip() != value or len(value) > maximum:
        raise OracleInputError(f"{name}_invalid")
    return value


def _require_sha40(value: Any, name: str) -> str:
    text = _require_text(value, name, maximum=40)
    if SHA40_RE.fullmatch(text) is None:
        raise OracleInputError(f"{name}_invalid")
    return text


def _require_sha256(value: Any, name: str) -> str:
    text = _require_text(value, name, maximum=64)
    if SHA256_RE.fullmatch(text) is None:
        raise OracleInputError(f"{name}_invalid")
    return text


def _require_ref(value: Any, name: str) -> str:
    text = _require_text(value, name)
    invalid = (
        REF_RE.fullmatch(text) is None
        or ".." in text
        or "@{" in text
        or "//" in text
        or text.endswith(("/", "."))
    )
    if invalid:
        raise OracleInputError(f"{name}_invalid")
    return text


def _read_snapshot(path: str) -> dict[str, Any]:
    if path == "-":
        raw = sys.stdin.read(MAX_SNAPSHOT_BYTES + 1)
    else:
        source = Path(path)
        if source.stat().st_size > MAX_SNAPSHOT_BYTES:
            raise OracleInputError("snapshot_too_large")
        raw = source.read_text(encoding="utf-8")
    if len(raw.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise OracleInputError("snapshot_too_large")
    value = json.loads(raw)
    return _require_dict(value, "snapshot")


def _run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=check,
        capture_output=True,
        text=True,
    )


def _is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    result = _run_git(repo, "merge-base", "--is-ancestor", ancestor, descendant, check=False)
    if result.returncode == 0:
        return True
    if result.returncode == 1:
        return False
    raise OracleInputError("git_ancestry_check_failed")


def inspect_rail(
    *, repo: Path, remote_ref: str, local_ref: str, expected_remote_head: str
) -> dict[str, Any]:
    """Read exact local Git facts after the caller has fetched ``remote_ref``."""
    repo = repo.resolve()
    if not (repo / ".git").exists() and not (repo / ".git").is_file():
        raise OracleInputError("repo_not_git_worktree")
    expected = _require_sha40(expected_remote_head, "expected_remote_head")
    remote_ref = _require_ref(remote_ref, "remote_ref")
    local_ref = _require_ref(local_ref, "local_ref")
    remote = _run_git(repo, "rev-parse", "--verify", "--end-of-options", f"{remote_ref}^{{commit}}").stdout.strip()
    local = _run_git(repo, "rev-parse", "--verify", "--end-of-options", f"{local_ref}^{{commit}}").stdout.strip()
    _require_sha40(remote, "live_remote_head")
    _require_sha40(local, "local_head")

    if local == remote:
        relation = "EXACT"
    elif _is_ancestor(repo, remote, local):
        relation = "LOCAL_AHEAD"
    elif _is_ancestor(repo, local, remote):
        relation = "REMOTE_AHEAD"
    else:
        relation = "DIVERGED"

    dirty = [line for line in _run_git(repo, "status", "--porcelain=v1", "--untracked-files=all").stdout.splitlines() if line]
    return {
        "repository_path": str(repo),
        "remote_ref": remote_ref,
        "local_ref": local_ref,
        "expected_remote_head_sha": expected,
        "live_remote_head_sha": remote,
        "local_head_sha": local,
        "relation": relation,
        "working_tree_clean": not dirty,
        "dirty_path_count": len(dirty),
    }


def _normalize_milestones(raw: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, list) or not raw or len(raw) > MAX_MILESTONES:
        raise OracleInputError("milestones_invalid")
    rows: dict[str, dict[str, Any]] = {}
    for index, value in enumerate(raw):
        row = _require_dict(value, f"milestone_{index}")
        key = _require_text(row.get("milestone_key"), f"milestone_{index}_key")
        if key in rows:
            raise OracleInputError("milestone_key_duplicate")
        blocked_by = row.get("blocked_by")
        if not isinstance(blocked_by, list) or any(not isinstance(dep, str) or not dep for dep in blocked_by):
            raise OracleInputError(f"milestone_{key}_blocked_by_invalid")
        if len(blocked_by) > MAX_DEPENDENCIES_PER_MILESTONE:
            raise OracleInputError(f"milestone_{key}_dependency_limit")
        if len(blocked_by) != len(set(blocked_by)):
            raise OracleInputError(f"milestone_{key}_dependency_duplicate")
        phase_order = int(row.get("phase_order", 10**9))
        priority = int(row.get("priority", 10**9))
        if not 0 <= phase_order <= 1_000_000 or not 0 <= priority <= 1_000_000:
            raise OracleInputError(f"milestone_{key}_ordering_invalid")
        rows[key] = {
            "milestone_key": key,
            "title": _require_text(row.get("title"), f"milestone_{key}_title", maximum=500),
            "lane": _require_text(row.get("lane"), f"milestone_{key}_lane"),
            "effective_status": _require_text(row.get("effective_status"), f"milestone_{key}_status"),
            "blocked_by": sorted(blocked_by),
            "critical_path": row.get("critical_path") is True,
            "phase_order": phase_order,
            "priority": priority,
        }

    for key, row in rows.items():
        for dependency in row["blocked_by"]:
            if dependency == key:
                raise OracleInputError("roadmap_self_dependency")
            if dependency not in rows:
                raise OracleInputError(f"roadmap_dependency_unknown:{dependency}")
    return rows


def _assert_acyclic(rows: dict[str, dict[str, Any]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(key: str) -> None:
        if key in visiting:
            raise OracleInputError("roadmap_dependency_cycle")
        if key in visited:
            return
        visiting.add(key)
        for dependency in rows[key]["blocked_by"]:
            visit(dependency)
        visiting.remove(key)
        visited.add(key)

    for key in sorted(rows):
        visit(key)


def _dependents(rows: dict[str, dict[str, Any]]) -> dict[str, set[str]]:
    direct: dict[str, set[str]] = defaultdict(set)
    for key, row in rows.items():
        for dependency in row["blocked_by"]:
            direct[dependency].add(key)

    answer: dict[str, set[str]] = {}
    for root in rows:
        seen: set[str] = set()
        stack = list(direct[root])
        while stack:
            child = stack.pop()
            if child in seen:
                continue
            seen.add(child)
            stack.extend(direct[child])
        answer[root] = seen
    return answer


def _rank(rows: dict[str, dict[str, Any]], next_mainline: str) -> list[dict[str, Any]]:
    dependents = _dependents(rows)
    verified = {key for key, row in rows.items() if row["effective_status"] == "VERIFIED"}
    ranked: list[dict[str, Any]] = []
    for key, row in rows.items():
        if row["effective_status"] not in ELIGIBLE_STATUSES:
            continue
        transitive = dependents[key]
        direct_unlocks = sorted(
            child_key
            for child_key, child in rows.items()
            if key in child["blocked_by"]
            and child["effective_status"] == "BLOCKED"
            and set(child["blocked_by"]).issubset(verified | {key})
        )
        critical_descendants = sum(1 for child in transitive if rows[child]["critical_path"])
        rank_vector = [
            1 if key == next_mainline else 0,
            critical_descendants,
            len(transitive),
            len(direct_unlocks),
            -row["phase_order"],
            -row["priority"],
        ]
        ranked.append(
            {
                **row,
                "transitive_dependents": len(transitive),
                "critical_descendants": critical_descendants,
                "direct_unlocks": direct_unlocks,
                "rank_vector": rank_vector,
            }
        )
    ranked.sort(key=lambda item: (item["rank_vector"], item["milestone_key"]), reverse=True)
    for ordinal, row in enumerate(ranked, start=1):
        row["rank"] = ordinal
    return ranked


def _canonical_owner(alignment: dict[str, Any], selected_key: str) -> str | None:
    matches = []
    raw_rows = alignment.get("active_claim_alignment", [])
    if not isinstance(raw_rows, list) or len(raw_rows) > 512:
        raise OracleInputError("active_claim_alignment_invalid")
    for raw in raw_rows:
        if isinstance(raw, dict) and raw.get("milestone_key") == selected_key and raw.get("aligned") is True:
            owner = raw.get("canonical_milestone_key")
            if isinstance(owner, str) and owner:
                matches.append(owner)
    return matches[0] if len(set(matches)) == 1 else None


def _blocked_result(error: Exception) -> dict[str, Any]:
    evidence = {"input_valid": False, "error": f"{type(error).__name__}:{error}"}
    return {
        "schema": SCHEMA,
        "outcome": "BLOCK_MAIN_ROADMAP_CYCLE_NONAUTHORITY",
        "cycle_preflight_passed": False,
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        "checkpoint_payload": None,
        "canonical": False,
        "authority_effect": False,
        "provider_mutation_authorized": False,
        "database_ddl_authorized": False,
        "edge_deployment_authorized": False,
        "pr_merge_authorized": False,
    }


def evaluate(snapshot: dict[str, Any], rail: dict[str, Any], *, phase: str) -> dict[str, Any]:
    try:
        if phase not in PHASES:
            raise OracleInputError("phase_invalid")
        source = _require_dict(snapshot, "snapshot")
        roadmap = _require_dict(source.get("roadmap_status"), "roadmap_status")
        alignment = _require_dict(source.get("alignment_status"), "alignment_status")
        rail = _require_dict(rail, "rail")
        if roadmap.get("roadmap_id") != ROADMAP_ID:
            raise OracleInputError("roadmap_id_mismatch")
        rows = _normalize_milestones(roadmap.get("milestones"))
        _assert_acyclic(rows)

        next_row = _require_dict(roadmap.get("next_mainline"), "next_mainline")
        next_key = _require_text(next_row.get("milestone_key"), "next_mainline_key")
        if next_key not in rows or rows[next_key]["effective_status"] not in ELIGIBLE_STATUSES:
            raise OracleInputError("next_mainline_not_eligible")
        if next_row.get("effective_status") != rows[next_key]["effective_status"]:
            raise OracleInputError("next_mainline_status_mismatch")
        ranked = _rank(rows, next_key)
        if not ranked or ranked[0]["milestone_key"] != next_key:
            raise OracleInputError("next_mainline_rank_inconsistent")
        owner = _canonical_owner(alignment, next_key)

        sealed_definition = _require_sha256(roadmap.get("sealed_definition_sha256"), "sealed_definition_sha256")
        current_definition = _require_sha256(roadmap.get("current_definition_sha256"), "current_definition_sha256")
        canonical_digest = _require_sha256(alignment.get("canonical_digest"), "canonical_digest")
        git_source = _require_dict(alignment.get("git_source"), "git_source")
        git_source_commit = _require_sha40(git_source.get("commit"), "git_source_commit")
        expected_remote = _require_sha40(rail.get("expected_remote_head_sha"), "expected_remote_head_sha")
        live_remote = _require_sha40(rail.get("live_remote_head_sha"), "live_remote_head_sha")
        local_head = _require_sha40(rail.get("local_head_sha"), "local_head_sha")
        _require_ref(rail.get("remote_ref"), "remote_ref")
        _require_ref(rail.get("local_ref"), "local_ref")
        relation = _require_text(rail.get("relation"), "rail_relation")
        if relation not in {"EXACT", "LOCAL_AHEAD", "REMOTE_AHEAD", "DIVERGED"}:
            raise OracleInputError("rail_relation_invalid")
        if type(rail.get("dirty_path_count")) is not int or rail["dirty_path_count"] < 0:
            raise OracleInputError("dirty_path_count_invalid")

        checks = {
            "definition_integrity": roadmap.get("definition_integrity") is True,
            "definition_digest_exact": sealed_definition == current_definition,
            "alignment_no_drift": alignment.get("drift_detected") is False,
            "canonical_integrity": alignment.get("canonical_integrity") is True,
            "level2_definition_integrity": alignment.get("level2_definition_integrity") is True,
            "alignment_roadmap_exact": alignment.get("level2_roadmap") == ROADMAP_ID,
            "canonical_git_repository_exact": git_source.get("repository") == ROADMAP_REPOSITORY,
            "canonical_git_path_exact": git_source.get("path") == CANONICAL_ROADMAP_PATH,
            "selected_level1_mapping_exact": owner is not None,
            "remote_head_matches_expectation": live_remote == expected_remote,
            "worktree_clean": rail.get("working_tree_clean") is True,
            "phase_relation_exact": relation == ("EXACT" if phase == "PLAN" else "LOCAL_AHEAD"),
            "publish_is_strict_descendant": phase != "PUBLISH" or local_head != live_remote,
        }
        failed = sorted(name for name, ok in checks.items() if not ok)
        passed = not failed
        selected = {**ranked[0], "canonical_milestone_key": owner}
        ranking = [
            {
                key: row[key]
                for key in (
                    "rank", "milestone_key", "lane", "effective_status", "transitive_dependents",
                    "critical_descendants", "direct_unlocks", "rank_vector"
                )
            }
            for row in ranked
        ]
        evidence = {
            "phase": phase,
            "input_snapshot_sha256": canonical_hash(source),
            "roadmap": {
                "roadmap_id": ROADMAP_ID,
                "definition_sha256": current_definition,
                "canonical_digest": canonical_digest,
                "next_mainline": next_key,
                "git_source": {
                    "repository": git_source.get("repository"),
                    "path": git_source.get("path"),
                    "commit": git_source_commit,
                },
            },
            "selected": selected,
            "ranking": ranking,
            "rail": {
                key: rail.get(key)
                for key in (
                    "remote_ref", "local_ref", "expected_remote_head_sha", "live_remote_head_sha",
                    "local_head_sha", "relation", "working_tree_clean", "dirty_path_count"
                )
            },
            "checks": checks,
            "failed_checks": failed,
        }
        evidence_sha = canonical_hash(evidence)
        checkpoint_payload = {
            "kind": CHECKPOINT_KIND,
            "phase": phase,
            "oracle_outcome": "PASS_MAIN_ROADMAP_CYCLE_NONAUTHORITY",
            "oracle_evidence_sha256": evidence_sha,
            "input_snapshot_sha256": evidence["input_snapshot_sha256"],
            "selected_target": {
                "level1": owner,
                "level2": next_key,
                "status": selected["effective_status"],
                "critical_descendants": selected["critical_descendants"],
                "transitive_dependents": selected["transitive_dependents"],
                "direct_unlocks": selected["direct_unlocks"],
            },
            "rail": evidence["rail"],
            "boundaries": {
                "canonical": False,
                "authority_effect": False,
                "provider_mutation": False,
                "database_ddl_applied": False,
                "edge_deployed": False,
                "pr_merge": False,
            },
        }
        return {
            "schema": SCHEMA,
            "outcome": "PASS_MAIN_ROADMAP_CYCLE_NONAUTHORITY" if passed else "BLOCK_MAIN_ROADMAP_CYCLE_NONAUTHORITY",
            "cycle_preflight_passed": passed,
            "evidence": evidence,
            "evidence_sha256": evidence_sha,
            "checkpoint_payload": checkpoint_payload if passed else None,
            "canonical": False,
            "authority_effect": False,
            "provider_mutation_authorized": False,
            "database_ddl_authorized": False,
            "edge_deployment_authorized": False,
            "pr_merge_authorized": False,
        }
    except (OracleInputError, KeyError, TypeError, ValueError, subprocess.SubprocessError) as error:
        return _blocked_result(error)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True, help="JSON file, or '-' for stdin")
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--remote-ref", required=True)
    parser.add_argument("--local-ref", default="HEAD")
    parser.add_argument("--expected-remote-head", required=True)
    parser.add_argument("--phase", choices=sorted(PHASES), required=True)
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args(list(argv) if argv is not None else None)
    try:
        snapshot = _read_snapshot(ns.snapshot)
        rail = inspect_rail(
            repo=ns.repo,
            remote_ref=ns.remote_ref,
            local_ref=ns.local_ref,
            expected_remote_head=ns.expected_remote_head,
        )
        result = evaluate(snapshot, rail, phase=ns.phase)
    except (OSError, json.JSONDecodeError, OracleInputError, subprocess.SubprocessError) as error:
        result = _blocked_result(error)
    raw = json.dumps(result, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        print(raw, end="")
    return 0 if result["cycle_preflight_passed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
