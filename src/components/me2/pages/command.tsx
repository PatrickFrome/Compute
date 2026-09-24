"use client";
/**
 * ME2 COMMAND CENTER (R74, Page 1) — ежедневный центр управления, 3 колонки:
 *  - Agent Sidebar (лево): флот чат-агентов из GET /agentchat (:3041, 5с) — статус, роль, цель,
 *    модель, ходы, исход, last_error; клик → выбор чата (setChatId → мост me2:select-chat);
 *  - центр: BrowserStage (compact, live-включён) + выдвижная нижняя половина с AgentChatPanel
 *    (тумблер browser-chats-toggle в заголовке, контейнер browser-chats);
 *  - Supervisor Panel (право, ≥xl): супервизор/цели/задачи/health/важные события/решения
 *    (workgraph 10s + agentchat 10s + demand 30s + store snap/mirror/events).
 * Порт legacy: agent-chat panel (G1-G6), fleet-grid селекция, demand-статус, workgraph.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Brain, Crosshair, ExternalLink, MessageSquarePlus, PanelLeft,
  Shield, ShieldCheck, Target, Zap,
} from "lucide-react";
import { PageHeader, Sec, Chip, Dot, StateBadge } from "@/components/me2/ui/primitives";
import { useMe2 } from "@/components/me2/store";
import { me2Fetch, hhmmss, EVENT_STYLE, toastBus, type Mirror } from "@/lib/me2-bus";
import { agentChatOp } from "@/lib/me2-socket";
import { BrowserStage } from "@/components/me2/stages/browser-stage";
import AgentChatPanel from "@/components/me2/agent-chat-panel";

// ── типы (зеркало daemon: agentchat.ts / objectives.ts / demand.ts) ─────────────
type ChatSession = {
  id: string; agent_id: string; title: string; status: "ACTIVE" | "CLOSED";
  state: "IDLE" | "THINKING"; summary: string; compactions: number;
  turns_ok: number; turns_fail: number; fail_streak: number;
  last_error: string | null; model: string; objective: string;
  created_at: string; updated_at: string;
  outcome_status: string | null; outcome_proof: string | null; outcome_at: string | null;
  role: string;
};
type ChatStatus = { total: number; active: number; thinking: number; supervisors: number; turns_ok: number; turns_fail: number; compactions: number; degraded: number; in_flight: number };
type WorkGraph = {
  ok: boolean; fails_closed: boolean;
  objectives: Array<{ id: string; title: string; spec: string; status: string; priority: number; derived_state: string; attention: string | null; counts: { total: number; active: number; done: number; failed: number } }>;
  orphan_tasks: Array<{ id: string; title: string; status: string }>;
  stats: { objectives_total: number; objectives_active: number; objectives_achieved: number; objectives_failed: number; objectives_parked: number; attention_objectives: number; tasks_linked: number; tasks_orphan: number; agents_total: number; edges: number; handoffs: number };
};
type DemandDecision = { ts: string; action: string; signal: string | null; role: string | null; session_id: string | null; detail: string };
type Demand = {
  ok: boolean;
  config: { enabled: boolean; max: number };
  ticks: number;
  last_decision: DemandDecision | null;
  decisions: DemandDecision[];
  snapshot: { ready_count: number; ready_research: number; pool_leases: number; pool_max: number; fails_15m: number; active_chats: number; breaker_open: boolean };
};

// ВАЖНЫЕ СОБЫТИЯ супервизора: префиксы (дизайн-контракт Task 6-a)
const IMPORTANT_PREFIXES = ["TASK_", "GOVERNOR_", "APPROVAL_", "AGENT_CHAT_OUTCOME", "OBJECTIVE_"];

// ── Agent Sidebar (лево) ────────────────────────────────────────────────────────
function AgentSidebar() {
  const setChatId = useMe2((s) => s.setChatId);
  const setPage = useMe2((s) => s.setPage);
  const chatId = useMe2((s) => s.chatId);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      const d = await me2Fetch<{ sessions: ChatSession[]; status: ChatStatus }>("/agentchat?XTransformPort=3041");
      if (!dead && d) {
        setSessions(d.sessions ?? []);
        setStatus(d.status ?? null);
      }
    };
    void load();
    const iv = window.setInterval(() => { void load(); }, 5000);
    return () => { dead = true; window.clearInterval(iv); };
  }, []);

  // «+ чат»: мост-событие (legacy-совместимость, Electron-оболочка) + прямой op:"create"
  // (в веб-рантайме окно-событие никто не слушает — молчаливый отказ недопустим, §8 дизайн-дока)
  const createChat = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    window.dispatchEvent(new CustomEvent("me2:chat-create"));
    try {
      const r = await agentChatOp({ op: "create" });
      if (r.ok && r.session) {
        setChatId(String(r.session.id));
        toastBus({ title: "чат-агент создан ✓", description: `сессия ${String(r.session.id).slice(0, 16)}` });
      } else {
        toastBus({ title: "чат не создан ✗", description: String(r.error ?? "daemon недоступен"), variant: "destructive" });
      }
    } finally { setCreating(false); }
  }, [creating, setChatId]);

  const active = useMemo(() => sessions.filter((s) => s.status === "ACTIVE"), [sessions]);

  return (
    <div
      className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80"
      data-testid="agent-sidebar"
      aria-label="Флот агентов"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800 px-2.5 py-2">
        <Brain className={`h-3.5 w-3.5 ${status && status.active > 0 ? "text-emerald-400" : "text-zinc-600"}`} aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">Агенты</span>
        <span className="ml-auto font-mono text-[9px] text-zinc-500" title="активных/всего · думают · супервизоров">
          {status ? `${status.active}/${status.total}` : "—"}{status && status.thinking > 0 ? ` · 💭${status.thinking}` : ""}
        </span>
      </div>
      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        {active.length === 0 && (
          <p className="px-1.5 py-3 text-center text-[10px] leading-relaxed text-zinc-600">
            флот пуст — создайте чат-агента кнопкой «+ чат» или дождитесь автопилота спроса
          </p>
        )}
        {active.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            aria-current={chatId === s.id}
            onClick={() => setChatId(s.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChatId(s.id); } }}
            title={`${s.title} · ${s.role} · ${s.model}\n${s.objective ? `цель: ${s.objective}\n` : ""}${s.summary || ""}${s.last_error ? `\n⚠ ${s.last_error}` : ""}`}
            className={`group mb-1 cursor-pointer rounded-md border px-2 py-1.5 transition ${
              chatId === s.id ? "border-emerald-900/60 bg-emerald-950/20" : "border-transparent hover:border-zinc-800 hover:bg-zinc-900/60"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  s.state === "THINKING" ? "animate-pulse bg-violet-400" : s.status === "ACTIVE" ? "bg-emerald-400" : "bg-zinc-600"
                }`}
              />
              {s.role === "SUPERVISOR" && <Shield className="h-3 w-3 shrink-0 text-violet-300" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">{s.title}</span>
              <button
                type="button"
                aria-label={`Открыть браузер агента ${s.title}`}
                title="Открыть BROWSER (workspace-браузер агента)"
                onClick={(e) => { e.stopPropagation(); setPage("browser"); }}
                className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-emerald-300 group-hover:opacity-100"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
              </button>
            </div>
            <div className="mt-0.5 flex items-center gap-1 font-mono text-[9px] text-zinc-500">
              <span className="rounded bg-zinc-900 px-1 py-0.5 text-[8px] uppercase tracking-wider text-zinc-400">{s.role.toLowerCase()}</span>
              <span className="truncate" title={s.model}>{s.model}</span>
              <span className="ml-auto shrink-0" title={`ходы ok/fail · компакций ${s.compactions}`}>{s.turns_ok}✓/{s.turns_fail}✗</span>
            </div>
            {s.objective && (
              <p className="mt-0.5 truncate text-[10px] leading-snug text-amber-200/80" title={s.objective}>🎯 {s.objective}</p>
            )}
            {!s.objective && s.summary && (
              <p className="mt-0.5 truncate text-[10px] leading-snug text-zinc-500" title={s.summary}>{s.summary}</p>
            )}
            <div className="mt-0.5 flex items-center gap-1.5">
              {(s.outcome_status === "fixed" || s.outcome_status === "done") && (
                <span className="shrink-0 font-mono text-[8px] text-emerald-400" title={`исход подтверждён (outcome-proof)${s.outcome_proof ? `: ${s.outcome_proof.slice(0, 80)}` : ""}`}>✓{s.outcome_status}</span>
              )}
              {s.outcome_status === "blocked" && (
                <span className="shrink-0 font-mono text-[8px] text-rose-400" title="агент честно заблокирован">blocked</span>
              )}
              {s.fail_streak >= 3 && (
                <span className="shrink-0 font-mono text-[8px] text-rose-300" title={`${s.fail_streak} провалов подряд (Outcome River)`}>deg {s.fail_streak}</span>
              )}
              {s.last_error && (
                <span className="min-w-0 flex-1 truncate font-mono text-[8px] text-rose-400/90" title={s.last_error}>⚠ {s.last_error}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-zinc-800 p-1.5">
        <button
          type="button"
          onClick={() => void createChat()}
          disabled={creating}
          title="Создать чат-агента (agentchat:op create + мост me2:chat-create для оболочки)"
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-900/60 bg-emerald-950/20 px-2 py-1.5 text-[10px] font-medium text-emerald-300 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden /> {creating ? "создаём…" : "чат"}
        </button>
      </div>
    </div>
  );
}

// ── Supervisor Panel (право) ────────────────────────────────────────────────────
function SupervisorPanel() {
  const setPage = useMe2((s) => s.setPage);
  const snap = useMe2((s) => s.snap);
  const mirror = useMe2((s) => s.mirror);
  const connected = useMe2((s) => s.connected);
  const events = useMe2((s) => s.events);
  const [wg, setWg] = useState<WorkGraph | null>(null);
  const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null);
  const [demand, setDemand] = useState<Demand | null>(null);

  // workgraph + agentchat: 10s; demand: 30s
  useEffect(() => {
    let dead = false;
    const loadWg = async () => {
      const d = await me2Fetch<WorkGraph>("/workgraph?XTransformPort=3041");
      if (!dead && d?.ok) setWg(d);
    };
    const loadChats = async () => {
      const d = await me2Fetch<{ status: ChatStatus }>("/agentchat?XTransformPort=3041");
      if (!dead && d) setChatStatus(d.status ?? null);
    };
    const loadDemand = async () => {
      const d = await me2Fetch<Demand>("/demand?XTransformPort=3041");
      if (!dead && d?.ok) setDemand(d);
    };
    void loadWg(); void loadChats(); void loadDemand();
    const a = window.setInterval(() => { void loadWg(); }, 10_000);
    const b = window.setInterval(() => { void loadChats(); }, 10_000);
    const c = window.setInterval(() => { void loadDemand(); }, 30_000);
    return () => { dead = true; window.clearInterval(a); window.clearInterval(b); window.clearInterval(c); };
  }, []);

  const importantEvents = useMemo(
    () => events.filter((e) => IMPORTANT_PREFIXES.some((p) => e.type.startsWith(p))).slice(0, 8),
    [events],
  );
  const budget = snap?.budget;
  const stats = snap?.stats ?? {};
  const mirrorMode: Mirror["mode"] | "…" = mirror?.mode ?? "…";
  const activeObjectives = useMemo(
    () => (wg?.objectives ?? []).filter((o) => o.status === "ACTIVE" || o.status === "PARKED").slice(0, 6),
    [wg],
  );

  return (
    <div
      className="hidden w-80 shrink-0 flex-col gap-2 overflow-y-auto mc-scroll xl:flex"
      data-testid="supervisor-panel"
      aria-label="Панель супервизора"
    >
      <Sec id="sup-state" title="Супервизор" icon={Shield} tone="violet" dense>
        <div className="flex flex-wrap items-center gap-1.5">
          <StateBadge state={chatStatus && chatStatus.active > 0 ? "Running" : "Idle"} />
          <Chip label="sup" value={chatStatus?.supervisors ?? "—"} tone="violet" title="вечно-живущих супервизоров (тик 60с, перерождение)" />
          <Chip label="актив" value={chatStatus?.active ?? "—"} tone="emerald" title="активных чат-агентов" />
          <Chip label="💭" value={chatStatus?.thinking ?? "—"} tone="amber" title="агентов в ходе (THINKING)" />
          <Chip label="ходы" value={chatStatus ? `${chatStatus.turns_ok}✓/${chatStatus.turns_fail}✗` : "—"} title="ходы флота ok/fail" />
          {chatStatus && chatStatus.degraded > 0 && <Chip label="deg" value={chatStatus.degraded} tone="rose" title="сессий с 3+ провалами подряд" />}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 font-mono text-[9px] text-zinc-500" title="WS-канал daemon :3040">
            <Dot on={connected} pulse /> ws {connected ? "LIVE" : "OFF"}
          </span>
          <Chip label="mirror" value={mirrorMode} tone={mirrorMode === "LIVE" || mirrorMode === "LIVE-STORAGE" ? "emerald" : mirrorMode === "DEGRADED" ? "amber" : "zinc"} title="SQL-зеркало audit-trail" />
          <Chip label="бюджет" value={budget ? `${budget.used}/${budget.limit}` : "—"} tone={budget && budget.used >= budget.limit ? "rose" : "zinc"} title="команд шины / 60s" />
          {demand && (
            <Chip label="спрос" value={demand.config.enabled ? `on·max${demand.config.max}` : "off"} tone={demand.config.enabled ? "cyan" : "zinc"} title={`автопилот спроса; тиков ${demand.ticks}; breaker ${demand.snapshot.breaker_open ? "OPEN" : "closed"}`} />
          )}
        </div>
      </Sec>

      <Sec id="sup-objectives" title="Цели" icon={Target} tone="emerald" dense right={<span className="font-mono text-[9px] text-zinc-500">{wg ? `${wg.stats.objectives_active}/${wg.stats.objectives_total}` : "—"}</span>}>
        {activeObjectives.length === 0 && (
          <p className="py-1 text-center text-[10px] text-zinc-600">{wg ? "активных целей нет" : "workgraph недоступен"}</p>
        )}
        <div className="space-y-1">
          {activeObjectives.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setPage("supervisor")}
              title={`${o.title}\n${o.spec || ""}\nзадач: ${o.counts.total} (актив ${o.counts.active}, готово ${o.counts.done}, провал ${o.counts.failed})`}
              className="block w-full rounded border border-zinc-800/80 bg-zinc-900/40 px-1.5 py-1 text-left transition hover:border-zinc-600"
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-zinc-200">{o.title}</span>
                <span className={`shrink-0 font-mono text-[8px] ${o.status === "PARKED" ? "text-amber-300" : "text-emerald-300"}`}>{o.status}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[8px] text-zinc-500">
                <span>{o.counts.active} актив · {o.counts.done}✓ · {o.counts.failed}✗</span>
                {o.attention && <span className="ml-auto shrink-0 truncate text-amber-300" title={o.attention}>⚠ {o.attention.slice(0, 40)}</span>}
              </div>
            </button>
          ))}
        </div>
      </Sec>

      <Sec id="sup-tasks" title="Задачи" icon={Activity} tone="amber" dense right={<span className="font-mono text-[9px] text-zinc-500">{snap ? `${stats.tasksRunning ?? 0} run` : "—"}</span>}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip label="run" value={stats.tasksRunning ?? 0} tone="amber" title="задач в работе (RUNNING)" />
          <Chip label="ready" value={stats.tasksReady ?? 0} title="в очереди (READY)" />
          <Chip label="done" value={stats.tasksCompleted ?? 0} tone="emerald" title="завершено" />
          <Chip label="fail" value={stats.tasksFailed ?? 0} tone={stats.tasksFailed ? "rose" : "zinc"} title="провалено" />
          {wg && <Chip label="⚠ цели" value={wg.stats.attention_objectives} tone={wg.stats.attention_objectives ? "amber" : "zinc"} title="целей под вниманием супервизора" />}
          {wg && wg.stats.tasks_orphan > 0 && <Chip label="orphan" value={wg.stats.tasks_orphan} tone="amber" title="задач без связи с целью" />}
          <Chip label="handoffs" value={wg?.stats.handoffs ?? "—"} tone="violet" title="передач между агентами" />
        </div>
      </Sec>

      <Sec id="sup-events" title="События" icon={Zap} tone="cyan" dense right={<span className="font-mono text-[9px] text-zinc-500">{importantEvents.length}</span>}>
        {importantEvents.length === 0 ? (
          <p className="py-1 text-center text-[10px] text-zinc-600">важных событий нет (TASK_/GOVERNOR_/APPROVAL_/OUTCOME)</p>
        ) : (
          <div className="space-y-0.5 font-mono text-[9px] leading-snug">
            {importantEvents.map((e) => (
              <div key={e.seq} className="flex items-start gap-1.5">
                <span className="shrink-0 text-zinc-600">{hhmmss(e.ts)}</span>
                <span className={`w-28 shrink-0 truncate font-semibold ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`} title={e.type}>{e.type}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-500" title={e.data}>{e.data}</span>
              </div>
            ))}
          </div>
        )}
      </Sec>

      <Sec id="sup-decisions" title="Решения" icon={ShieldCheck} tone="teal" dense>
        {demand?.last_decision ? (
          <div className="rounded border border-zinc-800/80 bg-zinc-900/40 px-1.5 py-1" title={`${demand.last_decision.ts} · ${demand.last_decision.action}`}>
            <div className="flex items-center gap-1.5 font-mono text-[9px]">
              <span className="shrink-0 text-teal-300">{demand.last_decision.action}</span>
              <span className="shrink-0 text-zinc-600">{hhmmss(demand.last_decision.ts)}</span>
              {demand.last_decision.role && <span className="shrink-0 text-violet-300/80">{demand.last_decision.role}</span>}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-zinc-400" title={demand.last_decision.detail}>
              {demand.last_decision.signal ? `[${demand.last_decision.signal}] ` : ""}{demand.last_decision.detail}
            </p>
          </div>
        ) : (
          <p className="py-1 text-center text-[10px] text-zinc-600">решений автопилота ещё не было</p>
        )}
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage("supervisor")}
            title="Поставить цель / разобрать objective (страница SUPERVISOR)"
            className="flex flex-1 items-center justify-center gap-1 rounded border border-emerald-900/60 bg-emerald-950/20 px-1.5 py-1 font-mono text-[9px] text-emerald-300 transition hover:bg-zinc-800"
          >
            <Crosshair className="h-3 w-3" aria-hidden /> Цель…
          </button>
          <button
            type="button"
            onClick={() => setPage("supervisor")}
            title="Разбор провала — супервизор координирует диагностику (страница SUPERVISOR)"
            className="flex flex-1 items-center justify-center gap-1 rounded border border-rose-900/60 bg-rose-950/20 px-1.5 py-1 font-mono text-[9px] text-rose-300 transition hover:bg-zinc-800"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden /> Разбор провала
          </button>
        </div>
      </Sec>
    </div>
  );
}

// ── Page: COMMAND CENTER ────────────────────────────────────────────────────────
export function CommandPage() {
  const [chatsOpen, setChatsOpen] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-command" data-panel-command>
      <PageHeader
        title="COMMAND CENTER"
        sub="агенты · браузер · супервизор"
        actions={
          <button
            type="button"
            onClick={() => setChatsOpen((v) => !v)}
            aria-pressed={chatsOpen}
            title="Показать/скрыть панель чата выбранного агента (AgentChatPanel)"
            data-testid="browser-chats-toggle"
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] transition ${
              chatsOpen ? "border-emerald-900/60 bg-emerald-500/15 text-emerald-300" : "border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <PanelLeft className="h-3.5 w-3.5" aria-hidden /> чат
          </button>
        }
      />
      <div className="flex min-h-0 flex-1 gap-2">
        <AgentSidebar />
        {/* центр: BrowserStage (live по умолчанию) + выдвижная нижняя половина с чатом агента */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <BrowserStage compact defaultCastOn />
          {chatsOpen && (
            <div
              className="mc-scroll h-72 shrink-0 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80"
              data-testid="browser-chats"
            >
              <AgentChatPanel />
            </div>
          )}
        </div>
        <SupervisorPanel />
      </div>
    </div>
  );
}
