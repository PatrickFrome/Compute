#!/usr/bin/env python3
"""04-verify-restore.py — row-count diff of the restored cluster vs the
evacuation manifest (row-count-manifest-snapshot.json).

Usage:
  python3 04-verify-restore.py <manifest.json> [conninfo]

Exit 0 = all manifest tables match; exit 1 = any mismatch.
Only needs psql on PATH (no pip packages).

Table names from the manifest are passed to psql as bound variables
(psql -v schema=... -v name=..., referenced as :"schema".:"name"), never
interpolated into the SQL string.

Expected drift on hot tables: cron.job_run_details keeps growing from local
job retries/runs; live-write tables (devos_fleet_*, supervisor_sweep,
device enrollment/nonce) will be ahead if the restored backup is newer than
the manifest snapshot. Treat FORWARD drift on those as OK after eyeballing.
"""
import json
import os
import subprocess
import sys

if len(sys.argv) < 2:
    sys.exit("usage: 04-verify-restore.py <manifest.json> [conninfo]")
manifest_path = sys.argv[1]
conninfo = sys.argv[2] if len(sys.argv) > 2 else "host={0} port={1} user={2} dbname={3}".format(
    os.environ.get("PGHOST", "/home/z/my-project/pigsty/rootless/run"),
    os.environ.get("PGPORT", "55432"),
    os.environ.get("PGUSER", "postgres"),
    os.environ.get("PGDATABASE", "postgres"),
)

def q(sql, bindings=None):
    argv = ["psql", conninfo, "-X", "-At", "-v", "ON_ERROR_STOP=1"]
    for name, value in (bindings or {}).items():
        argv += ["-v", f"{name}={value}"]
    # -c sends raw SQL directly to the server and does not expand psql's
    # :"identifier" variables. Read stdin as a psql script to quote bindings.
    argv += ["-f", "-"]
    try:
        r = subprocess.run(argv, input=sql + "\n", capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode != 0:
        return None
    return r.stdout.strip()

manifest = json.load(open(manifest_path))
if isinstance(manifest, dict) and "tables" in manifest:
    manifest = {f"{d.get('schema', 'public')}.{d.get('table', d.get('name'))}":
                int(d.get("count", d.get("row_count", 0))) for d in manifest["tables"]}
elif isinstance(manifest, list):
    manifest = {f"{d.get('schema', 'public')}.{d.get('table', d.get('name'))}":
                int(d.get("count", d.get("row_count", 0))) for d in manifest}

match, mismatch, missing = 0, [], []
invalid_keys = []
for key, expected in manifest.items():
    if not isinstance(key, str) or key.count(".") != 1 or not all(key.split(".")):
        invalid_keys.append(key)
        continue
    schema, name = key.split(".", 1)
    got = q('select count(*) from :"schema".:"name"', {"schema": schema, "name": name})
    if got is None:
        missing.append(key)
    elif got.isdigit() and int(got) == int(expected):
        match += 1
    elif got.isdigit():
        mismatch.append((key, int(expected), int(got)))
    else:
        missing.append(key)

print(f"manifest tables : {len(manifest)}")
print(f"row-count MATCH : {match}")
print(f"MISMATCH        : {len(mismatch)}")
print(f"query errors    : {len(missing)}")
if invalid_keys:
    print(f"invalid keys    : {len(invalid_keys)} (want exactly one non-empty 'schema.table' dot)")
for key, exp, got in mismatch:
    drift = "+" if got > exp else "-"
    print(f"  {key}: manifest={exp} db={got} ({drift}{abs(got - exp)})")
for key in missing[:10]:
    print(f"  MISSING {key}")
for key in invalid_keys[:10]:
    print(f"  INVALID {key!r}")
sys.exit(1 if (mismatch or missing or invalid_keys) else 0)
