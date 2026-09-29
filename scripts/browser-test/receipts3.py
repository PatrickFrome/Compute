#!/usr/bin/env python3
# receipts3.py — dump raw receipts of recent test commands (JSON-safe).
import json, sys
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env, req

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
code, data = req(f"{su}/rest/v1/{TBL}?select=action,status,receipt,error,effect_key,issued_at&issued_by=eq.zai-live-test-419203&order=issued_at.desc&limit=10")
if code != 200:
    print("HTTP", code, str(data)[:200]); sys.exit(1)
for r in data:
    rc = str(r.get("receipt") or "")
    print("---", r["action"], r["status"], "ek=", str(r.get("effect_key"))[:40], "at=", r["issued_at"])
    print("RC:", rc[:700].replace("\n", " "))
    if r.get("error"): print("ERR:", str(r["error"])[:200])
