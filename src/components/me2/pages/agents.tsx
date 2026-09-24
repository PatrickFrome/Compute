"use client";
// ── ME2 PAGE: AGENTS (R74) — управление всеми AI-агентами ───────────────────────
// Порт legacy (docs/legacy-mission-control.tsx.txt): fleet-panel L2444-2586 —
// FleetGrid (сетка чатов, сам поллит), ФЛОТ·АГЕНТЫ (spawn/модель/pause/retire,
// L2485-2564), cron-чипы fleet-grid + /cron daemon (G7: fire/cancel).
// Верх: FleetGrid | AgentChatPanel (река рассуждений + чат выбранного).
// Низ: РЕЕСТР·АГЕНТЫ | CRON·ЧАТОВ. Точные payload'ы шины — из legacy (L1972-1998).

import { useCallback, useEffect, useState } from "react";
import { Bot, ChevronDown, Clock, Pause, Play, Plus, X, Zap } from "lucide-react";
import FleetGrid from "@/components/me2/fleet-grid";
import AgentChatPanel from "@/components/me2/agent-chat-panel";
import { useMe2 } from "@/components/me2/store";
import { age, hhmmss, me2Fetch, sendCommand, spawnAgent, MODEL_OPTIONS, type Agent } from "@/lib/me2-bus";
import { Chip, Dot, PageHeader, Sec, StatusBadge } from "@/components/me2/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

// /agentchat: сессии несут agent_id (daemon agentchat.ts) — мост «агент → его чат»
type ChatSession = { id: string; agent_id: string; status: string; role: string };

// /cron (G7, daemon cron.ts): ChatCron + policyCaps
type CronRow = {
  id: number; session_id: string; kind: "every" | "daily"; every_minutes: number | null;
  hhmm: string | null; text: string; status: "ACTIVE" | "CANCELLED";
  next_run_at: string; last_run_at: string | null; runs: number; created_at: string;
};
type CronCaps = { crons_per_chat: number; crons_global: number; cron_min_minutes: number };

const SPAWN_ROLES = ["IMPLEMENTER", "RESEARCHER", "OPERATOR"] as const;

