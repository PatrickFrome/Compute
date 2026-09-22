// ME2 CORE — deterministic single-writer engine (M1).
// Lessons encoded from the legacy system audit:
//  - ONE owner of state (no multi-writer jsonb merges)  → SQLite WAL + in-memory fold
//  - Local command bus (µs, not 4s DB polls)            → lane scheduler + budget
//  - No AMBIGUOUS class (single writer, effect journal) → write-ahead intent events
//  - Hash-chained event log as source of truth          → tamper-evident journal
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "./schema";
import { ACTIONS, ACTION_MAP, BUDGET, LANE_PRIORITY, type Lane } from "./actions";
import {
  WORKTREE_ROOT,
  createWorktree,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  repoHead,
  type WorktreeRow,
} from "./worktrees";
import { Mirror, type MirrorStatus } from "./mirror";

const VERSION = "0.1.0";
const ROLES = ["PLANNER", "IMPLEMENTER", "RESEARCHER", "CRITIC", "FALSIFIER", "INTEGRATOR"];
const TICK_MS = 250;
const LEASE_MS = 45_000;
const WORKER_LOST_MS = 20_000;
const FLEET_MAX = 12;
const FLEET_WARM = 1;
const FLEET_BURST = 8;

const now = () => Date.now();
const short = (s: string) => s.slice(0, 12);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface CommandRow {
  id: string;
  action: string;
  lane: Lane;
  status: "PENDING" | "LEASED" | "COMPLETED" | "FAILED";
  payload: string;
  result: string | null;
  error: string | null;
  issued_by: string;
  cost: number;
  created_at: number;
  leased_at: number | null;
  completed_at: number | null;
}

