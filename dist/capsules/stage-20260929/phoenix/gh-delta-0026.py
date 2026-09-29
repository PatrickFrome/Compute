#!/usr/bin/env python3
# gh-delta-0026.py — ME2-TICK-20260929-0026: upstream delta since GITHUB-AUDIT-20260929-0000/0018.
# READ-ONLY, GET-only. Prints PR/branch deltas + repo meta. NO secrets printed (token in memory only).
import json, urllib.request

ENVF = "/home/z/.a2/.github.env"
REPO = "PatrickFrome/Compute"
SINCE = "2026-09-28T16:20:00Z"  # last audit readback (tick 0018 ~16:18Z)

tok = None
for line in open(ENVF):
    if line.startswith("GITHUB_TOKEN_ADMIN="):
        tok = line.split("=", 1)[1].strip()
        break

def get(path, params=""):
    url = f"https://api.github.com/repos/{REPO}{path}" + (f"?{params}" if params else "")
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "me2-ghaudit"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

R = {}
repo = get("")
R["repo"] = {k: repo.get(k) for k in ("default_branch", "pushed_at", "open_issues_count")}

# open PRs sorted by update
prs = get("/pulls", "state=open&sort=updated&direction=desc&per_page=60")
R["open_pr_count_sample"] = len(prs)
R["prs_updated_since"] = [{
    "number": p["number"], "title": p["title"][:90], "head": p["head"]["ref"],
    "base": p["base"]["ref"], "updated_at": p["updated_at"], "state": p["state"],
} for p in prs if p["updated_at"] > SINCE]

# recently closed (merged?) PRs
closed = get("/pulls", "state=closed&sort=updated&direction=desc&per_page=30")
R["prs_closed_since"] = [{
    "number": c["number"], "title": c["title"][:90], "merged_at": c.get("merged_at"),
    "head": c["head"]["ref"], "base": c["base"]["ref"], "closed_at": c["closed_at"],
} for c in closed if (c.get("closed_at") or "") > SINCE]

# branch count delta
brs = []
page = 1
while page <= 8:
    d = get("/branches", f"per_page=100&page={page}")
    brs.extend(b["name"] for b in d)
    if len(d) < 100:
        break
    page += 1
R["branch_count_now"] = len(brs)

# CI runs since
try:
    runs = get("/actions/runs", "per_page=20")
    R["ci_since"] = [{
        "branch": r.get("head_branch"), "status": r.get("status"),
        "conclusion": r.get("conclusion"), "created_at": r.get("created_at"),
        "event": r.get("event"), "title": (r.get("display_title") or "")[:60],
    } for r in runs.get("workflow_runs", []) if (r.get("created_at") or "") > SINCE]
except Exception as e:
    R["ci_since"] = f"error: {e}"

json.dump(R, open("/home/z/my-project/scripts/phoenix/gh-delta-0026-results.json", "w"), indent=1, ensure_ascii=False)
print("repo:", R["repo"])
print("branch_count_now:", R["branch_count_now"], "(audit 2359: 728)")
print("open PRs updated since", SINCE, ":", len(R["prs_updated_since"]))
for p in R["prs_updated_since"]:
    print("  PR#%s [%s->%s] %s upd=%s" % (p["number"], p["head"], p["base"], p["title"][:60], p["updated_at"][:16]))
print("closed/merged since:", len(R["prs_closed_since"]))
for c in R["prs_closed_since"]:
    print("  PR#%s merged=%s [%s->%s] %s" % (c["number"], bool(c["merged_at"]), c["head"], c["base"], c["title"][:60]))
print("CI runs since:", len(R["ci_since"]) if isinstance(R["ci_since"], list) else R["ci_since"])
for r in (R["ci_since"] if isinstance(R["ci_since"], list) else [])[:10]:
    print("  run:", r["branch"], r["status"], r["conclusion"], r["created_at"][:16], "|", r["title"])