export function AgentsPage() {
  const snap = useMe2((s) => s.snap);
  const connected = useMe2((s) => s.connected);
  const setChatId = useMe2((s) => s.setChatId);
  const { toast } = useToast();

  const [modelSel, setModelSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [chatMap, setChatMap] = useState<Record<string, string>>({});
  const [crons, setCrons] = useState<CronRow[]>([]);
  const [caps, setCaps] = useState<CronCaps | null>(null);
  const [cronBusy, setCronBusy] = useState(false);

  // маппинг agent_id → чат-сессия (поллинг /agentchat, 15s)
  const loadChats = useCallback(async () => {
    const d = await me2Fetch<{ sessions?: ChatSession[] }>("/agentchat?XTransformPort=3041");
    if (d?.sessions) {
      const map: Record<string, string> = {};
      for (const s of d.sessions) {
        if (s.status === "ACTIVE" && s.agent_id && !map[s.agent_id]) map[s.agent_id] = s.id;
      }
      setChatMap(map);
    }
  }, []);

  // CRON·ЧАТОВ (G7): список + caps (15s — как cron-поллинг fleet-grid)
  const loadCrons = useCallback(async () => {
    const d = await me2Fetch<{ ok: boolean; crons?: CronRow[]; caps?: CronCaps }>("/cron?XTransformPort=3041");
    if (d?.ok) {
      setCrons((d.crons ?? []).filter((c) => c.status === "ACTIVE"));
      setCaps(d.caps ?? null);
    }
  }, []);

  useEffect(() => {
    // начальная загрузка — через микрозадержку (react-hooks/set-state-in-effect)
    const t0 = window.setTimeout(() => { void loadChats(); void loadCrons(); }, 0);
    const a = window.setInterval(() => void loadChats(), 15_000);
    const b = window.setInterval(() => void loadCrons(), 15_000);
    return () => { window.clearTimeout(t0); window.clearInterval(a); window.clearInterval(b); };
  }, [loadChats, loadCrons]);

  // ── действия реестра (payload'ы 1:1 из legacy L1972-1998) ─────────────────────
  const saveAgentModel = useCallback(async (id: string, model: string) => {
    setBusy(true);
    try {
      await sendCommand("AGENT_MODEL", { agent_id: id, model }, { successMsg: `модель агента → ${model}` });
      setModelSel((m) => { const n = { ...m }; delete n[id]; return n; });
    } finally { setBusy(false); }
  }, []);

  const pauseAgent = useCallback(async (id: string) => {
    await sendCommand("AGENT_PAUSE", { id }, { lane: "CONTROL", successMsg: "агент на паузе — задачи не берёт" });
  }, []);

  const resumeAgent = useCallback(async (id: string) => {
    await sendCommand("AGENT_RESUME", { id }, { lane: "CONTROL", successMsg: "агент снова в строю" });
  }, []);

  const retireAgent = useCallback(async (id: string) => {
    if (!window.confirm("Уволить агента? Задачи агента останутся в очереди, чат-сессии продолжат жить.")) return;
    await sendCommand("AGENT_RETIRE", { id }, { lane: "CONTROL", successMsg: "агент уволен" });
  }, []);

  // клик по строке → открыть чат агента (если есть ACTIVE-сессия с этим agent_id)
  const openAgentChat = useCallback((a: Agent) => {
    const sid = chatMap[a.id];
    if (!sid) {
      toast({ title: "чат-сессии нет", description: `у агента ${a.role} нет активного чата (чаты создаются в AGENT·CHAT / автопилотом спроса)` });
      return;
    }
    setChatId(sid); // store-контракт R74 (выбор агента)
    // legacy-мост панели: AgentChatPanel слушает object-форму detail (как fleet-grid, L75-78)
    window.dispatchEvent(new CustomEvent("me2:select-chat", { detail: { id: sid } }));
  }, [chatMap, setChatId, toast]);

  // ── cron: fire/cancel (POST /cron {op,id} — daemon cron.ts L694-705) ──────────
  const cronOp = useCallback(async (op: "fire" | "cancel", id: number) => {
    setCronBusy(true);
    try {
      const r = await me2Fetch<{ ok: boolean; error?: string }>("/cron?XTransformPort=3041", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, id }),
      });
      if (r?.ok) toast({ title: `cron ${op} ✓ #${id}`, description: op === "fire" ? "чат разбужен вручную (расписание не сдвинуто)" : "расписание отменено" });
      else toast({ title: `cron ${op} ✗ #${id}`, description: String(r?.error ?? "daemon недоступен или задание не активно"), variant: "destructive" });
      await loadCrons();
    } finally { setCronBusy(false); }
  }, [loadCrons, toast]);

  const agents = snap?.agents ?? [];
  const chatsLinked = Object.keys(chatMap).length;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="page-agents" data-panel-agents>
      <PageHeader
        title="AGENTS"
        sub="флот агентов · реестр · чаты · cron"
        actions={
          <>
            <Chip label="агентов" value={agents.length} tone="emerald" title="реестр AGENTS (snapshot.agents)" />
            <Chip label="чатов" value={chatsLinked} tone="violet" title="активных чат-сессий, привязанных к агентам реестра (/agentchat)" />
            <Chip label="cron" value={crons.length} tone="cyan" title="активных cron-заданий чатов (G7)" />
            <Dot on={connected} />
          </>
        }
      />

      <div className="mc-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-1">
        {/* верх: сетка чатов (поллит сама) + река рассуждений / чат выбранного */}
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="min-w-0 lg:flex-[3]">
            <FleetGrid />
          </div>
          <div className="hidden min-w-0 lg:block lg:flex-[2]">
            <AgentChatPanel />
          </div>
        </div>

        {/* низ: реестр агентов + cron чатов */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Sec
            id="agents-registry"
            title={`РЕЕСТР · АГЕНТЫ (${agents.length})`}
            icon={Bot}
            tone="emerald"
            dense
            right={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 gap-1 border-zinc-700 text-[11px]" disabled={busy} data-testid="agents-spawn" aria-label="Создать агента">
                    <Plus className="h-3 w-3" /> агент <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-zinc-800 bg-zinc-950">
                  <DropdownMenuLabel className="text-[10px] text-zinc-500">роль нового агента</DropdownMenuLabel>
                  {SPAWN_ROLES.map((r) => (
                    <DropdownMenuItem key={r} className="text-xs" onClick={() => void spawnAgent(r)}>
                      <Bot className="mr-1.5 h-3.5 w-3.5 text-amber-400" /> {r}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          >
            <div data-testid="agents-registry" className="space-y-0.5" aria-label="Реестр агентов флота">
              {agents.length === 0 && <p className="p-4 text-center text-xs text-zinc-500">флот пуст — создайте агента</p>}
              {agents.map((a) => (
                <div
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openAgentChat(a)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openAgentChat(a); }}
                  title={chatMap[a.id] ? `клик — открыть чат агента (${chatMap[a.id]})` : "чат-сессии у агента нет"}
                  className={`group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-700 ${a.paused === 1 ? "opacity-70 ring-1 ring-amber-900/60" : ""}`}
                >
                  <Dot on={a.status === "IDLE" && a.paused === 0} pulse={a.status === "BUSY"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium">{a.role}</span>
                      {chatMap[a.id] && <span className="shrink-0 rounded border border-violet-900/60 bg-violet-950/30 px-1 text-[8px] text-violet-300" title="есть активная чат-сессия — клик откроет её">чат</span>}
                    </div>
                    <p className="font-mono text-[10px] text-zinc-500">{a.id.slice(0, 14)}… · {age(a.updated_at)} назад</p>
                    {/* модель: черновик-Select + «сохранить» (появляется при изменении) — payload AGENT_MODEL из legacy L1997 */}
                    <div className="mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Select value={modelSel[a.id] ?? a.model} onValueChange={(v) => setModelSel((m) => ({ ...m, [a.id]: v }))}>
                        <SelectTrigger
                          aria-label={`Модель агента ${a.role}`}
                          className="h-5 w-fit gap-1 border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[9px] text-zinc-400 [&>svg]:h-2.5 [&>svg]:w-2.5"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-zinc-800 bg-zinc-950">
                          {MODEL_OPTIONS.map((m) => (
                            <SelectItem key={m} value={m} className="font-mono text-[10px]">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {modelSel[a.id] && modelSel[a.id] !== a.model && (
                        <button
                          type="button"
                          className="flex items-center gap-0.5 rounded border border-emerald-800 bg-emerald-950/50 px-1.5 py-0.5 text-[9px] text-emerald-300 transition hover:bg-emerald-900/60"
                          onClick={() => void saveAgentModel(a.id, modelSel[a.id])}
                          disabled={busy}
                          aria-label={`Сохранить модель ${modelSel[a.id]} для ${a.role}`}
                        >
                          ✓ сохранить
                        </button>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={a.paused === 1 ? "PAUSED" : a.status} />
                  <button
                    type="button"
                    aria-label={a.paused === 1 ? `Возобновить ${a.role}` : `Пауза ${a.role}`}
                    className="rounded p-1 text-zinc-600 opacity-0 transition hover:bg-amber-950 hover:text-amber-400 group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(e) => { e.stopPropagation(); void (a.paused === 1 ? resumeAgent(a.id) : pauseAgent(a.id)); }}
                  >
                    {a.paused === 1 ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    aria-label={`Уволить ${a.role}`}
                    className="rounded p-1 text-zinc-600 opacity-0 transition hover:bg-rose-950 hover:text-rose-400 group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(e) => { e.stopPropagation(); void retireAgent(a.id); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </Sec>

          <Sec
            id="agents-cron"
            title={`CRON · ЧАТОВ (${crons.length})`}
            icon={Clock}
            tone="cyan"
            dense
            right={
              <span className="flex flex-wrap items-center gap-1" title="caps планировщика (policy): глобальный потолок · на чат · минимальный интервал every-задания (анти-шторм)">
                <Chip label="глобал" value={`${crons.length}/${caps?.crons_global ?? "—"}`} tone="cyan" title="активных cron-заданий / глобальный потолок (policy caps)" />
                <Chip label="на чат" value={caps?.crons_per_chat ?? "—"} tone="zinc" title="максимум активных cron-заданий на один чат" />
                <Chip label="min" value={`${caps?.cron_min_minutes ?? "—"}м`} tone="zinc" title="минимальный интервал every-задания (анти-шторм)" />
              </span>
            }
          >
            <div data-testid="agents-cron" className="space-y-0.5" aria-label="Cron-задания чатов (G7)">
              {crons.length === 0 && (
                <p className="p-4 text-center text-xs text-zinc-500">cron-заданий нет — назначаются в чатах: «каждые Nм …» / «ежедневно в HH:MM …» (тик 30с)</p>
              )}
              {crons.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded bg-zinc-900/50 px-1.5 py-1 font-mono text-[9px]" title={`#${c.id} · сессия ${c.session_id} · задание: ${c.text} · запусков: ${c.runs}`}>
                  <span className="shrink-0 text-cyan-300">#{c.id}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-400">{c.text}</span>
                  <span className="shrink-0 rounded border border-zinc-800 bg-zinc-900/60 px-1 text-zinc-400" title="расписание">
                    {c.kind === "daily" ? `daily ${c.hhmm ?? "—"}` : `every ${c.every_minutes ?? "?"}м`}
                  </span>
                  <span className="shrink-0 text-zinc-600" title={`последний запуск: ${c.last_run_at ?? "ещё не срабатывало"}`}>last {c.last_run_at ? hhmmss(c.last_run_at) : "—"}</span>
                  <span className="shrink-0 text-zinc-500" title="следующий запуск (THINKING-чат откладывается на +60с)">next {hhmmss(c.next_run_at)}</span>
                  <button
                    type="button"
                    disabled={cronBusy}
                    aria-label={`Разбудить чат вручную (cron #${c.id})`}
                    title="Ручное срабатывание: будит чат, не двигая расписание (T0)"
                    className="shrink-0 rounded border border-cyan-900 px-1.5 py-0.5 text-[9px] text-cyan-300 transition hover:bg-cyan-950/40 disabled:opacity-40"
                    onClick={() => void cronOp("fire", c.id)}
                  >
                    <Zap className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />fire
                  </button>
                  <button
                    type="button"
                    disabled={cronBusy}
                    aria-label={`Отменить расписание #${c.id}`}
                    title="Отменить расписание (статус → CANCELLED)"
                    className="shrink-0 rounded border border-rose-900/60 px-1.5 py-0.5 text-[9px] text-rose-300 transition hover:bg-rose-950/40 disabled:opacity-40"
                    onClick={() => void cronOp("cancel", c.id)}
                  >
                    <X className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />cancel
                  </button>
                </div>
              ))}
            </div>
          </Sec>
        </div>
      </div>
    </div>
  );
}
