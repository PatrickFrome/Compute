#!/usr/bin/env python3
"""BROWSER-TEST: probe Supabase browser-supervisor plane (GET-only). No secrets printed."""
import json, os, sys, urllib.request, urllib.parse

ENV_PATH = "/tmp/my-project/.a2-backup/me2.env.20260922"

def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def sb_get(base, jwt, table, params=None, limit=3, order=None):
    q = {k: v for k, v in (params or {}).items()}
    q["select"] = q.get("select", "*")
    if limit: q["limit"] = str(limit)
    if order: q["order"] = order
    url = f"{base}/rest/v1/{table}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, method="GET", headers={
        "apikey": jwt, "Authorization": f"Bearer {jwt}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:500]
    except Exception as e:
        return -1, str(e)[:300]

def summarize_rows(rows):
    """Compact structural summary: keys + short values, truncate long text."""
    out = []
    if not isinstance(rows, list):
        return out
    for row in rows[:3]:
        d = {}
        for k, v in row.items():
            s = str(v)
            if len(s) > 160: s = s[:160] + f"...({len(str(v))} chars)"
            d[k] = s
        out.append(d)
    return out

def main():
    env = load_env()
    base = env["SUPABASE_URL"].rstrip("/")
    jwt = env["SUPABASE_SERVICE_ROLE_JWT"]
    print(f"[probe] supabase host: {''.join(c if c not in 'ApiKeySeCrEt' else '*' for c in base[:24])}... (masked)")

    candidates = sys.argv[1:] or [
        "browser_supervisor_state",
        "browser_supervisor_command",
        "supervisor_mesh_instance",
        "browser_device",
    ]
    results = {}
    for t in candidates:
        code, body = sb_get(base, jwt, t, limit=2)
        ok = code == 200
        rows = []
        if ok:
            try: rows = json.loads(body)
            except Exception: rows = []
        results[t] = {"code": code, "rows": rows if ok else body[:200]}
        print(f"[probe] table {t}: HTTP {code} {'rows='+str(len(rows)) if ok else ''}")
        if ok:
            for s in summarize_rows(rows):
                print("   ", json.dumps(s, ensure_ascii=False)[:900])
    with open("/home/z/my-project/scripts/bt-probe-out.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
