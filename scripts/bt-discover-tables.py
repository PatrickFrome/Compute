#!/usr/bin/env python3
"""BROWSER-TEST: discover real table names via Supabase OpenAPI root spec (GET-only)."""
import json, os, re, urllib.request

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

def main():
    env = load_env()
    base = env["SUPABASE_URL"].rstrip("/")
    jwt = env["SUPABASE_SERVICE_ROLE_JWT"]
    url = f"{base}/rest/v1/"
    req = urllib.request.Request(url, method="GET", headers={
        "apikey": jwt, "Authorization": f"Bearer {jwt}", "Accept": "application/openapi+json",
    })
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            spec = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        print(f"[openapi] FAIL: {str(e)[:300]}")
        return
    paths = sorted(spec.get("paths", {}).keys())
    tables = [p.strip("/") for p in paths if p.strip("/")]
    print(f"[openapi] HTTP {r.status}, paths: {len(tables)}")
    # все пути, похожие на наши цели
    pats = ["browser", "supervisor", "mesh", "device", "compute_fabric", "command", "fleet", "agent"]
    hits = [t for t in tables if any(p in t.lower() for p in pats)]
    for t in hits:
        print("  TABLE:", t)
    others = [t for t in tables if t not in hits]
    print(f"[openapi] other tables ({len(others)}):", ", ".join(others[:40]))
    with open("/home/z/my-project/scripts/bt-openapi-tables.json", "w") as f:
        json.dump(tables, f, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
