#!/usr/bin/env python3
"""Fail-closed verifier for externally issued W1 provider-dispatch receipts.

The external broker authenticates the GitHub Actions workload with GitHub OIDC
and evaluates the live database effective-execution preflight. This verifier
binds that short-lived receipt to the exact workflow run and requested existing
host reboot. It never mints authority itself.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any

SCHEMA = "metaengine.compute.w1-provider-dispatch-authority-broker.h205f22.v1"
PREFLIGHT_SCHEMA = "metaengine.compute.w1-effective-execution-preflight-db.h205f22.v1"
ACTION = "W1_AWS_REBOOT_EXISTING_HOST"
MAX_RECEIPT_AGE_SECONDS = 90
MAX_RECEIPT_TTL_SECONDS = 120
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA64_RE = re.compile(r"^[0-9a-f]{64}$")
NUMERIC_RE = re.compile(r"^[0-9]+$")
INSTANCE_RE = re.compile(r"^i-[0-9a-f]+$")
WORKER_RE = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _utc(value: Any) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("timezone-aware timestamp required")
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("timezone-aware timestamp required")
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def verify(receipt: dict[str, Any], expected: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    checks: dict[str, bool] = {}
    errors: list[str] = []

    try:
        binding = receipt["binding"]
        preflight = receipt["effective_execution_preflight"]
        issued_at = _utc(receipt["broker_observed_at"])
        expires_at = _utc(receipt["receipt_expires_at"])
        oidc_expires_at = _utc(receipt["oidc_expires_at"])
        claim_expires_at = _utc(preflight["evidence"]["claim"]["expires_at"])
        directive_expires_at = _utc(preflight["evidence"]["directive"]["expires_at"])
    except (KeyError, TypeError, ValueError) as exc:
        errors.append(f"INVALID_RECEIPT:{type(exc).__name__}:{exc}")
        evidence = {"checks": {"input_valid": False}, "failed_checks": errors}
        return {
            "schema": "metaengine.compute.w1-provider-dispatch-authority-guard.h205f22.v1",
            "outcome": "BLOCK_W1_PROVIDER_DISPATCH_NONAUTHORITY",
            "dispatch_gate_passed": False,
            "evidence": evidence,
            "evidence_sha256": canonical_hash(evidence),
            "provider_mutation_authorized": False,
            "canonical": False,
            "authority_effect": False,
        }

    unsigned = dict(receipt)
    claimed_hash = unsigned.pop("receipt_sha256", None)
    checks.update({
        "schema_exact": receipt.get("schema") == SCHEMA,
        "outcome_pass": receipt.get("outcome") == "PASS_W1_PROVIDER_DISPATCH_AUTHORITY",
        "broker_gate_passed": receipt.get("dispatch_gate_passed") is True,
        "broker_does_not_mint_authority": receipt.get("broker_mints_authority") is False,
        "broker_authority_effect_false": receipt.get("authority_effect") is False,
        "broker_canonical_false": receipt.get("canonical") is False,
        "receipt_hash_well_formed": isinstance(claimed_hash, str) and SHA64_RE.fullmatch(claimed_hash) is not None,
        "receipt_hash_exact": isinstance(claimed_hash, str) and canonical_hash(unsigned) == claimed_hash,
        "preflight_schema_exact": preflight.get("schema") == PREFLIGHT_SCHEMA,
        "preflight_passed": preflight.get("effective_execution_preflight_passed") is True,
        "preflight_outcome_pass": preflight.get("outcome") == "PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY",
        "preflight_does_not_mint_authority": preflight.get("provider_mutation_authorized") is False,
        "preflight_authority_effect_false": preflight.get("authority_effect") is False,
        "preflight_canonical_false": preflight.get("canonical") is False,
        "receipt_not_from_future": issued_at <= now,
        "receipt_not_expired": expires_at > now,
        "receipt_age_bounded": (now - issued_at).total_seconds() <= MAX_RECEIPT_AGE_SECONDS,
        "receipt_ttl_positive": expires_at > issued_at,
        "receipt_ttl_bounded": (expires_at - issued_at).total_seconds() <= MAX_RECEIPT_TTL_SECONDS,
        "receipt_expires_before_oidc": expires_at <= oidc_expires_at,
        "receipt_expires_before_claim": expires_at <= claim_expires_at,
        "receipt_expires_before_directive": expires_at <= directive_expires_at,
        "action_exact": binding.get("action") == ACTION,
        "repository_exact": binding.get("repository") == expected.get("repository"),
        "repository_id_exact": str(binding.get("repository_id", "")) == str(expected.get("repository_id", "")),
        "github_sha_exact": binding.get("github_sha") == expected.get("github_sha"),
        "github_sha_well_formed": isinstance(binding.get("github_sha"), str) and SHA40_RE.fullmatch(binding["github_sha"]) is not None,
        "github_run_id_exact": str(binding.get("github_run_id", "")) == str(expected.get("github_run_id", "")),
        "github_run_attempt_exact": int(binding.get("github_run_attempt", 0)) == int(expected.get("github_run_attempt", 0)),
        "actor_id_exact": str(binding.get("actor_id", "")) == str(expected.get("actor_id", "")),
        "workflow_ref_exact": binding.get("workflow_ref") == expected.get("workflow_ref"),
        "ref_exact": binding.get("ref") == expected.get("ref"),
        "environment_exact": binding.get("environment") == "w1-persistent-host-proof",
        "instance_id_exact": binding.get("instance_id") == expected.get("instance_id"),
        "instance_id_well_formed": isinstance(binding.get("instance_id"), str) and INSTANCE_RE.fullmatch(binding["instance_id"]) is not None,
        "worker_id_exact": binding.get("worker_id") == expected.get("worker_id"),
        "worker_id_well_formed": isinstance(binding.get("worker_id"), str) and WORKER_RE.fullmatch(binding["worker_id"]) is not None,
        "claim_id_exact": int(binding.get("claim_id", 0)) == int(expected.get("claim_id", 0)),
        "directive_id_exact": int(binding.get("directive_id", 0)) == int(expected.get("directive_id", 0)),
        "preflight_claim_id_exact": int(preflight.get("evidence", {}).get("claim", {}).get("claim_id", 0)) == int(expected.get("claim_id", 0)),
        "preflight_directive_id_exact": int(preflight.get("evidence", {}).get("directive", {}).get("directive_id", 0)) == int(expected.get("directive_id", 0)),
        "oidc_jti_sha256_well_formed": isinstance(receipt.get("oidc_jti_sha256"), str) and SHA64_RE.fullmatch(receipt["oidc_jti_sha256"]) is not None,
    })

    for key in ("repository_id", "github_run_id", "actor_id"):
        value = str(expected.get(key, ""))
        checks[f"expected_{key}_well_formed"] = NUMERIC_RE.fullmatch(value) is not None

    for name, ok in checks.items():
        if not ok:
            errors.append(name)

    passed = all(checks.values())
    evidence = {
        "verified_at": _iso(now),
        "receipt_sha256": claimed_hash,
        "binding": binding,
        "checks": checks,
        "failed_checks": errors,
    }
    return {
        "schema": "metaengine.compute.w1-provider-dispatch-authority-guard.h205f22.v1",
        "outcome": "PASS_W1_PROVIDER_DISPATCH_GUARD_NONAUTHORITY" if passed else "BLOCK_W1_PROVIDER_DISPATCH_NONAUTHORITY",
        "dispatch_gate_passed": passed,
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        "provider_mutation_authorized": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--repository-id", required=True)
    parser.add_argument("--github-sha", required=True)
    parser.add_argument("--github-run-id", required=True)
    parser.add_argument("--github-run-attempt", type=int, required=True)
    parser.add_argument("--actor-id", required=True)
    parser.add_argument("--workflow-ref", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--claim-id", type=int, required=True)
    parser.add_argument("--directive-id", type=int, required=True)
    parser.add_argument("--now")
    ns = parser.parse_args()
    expected = {
        "repository": ns.repository,
        "repository_id": ns.repository_id,
        "github_sha": ns.github_sha,
        "github_run_id": ns.github_run_id,
        "github_run_attempt": ns.github_run_attempt,
        "actor_id": ns.actor_id,
        "workflow_ref": ns.workflow_ref,
        "ref": ns.ref,
        "instance_id": ns.instance_id,
        "worker_id": ns.worker_id,
        "claim_id": ns.claim_id,
        "directive_id": ns.directive_id,
    }
    now = _utc(ns.now) if ns.now else None
    receipt = json.loads(ns.receipt.read_text(encoding="utf-8"))
    result = verify(receipt, expected, now)
    ns.output.parent.mkdir(parents=True, exist_ok=True)
    ns.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return 0 if result["dispatch_gate_passed"] else 4


if __name__ == "__main__":
    raise SystemExit(main())
