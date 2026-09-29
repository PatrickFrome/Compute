#!/usr/bin/env python3
"""BROWSER-TEST-20260929-0000 (Job 419203 re-dispatch @00:00) — R0:
live state blob (heartbeat/version/incarnation) + fictional-tables check (404 expected).
Free REST, no command budget, no secrets printed."""
import json, urllib.request

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-bt2900-r0.json"
env = {}
for line in open(ENVF):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
SU, SJ = env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_JWT"]
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
H = {"apikey": SJ, "Authorization": f"Bearer {SJ}"}
REC = {}

def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30)
        return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return -1, str(e)[:120]

# 1) state blob (heartbeat/state)
st, blob = get(f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&client_id=eq.{TGT}&limit=1")
REC["state_http"] = st
if blob:
    s = blob[0].get("state") or {}
    rec = s.get("supervisor") or {}
    REC["updated_at"] = blob[0].get("updated_at")
    REC["state_top_keys"] = sorted(s.keys())[:30]
    REC["supervisor_version"] = rec.get("version") or rec.get("client_version")
    REC["incarnation"] = rec.get("incarnation") or rec.get("process_incarnation")
    REC["heartbeat_ts"] = rec.get("heartbeat") or rec.get("last_heartbeat") or rec.get("ts")
    fleet = s.get("fleet") or {}
    REC["fleet_agents"] = len(fleet.get("agents") or [])
    REC["shell_version"] = s.get("shell_version")
    REC["heartbeat_at"] = s.get("heartbeat_at")
    REC["started_at"] = s.get("started_at")
    REC["schema"] = s.get("schema")
    lc = s.get("supervisor_lifecycle") or {}
    REC["lifecycle_keys"] = {k: lc.get(k) for k in ("state", "incarnation", "pid", "boot_at", "version") if k in lc} if isinstance(lc, dict) else str(lc)[:100]
    mesh = s.get("supervisor_mesh") or {}
    if isinstance(mesh, dict):
        REC["mesh_summary"] = {k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in list(mesh.items())[:8]}
    su = s.get("self_update") or {}
    REC["self_update_keys"] = sorted(su.keys())[:10] if isinstance(su, dict) else str(su)[:80]
# 2) fictional tables from the task text — expect 404
for t in ("supervisor_mesh_instance", "browser_device"):
    code, _ = get(f"{SU}/rest/v1/{t}?select=*&limit=1")
    REC[f"table_{t}"] = code
json.dump(REC, open(OUT, "w"), indent=1, ensure_ascii=False)
print(json.dumps(REC, ensure_ascii=False, indent=1))
