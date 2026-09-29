#!/usr/bin/env python3
"""Job 419203 @15:00 — step 0: live state snapshot (read-only, no secrets printed).
Tables: browser_supervisor_state (heartbeat), supervisor_mesh_instance (fleet), browser_device."""
import json, os, sys, urllib.request, datetime

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
env = {}
with open(ENVF) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v.strip().strip('"').strip("'")

SU = env["SUPABASE_URL"]
JWT = env["SUPABASE_SERVICE_ROLE_JWT"]
WS = env.get("WORKSPACE_ID", "2de9f84b-7c0a-4091-911c-894ff1d6eaf4")
TGT = env.get("CLIENT_ID", "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9")

def q(table, qs):
    url = f"{SU}/rest/v1/{table}?{qs}"
    req = urllib.request.Request(url, headers={
        "apikey": JWT, "Authorization": f"Bearer {JWT}",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())

now = datetime.datetime.now(datetime.timezone.utc)
out = {"checked_at": now.isoformat(), "workspace": WS, "target_client": TGT}

# 1) supervisor state / heartbeat (proven pattern: select=state, filter client_id)
rows = q("compute_fabric_a2_browser_supervisor_state_h205f22",
         f"select=state&client_id=eq.{TGT}&limit=1")
out["state_rows"] = len(rows)
if rows:
    st = rows[0].get("state") or {}
    tabs = st.get("tabs", [])
    out["state"] = {
        "version": st.get("version") or st.get("client_version"),
        "heartbeat_at": st.get("heartbeat_at") or st.get("ts") or st.get("updated_at"),
        "keys": sorted(st.keys())[:24],
        "tabs_total": len(tabs),
        "tab_kinds": {k: sum(1 for t in tabs if (t.get("kind") or "?") == k)
                      for k in {t.get("kind") or "?" for t in tabs}},
        "selected_tab": next((t.get("tab_id")[:18] for t in tabs if t.get("selected")), None),
    }

# 2) mesh fleet
try:
    mesh = q("supervisor_mesh_instance",
             f"workspace_id=eq.{WS}&order=updated_at.desc&limit=10")
    out["mesh_count"] = len(mesh)
    out["mesh"] = [{
        "id": (m.get("instance_id") or m.get("id")),
        "role": m.get("role"), "status": m.get("status"),
        "agent": m.get("agent_name") or m.get("agent_label"),
        "updated": m.get("updated_at"),
    } for m in mesh]
except Exception as e:
    out["mesh_error"] = str(e)

# 3) browser_device
try:
    dev = q("browser_device", f"workspace_id=eq.{WS}&limit=5")
    out["device_count"] = len(dev)
    out["device"] = [{
        "device_id": d.get("device_id") or d.get("id"),
        "platform": d.get("platform"), "online": d.get("online"),
        "last_seen": d.get("last_seen_at") or d.get("updated_at"),
    } for d in dev]
except Exception as e:
    out["device_error"] = str(e)

# 4) recent command tail (last 10, statuses)
try:
    cmds = q("compute_fabric_a2_browser_supervisor_command_h205f22",
             f"workspace_id=eq.{WS}&order=issued_at.desc&limit=10&select=command_id,action,status,issued_by,issued_at,error")
    out["recent_commands"] = cmds
except Exception as e:
    out["cmd_error"] = str(e)

with open("/home/z/my-project/scripts/phoenix/browser-test-results-bt1500-state.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)

# safe print (no secrets)
print(json.dumps(out, indent=1, ensure_ascii=False)[:3000])
