#!/usr/bin/env python3
# tabs3.py — extract tab ids from TAB_CENSUS receipt.
import json, sys, re
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env, req

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
code, data = req(f"{su}/rest/v1/{TBL}?select=action,status,receipt&issued_by=eq.zai-live-test-419203&action=eq.TAB_CENSUS&order=issued_at.desc&limit=1")
if code != 200: print("HTTP", code); sys.exit(1)
rc = str(data[0].get("receipt") or "")
# tab ids
ids = re.findall(r"tab_[0-9a-f-]{36}", rc)
print("tab ids found:", len(set(ids)))
for i in sorted(set(ids))[:20]: print(" ", i)
# supervisor tab ids specifically
m = re.search(r"'supervisor_tab_ids': \[([^\]]*)\]", rc)
if m: print("SUPERVISOR:", m.group(1))
m2 = re.search(r"'fleet_tab_ids': \[([^\]]*)\]", rc)
if m2: print("FLEET:", m2.group(1))
# check FLEET_STATUS receipt
code2, data2 = req(f"{su}/rest/v1/{TBL}?select=action,status,receipt,error&issued_by=eq.zai-live-test-419203&action=eq.FLEET_STATUS&order=issued_at.desc&limit=1")
if code2 == 200 and data2:
    print("FLEET_STATUS:", data2[0].get("status"))
    print("RC:", str(data2[0].get("receipt") or "")[:900].replace("\n", " "))
    if data2[0].get("error"): print("ERR:", str(data2[0]["error"])[:200])
