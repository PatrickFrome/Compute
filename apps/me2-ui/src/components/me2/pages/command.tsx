"use client";
/**
 * ME2 COMMAND (R95, Page 1) — mission control в духе DaVinci/Linear:
 * COMMAND — это стадия работы (миссия/внимание/быстрые действия/исходы),
 * а НЕ «Browser + chat sidebar». R93-инварианты сохранены:
 *  - слева Mission Rail (252px): цель, чат-агенты (точка статуса + имя),
 *    поиск, «чат», свежие исходы; детали в title-tooltip;
 *  - в центре МИССИЯ: objective, active work (цепочка задач), attention,
 *    recent outcomes, quick actions — при деградации транспорта COMMAND
 *    остаётся полезным (offline больше не превращает центр в пустоту);
 *  - Browser переехал на workflow-стадию RUN (legacy PageKey "browser", Alt+4);
 *    клик по агенту отправляет только narrow presentation intent через
 *    каноническую session→tab привязку (selectPrimaryAgentSession);
 *  - никаких command/effect-полномочий: read-only + навигация/селекция.\n * R95C сохраняет десять legacy PageKey и использует уже существующее R94 отображение stage→module.
 * Контракты: GET /agentchat :3041 (5s, bounded request); renderer не сканирует
 * native tabs и не выводит tab identity из session id, URL или title. ⌘B — свернуть rail.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, BellRing, Command as CommandIcon, ExternalLink,
  ListChecks, MessageSquarePlus, PanelLeft, Play, Search, Shield, Target,
} from "lucide-react";
import { Dot } from "@/components/me2/ui/primitives";
import { useMe2, useKpis } from "@/components/me2/store";
import { toastBus, type Event as Me2Event, type Task } from "@/lib/me2-bus";
import { agentChatOp } from "@/lib/me2-socket";
import { useAgentChatSessions, type AgentChatSession } from "@/hooks/use-agentchat-sessions";

// ── выбор native-вкладки под ME2 session: только Browser canonical binding ────
// Renderer больше не сканирует daemon BROWSER_TABS и не выводит identity из URL:
// Mission Control уже хранит session -> native tab binding после create/adopt.
type NativeSessionSelectResult = {
  state?: "BOUND" | "UNBOUND" | "STALE" | "UNAVAILABLE" | "FAILED" | "INVALID";
  selection_applied?: boolean;
  tab_id?: string | null;
  conversation_url?: string | null;
  error?: string | null;
};

async function openAgentTab(s: AgentChatSession): Promise<void> {
  const shell = (window as Window & {
    metaengineShell?: {
      selectPrimaryAgentSession?: (sessionId: string) => Promise<NativeSessionSelectResult | null>;
    };
  }).metaengineShell;
  if (!shell?.selectPrimaryAgentSession) {
    toastBus({
      title: "native binding недоступен",
      description: `«${s.title}»: COMMAND не использует daemon/tab/URL fallback; откройте Browser-owned shell`,
      variant: "destructive",
    });
    return;
  }

  let result: NativeSessionSelectResult | null = null;
  try {
    result = await shell.selectPrimaryAgentSession(s.id);
  } catch (error) {
    toastBus({
      title: "native selection не выполнен",
      description: String(error instanceof Error ? error.message : error).slice(0, 160),
      variant: "destructive",
    });
    return;
  }
  if (result?.selection_applied === true && result.state === "BOUND") return;

  const state = String(result?.state || "UNAVAILABLE");
  const detail = state === "UNBOUND"
    ? "Browser ещё не создал/не усыновил native-вкладку для этой ME2 session"
    : state === "STALE"
      ? "каноническая привязка устарела; дождитесь Mission Control reconcile"
      : state === "FAILED"
        ? String(result?.error || "native select failed")
        : "каноническая Browser-привязка недоступна";
  toastBus({
    title: `session binding: ${state.toLowerCase()}`,
    description: `«${s.title}»: ${detail}`,
    variant: state === "FAILED" || state === "STALE" ? "destructive" : "default",
  });
}

// ── форматирование (read-only, без новых источников данных) ────────────────────
function ageLabel(ts: string, nowMs: number): string {
  const at = new Date(ts).getTime();
  if (!Number.isFinite(at)) return "—";
  const sec = Math.max(0, Math.round((nowMs - at) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

const OUTCOME_EVENT_TYPES = new Set([
  "TASK_DONE", "TASK_COMPLETED", "TASK_FAILED", "TASK_RETRIED", "TASK_PARKED",
  "COMMAND_COMPLETED", "COMMAND_FAILED",
  "AGENT_CHAT_OUTCOME", "AGENT_CHAT_DEGRADED",
  "GIT_PUSH", "CI_RUN_FINISHED", "APPROVAL_REQUESTED", "APPROVAL_DENIED",
]);

type MissionAttention = {
  id: string;
  label: string;
  detail: string;
  page: "tasks" | "observability" | "system" | "agents";
  tone: "rose" | "amber";
};

// ── Mission Rail (ChatGPT-стиль списка агентов + цель + исходы) ────────────────
function MissionRail({ nowMs }: { nowMs: number }) {
  const setChatId = useMe2((s) => s.setChatId);
  const chatId = useMe2((s) => s.chatId);
  const events = useMe2((s) => s.events);
  const { sessions, status, refresh } = useAgentChatSessions();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const initialPick = useRef(false);

  useEffect(() => {
    const first = sessions.find((s) => s.status === "ACTIVE");
    if (!initialPick.current && first) {
      initialPick.current = true;
      setChatId(first.id);
    }
  }, [sessions, setChatId]);

  const createChat = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    window.dispatchEvent(new CustomEvent("me2:chat-create"));
    try {
      const r = await agentChatOp({ op: "create" });
      if (r.ok && r.session) {
        setChatId(String(r.session.id));
        toastBus({ title: "чат-агент создан ✓", description: `сессия ${String(r.session.id).slice(0, 16)}` });
        void refresh();
      } else {
        toastBus({ title: "чат не создан ✗", description: String(r.error ?? "daemon недоступен"), variant: "destructive" });
      }
    } finally { setCreating(false); }
  }, [creating, refresh, setChatId]);

  const active = useMemo(() => sessions.filter((s) => s.status === "ACTIVE"), [sessions]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return active;
    return active.filter((s) => `${s.title} ${s.role} ${s.model} ${s.objective ?? ""} ${s.summary ?? ""}`.toLowerCase().includes(t));
  }, [active, q]);

  const outcomes = useMemo(
    () => events.filter((e) => OUTCOME_EVENT_TYPES.has(e.type)).slice(0, 3),
    [events],
  );

  return (
    <aside
      className="flex h-full w-[252px] shrink-0 flex-col overflow-hidden border-r border-zinc-800/90 bg-[#0b0b0d]"
      data-testid="agent-sidebar"
      aria-label="Миссия и чат-агенты"
    >
      {/* цель выбранного агента — вершина rail (R95: COMMAND начинается с миссии) */}
      <ObjectiveHeader />

      {/* «чат» — как «New chat» в десктопном ChatGPT */}
      <div className="shrink-0 p-2 pt-1.5">
        <button
          type="button"
          onClick={() => void createChat()}
          disabled={creating}
          title="Создать чат-агента (agentchat:op create)"
          className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          {creating ? "создаём…" : "чат"}
        </button>
        {/* поиск (Search chats) */}
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 transition focus-within:border-zinc-800 hover:border-zinc-800">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="agent-sidebar-filter"
            placeholder="поиск"
            aria-label="Поиск агентов по имени, роли, модели"
            className="h-5 w-full min-w-0 bg-transparent text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          {q && (
            <button type="button" aria-label="Очистить поиск" onClick={() => setQ("")} className="shrink-0 text-zinc-500 transition hover:text-zinc-200">×</button>
          )}
        </div>
      </div>

      {/* список: точка статуса + имя — одинаковая строка, никаких блоков */}
      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] leading-relaxed text-zinc-600">
            {q ? "нет совпадений" : "флот пуст — создайте чат-агента или дождитесь автопилота спроса"}
          </p>
        )}
        {filtered.map((s) => (
          <div
            key={s.id}
            className={`group mb-0.5 flex items-center rounded-md transition ${
              chatId === s.id ? "bg-zinc-800/70" : "hover:bg-zinc-900/70"
            }`}
          >
            <button
              type="button"
              aria-current={chatId === s.id}
              onClick={() => { setChatId(s.id); void openAgentTab(s); }}
              title={`${s.title} · ${s.role} · ${s.model}${s.objective ? `\n🎯 ${s.objective}` : ""}${s.summary ? `\n${s.summary}` : ""}${s.last_error ? `\n⚠ ${s.last_error}` : ""}`}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 py-1.5 text-left focus-visible:outline-none"
            >
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.state === "THINKING" ? "animate-pulse bg-violet-400" : "bg-emerald-400"
                }`}
              />
              {s.role === "SUPERVISOR" && <Shield className="h-3 w-3 shrink-0 text-violet-300" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-zinc-300">{s.title}</span>
              {(s.outcome_status === "blocked" || s.fail_streak >= 3) && (
                <span aria-hidden className="shrink-0 font-mono text-[8px] text-rose-400" title={s.outcome_status === "blocked" ? "агент честно заблокирован" : `${s.fail_streak} провалов подряд`}>
                  {s.outcome_status === "blocked" ? "!" : `deg${s.fail_streak}`}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={`Открыть вкладку z.ai агента ${s.title}`}
              title="Показать вкладку chat.z.ai этого агента в браузере"
              onClick={() => { setChatId(s.id); void openAgentTab(s); }}
              className="mr-1 shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-emerald-300 focus:opacity-100 group-hover:opacity-100"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {/* свежие исходы: 3 моно-строки (R95: исходы видны без ухода со страницы) */}
      <div className="shrink-0 border-t border-zinc-800/70 px-2 py-1" data-testid="mission-rail-outcomes">
        <p className="px-1 pb-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-600">исходы</p>
        {outcomes.length === 0 ? (
          <p className="px-1 pb-1 text-[10px] text-zinc-700">пока тихо — исходы появятся здесь</p>
        ) : outcomes.map((e) => (
          <p key={e.seq} className="flex items-center gap-1.5 truncate px-1 font-mono text-[9px] leading-4" title={`${e.type} · ${e.data.slice(0, 160)}`}>
            <span className="shrink-0 text-zinc-600">{ageLabel(e.ts, nowMs)}</span>
            <span className={`shrink-0 ${e.type.includes("FAIL") || e.type.includes("DENIED") || e.type.includes("DEGRADED") ? "text-rose-400" : "text-emerald-400/90"}`}>{e.type.replace(/^TASK_|^COMMAND_|^AGENT_CHAT_/, "").toLowerCase()}</span>
            <span className="min-w-0 truncate text-zinc-500">{e.task_id ?? e.agent_id ?? ""}</span>
          </p>
        ))}
      </div>

      {/* нижняя строка статуса: одна моно-строка, не блок */}
      <div className="shrink-0 border-t border-zinc-800/70 px-3 py-1.5 font-mono text-[9px] text-zinc-500" title="активных/всего · в ходе · ходы ok/fail · супервизоров">
        {status
          ? `${status.active}/${status.total}${status.thinking ? ` · 💭${status.thinking}` : ""} · ${status.turns_ok}✓/${status.turns_fail}✗${status.supervisors ? ` · sup${status.supervisors}` : ""}`
          : "—"}
      </div>
    </aside>
  );
}

// цель: выбранного агента, иначе цель супервизора, иначе честное «не задана»
function ObjectiveHeader() {
  const chatId = useMe2((s) => s.chatId);
  const { sessions } = useAgentChatSessions();
  const objective = useMemo(() => {
    const selected = chatId ? sessions.find((s) => s.id === chatId) ?? null : null;
    return selected?.objective?.trim() || "";
  }, [chatId, sessions]);

  return (
    <div className="shrink-0 border-b border-zinc-800/70 px-2.5 pb-1.5 pt-2" data-testid="mission-objective">
      <p className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-600">
        <Target className="h-2.5 w-2.5" aria-hidden /> цель
      </p>
      <p className={`mt-0.5 line-clamp-2 text-[11px] leading-4 ${objective ? "text-zinc-300" : "text-zinc-600"}`} title={objective || "цель не задана — выберите агента с objective"}>
        {objective || "не задана — выберите агента с objective"}
      </p>
    </div>
  );
}

// текущий агент: точка + имя + модель + честный исход — одна строка
function CurrentAgent({ chatId }: { chatId: string | null }) {
  const { sessions } = useAgentChatSessions();
  const sess = chatId ? sessions.find((x) => x.id === chatId) ?? null : null;

  if (!chatId || !sess) {
    return <span className="truncate text-[12px] text-zinc-600" data-testid="cc-current-agent">агент не выбран</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2" data-testid="cc-current-agent" title={`${sess.role} · ${sess.model}${sess.objective ? `\n🎯 ${sess.objective}` : ""}`}>
      <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${sess.state === "THINKING" ? "animate-pulse bg-violet-400" : "bg-emerald-400"}`} />
      <span className="truncate text-[12px] font-medium text-zinc-200">{sess.title}</span>
      <span className="shrink-0 font-mono text-[9px] text-zinc-500">{sess.model}</span>
      {sess.outcome_status === "fixed" || sess.outcome_status === "done" ? (
        <span className="shrink-0 font-mono text-[9px] text-emerald-400" title={sess.outcome_proof ? `outcome-proof: ${sess.outcome_proof.slice(0, 120)}` : "исход подтверждён"}>✓ {sess.outcome_status}</span>
      ) : sess.outcome_status === "blocked" ? (
        <span className="shrink-0 font-mono text-[9px] text-rose-400" title="агент честно заблокирован">blocked</span>
      ) : null}
    </span>
  );
}

