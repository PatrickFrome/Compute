#!/usr/bin/env python3
"""Transactional coordination primitives for H205F22 synchronous development.

PREPARE_ONLY library:
- monotonic epoch-generation checks,
- fencing-token checks,
- exactly-once effect through deterministic idempotency keys,
- append-only hash-chained task events.

This module never grants project authority and performs no external mutations.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
OPERATIONS = {
    "APPEND_TASK_EVENT",
    "PUBLISH_REVIEW_RECEIPT",
    "PUBLISH_EVIDENCE_RECEIPT",
}
EVENT_TYPES = {
    "TASK_CREATED",
    "EXECUTION_VERIFIED",
    "PEER_REVIEW_PENDING",
    "FIX_REQUIRED",
    "FIX_APPLIED",
    "PEER_REVIEW_COMPLETE",
    "EVIDENCE_READY",
}
TRANSITIONS = {
    None: {"TASK_CREATED"},
    "TASK_CREATED": {"EXECUTION_VERIFIED"},
    "EXECUTION_VERIFIED": {"PEER_REVIEW_PENDING"},
    "PEER_REVIEW_PENDING": {"FIX_REQUIRED", "PEER_REVIEW_COMPLETE"},
    "FIX_REQUIRED": {"FIX_APPLIED"},
    "FIX_APPLIED": {"EXECUTION_VERIFIED"},
    "PEER_REVIEW_COMPLETE": {"EVIDENCE_READY"},
    "EVIDENCE_READY": set(),
}
WRITE_INTENT_KEYS = {
    "schema", "task_id", "operation", "mutation_domain",
    "sync_epoch_sha256", "epoch_generation", "fencing_token",
    "execution_subject_sha256", "idempotency_key",
    "authority_effect", "canonical",
}
EVENT_KEYS = {
    "schema", "event_id", "task_id", "event_type", "sequence",
    "sync_epoch_sha256", "epoch_generation", "execution_subject_sha256",
    "previous_event_sha256", "payload_sha256", "authority_effect",
    "canonical", "event_sha256",
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


def derive_idempotency_key(*, task_id: str, operation: str, mutation_domain: str,
                           sync_epoch_sha256: str, epoch_generation: int,
                           fencing_token: int, execution_subject_sha256: str) -> str:
    if operation not in OPERATIONS:
        raise ValueError("unsupported operation")
    if not task_id or not mutation_domain:
        raise ValueError("task_id and mutation_domain are required")
    if not isinstance(epoch_generation, int) or epoch_generation < 1:
        raise ValueError("epoch_generation must be a positive integer")
    if not isinstance(fencing_token, int) or fencing_token < 1:
        raise ValueError("fencing_token must be a positive integer")
    neutral = {
        "task_id": task_id,
        "operation": operation,
        "mutation_domain": mutation_domain,
        "sync_epoch_sha256": _sha(sync_epoch_sha256, "sync_epoch_sha256"),
        "epoch_generation": epoch_generation,
        "fencing_token": fencing_token,
        "execution_subject_sha256": _sha(execution_subject_sha256, "execution_subject_sha256"),
    }
    return sha256_json(neutral)


def validate_write_intent(intent: dict[str, Any], *, current_sync_epoch_sha256: str,
                          current_epoch_generation: int,
                          current_fencing_tokens: dict[str, int],
                          applied_idempotency_keys: Iterable[str] = ()) -> dict[str, Any]:
    if set(intent) != WRITE_INTENT_KEYS:
        raise ValueError(f"write intent keys mismatch: {sorted(set(intent) ^ WRITE_INTENT_KEYS)}")
    if intent["schema"] != "metaengine.compute.sync-write-intent.h205f22.v1":
        raise ValueError("unsupported write-intent schema")
    if intent["authority_effect"] is not False or intent["canonical"] is not False:
        raise ValueError("PREPARE_ONLY write intent must be non-authority")
    if intent["operation"] not in OPERATIONS:
        raise ValueError("unsupported operation")
    domain = str(intent["mutation_domain"])
    if domain not in current_fencing_tokens:
        raise ValueError("unknown mutation domain")
    incoming_epoch_sha = _sha(intent["sync_epoch_sha256"], "sync_epoch_sha256")
    current_epoch_sha = _sha(current_sync_epoch_sha256, "current_sync_epoch_sha256")
    incoming_subject = _sha(intent["execution_subject_sha256"], "execution_subject_sha256")
    incoming_key = _sha(intent["idempotency_key"], "idempotency_key")
    generation = intent["epoch_generation"]
    fence = intent["fencing_token"]
    if not isinstance(generation, int) or generation < 1:
        raise ValueError("epoch_generation must be a positive integer")
    if not isinstance(current_epoch_generation, int) or current_epoch_generation < 1:
        raise ValueError("current_epoch_generation must be a positive integer")
    if not isinstance(fence, int) or fence < 1:
        raise ValueError("fencing_token must be a positive integer")
    current_fence = current_fencing_tokens[domain]
    if not isinstance(current_fence, int) or current_fence < 1:
        raise ValueError("current fencing token must be a positive integer")

    expected_key = derive_idempotency_key(
        task_id=str(intent["task_id"]), operation=str(intent["operation"]),
        mutation_domain=domain, sync_epoch_sha256=incoming_epoch_sha,
        epoch_generation=generation, fencing_token=fence,
        execution_subject_sha256=incoming_subject,
    )
    if incoming_key != expected_key:
        raise ValueError("idempotency_key mismatch")

    if incoming_key in set(applied_idempotency_keys):
        return {"decision": "IDEMPOTENT_REPLAY", "apply": False,
                "idempotency_key": incoming_key, "authority_effect": False}

    if generation < current_epoch_generation:
        raise ValueError("STALE_EPOCH_GENERATION")
    if generation > current_epoch_generation:
        raise ValueError("FUTURE_EPOCH_GENERATION")
    if incoming_epoch_sha != current_epoch_sha:
        raise ValueError("SYNC_EPOCH_HASH_MISMATCH")
    if fence < current_fence:
        raise ValueError("STALE_FENCING_TOKEN")
    if fence > current_fence:
        raise ValueError("FUTURE_FENCING_TOKEN")

    return {"decision": "APPLY_ONCE", "apply": True,
            "idempotency_key": incoming_key, "authority_effect": False}


def _event_neutral(event: dict[str, Any]) -> dict[str, Any]:
    return {key: event[key] for key in sorted(EVENT_KEYS - {"event_sha256"})}


def build_event(*, event_id: str, task_id: str, event_type: str, sequence: int,
                sync_epoch_sha256: str, epoch_generation: int,
                execution_subject_sha256: str | None,
                previous_event_sha256: str | None, payload_sha256: str) -> dict[str, Any]:
    if event_type not in EVENT_TYPES:
        raise ValueError("unsupported event_type")
    if not event_id or not task_id:
        raise ValueError("event_id and task_id are required")
    if not isinstance(sequence, int) or sequence < 1:
        raise ValueError("sequence must be a positive integer")
    if not isinstance(epoch_generation, int) or epoch_generation < 1:
        raise ValueError("epoch_generation must be a positive integer")
    if previous_event_sha256 is not None:
        previous_event_sha256 = _sha(previous_event_sha256, "previous_event_sha256")
    if execution_subject_sha256 is not None:
        execution_subject_sha256 = _sha(execution_subject_sha256, "execution_subject_sha256")
    event = {
        "schema": "metaengine.compute.sync-task-event.h205f22.v1",
        "event_id": event_id,
        "task_id": task_id,
        "event_type": event_type,
        "sequence": sequence,
        "sync_epoch_sha256": _sha(sync_epoch_sha256, "sync_epoch_sha256"),
        "epoch_generation": epoch_generation,
        "execution_subject_sha256": execution_subject_sha256,
        "previous_event_sha256": previous_event_sha256,
        "payload_sha256": _sha(payload_sha256, "payload_sha256"),
        "authority_effect": False,
        "canonical": False,
    }
    event["event_sha256"] = sha256_json(event)
    return event


def validate_event_chain(events: list[dict[str, Any]]) -> dict[str, Any]:
    if not events:
        return {"last_event_type": None, "last_event_sha256": None,
                "event_count": 0, "active_execution_subject_sha256": None,
                "authority_effect": False}

    seen_event_ids: set[str] = set()
    previous: dict[str, Any] | None = None
    task_id: str | None = None
    epoch_generation: int | None = None
    sync_epoch_sha256: str | None = None
    active_subject_sha256: str | None = None

    for index, event in enumerate(events, start=1):
        if set(event) != EVENT_KEYS:
            raise ValueError(f"event keys mismatch at sequence {index}")
        if event["schema"] != "metaengine.compute.sync-task-event.h205f22.v1":
            raise ValueError("unsupported event schema")
        if event["authority_effect"] is not False or event["canonical"] is not False:
            raise ValueError("task event must be non-authority")
        if event["event_type"] not in EVENT_TYPES:
            raise ValueError("unsupported event_type")
        if event["sequence"] != index:
            raise ValueError("event sequence gap or reorder")
        if not event["event_id"] or event["event_id"] in seen_event_ids:
            raise ValueError("event_id must be non-empty and unique")
        seen_event_ids.add(event["event_id"])
        _sha(event["sync_epoch_sha256"], "sync_epoch_sha256")
        _sha(event["payload_sha256"], "payload_sha256")
        if event["execution_subject_sha256"] is not None:
            _sha(event["execution_subject_sha256"], "execution_subject_sha256")

        expected_prev = None if previous is None else previous["event_sha256"]
        if event["previous_event_sha256"] != expected_prev:
            raise ValueError("previous_event_sha256 mismatch")
        if sha256_json(_event_neutral(event)) != event["event_sha256"]:
            raise ValueError("event_sha256 mismatch")

        previous_type = None if previous is None else previous["event_type"]
        if event["event_type"] not in TRANSITIONS[previous_type]:
            raise ValueError(f"invalid event transition: {previous_type} -> {event['event_type']}")

        event_subject = event["execution_subject_sha256"]
        if event["event_type"] == "TASK_CREATED":
            if event_subject is not None:
                raise ValueError("TASK_CREATED must not bind an execution subject")
        elif event["event_type"] == "EXECUTION_VERIFIED":
            if event_subject is None:
                raise ValueError("EXECUTION_VERIFIED requires an execution subject")
            active_subject_sha256 = event_subject
        else:
            if active_subject_sha256 is None:
                raise ValueError("active execution subject missing")
            if event_subject != active_subject_sha256:
                raise ValueError("execution subject changed without new EXECUTION_VERIFIED")

        if task_id is None:
            task_id = str(event["task_id"])
            epoch_generation = event["epoch_generation"]
            sync_epoch_sha256 = event["sync_epoch_sha256"]
        else:
            if event["task_id"] != task_id:
                raise ValueError("task_id changed inside event chain")
            if event["epoch_generation"] != epoch_generation:
                raise ValueError("epoch_generation changed inside event chain")
            if event["sync_epoch_sha256"] != sync_epoch_sha256:
                raise ValueError("sync_epoch_sha256 changed inside event chain")
        previous = event

    return {"last_event_type": previous["event_type"],
            "last_event_sha256": previous["event_sha256"],
            "event_count": len(events),
            "active_execution_subject_sha256": active_subject_sha256,
            "authority_effect": False}
