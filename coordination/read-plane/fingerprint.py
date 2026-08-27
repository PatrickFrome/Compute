#!/usr/bin/env python3
"""fingerprint.py v2.3 — H205F22 shared read-plane.

v2.3 keeps the v2.2 fail-safe plane separation and consumes the PostgreSQL
coordination_read_barrier_h205f22() RPC when it is installed.

Authority rules:
  PROJECT CLAIM LEASE != AOP RUN LEASE != PAP TRANSPORT LEASE.
  Claim liveness is barrier-derived from claim.state + claim.expires_at at DB time.
  Run liveness is barrier-derived from run.state + run.lease_expires_at and a
  RUN_FENCED event correlated strictly by run_id.
  Client wall clock is never used for an authority verdict when the barrier exists.

Modes:
  BARRIER mode  -> semantic + authority + frontier fingerprint; authority-safe read.
  FALLBACK mode -> v2.2 execution-only fingerprint; explicitly NOT authority-safe.

Usage:
  SB_KEY=<service-role/read credential> python3 fingerprint.py
  SB_KEY=<...> python3 fingerprint.py --verify <hex>
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

SB_URL = "https://xpeibufgzjknrhbhpffp.supabase.co"
SB_KEY = os.environ.get("SB_KEY", "")
BUCKET = "computefabric-parallel-glm"
CLOCK_SENSITIVITY_S = 60


def rpc(fn):
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/rpc/{fn}", data=b"{}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                 "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def get_object(key):
    url = f"{SB_URL}/storage/v1/object/authenticated/{BUCKET}/{key}"
    req = urllib.request.Request(url, headers={
        "apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def list_objects(prefix):
    req = urllib.request.Request(
        f"{SB_URL}/storage/v1/object/list/{BUCKET}",
        data=json.dumps({"prefix": prefix, "limit": 100, "offset": 0,
                         "sortBy": {"column": "name", "order": "asc"}}).encode(),
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                 "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def canon(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def sha(obj) -> str:
    return hashlib.sha256(canon(obj)).hexdigest()


def parse_ts(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def try_barrier():
    try:
        b = rpc("coordination_read_barrier_h205f22")
        if isinstance(b, dict) and not b.get("error") and b.get("claims") is not None:
            return b
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
        pass
    return None


def fallback_execution_view(aop, observed_at):
    """v2.2 fail-safe fallback: execution plane only, never project authority."""
    events = aop.get("recent_events", [])
    runs = aop.get("active_runs", [])
    stored_alignment = aop["canonical_alignment"]["active_claim_alignment"]

    fences_by_run = {}
    for e in sorted(events, key=lambda x: x.get("created_at", ""), reverse=True):
        if e.get("event_type") == "RUN_FENCED":
            rid = e.get("run_id")
            if rid and rid not in fences_by_run:
                fences_by_run[rid] = e.get("created_at")

    execution_runs = []
    for r in runs:
        rid = r.get("run_id")
        lease_exp = parse_ts(r.get("lease_expires_at"))
        fenced = rid in fences_by_run
        lease_live = bool(lease_exp and lease_exp > observed_at)
        boundary = bool(
            lease_exp
            and abs((lease_exp - observed_at).total_seconds()) <= CLOCK_SENSITIVITY_S
        )
        execution_runs.append({
            "run_id": rid,
            "milestone": r.get("milestone_key"),
            "state": r.get("state"),
            "fenced": fenced,
            "fence_ts": fences_by_run.get(rid),
            "lease_expires_at": r.get("lease_expires_at"),
            "lease_live_client_clock": lease_live,
            "clock_sensitive": boundary,
        })

    claim_authority = {
        "stored_alignment": stored_alignment,
        "claim_authority_verdict": "NOT_COMPUTABLE_FROM_THIS_SURFACE",
        "reason": "coordination_read_barrier_h205f22 unavailable; aop1_snapshot does not expose claim expiry",
    }
    execution_view = {
        "clock_source": "CLIENT_WALL_CLOCK_FALLBACK",
        "classification": "EXECUTION_PLANE_ONLY__NOT_CLAIM_AUTHORITY_SAFE",
        "runs": execution_runs,
        "newest_event": events[0].get("created_at") if events else None,
        "newest_event_type": events[0].get("event_type") if events else None,
    }
    return claim_authority, execution_view


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", default=None)
    args = ap.parse_args()
    if not SB_KEY:
        print("SB_KEY env required", file=sys.stderr)
        sys.exit(2)

    observed_at = datetime.now(timezone.utc)

    # Existing AOP snapshot remains useful for semantic/fallback information.
    aop = rpc("h205f22_aop1_snapshot_v1")
    barrier = try_barrier()

    if barrier is not None:
        mode = "BARRIER"
        authority_view = {
            "claims": barrier.get("claims", []),
            "execution_runs": barrier.get("execution_runs", []),
            "directives": barrier.get("directives", []),
            "roadmap_status": barrier.get("roadmap_status", {}),
            "definition_integrity": barrier.get("definition_integrity"),
            "plane_separation": barrier.get("plane_separation", {}),
        }
        authority_fingerprint = sha(authority_view)
        claim_authority = {
            "claim_authority_verdict": "BARRIER_DERIVED",
            "clock_source": "POSTGRESQL_STATEMENT_TIMESTAMP",
            "db_now": barrier.get("db_now"),
            "valid_until": barrier.get("valid_until"),
            "claims": barrier.get("claims", []),
        }
        execution_view = {
            "clock_source": "POSTGRESQL_STATEMENT_TIMESTAMP",
            "classification": "BARRIER_DERIVED",
            "runs": barrier.get("execution_runs", []),
        }
        evidence_class = "AUTHORITY_SAFE_READ_PROJECTION"
        same_world_rule = "equal semantic AND equal authority AND compatible frontier"
        semantic_head = (barrier.get("semantic_head") or {}).get("checkpoint_id")
        payload_root = (barrier.get("semantic_head") or {}).get("payload_root_sha256")
    else:
        mode = "FALLBACK"
        claim_authority, execution_view = fallback_execution_view(aop, observed_at)
        authority_view = None
        authority_fingerprint = None
        evidence_class = "PREPARED / FAIL-SAFER / EXECUTION_PLANE_ONLY — NOT AUTHORITY-SAFE"
        same_world_rule = "equal semantic AND equal execution fallback AND compatible frontier; NO claim-authority assertion"
        semantic_head = aop["semantic_head"]["checkpoint_id"]
        payload_root = aop["semantic_head"]["payload_root_sha256"]

    execution_fingerprint = sha(execution_view)

    # --- SEMANTIC domain ---
    fs = rpc("h205f22_fabric_status_v2")
    tp = rpc("h205f22_trust_plane_health_v1")
    try:
        ledger = get_object("shared/state/assumption-ledger.json")
        ledger_rev = ledger.get("revision")
    except Exception:
        ledger_rev = None

    threads = {}
    for e in list_objects("shared/threads/"):
        name = e["name"].split("/")[0]
        if not name:
            continue
        try:
            th = get_object(f"shared/threads/{name}/thread.json")
            threads[name] = {"state": th.get("state"), "mode": th.get("mode")}
        except Exception:
            threads[name] = {"state": "UNREADABLE"}

    semantic_view = {
        "semantic_head": semantic_head,
        "payload_root": payload_root,
        "threads": threads,
        "assumption_ledger_revision": ledger_rev,
        "fabric_blocker": fs.get("current_blocker"),
        "trust_plane_state": tp.get("state"),
    }
    semantic_fingerprint = sha(semantic_view)

    # --- TRANSPORT FRONTIER domain ---
    frontier = {}
    for agent in ("glm", "chatgpt"):
        seqs = []
        for e in list_objects(f"agents/{agent}/outbox/"):
            m = re.match(r"^(\d{4})-", e["name"])
            if m:
                seqs.append(int(m.group(1)))
        frontier[agent] = max(seqs) if seqs else 0
    frontier_fingerprint = sha(frontier)

    if mode == "BARRIER":
        composite_parts = {
            "semantic": semantic_fingerprint,
            "authority": authority_fingerprint,
            "frontier": frontier_fingerprint,
        }
    else:
        composite_parts = {
            "semantic": semantic_fingerprint,
            "execution_fallback": execution_fingerprint,
            "frontier": frontier_fingerprint,
        }
    composite = sha(composite_parts)

    result = {
        "schema": "metaengine.pap.read-plane-fingerprint.v2.3",
        "mode": mode,
        "composite_fingerprint": composite,
        "semantic_fingerprint": semantic_fingerprint,
        "authority_fingerprint": authority_fingerprint,
        "execution_fingerprint": execution_fingerprint,
        "transport_frontier": frontier,
        "frontier_fingerprint": frontier_fingerprint,
        "authority_view": authority_view,
        "execution_view": execution_view,
        "claim_authority": claim_authority,
        "semantic_view": semantic_view,
        "same_world_rule": same_world_rule,
        "plane_separation": "PROJECT CLAIM LEASE != AOP RUN LEASE != PAP TRANSPORT LEASE",
        "evidence_class": evidence_class,
    }

    if args.verify:
        match = args.verify == composite
        print(json.dumps({
            "match": match,
            "expected": args.verify,
            "actual": composite,
            "mode": mode,
            "action": "PROCEED" if match else "CONTEXT_REHYDRATION_REQUIRED",
        }, indent=2))
        sys.exit(0 if match else 1)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
