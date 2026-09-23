"use client";
/**
 * ME2 AgentChat Panel (G1+G2, R36) — панель флота агентных чатов.
 * Каждый член флота = постоянный чат (как эта сессия): история, tool-цикл,
 * компакция контекста, workspace. Ход идёт в фоне (202 → poll status).
 * G2: вечно-живущие чаты-супервизоры (тик 60с / перерождение), межчатовая связь
 * (chat_send), эластичное создание чатов агентами.
 * G3: РЕКА РАССУЖДЕНИЙ — все шаги всех чатов одновременно в реальном времени
 * (socket.io :3040 через gateway, события AGENT_CHAT_STEP/MSG/TURN*).
 * G4 (R37): река видит и ШАГИ ПУЛА-ИСПОЛНИТЕЛЕЙ (FLEET_STEP — thought/tool/reply/fail
 * от воркеров под lease) — супервизор и браузер видят ходы исполнителей шаг за шагом.
 * G5 (R37): долгоживущие цели чатов (objective) — показ в панели, назначение оператором.
 * REST daemon :3041 через gateway (/agentchat?XTransformPort=3041).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { MessageSquarePlus, SendHorizontal, Trash2, RefreshCw, Brain, Shield, Radio, Zap, Target } from "lucide-react";

type Session = {
  id: string; agent_id: string; title: string; status: "ACTIVE" | "CLOSED";
  state: "IDLE" | "THINKING"; summary: string; compactions: number;
  turns_ok: number; turns_fail: number; fail_streak: number; model: string; role: string;
  objective: string; created_at: string; updated_at: string;
  outcome_status: string | null; outcome_proof: string | null; outcome_at: string | null;
};
type Msg = { id: number; session_id: string; role: "user" | "assistant" | "tool" | "system"; content: string; meta: Record<string, unknown>; at: string };
type Status = { total: number; active: number; thinking: number; supervisors: number; turns_ok: number; turns_fail: number; compactions: number; degraded: number; in_flight: number };
type RiverItem = {
  key: string; at: string; type: string; session_id: string; kind: string;
  tool: string | null; preview: string; title?: string;
};

const R = (p: string, init?: RequestInit) => fetch(`${p}${p.includes("?") ? "&" : "?"}XTransformPort=3041`, { cache: "no-store", ...init });

const STEP_ICON: Record<string, string> = { thought: "💭", tool: "🔧", reply: "💬", msg: "📨", turn: "✅", fail: "⚠️", created: "✦", closed: "✕", compacted: "⌁", degraded: "🩸", objective: "🎯" };
function stepKind(type: string, kind: string): string {
  if (type === "AGENT_CHAT_STEP") return kind === "tool" ? "tool" : kind === "reply" ? "reply" : "thought";
  if (type === "FLEET_STEP") return kind === "tool" ? "tool" : kind === "reply" ? "reply" : kind === "fail" ? "fail" : "thought"; // G4: шаги пула в ту же реку
  if (type === "AGENT_CHAT_MSG") return "msg";
  if (type === "AGENT_CHAT_OBJECTIVE") return "objective";
  if (type === "AGENT_CHAT_TURN") return "turn";
  if (type === "AGENT_CHAT_TURN_FAILED" || type === "AGENT_CHAT_DEGRADED") return "fail";
  if (type === "AGENT_CHAT_CREATED") return "created";
  if (type === "AGENT_CHAT_CLOSED") return "closed";
  if (type === "AGENT_CHAT_COMPACTED") return "compacted";
  return "thought";
}
const STEP_COLOR: Record<string, string> = {
  thought: "text-zinc-400", tool: "text-amber-300/90", reply: "text-emerald-300/90", msg: "text-violet-300/90",
  turn: "text-emerald-400/70", fail: "text-rose-300/90", created: "text-teal-300/80", closed: "text-zinc-500",
  compacted: "text-cyan-300/70", degraded: "text-rose-400",
};

export default function AgentChatPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [river, setRiver] = useState<RiverItem[]>([]);
  const [riverOpen, setRiverOpen] = useState(true);
  const [wsOn, setWsOn] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const riverRef = useRef<HTMLDivElement>(null);
  const titlesRef = useRef<Record<string, string>>({});
  const wrapRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const j = await R("/agentchat").then((r) => r.json()) as { sessions: Session[]; status: Status };
      setSessions(j.sessions ?? []); setStatus(j.status ?? null);
      titlesRef.current = Object.fromEntries((j.sessions ?? []).map((s) => [s.id, s.title]));
      setSel((cur) => cur ?? j.sessions?.find((s) => s.status === "ACTIVE")?.id ?? null);
    } catch { /* daemon offline */ }
  }, []);

  const loadMsgs = useCallback(async (id: string) => {
    try {
      const j = await R(`/agentchat/${id}`).then((r) => r.json()) as { session: Session; messages: Msg[] };
      setMsgs(j.messages ?? []);
      setThinking(j.session?.state === "THINKING");
    } catch { /* offline */ }
  }, []);

  useEffect(() => { void loadSessions(); const t = setInterval(() => void loadSessions(), 5000); return () => clearInterval(t); }, [loadSessions]);
  useEffect(() => { if (sel) void loadMsgs(sel); }, [sel, loadMsgs]);
  // THINKING → частый poll (ход в фоне, как эта сессия)
  useEffect(() => {
    if (!sel || !thinking) return;
    const t = setInterval(() => void loadMsgs(sel), 2000);
    return () => clearInterval(t);
  }, [sel, thinking, loadMsgs]);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [msgs]);
  useEffect(() => { riverRef.current?.scrollTo({ top: 0 }); }, [river]);

  // R44 G6: связка с сеткой флота — клик по карточке открывает чат прямо здесь (браузер сам держит чаты открытыми)
  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setSel(id);
      wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    window.addEventListener("me2:select-chat", onSelect as EventListener);
    return () => window.removeEventListener("me2:select-chat", onSelect as EventListener);
  }, []);

  // ── G3: река рассуждений — WS-канал daemon (все чаты одновременно, real-time) ──
  useEffect(() => {
    let s: Socket | null = null;
    let cancelled = false;
    (async () => {
      const { io: mk } = await import("socket.io-client");
      if (cancelled) return;
      s = mk("/?XTransformPort=3040", { path: "/", transports: ["websocket", "polling"], reconnectionDelay: 2000, timeout: 8000 }) as Socket;
      s.on("connect", () => setWsOn(true));
      s.on("disconnect", () => setWsOn(false));
      s.on("event", (e: { seq?: number; type?: string; at?: string; ts?: string; agent_id?: string; task_id?: string; data?: string }) => {
        const type = String(e?.type ?? "");
        // G3+G4: река = рассуждения чатов (AGENT_CHAT*) + шаги пул-исполнителей (FLEET_STEP)
        if (!type.startsWith("AGENT_CHAT") && type !== "FLEET_STEP") return;
        let d: Record<string, unknown> = {};
        try { d = JSON.parse(String(e?.data ?? "{}")) as Record<string, unknown>; } catch { /* без данных */ }
        const isPool = type === "FLEET_STEP";
        const sid = isPool ? `pool:${String(d.task_id ?? e?.task_id ?? "")}` : String(d.session_id ?? d.to ?? d.from ?? "");
        const kind = stepKind(type, String(d.kind ?? ""));
        const title = isPool
          ? `⚡${String(d.task_title ?? d.task_id ?? "").slice(0, 22)}`
          : undefined;
        setRiver((prev) => [{
          key: `${e.seq ?? Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          at: String(e?.ts ?? e?.at ?? "").slice(11, 19), // шина несёт ts (R37-фикс: был e.at → всегда --:--:--)
          type, session_id: sid, kind,
          tool: typeof d.tool === "string" ? d.tool : null,
          title,
          preview: String(d.preview ?? "").slice(0, 160) || (type === "AGENT_CHAT_TURN" ? `ход завершён (${d.steps} шагов, ${d.ms}ms)` : ""),
        }, ...prev].slice(0, 60));
      });
    })();
    return () => { cancelled = true; s?.disconnect(); };
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const j = await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "create", title: newTitle || undefined }) }).then((r) => r.json()) as { ok: boolean; session?: Session };
      if (j.ok && j.session) { setSel(j.session.id); setNewTitle(""); await loadSessions(); }
    } finally { setBusy(false); }
  };
  const send = async () => {
    const text = input.trim(); if (!text || !sel || thinking) return;
    setBusy(true); setInput("");
    try {
      const j = await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "turn", id: sel, text }) }).then((r) => r.json()) as { ok: boolean; error?: string };
      if (j.ok) { setThinking(true); void loadMsgs(sel); } else setInput(text);
    } finally { setBusy(false); }
  };
  const close = async (id: string) => {
    await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "close", id }) });
    if (sel === id) { setSel(null); setMsgs([]); }
    void loadSessions();
  };
  const tick = async () => {
    setBusy(true);
    try {
      await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "tick", force: true }) });
      await loadSessions();
    } finally { setBusy(false); }
  };
  // G5: оператор назначает/меняет долгоживущую цель чата
  const editObjective = async (id: string, current: string) => {
    const obj = window.prompt("Долгоживущая цель чата (objective):", current);
    if (obj === null) return;
    await R("/agentchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "objective", id, objective: obj }) });
    void loadSessions();
  };

  const selSession = sessions.find((s) => s.id === sel);
  const titleOf = (sid: string) => titlesRef.current[sid]?.slice(0, 18) ?? sid.slice(0, 10);

  return (
    <div ref={wrapRef} className="shrink-0 border-b border-zinc-800/60 bg-black/20 px-3 py-2" data-testid="agentchat-panel" aria-label="Флот агентных чатов">
      {/* заголовок + чипы */}
      <div className="flex items-center gap-2">
        <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500" title="G1/G2/ME35: флот из полноценных агентных чатов (пересборка механизма старого Electron-браузера: вкладки chat.z.ai + fleet leases → постоянные чат-сессии daemon'а). Ход = tool-цикл (файлы/shell/поиск/create_task/chat_send) с компакцией контекста; каждый ход — в hash-chain evidence. Вечно-живущие супервизоры координируют флот (тик 60с, перерождение)">
          <Brain className={`h-3 w-3 ${status && status.active > 0 ? "text-emerald-300" : "text-zinc-600"}`} aria-hidden /> AGENT·CHAT
        </span>
        <span data-testid="agentchat-chips" className="flex shrink-0 flex-wrap items-center gap-1 font-mono text-[9px]">
          <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="всего сессий / активных">{status ? `${status.total}/${status.active}` : "—"}</span>
          <span className={`rounded border px-1 py-0.5 ${(status?.supervisors ?? 0) > 0 ? "border-violet-900/60 bg-violet-950/30 text-violet-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`} title="вечно-живущих супервизоров (перерождаются при смерти, тик 60с)">🛡 {status?.supervisors ?? "—"}</span>
          <span className={`rounded border px-1 py-0.5 ${thinking ? "border-amber-900/60 bg-amber-950/30 text-amber-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`} title="ходов ok/fail; в полёте = фоновых ходов прямо сейчас">{status ? `${status.turns_ok}✓/${status.turns_fail}✗` : "—"}{status && status.in_flight > 0 ? ` · в полёте ${status.in_flight}` : ""}{thinking ? " · THINKING…" : ""}</span>
          <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1 py-0.5 text-zinc-400" title="компакций контекста (история не удаляется — только элиминируется из контекста, progressive disclosure)">⌁ {status?.compactions ?? "—"}</span>
          {status && status.degraded > 0 && <span className="rounded border border-rose-900/60 bg-rose-950/30 px-1 py-0.5 text-rose-300" title="сессий с 3+ провалами подряд (Outcome River v1)">deg {status.degraded}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <span className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[8px] ${wsOn ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-300" : "border-zinc-800 text-zinc-600"}`} title={wsOn ? "река рассуждений в реальном времени (WS :3040)" : "WS-канал офлайн — только поллинг"}>
            <Radio className={`h-2.5 w-2.5 ${wsOn ? "animate-pulse" : ""}`} aria-hidden /> live
          </span>
          <input
            value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="новый чат…"
            aria-label="Название нового чата"
            className="w-24 rounded border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 placeholder:text-zinc-600 focus:border-emerald-900 focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          />
          <button type="button" onClick={() => void create()} disabled={busy} aria-label="Создать чат агента" data-testid="agentchat-create" className="rounded border border-emerald-900/60 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300/90 transition hover:bg-zinc-800 disabled:opacity-40">
            <MessageSquarePlus className="h-3 w-3" aria-hidden />
          </button>
          <button type="button" onClick={() => void tick()} disabled={busy} aria-label="Тик супервизора сейчас" title="Тик супервизора: обзор флота → координация (force, без ожидания idle)"
            data-testid="agentchat-tick" className="rounded border border-violet-900/60 px-1.5 py-0.5 font-mono text-[9px] text-violet-300 transition hover:bg-zinc-800 disabled:opacity-40">
            <Zap className="h-3 w-3" aria-hidden />
          </button>
          <button type="button" onClick={() => { void loadSessions(); if (sel) void loadMsgs(sel); }} aria-label="Обновить чаты" className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800">
            <RefreshCw className="h-3 w-3" aria-hidden />
          </button>
        </span>
      </div>

      {/* список сессий */}
      {sessions.length > 0 && (
        <div className="mt-1 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {sessions.slice(0, 10).map((s) => (
            <button key={s.id} type="button" onClick={() => setSel(s.id)}
              title={`${s.title} · роль ${s.role} · ${s.model} · ходов ${s.turns_ok}/${s.turns_fail} · компакций ${s.compactions}${s.fail_streak >= 3 ? " · ДЕГРАДАЦИЯ" : ""}`}
              aria-current={sel === s.id}
              className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] transition ${sel === s.id ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-200" : s.role === "SUPERVISOR" ? "border-violet-900/50 bg-violet-950/20 text-violet-300/90 hover:bg-zinc-800" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800"}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.state === "THINKING" ? "animate-pulse bg-amber-400" : s.status === "ACTIVE" ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
              {s.role === "SUPERVISOR" && <Shield className="h-2.5 w-2.5" aria-hidden />}
              {s.title.slice(0, 20)}
              <span className="text-zinc-600">{s.turns_ok}</span>
              {s.outcome_status === "fixed" || s.outcome_status === "done" ? <span className="text-emerald-400" title={`исход: ${s.outcome_proof?.slice(0, 80) ?? s.outcome_status}`}>✓proof</span> : s.outcome_status === "blocked" ? <span className="text-rose-400" title="честно заблокирован">blocked</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* река рассуждений — все чаты одновременно в реальном времени */}
      <div className="mt-1.5">
        <button type="button" onClick={() => setRiverOpen((v) => !v)} aria-expanded={riverOpen}
          className="flex w-full items-center gap-1 font-mono text-[8px] uppercase tracking-wider text-zinc-600 transition hover:text-zinc-400"
          title="Все шаги всех чатов одновременно: мысли, инструменты, ответы, межчатовые сообщения — поток из шины daemon (AGENT_CHAT_*)">
          <Radio className={`h-2.5 w-2.5 ${wsOn ? "text-emerald-400" : "text-zinc-600"}`} aria-hidden />
          река рассуждений флота {riverOpen ? "▾" : "▸"} <span className="text-zinc-700">({river.length})</span>
        </button>
        {riverOpen && (
          <div ref={riverRef} data-testid="agentchat-river" role="log" aria-label="Река рассуждений всех чатов"
            className="mt-0.5 max-h-24 space-y-0.5 overflow-y-auto rounded border border-zinc-800/60 bg-zinc-950/40 p-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar]:w-1.5">
            {river.length === 0 && <p className="py-1 text-center font-mono text-[8px] text-zinc-700">поток пуст — запусти ход любого чата; шаги появятся здесь в реальном времени</p>}
            {river.map((it) => (
              <div key={it.key} className="flex items-start gap-1 font-mono text-[8px] leading-snug">
                <span className="shrink-0 text-zinc-700">{it.at || "--:--:--"}</span>
                <button type="button" onClick={() => it.session_id && setSel(it.session_id)} className={`shrink-0 font-semibold ${STEP_COLOR[it.kind] ?? "text-zinc-400"} hover:underline`} title={`перейти к чату ${it.session_id}`}>
                  {STEP_ICON[it.kind] ?? "·"} {it.title ?? titleOf(it.session_id)}
                </button>
                <span className="min-w-0 flex-1 truncate text-zinc-500" title={it.preview}>
                  {it.tool && <span className="text-amber-500/70">[{it.tool}] </span>}{it.preview || it.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* цель выбранного чата (G5: долгоживущий objective — виден всегда, редактирует оператор) */}
      {sel && (
        <div className="mt-1 flex items-start gap-1 rounded border border-amber-900/40 bg-amber-950/20 px-1.5 py-1" data-testid="agentchat-objective">
          <Target className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
          <p className="min-w-0 flex-1 font-mono text-[9px] leading-snug text-amber-200/90" title="Долгоживущая цель чата: назначается оператором или супервизором (set_objective), видна агенту в каждом ходу и во всех обзорах флота">
            {selSession?.objective || "цель не задана — клик «изменить» или супервизор назначит сам"}
          </p>
          <button type="button" onClick={() => sel && void editObjective(sel, selSession?.objective ?? "")} aria-label="Изменить цель чата" data-testid="agentchat-objective-edit"
            className="shrink-0 rounded border border-amber-900/50 px-1 py-0.5 font-mono text-[8px] text-amber-300/90 transition hover:bg-zinc-800">изменить</button>
        </div>
      )}

      {/* лента сообщений выбранной сессии */}
      {sel && (
        <div className="mt-1.5">
          <div ref={boxRef} data-testid="agentchat-msgs" role="log" aria-label="История чата агента"
            className="max-h-44 space-y-1 overflow-y-auto rounded border border-zinc-800/80 bg-zinc-950/60 p-1.5 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar]:w-1.5">
            {msgs.length === 0 && <p className="py-2 text-center font-mono text-[9px] text-zinc-600">пусто — напиши агенту первое сообщение</p>}
            {msgs.map((m) => {
              const interchat = typeof m.meta?.from_chat === "string";
              return (
                <div key={m.id} className={`flex ${m.role === "user" && !interchat ? "justify-end" : "justify-start"}`}>
                  <div title={`${m.role} · ${m.at}${interchat ? ` · межчат от ${String(m.meta.from_chat)}` : ""}${typeof m.meta?.tool === "string" ? ` · tool: ${m.meta.tool}` : ""}`}
                    className={`max-w-[88%] rounded px-1.5 py-1 font-mono text-[9px] leading-relaxed ${interchat ? "border border-violet-900/50 bg-violet-950/30 text-violet-200" : m.role === "user" ? "bg-emerald-950/40 text-emerald-100" : m.role === "tool" ? "max-w-full whitespace-pre-wrap break-all border border-amber-950/50 bg-amber-950/20 text-amber-200/80" : m.role === "system" ? "w-full border border-zinc-800/60 bg-zinc-900/40 italic text-zinc-500" : "border border-zinc-800 bg-zinc-900/70 text-zinc-200"}`}>
                    {m.role === "tool" ? m.content.slice(0, 400) : m.content}
                  </div>
                </div>
              );
            })}
            {thinking && <p className="animate-pulse pl-1 font-mono text-[9px] text-amber-300/80">агент думает и работает инструментами…</p>}
          </div>
          <div className="mt-1 flex items-center gap-1">
            <input
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={thinking ? "агент работает…" : "сообщение агенту (умеет: файлы, shell, поиск, create_task, chat_send)…"}
              aria-label="Сообщение агенту" disabled={thinking}
              data-testid="agentchat-input"
              className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-900 focus:outline-none disabled:opacity-50"
            />
            <button type="button" onClick={() => void send()} disabled={busy || thinking || !input.trim()} aria-label="Отправить" data-testid="agentchat-send"
              className="shrink-0 rounded border border-emerald-900/60 bg-emerald-950/30 px-2 py-1 font-mono text-[9px] text-emerald-300 transition hover:bg-zinc-800 disabled:opacity-40">
              <SendHorizontal className="h-3 w-3" aria-hidden />
            </button>
            <button type="button" onClick={() => sel && void close(sel)} aria-label="Закрыть сессию" title="Закрыть сессию (история остаётся; супервизор переродится сам)"
              className="shrink-0 rounded border border-zinc-800 px-1.5 py-1 font-mono text-[9px] text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-300">
              <Trash2 className="h-3 w-3" aria-hidden />
            </button>
          </div>
          {selSession && selSession.fail_streak >= 3 && (
            <p className="mt-1 font-mono text-[9px] text-rose-400" role="alert">Outcome River: {selSession.fail_streak} провалов подряд — проверь last_error сессии</p>
          )}
        </div>
      )}
    </div>
  );
}
