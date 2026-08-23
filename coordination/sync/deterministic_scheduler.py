#!/usr/bin/env python3
"""Deterministic PREPARE_ONLY scheduler for H205F22 synchronous development.

The scheduler groups non-conflicting tasks into parallel waves, assigns GPT/GLM
Builder/Adversary roles reproducibly, and derives risk-based provider quorum.
It performs no external writes and grants no project authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TASK_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
TASK_KINDS = {"DOCS", "TEST", "IMPLEMENTATION", "SCHEMA", "SECURITY", "AUTHORITY"}
MIN_RISK_BY_KIND = {
    "DOCS": 0,
    "TEST": 1,
    "IMPLEMENTATION": 2,
    "SCHEMA": 3,
    "SECURITY": 3,
    "AUTHORITY": 4,
}
AGENTS = ("chatgpt", "glm")
KNOWN_DOMAINS = {
    "worker", "enrollment", "execution_safety", "scheduler",
    "federation", "provider", "signature",
    "continuity", "checkpoint", "durability",
    "toolchain", "workspace", "coding",
    "coordination", "review", "learning", "evidence",
    "roadmap",
}
GLOBAL_WRITE_DOMAINS = {"roadmap"}
TASK_KEYS = {
    "schema", "task_id", "sync_epoch_sha256", "risk_level", "task_kind",
    "read_domains", "write_domains", "authority_effect", "canonical",
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _sha(value: Any, label: str) -> str:
    value = str(value or "").lower()
    if not SHA256_RE.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def validate_task(task: dict[str, Any], expected_epoch: str) -> None:
    if set(task) != TASK_KEYS:
        raise ValueError(f"scheduler task keys mismatch: {sorted(set(task) ^ TASK_KEYS)}")
    if task["schema"] != "metaengine.compute.sync-scheduler-task.h205f22.v1":
        raise ValueError("unsupported scheduler task schema")
    if task["authority_effect"] is not False or task["canonical"] is not False:
        raise ValueError("scheduler task must be non-authority")
    if not TASK_ID_RE.fullmatch(str(task["task_id"])):
        raise ValueError("invalid task_id")
    if _sha(task["sync_epoch_sha256"], "sync_epoch_sha256") != expected_epoch:
        raise ValueError("mixed or stale sync epoch")
    if not isinstance(task["risk_level"], int) or task["risk_level"] not in range(5):
        raise ValueError("risk_level must be an integer in [0,4]")
    kind = task["task_kind"]
    if kind not in TASK_KINDS:
        raise ValueError("unsupported task_kind")
    for key in ("read_domains", "write_domains"):
        domains = task[key]
        if not isinstance(domains, list) or len(domains) != len(set(domains)):
            raise ValueError(f"{key} must be a unique list")
        unknown = sorted(set(domains) - KNOWN_DOMAINS)
        if unknown:
            raise ValueError(f"unknown mutation domains: {unknown}")
    if set(task["read_domains"]) & set(task["write_domains"]):
        raise ValueError("a domain cannot be both read and write in one task")

    risk = task["risk_level"]
    minimum = MIN_RISK_BY_KIND[kind]
    if risk < minimum:
        raise ValueError(f"risk downgrade: {kind} requires risk >= {minimum}")
    if task["write_domains"] and risk < 2:
        raise ValueError("risk downgrade: domain writes require risk >= 2")
    if "roadmap" in task["write_domains"] and not (kind == "AUTHORITY" and risk == 4):
        raise ValueError("roadmap writes require AUTHORITY/risk 4")
    if kind == "AUTHORITY" and risk != 4:
        raise ValueError("AUTHORITY tasks must be risk 4")
    if risk == 4 and kind != "AUTHORITY":
        raise ValueError("risk 4 is reserved for AUTHORITY tasks")


def conflict(a: dict[str, Any], b: dict[str, Any]) -> bool:
    a_r, a_w = set(a["read_domains"]), set(a["write_domains"])
    b_r, b_w = set(b["read_domains"]), set(b["write_domains"])
    if (a_w | b_w) & GLOBAL_WRITE_DOMAINS:
        return bool(a_w or b_w or a_r or b_r)
    return bool((a_w & (b_r | b_w)) or (b_w & (a_r | a_w)))


def role_assignment(task_id: str, epoch_generation: int) -> dict[str, str]:
    if not isinstance(epoch_generation, int) or epoch_generation < 1:
        raise ValueError("epoch_generation must be a positive integer")
    base = int(hashlib.sha256(task_id.encode("utf-8")).hexdigest()[:8], 16) & 1
    builder_index = base ^ (epoch_generation & 1)
    builder = AGENTS[builder_index]
    adversary = AGENTS[1 - builder_index]
    return {"builder": builder, "adversary": adversary}


def witness_policy(task: dict[str, Any], epoch_sha: str) -> dict[str, Any]:
    risk = task["risk_level"]
    mandatory = risk >= 2
    audit_bucket = int(hashlib.sha256(f"{epoch_sha}:{task['task_id']}".encode()).hexdigest()[:8], 16) % 10
    audit = (risk < 2 and audit_bucket == 0)
    appveyor = mandatory or audit
    providers = ["github-actions"] + (["appveyor"] if appveyor else [])
    reason = "MANDATORY_RISK" if mandatory else ("DETERMINISTIC_AUDIT_10PCT" if audit else "NONE")
    return {
        "providers": providers,
        "appveyor_required": appveyor,
        "appveyor_reason": reason,
        "peer_review_required": risk >= 1,
        "supervisor_review_required": risk == 4,
    }


def build_schedule(tasks: list[dict[str, Any]], *, sync_epoch_sha256: str,
                   epoch_generation: int) -> dict[str, Any]:
    epoch_sha = _sha(sync_epoch_sha256, "sync_epoch_sha256")
    if not isinstance(epoch_generation, int) or epoch_generation < 1:
        raise ValueError("epoch_generation must be a positive integer")
    if not isinstance(tasks, list) or not tasks:
        raise ValueError("tasks must be a non-empty list")
    seen: set[str] = set()
    for task in tasks:
        if not isinstance(task, dict):
            raise ValueError("each scheduler task must be an object")
        validate_task(task, epoch_sha)
        task_id = str(task["task_id"])
        if task_id in seen:
            raise ValueError("duplicate task_id")
        seen.add(task_id)

    ordered = sorted(tasks, key=lambda t: str(t["task_id"]))
    waves: list[list[dict[str, Any]]] = []
    for task in ordered:
        placed = False
        for wave in waves:
            if all(not conflict(task, existing) for existing in wave):
                wave.append(task)
                placed = True
                break
        if not placed:
            waves.append([task])

    scheduled_waves: list[dict[str, Any]] = []
    for wave_index, wave in enumerate(waves):
        assignments = []
        for task in sorted(wave, key=lambda t: str(t["task_id"])):
            roles = role_assignment(str(task["task_id"]), epoch_generation)
            quorum = witness_policy(task, epoch_sha)
            assignments.append({
                "task_id": task["task_id"],
                "task_kind": task["task_kind"],
                "risk_level": task["risk_level"],
                "read_domains": task["read_domains"],
                "write_domains": task["write_domains"],
                **roles,
                **quorum,
            })
        scheduled_waves.append({"wave": wave_index, "assignments": assignments})

    neutral = {
        "sync_epoch_sha256": epoch_sha,
        "epoch_generation": epoch_generation,
        "waves": scheduled_waves,
    }
    return {
        "schema": "metaengine.compute.sync-schedule.h205f22.v1",
        **neutral,
        "schedule_sha256": sha256_json(neutral),
        "authority": {
            "authority_effect": False,
            "canonical": False,
            "project_claim_authority": False,
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--tasks", required=True)
    p.add_argument("--sync-epoch-sha256", required=True)
    p.add_argument("--epoch-generation", required=True, type=int)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    tasks = json.loads(Path(args.tasks).read_text(encoding="utf-8"))
    schedule = build_schedule(tasks, sync_epoch_sha256=args.sync_epoch_sha256,
                              epoch_generation=args.epoch_generation)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(schedule, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "schedule_sha256": schedule["schedule_sha256"],
        "wave_count": len(schedule["waves"]),
        "authority_effect": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