// ── Mission Stage: objective · active work · attention · outcomes ──────────────
function ActiveWorkCard({ tasks, nowMs }: { tasks: Task[]; nowMs: number }) {
  const openTask = useMe2((s) => s.openTask);
  const setPage = useMe2((s) => s.setPage);

  return (
    <section
      aria-label="Активная работа"
      data-testid="mission-active-work"
      className="flex min-h-0 flex-col border border-zinc-800/70 bg-zinc-950/40"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/60 px-2.5 py-1.5">
        <Play className="h-3 w-3 text-cyan-300" aria-hidden />
        <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">активная работа</h3>
        <button type="button" onClick={() => setPage("tasks")} className="ml-auto flex items-center gap-0.5 font-mono text-[9px] text-zinc-500 transition hover:text-zinc-200" title="Открыть PLAN (Alt+2)">
          план <ArrowRight className="h-2.5 w-2.5" aria-hidden />
        </button>
      </header>
      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        {tasks.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11px] text-zinc-600">
            активных задач нет — очередь пуста (N — новая задача)
          </p>
        ) : tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => openTask(t.id)}
            title={`${t.title}\n${t.status} · шаг ${t.steps}/${t.max_steps}${t.agent_id ? ` · агент ${t.agent_id}` : ""}${t.result ? `\n→ ${t.result.slice(0, 140)}` : ""}${t.error ? `\n⚠ ${t.error.slice(0, 140)}` : ""}`}
            className="mb-0.5 flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left transition hover:bg-zinc-900/70"
          >
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.status === "RUNNING" ? "animate-pulse bg-cyan-400" : "bg-zinc-600"}`} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-300">{t.title}</span>
            <span className="shrink-0 font-mono text-[9px] text-zinc-500">{t.steps}/{t.max_steps}</span>
            <span className="shrink-0 font-mono text-[9px] text-zinc-600">{ageLabel(t.updated_at, nowMs)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AttentionCard({ items }: { items: MissionAttention[] }) {
  const setPage = useMe2((s) => s.setPage);
  return (
    <section
      aria-label="Внимание"
      data-testid="mission-attention"
      className="flex min-h-0 flex-col border border-zinc-800/70 bg-zinc-950/40"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/60 px-2.5 py-1.5">
        <BellRing className={`h-3 w-3 ${items.length > 0 ? "text-amber-300" : "text-zinc-600"}`} aria-hidden />
        <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">внимание</h3>
        <span className="ml-auto font-mono text-[9px] text-zinc-600">{items.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 mc-scroll">
        {items.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11px] text-zinc-600">тихо — деградаций и блокеров нет (silent success)</p>
        ) : items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.page)}
            title={`${item.detail} → ${item.page.toUpperCase()}`}
            className="mb-0.5 flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left transition hover:bg-zinc-900/70"
          >
            <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.tone === "rose" ? "bg-rose-400" : "bg-amber-400"}`} />
            <span className="min-w-0">
              <span className="block truncate text-[11px] text-zinc-300">{item.label}</span>
              <span className="mt-0.5 block truncate text-[9px] text-zinc-600">{item.detail}</span>
            </span>
            <ArrowRight className="ml-auto mt-1 h-2.5 w-2.5 shrink-0 text-zinc-700" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}

