#!/usr/bin/env python3
# me2-ghaudit-2359.py — ME2-GHAUDIT-20260928-2359: deep GitHub audit (READ-ONLY, GET-only).
# Branches + PRs + CI runs + releases/tags; classification by prefix; NO secrets printed.
import json, os, urllib.request

ENVF = "/home/z/.a2/.github.env"
REPO = "PatrickFrome/Compute"
OUT = "/home/z/my-project/scripts/phoenix/me2-ghaudit-2359-results.json"
API = f"https://api.github.com/repos/{REPO}"

def tok():
    with open(ENVF) as f:
        for line in f:
            if line.startswith("GITHUB_TOKEN_ADMIN="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("no token")

T = tok()

def get(path, params=""):
    url = f"{API}{path}" + (f"?{params}" if params else "")
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {T}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "me2-ghaudit",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode()), dict(r.headers)

def paginate(path, params, cap=500):
    out, page = [], 1
    while len(out) < cap:
        d, h = get(path, f"{params}{'&' if params else ''}per_page=100&page={page}")
        out.extend(d)
        if len(d) < 100:
            break
        page += 1
    return out[:cap]

R = {}

# 1) repo meta
repo, _ = get("")
R["repo"] = {k: repo.get(k) for k in ("full_name", "default_branch", "pushed_at", "size", "open_issues_count", "visibility")}

# 2) branches (all)
brs = paginate("/branches", "", cap=1000)
R["branch_count"] = len(brs)
names = [b["name"] for b in brs]
from collections import Counter
pref = Counter()
for n in names:
    p = n.split("/")[0] if "/" in n else "(root)"
    pref[p] += 1
R["branch_prefixes"] = dict(pref.most_common(30))
R["branch_names_sample"] = names[:200]

# 3) PRs: open + recently updated closed/merged
prs_open = paginate("/pulls", "state=open&sort=updated&direction=desc", cap=200)
R["prs_open"] = [{
    "number": p["number"], "title": p["title"][:110], "state": p["state"],
    "head": p["head"]["ref"], "base": p["base"]["ref"], "draft": p["draft"],
    "updated_at": p["updated_at"], "labels": [l["name"] for l in p.get("labels", [])],
    "mergeable_state": p.get("mergeable_state"),
} for p in prs_open]
closed, _ = get("/pulls", "state=closed&sort=updated&direction=desc&per_page=40")
R["prs_closed_recent"] = [{
    "number": c["number"], "title": c["title"][:110], "merged_at": c.get("merged_at"),
    "head": c["head"]["ref"], "base": c["base"]["ref"], "closed_at": c["closed_at"],
} for c in closed]

# 4) CI workflow runs (recent)
try:
    runs, _ = get("/actions/runs", "per_page=40")
    R["ci_recent"] = [{
        "name": r.get("name"), "head_branch": r.get("head_branch"),
        "status": r.get("status"), "conclusion": r.get("conclusion"),
        "created_at": r.get("created_at"), "event": r.get("event"),
    } for r in runs.get("workflow_runs", [])]
    concl = Counter((r["conclusion"] or r["status"]) for r in R["ci_recent"])
    R["ci_summary"] = dict(concl)
except Exception as e:
    R["ci_recent"] = f"error: {e}"

# 5) releases + tags
rel, _ = get("/releases", "per_page=20")
R["releases"] = [{"tag": x["tag_name"], "name": x["name"], "published_at": x["published_at"],
                  "assets": [a["name"] for a in x.get("assets", [])]} for x in rel]
try:
    tags = paginate("/tags", "", cap=60)
    R["tags_count_sample"] = [t["name"] for t in tags]
except Exception as e:
    R["tags_count_sample"] = f"error: {e}"

# 6) compare: origin/main vs freshest r-line heads (unique mechanisms)
compares = {}
for br in ("work/r107-remove-me2-mission-control-v1", "work/r105-minimal-me2-probe-runtime-v1",
           "work/r104-current-convergence-v1", "release/self-update-ambiguity-live-v2",
           "sandbox/me2-os-capsule"):
    try:
        cmp, _ = get(f"/compare/main...{br}")
        files = [f["filename"] for f in (cmp.get("files") or [])][:25]
        compares[br] = {"ahead_by": cmp.get("ahead_by"), "behind_by": cmp.get("behind_by"),
                        "status": cmp.get("status"), "files_sample": files,
                        "total_commits": cmp.get("total_commits")}
    except Exception as e:
        compares[br] = f"error: {e}"
R["compare_main_vs"] = compares

json.dump(R, open(OUT, "w"), indent=1, ensure_ascii=False)
# concise stdout
print("repo:", R["repo"])
print("branch_count:", R["branch_count"])
print("prefixes:", json.dumps(R["branch_prefixes"], ensure_ascii=False))
print("open PRs:", len(R["prs_open"]))
for p in R["prs_open"][:12]:
    print("  PR#%s [%s -> %s] %s upd=%s merged_state=%s" % (p["number"], p["head"], p["base"], p["title"][:70], p["updated_at"][:16], p["mergeable_state"]))
print("closed-PR recent:", len(R["prs_closed_recent"]), "; merged:", sum(1 for c in R["prs_closed_recent"] if c["merged_at"]))
print("ci_summary:", R.get("ci_summary"))
for r in (R.get("ci_recent") or [])[:8]:
    if isinstance(r, dict):
        print("  run:", r["head_branch"], r["status"], r["conclusion"], r["created_at"][:16])
print("releases:", [(x["tag"], x["published_at"][:10] if x["published_at"] else None, len(x["assets"])) for x in R["releases"]])
for k, v in compares.items():
    print("compare main...", k, "->", v if isinstance(v, str) else {kk: v[kk] for kk in ("ahead_by", "behind_by", "status")}, (v.get("files_sample", [])[:6] if isinstance(v, dict) else ""))
