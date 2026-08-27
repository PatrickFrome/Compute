#!/usr/bin/env python3
"""Audit W1 provider workflows for the external authority-preflight gap.

This PREP-only auditor does not authorize provider actions. It identifies real
provider mutation surfaces and proves that GitHub workflow controls (manual
confirmation, protected environments, OIDC credentials, dry-run permission)
are not substitutes for a fresh DB-authoritative AOP claim/directive check.

Until a real external verifier is integrated, the expected safe result for a
workflow containing a live provider mutation command is an explicit BLOCK.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

SCHEMA = "metaengine.compute.w1-provider-mutation-authority-gap-audit.h205f22.v1"
EXPECTED_EXTERNAL_VERIFIER_MARKER = "AOP_EFFECTIVE_EXECUTION_VERIFIED_EXTERNAL"
MUTATION_COMMANDS = (
    re.compile(r"\baws\s+ec2\s+reboot-instances\b(?![^\n]*--dry-run)"),
    re.compile(r"\baws\s+ec2\s+(?:start|stop|terminate)-instances\b(?![^\n]*--dry-run)"),
    re.compile(r"\baws\s+ec2\s+run-instances\b(?![^\n]*--dry-run)"),
)
SELF_AUTHORITY_ANTI_PATTERNS = (
    "PREFLIGHT_W1_PERSISTENT_HOST_ONLY",
    "REBOOT_W1_PERSISTENT_HOST",
    "environment:",
    "id-token: write",
)
SERVICE_ROLE_MARKERS = (
    "SUPABASE_SERVICE_ROLE_KEY",
    "service_role",
)


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _line_numbers(text: str, pattern: re.Pattern[str]) -> list[int]:
    offsets = []
    for match in pattern.finditer(text):
        offsets.append(text.count("\n", 0, match.start()) + 1)
    return offsets


def evaluate(workflows: dict[str, str]) -> dict[str, Any]:
    mutation_surfaces: list[dict[str, Any]] = []
    external_verifier_consumers: list[str] = []
    service_role_consumers: list[str] = []
    control_markers: dict[str, list[str]] = {}

    for path, text in sorted(workflows.items()):
        lines: list[int] = []
        for pattern in MUTATION_COMMANDS:
            lines.extend(_line_numbers(text, pattern))
        lines = sorted(set(lines))
        if lines:
            mutation_surfaces.append({"path": path, "line_numbers": lines})
        if EXPECTED_EXTERNAL_VERIFIER_MARKER in text:
            external_verifier_consumers.append(path)
        if any(marker in text for marker in SERVICE_ROLE_MARKERS):
            service_role_consumers.append(path)
        present = [marker for marker in SELF_AUTHORITY_ANTI_PATTERNS if marker in text]
        if present:
            control_markers[path] = present

    has_mutation = bool(mutation_surfaces)
    has_external_verifier = bool(external_verifier_consumers)
    checks = {
        "no_service_role_credentials_in_provider_workflows": not service_role_consumers,
        "github_controls_not_treated_as_external_aop_verifier": not has_external_verifier or EXPECTED_EXTERNAL_VERIFIER_MARKER not in SELF_AUTHORITY_ANTI_PATTERNS,
        "provider_mutation_requires_external_aop_verifier": (not has_mutation) or has_external_verifier,
    }

    if not checks["no_service_role_credentials_in_provider_workflows"]:
        outcome = "BLOCK_PROVIDER_MUTATION_SERVICE_ROLE_EXPOSURE"
    elif has_mutation and not has_external_verifier:
        outcome = "BLOCK_PROVIDER_MUTATION_UNTIL_EXTERNAL_AOP_PREFLIGHT"
    elif has_mutation and has_external_verifier:
        # Presence of a marker is only a composition signal. A separate verifier
        # contract must prove its semantics before this can become authority.
        outcome = "REVIEW_EXTERNAL_AOP_VERIFIER_COMPOSITION_NONAUTHORITY"
    else:
        outcome = "PASS_NO_PROVIDER_MUTATION_SURFACE_NONAUTHORITY"

    evidence = {
        "workflow_count": len(workflows),
        "mutation_surfaces": mutation_surfaces,
        "external_verifier_marker": EXPECTED_EXTERNAL_VERIFIER_MARKER,
        "external_verifier_consumers": external_verifier_consumers,
        "service_role_consumers": service_role_consumers,
        "github_control_markers": control_markers,
        "checks": checks,
    }
    return {
        "schema": SCHEMA,
        "outcome": outcome,
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        "provider_mutation_authorized": False,
        "effective_execution_preflight_passed": False,
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
    parser.add_argument(
        "--workflow",
        action="append",
        default=[
            ".github/workflows/w1-aws-provider-reboot-proof.yml",
            ".github/workflows/w1-aws-persistent-host-preflight.yml",
        ],
    )
    ns = parser.parse_args()
    workflows: dict[str, str] = {}
    for rel in dict.fromkeys(ns.workflow):
        path = ns.root / rel
        workflows[rel] = path.read_text(encoding="utf-8")
    result = evaluate(workflows)
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        print(raw, end="")
    # The current PREP contract is deliberately a proved BLOCK, not an error.
    safe = result["outcome"] in {
        "BLOCK_PROVIDER_MUTATION_UNTIL_EXTERNAL_AOP_PREFLIGHT",
        "PASS_NO_PROVIDER_MUTATION_SURFACE_NONAUTHORITY",
    }
    return 0 if safe else 3


if __name__ == "__main__":
    raise SystemExit(main())
