#!/usr/bin/env python3
"""Job 419203 @15:00 — фаза 0b: подсостояния механик из state-блоба (read-only)."""
import json, urllib.request

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
env = {}
with open(ENVF) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v.strip().strip('"').strip("'")
SU, SJ = env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_JWT"]
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"

req = urllib.request.Request(
    f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&client_id=eq.{TGT}&limit=1",
    headers={"apikey": SJ, "Authorization": f"Bearer {SJ}"})
with urllib.request.urlopen(req, timeout=20) as r:
    st = json.loads(r.read())[0]["state"]

def brief(x, depth=0):
    if isinstance(x, dict):
        if depth >= 2: return f"<dict {len(x)}>"
        return {k: brief(v, depth + 1) for k, v in list(x.items())[:14]}
    if isinstance(x, list):
        return f"<list {len(x)}>"
    if isinstance(x, str) and len(x) > 90: return x[:90] + "…"
    return x

out = {k: brief(st.get(k)) for k in
       ["shell_version", "armed", "supervisor_mode", "operator_mode", "heartbeat_at",
        "fleet", "supervisor_mesh", "self_update", "development_plane",
        "control_latency", "host_resilience", "supervisor_lifecycle",
        "compute", "perception", "realtime_observation_push", "realtime_process_plane",
        "last_error", "started_at", "transport_identity", "client_kind"]}
with open("/home/z/my-project/scripts/phoenix/browser-test-results-bt1500-state-sub.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps(out, indent=1, ensure_ascii=False)[:4500])
