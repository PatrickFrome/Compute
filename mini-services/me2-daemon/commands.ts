/**
 * ME2 Command Bus — единая точка записи состояния (single-writer principle).
 * REST/WS ставят команды; master loop или inline-вызов исполняет их.
 * Полосы: EMERGENCY(0) → CONTROL(1) → MUTATION(5) → READ_ONLY(9). Бюджет: 24 cost/60s.
 */
import {
  db, emit, nowIso, snapshot, createTask, cancelTask, createAgent, deleteAgent,
  tailEvents, eventsByTask, upsertWorker, listAgents, getTask, updateTask,
  setAgentPaused, getAgent, listWorkers, listCommands, enqueueCommand, reapStaleWorkers,
  searchEvents, setAgentModel, setMeta, budgetLimit,
  LANES, LANE_OF, COST_OF, type CommandRow, type TaskRow, type Lane,
} from "./store";
import { WORKSPACE_ROOT } from "./worker";
import { recordSpan } from "./src/otel";
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
type Handler = (payload: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

// ── R11: авто tier-2 LLM-рефлексия при ретрае (квота от infinite-loop) ──────────
// Ресёрч 2026: самокоррекция без квоты → бесконечные платные циклы; двухуровневый гард:
// (1) 1 попытка на задачу за 10 мин, (2) не более 2 in-flight, (3) skip если урок уже есть.
const AUTO_REFLECT_COOLDOWN_MS = 10 * 60_000;
const autoReflectAt = new Map<string, number>();
let autoReflectInFlight = 0;
async function autoReflect(task: TaskRow): Promise<void> {
  const now = Date.now();
  if (now - (autoReflectAt.get(task.id) ?? 0) < AUTO_REFLECT_COOLDOWN_MS) return;
  if (autoReflectInFlight >= 2) return;
  if (task.reflection) {
    try {
      const r = JSON.parse(task.reflection) as { llm?: { lesson?: string } };
      if (r?.llm?.lesson) return; // вербальный урок уже записан (вручную или ранее)
    } catch { /* битый reflection — пробуем сгенерировать */ }
  }
  autoReflectAt.set(task.id, now);
  autoReflectInFlight++;
  try {
    await fetch("http://127.0.0.1:3000/api/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, source: "auto_retry" }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { /* dev-сервер недоступен — оператор нажмёт ✦ вручную */ }
  finally { autoReflectInFlight--; }
}

// ── R13: рандомизированный A/B авто-рефлексии ──────────────────────────────
// Ресёрч (research/2026/R13-AB-REFLEXION-RESEARCH.md): observational-метрика «с уроком vs без»
// смещена (урок получают более сложные задачи); честное измерение эффекта памяти требует
// рандомизации НАЗНАЧЕНИЯ. Детерминированный FNV-1a по id → стабильная группа: повторные
// ретраи того же родителя не перебрасывают его между группами, назначение воспроизводимо
// и навсегда видно в событии TASK_RETRIED (ab_group).
export function abGroupOf(taskId: string): "treatment" | "control" {
  let h = 0x811c9dc5;
  for (let i = 0; i < taskId.length; i++) { h ^= taskId.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 2 === 0 ? "treatment" : "control";
}

// ── agent-browser CLI (ветки браузера как часть шины, v0.6.0) ──────────
const AB_BIN = "/usr/local/bin/agent-browser";
async function ab(args: string[], timeoutMs = 20_000): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn([AB_BIN, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => { try { proc.kill(); } catch { /* уже умер */ } }, timeoutMs);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, out: `${out}\n${err}`.trim() };
}
type BrowserTab = { id: string; title: string; url: string; active: boolean };
function parseTabs(out: string): BrowserTab[] {
  const tabs: BrowserTab[] = [];
  for (const line of out.split("\n")) {
    // формат: «→ [t1] Title - url» (→ = активная)
    const m = line.match(/^\s*(→)?\s*\[(t\d+)\]\s+(.+?)\s+-\s+(\S+)\s*$/);
    if (m) tabs.push({ id: m[2], title: m[3].trim(), url: m[4], active: Boolean(m[1]) });
  }
  return tabs;
}
async function browserTabs(): Promise<BrowserTab[]> {
  const r = await ab(["tab", "list"]);
  return parseTabs(r.out);
}

const handlers: Record<string, Handler> = {
  PING: () => ({ pong: true, ts: nowIso() }),

  STATE_SNAPSHOT: () => snapshot() as unknown as Record<string, unknown>,

  TASK_ENQUEUE: (p) => {
    const title = String(p.title ?? "untitled").slice(0, 200);
    const spec = String(p.spec ?? "").slice(0, 20000);
    if (!spec) throw new Error("spec_required");
    const role = p.role ? String(p.role).toUpperCase().slice(0, 32) : null;
    const maxSteps = Math.min(Math.max(Number(p.max_steps ?? 8), 1), 24);
    const task = createTask({
      id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      title, spec, role, max_steps: maxSteps,
    });
    emit("TASK_QUEUED", { title, role, max_steps: maxSteps, via: "command_bus" }, null, task.id);
    return { task };
  },

  TASK_CANCEL: (p) => {
    const id = String(p.id ?? "");
    cancelTask(id);
    emit("TASK_CANCELLED", { id }, null, id);
    return { id };
  },

  TASK_RETRY: (p) => {
    const id = String(p.id ?? "");
    const orig = getTask(id);
    if (!orig) throw new Error(`task_not_found_${id}`);
    if (orig.status !== "FAILED" && orig.status !== "CANCELLED") {
      throw new Error(`retry_allowed_only_for_FAILED_or_CANCELLED (now ${orig.status})`);
    }
    // политика ретрая: +2 шага (parse-retry и осмотр могут съесть бюджет)
    const maxSteps = Math.min(orig.max_steps + 2, 24);
    const task = createTask({
      id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      title: `${orig.title.slice(0, 180)} ·retry`,
      spec: orig.spec, role: orig.role, max_steps: maxSteps,
      parent_id: orig.id,
    });
    emit("TASK_RETRIED", { from: id, to: task.id, title: task.title, max_steps: maxSteps, has_reflection: Boolean(orig.reflection), ab_group: abGroupOf(id) }, null, task.id);
    // R11: если у родителя нет вербального урока — просим backend сгенерить его,
    // пока потомок ещё в очереди: к моменту lease память будет полной.
    // R13: A/B — авто-урок только treatment-группе; control копит честную базу
    // «без авто-урока» (операторский ✦ остаётся доступен — crossover виден в /metrics)
    if (abGroupOf(id) === "treatment") void autoReflect(orig);
    return { task };
  },

  BUDGET_FLUSH: () => {
    const r = db.query(`UPDATE commands SET status='REJECTED', error='budget_flushed_by_operator', completed_at=? WHERE status='PENDING'`)
      .run(nowIso());
    const flushed = Number(r.changes);
    emit("BUDGET_FLUSHED", { flushed, by: "operator" }, null, null);
    return { flushed };
  },

  EVENTS_EXPORT: (p) => {
    const limit = Math.min(Math.max(Number(p.limit ?? 500), 1), 1000);
    // data ужимаем до 1000 символов: выгрузка должна оставаться валидным JSON-результатом шины
    const events = tailEvents(0, limit).map((e) => ({ ...e, data: e.data.slice(0, 1000) }));
    return { exported_at: nowIso(), count: events.length, events };
  },

  AGENT_SPAWN: (p) => {
    const role = String(p.role ?? "IMPLEMENTER").toUpperCase().slice(0, 32);
    const model = String(p.model ?? "zai:default").slice(0, 64);
    const agent = createAgent(role, model);
    emit("AGENT_CREATED", { role, model }, agent.id, null);
    return { agent };
  },

  AGENT_RETIRE: (p) => {
    const id = String(p.id ?? "");
    deleteAgent(id);
    emit("AGENT_RETIRED", { id }, id, null);
    return { id };
  },

  AGENT_PAUSE: (p) => {
    const id = String(p.id ?? "");
    const a = getAgent(id);
    if (!a) throw new Error(`agent_not_found_${id}`);
    setAgentPaused(id, 1);
    emit("AGENT_PAUSED", { role: a.role }, id, null);
    return { id, paused: true };
  },

  AGENT_RESUME: (p) => {
    const id = String(p.id ?? "");
    const a = getAgent(id);
    if (!a) throw new Error(`agent_not_found_${id}`);
    setAgentPaused(id, 0);
    emit("AGENT_RESUMED", { role: a.role }, id, null);
    return { id, paused: false };
  },

  /** Планировщик: ставит вложенную TASK_ENQUEUE-команду с run_after; дренаж исполнит её вовремя. */
  TASK_SCHEDULE: (p) => {
    const delaySec = Math.max(1, Math.min(Number(p.delay_sec ?? 0), 3600));
    const title = String(p.title ?? "scheduled").slice(0, 200);
    const spec = String(p.spec ?? "").slice(0, 20000);
    if (!spec) throw new Error("spec_required");
    const role = p.role ? String(p.role).toUpperCase().slice(0, 32) : null;
    const maxSteps = Math.min(Math.max(Number(p.max_steps ?? 8), 1), 24);
    const runAfter = Date.now() + delaySec * 1000;
    const r = enqueueCommand({
      action: "TASK_ENQUEUE",
      payload: { title, spec, role, max_steps: maxSteps },
      run_after: runAfter,
      idempotency_key: p.idempotency_key ? String(p.idempotency_key) : null,
    });
    if (!r.ok) throw new Error(r.error);
    emit("TASK_SCHEDULED", { title, delay_sec: delaySec, run_after: runAfter, command: r.command.id }, null, null);
    return { scheduled: true, command_id: r.command.id, run_after: runAfter };
  },

  COMMAND_CANCEL: (p) => {
    const id = String(p.id ?? "");
    const r = db.query(`UPDATE commands SET status='CANCELLED', error='cancelled_by_operator', completed_at=? WHERE id=? AND status='PENDING'`)
      .run(nowIso(), id);
    const cancelled = Number(r.changes) === 1;
    emit("COMMAND_CANCELLED", { id, cancelled }, null, null);
    if (!cancelled) throw new Error(`command_not_pending_${id}`);
    return { id, cancelled };
  },

  WORKERS_LIST: () => ({ workers: listWorkers() }),

  ACTIONS_LIST: () => ({ actions: actionCatalog() }),

  // ── v0.5.0: +6 действий к реестру 47 ───────────────────────────

  TASK_LIST: () => {
    const tasks = db.query(`SELECT id,title,status,role,steps,max_steps,created_at FROM tasks ORDER BY created_at DESC LIMIT 200`).all();
    emit("TASK_LISTED", { count: tasks.length, include_archived: true }, null, null);
    return { count: tasks.length, tasks };
  },

  TASK_ARCHIVE: (p) => {
    const id = String(p.id ?? "");
    const t = getTask(id);
    if (!t) throw new Error(`task_not_found_${id}`);
    if (t.status !== "COMPLETED" && t.status !== "FAILED" && t.status !== "CANCELLED") {
      throw new Error(`archive_allowed_only_for_terminal_states (now ${t.status})`);
    }
    updateTask(id, { status: "ARCHIVED" });
    emit("TASK_ARCHIVED", { id, title: t.title, prev_status: t.status }, null, id);
    return { id, archived: true, prev_status: t.status };
  },

  AGENT_MODEL: (p) => {
    const id = String(p.agent_id ?? p.id ?? "");
    const model = String(p.model ?? "").trim().slice(0, 64);
    if (!model) throw new Error("model_required");
    const a = getAgent(id);
    if (!a) throw new Error(`agent_not_found_${id}`);
    if (a.model === model) return { id, model, unchanged: true };
    setAgentModel(id, model);
    emit("AGENT_MODEL_SET", { id, role: a.role, from: a.model, to: model }, id, null);
    return { id, role: a.role, from: a.model, to: model };
  },

  WORKSPACE_SNAPSHOT: () => {
    const MAX_ENTRIES = 500;
    const files: Array<{ path: string; size: number; mtime: number }> = [];
    let totalBytes = 0;
    let truncated = false;
    const walk = (dir: string, rel: string, depth: number): void => {
      if (files.length >= MAX_ENTRIES) { truncated = true; return; }
      let entries: ReturnType<typeof readdirSync>;
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries.sort()) {
        if (files.length >= MAX_ENTRIES) { truncated = true; return; }
        const r = rel ? `${rel}/${name}` : name;
        const full = join(dir, name);
        let isDir = false;
        try { isDir = statSync(full).isDirectory(); } catch { continue; }
        if (isDir) { if (depth < 4) walk(full, r, depth + 1); continue; }
        try {
          const st = statSync(full);
          files.push({ path: r, size: st.size, mtime: Math.round(st.mtimeMs) });
          totalBytes += st.size;
        } catch { /* файл исчез между readdir и stat — пропускаем */ }
      }
    };
    walk(WORKSPACE_ROOT, "", 0);
    emit("WORKSPACE_SNAPSHOT", { root: WORKSPACE_ROOT, entries: files.length, bytes: totalBytes, truncated }, null, null);
    return { root: WORKSPACE_ROOT, entries: files.length, total_bytes: totalBytes, truncated, files };
  },

  EVENTS_SEARCH: (p) => {
    const q = String(p.q ?? "").trim().slice(0, 100);
    if (!q) throw new Error("q_required");
    const limit = Math.min(Math.max(Number(p.limit ?? 50), 1), 200);
    const hits = searchEvents(q, limit).map((e) => ({ ...e, data: e.data.slice(0, 160) }));
    emit("EVENTS_SEARCHED", { q, hits: hits.length, limit }, null, null);
    return { q, count: hits.length, events: hits };
  },

  BUDGET_ADJUST: (p) => {
    const raw = Number(p.limit ?? p.limit_per_min ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) throw new Error("limit_required");
    const lim = Math.min(Math.max(Math.round(raw), 6), 96);
    const prev = budgetLimit();
    setMeta("budget_limit", String(lim));
    emit("BUDGET_ADJUSTED", { from: prev, to: lim, by: "operator" }, null, null);
    return { from: prev, to: lim };
  },

  // ── v0.6.0: группа «Браузер» (agent-browser CLI) + обслуживание ──

  BROWSER_TABS: async () => {
    const tabs = await browserTabs();
    emit("BROWSER_TABS_LISTED", { count: tabs.length }, null, null);
    return { count: tabs.length, tabs };
  },

  BROWSER_OPEN: async (p) => {
    const url = String(p.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) throw new Error("url_required_http_s");
    await ab(["tab", "new", url]);
    const tabs = await browserTabs();
    const opened = tabs.find((t) => t.url.includes(url.replace(/^https?:\/\//, "").slice(0, 24))) ?? tabs.find((t) => t.active) ?? null;
    emit("BROWSER_TAB_OPENED", { url, tab: opened?.id ?? null, count: tabs.length }, null, null);
    return { opened: true, url, tab: opened, tabs };
  },

  BROWSER_SNAPSHOT: async (p) => {
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["snapshot"]);
    if (r.code !== 0 && !r.out) throw new Error(`agent_browser_failed_code_${r.code}`);
    const text = r.out.slice(0, 8000);
    emit("BROWSER_SNAPSHOT_TAKEN", { tab, chars: text.length }, null, null);
    return { tab: tab ?? "active", truncated: r.out.length > 8000, chars: text.length, snapshot: text };
  },

  BROWSER_SCREENSHOT: async (p) => {
    const rel = String(p.path ?? `br-${Date.now()}.png`).replace(/\.\.\/|^[/.]+/g, "");
    const dir = "/home/z/my-project/download";
    const full = `${dir}/${rel}`;
    const r = await ab(["screenshot", full]);
    let bytes = 0;
    try { bytes = statSync(full).size; } catch { /* файл не появился — ниже ошибка */ }
    if (r.code !== 0 || bytes === 0) throw new Error(`screenshot_failed_code_${r.code}`);
    emit("BROWSER_SCREENSHOT_TAKEN", { path: rel, bytes }, null, null);
    return { path: `download/${rel}`, bytes };
  },

  BROWSER_CLOSE: async (p) => {
    const tab = String(p.tab ?? "").trim();
    if (!tab) throw new Error("tab_required (id | номер | all)");
    if (tab === "all") await ab(["close", "--all"]);
    else await ab(["tab", "close", tab]);
    const tabs = await browserTabs();
    emit("BROWSER_TAB_CLOSED", { tab, remaining: tabs.length }, null, null);
    return { closed: tab, remaining: tabs.length, tabs };
  },

  // ── v0.7.0: браузерная навигация/actuation + workspace (финиш реестра 47/47) ──

  BROWSER_NAVIGATE: async (p) => {
    const url = String(p.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) throw new Error("url_required_http_s");
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["open", url]);
    if (r.code !== 0) throw new Error(`navigate_failed_code_${r.code}: ${r.out.slice(0, 120)}`);
    const tabs = await browserTabs();
    emit("BROWSER_NAVIGATED", { url, tab }, null, null);
    return { navigated: url, tab: tab ?? "active", tabs };
  },

  BROWSER_BACK: async (p) => {
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["back"]);
    if (r.code !== 0) throw new Error(`back_failed_code_${r.code}: ${r.out.slice(0, 120)}`);
    emit("BROWSER_HISTORY_MOVED", { dir: "back", tab }, null, null);
    return { moved: "back", tab: tab ?? "active" };
  },

  BROWSER_FORWARD: async (p) => {
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["forward"]);
    if (r.code !== 0) throw new Error(`forward_failed_code_${r.code}: ${r.out.slice(0, 120)}`);
    emit("BROWSER_HISTORY_MOVED", { dir: "forward", tab }, null, null);
    return { moved: "forward", tab: tab ?? "active" };
  },

  BROWSER_RELOAD: async (p) => {
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["reload"]);
    if (r.code !== 0) throw new Error(`reload_failed_code_${r.code}: ${r.out.slice(0, 120)}`);
    emit("BROWSER_RELOADED", { tab }, null, null);
    return { reloaded: true, tab: tab ?? "active" };
  },

  BROWSER_CLICK: async (p) => {
    const sel = String(p.selector ?? p.sel ?? "").trim();
    if (!sel) throw new Error("selector_required");
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["click", sel]);
    if (r.code !== 0) throw new Error(`click_failed_code_${r.code}: ${r.out.slice(0, 160)}`);
    emit("BROWSER_CLICKED", { selector: sel, tab }, null, null);
    return { clicked: sel, tab: tab ?? "active", out: r.out.slice(0, 500) };
  },

  BROWSER_TYPE: async (p) => {
    const sel = String(p.selector ?? "").trim();
    const text = String(p.text ?? "").slice(0, 2000);
    if (!sel || !text) throw new Error("selector_and_text_required");
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["fill", sel, text]);
    if (r.code !== 0) throw new Error(`type_failed_code_${r.code}: ${r.out.slice(0, 160)}`);
    emit("BROWSER_TYPED", { selector: sel, len: text.length, tab }, null, null);
    return { typed: sel, len: text.length, tab: tab ?? "active" };
  },

  BROWSER_PRESS: async (p) => {
    const key = String(p.key ?? "").trim();
    if (!key) throw new Error("key_required (Enter/Tab/Control+a/...)");
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["press", key]);
    if (r.code !== 0) throw new Error(`press_failed_code_${r.code}: ${r.out.slice(0, 160)}`);
    emit("BROWSER_PRESSED", { key, tab }, null, null);
    return { pressed: key, tab: tab ?? "active" };
  },

  BROWSER_SCROLL: async (p) => {
    const dir = ["up", "down", "left", "right"].includes(String(p.dir)) ? String(p.dir) : "down";
    const px = Number.isFinite(Number(p.px)) && Number(p.px) > 0 ? Math.round(Number(p.px)) : null;
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    await ab(px ? ["scroll", dir, String(px)] : ["scroll", dir]);
    emit("BROWSER_SCROLLED", { dir, px, tab }, null, null);
    return { scrolled: dir, px, tab: tab ?? "active" };
  },

  BROWSER_SELECT_TAB: async (p) => {
    const tab = String(p.tab ?? "").trim();
    if (!tab) throw new Error("tab_required");
    const r = await ab(["tab", tab]);
    if (r.code !== 0) throw new Error(`tab_select_failed_code_${r.code}: ${r.out.slice(0, 120)}`);
    const tabs = await browserTabs();
    emit("BROWSER_TAB_SELECTED", { tab }, null, null);
    return { selected: tab, tabs };
  },

  BROWSER_URL: async (p) => {
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["get", "url"]);
    const url = r.out.trim().split("\n").pop()?.trim() ?? "";
    emit("BROWSER_PAGE_READ", { what: "url", tab }, null, null);
    return { url, tab: tab ?? "active" };
  },

  BROWSER_TITLE: async (p) => {
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["get", "title"]);
    const title = r.out.trim().split("\n").pop()?.trim() ?? "";
    emit("BROWSER_PAGE_READ", { what: "title", tab }, null, null);
    return { title, tab: tab ?? "active" };
  },

  BROWSER_TEXT: async (p) => {
    const tab = p.tab ? String(p.tab) : null;
    if (tab) await ab(["tab", tab]);
    const r = await ab(["read"]);
    if (r.code !== 0 && !r.out) throw new Error(`read_failed_code_${r.code}`);
    const text = r.out.slice(0, 8000);
    emit("BROWSER_PAGE_READ", { what: "text", chars: text.length, tab }, null, null);
    return { truncated: r.out.length > 8000, chars: text.length, text, tab: tab ?? "active" };
  },

  WORKSPACE_READ: (p) => {
    const rel = String(p.path ?? "").replace(/^\/+/, "").trim();
    if (!rel || rel.includes("..")) throw new Error("path_required_no_dotdot");
    const full = join(WORKSPACE_ROOT, rel);
    if (!full.startsWith(WORKSPACE_ROOT)) throw new Error("path_escape_blocked");
    const st = statSync(full); // бросит, если файла нет — это честная ошибка
    if (st.isDirectory()) throw new Error("is_directory_use_workspace_snapshot");
    const raw = readFileSync(full, "utf8");
    emit("WORKSPACE_FILE_READ", { path: rel, bytes: st.size }, null, null);
    return { path: rel, bytes: st.size, truncated: raw.length > 8000, content: raw.slice(0, 8000) };
  },

  WORKSPACE_WRITE: (p) => {
    const rel = String(p.path ?? "").replace(/^\/+/, "").trim();
    const content = String(p.content ?? "").slice(0, 20000);
    if (!rel || rel.includes("..")) throw new Error("path_required_no_dotdot");
    if (!content) throw new Error("content_required");
    const full = join(WORKSPACE_ROOT, rel);
    if (!full.startsWith(WORKSPACE_ROOT)) throw new Error("path_escape_blocked");
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
    const bytes = statSync(full).size;
    emit("WORKSPACE_FILE_WRITTEN", { path: rel, bytes }, null, null);
    return { path: rel, bytes };
  },

  WORKER_REAP: () => {
    const reaped = reapStaleWorkers();
    emit("WORKERS_REAPPED", { reaped, by: "operator" }, null, null);
    return { reaped };
  },

  DB_STATS: () => {
    const cnt = (t: string) => (db.query(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    const pc = db.query("PRAGMA page_count").get() as { page_count?: number } | undefined;
    const ps = db.query("PRAGMA page_size").get() as { page_size?: number } | undefined;
    const jm = db.query("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;
    const stats = {
      agents: cnt("agents"), tasks: cnt("tasks"), events: cnt("events"),
      commands: cnt("commands"), workers: cnt("workers"), meta: cnt("meta"),
      db_bytes: Number(pc?.page_count ?? 0) * Number(ps?.page_size ?? 0),
      journal_mode: jm?.journal_mode ?? "?",
    };
    emit("DB_STATS_TAKEN", { tasks: stats.tasks, events: stats.events, db_bytes: stats.db_bytes }, null, null);
    return stats;
  },

  TASK_PURGE: (p) => {
    const allTerminal = Boolean(p.all_terminal);
    const statuses = allTerminal ? ["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"] : ["ARCHIVED"];
    const ph = statuses.map(() => "?").join(",");
    const r = db.query(`DELETE FROM tasks WHERE status IN (${ph})`).run(...statuses);
    const purged = Number(r.changes);
    emit("TASKS_PURGED", { purged, all_terminal: allTerminal, by: "operator" }, null, null);
    return { purged, all_terminal: allTerminal };
  },

  EVENTS_TAIL: (p) => ({
    events: tailEvents(Number(p.since ?? 0), Math.min(Number(p.limit ?? 100), 500)),
  }),

  WORKER_HEARTBEAT: (p) => {
    const w = upsertWorker({
      id: p.id ? String(p.id) : undefined,
      role: String(p.role ?? "console").slice(0, 64),
      kind: String(p.kind ?? "API").toUpperCase().slice(0, 16),
      state: p.state ? String(p.state).toUpperCase().slice(0, 16) : undefined,
    });
    return { worker: w };
  },

  FLEET_RECONCILE: () => {
    const agents = listAgents();
    let retired = 0;
    for (const a of agents) {
      if (a.role === "__RETIRED__") { deleteAgent(a.id); retired++; }
    }
    emit("FLEET_RECONCILED", { total: agents.length, retired }, null, null);
    return { total: agents.length, retired };
  },

  ENVIRONMENT_RESET: () => {
    db.exec("DELETE FROM tasks; DELETE FROM agents; DELETE FROM commands;");
    emit("ENVIRONMENT_RESET", { by: "operator", via: "command_bus" }, null, null);
    return { reset: true };
  },
};

export function knownActions(): string[] { return Object.keys(handlers); }

// ── реестр действий (цель — 47; сейчас 25) — источник для ⌘K и /actions ──
type ActionMeta = { action: string; lane: Lane; cost: number; desc: string; group: string; args?: string };
const CATALOG_EXTRA: ActionMeta[] = [
  { action: "TASK_ENQUEUE", lane: "MUTATION", cost: LANES.MUTATION.cost, desc: "поставить задачу в очередь (форма N)", group: "Задачи", args: "title, spec, role?, max_steps?" },
  { action: "TASK_SCHEDULE", lane: "MUTATION", cost: LANES.MUTATION.cost, desc: "отложенная постановка задачи (ETA)", group: "Задачи", args: "title, spec, delay_sec, role?, max_steps?" },
  { action: "AGENT_SPAWN", lane: "MUTATION", cost: LANES.MUTATION.cost, desc: "создать агента роли", group: "Флот", args: "role, model?" },
];
const DESC: Record<string, string> = {
  PING: "проверка живости шины",
  STATE_SNAPSHOT: "полный снапшот состояния",
  TASK_CANCEL: "отмена задачи (READY/RUNNING)",
  TASK_RETRY: "повтор FAILED/CANCELLED задачи (+2 шага)",
  BUDGET_FLUSH: "сброс очереди шины (EMERGENCY)",
  EVENTS_EXPORT: "выгрузка журнала событий JSON",
  AGENT_RETIRE: "уволить агента",
  AGENT_PAUSE: "пауза агента (не берёт задачи)",
  AGENT_RESUME: "снять паузу агента",
  COMMAND_CANCEL: "отменить PENDING-команду",
  WORKERS_LIST: "список внешних workers",
  ACTIONS_LIST: "реестр действий с полосами",
  EVENTS_TAIL: "хвост событий (since/limit)",
  WORKER_HEARTBEAT: "регистрация/пульс worker-а",
  FLEET_RECONCILE: "сверка и чистка флота",
  ENVIRONMENT_RESET: "полный сброс среды (EMERGENCY)",
  TASK_LIST: "сводка задач (id/title/status/steps)",
  TASK_ARCHIVE: "архивировать задачу в терминальном статусе",
  AGENT_MODEL: "сменить модель агента",
  WORKSPACE_SNAPSHOT: "манифест workspace (файлы/байты)",
  EVENTS_SEARCH: "поиск по событиям (type+data)",
  BUDGET_ADJUST: "лимит бюджета шины (6..96/60s)",
  BROWSER_TABS: "ветки браузера: список вкладок",
  BROWSER_OPEN: "открыть URL новой вкладкой",
  BROWSER_SNAPSHOT: "a11y-снимок активной вкладки",
  BROWSER_SCREENSHOT: "скриншот активной вкладки в download/",
  BROWSER_CLOSE: "закрыть вкладку (id | all)",
  BROWSER_NAVIGATE: "навигация вкладки на URL",
  BROWSER_BACK: "назад в истории вкладки",
  BROWSER_FORWARD: "вперёд в истории вкладки",
  BROWSER_RELOAD: "перезагрузить вкладку",
  BROWSER_CLICK: "клик по селектору/@ref",
  BROWSER_TYPE: "ввести текст в поле (fill)",
  BROWSER_PRESS: "нажать клавишу (Enter/Tab/…)",
  BROWSER_SCROLL: "прокрутка (dir, px)",
  BROWSER_SELECT_TAB: "сделать вкладку активной",
  BROWSER_URL: "текущий URL активной вкладки",
  BROWSER_TITLE: "заголовок активной вкладки",
  BROWSER_TEXT: "текст страницы для агента (read)",
  WORKSPACE_READ: "прочитать файл workspace",
  WORKSPACE_WRITE: "записать файл в workspace",
  WORKER_REAP: "принудительный reap протухших workers",
  DB_STATS: "статистика SQLite (таблицы/байты)",
  TASK_PURGE: "удалить ARCHIVED (или все терминальные) задачи",
};
const GROUP_OF: Record<string, string> = {
  PING: "Диагностика", STATE_SNAPSHOT: "Диагностика", EVENTS_EXPORT: "Диагностика",
  EVENTS_TAIL: "Диагностика", WORKERS_LIST: "Диагностика", ACTIONS_LIST: "Диагностика", WORKER_HEARTBEAT: "Диагностика",
  WORKSPACE_SNAPSHOT: "Диагностика", EVENTS_SEARCH: "Диагностика",
  TASK_CANCEL: "Задачи", TASK_RETRY: "Задачи", TASK_LIST: "Задачи", TASK_ARCHIVE: "Задачи",
  AGENT_RETIRE: "Флот", AGENT_PAUSE: "Флот", AGENT_RESUME: "Флот", FLEET_RECONCILE: "Флот", AGENT_MODEL: "Флот",
  COMMAND_CANCEL: "Шина", BUDGET_ADJUST: "Шина",
  BROWSER_TABS: "Браузер", BROWSER_OPEN: "Браузер", BROWSER_SNAPSHOT: "Браузер", BROWSER_SCREENSHOT: "Браузер", BROWSER_CLOSE: "Браузер",
  BROWSER_NAVIGATE: "Браузер", BROWSER_BACK: "Браузер", BROWSER_FORWARD: "Браузер", BROWSER_RELOAD: "Браузер",
  BROWSER_CLICK: "Браузер", BROWSER_TYPE: "Браузер", BROWSER_PRESS: "Браузер", BROWSER_SCROLL: "Браузер",
  BROWSER_SELECT_TAB: "Браузер", BROWSER_URL: "Браузер", BROWSER_TITLE: "Браузер", BROWSER_TEXT: "Браузер",
  WORKSPACE_READ: "Workspace", WORKSPACE_WRITE: "Workspace",
  WORKER_REAP: "Диагностика", DB_STATS: "Диагностика",
  BUDGET_FLUSH: "Опасная зона", ENVIRONMENT_RESET: "Опасная зона", TASK_PURGE: "Опасная зона",
};
export function actionCatalog(): ActionMeta[] {
  const built = knownActions().map((a) => {
    const lane = (LANE_OF[a]
      ?? (a.endsWith("_RESET") || a.startsWith("FLUSH") || a.endsWith("_FLUSH") || a.startsWith("FENCE")
        ? "EMERGENCY"
        : a.endsWith("_CANCEL") || a.endsWith("_RETIRE") || a.endsWith("_PAUSE") || a.endsWith("_RESUME")
          ? "CONTROL"
          : a.endsWith("_ENQUEUE") || a.endsWith("_SPAWN") || a.endsWith("_RETRY") || a.endsWith("_SCHEDULE")
            ? "MUTATION"
            : "READ_ONLY")) as Lane;
    const cost = COST_OF[a] ?? LANES[lane].cost;
    return { action: a, lane, cost, desc: DESC[a] ?? "—", group: GROUP_OF[a] ?? "Прочее" };
  });
  const seen = new Set(built.map((x) => x.action));
  return [...built, ...CATALOG_EXTRA.filter((x) => !seen.has(x.action))].sort((x, y) => x.group.localeCompare(y.group) || x.action.localeCompare(y.action));
}

/** Атомарный захват команды (защита от двойного исполнения REST-ом и master loop-ом). */
export function claimCommand(id: string): boolean {
  const r = db.query(`UPDATE commands SET status='RUNNING', leased_at=COALESCE(leased_at,?) WHERE id=? AND status='PENDING'`)
    .run(nowIso(), id);
  return Number(r.changes) === 1;
}

/** Результат команды храним КАК ВАЛИДНЫЙ JSON: длинные результаты режем честно-объектом
 *  (truncated+preview), иначе JSON.parse на чтении падал и клиент получал сырую строку (баг R4). */
const RESULT_CAP = 60_000;
function storeResult(result: unknown): string {
  const json = JSON.stringify(result ?? {});
  if (json.length <= RESULT_CAP) return json;
  return JSON.stringify({ truncated: true, original_bytes: json.length, preview: json.slice(0, 4000) });
}

async function runCommand(cmd: CommandRow): Promise<void> {
  emit("COMMAND_LEASED", { action: cmd.action, lane: cmd.lane, id: cmd.id }, null, null);
  const spanT0 = Date.now();
  try {
    const handler = handlers[cmd.action];
    if (!handler) throw new Error(`unknown_action_${cmd.action}`);
    const payload = cmd.payload ? (JSON.parse(cmd.payload) as Record<string, unknown>) : {};
    const result = await handler(payload);
    db.query(`UPDATE commands SET status='COMPLETED', result=?, completed_at=? WHERE id=?`)
      .run(storeResult(result), nowIso(), cmd.id);
    emit("COMMAND_COMPLETED", { action: cmd.action, id: cmd.id }, null, null);
    recordSpan(`command.${cmd.action}`, { "me2.lane": cmd.lane, "me2.cmd_id": cmd.id, "me2.cost": cmd.cost }, spanT0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.query(`UPDATE commands SET status='FAILED', error=?, completed_at=? WHERE id=?`)
      .run(msg.slice(0, 500), nowIso(), cmd.id);
    emit("COMMAND_FAILED", { action: cmd.action, id: cmd.id, error: msg.slice(0, 200) }, null, null);
    recordSpan(`command.${cmd.action}`, { "me2.lane": cmd.lane, "me2.cmd_id": cmd.id, "me2.cost": cmd.cost }, spanT0,
      { status: "ERROR", message: msg });
  }
}

/** Исполнить одну команду сразу (для синхронных REST-мутаций). */
export async function runOne(cmd: CommandRow): Promise<CommandRow> {
  if (claimCommand(cmd.id)) await runCommand(cmd);
  return (db.query(`SELECT * FROM commands WHERE id=?`).get(cmd.id) as CommandRow) ?? cmd;
}

/** Дренаж очереди (вызывается master loop каждый тик). run_after в будущем не исполняется. */
export async function drainCommands(max = 8): Promise<number> {
  const pending = db.query(
    `SELECT * FROM commands WHERE status='PENDING' AND (run_after IS NULL OR run_after<=?)
     ORDER BY CASE lane WHEN 'EMERGENCY' THEN 0 WHEN 'CONTROL' THEN 1 WHEN 'MUTATION' THEN 5 ELSE 9 END, created_at
     LIMIT ?`,
  ).all(Date.now(), max) as CommandRow[];
  let n = 0;
  for (const cmd of pending) {
    if (claimCommand(cmd.id)) { await runCommand(cmd); n++; }
  }
  return n;
}