function OutcomesCard({ events, nowMs }: { events: Me2Event[]; nowMs: number }) {
  const openTask = useMe2((s) => s.openTask);
  const setPage = useMe2((s) => s.setPage);
  return (
    <section
      aria-label="Свежие исходы"
      data-testid="mission-outcomes"
      className="flex min-h-0 flex-col border border-zinc-800/70 bg-zinc-950/40"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/60 px-2.5 py-1.5">
        <ListChecks className="h-3 w-3 text-emerald-300" aria-hidden />
        <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">свежие исходы</h3>
        <button type="button" onClick={() => setPage("observability")} className="ml-auto flex items-center gap-0.5 font-mono text-[9px] text-zinc-500 transition hover:text-zinc-200" title="Открыть OBSERVE (Alt+6)">
         observe <ArrowRight className="h-2.5 w-2.5" aria-hidden />
        </button>
      </header>
      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        {events.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11px] text-zinc-600">исходов ещё нет — журнал пополнят ходы агентов</p>
        ) : events.map((e) => {
          const bad = e.type.includes("FAIL") || e.type.includes("DENIED") || e.type.includes("DEGRADED");
          return (
            <button
              key={e.seq}
              type="button"
              onClick={() => { if (e.task_id) openTask(e.task_id); }}
              title={`${e.type} · ${e.data.slice(0, 180)}`}
              className={`mb-0.5 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition hover:bg-zinc-900/70 ${e.task_id ? "cursor-pointer" : "cursor-default"}`}
            >
              <span className="shrink-0 font-mono text-[9px] text-zinc-600">{ageLabel(e.ts, nowMs)}</span>
              <span className={`shrink-0 font-mono text-[9px] ${bad ? "text-rose-400" : "text-emerald-400/90"}`}>{e.type.replace(/^TASK_|^COMMAND_|^AGENT_CHAT_/, "").toLowerCase()}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">{e.data.slice(0, 90)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Page: COMMAND CENTER (R95 mission control) ─────────────────────────────────
const COMMAND_RAIL_WEB_MIN_WIDTH = 900; // 252px Mission Rail + a useful mission canvas; no native Browser geometry

export function CommandPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railConstrained, setRailConstrained] = useState(false);
  const preferredRailOpen = useRef(true);
  const railConstrainedRef = useRef(false);
  const chatId = useMe2((s) => s.chatId);
  const connected = useMe2((s) => s.connected);
  const commandRailPreferredOpen = useMe2((s) => s.commandRailPreferredOpen);
  const storeCommandRailPreference = useMe2((s) => s.setCommandRailPreference);
  const snap = useMe2((s) => s.snap);
  const events = useMe2((s) => s.events);
  const mirror = useMe2((s) => s.mirror);
  const setDialog = useMe2((s) => s.setDialog);
  const setPalette = useMe2((s) => s.setPalette);
  const setPage = useMe2((s) => s.setPage);
  const kpis = useKpis();
  const { sessions } = useAgentChatSessions();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const syncPrimaryRail = useCallback(async (preferred: boolean) => {
    // R95C: COMMAND no longer owns native Browser pixels. Rail adaptation is
    // renderer-local presentation state; the legacy main-process bridge stays
    // available only for older shells and is intentionally not consulted here.
    const effective = preferred && window.innerWidth >= COMMAND_RAIL_WEB_MIN_WIDTH;
    const constrained = preferred && !effective;
    railConstrainedRef.current = constrained;
    setRailConstrained(constrained);
    setSidebarOpen(effective);
  }, []);

  const setRailPreference = useCallback((open: boolean) => {
    preferredRailOpen.current = open;
    storeCommandRailPreference(open);
    void syncPrimaryRail(open);
  }, [storeCommandRailPreference, syncPrimaryRail]);

  const toggleRailPreference = useCallback(() => {
    // If main-process geometry forced an otherwise preferred rail closed, a
    // toggle cannot safely make it visible; preserve the preference until the
    // window has enough room instead of accidentally flipping it off.
    if (railConstrainedRef.current && preferredRailOpen.current) return;
    setRailPreference(!preferredRailOpen.current);
  }, [setRailPreference]);

  // One persisted preference, one renderer-local COMMAND projection.
  // Native geometry authority lives on RUN and is intentionally absent here.
  useEffect(() => {
    const preferred = commandRailPreferredOpen;
    preferredRailOpen.current = preferred;
    // Deferred one frame: the rail geometry round-trip must not cascade
    // setState synchronously from the effect body (hydration paints first).
    const syncFrame = window.requestAnimationFrame(() => {
      void syncPrimaryRail(preferred);
    });

    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B" || e.key === "ы" || e.key === "Ы")) {
        e.preventDefault();
        toggleRailPreference();
      }
    };
    let resizeFrame = 0;
    const onResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        void syncPrimaryRail(preferredRailOpen.current);
      });
    };
    window.addEventListener("keydown", h);
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(syncFrame);
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("keydown", h);
      window.removeEventListener("resize", onResize);
    };
  }, [commandRailPreferredOpen, syncPrimaryRail, toggleRailPreference]);

  // ── mission data (только уже собранные store/hook данные) ────────────────────
  const activeWork = useMemo(() => {
    const tasks = snap?.tasks ?? [];
    return tasks
      .filter((t) => t.status === "RUNNING" || t.status === "READY" || t.status === "LEASED")
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 7);
  }, [snap]);

  const attention = useMemo<MissionAttention[]>(() => {
    const tasks = snap?.tasks ?? [];
    const failedTasks = tasks.filter((t) => t.status === "FAILED");
    const blockedAgents = sessions.filter((s) => s.outcome_status === "blocked" || s.fail_streak >= 3);
    const mirrorDegraded = Boolean(mirror && (mirror.mode !== "LIVE" || mirror.pending > 0));
    const budgetPct = Math.round((kpis.budgetUsed / Math.max(1, kpis.budgetLimit)) * 100);
    const items: MissionAttention[] = [];
    if (!connected) items.push({ id: "transport", label: "Transport offline", detail: "Socket :3040 недоступен; REST-fallback может быть активен.", page: "observability", tone: "rose" });
    if (failedTasks.length > 0) items.push({ id: "tasks", label: `${failedTasks.length} failed task${failedTasks.length === 1 ? "" : "s"}`, detail: "В очереди есть проваленные задачи — проверьте evidence перед повтором.", page: "tasks", tone: "rose" });
    if (blockedAgents.length > 0) items.push({ id: "agents", label: `${blockedAgents.length} blocked agent${blockedAgents.length === 1 ? "" : "s"}`, detail: blockedAgents.map((s) => s.title).slice(0, 3).join(", "), page: "agents", tone: "rose" });
    if (mirrorDegraded) items.push({ id: "mirror", label: `Mirror ${mirror?.mode ?? "unknown"}`, detail: `Outbox ${mirror?.pending ?? 0}${mirror?.last_error ? " · " + mirror.last_error.slice(0, 90) : ""}`, page: "observability", tone: "amber" });
    if (kpis.workersOnline === 0) items.push({ id: "workers", label: "0 workers online", detail: "Реестр workers не сообщает живой ёмкости.", page: "system", tone: "amber" });
    if (budgetPct >= 75) items.push({ id: "budget", label: `Command budget ${budgetPct}%`, detail: `${kpis.budgetUsed}/${kpis.budgetLimit} cost units в текущем окне.`, page: "system", tone: "amber" });
    return items;
  }, [snap, sessions, mirror, connected, kpis]);

  const outcomeEvents = useMemo(
    () => events.filter((e) => OUTCOME_EVENT_TYPES.has(e.type)).slice(0, 9),
    [events],
  );

  const missionObjective = useMemo(() => {
    const selected = chatId ? sessions.find((s) => s.id === chatId) ?? null : null;
    return selected?.objective?.trim() || "";
  }, [chatId, sessions]);

  return (
    <div className="flex h-full min-h-0 bg-[#0b0b0d]" data-testid="page-command" data-panel-command>
      {sidebarOpen && <MissionRail nowMs={nowMs} />}
      {/* центр: тонкая строка выбранного агента + МИССИЯ (objective/work/attention/outcomes) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/50 px-2">
          <button
            type="button"
            onClick={toggleRailPreference}
            aria-label={railConstrained ? "Список агентов временно скрыт: окну не хватает ширины" : sidebarOpen ? "Скрыть список агентов" : "Показать список агентов"}
            aria-pressed={sidebarOpen}
            aria-disabled={railConstrained}
            disabled={railConstrained}
            data-testid="cc-sidebar-toggle"
            title={railConstrained ? "Mission Rail временно скрыт, чтобы сохранить полезную ширину mission canvas. Увеличьте окно." : "Список агентов и цель (⌘B)"}
            className="shrink-0 rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <PanelLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <CurrentAgent key={chatId ?? "none"} chatId={chatId} />
          <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[9px] text-zinc-500" title="WS-канал daemon :3040">
            <Dot on={connected} pulse /> {connected ? "LIVE" : "OFF"}
          </span>
        </div>

        {/* деградация — не пустота: честный offline-режим миссии */}
        {!connected ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-amber-900/40 bg-amber-950/15 px-3 py-2" data-testid="mission-offline-banner">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
            <p className="min-w-0 text-[11px] leading-4 text-amber-200/90">
              Транспорт :3040 недоступен — COMMAND работает на последних кэшированных данных (REST-fallback).
              Миссия, внимание и исходы ниже остаются читаемыми; выполнение команд недоступно.
            </p>
          </div>
        ) : null}

        {/* KPI-строка миссии (read-only, без emergency-полномочий) */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800/60 px-3 py-1.5 font-mono text-[9px] text-zinc-500" title="ready · run · done · fail · агенты busy/idle · workers · бюджет">
          <span>ready <span className="text-zinc-300">{kpis.ready}</span></span>
          <span>run <span className="text-cyan-300">{kpis.running}</span></span>
          <span>done <span className="text-emerald-300">{kpis.done}</span></span>
          <span>fail <span className={kpis.fail > 0 ? "text-rose-300" : ""}>{kpis.fail}</span></span>
          <span className="text-zinc-700">·</span>
          <span>busy/idle <span className="text-zinc-300">{kpis.agentsBusy}/{kpis.agentsIdle}</span></span>
          <span>workers <span className="text-zinc-300">{kpis.workersOnline}</span></span>
          <span>budget <span className={kpis.budgetUsed / Math.max(1, kpis.budgetLimit) >= 0.75 ? "text-amber-300" : "text-zinc-300"}>{kpis.budgetUsed}/{kpis.budgetLimit}</span></span>
        </div>

        {/* миссия: objective + quick actions + сетка work/attention/outcomes */}
        <div className="mc-scroll min-h-0 flex-1 overflow-y-auto p-2">
          <section
            aria-label="Текущая цель миссии"
            data-testid="mission-objective-card"
            className="mb-2 flex flex-wrap items-center gap-2 border border-zinc-800/70 bg-zinc-950/40 px-3 py-2"
          >
            <Target className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
            <p className={`min-w-0 flex-1 truncate text-[12px] ${missionObjective ? "text-zinc-200" : "text-zinc-600"}`} title={missionObjective || "цель не задана — выберите агента с objective в Mission Rail"}>
              {missionObjective || "цель не задана — выберите агента с objective в Mission Rail"}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => setDialog("newTask")} className="flex items-center gap-1 border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100" title="Новая задача (N)">
                <ListChecks className="h-3 w-3" aria-hidden /> новая задача
              </button>
              <button type="button" onClick={() => setPalette(true)} className="flex items-center gap-1 border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100" title="Палитра команд (Ctrl/Cmd+K)">
                <CommandIcon className="h-3 w-3" aria-hidden /> команды
              </button>
              <button type="button" onClick={() => setPage("browser")} className="flex items-center gap-1 border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100" title="Открыть RUN — браузер и превью приложения (Alt+4)">
                RUN <ArrowRight className="h-2.5 w-2.5" aria-hidden />
              </button>
            </div>
          </section>

          <div className="grid min-h-0 grid-cols-1 items-stretch gap-2 xl:grid-cols-2">
            <ActiveWorkCard tasks={activeWork} nowMs={nowMs} />
            <AttentionCard items={attention} />
            <div className="xl:col-span-2">
              <OutcomesCard events={outcomeEvents} nowMs={nowMs} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
