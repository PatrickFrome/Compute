#!/usr/bin/env python3
"""Non-authority amplifier strategy learner.

Consumes JSONL experiment records and ranks only candidates that have passed
correctness, security, zero-cost, and ACCEPT gates. Any ROLLBACK for the same
candidate/context invalidates that candidate. Output is a strategy hint only;
it never changes roadmap, claims, directives, or milestone state.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable

REQUIRED = {
    "amplifier_id",
    "candidate_version",
    "task_class",
    "context_fingerprint",
    "baseline_metrics",
    "candidate_metrics",
    "correctness_pass",
    "security_pass",
    "zero_cost_pass",
    "sample_count",
    "verdict",
}
VALID_VERDICTS = {"ACCEPT", "KEEP_SHADOW", "ROLLBACK"}


def candidate_key(record: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(record["task_class"]),
        str(record["context_fingerprint"]),
        str(record["amplifier_id"]),
        str(record["candidate_version"]),
    )


def _positive_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def speedup_ratio(record: dict[str, Any]) -> float:
    explicit = _positive_number(record.get("speedup_ratio"))
    if explicit is not None:
        return explicit
    baseline = _positive_number(record.get("baseline_metrics", {}).get("median_wall_clock"))
    candidate = _positive_number(record.get("candidate_metrics", {}).get("median_wall_clock"))
    if baseline is None or candidate is None:
        return 1.0
    return baseline / candidate


def validate_record(record: Any) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise ValueError("experiment record must be an object")
    missing = sorted(REQUIRED - record.keys())
    if missing:
        raise ValueError(f"missing required fields: {','.join(missing)}")
    if record["verdict"] not in VALID_VERDICTS:
        raise ValueError("invalid verdict")
    if not isinstance(record["sample_count"], int) or isinstance(record["sample_count"], bool) or record["sample_count"] < 1:
        raise ValueError("sample_count must be a positive integer")
    for field in ("correctness_pass", "security_pass", "zero_cost_pass"):
        if not isinstance(record[field], bool):
            raise ValueError(f"{field} must be boolean")
    if not all(str(record[field]).strip() for field in ("amplifier_id", "candidate_version", "task_class", "context_fingerprint")):
        raise ValueError("identity fields must be non-empty")
    return record


def load_jsonl(paths: Iterable[Path]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in paths:
        for lineno, raw in enumerate(path.read_text().splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            try:
                records.append(validate_record(json.loads(line)))
            except Exception as exc:
                raise ValueError(f"{path}:{lineno}: {exc}") from exc
    return records


def record_score(record: dict[str, Any]) -> float:
    ratio = speedup_ratio(record)
    reliability = float(record.get("reliability_delta", 0.0) or 0.0)
    reliability = max(-1.0, min(1.0, reliability))
    sample_confidence = min(int(record["sample_count"]), 20) / 20.0
    # Log speedup keeps large ratios from dominating forever; reliability and
    # evidence depth remain material parts of the decision.
    return 0.65 * math.log(ratio) + 0.25 * reliability + 0.10 * sample_confidence


def recommend(records: list[dict[str, Any]], task_class: str, context_fingerprint: str) -> dict[str, Any]:
    matching = [
        r for r in records
        if r["task_class"] == task_class and r["context_fingerprint"] == context_fingerprint
    ]
    rolled_back = {candidate_key(r) for r in matching if r["verdict"] == "ROLLBACK"}
    accepted = []
    for record in matching:
        if record["verdict"] != "ACCEPT":
            continue
        if candidate_key(record) in rolled_back:
            continue
        if not (record["correctness_pass"] and record["security_pass"] and record["zero_cost_pass"]):
            continue
        accepted.append(record)

    ranked = sorted(
        accepted,
        key=lambda r: (record_score(r), speedup_ratio(r), r["sample_count"], r["amplifier_id"]),
        reverse=True,
    )

    def compact(record: dict[str, Any]) -> dict[str, Any]:
        return {
            "amplifier_id": record["amplifier_id"],
            "candidate_version": record["candidate_version"],
            "speedup_ratio": speedup_ratio(record),
            "reliability_delta": float(record.get("reliability_delta", 0.0) or 0.0),
            "sample_count": record["sample_count"],
            "score": record_score(record),
            "evidence_refs": record.get("evidence_refs", []),
        }

    return {
        "schema": "metaengine.amplifier.strategy-hint.v1",
        "authority_effect": False,
        "strategy_hint_only": True,
        "task_class": task_class,
        "context_fingerprint": context_fingerprint,
        "selected": compact(ranked[0]) if ranked else None,
        "alternates": [compact(r) for r in ranked[1:4]],
        "accepted_record_count": len(ranked),
        "rollback_blocked_candidate_count": len(rolled_back),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("records", nargs="+", type=Path)
    parser.add_argument("--task-class", required=True)
    parser.add_argument("--context-fingerprint", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = recommend(load_jsonl(args.records), args.task_class, args.context_fingerprint)
    rendered = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