export class Me2Core {
  db: Database;
  private mirror: Mirror;
  private lastHash = "";
  private dirty = true;
  private onDirtyCb: (() => void) | null = null;
  private lastBroadcast = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = now();
  private budgetWindow: number[] = []; // timestamps of spent cost units
  private gates: Map<string, boolean> = new Map([
    ["enrollment", true],
    ["downloads", true],
    ["self_update", true],
  ]);
  private supervisorMode: "ARMED" | "DISARMED" = "ARMED";
  private fleetProfile = "BALANCED";
  private updateState: { status: string; version: string; checkedAt: number } = {
    status: "UP_TO_DATE",
    version: VERSION,
    checkedAt: 0,
  };
  private downloads: Map<string, { url: string; state: string; bytes: number }> = new Map();
  private tabs: Map<
    string,
    { id: string; url: string; title: string; kind: "USER" | "FLEET"; state: string; openedAt: number }
  > = new Map();

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    migrate(this.db);
    this.mirror = new Mirror(this.db);
    const last = this.db.query("SELECT hash FROM events ORDER BY id DESC LIMIT 1").get() as
      | { hash: string }
      | undefined;
    this.lastHash = last?.hash ?? "";
    this.seedIfEmpty();
    this.openTab("https://chat.z.ai/", "Z.ai — root", "USER");
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // M5 groundwork: periodic evidence flush (async, never blocks the tick)
    this.mirrorTimer = setInterval(() => {
      void this.mirror.flush().catch(() => {});
    }, 15_000);
    if (typeof this.mirrorTimer.unref === "function") this.mirrorTimer.unref();
  }

  private mirrorTimer: ReturnType<typeof setInterval> | null = null;

  // ---------- event log (hash-chained, append-only) ----------
  private emit(type: string, subject: string | null, payload: Record<string, unknown>, actor = "daemon"): void {
    const ts = now();
    const body = JSON.stringify({ type, subject, payload, actor, ts });
    const hash = sha(this.lastHash + body);
    const res = this.db
      .query("INSERT INTO events (ts, type, actor, subject, payload, prev_hash, hash) VALUES (?,?,?,?,?,?,?)")
      .run(ts, type, actor, subject, JSON.stringify(payload), this.lastHash, hash);
    const eventId = Number(res.lastInsertRowid);
    this.lastHash = hash;
    this.dirty = true;
    this.mirror.stage(eventId, JSON.stringify({ id: eventId, ts, type, actor, subject, payload }));
  }

  eventsTail(limit = 60, since = 0): Array<Record<string, unknown>> {
    const rows = this.db
      .query("SELECT id, ts, type, actor, subject, payload, hash FROM events WHERE id > ? ORDER BY id DESC LIMIT ?")
      .all(since, limit) as Array<Record<string, unknown>>;
    return rows;
  }

  // ---------- command bus ----------
  submit(input: { action: string; payload?: Record<string, unknown>; issued_by?: string; idempotency_key?: string }): {
    command_id: string;
    status: string;
    result?: unknown;
    error?: string;
  } {
    const spec = ACTION_MAP.get(input.action);
    if (!spec) {
      throw new Error(`UNKNOWN_ACTION:${input.action}`);
    }
    const id = "cmd_" + randomUUID().replace(/-/g, "").slice(0, 16);
    const idem = input.idempotency_key ?? `${input.action}:${randomUUID().slice(0, 8)}`;
    if (input.idempotency_key) {
      const dup = this.db.query("SELECT id, status FROM commands WHERE idempotency_key=?").get(input.idempotency_key) as
        | { id: string; status: string }
        | undefined;
      if (dup) return { command_id: dup.id, status: dup.status + " (idempotent-replay)" };
    }
    this.db
      .query(
        "INSERT INTO commands (id, action, lane, status, payload, idempotency_key, issued_by, cost, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        spec.action,
        spec.lane,
        "PENDING",
        JSON.stringify(input.payload ?? {}),
        idem,
        input.issued_by ?? "operator",
        spec.cost,
        now(),
      );
    this.emit("COMMAND_SUBMITTED", id, { action: spec.action, lane: spec.lane }, input.issued_by ?? "operator");
    this.processQueue();
    const row = this.db.query("SELECT status, result, error FROM commands WHERE id=?").get(id) as CommandRow;
    return {
      command_id: id,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error ?? undefined,
    };
  }

  private budgetUsed(): number {
    const cutoff = now() - BUDGET.windowMs;
    this.budgetWindow = this.budgetWindow.filter((t) => t > cutoff);
    return this.budgetWindow.length;
  }

  private processQueue(): void {
    const pending = this.db
      .query("SELECT * FROM commands WHERE status='PENDING' ORDER BY created_at ASC")
      .all() as CommandRow[];
    pending.sort((a, b) => LANE_PRIORITY[a.lane] - LANE_PRIORITY[b.lane] || a.created_at - b.created_at);
    for (const cmd of pending) {
      const spec = ACTION_MAP.get(cmd.action);
      if (!spec) continue;
      if (this.supervisorMode === "DISARMED" && spec.lane !== "EMERGENCY") {
        this.failCommand(cmd, "SUPERVISOR_DISARMED");
        continue;
      }
      if (spec.lane === "TAB_MUTATION" || spec.lane === "GLOBAL_MUTATION") {
        if (this.budgetUsed() + spec.cost > BUDGET.limit) {
          this.failCommand(cmd, "supervisor_action_budget_exceeded");
          continue;
        }
        for (let i = 0; i < spec.cost; i++) this.budgetWindow.push(now());
        // write-ahead effect intent (no AMBIGUOUS by construction: single writer)
        this.emit("EFFECT_INTENT", cmd.id, { action: cmd.action, lane: spec.lane });
      }
      this.db.query("UPDATE commands SET status='LEASED', leased_at=? WHERE id=?").run(now(), cmd.id);
      this.emit("COMMAND_LEASED", cmd.id, { action: cmd.action });
      const t0 = now();
      try {
        const result = this.execute(cmd.action, JSON.parse(cmd.payload || "{}"));
        const dt = now() - t0;
        this.db
          .query("UPDATE commands SET status='COMPLETED', result=?, completed_at=? WHERE id=?")
          .run(JSON.stringify(result ?? {}), now(), cmd.id);
        this.emit("EFFECT_RESULT", cmd.id, { action: cmd.action, outcome: "COMPLETED", ms: dt });
        this.dirty = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.db
          .query("UPDATE commands SET status='FAILED', error=?, completed_at=? WHERE id=?")
          .run(msg, now(), cmd.id);
        this.emit("EFFECT_RESULT", cmd.id, { action: cmd.action, outcome: "FAILED", error: msg });
        this.dirty = true;
      }
    }
  }

  private failCommand(cmd: CommandRow, error: string): void {
    this.db
      .query("UPDATE commands SET status='FAILED', error=?, completed_at=? WHERE id=?")
      .run(error, now(), cmd.id);
    this.emit("EFFECT_RESULT", cmd.id, { action: cmd.action, outcome: "FAILED", error });
    this.dirty = true;
  }

  // ---------- executors (M1: local meta real, browser surface simulated) ----------
  private openTab(url: string, title: string, kind: "USER" | "FLEET"): string {
    const id = "tab_" + randomUUID().replace(/-/g, "").slice(0, 8);
    this.tabs.set(id, { id, url, title, kind, state: "ACTIVE", openedAt: now() });
    this.emit("TAB_OPENED", id, { url, kind });
    return id;
  }

  private execute(action: string, p: Record<string, unknown>): unknown {
    switch (action) {
      case "POLL":
        return { ok: true, uptimeMs: now() - this.startedAt };
      case "TAB_CENSUS":
        return { tabs: [...this.tabs.values()].map((t) => ({ id: short(t.id), url: t.url, kind: t.kind, state: t.state })) };
      case "FLEET_STATUS":
        return this.fleetStatus();
      case "SYSTEM_TELEMETRY":
        return { memoryMB: Math.round(process.memoryUsage.rss() / 1048576), uptimeMs: now() - this.startedAt, tick: TICK_MS };
      case "CONTROL_LATENCY_STATUS":
        return this.latencyStats();
      case "CONTROL_CAPABILITIES":
        return { actions: ACTIONS.length, lanes: Object.keys(LANE_PRIORITY), budget: BUDGET };
      case "GATE_STATUS":
        return Object.fromEntries(this.gates);
      case "GATE_ENABLE":
        this.gates.set(String(p.name), true);
        return { gate: p.name, enabled: true };
      case "GATE_DISABLE":
        this.gates.set(String(p.name), false);
        return { gate: p.name, enabled: false };
      case "GATE_ENABLE_ALL":
        for (const k of this.gates.keys()) this.gates.set(k, true);
        return { all: true };
      case "GATE_DISABLE_ALL":
        for (const k of this.gates.keys()) this.gates.set(k, false);
        return { all: false };
      case "ARM":
        this.supervisorMode = "ARMED";
        return { mode: this.supervisorMode };
      case "DISARM":
      case "SET_SUPERVISOR_MODE_OFF":
        this.supervisorMode = "DISARMED";
        return { mode: this.supervisorMode };
      case "SET_SUPERVISOR_MODE":
        this.supervisorMode = p.mode === "OFF" ? "DISARMED" : "ARMED";
        return { mode: this.supervisorMode };
      case "NEW_TAB":
        return { tab_id: short(this.openTab(String(p.url ?? "https://example.com"), String(p.title ?? "New tab"), (p.kind as "USER" | "FLEET") ?? "USER")) };
      case "CLOSE_TAB": {
        const id = String(p.tab_id ?? "");
        const found = [...this.tabs.keys()].find((k) => k.startsWith(id));
        if (!found) throw new Error("TAB_NOT_FOUND");
        const t = this.tabs.get(found)!;
        this.tabs.delete(found);
        this.emit("TAB_CLOSED", found, { url: t.url });
        const w = this.db.query("SELECT id FROM workers WHERE task_id IS NULL AND state='RUNNING'").get();
        void w;
        return { closed: short(found) };
      }
      case "NAVIGATE": {
        const id = String(p.tab_id ?? "");
        const found = [...this.tabs.keys()].find((k) => k.startsWith(id));
        if (!found) throw new Error("TAB_NOT_FOUND");
        const t = this.tabs.get(found)!;
        t.url = String(p.url ?? t.url);
        this.emit("TAB_NAVIGATED", found, { url: t.url });
        return { tab: short(found), url: t.url };
      }
      case "SELECT_TAB":
      case "RELOAD":
      case "BACK":
      case "FORWARD":
      case "SCROLL":
      case "SEMANTIC_FOCUS":
      case "SEMANTIC_TYPE":
      case "TYPED_CLICK":
      case "PRESS_KEY":
      case "STOP_GENERATION":
        return { ok: true, simulated: true, target: p.tab_id ?? null };
      case "CAPTURE":
        return { frame: "metaengine.native-browser.perception.v1", targets: 0, note: "M1 skeleton: CDP adapter pending" };
      case "READ_TRANSCRIPT":
        return { transcript: "", note: "M1 skeleton" };
      case "FLEET_RECONCILE":
        return this.reconcileFleet(p);
      case "FLEET_SET_PROFILE":
        this.fleetProfile = String(p.profile ?? "BALANCED");
        this.emit("FLEET_PROFILE_SET", null, { profile: this.fleetProfile });
        return { profile: this.fleetProfile };
      case "DOWNLOAD_FILE": {
        const id = "dl_" + randomUUID().replace(/-/g, "").slice(0, 8);
        this.downloads.set(id, { url: String(p.url ?? ""), state: "ACTIVE", bytes: 0 });
        this.emit("DOWNLOAD_STARTED", id, { url: p.url });
        return { download_id: id };
      }
      case "DOWNLOAD_CANCEL":
        this.downloads.delete(String(p.download_id ?? ""));
        return { cancelled: true };
      case "DOWNLOAD_STATUS":
        return { downloads: [...this.downloads.entries()].map(([id, d]) => ({ id, ...d })) };
      case "SELF_UPDATE_CHECK":
        this.updateState = { status: "UP_TO_DATE", version: VERSION, checkedAt: now() };
        return this.updateState;
      case "SELF_UPDATE_APPLY":
        return { applied: false, reason: "M1 skeleton — Tauri updater in M3" };
      case "SELF_UPDATE_STATUS":
        return this.updateState;
      case "DEV_PLANE_STATUS":
        return { plane: "development", status: "ACTIVE", version: VERSION };
      case "DEV_PLANE_HEALTH":
        return { healthy: true };
      case "DEV_PLANE_CAPABILITIES":
        return { capabilities: ["worktree", "tree-sitter", "lsp"] };
      case "DEV_PLANE_PROCESS_METRICS":
        return { rssMB: Math.round(process.memoryUsage.rss() / 1048576) };
      case "DEV_PLANE_REPO_HEAD":
        return { ...repoHead(), note: "M4-lite: local repo head (worktrees active)" };
      case "WORKTREE_LIST":
        return { ...this.worktreeSnapshot() };
      case "WORKTREE_CREATE": {
        const r = createWorktree(String(p.name ?? ""));
        this.wtCache.at = 0; // force refresh on next snapshot
        this.emit("WORKTREE_CREATED", r.name, { path: r.path, branch: r.branch });
        return r;
      }
      case "WORKTREE_REMOVE": {
        const r = removeWorktree(String(p.name ?? ""));
        this.wtCache.at = 0;
        this.emit("WORKTREE_REMOVED", r.removed, { path: r.path });
        return r;
      }
      case "WORKTREE_PRUNE": {
        const r = pruneWorktrees();
        this.wtCache.at = 0;
        this.emit("WORKTREE_PRUNED", null, r);
        return r;
      }
      case "TASK_GET": {
        const prefix = String(p.task_id ?? "");
        const row = this.db
          .query("SELECT * FROM tasks WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1")
          .get(prefix + "%") as Record<string, unknown> | undefined;
        if (!row) throw new Error("TASK_NOT_FOUND:" + prefix);
        return { ...row, result: row.result ? safeParse(String(row.result)) : null };
      }
      case "MIRROR_STATUS":
        return this.mirrorStatus();
      case "MIRROR_FLUSH": {
        void this.mirror.flush().catch(() => {});
        return { kicked: true, status: this.mirrorStatus() };
      }
      case "PROCESS_CENSUS":
        return { processes: 1, kind: "bun-daemon" };
      case "PROCESS_EVENTS":
        return { events: this.eventsTail(10) };
      case "SEMANTIC_CENSUS":
        return { surfaces: this.tabs.size };
      case "SEMANTIC_EVENTS":
        return { events: this.eventsTail(10) };
      case "CAPTURE_VIEW":
        return { note: "M1 skeleton: screencast pending (CDP)" };
      case "DEVELOPER_EMERGENCY_UPDATE":
        return { accepted: true, note: "emergency lane honored" };
      default:
        throw new Error("NO_EXECUTOR:" + action);
    }
  }

  // ---------- fleet / workers / tasks ----------
  private seedIfEmpty(): void {
    const c = this.db.query("SELECT COUNT(*) AS n FROM tasks").get() as { n: number };
    if (c.n > 0) return;
    const seeds = [
      { title: "Port CDP pipe adapter from browser-compute", role: "IMPLEMENTER", kind: "API" },
      { title: "Worktree workspace manager: spec + EARS", role: "PLANNER", kind: "API" },
      { title: "Code graph schema (tree-sitter symbols)", role: "RESEARCHER", kind: "API" },
      { title: "Evidence bridge: delta contract to Supabase", role: "INTEGRATOR", kind: "API" },
      { title: "Mission Control console theme polish", role: "CRITIC", kind: "API" },
      { title: "Falsify: budget bypass attack on lane scheduler", role: "FALSIFIER", kind: "API" },
    ];
    for (const s of seeds) {
      this.db
        .query("INSERT INTO tasks (id, title, spec, role, kind, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .run("tsk_" + randomUUID().replace(/-/g, "").slice(0, 12), s.title, "", s.role, s.kind, "READY", now(), now());
    }
    this.emit("TASKS_SEEDED", null, { count: seeds.length });
  }

  private liveWorkers(): Array<{ id: string; role: string; kind: string; state: string; task_id: string | null; heartbeat_at: number }> {
    return this.db
      .query("SELECT id, role, kind, state, task_id, heartbeat_at FROM workers WHERE state NOT IN ('RETIRED','LOST')")
      .all() as Array<{ id: string; role: string; kind: string; state: string; task_id: string | null; heartbeat_at: number }>;
  }

  private planTarget(): number {
    const counts = this.db
      .query("SELECT state, COUNT(*) AS n FROM tasks WHERE state IN ('READY','LEASED','RUNNING') GROUP BY state")
      .all() as Array<{ state: string; n: number }>;
    const ready = counts.find((c) => c.state === "READY")?.n ?? 0;
    const running = counts.filter((c) => c.state !== "READY").reduce((a, c) => a + c.n, 0);
    const live = this.liveWorkers().length;
    const demand = ready + running;
    return Math.max(FLEET_WARM, Math.min(Math.max(live, FLEET_WARM) + Math.min(ready, FLEET_BURST), FLEET_WARM + demand, FLEET_MAX));
  }

  private reconcileFleet(p: Record<string, unknown>): unknown {
    const before = this.liveWorkers().length;
    const target = typeof p.target_agents === "number" ? p.target_agents : this.planTarget();
    const active = p.active === false ? false : true;
    let spawned = 0;
    let retired = 0;
    if (active) {
      const live = this.liveWorkers();
      for (let i = live.length; i < target; i++) {
        const role = ROLES[i % ROLES.length];
        const id = "wrk_" + randomUUID().replace(/-/g, "").slice(0, 12);
        this.db
          .query("INSERT INTO workers (id, role, kind, state, generation, created_at, heartbeat_at) VALUES (?,?,?,?,?,?,?)")
          .run(id, role, "API", "IDLE", 1, now(), now());
        this.emit("WORKER_REGISTERED", id, { role, kind: "API" });
        spawned++;
      }
      const idle = this.liveWorkers().filter((w) => w.state === "IDLE");
      for (let i = live.length; i > target && idle.length > 0; i--) {
        const w = idle.pop()!;
        this.db.query("UPDATE workers SET state='RETIRED' WHERE id=?").run(w.id);
        this.emit("WORKER_RETIRED", w.id, { role: w.role });
        retired++;
      }
    }
    return { before, target, spawned, retired };
  }

  private tick(): void {
    const t = now();
    // heartbeats
    for (const w of this.liveWorkers()) {
      if (t - w.heartbeat_at > WORKER_LOST_MS && w.state !== "RUNNING") {
        this.db.query("UPDATE workers SET state='LOST' WHERE id=?").run(w.id);
        this.emit("WORKER_LOST", w.id, { role: w.role });
        this.dirty = true;
      }
    }
    // expire leases
    const leased = this.db
      .query("SELECT id, worker_id FROM tasks WHERE state='LEASED' AND updated_at < ?")
      .all(t - LEASE_MS) as Array<{ id: string; worker_id: string | null }>;
    for (const task of leased) {
      this.db.query("UPDATE tasks SET state='READY', worker_id=NULL, updated_at=? WHERE id=?").run(t, task.id);
      if (task.worker_id)
        this.db.query("UPDATE workers SET state='IDLE', task_id=NULL WHERE id=?").run(task.worker_id);
      this.emit("TASK_LEASE_EXPIRED", task.id, {});
      this.dirty = true;
    }
    // finish running tasks (deterministic duration from id hash)
    const running = this.db
      .query("SELECT t.id AS tid, t.title, t.kind, t.worker_id AS wid, t.updated_at AS started FROM tasks t WHERE t.state='RUNNING'")
      .all() as Array<{ tid: string; title: string; kind: string; wid: string; started: number }>;
    for (const r of running) {
      const h = parseInt(sha(r.tid).slice(0, 6), 16);
      const dur = (r.kind === "PLATFORM" ? 9000 : 4500) + (h % 5000);
      if (t - r.started >= dur) {
        const failed = h % 8 === 0;
        const result = failed
          ? null
          : JSON.stringify({ summary: `Completed: ${r.title}`, artifact: `me2://artifact/${r.tid}`, ms: dur });
        this.db
          .query("UPDATE tasks SET state=?, result=?, error=?, updated_at=? WHERE id=?")
          .run(failed ? "FAILED" : "COMPLETED", result, failed ? "simulated_execution_error" : null, t, r.tid);
        if (r.wid) this.db.query("UPDATE workers SET state='IDLE', task_id=NULL WHERE id=?").run(r.wid);
        this.emit(failed ? "TASK_FAILED" : "TASK_COMPLETED", r.tid, { worker: short(r.wid ?? ""), ms: dur });
        this.dirty = true;
      }
    }
    // dispatch READY → idle workers (role match, generation-fenced single writer)
    const ready = this.db
      .query("SELECT id, role, kind FROM tasks WHERE state='READY' ORDER BY created_at ASC LIMIT 8")
      .all() as Array<{ id: string; role: string; kind: string }>;
    for (const task of ready) {
      const worker = this.db
        .query("SELECT id FROM workers WHERE state='IDLE' AND role=? LIMIT 1")
        .get(task.role) as { id: string } | undefined;
      if (!worker) continue;
      this.db.query("UPDATE tasks SET state='LEASED', worker_id=?, updated_at=? WHERE id=?").run(worker.id, t, task.id);
      this.db.query("UPDATE workers SET state='RUNNING', task_id=? WHERE id=?").run(task.id, worker.id);
      this.emit("TASK_LEASED", task.id, { worker: short(worker.id), role: task.role });
      this.db.query("UPDATE tasks SET state='RUNNING', updated_at=? WHERE id=?").run(t, task.id);
      this.emit("TASK_RUNNING", task.id, {});
      this.dirty = true;
    }
    // elastic governor: drift fleet toward planTarget by ±1 per tick
    const target = this.planTarget();
    const live = this.liveWorkers().length;
    if (live < target) {
      const role = ROLES[live % ROLES.length];
      const id = "wrk_" + randomUUID().replace(/-/g, "").slice(0, 12);
      this.db
        .query("INSERT INTO workers (id, role, kind, state, generation, created_at, heartbeat_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, role, "API", "IDLE", 1, t, t);
      this.emit("WORKER_REGISTERED", id, { role, kind: "API", governor: true });
      this.dirty = true;
    } else if (live > target) {
      const idle = this.liveWorkers().filter((w) => w.state === "IDLE").pop();
      if (idle) {
        this.db.query("UPDATE workers SET state='RETIRED' WHERE id=?").run(idle.id);
        this.emit("WORKER_RETIRED", idle.id, { role: idle.role, governor: true });
        this.dirty = true;
      }
    }
    // heartbeat refresh for alive workers
    this.db.query("UPDATE workers SET heartbeat_at=? WHERE state IN ('IDLE','RUNNING','CLAIMING')").run(t);
    if (this.dirty) this.onDirtyCb?.();
  }

  // ---------- observability ----------
  private wtCache: { at: number; rows: WorktreeRow[]; error?: string } = { at: 0, rows: [] };

  worktreeSnapshot(): { root: string; worktrees: WorktreeRow[]; error?: string } {
    if (now() - this.wtCache.at > 3000) {
      const r = listWorktrees();
      this.wtCache = { at: now(), rows: r.worktrees, error: r.error };
    }
    return { root: WORKTREE_ROOT, worktrees: this.wtCache.rows, error: this.wtCache.error };
  }

  mirrorStatus(): MirrorStatus {
    return this.mirror.status();
  }

  private latencyStats(): Record<string, number> {
    const rows = this.db
      .query("SELECT created_at, completed_at FROM commands WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 200")
      .all() as Array<{ created_at: number; completed_at: number }>;
    const lats = rows.map((r) => r.completed_at - r.created_at).sort((a, b) => a - b);
    const p = (q: number) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(q * lats.length))] : 0);
    return { p50: p(0.5), p99: p(0.99), n: lats.length };
  }

  private fleetStatus(): Record<string, unknown> {
    const workers = this.liveWorkers();
    const taskCounts = this.db
      .query("SELECT state, COUNT(*) AS n FROM tasks GROUP BY state")
      .all() as Array<{ state: string; n: number }>;
    return { live: workers.length, target: this.planTarget(), profile: this.fleetProfile, tasks: Object.fromEntries(taskCounts.map((c) => [c.state, c.n])) };
  }

  snapshot(): Record<string, unknown> {
    const workers = this.db
      .query("SELECT id, role, kind, state, task_id, heartbeat_at FROM workers ORDER BY created_at DESC LIMIT 40")
      .all() as Array<Record<string, unknown>>;
    const tasks = this.db
      .query("SELECT id, title, spec, role, kind, state, worker_id, created_at, updated_at, result, error FROM tasks ORDER BY updated_at DESC LIMIT 60")
      .all() as Array<Record<string, unknown>>;
    const pendingByLane = this.db
      .query("SELECT lane, COUNT(*) AS n FROM commands WHERE status='PENDING' GROUP BY lane")
      .all() as Array<{ lane: string; n: number }>;
    const cmdStats = this.db
      .query("SELECT status, COUNT(*) AS n FROM commands GROUP BY status")
      .all() as Array<{ status: string; n: number }>;
    const evCount = this.db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    const gen = this.db.query("SELECT value FROM meta WHERE key='generation'").get() as { value: string } | undefined;
    return {
      v: "me2.snapshot.v1",
      ts: now(),
      uptimeMs: now() - this.startedAt,
      version: VERSION,
      generation: gen ? Number(gen.value) : 1,
      supervisor: { mode: this.supervisorMode, profile: this.fleetProfile, gates: Object.fromEntries(this.gates), update: this.updateState },
      health: { daemon: "UP", storage: "sqlite/WAL", eventLog: evCount.n, lastHash: short(this.lastHash) },
      fleet: this.fleetStatus(),
      workers: workers.map((w) => ({ ...w, id: short(String(w.id)), task_id: w.task_id ? short(String(w.task_id)) : null, hbAgo: now() - Number(w.heartbeat_at) })),
      tasks: tasks.map((t) => ({ ...t, id: short(String(t.id)), worker_id: t.worker_id ? short(String(t.worker_id)) : null, ageMs: now() - Number(t.created_at) })),
      tabs: [...this.tabs.values()].map((t) => ({ id: short(t.id), url: t.url, title: t.title, kind: t.kind, state: t.state })),
      queue: {
        pending: pendingByLane.reduce((a, c) => a + c.n, 0),
        byLane: Object.fromEntries(pendingByLane.map((c) => [c.lane, c.n])),
        budget: { used: this.budgetUsed(), limit: BUDGET.limit, windowMs: BUDGET.windowMs },
      },
      worktrees: this.worktreeSnapshot(),
      mirror: this.mirrorStatus(),
      stats: { commands: Object.fromEntries(cmdStats.map((c) => [c.status, c.n])), latency: this.latencyStats() },
      events: this.eventsTail(40).map((e) => ({ ...e, hash: short(String(e.hash)), payload: safeParse(String(e.payload)) })),
      actions: ACTIONS.map((a) => ({ action: a.action, lane: a.lane, cost: a.cost, desc: a.desc })),
    };
  }

  onDirty(cb: () => void): void {
    this.onDirtyCb = cb;
    setInterval(() => {
      if (this.dirty && now() - this.lastBroadcast > 120) {
        this.dirty = false;
        this.lastBroadcast = now();
        this.onDirtyCb?.();
      }
    }, 120);
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
