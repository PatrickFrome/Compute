#!/usr/bin/env python3
# sbq.py — Supabase query helper for METAENGINE live browser testing.
# Usage: sbq.py <table> [querystring] [limit] [order]
# Secrets are read from ENVF, never printed.
import json, sys, urllib.request, urllib.parse, os

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
def env():
    su = sj = ""
    with open(ENVF) as f:
        for line in f:
            if line.startswith("SUPABASE_URL="): su = line.strip().split("=",1)[1]
            elif line.startswith("SUPABASE_SERVICE_ROLE_JWT="): sj = line.strip().split("=",1)[1]
    return su.rstrip("/"), sj

def req(url, method="GET", body=None):
    su, sj = env()
    r = urllib.request.Request(url, headers={"apikey": sj, "Authorization": f"Bearer {sj}", "Content-Type": "application/json", "Prefer": "return=representation"})
    if body is not None:
        r.data = json.dumps(body).encode()
    if method != "GET":
        r.get_method = lambda: method
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]
    except Exception as e:
        return 0, str(e)[:200]

if __name__ == "__main__":
    table = sys.argv[1]
    q = sys.argv[2] if len(sys.argv) > 2 else ""
    limit = sys.argv[3] if len(sys.argv) > 3 else "10"
    order = sys.argv[4] if len(sys.argv) > 4 else ""
    url = f"{env()[0]}/rest/v1/{table}?{q}&limit={limit}"
    if order: url += f"&order={order}"
    code, data = req(url)
    print("HTTP", code)
    print(json.dumps(data, ensure_ascii=False, indent=1)[:6000] if not isinstance(data, int) else data)
