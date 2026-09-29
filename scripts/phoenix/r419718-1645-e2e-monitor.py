#!/usr/bin/env python3
"""R419718-1645: монитор органического fleet-цикла задачи tk_mul1nth8bomuxl.
Executor (worker.ts → fleetAskHistory) → TASK_DONE → reviewTask (fleetChat) → TASK_REVIEWED.
Read-only DB poll каждые 30s, до 13 мин."""
import sqlite3, time, json, sys

DB = "/home/z/my-project/mini-services/me2-daemon/data/me2.db"
TASK = "tk_mul1nth8bomuxl"
DEADLINE = time.time() + 12 * 60
seen = set()

while time.time() < DEADLINE:
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = c.execute(
        "SELECT seq, ts, type, agent_id, substr(data,1,180) FROM events "
        "WHERE task_id=? OR data LIKE ? ORDER BY seq ASC", (TASK, f"%{TASK}%")).fetchall()
    new = [r for r in rows if r[0] not in seen]
    for r in new:
        seen.add(r[0])
        print(f"[{r[1][11:19]}] #{r[0]} {r[2]} :: {r[4]}", flush=True)
    # статус задачи
    t = c.execute("SELECT status, error, result IS NOT NULL FROM tasks WHERE id=?", (TASK,)).fetchone()
    # review события по задаче (task_id в событии)
    rev = c.execute(
        "SELECT seq, ts, type, substr(data,1,140) FROM events "
        "WHERE type IN ('TASK_REVIEWED','TASK_REVIEW_FAILED') AND data LIKE ? ORDER BY seq DESC LIMIT 1",
        (f"%{TASK}%",)).fetchone()
    c.close()
    if rev and rev[0] not in seen:
        seen.add(rev[0])
        print(f"[{rev[1][11:19]}] #{rev[0]} {rev[2]} :: {rev[3]}", flush=True)
    if t and t[0] in ("COMPLETED", "FAILED", "CANCELLED"):
        print(f"TASK TERMINAL: status={t[0]} error={t[1]} has_result={t[2]}", flush=True)
        if rev:
            print(f"REVIEW FINAL: {rev[2]} :: {rev[3]}", flush=True)
            print("E2E-LOOP-COMPLETE", flush=True)
            sys.exit(0)
        # терминал есть, ревью ещё асинхронно — дать ему 3 мин
        if not rev:
            print("waiting review (async fleetChat ~2-3min)...", flush=True)
    time.sleep(30)
print("MONITOR TIMEOUT (13 min) — фиксирую последнее состояние", flush=True)
c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
t = c.execute("SELECT status, error FROM tasks WHERE id=?", (TASK,)).fetchone()
print(f"FINAL TASK STATE: {t}", flush=True)
