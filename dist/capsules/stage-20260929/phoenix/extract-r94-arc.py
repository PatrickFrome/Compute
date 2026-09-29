#!/usr/bin/env python3
# extract-r94-arc.py — selective-port remote-only worklog sections (SYNC-MERGE cutover, Job 419718 @1445)
# Remote line (origin/sandbox/me2-os @1020fd65, R94-ARIA incarnation) is classified §0 as reference-only arc.
# Unique worklog sections are ported into worklog-archive/ (zero history loss); shared IDs keep LOCAL canon.
import subprocess, re, os, json

LOCAL = "/home/z/my-project/worklog.md"
OUT_DIR = "/home/z/my-project/worklog-archive"
OUT = os.path.join(OUT_DIR, "r94-arc-20260928.md")
REMOTE_SHA = subprocess.run(["git", "rev-parse", "origin/sandbox/me2-os"], cwd="/home/z/my-project",
                            capture_output=True, text=True).stdout.strip()[:12]

remote_text = subprocess.run(["git", "show", "origin/sandbox/me2-os:worklog.md"], cwd="/home/z/my-project",
                             capture_output=True, text=True).stdout
local_text = open(LOCAL, encoding="utf-8").read()

SEC = re.compile(r"(?m)^---\s*\nTask ID:\s*(.+?)\s*$")

def sections(text):
    """Return list of (task_id, section_text) in file order; preamble kept as ('', text)."""
    starts = [(m.start(), m.group(1)) for m in SEC.finditer(text)]
    if not starts:
        return []
    pre = text[:starts[0][0]]
    out = []
    for i, (pos, tid) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        out.append((tid, text[pos:end].rstrip() + "\n"))
    return out, pre

rs, _rpre = sections(remote_text)
ls, _lpre = sections(local_text)
local_ids = {tid for tid, _ in ls}
remote_ids = [tid for tid, _ in rs]
remote_unique = []
seen = set()
for tid, body in rs:
    if tid not in local_ids and tid not in seen:
        seen.add(tid)
        remote_unique.append((tid, body))

os.makedirs(OUT_DIR, exist_ok=True)
header = (
    "# WORKLOG ARCHIVE — R94-ARC line (origin/sandbox/me2-os)\n\n"
    f"*Extracted: 2026-09-28, Job 419718 @14:45 SYNC-MERGE cutover. Source: origin/sandbox/me2-os @ `{REMOTE_SHA}`\n"
    "*Classification (PRINCIPAL-DIRECTIVE §0): reference-only arc of a PARALLEL INCARNATION (R94-ARIA line, 2026-09-27);\n"
    "not merged into the live line (no bulk merge §0). Sections below are REMOTE-ONLY (Task IDs absent from canonical worklog.md).\n"
    "Shared Task IDs (both lines) keep the LOCAL canon version in worklog.md. Full immutable history: tag `archive/sandbox-me2-os-r94-arc`.\n\n"
)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(header)
    for tid, body in remote_unique:
        f.write(body.rstrip() + "\n\n")

stats = {
    "remote_sha": REMOTE_SHA,
    "local_sections": len(ls),
    "remote_sections": len(rs),
    "remote_unique_ids": len(remote_unique),
    "shared_ids": len(local_ids & set(remote_ids)),
    "out_file": OUT,
    "out_bytes": os.path.getsize(OUT),
}
json.dump(stats, open("/home/z/my-project/worklog-archive/extract-stats-1445.json", "w"), indent=1)
print(json.dumps(stats, indent=1))
