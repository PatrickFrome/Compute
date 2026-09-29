#!/usr/bin/env python3
# bmt-m0900b.py — recover M02 TAB_CENSUS full receipt from DB + find session tabs
import json, importlib.util
_spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bmt)

d = json.load(open("/home/z/my-project/scripts/phoenix/browser-test-results-m0900.json"))
m02 = next(r for r in d if r["id"] == "M02")
row = bmt.get_command(m02["command_id"])
rc = row.get("receipt") or {}
res = rc.get("result") or {}
print("top-level keys:", sorted(res.keys()))
tabs = res.get("tabs") or res.get("census") or []
if isinstance(tabs, dict):
    print("census is dict, keys:", sorted(tabs.keys()))
    tabs = tabs.get("tabs") or []
print("n_tabs:", len(tabs))
for t in tabs:
    print("-", t.get("tab_id"), "|", t.get("kind"), "|", t.get("role"), "|", str(t.get("url") or "")[:90])
json.dump(tabs, open("/home/z/my-project/scripts/phoenix/browser-test-results-m0900-tabs.json", "w"))
