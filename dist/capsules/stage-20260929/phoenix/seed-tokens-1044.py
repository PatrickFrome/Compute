#!/usr/bin/env python3
# seed-tokens-1044.py — seed daemon token vault (R47/ME40) with Supabase creds from me2.env.
# Values are read from env file at runtime and sent to localhost:3041 ONLY; never printed/logged.
import json, subprocess, urllib.request

env = {}
for line in open("/tmp/my-project/.a2-backup/me2.env.20260922"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

SEEDS = [("SUPABASE_URL", "SUPABASE_URL"),
         ("SUPABASE_SERVICE_ROLE_JWT", "SUPABASE_SERVICE_ROLE_JWT"),
         ("SUPABASE_JWT_SECRET", "SUPABASE_JWT_SECRET")]

for name, key in SEEDS:
    val = env.get(key, "")
    if not val:
        print(f"{name}: SKIP (no value in me2.env)")
        continue
    body = json.dumps({"op": "set", "name": name, "value": val}).encode()
    req = urllib.request.Request("http://localhost:3041/tokens", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.loads(r.read())
        print(f"{name}: set ok={resp.get('ok', False)}")
    except Exception as e:
        print(f"{name}: FAIL {type(e).__name__}")

# verify counts only (no values)
with urllib.request.urlopen("http://localhost:3041/tokens", timeout=10) as r:
    st = json.loads(r.read()).get("status", {})
print("vault:", f"{st.get('total')}/{st.get('known_total')}", "missing:", st.get("known_missing"))
