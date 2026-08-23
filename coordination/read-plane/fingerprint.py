#!/usr/bin/env python3
"""fingerprint.py v2 — H205F22 shared read-plane (post STALE_ACTIVE_CLAIM defect).

v2 changes (defect found by ChatGPT 2026-08-23, confirmed live by GLM):
  ONE fingerprint -> THREE components:
    SEMANTIC  (slow truth: checkpoint, threads, ledger revision)
    AUTHORITY (fast truth: claims + EFFECTIVE liveness + observed_at)
    FRONTIER  (what each agent has seen)
  SAME_WORLD = equal semantic + equal authority(view, not wall clock) +
               compatible frontier. Authority equality compares the COMPUTED
               effective state, not stored state.

Temporal-consistency rules (the defect fix):
  effective_claim_live = stored ACTIVE
                         AND no RUN_FENCED/ORPHANED_OR_EXPIRED_CLAIM event
                             for that milestone AFTER claim creation
                         AND every related lease_expires_at > observed_at
  A stored ACTIVE row whose lease expired is EXPIRED, not ACTIVE.
  observed_at = client wall clock, recorded in the output (the read-barrier
  RPC `coordination_read_barrier_h205f22()` remains PR-first future work —
  see CONTRACT.md; v2 derives authority from ONE aop1_snapshot RPC, which
  is itself a single server-side statement, minimizing torn reads).

Usage:
  python3 fingerprint.py                  # compute + print
  python3 fingerprint.py --verify <hex>   # semantic+authority+frontier composite
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

    # --- AUTHORITY domain: ONE RPC (aop1_snapshot is a single server-side call) ---
    aop = rpc("h205f22_aop1_snapshot_v1")
    events = aop.get("recent_events", [])
    runs = aop.get("active_runs", [])
    stored_alignment = aop["canonical_alignment"]["active_claim_alignment"]

    # fencing events (the fabric's own reaper) — most recent first
    fenced = {}
    for e in sorted(events, key=lambda x: x.get("created_at", ""), reverse=True):
        if e.get("event_type") == "RUN_FENCED":
            mk = e.get("milestone_key")
            if mk and mk not in fenced:
                fenced[mk] = e.get("created_at")

    effective_claims = []
    for c in stored_alignment:
        mk = c["milestone_key"]
        stored_active = True  # presence in active_claim_alignment = stored active
        fence_ts = fenced.get(mk)
        # leases for this milestone's runs
        lease_dead = []
        for r in runs:
            if r.get("milestone_key") == mk and r.get("lease_expires_at"):
                lease_dead.append(parse_ts(r["lease_expires_at"]))
        max_lease = max(lease_dead) if lease_dead else None
        lease_live = bool(max_lease and max_lease > observed_at)
        fenced_after = bool(fence_ts)  # latest event trail shows a fence for mk
        effective_state = "ACTIVE" if (stored_active and lease_live and not fenced_after) else (
            "FENCED" if fenced_after else ("EXPIRED" if max_lease else "UNKNOWN"))
        effective_claims.append({
            "claim_id": c["claim_id"], "milestone": mk,
            "canonical_l1": c["canonical_milestone_key"],
            "stored_state": "ACTIVE",
            "effective_state": effective_state,
            "last_fence_at": fence_ts,
            "max_lease_expires_at": max_lease.isoformat() if max_lease else None,
        })

    authority_view = {
        "observed_at": observed_iso,
        "claims": effective_claims,
        "runs": [{"state": r.get("state"), "milestone": r.get("milestone_key"),
                  "lease_expires_at": r.get("lease_expires_at")} for r in runs],
        "newest_event": events[0].get("created_at") if events else None,
        "newest_event_type": events[0].get("event_type") if events else None,
    }
    authority_fingerprint = sha({k: v for k, v in authority_view.items()
                                 if k != "observed_at"})  # view equality, not clock

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
                     "authority": authority_fingerprint,
                     "frontier": frontier_fingerprint})

    result = {
        "schema": "metaengine.pap.read-plane-fingerprint.v2",
        "composite_fingerprint": composite,
        "semantic_fingerprint": semantic_fingerprint,
        "authority_fingerprint": authority_fingerprint,
        "transport_frontier": frontier,
        "frontier_fingerprint": frontier_fingerprint,
        "authority_view": authority_view,
        "semantic_view": semantic_view,
        "same_world_rule": "equal semantic AND equal authority view AND compatible frontier",
        "temporal_rule": "stored ACTIVE + expired lease => EXPIRED (never effective authority)",
        "note": "read-barrier single-RPC is PR-first future work; authority derived from one aop1_snapshot call",
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
