#!/usr/bin/env python3
"""Typed PREPARE_ONLY task runner for H205F22 synchronous development.

The runner accepts only enumerated regression packs. It deliberately does not
accept shell commands from task envelopes. Task, sync-epoch and result hashes
are canonical JSON SHA-256 values so independent execution providers can
compare exactly the same work request and result.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

SHA256_RE = __import__('re').compile(r"^[0-9a-f]{64}$")
SHA40_RE = __import__('re').compile(r"^[0-9a-f]{40}$")

CHECKS: dict[str, list[list[str]]] = {
    "AUTHORITY_PLANE_GUARDS": [["node", "--test", "coordination/gpt-worker/test/guards.test.mjs"]],
    "A1_SANDBOX_GUARDS": [["python3", "-m", "unittest", "tests.a1.test_e2b_prepared_smoke", "-v"]],
    "CROSS_PROVIDER_GUARDS": [
        ["python3", "-m", "unittest", "tests.a1.test_cross_provider_verify", "-v"],
        ["python3", "-m", "unittest", "tests.a1.test_execution_subject", "-v"],
        ["python3", "-m", "unittest", "tests.a1.test_peer_review_barrier", "-v"],
        ["python3", "-m", "unittest", "tests.a1.test_transactional_coordination", "-v"],
    ],
}

ALLOWED_TOP_LEVEL = {
    "schema", "task_id", "mode", "task_kind", "read_only", "authority_effect",
    "canonical", "sync_epoch", "sync_epoch_sha256", "mutation_domains",
    "required_checks", "peer_review_required", "lesson_refs", "success_disposition",
}
ALLOWED_EPOCH = {
    "schema", "semantic_head", "payload_root_sha256", "roadmap_definition_sha256",
    "main_sha", "effective_live_claim_ids",
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def validate_task(task: dict[str, Any]) -> None:
    if set(task) != ALLOWED_TOP_LEVEL:
        raise ValueError(f"task keys mismatch: {sorted(set(task) ^ ALLOWED_TOP_LEVEL)}")
    if task["schema"] != "metaengine.compute.sync-task.h205f22.v1":
        raise ValueError("unsupported sync task schema")
    if task["mode"] != "PREPARE_ONLY" or task["task_kind"] != "REGRESSION_PACK":
        raise ValueError("only PREPARE_ONLY REGRESSION_PACK tasks are accepted")
    if task["read_only"] is not True or task["authority_effect"] is not False or task["canonical"] is not False:
        raise ValueError("sync task must be read-only and non-authority")
    if task["mutation_domains"] != []:
        raise ValueError("SYNC-L4.7 bootstrap task must not mutate project domains")
    if task["peer_review_required"] is not True:
        raise ValueError("peer review must be required")
    if task["success_disposition"] != "EVIDENCE_READY_NON_AUTHORITY":
        raise ValueError("unsupported success disposition")

    epoch = task["sync_epoch"]
    if not isinstance(epoch, dict) or set(epoch) != ALLOWED_EPOCH:
        raise ValueError("sync epoch keys mismatch")
    if epoch["schema"] != "metaengine.compute.sync-epoch.h205f22.v1":
        raise ValueError("unsupported sync epoch schema")
    if not isinstance(epoch["semantic_head"], str) or not epoch["semantic_head"]:
        raise ValueError("semantic head missing")
    for field in ("payload_root_sha256", "roadmap_definition_sha256"):
        if not SHA256_RE.fullmatch(str(epoch[field])):
            raise ValueError(f"invalid {field}")
    if not SHA40_RE.fullmatch(str(epoch["main_sha"])):
        raise ValueError("invalid main_sha")
    if not isinstance(epoch["effective_live_claim_ids"], list) or any(not isinstance(x, int) for x in epoch["effective_live_claim_ids"]):
        raise ValueError("effective_live_claim_ids must be integer list")
    if sha256_json(epoch) != task["sync_epoch_sha256"]:
        raise ValueError("sync_epoch_sha256 mismatch")

    checks = task["required_checks"]
    if not isinstance(checks, list) or not checks or len(checks) != len(set(checks)):
        raise ValueError("required_checks must be a non-empty unique list")
    unknown = [name for name in checks if name not in CHECKS]
    if unknown:
        raise ValueError(f"unknown typed checks: {unknown}")
    if not isinstance(task["lesson_refs"], list) or any(not isinstance(x, str) for x in task["lesson_refs"]):
        raise ValueError("lesson_refs must be strings")


def run_command(argv: list[str]) -> dict[str, Any]:
    p = subprocess.run(argv, text=True, capture_output=True, timeout=180, check=False)
    if p.returncode != 0:
        sys.stderr.write((p.stdout or "")[-3000:])
        sys.stderr.write((p.stderr or "")[-3000:])
        raise RuntimeError(f"typed check failed: {' '.join(argv)}")
    return {"command": argv, "passed": True, "returncode": 0}


def execute(task: dict[str, Any]) -> dict[str, Any]:
    validate_task(task)
    results: list[dict[str, Any]] = []
    for check_name in task["required_checks"]:
        commands = [run_command(argv) for argv in CHECKS[check_name]]
        results.append({"check": check_name, "passed": True, "commands": commands})

    neutral = {
        "task_id": task["task_id"],
        "task_sha256": sha256_json(task),
        "sync_epoch_sha256": task["sync_epoch_sha256"],
        "required_checks": task["required_checks"],
        "checks": [{"check": x["check"], "passed": x["passed"]} for x in results],
        "success_disposition": task["success_disposition"],
    }
    return {
        "schema": "metaengine.compute.sync-task-result.h205f22.v1",
        **neutral,
        "task_result_sha256": sha256_json(neutral),
        "checks": results,
        "authority": {"execution_authority": False, "canonical": False, "authority_effect": False, "project_claim_authority": False},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    task = json.loads(Path(args.task).read_text(encoding="utf-8"))
    if not isinstance(task, dict):
        raise ValueError("task envelope must be a JSON object")
    result = execute(task)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "task_id": result["task_id"], "sync_epoch_sha256": result["sync_epoch_sha256"], "task_result_sha256": result["task_result_sha256"], "authority_effect": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
