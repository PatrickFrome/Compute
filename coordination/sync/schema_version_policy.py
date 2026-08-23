#!/usr/bin/env python3
"""Schema/version policy for immutable H205F22 sync evidence.

Historical VERIFIED/EVIDENCE_READY receipts are interpreted by the validator
set that produced them. A newer validator may emit a new receipt, but it must
never silently reinterpret or overwrite an older completed barrier.

PREPARE_ONLY / non-authority policy metadata only.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

POLICY_SCHEMA = "metaengine.compute.sync-schema-version-policy.h205f22.v1"
VERSION_RE = re.compile(r"^(?P<family>.+)\.v(?P<major>[1-9][0-9]*)$")

HISTORICAL_BINDINGS: dict[str, dict[str, Any]] = {
    "SYNC-L4.7-002": {
        "execution_subject_sha256": "0bce991dc5db90a4d515d0ccae9bb696cc345a69d0df958e0db719a68112152b",
        "barrier_sha256": "f1b6532b6f80c3cbb721f286dbb61b1954d960a501c81e9b5b7a86723f1c4164",
        "outcome": "PEER_REVIEW_COMPLETE",
        "validated_source_git_sha": "f7067c353f319d01b88efa1d83aa691d9d6d5bd1",
        "validators": [
            {
                "path": "coordination/sync/peer_review_barrier.py",
                "git_blob_sha": "4f09a920fddb5b0f478467a8d2da9802263b2398",
            },
            {
                "path": "coordination/sync/pap_review_ingest.py",
                "git_blob_sha": "586b3ccc2b2cdba793dc1450c0933fcbac303307",
            },
            {
                "path": "coordination/sync/github_review_ingest.py",
                "git_blob_sha": "6caef0f3fcdb86df3074d214568d9e440eccdf82",
            },
        ],
    }
}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def git_blob_sha(data: bytes) -> str:
    """Return Git's SHA-1 object identity for exact file bytes."""
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data, usedforsecurity=False).hexdigest()


def policy_record() -> dict[str, Any]:
    neutral = {
        "schema": POLICY_SCHEMA,
        "policy_version": 1,
        "interpretation_policy": "NO_RETROACTIVE_REINTERPRETATION",
        "migration_policy": "NEW_INCOMPATIBLE_SCHEMA_REQUIRES_NEW_RECEIPT",
        "historical_completion_is_immutable": True,
        "historical_bindings": HISTORICAL_BINDINGS,
        "authority_effect": False,
        "canonical": False,
    }
    return {**neutral, "policy_sha256": canonical_hash(neutral)}


def parse_schema(schema: str) -> tuple[str, int]:
    match = VERSION_RE.fullmatch(str(schema))
    if not match:
        raise ValueError("schema must end in an explicit .vN major version")
    return match.group("family"), int(match.group("major"))


def migration_disposition(old_schema: str, new_schema: str) -> str:
    old_family, old_major = parse_schema(old_schema)
    new_family, new_major = parse_schema(new_schema)
    if old_family != new_family:
        raise ValueError("schema family changed")
    if new_major < old_major:
        raise ValueError("schema major rollback forbidden")
    if new_major == old_major:
        return "SAME_MAJOR__OLD_RECEIPT_REMAINS_BOUND_TO_ORIGINAL_VALIDATOR"
    return "NEW_MAJOR__NEW_RECEIPT_REQUIRED__OLD_RECEIPT_UNCHANGED"


def validate_historical_binding(task_id: str, *, execution_subject_sha256: str,
                                barrier_sha256: str, outcome: str) -> dict[str, Any]:
    binding = HISTORICAL_BINDINGS.get(task_id)
    if binding is None:
        raise ValueError("unknown historical task binding")
    if execution_subject_sha256 != binding["execution_subject_sha256"]:
        raise ValueError("historical execution subject mismatch")
    if barrier_sha256 != binding["barrier_sha256"]:
        raise ValueError("historical barrier hash mismatch")
    if outcome != binding["outcome"]:
        raise ValueError("historical barrier outcome mismatch")
    return binding


def verify_validator_files(task_id: str, repo_root: str | Path = ".") -> list[dict[str, str]]:
    """Fail closed unless local validator bytes equal the frozen Git blob IDs."""
    binding = HISTORICAL_BINDINGS.get(task_id)
    if binding is None:
        raise ValueError("unknown historical task binding")
    root = Path(repo_root)
    verified: list[dict[str, str]] = []
    for item in binding["validators"]:
        rel = str(item["path"])
        path = root / rel
        if not path.is_file():
            raise ValueError(f"historical validator missing: {rel}")
        observed = git_blob_sha(path.read_bytes())
        expected = str(item["git_blob_sha"])
        if observed != expected:
            raise ValueError(f"HISTORICAL_VALIDATOR_BLOB_MISMATCH: {rel}")
        verified.append({"path": rel, "git_blob_sha": observed})
    return verified


def main() -> int:
    print(json.dumps(policy_record(), sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
