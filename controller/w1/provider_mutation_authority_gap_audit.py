#!/usr/bin/env python3
"""Whole-W1 provider mutation authority-gap audit.

PREP-only and NON-AUTHORITY. The auditor scans every W1 workflow plus W1 Python
controller source for provider lifecycle mutation entrypoints. A real workflow
mutation is acceptable only when the exact mutation is structurally downstream
of the externally issued fresh W1 authority receipt and local fail-closed guard.
Direct code-level provider mutators remain a BLOCK until an equivalent external
receipt binding is implemented.

The audit never authorizes a provider action and never interprets manual
confirmation, protected environments, OIDC permission, or local environment
flags as W1 authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

SCHEMA = "metaengine.compute.w1-provider-mutation-authority-gap-audit.h205f22.v2"
BROKER_SLUG = "metaengine-w1-authority-broker-h205f22"
GUARD_PATH = "controller/w1/provider_dispatch_authority_guard.py"
ACQUIRE_STEP = "Acquire fresh external W1 authority receipt"

WORKFLOW_MUTATIONS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("AWS_EC2_REBOOT", re.compile(r"\baws\s+ec2\s+reboot-instances\b(?![^\n]*--dry-run)", re.I)),
    ("AWS_EC2_LIFECYCLE", re.compile(r"\baws\s+ec2\s+(?:start|stop|terminate)-instances\b(?![^\n]*--dry-run)", re.I)),
    ("AWS_EC2_CREATE", re.compile(r"\baws\s+ec2\s+run-instances\b(?![^\n]*--dry-run)", re.I)),
    ("GITHUB_CODESPACE_CLI", re.compile(r"\bgh\s+codespace\s+(?:stop|create|delete|rebuild|code|open)\b", re.I)),
    ("GITHUB_CODESPACE_API", re.compile(r"(?:curl\b[^\n]*\s-X\s*(?:POST|DELETE|PATCH|PUT)|\bgh\s+api\b[^\n]*(?:--method|-X)\s*(?:POST|DELETE|PATCH|PUT))[^\n]*codespaces", re.I)),
    ("VERCEL_SANDBOX_CLI", re.compile(r"\bvercel\b[^\n]*(?:sandbox|microvm)[^\n]*(?:create|start|stop|delete|destroy)\b", re.I)),
    ("VERCEL_SANDBOX_API", re.compile(r"(?:curl\b[^\n]*\s-X\s*(?:POST|DELETE|PATCH|PUT)|\bvercel\s+api\b)[^\n]*(?:sandbox|microvm)", re.I)),
)

SOURCE_MUTATIONS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("PY_CODESPACE_INTERNAL_POST", re.compile(r"_call\s*\(\s*method\s*=\s*['\"](?:POST|DELETE|PATCH|PUT)['\"]", re.I)),
    ("PY_CODESPACE_URLLIB_MUTATION", re.compile(r"urllib\.request\.Request\s*\([^)]*method\s*=\s*['\"](?:POST|DELETE|PATCH|PUT)['\"]", re.I | re.S)),
    ("PY_CODESPACE_REQUESTS_MUTATION", re.compile(r"requests\.(?:post|delete|patch|put)\s*\(", re.I)),
    ("PY_PROVIDER_SHELL_MUTATION", re.compile(r"(?:subprocess\.|os\.system\()[\s\S]{0,400}(?:aws\s+ec2\s+(?:reboot|start|stop|terminate|run)-instances|gh\s+codespace\s+(?:stop|create|delete|rebuild|code|open)|vercel[^\n]*(?:sandbox|microvm))", re.I)),
)

SERVICE_ROLE_MARKERS = ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "secrets.SUPABASE", "sb_secret_")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _strip_provider_reboot_policy_checker(text: str) -> str:
    """Remove the self-referential static checker, not executable provider steps."""
    marker = "      - name: Validate live W1 credential and trust-zone contract"
    next_job = "\n  preflight-environment:"
    if marker not in text or next_job not in text:
        return text
    before, remainder = text.split(marker, 1)
    _checker, after = remainder.split(next_job, 1)
    return before + next_job + after


def _workflow_gate(text: str, mutation_offset: int) -> tuple[bool, dict[str, Any]]:
    gate = text.find(ACQUIRE_STEP)
    broker = text.find(BROKER_SLUG, gate if gate >= 0 else 0)
    guard = text.find(GUARD_PATH, gate if gate >= 0 else 0)
    ordered = gate >= 0 and broker >= gate and guard >= broker and guard < mutation_offset
    return ordered, {
        "acquire_step_present": gate >= 0,
        "broker_call_present": broker >= 0,
        "guard_present": guard >= 0,
        "gate_before_mutation": ordered,
    }


def evaluate(workflows: dict[str, str], sources: dict[str, str]) -> dict[str, Any]:
    workflow_surfaces: list[dict[str, Any]] = []
    source_surfaces: list[dict[str, Any]] = []
    service_role_consumers: list[str] = []
    file_sha256: dict[str, str] = {}

    for path, text in sorted(workflows.items()):
        file_sha256[path] = _sha(text)
        runtime = _strip_provider_reboot_policy_checker(text)
        for kind, pattern in WORKFLOW_MUTATIONS:
            for match in pattern.finditer(runtime):
                gated, gate_checks = _workflow_gate(runtime, match.start())
                workflow_surfaces.append({
                    "path": path,
                    "kind": kind,
                    "line": _line(runtime, match.start()),
                    "authority_gate": "PROVEN_EXTERNAL_RECEIPT_GUARD" if gated else "GAP_UNGATED_MUTATION",
                    "gate_checks": gate_checks,
                })
        if any(item["path"] == path for item in workflow_surfaces):
            if any(marker in runtime for marker in SERVICE_ROLE_MARKERS):
                service_role_consumers.append(path)

    for path, text in sorted(sources.items()):
        file_sha256[path] = _sha(text)
        low = text.lower()
        provider_hint = any(token in low for token in ("codespace", "aws", "vercel", "sandbox", "microvm"))
        if not provider_hint:
            continue
        for kind, pattern in SOURCE_MUTATIONS:
            for match in pattern.finditer(text):
                source_surfaces.append({
                    "path": path,
                    "kind": kind,
                    "line": _line(text, match.start()),
                    "authority_gate": "GAP_DIRECT_CODE_MUTATOR",
                })

    ungated_workflow = [x for x in workflow_surfaces if x["authority_gate"] != "PROVEN_EXTERNAL_RECEIPT_GUARD"]
    checks = {
        "all_workflow_provider_mutations_externally_gated": not ungated_workflow,
        "no_direct_code_provider_mutators": not source_surfaces,
        "no_service_role_credentials_in_provider_mutation_workflows": not service_role_consumers,
        "whole_w1_workflow_scan_nonempty": bool(workflows),
        "whole_w1_controller_scan_nonempty": bool(sources),
    }
    passed = all(checks.values())
    evidence = {
        "workflow_count": len(workflows),
        "controller_source_count": len(sources),
        "scanned_file_count": len(file_sha256),
        "file_sha256": file_sha256,
        "workflow_mutation_surfaces": workflow_surfaces,
        "direct_code_mutation_surfaces": source_surfaces,
        "gated_workflow_mutation_count": len(workflow_surfaces) - len(ungated_workflow),
        "ungated_workflow_mutation_count": len(ungated_workflow),
        "direct_code_mutation_count": len(source_surfaces),
        "service_role_consumers": sorted(service_role_consumers),
        "checks": checks,
    }
    return {
        "schema": SCHEMA,
        "outcome": "PASS_ALL_PROVIDER_MUTATION_ENTRYPOINTS_EXTERNALLY_GATED_NONAUTHORITY" if passed else "BLOCK_PROVIDER_MUTATION_AUTHORITY_GAP",
        "audit_passed": passed,
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


def collect(root: Path) -> tuple[dict[str, str], dict[str, str]]:
    workflows = {
        str(path.relative_to(root)): path.read_text(encoding="utf-8")
        for path in sorted((root / ".github/workflows").glob("w1-*.yml"))
    }
    sources = {
        str(path.relative_to(root)): path.read_text(encoding="utf-8")
        for path in sorted((root / "controller/w1").glob("*.py"))
    }
    return workflows, sources


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args()
    workflows, sources = collect(ns.root)
    result = evaluate(workflows, sources)
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        print(raw, end="")
    return 0 if result["audit_passed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
