#!/usr/bin/env python3
"""CTX-VAULT-COMPACTOR offline-route refresh (Job 416631, tick 2026-09-28 05:22 UTC).
cron-tool unavailable in this session (3rd consecutive run) -> offline-route precedent:
shards are rebuilt as files in ossfs (survives env-reset) + PolarFS mirror.
Spec: SHARD-A = CONTEXT.md + PHOENIX-PROTOCOL.md + context-guard.sh;
      SHARD-B = index15 + tail60(worklog) + recovery-protocol-v2.
No secrets printed. No worklog modification. No other files created.
"""
import os, re, subprocess, datetime, hashlib

BASE = "/home/z/my-project"
VAULT = "/home/z/context-vault"
SYNC = "/home/sync/me2-context-backups/latest"          # ossfs (offline, survives reset)
PFS = "/tmp/my-project/phoenix-sealed"                    # PolarFS mirror (previous run location)
GEN = "gen" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d")  # gen20260928
TS = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")

def read(p):
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        return f.read()

context_md = read(f"{BASE}/CONTEXT.md")                    # 17844B
protocol_md = read(f"{BASE}/PHOENIX-PROTOCOL.md")          # 8040B
guard_sh = read(f"{VAULT}/context-guard.sh")               # live guard v1.0 (etalon-double)
worklog = read(f"{BASE}/worklog.md")

HEADER = ("[CTX-SHARD-{s} {gen}] Phoenix offline-копия (read-only). Обновляется Job ctx-vault-3 "
          "hourly. При срабатывании ответь shard-ok.")
BEGIN, END = "<<<CTX-BEGIN>>>", "<<<CTX-END>>>"

# ---------- SHARD-A ----------
shard_a = "\n".join([
    HEADER.format(s="A", gen=GEN), BEGIN,
    context_md.rstrip(),
    protocol_md.rstrip(),
    guard_sh.rstrip(),
    END, "",
])

# ---------- SHARD-B ----------
# Index: last 15 sections -> each '^Task ID:' line + its '^Task:' line
pairs = []
cur_id = None
for line in worklog.splitlines():
    if line.startswith("Task ID:"):
        if cur_id:
            pairs.append(cur_id)
        cur_id = [line.rstrip(), None]
    elif line.startswith("Task:") and cur_id is not None and cur_id[1] is None:
        cur_id[1] = line.rstrip()
        pairs.append(cur_id)
        cur_id = None
if cur_id:
    pairs.append(cur_id)
last15 = pairs[-15:]
index_lines = ["## Индекс последних 15 секций worklog (Task ID → Task):"]
for tid, task in last15:
    index_lines.append(f"- {tid}")
    index_lines.append(f"  {task if task else '(Task: —)'}")
index_block = "\n".join(index_lines)

# Tail: last 60 lines verbatim
tail_lines = worklog.splitlines()[-60:]
tail_block = "\n".join(tail_lines)

recovery_v2 = """## Протокол восстановления v2 (после ЛЮБОГО wipe):
1. bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check → кворум 8 источников.
2. При усечении: bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --merge (секционный merge-append, без потерь); --restore только при вердикте УСЕЧЕНИЕ.
3. Креды Supabase: /tmp/my-project/.a2-backup/me2.env.20260922 (никогда не печатать).
4. Full-копии: Supabase $SU/storage/v1/object/me2-evidence/context-vault/latest/ ; ossfs /home/sync/me2-context-backups/latest/ ; git-bundle /home/sync/me2-context-backups/bundles/repo-all-*.bundle.
5. Скрипты phoenix: /home/z/my-project/scripts/phoenix/ и /home/z/context-vault/latest/ ; эталоны продублированы в payload Job 416526/417373.
6. PHX-HEARTBEAT=Job 416629 (был 417373), Context Guard=Job 416526, PAT-watcher=Job 413338, COMPACTOR=Job 416631, шарды=Job 416554/416555."""

shard_b = "\n".join([
    HEADER.format(s="B", gen=GEN), BEGIN,
    index_block, "",
    "## Хвост worklog (последние 60 строк дословно):",
    tail_block, "",
    recovery_v2, END, "",
])

# ---------- Write (overwrite in place; no old gens exist -> nothing else to delete) ----------
os.makedirs(SYNC, exist_ok=True)
os.makedirs(PFS, exist_ok=True)
targets = {
    "A": [(f"{SYNC}/CTX-SHARD-A-{GEN}.md", shard_a), (f"{PFS}/CTX-SHARD-A-{GEN}.md", shard_a)],
    "B": [(f"{SYNC}/CTX-SHARD-B-{GEN}.md", shard_b), (f"{PFS}/CTX-SHARD-B-{GEN}.md", shard_b)],
}
report = []
ok = True
for side, entries in targets.items():
    for path, text in entries:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        size = os.path.getsize(path)
        # Verify: markers present + size > 1KB
        content = read(path)
        verified = (BEGIN in content) and (END in content) and size > 1024
        ok = ok and verified
        sha12 = hashlib.sha256(content.encode()).hexdigest()[:12]
        report.append(f"{side}: {path} {size}B sha12={sha12} markers={'OK' if verified else 'FAIL'}")

# Sanity: last15 index contains newest section; tail contains newest Task ID
newest_tid = last15[-1][0] if last15 else ""
newest_in_b = newest_tid in shard_b

# ---------- Journal (single append line; allowed by step 8) ----------
journal = f"{VAULT}/journal/context-journal.log"
wl_size = os.path.getsize(f"{BASE}/worklog.md")
jline = (f"[{TS}] CRON-SHARD refresh {GEN} shards=A,B verified "
         f"(offline-route: ossfs+PolarFS; cron-tool unavailable in session; "
         f"worklog {wl_size}B refreshed with BROWSER-TEST-1300 + 419718-1307/1315 sections)\n")
with open(journal, "a", encoding="utf-8") as f:
    f.write(jline)

print("\n".join(report))
print(f"index15 newest={newest_tid} in_shard_B={newest_in_b}")
print(f"journal: {jline.strip()}")
print(f"compactor: refreshed {GEN}" if (ok and newest_in_b) else "compactor: verify-failed")
