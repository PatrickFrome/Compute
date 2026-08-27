#!/usr/bin/env python3
"""Lease Truth Guard V2.

V2 treats expired rows that are still physically labelled ACTIVE as cleanup
 debt, not authority, *provided every authoritative projection excludes them*.
This mirrors lease systems where expiry invalidates the holder before/independent
of background cleanup. The guard remains PREP-only and non-authoritative.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Iterable

from controller.roadmap import roadmap_lease_truth_guard as v1


SCHEMA = "metaengine.compute.main-roadmap-lease-truth-guard.h205f22.v2"
CHECKPOINT_KIND = "MAIN_ROADMAP_LEASE_TRUTH_RECEIPT_V2"


def _supervisor_directive_ids(snapshot: dict[str, Any]) -> set[int]:
    supervisor = v1._dict(snapshot.get("supervisor_snapshot"), "supervisor_snapshot")
    answer: set[int] = set()
    for index, raw in enumerate(v1._list(supervisor.get("directives", []), "supervisor_directives")):
        row = v1._dict(raw, f"supervisor_directive_{index}")
        answer.add(v1._int(row.get("directive_id"), f"supervisor_directive_{index}_id"))
    return answer


def _alignment_v2_contract(snapshot: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    alignment = v1._dict(snapshot.get("alignment_status"), "alignment_status")
    lease_truth = alignment.get("lease_truth")
    if not isinstance(lease_truth, dict):
        return False, {"reason": "lease_truth_missing"}
    version = lease_truth.get("version")
    stale_authority = lease_truth.get("stale_rows_authority_effect")
    passed = type(version) is int and version >= 2 and stale_authority is False
    return passed, lease_truth


def _blocked(error: Exception, snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    evidence = {
        "input_valid": False,
        "error": f"{type(error).__name__}:{error}",
        "input_snapshot_sha256": v1.canonical_hash(snapshot) if isinstance(snapshot, dict) else None,
    }
    return {
        "schema": SCHEMA,
        "outcome": "BLOCK_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY",
        "lease_truth_passed": False,
        "cleanup_required": False,
        "evidence": evidence,
        "evidence_sha256": v1.canonical_hash(evidence),
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
        source = v1._dict(snapshot, "snapshot")
        if source.get("schema") != v1.SNAPSHOT_SCHEMA:
            raise v1.LeaseTruthError("snapshot_schema_mismatch")
        if source.get("roadmap_id") != v1.ROADMAP_ID:
            raise v1.LeaseTruthError("roadmap_id_mismatch")

        observed_at = v1._time(source.get("observed_at"), "observed_at")
        roadmap = v1._dict(source.get("roadmap_status"), "roadmap_status")
        next_mainline = v1._dict(roadmap.get("next_mainline"), "next_mainline")
        selected = v1._text(next_mainline.get("milestone_key"), "next_mainline_milestone")
        owner, mapping_kind = v1._durable_owner(source, selected)

        fresh_claims, stale_claims = v1._active_claims(source, observed_at)
        fresh_directives, stale_directives = v1._active_directives(source, observed_at)
        selected_fresh_claims = [row for row in fresh_claims if row["milestone_key"] == selected]
        selected_fresh_directives = [row for row in fresh_directives if row["milestone_key"] == selected]

        fresh_claim_ids = {row["claim_id"] for row in fresh_claims}
        stale_claim_ids = {row["claim_id"] for row in stale_claims}
        fresh_directive_ids = {row["directive_id"] for row in fresh_directives}
        stale_directive_ids = {row["directive_id"] for row in stale_directives}

        alignment_ids = v1._alignment_claim_ids(source)
        supervisor_claim_ids = v1._supervisor_claim_ids(source)
        supervisor_directive_ids = _supervisor_directive_ids(source)
        alignment_v2_passed, alignment_lease_truth = _alignment_v2_contract(source)

        checks = {
            "durable_level1_mapping_exact": owner is not None,
            "alignment_lease_truth_v2": alignment_v2_passed,
            "selected_active_claim_unique": len(selected_fresh_claims) <= 1,
            "selected_active_directive_unique": len(selected_fresh_directives) <= 1,
            "alignment_claim_projection_exact": alignment_ids == fresh_claim_ids,
            "alignment_does_not_reference_stale_claim": not bool(alignment_ids & stale_claim_ids),
            "supervisor_active_claim_projection_exact": supervisor_claim_ids == fresh_claim_ids,
            "supervisor_active_directive_projection_exact": supervisor_directive_ids == fresh_directive_ids,
            "supervisor_does_not_reference_stale_directive": not bool(supervisor_directive_ids & stale_directive_ids),
        }
        failed = sorted(name for name, passed in checks.items() if not passed)
        cleanup_required = bool(stale_claims or stale_directives)

        evidence = {
            "observed_at": observed_at.isoformat(),
            "input_snapshot_sha256": v1.canonical_hash(source),
            "selected": {
                "level2_milestone_key": selected,
                "canonical_milestone_key": owner,
                "mapping_kind": mapping_kind,
            },
            "leases": {
                "fresh_claims": fresh_claims,
                "stale_claims_cleanup_debt": stale_claims,
                "fresh_directives": fresh_directives,
                "stale_directives_cleanup_debt": stale_directives,
                "selected_fresh_claims": selected_fresh_claims,
                "selected_fresh_directives": selected_fresh_directives,
                "cleanup_required": cleanup_required,
                "stale_rows_authority_effect": False,
            },
            "projections": {
                "alignment_claim_ids": sorted(alignment_ids),
                "supervisor_active_claim_ids": sorted(supervisor_claim_ids),
                "supervisor_active_directive_ids": sorted(supervisor_directive_ids),
                "fresh_raw_claim_ids": sorted(fresh_claim_ids),
                "fresh_raw_directive_ids": sorted(fresh_directive_ids),
                "alignment_lease_truth": alignment_lease_truth,
            },
            "checks": checks,
            "failed_checks": failed,
        }
        passed = not failed
        evidence_sha = v1.canonical_hash(evidence)
        checkpoint_payload = {
            "kind": CHECKPOINT_KIND,
            "lease_truth_outcome": "PASS_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY",
            "lease_truth_evidence_sha256": evidence_sha,
            "input_snapshot_sha256": evidence["input_snapshot_sha256"],
            "selected_target": evidence["selected"],
            "cleanup_required": cleanup_required,
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
            "cleanup_required": cleanup_required,
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
    except (v1.LeaseTruthError, KeyError, TypeError, ValueError) as error:
        return _blocked(error, snapshot)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True, help="JSON file, or '-' for stdin")
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args(list(argv) if argv is not None else None)
    try:
        snapshot = v1._read_snapshot(ns.snapshot)
        result = evaluate(snapshot)
    except (OSError, json.JSONDecodeError, v1.LeaseTruthError) as error:
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
