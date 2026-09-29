#!/usr/bin/env python3
"""R419718-1645: диагностика SEMANTIC_FOCUS receipt (read-only Supabase query).
Почему focused-резолюция (L21) не приняла FAILED postcondition_not_confirmed:
в receipt должен быть target.semantic_ref_id — смотрим фактическую форму."""
import json, urllib.request

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
env = {}
for line in open(ENVF):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
SU, SJ = env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_JWT"]
URL = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22"

q = f"{URL}?issued_by=eq.me2-daemon-fleet-readback&issued_at=gte.2026-09-28T08:50&select=command_id,action,status,error,issued_at,receipt&order=issued_at.asc&limit=30"
req = urllib.request.Request(q, headers={"apikey": SJ, "Authorization": f"Bearer {SJ}"})
rows = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
out = []
for r in rows:
    rec = r.get("receipt") or {}
    res = rec.get("result") or {}
    tgt = res.get("target") if isinstance(res, dict) else None
    out.append({
        "time": r["issued_at"][11:19], "action": r["action"], "status": r["status"],
        "error": (r.get("error") or "")[:120],
        "receipt_keys": sorted(res.keys())[:10] if isinstance(res, dict) else None,
        "target_shape": ({k: (v if isinstance(v, (str, int, bool)) else type(v).__name__) for k, v in tgt.items()} if isinstance(tgt, dict) else None),
        "focus_evidence": ({"semantic_ref_id": tgt.get("semantic_ref_id")} if isinstance(tgt, dict) else None),
    })
print(json.dumps(out, ensure_ascii=False, indent=1))
with open("/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1645-focus-diag.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
