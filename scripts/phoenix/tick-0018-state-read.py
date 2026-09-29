#!/usr/bin/env python3
"""ME2-TICK-20260929-0018: S0 state-blob read (free channel, no census enqueue).
Reads supervisor state keys: DEV_PLANE_REPO_HEAD, capacity/census snapshot, leases."""
import os, json, urllib.request, sys

ENV_PATHS = ["/tmp/my-project/.a2-backup/me2.env.20260922", "/home/z/my-project/.env"]
env = {}
for p in ENV_PATHS:
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
        break

SU = env.get("SUPABASE_URL") or env.get("SUPABASE_URL_PROJECT")
SJ = env.get("SUPABASE_SERVICE_ROLE_JWT") or env.get("SUPABASE_SERVICE_ROLE_KEY")
if not SU or not SJ:
    print("FATAL: supabase env not found"); sys.exit(1)

def rest(url):
    req = urllib.request.Request(url, headers={
        "apikey": SJ, "Authorization": f"Bearer {SJ}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
q = urllib.request.Request(
    f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&client_id=eq.{TGT}&limit=1",
    headers={"apikey": SJ, "Authorization": f"Bearer {SJ}", "Accept": "application/json"})
blob = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
st = blob[0]["state"] if blob else {}
print("top-level keys:", sorted(st.keys()))
# identity / repo head
for k in ("DEV_PLANE_REPO_HEAD", "dev_plane_repo_head", "repo_head", "identity", "version", "installed_version"):
    if k in st:
        v = st[k]
        print(f"{k}: {json.dumps(v, ensure_ascii=False)[:600]}")
# fleet + capacity
fleet = st.get("fleet", {})
agents = fleet.get("agents", []) or []
print(f"fleet.agents: {len(agents)}")
for a in agents[:12]:
    print("  ", json.dumps({kk: a.get(kk) for kk in ("id", "agent_id", "status", "state", "bound_tab", "tab_id", "role") if a.get(kk) is not None}, ensure_ascii=False)[:220])
tabs = st.get("tabs") or (st.get("census") or {}).get("tabs") or None
if isinstance(tabs, list):
    print(f"state.tabs: {len(tabs)}")
cens = st.get("census") or st.get("last_census") or {}
if cens:
    print("census keys:", sorted(cens.keys()) if isinstance(cens, dict) else type(cens))
    print("census:", json.dumps(cens, ensure_ascii=False)[:800])
# development_plane identity
dp = st.get("development_plane") or {}
print("development_plane:", json.dumps(dp, ensure_ascii=False)[:1500])
# tab kind/role breakdown
tl = st.get("tabs") or []
from collections import Counter
kinds = Counter(t.get("kind") for t in tl)
roles = Counter(t.get("role") for t in tl)
print(f"tabs={len(tl)} kinds={dict(kinds)} roles={dict(roles)}")
bound_ids = {a.get("tab_id") for a in agents}
unbound_glm = [t["tab_id"] for t in tl if t.get("kind") == "GLM_CHAT" and t.get("tab_id") not in bound_ids]
print(f"GLM_CHAT unbound (reclaim candidates): {len(unbound_glm)}")
# supervisor_lifecycle + transport identity (process incarnation)
sl = st.get("supervisor_lifecycle") or {}
print("supervisor_lifecycle:", json.dumps(sl, ensure_ascii=False)[:400])
ti = st.get("transport_identity") or {}
print("transport_identity:", json.dumps(ti, ensure_ascii=False)[:300])
