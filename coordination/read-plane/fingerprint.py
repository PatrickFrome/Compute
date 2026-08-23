#!/usr/bin/env python3
"""fingerprint.py v2.2 — H205F22 shared read-plane.

v2.2 (ChatGPT implementation review, 2026-08-23 — three bugs fixed):
  BUG-1 CRIT: v2 conflated PROJECT CLAIM lease with AOP RUN lease.
       aop1_snapshot does NOT expose claim.expires_at / claim rows at all.
       => v2.2 computes EXECUTION-plane liveness ONLY, and explicitly refuses
          to make project-claim-authority statements. authority_view is
          renamed execution_view; any claim statement is
          NOT_CLAIM_AUTHORITY_SAFE until coordination_read_barrier exists.
  BUG-2 HIGH: RUN_FENCED was scoped by milestone only — a stale fence could
       poison a future legitimate claim. v2.2 scopes fences by run_id
       (available on events) and NEVER derives claim state from a fence;
       fences are execution-plane confirmations only.
  BUG-3 MED: client wall clock for fencing boundaries. v2.2 records the
       clock source and marks boundary-proximal results as CLOCK_SENSITIVE
       (±60s) instead of pretending DB clock_timestamp() was used.

Honest evidence class of this tool (until read-barrier RPC lands):
  FINGERPRINT_V2.2 = PREPARED / FAIL-SAFER / EXECUTION_PLANE_ONLY
  NOT AUTHORITY-SAFE — machine-verified SAME_WORLD requires:
  same code SHA + read-barrier output + normalization.

Usage:
  python3 fingerprint.py                  # compute + print
  python3 fingerprint.py --verify <hex>   # composite check
"""
import argparse
import hashlib
import json
import os
import re
import sys
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", default=None)
    args = ap.parse_args()
    if not SB_KEY:
        print("SB_KEY env required", file=sys.stderr)
        sys.exit(2)

    observed_at = datetime.now(timezone.utc)
    observed_iso = observed_at.strftime("%Y-%m-%dT%H:%M:%SZ")

    # --- single RPC for the DB-derived domain (aop1_snapshot is one statement) ---
    aop = rpc("h205f22_aop1_snapshot_v1")
    events = aop.get("recent_events", [])
    runs = aop.get("active_runs", [])
    stored_alignment = aop["canonical_alignment"]["active_claim_alignment"]

    # EXECUTION plane: fences scoped by RUN (never by milestone alone — BUG-2 fix)
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
        boundary = bool(lease_exp and abs((lease_exp - observed_at).total_seconds())
                        <= CLOCK_SENSITIVITY_S)  # BUG-3: flag clock-sensitive verdicts
        state = r.get("state")
        execution_runs.append({
            "run_id": rid,
            "milestone": r.get("milestone_key"),
            "state": state,
            "fenced": fenced,
            "fence_ts": fences_by_run.get(rid),
            "lease_expires_at": r.get("lease_expires_at"),
            "lease_live_client_clock": lease_live,
            "clock_sensitive": boundary,
        })

    # PROJECT CLAIM authority: NOT computable from this surface (BUG-1 honesty).
    # We report stored alignment verbatim as UNVERIFIED_STORED_VIEW and refuse
    # to derive effective claim liveness. Read-barrier RPC is the completion.
    claim_authority = {
        "stored_alignment": stored_alignment,
        "claim_authority_verdict": "NOT_COMPUTABLE_FROM_THIS_SURFACE",
        "reason": "claim.expires_at / claim rows are not exposed by aop1_snapshot_v1; "
                  "v2 conflated them with run leases (BUG-1). Requires "
                  "coordination_read_barrier_h205f22() — PR-first, see "
                  "shared/read-plane/read-barrier-migration.sql",
    }

    execution_view = {
        "observed_at": observed_iso,
        "clock_source": "CLIENT_WALL_CLOCK (DB clock_timestamp() unavailable pre-read-barrier; boundary-proximal verdicts flagged clock_sensitive)",
        "classification": "EXECUTION_PLANE_ONLY__NOT_CLAIM_AUTHORITY_SAFE",
        "runs": execution_runs,
        "newest_event": events[0].get("created_at") if events else None,
        "newest_event_type": events[0].get("event_type") if events else None,
    }
    execution_fingerprint = sha({k: v for k, v in execution_view.items()
                                 if k != "observed_at"})

    # --- SEMANTIC domain (slow truth) ---
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
        "semantic_head": aop["semantic_head"]["checkpoint_id"],
        "payload_root": aop["semantic_head"]["payload_root_sha256"],
        "threads": threads,
        "assumption_ledger_revision": ledger_rev,
        "fabric_blocker": fs.get("current_blocker"),
        "trust_plane_state": tp.get("state"),
    }
    semantic_fingerprint = sha(semantic_view)

    # --- FRONTIER domain ---
    frontier = {}
    for agent in ("glm", "chatgpt"):
        seqs = []
        for e in list_objects(f"agents/{agent}/outbox/"):
            m = re.match(r"^(\d{4})-", e["name"])
            if m:
                seqs.append(int(m.group(1)))
        frontier[agent] = max(seqs) if seqs else 0
    frontier_fingerprint = sha(frontier)

    composite = sha({"semantic": semantic_fingerprint,
                     "execution": execution_fingerprint,
                     "frontier": frontier_fingerprint})

    result = {
        "schema": "metaengine.pap.read-plane-fingerprint.v2.2",
        "composite_fingerprint": composite,
        "semantic_fingerprint": semantic_fingerprint,
        "execution_fingerprint": execution_fingerprint,
        "transport_frontier": frontier,
        "frontier_fingerprint": frontier_fingerprint,
        "execution_view": execution_view,
        "claim_authority": claim_authority,
        "semantic_view": semantic_view,
        "same_world_rule": "equal semantic AND equal execution view AND compatible frontier — UNTIL read-barrier: no claim-authority claim is made",
        "plane_separation": "PROJECT CLAIM LEASE != AOP RUN LEASE != PAP TRANSPORT LEASE (v2.2 enforces by refusing to conflate)",
        "evidence_class": "PREPARED / FAIL-SAFER / EXECUTION_PLANE_ONLY — NOT AUTHORITY-SAFE",
    }

    if args.verify:
        match = args.verify == composite
        print(json.dumps({"match": match, "expected": args.verify,
                          "actual": composite,
                          "action": "PROCEED" if match else "CONTEXT_REHYDRATION_REQUIRED"},
                         indent=2))
        sys.exit(0 if match else 1)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
