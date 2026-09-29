#!/usr/bin/env python3
"""ME2-TICK-20260928-1724: монитор органического E2E-3 (task Fleet-e2e-3, beacon fleet-e2e-1724.txt).
Read-only SQLite poll: TASK_*/STEP_*/FLEET_* события + статус задачи + beacon-файл.
Early-exit на TASK_DONE/TASK_FAILED. Deadline ~12 мин (fleet-латентность ~2.5-3.5 мин/шаг)."""
import sqlite3, time, glob, sys

DB = "/home/z/my-project/mini-services/me2-daemon/data/me2.db"
TASK = None  # resolve from title
BEACON_GLOB = "/home/z/my-project/me2-workspace/*/fleet-e2e-1724.txt"
DEADLINE = time.time() + 12 * 60
seen = set()

# resolve task id by title
c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
row = c.execute("SELECT id FROM tasks WHERE title LIKE '%Fleet-e2e-3%' ORDER BY rowid DESC LIMIT 1").fetchone()
c.close()
if not row:
    print("TASK-NOT-FOUND"); sys.exit(1)
TASK = row[0]
print(f"watching task={TASK}", flush=True)

while time.time() < DEADLINE:
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = c.execute(
        "SELECT seq, ts, type, substr(data,1,200) FROM events "
        "WHERE (task_id=? OR data LIKE ?) ORDER BY seq ASC",
        (TASK, f"%{TASK}%")).fetchall()
    new = [r for r in rows if r[0] not in seen]
    for r in new:
        seen.add(r[0])
        print(f"[{r[1][11:19]}] #{r[0]} {r[2]} :: {r[3]}", flush=True)
    t = c.execute("SELECT status, error, result FROM tasks WHERE id=?", (TASK,)).fetchone()
    c.close()
    beacons = glob.glob(BEACON_GLOB)
    if beacons:
        for b in beacons:
            try: content = open(b).read().strip()[:120]
            except OSError: content = "(unreadable)"
            print(f"BEACON: {b} -> {content!r}", flush=True)
    if t and t[0] in ("DONE", "FAILED", "ARCHIVED"):
        print(f"TERMINAL: status={t[0]} error={t[1]!r} result={(t[2] or '')[:200]!r}", flush=True)
        break
    time.sleep(45)

print("MONITOR-END", flush=True)
