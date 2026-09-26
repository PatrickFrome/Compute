"use client";
/**
 * ME2 COMMAND CENTER (R75, Page 1) — минималистичный рабочий центр в духе
 * десктопного ChatGPT (архитектурный референс оператора, trace 1a0d57bcd7272d81):
 *  - слева ТОЛЬКО чат-агенты: список как список переписок (точка статуса + имя),
 *    поиск, «+ чат»; никаких информационных блоков — детали в title-tooltip;
 *  - в центре НАСТОЯЩИЙ браузер (BrowserStage: live-скринкаст daemon-браузера),
 *    который открывает НАСТОЯЩЕГО чат-агента в z.ai — клик по агенту в списке
 *    выбирает его вкладку chat.z.ai (BROWSER_SELECT_TAB) и скринкаст следует за ней;
 *  - ничего больше: супервизор/чаты/цели живут на своих Pages (Alt+6/Alt+2),
 *    global-инфо — в статус-баре снизу (Global vs Local, дизайн-контракт §9).
 * Контракты: GET /agentchat :3041 (5s); tab-match: url∋session.id → title ⊇ title
 * → единственная z.ai-вкладка; иначе честный тост-подсказка. ⌘B — свернуть список.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, MessageSquarePlus, PanelLeft, Search, Shield } from "lucide-react";
import { Dot } from "@/components/me2/ui/primitives";
import { useMe2 } from "@/components/me2/store";
import { toastBus, sendCommand, loadBrowserTabs, type BrowserTab } from "@/lib/me2-bus";
import { agentChatOp } from "@/lib/me2-socket";
import { BrowserStage } from "@/components/me2/stages/browser-stage";
import { useAgentChatSessions, type AgentChatSession } from "@/hooks/use-agentchat-sessions";

// ── выбор вкладки chat.z.ai под сессию (url∋id → title → единственная z.ai) ─────
async function openAgentTab(s: AgentChatSession): Promise<void> {
  const tabs: BrowserTab[] = await loadBrowserTabs();
  if (tabs.length === 0) {
    toastBus({ title: "браузер daemon пуст", description: `вкладка для «${s.title}» не найдена — «+» в адресной строке откроет z.ai` });
    return;
  }
  const t = s.title.trim().toLowerCase();
  const zai = tabs.filter((x) => (x.url ?? "").includes("z.ai"));
  const pick =
    tabs.find((x) => (x.url ?? "").toLowerCase().includes(s.id.toLowerCase())) ??
    (t ? tabs.find((x) => (x.title ?? "").toLowerCase().includes(t)) : undefined) ??
    (zai.length === 1 ? zai[0] : undefined);
  if (pick) {
    await sendCommand("BROWSER_SELECT_TAB", { tab: pick.id }, { lane: "CONTROL", quiet: true });
  } else if (zai.length === 0) {
    toastBus({ title: "z.ai-вкладка не найдена", description: `«${s.title}»: откройте chat.z.ai кнопкой «+» над скринкастом` });
  } else {
    toastBus({ title: "выберите вкладку вручную", description: `«${s.title}»: z.ai-вкладок ${zai.length}, соответствие по имени не найдено` });
  }
}

// ── Agent Sidebar (ChatGPT-стиль: только список переписок-агентов) ──────────────
function AgentSidebar() {
  const setChatId = useMe2((s) => s.setChatId);
  const chatId = useMe2((s) => s.chatId);
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

  return (
    <aside
      className="flex h-full w-[252px] shrink-0 flex-col overflow-hidden border-r border-zinc-800/90 bg-[#0b0b0d]"
      data-testid="agent-sidebar"
      aria-label="Чат-агенты"
    >
      {/* «+ чат» — как «New chat» в десктопном ChatGPT */}
      <div className="shrink-0 p-2">
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

      {/* нижняя строка статуса: одна моно-строка, не блок */}
      <div className="shrink-0 border-t border-zinc-800/70 px-3 py-1.5 font-mono text-[9px] text-zinc-500" title="активных/всего · в ходе · ходы ok/fail · супервизоров">
        {status
          ? `${status.active}/${status.total}${status.thinking ? ` · 💭${status.thinking}` : ""} · ${status.turns_ok}✓/${status.turns_fail}✗${status.supervisors ? ` · sup${status.supervisors}` : ""}`
          : "—"}
      </div>
    </aside>
  );
}

