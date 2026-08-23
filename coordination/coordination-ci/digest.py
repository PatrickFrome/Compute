#!/usr/bin/env python3
"""digest.py — Coordination Zone digest for PAP-1.2 (L2 wake hierarchy).

Runs in GitHub Actions (ubuntu-latest, stdlib only) or locally.
Lists both agents' outboxes + all threads in the bucket, builds a Markdown
digest, and exits 1 when there are unacked peer messages (intentional
signal: GitHub auto-emails the repo owner on workflow failure).

Env:
  SUPABASE_URL               e.g. https://xpeibufgzjknrhbhpffp.supabase.co
  SB_STORAGE_READ_KEY        scoped read-only Storage token (NEVER service_role)
  BUCKET                     default computefabric-parallel-glm

Usage:
  python3 digest.py [--since 2026-08-22T00:00:00Z] [--strict]
"""
import argparse
import json
import os
import sys
import urllib.request

BUCKET = os.environ.get("BUCKET", "computefabric-parallel-glm")
BASE = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SB_STORAGE_READ_KEY", "")
AGENTS = ["glm", "chatgpt"]


def req(path, method="GET", body=None):
    url = f"{BASE}/storage/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": KEY, "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read())


def list_objects(prefix):
    out = []
    offset = 0
    while True:
        page = req(f"object/list/{BUCKET}", "POST", {
            "prefix": prefix, "limit": 100, "offset": offset,
            "sortBy": {"column": "name", "order": "asc"},
        })
        out.extend(page)
        if len(page) < 100:
            return out
        offset += 100


def get_object(key):
    url = f"{BASE}/storage/v1/object/authenticated/{BUCKET}/{key}"
    r = urllib.request.Request(url, headers={
        "apikey": KEY, "Authorization": f"Bearer {KEY}",
    })
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=None,
                    help="ISO ts; only messages newer than this are 'new'")
    ap.add_argument("--strict", action="store_true",
                    help="exit 1 if ANY unacked peer message exists (issue/email trigger)")
    ap.add_argument("--out", default=None,
                    help="also write the digest to this file (used by CI issue step)")
    args = ap.parse_args()

    if not BASE or not KEY:
        print("digest: SUPABASE_URL and SB_STORAGE_READ_KEY are required")
        sys.exit(2)

    lines = ["# Coordination Zone digest", ""]
    unacked = 0

    # STATE header: snapshot first (EVENT vs STATE separation)
    try:
        snap = get_object("shared/state/snapshot.json")
        lines.append(f"## STATE (snapshot @{snap.get('updated_at','?')} by {snap.get('updated_by','?')})")
        sh = snap.get("semantic_head", {})
        lines.append(f"- semantic_head: {sh.get('checkpoint_id','?')}")
        claims = snap.get("active_claims", [])
        for c in claims:
            lines.append(f"- claim #{c.get('claim_id')} ({c.get('mapping')} -> {c.get('canonical_l1')}, {c.get('milestone_key')}): aligned={c.get('aligned')}")
        health = snap.get("sync_health", {})
        lines.append(f"- **SYNC_HEALTH: {health.get('level','?')}** — {'; '.join(health.get('reasons',[])) or 'all clear'}")
        for p in snap.get("pending", []):
            lines.append(f"- pending: [{p.get('thread')}] owed_by={p.get('owed_by')}: {p.get('action')}")
        lines.append("")
    except Exception:
        lines.append("## STATE: snapshot unreadable (shared/state/snapshot.json missing or malformed)")
        lines.append("")

    for agent in AGENTS:
        entries = [e["name"] for e in list_objects(f"agents/{agent}/outbox/")
                   if e["name"].endswith(".json")]
        # acked state from cursor (best-effort; missing cursor = all unacked)
        try:
            cursor = get_object(f"agents/{agent}/cursor.json")
            acked = set(cursor.get("acked", []))
        except Exception:
            acked = set()
        peer = "chatgpt" if agent == "glm" else "glm"
        lines.append(f"## {agent} outbox ({len(entries)} messages)")
        for name in sorted(entries):
            try:
                env = get_object(f"agents/{agent}/outbox/{name}")
            except Exception as exc:
                lines.append(f"- `{name}` — unreadable ({exc})")
                continue
            mid = env.get("id", name)
            new = (args.since is None or env.get("ts", "") > args.since)
            is_acked = mid in acked or agent == "glm"  # glm self-published
            flag = ""
            if agent != "glm" and mid not in acked:
                unacked += 1
                flag = " **[UNACKED by glm]**"
            mark = "NEW " if new else ""
            lines.append(
                f"- {mark}`{mid}` [{env.get('kind','?')}]"
                f" thread={env.get('thread_id') or '-'}"
                f" class={env.get('evidence_class','?')}"
                f" resp={'Y' if env.get('requires_response') else 'N'}{flag}"
            )
            lines.append(f"  - {env.get('summary','')[:220]}")
        lines.append("")

    # NOTE: Storage LIST is non-recursive — listing shared/threads/ returns
    # the thread directory entries themselves.
    threads = list_objects("shared/threads/")
    tdirs = sorted({e["name"].split("/")[0] for e in threads if e["name"]})
    lines.append(f"## threads ({len(tdirs)})")
    for t in tdirs:
        try:
            th = get_object(f"shared/threads/{t}/thread.json")
            lines.append(
                f"- `{t}` — {th.get('state','?')} / {th.get('mode','?')}"
                f" / claim={th.get('claim_id')}"
                f" (owners: chatgpt={'Y' if 'chatgpt' in th.get('expected',{}) else '-'}"
                f" glm={'Y' if 'glm' in th.get('expected',{}) else '-'})"
            )
        except Exception as exc:
            lines.append(f"- `{t}` — thread.json unreadable ({exc})")
    lines.append("")

    # heartbeats (liveness only — Law 1)
    lines.append("## heartbeats (liveness only)")
    for agent in AGENTS:
        try:
            hb = get_object(f"agents/{agent}/heartbeat.json")
            lines.append(f"- {agent}: {hb.get('ts','?')} task={hb.get('current_task','?')}")
        except Exception:
            lines.append(f"- {agent}: no heartbeat")
    lines.append("")

    digest = "\n".join(lines)
    print(digest)
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(digest + "\n")

    if args.since:
        print(f"\n(since={args.since})")
    if unacked:
        print(f"\nSIGNAL: {unacked} unacked peer message(s) for glm — "
              "open the GLM session and run the sync cadence.")
        if args.strict:
            sys.exit(1)  # CI maps this to the attention issue, NOT to email


if __name__ == "__main__":
    main()
