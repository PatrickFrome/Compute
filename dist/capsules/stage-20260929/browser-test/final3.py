#!/usr/bin/env python3
# final3.py — final statuses + full fleet receipt + constraint error details.
import json, sys, re
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env, req

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"

# final statuses of last 8 commands
code, data = req(f"{su}/rest/v1/{TBL}?select=action,status,error,effect_key,issued_at&issued_by=eq.zai-live-test-419203&order=issued_at.desc&limit=8")
print("=== FINAL STATUSES ===")
if code == 200:
    for r in data:
        print(f"  {r['action']:24} {r['status']:10} ek={str(r.get('effect_key'))[:36]} err={str(r.get('error'))[:90]}")

# full FLEET_SET_PROFILE receipt
code, data = req(f"{su}/rest/v1/{TBL}?select=status,receipt&issued_by=eq.zai-live-test-419203&action=eq.FLEET_SET_PROFILE&order=issued_at.desc&limit=1")
if code == 200 and data:
    print("=== FLEET RECEIPT (full) ===")
    print(str(data[0].get("receipt") or "")[:2600].replace("\n", " "))