// ── Page: COMMAND CENTER ────────────────────────────────────────────────────────
const COMMAND_RAIL_LS = "me2.command.agent-rail.v1";
const COMMAND_RAIL_WEB_MIN_WIDTH = 984; // mirrors native 6 + 252 + 720 + 6 geometry gate

export function CommandPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const preferredRailOpen = useRef(true);
  const chatId = useMe2((s) => s.chatId);
  const connected = useMe2((s) => s.connected);

  const syncPrimaryRail = useCallback(async (preferred: boolean) => {
    const shell = (window as Window & {
      metaengineShell?: {
        setPrimaryCommandRail?: (open: boolean) => Promise<{ effective_open?: boolean } | null>;
      };
    }).metaengineShell;
    if (!shell?.setPrimaryCommandRail) {
      setSidebarOpen(preferred && window.innerWidth >= COMMAND_RAIL_WEB_MIN_WIDTH);
      return;
    }
    try {
      const result = await shell.setPrimaryCommandRail(preferred);
      setSidebarOpen(typeof result?.effective_open === "boolean" ? result.effective_open : preferred);
    } catch {
      // Presentation bridge failure must not create command authority or leave a
      // phantom rail over native pixels. Fail closed to the no-rail layout.
      setSidebarOpen(false);
    }
  }, []);

  const setRailPreference = useCallback((open: boolean) => {
    preferredRailOpen.current = open;
    try { localStorage.setItem(COMMAND_RAIL_LS, open ? "1" : "0"); } catch { /* private mode */ }
    void syncPrimaryRail(open);
  }, [syncPrimaryRail]);

  // One preference, two projections: React rail + main-process native viewport.
  // The main process remains geometry authority and may force the rail closed
  // when the protected Browser minimum width would otherwise be violated.
  useEffect(() => {
    let preferred = true;
    try {
      const stored = localStorage.getItem(COMMAND_RAIL_LS);
      if (stored === "0") preferred = false;
      else if (stored === "1") preferred = true;
    } catch { /* private mode */ }
    preferredRailOpen.current = preferred;
    void syncPrimaryRail(preferred);

    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B" || e.key === "ы" || e.key === "Ы")) {
        e.preventDefault();
        setRailPreference(!preferredRailOpen.current);
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
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("keydown", h);
      window.removeEventListener("resize", onResize);
    };
  }, [setRailPreference, syncPrimaryRail]);

  return (
    <div className="flex h-full min-h-0 bg-[#0b0b0d]" data-testid="page-command" data-panel-command>
      {sidebarOpen && <AgentSidebar />}
      {/* центр: тонкая строка выбранного агента + НАСТОЯЩИЙ браузер (всё остальное пространство) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/50 px-2">
          <button
            type="button"
            onClick={() => setRailPreference(!preferredRailOpen.current)}
            aria-label={sidebarOpen ? "Скрыть список агентов" : "Показать список агентов"}
            aria-pressed={sidebarOpen}
            data-testid="cc-sidebar-toggle"
            title="Список агентов (⌘B)"
            className="shrink-0 rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <PanelLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <CurrentAgent key={chatId ?? "none"} chatId={chatId} />
          <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[9px] text-zinc-500" title="WS-канал daemon :3040">
            <Dot on={connected} pulse /> {connected ? "LIVE" : "OFF"}
          </span>
        </div>
        <BrowserStage compact defaultCastOn />
      </div>
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
