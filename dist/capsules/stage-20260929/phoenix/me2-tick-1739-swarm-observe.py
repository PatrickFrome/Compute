#!/usr/bin/env python3
"""ME2-TICK-20260928-1739: observe swarm tab-capacity work package (READ-ONLY).
No commands issued to live browser. Only REST SELECT on command table.
Never prints secrets."""
import json, urllib.request, urllib.error, time, sys

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"

def load_env():
    env = {}
    with open(ENVF) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
SU, SJ = ENV["SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_JWT"]
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"

def rest_select(params):
    url = f"{SU}/rest/v1/{TBL}?{params}"
    req = urllib.request.Request(url, headers={"apikey": SJ, "Authorization": f"Bearer {SJ}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return [{"__http_error": e.code}]

# 1) all browser commands since given time (default 09:32 UTC)
SINCE = sys.argv[1] if len(sys.argv) > 1 else "2026-09-28T09:32:00"
rows = rest_select(f"select=command_id,action,status,issued_by,issued_at,error&issued_at=gte.{SINCE}&order=issued_at.asc&limit=80")
print(f"=== browser commands since {SINCE}: {len(rows)} ===")
for r in rows:
    if "__http_error" in r:
        print("HTTP_ERROR", r); break
    err = (r.get("error") or "")[:80]
    print(f"{r.get('issued_at','?')[11:19]} | {(r.get('issued_by') or '?')[:24]:<24} | {r.get('action','?'):<16} | {r.get('status','?'):<10} | {err}")

# 2) CLOSE_TAB count by issuer (all time today)
rows = rest_select("select=issued_by,status&action=eq.CLOSE_TAB&issued_at=gte.2026-09-28T00:00:00&limit=200")
if rows and "__http_error" not in rows[0]:
    from collections import Counter
    c = Counter((r.get("issued_by") or "?", r.get("status")) for r in rows)
    print(f"\n=== CLOSE_TAB today by issuer/status: {len(rows)} total ===")
    for (iss, st), n in sorted(c.items()):
        print(f"  {iss} {st}: {n}")

# 3) latest TAB_CENSUS receipt (tab count now)
rows = rest_select("select=issued_at,receipt,status&action=eq.TAB_CENSUS&issued_at=gte.2026-09-28T09:00:00&order=issued_at.desc&limit=3")
print(f"\n=== latest TAB_CENSUS: {len(rows)} ===")
for r in rows:
    if "__http_error" in r:
        print("HTTP_ERROR", r); continue
    res = (r.get("receipt") or {}).get("result") or {}
    tabs = res.get("tabs", [])
    total = res.get("total") if res.get("total") is not None else len(tabs)
    print(f"{r.get('issued_at','?')[11:19]} {r.get('status')}: total={total}")
    if tabs:
        titles = [str(t.get('title',''))[:36] for t in tabs[:6]]
        print(f"  sample: {titles}")
