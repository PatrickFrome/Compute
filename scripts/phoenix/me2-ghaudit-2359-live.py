#!/usr/bin/env python3
# me2-ghaudit-2359-live.py — LIVE CLIENT cross-pin: which exact GitHub build is the live browser
# supervisor running (run-id → commit/branch/workflow), plus state-blob incarnation/heartbeat.
# READ-ONLY. No secrets printed.
import json, urllib.request, datetime

T = None
for line in open("/home/z/.a2/.github.env"):
    if line.startswith("GITHUB_TOKEN_ADMIN="):
        T = line.split("=", 1)[1].strip()

env = {}
for line in open("/tmp/my-project/.a2-backup/me2.env.20260922"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

SU, SJ = env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_JWT"]
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
OUT = "/home/z/my-project/scripts/phoenix/me2-ghaudit-2359-live-results.json"
R = {}

def gh(path):
    req = urllib.request.Request(f"https://api.github.com/repos/PatrickFrome/Compute{path}", headers={
        "Authorization": f"Bearer {T}", "Accept": "application/vnd.github+json", "User-Agent": "me2-ghaudit"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

# 1) live client build run (pin from session context: v0.7.0-dev.36336130139.1)
for run_id, label in ((36336130139, "live_client_pin"), (36315939303, "latest_release")):
    try:
        run = gh(f"/actions/runs/{run_id}")
        R[label] = {"run_id": run_id, "workflow": run.get("name"), "head_branch": run.get("head_branch"),
                    "head_sha": (run.get("head_sha") or "")[:12], "event": run.get("event"),
                    "status": run.get("status"), "conclusion": run.get("conclusion"),
                    "created_at": run.get("created_at"), "run_number": run.get("run_number"),
                    "display_title": (run.get("display_title") or "")[:120]}
    except Exception as e:
        R[label] = {"run_id": run_id, "error": str(e)[:200]}

# 2) state blob: incarnation / heartbeat / version keys (free REST, read-only)
q = urllib.request.Request(
    f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&client_id=eq.{TGT}&limit=1",
    headers={"apikey": SJ, "Authorization": f"Bearer {SJ}"})
try:
    blob = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
    st = blob[0]["state"] if blob else {}
    keys = sorted(st.keys())
    R["state_blob_keys"] = keys
    def pick(d, *names):
        out = {}
        for n in names:
            if isinstance(d, dict) and n in d:
                out[n] = d[n]
        return out
    R["state_identity"] = pick(st, "version", "app_version", "client_version", "process_incarnation",
                               "incarnation", "boot_time", "boot_at", "started_at", "heartbeat_at",
                               "last_heartbeat", "ts", "updated_at", "seq", "last_seq", "health", "mode")
    # deep scan for version-like fields (bounded)
    found = {}
    def scan(d, path="", depth=0):
        if depth > 4 or not isinstance(d, dict):
            return
        for k, v in d.items():
            kl = str(k).lower()
            if any(s in kl for s in ("version", "incarnat", "heartbeat", "boot", "epoch")) and not isinstance(v, (dict, list)):
                found[path + k] = str(v)[:80]
            if isinstance(v, dict):
                scan(v, path + k + ".", depth + 1)
    scan(st)
    R["state_version_fields"] = found
    R["state_top_summary"] = {k: (f"<{len(v)} keys>" if isinstance(v, dict) else
                                  f"<{len(v)} items>" if isinstance(v, list) else str(v)[:60])
                              for k, v in st.items()}
except Exception as e:
    R["state_blob_error"] = str(e)[:300]

json.dump(R, open(OUT, "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: R[k] for k in ("live_client_pin", "latest_release", "state_identity",
                                    "state_version_fields")}, indent=1, ensure_ascii=False))
print("top_keys:", R.get("state_blob_keys"))
