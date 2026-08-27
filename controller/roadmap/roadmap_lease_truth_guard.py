#!/usr/bin/env python3
"""Fail-closed lease truth guard for main-roadmap planning.

The guard separates durable Level-2 -> Level-1 ownership from transient claim
and directive leases. It consumes a single-statement Supabase snapshot with an
explicit observation timestamp and rejects stale ACTIVE rows before they can be
mistaken for current authority.

This is PREP / non-authority evidence only. It never mutates Supabase, GitHub,
providers, Edge functions, checkpoints, or milestone state.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, Iterable


SCHEMA = "metaengine.compute.main-roadmap-lease-truth-guard.h205f22.v1"
SNAPSHOT_SCHEMA = "metaengine.compute.main-roadmap-lease-truth-snapshot.h205f22.v1"
CHECKPOINT_KIND = "MAIN_ROADMAP_LEASE_TRUTH_RECEIPT_V1"
ROADMAP_ID = "compute-fabric-roadmap-v1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024
MAX_ROWS = 1024
VALID_MAPPING_KINDS = {"PRIMARY", "SUBMILESTONE", "ACCEPTANCE_GATE", "CROSS_CUTTING"}
EXPIRING_DIRECTIVE_KINDS = {"REASSIGN"}


class LeaseTruthError(ValueError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _dict(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise LeaseTruthError(f"{name}_must_be_object")
    return value


def _list(value: Any, name: str) -> list[Any]:
    if not isinstance(value, list) or len(value) > MAX_ROWS:
        raise LeaseTruthError(f"{name}_invalid")
    return value


def _text(value: Any, name: str, *, maximum: int = 500) -> str:
    if not isinstance(value, str) or not value or value.strip() != value or len(value) > maximum:
        raise LeaseTruthError(f"{name}_invalid")
    return value


def _int(value: Any, name: str) -> int:
    if type(value) is not int or value < 0:
        raise LeaseTruthError(f"{name}_invalid")
    return value


def _time(value: Any, name: str) -> datetime:
    raw = _text(value, name, maximum=64)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise LeaseTruthError(f"{name}_invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise LeaseTruthError(f"{name}_timezone_required")
    return parsed.astimezone(timezone.utc)


def _optional_time(value: Any, name: str) -> datetime | None:
    if value is None:
        return None
    return _time(value, name)


def _read_snapshot(path: str) -> dict[str, Any]:
    if path == "-":
        raw = sys.stdin.read(MAX_SNAPSHOT_BYTES + 1)
    else:
        source = Path(path)
        if source.stat().st_size > MAX_SNAPSHOT_BYTES:
            raise LeaseTruthError("snapshot_too_large")
        raw = source.read_text(encoding="utf-8")
    if len(raw.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise LeaseTruthError("snapshot_too_large")
    return _dict(json.loads(raw), "snapshot")


def _durable_owner(snapshot: dict[str, Any], selected: str) -> tuple[str | None, str | None]:
    matches: list[tuple[str | None, str]] = []
    for index, raw in enumerate(_list(snapshot.get("level2_mapping"), "level2_mapping")):
        row = _dict(raw, f"level2_mapping_{index}")
        milestone = _text(row.get("milestone_key"), f"level2_mapping_{index}_milestone")
        kind = _text(row.get("mapping_kind"), f"level2_mapping_{index}_kind")
        if kind not in VALID_MAPPING_KINDS:
            raise LeaseTruthError("mapping_kind_invalid")
        owner = row.get("canonical_milestone_key")
        if owner is not None:
            owner = _text(owner, f"level2_mapping_{index}_canonical")
        if milestone == selected:
            matches.append((owner, kind))
    if len(matches) != 1:
        raise LeaseTruthError("selected_durable_mapping_not_unique")
    owner, kind = matches[0]
    if kind == "CROSS_CUTTING" or owner is None:
        raise LeaseTruthError("selected_durable_mapping_has_no_level1_owner")
    return owner, kind


def _active_claims(snapshot: dict[str, Any], observed_at: datetime) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    fresh: list[dict[str, Any]] = []
    stale: list[dict[str, Any]] = []
    seen: set[int] = set()
    for index, raw in enumerate(_list(snapshot.get("active_claim_rows"), "active_claim_rows")):
        row = _dict(raw, f"active_claim_{index}")
        claim_id = _int(row.get("claim_id"), f"active_claim_{index}_id")
        if claim_id in seen:
            raise LeaseTruthError("active_claim_id_duplicate")
        seen.add(claim_id)
        if row.get("state") != "ACTIVE":
            raise LeaseTruthError("active_claim_snapshot_contains_nonactive")
        milestone = _text(row.get("milestone_key"), f"active_claim_{index}_milestone")
        holder = _text(row.get("holder_id"), f"active_claim_{index}_holder")
        heartbeat_at = _time(row.get("heartbeat_at"), f"active_claim_{index}_heartbeat")
        expires_at = _time(row.get("expires_at"), f"active_claim_{index}_expires")
        normalized = {
            "claim_id": claim_id,
            "milestone_key": milestone,
            "holder_id": holder,
            "heartbeat_at": heartbeat_at.isoformat(),
            "expires_at": expires_at.isoformat(),
        }
        if expires_at <= observed_at or heartbeat_at > observed_at or heartbeat_at >= expires_at:
            stale.append(normalized)
        else:
            fresh.append(normalized)
    return fresh, stale


def _active_directives(snapshot: dict[str, Any], observed_at: datetime) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    fresh: list[dict[str, Any]] = []
    stale: list[dict[str, Any]] = []
    seen: set[int] = set()
    for index, raw in enumerate(_list(snapshot.get("active_directive_rows"), "active_directive_rows")):
        row = _dict(raw, f"active_directive_{index}")
        directive_id = _int(row.get("directive_id"), f"active_directive_{index}_id")
        if directive_id in seen:
            raise LeaseTruthError("active_directive_id_duplicate")
        seen.add(directive_id)
        if row.get("status") != "ACTIVE":
            raise LeaseTruthError("active_directive_snapshot_contains_nonactive")
        milestone = _text(row.get("milestone_key"), f"active_directive_{index}_milestone")
        kind = _text(row.get("directive_kind"), f"active_directive_{index}_kind")
        created_at = _time(row.get("created_at"), f"active_directive_{index}_created")
        expires_at = _optional_time(row.get("expires_at"), f"active_directive_{index}_expires")
        normalized = {
            "directive_id": directive_id,
            "milestone_key": milestone,
            "directive_kind": kind,
            "created_at": created_at.isoformat(),
            "expires_at": expires_at.isoformat() if expires_at is not None else None,
        }
        invalid_clock = created_at > observed_at or (expires_at is not None and created_at >= expires_at)
        missing_required_expiry = kind in EXPIRING_DIRECTIVE_KINDS and expires_at is None
        expired = expires_at is not None and expires_at <= observed_at
        if invalid_clock or missing_required_expiry or expired:
            stale.append(normalized)
        else:
            fresh.append(normalized)
    return fresh, stale


def _alignment_claim_ids(snapshot: dict[str, Any]) -> set[int]:
    alignment = _dict(snapshot.get("alignment_status"), "alignment_status")
    answer: set[int] = set()
    for index, raw in enumerate(_list(alignment.get("active_claim_alignment", []), "active_claim_alignment")):
        row = _dict(raw, f"active_claim_alignment_{index}")
        if "claim_id" in row:
            answer.add(_int(row.get("claim_id"), f"active_claim_alignment_{index}_claim_id"))
    return answer


def _supervisor_claim_ids(snapshot: dict[str, Any]) -> set[int]:
    supervisor = _dict(snapshot.get("supervisor_snapshot"), "supervisor_snapshot")
    answer: set[int] = set()
    for index, raw in enumerate(_list(supervisor.get("active_claims", []), "supervisor_active_claims")):
        row = _dict(raw, f"supervisor_active_claim_{index}")
        answer.add(_int(row.get("claim_id"), f"supervisor_active_claim_{index}_id"))
    return answer


def _blocked(error: Exception, snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    evidence = {
        "input_valid": False,
        "error": f"{type(error).__name__}:{error}",
        "input_snapshot_sha256": canonical_hash(snapshot) if isinstance(snapshot, dict) else None,
    }
    return {
        "schema": SCHEMA,
        "outcome": "BLOCK_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY",
        "lease_truth_passed": False,
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        "checkpoint_payload": None,
        "canonical": False,
        "authority_effect": False,
        "database_mutation_authorized": False,
        "provider_mutation_authorized": False,
        "edge_deployment_authorized": False,
        "pr_merge_authorized": False,
        "checkpoint_promotion_authorized": False,
    }


def evaluate(snapshot: dict[str, Any]) -> dict[str, Any]:
    try:
        source = _dict(snapshot, "snapshot")
        if source.get("schema") != SNAPSHOT_SCHEMA:
            raise LeaseTruthError("snapshot_schema_mismatch")
        if source.get("roadmap_id") != ROADMAP_ID:
            raise LeaseTruthError("roadmap_id_mismatch")
        observed_at = _time(source.get("observed_at"), "observed_at")
        roadmap = _dict(source.get("roadmap_status"), "roadmap_status")
        next_mainline = _dict(roadmap.get("next_mainline"), "next_mainline")
        selected = _text(next_mainline.get("milestone_key"), "next_mainline_milestone")
        owner, mapping_kind = _durable_owner(source, selected)

        fresh_claims, stale_claims = _active_claims(source, observed_at)
        fresh_directives, stale_directives = _active_directives(source, observed_at)
        selected_fresh_claims = [row for row in fresh_claims if row["milestone_key"] == selected]
        selected_fresh_directives = [row for row in fresh_directives if row["milestone_key"] == selected]

        stale_claim_ids = {row["claim_id"] for row in stale_claims}
        alignment_ids = _alignment_claim_ids(source)
        supervisor_ids = _supervisor_claim_ids(source)
        fresh_claim_ids = {row["claim_id"] for row in fresh_claims}

        checks = {
            "durable_level1_mapping_exact": owner is not None,
            "no_stale_active_claims": not stale_claims,
            "no_stale_active_directives": not stale_directives,
            "selected_active_claim_unique": len(selected_fresh_claims) <= 1,
            "selected_active_directive_unique": len(selected_fresh_directives) <= 1,
            "alignment_does_not_reference_stale_claim": not bool(alignment_ids & stale_claim_ids),
            "supervisor_active_claim_projection_exact": supervisor_ids == fresh_claim_ids,
        }
        failed = sorted(name for name, passed in checks.items() if not passed)
        evidence = {
            "observed_at": observed_at.isoformat(),
            "input_snapshot_sha256": canonical_hash(source),
            "selected": {
                "level2_milestone_key": selected,
                "canonical_milestone_key": owner,
                "mapping_kind": mapping_kind,
            },
            "leases": {
                "fresh_claims": fresh_claims,
                "stale_claims": stale_claims,
                "fresh_directives": fresh_directives,
                "stale_directives": stale_directives,
                "selected_fresh_claims": selected_fresh_claims,
                "selected_fresh_directives": selected_fresh_directives,
            },
            "projections": {
                "alignment_claim_ids": sorted(alignment_ids),
                "supervisor_active_claim_ids": sorted(supervisor_ids),
                "fresh_raw_claim_ids": sorted(fresh_claim_ids),
            },
            "checks": checks,
            "failed_checks": failed,
        }
        passed = not failed
        evidence_sha = canonical_hash(evidence)
        checkpoint_payload = {
            "kind": CHECKPOINT_KIND,
            "lease_truth_outcome": "PASS_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY",
            "lease_truth_evidence_sha256": evidence_sha,
            "input_snapshot_sha256": evidence["input_snapshot_sha256"],
            "selected_target": evidence["selected"],
            "boundaries": {
                "canonical": False,
                "authority_effect": False,
                "database_mutation": False,
                "provider_mutation": False,
                "edge_deployment": False,
                "pr_merge": False,
                "checkpoint_promotion": False,
            },
        }
        return {
            "schema": SCHEMA,
            "outcome": "PASS_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY" if passed else "BLOCK_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY",
            "lease_truth_passed": passed,
            "evidence": evidence,
            "evidence_sha256": evidence_sha,
            "checkpoint_payload": checkpoint_payload if passed else None,
            "canonical": False,
            "authority_effect": False,
            "database_mutation_authorized": False,
            "provider_mutation_authorized": False,
            "edge_deployment_authorized": False,
            "pr_merge_authorized": False,
            "checkpoint_promotion_authorized": False,
        }
    except (LeaseTruthError, KeyError, TypeError, ValueError) as error:
        return _blocked(error, snapshot)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True, help="JSON file, or '-' for stdin")
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args(list(argv) if argv is not None else None)
    try:
        snapshot = _read_snapshot(ns.snapshot)
        result = evaluate(snapshot)
    except (OSError, json.JSONDecodeError, LeaseTruthError) as error:
        result = _blocked(error)
    raw = json.dumps(result, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        print(raw, end="")
    return 0 if result["lease_truth_passed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
