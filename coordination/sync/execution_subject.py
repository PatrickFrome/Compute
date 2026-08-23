#!/usr/bin/env python3
"""Build an exact composite execution subject for H205F22 peer review.

The subject is created only from a task result, GitHub execution evidence, and
an independently persisted-read-back cross-provider receipt. Reviews bind to
this digest so they cannot be replayed across source/tree/contract changes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

HEX = set("0123456789abcdef")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def _hex(value: Any, length: int, label: str) -> str:
    value = str(value or "").lower()
    if len(value) != length or any(c not in HEX for c in value):
        raise ValueError(f"invalid {label}")
    return value


def _non_authority(authority: Any, keys: tuple[str, ...], label: str) -> None:
    if not isinstance(authority, dict):
        raise ValueError(f"{label}: authority missing")
    if any(authority.get(k) is not False for k in keys):
        raise ValueError(f"{label}: authority overclaim")


def build_subject(task_result: dict[str, Any], github: dict[str, Any], cross: dict[str, Any]) -> dict[str, Any]:
    if task_result.get("schema") != "metaengine.compute.sync-task-result.h205f22.v1":
        raise ValueError("unsupported task-result schema")
    if github.get("schema") != "metaengine.compute.a1.zero-spend-execution-evidence.h205f22.v1":
        raise ValueError("unsupported GitHub evidence schema")
    if cross.get("schema") != "metaengine.compute.a1.cross-provider-readback.h205f22.v1":
        raise ValueError("unsupported cross-provider receipt schema")
    _non_authority(task_result.get("authority"), ("authority_effect", "canonical", "execution_authority", "project_claim_authority"), "task-result")
    _non_authority(github.get("authority"), ("authority_effect", "canonical", "execution_authority", "persistent_worker_proof", "w1_verified"), "github")
    _non_authority(cross.get("authority"), ("authority_effect", "canonical", "execution_authority", "persistent_worker_proof", "w1_verified"), "cross-provider")

    if github.get("provider", {}).get("kind") != "github-actions":
        raise ValueError("GitHub provider.kind mismatch")
    if cross.get("evidence_class") != "CROSS_PROVIDER_REPRODUCED_VERIFIED":
        raise ValueError("cross-provider receipt is not VERIFIED")
    if cross.get("identity_source") != "PERSISTED_APPVEYOR_ARTIFACT_BYTES":
        raise ValueError("cross-provider identity source is not persisted artifact bytes")
    if cross.get("providers") != ["github-actions", "appveyor"]:
        raise ValueError("cross-provider provider set mismatch")

    sync = github.get("sync_task") or {}
    for key in ("task_id", "task_result_sha256", "task_sha256", "sync_epoch_sha256"):
        if str(sync.get(key) or "") != str(task_result.get(key) or ""):
            raise ValueError(f"task binding mismatch: {key}")

    gh_source = github.get("source") or {}
    gh_contract = github.get("contract") or {}
    roots = cross.get("roots") or {}
    comparable = {
        "git_sha": _hex(gh_source.get("git_sha"), 40, "github git_sha"),
        "tree_sha": _hex(gh_source.get("tree_sha"), 40, "github tree_sha"),
        "execution_contract_sha256": _hex(gh_contract.get("sha256"), 64, "github contract sha256"),
        "provider_neutral_result_sha256": _hex(gh_contract.get("provider_neutral_result_sha256"), 64, "github result sha256"),
    }
    expected = {
        "git_sha": _hex(roots.get("git_sha"), 40, "cross git_sha"),
        "tree_sha": _hex(roots.get("tree_sha"), 40, "cross tree_sha"),
        "execution_contract_sha256": _hex(roots.get("contract_sha256"), 64, "cross contract sha256"),
        "provider_neutral_result_sha256": _hex(roots.get("provider_neutral_result_sha256"), 64, "cross result sha256"),
    }
    if comparable != expected:
        raise ValueError("GitHub/cross-provider root mismatch")

    neutral = {
        "task_id": str(task_result["task_id"]),
        "task_result_sha256": _hex(task_result.get("task_result_sha256"), 64, "task_result_sha256"),
        "task_sha256": _hex(task_result.get("task_sha256"), 64, "task_sha256"),
        "sync_epoch_sha256": _hex(task_result.get("sync_epoch_sha256"), 64, "sync_epoch_sha256"),
        **comparable,
        "cross_provider_evidence_class": "CROSS_PROVIDER_REPRODUCED_VERIFIED",
        "identity_source": "PERSISTED_APPVEYOR_ARTIFACT_BYTES",
    }
    return {
        "schema": "metaengine.compute.sync-execution-subject.h205f22.v1",
        **neutral,
        "execution_subject_sha256": canonical_hash(neutral),
        "authority": {
            "authority_effect": False,
            "canonical": False,
            "execution_authority": False,
            "project_claim_authority": False,
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--task-result", required=True)
    p.add_argument("--github-evidence", required=True)
    p.add_argument("--cross-provider-readback", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    task_result = json.loads(Path(args.task_result).read_text())
    github = json.loads(Path(args.github_evidence).read_text())
    cross = json.loads(Path(args.cross_provider_readback).read_text())
    subject = build_subject(task_result, github, cross)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(subject, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"task_id": subject["task_id"], "execution_subject_sha256": subject["execution_subject_sha256"], "authority_effect": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
