#!/usr/bin/env python3
"""Fail-closed W1 effective-execution preflight (PREP / non-authority).

A database row can retain a human-readable ACTIVE label after its expires_at has
passed. Provider execution must never treat labels alone as effective authority.
This oracle composes the physical clock, semantic head, roadmap integrity,
claim and supervisor directive into one deterministic preflight receipt.

A PASS means only that the supplied authority snapshot is internally aligned and
fresh. It does not itself authorize provider mutation, admit a worker, or verify
W1. The live implementation must source db_now from PostgreSQL clock_timestamp().
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any

SCHEMA = "metaengine.compute.w1-effective-execution-preflight.h205f22.v1"
ROADMAP_ID = "compute-fabric-roadmap-v1"
MILESTONE_KEY = "W1_PERSISTENT_LINUX_WORKER_SAFETY"
HOLDER_ID = "aop1:W1_IMPLEMENTER"
ALLOWED_ROADMAP_STATES = {"READY", "IN_PROGRESS"}
ALLOWED_DIRECTIVE_KINDS = {"OPEN", "CONTINUE", "REASSIGN"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _utc_iso(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("timestamp string required")
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("timezone-aware timestamp required")
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _dt(value: str) -> datetime:
    normalized = _utc_iso(value)
    return datetime.fromisoformat(normalized.replace("Z", "+00:00"))


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None


def evaluate(snapshot: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    try:
        db_now = _utc_iso(snapshot["db_now"])
        now_dt = _dt(db_now)
        head = snapshot["semantic_head"]
        roadmap = snapshot["roadmap"]
        claim = snapshot["claim"]
        directive = snapshot["directive"]
        claim_exp = _utc_iso(claim["expires_at"])
        directive_exp = _utc_iso(directive["expires_at"])
    except (KeyError, TypeError, ValueError) as exc:
        errors.append(f"INVALID_INPUT:{type(exc).__name__}:{exc}")
        evidence = {
            "input_valid": False,
            "errors": errors,
            "checks": {"input_valid": False},
        }
        return {
            "schema": SCHEMA,
            "outcome": "BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY",
            "effective_execution_preflight_passed": False,
            "evidence": evidence,
            "evidence_sha256": canonical_hash(evidence),
            "provider_mutation_authorized": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
        }

    checkpoint = head.get("checkpoint_id")
    root_sha = head.get("payload_root_sha256")
    checks: dict[str, bool] = {
        "input_valid": True,
        "definition_integrity": roadmap.get("definition_integrity") is True,
        "canonical_integrity": roadmap.get("canonical_integrity") is True,
        "roadmap_state_allows_w1_execution": roadmap.get("w1_effective_status") in ALLOWED_ROADMAP_STATES,
        "claim_roadmap_exact": claim.get("roadmap_id") == ROADMAP_ID,
        "claim_milestone_exact": claim.get("milestone_key") == MILESTONE_KEY,
        "claim_holder_exact": claim.get("holder_id") == HOLDER_ID,
        "claim_state_active": claim.get("state") == "ACTIVE",
        "claim_not_expired": _dt(claim_exp) > now_dt,
        "claim_checkpoint_matches_head": claim.get("base_checkpoint_id") == checkpoint,
        "claim_payload_root_matches_head": claim.get("base_payload_root_sha256") == root_sha,
        "directive_roadmap_exact": directive.get("roadmap_id") == ROADMAP_ID,
        "directive_milestone_exact": directive.get("milestone_key") == MILESTONE_KEY,
        "directive_kind_allows_execution": directive.get("directive_kind") in ALLOWED_DIRECTIVE_KINDS,
        "directive_target_holder_exact": directive.get("target_holder_id") == HOLDER_ID,
        "directive_status_active": directive.get("status") == "ACTIVE",
        "directive_not_expired": _dt(directive_exp) > now_dt,
        "directive_not_superseded": directive.get("superseded_at") is None,
        "directive_checkpoint_matches_head": directive.get("base_checkpoint_id") == checkpoint,
        "holder_pair_aligned": claim.get("holder_id") == directive.get("target_holder_id"),
        "semantic_payload_root_well_formed": _is_sha256(root_sha),
    }

    for name, ok in checks.items():
        if not ok:
            errors.append(name)

    evidence = {
        "db_now": db_now,
        "semantic_head": {
            "checkpoint_id": checkpoint,
            "payload_root_sha256": root_sha,
        },
        "roadmap": {
            "definition_integrity": roadmap.get("definition_integrity"),
            "canonical_integrity": roadmap.get("canonical_integrity"),
            "w1_effective_status": roadmap.get("w1_effective_status"),
        },
        "claim": {
            "claim_id": claim.get("claim_id"),
            "roadmap_id": claim.get("roadmap_id"),
            "milestone_key": claim.get("milestone_key"),
            "holder_id": claim.get("holder_id"),
            "state": claim.get("state"),
            "expires_at": claim_exp,
            "base_checkpoint_id": claim.get("base_checkpoint_id"),
            "base_payload_root_sha256": claim.get("base_payload_root_sha256"),
        },
        "directive": {
            "directive_id": directive.get("directive_id"),
            "roadmap_id": directive.get("roadmap_id"),
            "milestone_key": directive.get("milestone_key"),
            "directive_kind": directive.get("directive_kind"),
            "target_holder_id": directive.get("target_holder_id"),
            "status": directive.get("status"),
            "expires_at": directive_exp,
            "superseded_at": directive.get("superseded_at"),
            "base_checkpoint_id": directive.get("base_checkpoint_id"),
        },
        "checks": checks,
        "failed_checks": errors,
    }
    passed = all(checks.values())
    return {
        "schema": SCHEMA,
        "outcome": "PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY" if passed else "BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY",
        "effective_execution_preflight_passed": passed,
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        # The preflight is evidence only. A caller must still possess fresh,
        # independently verified execution authority before mutating a provider.
        "provider_mutation_authorized": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args()
    snapshot = json.loads(ns.snapshot.read_text(encoding="utf-8"))
    result = evaluate(snapshot)
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        print(raw, end="")
    return 0 if result["effective_execution_preflight_passed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
