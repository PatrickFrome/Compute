"use client";

/**
 * ME2 · MISSION CONTROL — операторская консоль METAENGINE 2 (M2).
 * 3 колонки: ФЛОТ / ОЧЕРЕДЬ / EVENT-LOG. ⌘K командная палитра. Статус-бар (sticky footer).
 * Каналы: WS :3040 (socket.io, snapshot push + события + команды), REST :3041 (fallback).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, Bot, Boxes, Cpu, Crosshair, Gauge, ListChecks, Pause, Play, Plus,
  Radar, RefreshCw, Rocket, Terminal, Trash2, X, Zap, CheckCircle2, AlertTriangle,
} from "lucide-react";

// ── типы (зеркало store.ts daemon) ────────────────────────────────
type Agent = { id: string; role: string; status: string; model: string; created_at: string; updated_at: string };
type Task = {
  id: string; title: string; spec: string; role: string | null; status: string;
  agent_id: string | null; max_steps: number; steps: number; result: string | null;
  error: string | null; created_at: string; updated_at: string;
};
type Worker = { id: string; role: string; kind: string; state: string; generation: number; created_at: string; heartbeat_at: string };
type Command = {
  id: string; action: string; lane: string; status: string; cost: number;
  created_at: string; error: string | null; result: string | null;
};
type Event = { seq: number; ts: string; type: string; agent_id: string | null; task_id: string | null; data: string };
type Snapshot = {
  ok: boolean; ts: string; agents: Agent[]; tasks: Task[]; workers: Worker[];
  commands: Command[]; events: Event[];
  budget: { used: number; limit: number; window_ms: number };
  stats: Record<string, number>;
  meta: { version: string; boot: string };
};

const WS_OPTS = { path: "/", transports: ["websocket", "polling"], reconnectionDelay: 2000, timeout: 8000 };

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}м`;
  return `${Math.floor(ms / 3_600_000)}ч`;
}

const EVENT_STYLE: Record<string, string> = {
  TASK_QUEUED: "text-emerald-400", TASK_LEASED: "text-amber-400", TASK_DONE: "text-emerald-300",
  TASK_COMPLETED: "text-emerald-300", TASK_FAILED: "text-rose-400", TASK_CANCELLED: "text-zinc-400",
  AGENT_CREATED: "text-amber-300", AGENT_RETIRED: "text-zinc-500",
  COMMAND_ENQUEUED: "text-fuchsia-400", COMMAND_LEASED: "text-fuchsia-300",
  COMMAND_COMPLETED: "text-emerald-400", COMMAND_FAILED: "text-rose-400",
  STEP_START: "text-zinc-500", STEP_DONE: "text-zinc-500",
  TOOL_CALL: "text-cyan-300", TOOL_RESULT: "text-cyan-500",
  ENVIRONMENT_RESET: "text-rose-300", FLEET_RECONCILED: "text-amber-400",
};

const STATUS_BADGE: Record<string, string> = {
  READY: "bg-zinc-700 text-zinc-200", RUNNING: "bg-amber-500/90 text-black",
  COMPLETED: "bg-emerald-600 text-white", FAILED: "bg-rose-600 text-white",
  CANCELLED: "bg-zinc-600 text-zinc-300", PENDING: "bg-zinc-700 text-zinc-300",
  LEASED: "bg-amber-500/80 text-black", REJECTED: "bg-rose-800 text-rose-200",
  BUSY: "bg-amber-500/90 text-black", IDLE: "bg-emerald-700 text-emerald-100",
  OFFLINE: "bg-zinc-800 text-zinc-500",
};

function Dot({ on, pulse }: { on: boolean; pulse?: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${on ? "bg-emerald-400" : "bg-rose-500"} ${pulse && on ? "animate-pulse" : ""}`} />
  );
}

export default function MissionControl() {
  const { toast } = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveTail, setLiveTail] = useState(true);
  const [filter, setFilter] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [detail, setDetail] = useState<Task | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // форма новой задачи
  const [fTitle, setFTitle] = useState("");
  const [fSpec, setFSpec] = useState("");
  const [fRole, setFRole] = useState("ANY");
  const [fSteps, setFSteps] = useState("6");

  const logRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);

  // ── WS подключение ──────────────────────────────────────────────
  useEffect(() => {
    let s: Socket | null = null;
    let hb: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const { io: mk } = await import("socket.io-client");
      s = mk("/?XTransformPort=3040", WS_OPTS) as Socket;
      setSocket(s);
      s.on("connect", () => {
        setConnected(true);
        s?.emit("subscribe");
      });
      s.on("disconnect", () => setConnected(false));
      s.on("hello", (h: { boot: string; last_seq: number }) => {
        lastSeqRef.current = h.last_seq;
      });
      s.on("snapshot", (data: Snapshot) => {
        if (!data?.ok) return;
        setSnap(data);
        if (data.events?.length) {
          setEvents((prev) => {
            const map = new Map(prev.map((e) => [e.seq, e]));
            for (const e of data.events) map.set(e.seq, e);
            return [...map.values()].sort((a, b) => b.seq - a.seq).slice(0, 300);
          });
        }
      });
      s.on("event", (e: Event) => {
        if (!liveTail) return;
        setEvents((prev) => [e, ...prev].slice(0, 300));
      });
      hb = setInterval(() => {
        s?.emit("heartbeat", { role: "console", state: "IDLE" }, () => { /* ack */ });
      }, 15_000);
    })();
    return () => { s?.close(); if (hb) clearInterval(hb); };
  }, []);

  // REST fallback начального состояния
  useEffect(() => {
    fetch("/state?XTransformPort=3041")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) { setSnap(d); setEvents(d.events ?? []); } })
      .catch(() => { /* daemon оффлайн — WS покажет статус */ });
  }, []);

  // автоскролл лога
  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = 0;
  }, [events, autoScroll]);

  // ⌘K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); setCmdOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // ── команды ─────────────────────────────────────────────────────
  const sendCommand = useCallback(async (
    action: string,
    payload: Record<string, unknown> = {},
    opts: { lane?: string; quiet?: boolean; successMsg?: string } = {},
  ): Promise<unknown | null> => {
    setBusyAction(true);
    const idem = `${action.toLowerCase()}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const viaWs = (): Promise<unknown | null> => new Promise((resolve) => {
      if (!socket?.connected) return resolve(null);
      const t = setTimeout(() => resolve(null), 8000);
      socket.emit("command", { action, payload, idempotency_key: idem, lane: opts.lane }, (r: { ok: boolean; error?: string; result?: unknown }) => {
        clearTimeout(t); resolve(r);
      });
    });
    let res = await viaWs();
    if (!res) {
      try {
        const r = await fetch("/commands?XTransformPort=3041", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, payload, idempotency_key: idem, lane: opts.lane }),
        });
        res = await r.json();
      } catch { res = null; }
    }
    setBusyAction(false);
    const ok = !!(res as { ok?: boolean })?.ok;
    if (!opts.quiet) {
      toast({
        title: ok ? `${action} ✓` : `${action} ✗`,
        description: ok ? (opts.successMsg ?? "команда исполнена шиной") : String((res as { error?: string })?.error ?? "ошибка"),
        variant: ok ? "default" : "destructive",
      });
    }
    return ok ? (res as { result?: unknown })?.result ?? res : null;
  }, [socket, toast]);

  const spawnAgent = useCallback(async (role: string) => {
    await sendCommand("AGENT_SPAWN", { role, model: "zai:default" }, { successMsg: `агент ${role} создан` });
    setCmdOpen(false);
  }, [sendCommand]);

  const createTask = useCallback(async () => {
    if (!fSpec.trim()) { toast({ title: "Спецификация обязательна", variant: "destructive" }); return; }
    const res = await sendCommand("TASK_ENQUEUE", {
      title: fTitle.trim() || fSpec.slice(0, 60),
      spec: fSpec.trim(),
      role: fRole === "ANY" ? null : fRole,
      max_steps: Number(fSteps) || 6,
    }, { quiet: true });
    const r = res as { task?: Task } | null;
    if (r?.task) {
      toast({ title: "Задача поставлена", description: r.task.id });
      setNewTaskOpen(false); setFTitle(""); setFSpec(""); setCmdOpen(false);
    } else {
      toast({ title: "TASK_ENQUEUE ✗", description: "не удалось поставить задачу", variant: "destructive" });
    }
  }, [fTitle, fSpec, fRole, fSteps, sendCommand, toast]);

  const cancelTask = useCallback(async (id: string) => {
    await sendCommand("TASK_CANCEL", { id }, { lane: "CONTROL", successMsg: "задача отменена" });
    setDetail(null);
  }, [sendCommand]);

  const retireAgent = useCallback(async (id: string) => {
    await sendCommand("AGENT_RETIRE", { id }, { lane: "CONTROL", successMsg: "агент уволен" });
  }, [sendCommand]);

  const environmentReset = useCallback(async () => {
    setResetConfirm(false);
    await sendCommand("ENVIRONMENT_RESET", { by: "operator" }, { lane: "EMERGENCY", successMsg: "среда сброшена (EMERGENCY)" });
  }, [sendCommand]);

  // ── производные ─────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    if (!filter.trim()) return events;
    const f = filter.toLowerCase();
    return events.filter((e) => e.type.toLowerCase().includes(f) || (e.data ?? "").toLowerCase().includes(f));
  }, [events, filter]);

  const stats = snap?.stats ?? {};
  const budget = snap?.budget ?? { used: 0, limit: 24 };
  const budgetPct = Math.min(100, Math.round((budget.used / Math.max(1, budget.limit)) * 100));

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:h-screen">
      {/* ── HEADER ── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 backdrop-blur">
        <Radar className="h-5 w-5 text-emerald-400" aria-hidden />
        <h1 className="text-sm font-bold tracking-[0.2em]">ME2 · MISSION CONTROL</h1>
        <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-400">
          v{snap?.meta.version ?? "?"}
        </Badge>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
          <span className="hidden items-center gap-1.5 md:flex" aria-live="polite">
            <Dot on={connected} pulse /> {connected ? "WS LIVE" : "WS OFFLINE"}
          </span>
          <span className="hidden font-mono lg:inline">seq {events[0]?.seq ?? 0}</span>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 border-zinc-700 text-xs" onClick={() => setCmdOpen(true)}>
            <Terminal className="h-3.5 w-3.5" /> ⌘K
          </Button>
        </div>
      </header>

      {/* ── MAIN: 3 колонки ── */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-3 lg:overflow-hidden">
        {/* Колонка 1: ФЛОТ */}
        <section className="flex min-h-0 flex-col gap-4 lg:overflow-hidden" aria-label="Флот">
          <Card className="flex min-h-0 flex-col border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Bot className="h-4 w-4 text-emerald-400" /> ФЛОТ · АГЕНТЫ ({snap?.agents.length ?? 0})
              </CardTitle>
              <Button size="sm" variant="outline" className="h-7 gap-1 border-zinc-700 text-[11px]" onClick={() => spawnAgent("IMPLEMENTER")} disabled={busyAction}>
                <Plus className="h-3 w-3" /> агент
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto p-2 max-h-72 lg:max-h-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
              {(snap?.agents ?? []).length === 0 && (
                <p className="p-4 text-center text-xs text-zinc-500">флот пуст — создайте агента</p>
              )}
              {(snap?.agents ?? []).map((a) => (
                <div key={a.id} className="group flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-zinc-800/60">
                  <Dot on={a.status === "IDLE"} pulse={a.status === "BUSY"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium">{a.role}</span>
                      <Badge variant="outline" className="h-4 border-zinc-700 px-1 font-mono text-[9px] text-zinc-500">{a.model}</Badge>
                    </div>
                    <p className="font-mono text-[10px] text-zinc-500">{a.id.slice(0, 14)}… · {age(a.updated_at)} назад</p>
                  </div>
                  <Badge className={`${STATUS_BADGE[a.status] ?? ""} h-5 px-1.5 text-[10px]`}>{a.status}</Badge>
                  <button
                    aria-label={`Уволить ${a.role}`}
                    className="rounded p-1 text-zinc-600 opacity-0 transition hover:bg-rose-950 hover:text-rose-400 group-hover:opacity-100"
                    onClick={() => retireAgent(a.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Cpu className="h-4 w-4 text-amber-400" /> WORKERS ({snap?.workers.length ?? 0})
              </CardTitle>
              <span className="font-mono text-[10px] text-zinc-500">heartbeat 15s · reap 90s</span>
            </CardHeader>
            <CardContent className="max-h-40 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
              {(snap?.workers ?? []).length === 0 && (
                <p className="p-3 text-center text-xs text-zinc-500">нет подключённых workers</p>
              )}
              {(snap?.workers ?? []).map((w) => (
                <div key={w.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800/60">
                  <Dot on={w.state !== "OFFLINE"} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{w.id.slice(0, 18)}</span>
                  <Badge variant="outline" className="h-4 border-zinc-700 px-1 font-mono text-[9px] text-amber-400/80">{w.kind}</Badge>
                  <Badge className={`${STATUS_BADGE[w.state] ?? ""} h-4 px-1 text-[9px]`}>{w.state}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Колонка 2: ОЧЕРЕДЬ */}
        <section className="flex min-h-0 flex-col gap-4 lg:overflow-hidden" aria-label="Очередь задач">
          <Card className="flex min-h-0 flex-1 flex-col border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <ListChecks className="h-4 w-4 text-emerald-400" /> ОЧЕРЕДЬ ЗАДАЧ ({snap?.tasks.length ?? 0})
              </CardTitle>
              <Button size="sm" className="h-7 gap-1 bg-emerald-600 text-[11px] hover:bg-emerald-500" onClick={() => setNewTaskOpen(true)}>
                <Plus className="h-3 w-3" /> задача
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 max-h-96 lg:max-h-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
              {(snap?.tasks ?? []).length === 0 && (
                <p className="p-4 text-center text-xs text-zinc-500">очередь пуста</p>
              )}
              {(snap?.tasks ?? []).map((t) => (
                <button
                  key={t.id}
                  className="w-full rounded-md border border-zinc-800/80 bg-zinc-900/60 p-2.5 text-left transition hover:border-zinc-600 hover:bg-zinc-800/60"
                  onClick={() => setDetail(t)}
                >
                  <div className="flex items-center gap-2">
                    <Badge className={`${STATUS_BADGE[t.status] ?? ""} h-5 px-1.5 text-[10px]`}>{t.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">{age(t.created_at)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={(t.steps / Math.max(1, t.max_steps)) * 100} className="h-1 flex-1 bg-zinc-800 [&>div]:bg-emerald-500" />
                    <span className="font-mono text-[9px] text-zinc-500">{t.steps}/{t.max_steps} шаг.</span>
                    {t.role && <Badge variant="outline" className="h-4 border-zinc-700 px-1 text-[9px] text-zinc-500">{t.role}</Badge>}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Zap className="h-4 w-4 text-fuchsia-400" /> COMMAND BUS
              </CardTitle>
              <span className="font-mono text-[10px] text-zinc-500">бюджет {budget.used}/{budget.limit} / 60s</span>
            </CardHeader>
            <CardContent className="max-h-36 space-y-1 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700">
              {(snap?.commands ?? []).slice(0, 12).map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800/60">
                  <Badge variant="outline" className="h-4 border-fuchsia-800 px-1 font-mono text-[9px] text-fuchsia-400">{c.lane}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{c.action}</span>
                  <span className="font-mono text-[9px] text-zinc-600">cost {c.cost}</span>
                  <Badge className={`${STATUS_BADGE[c.status] ?? ""} h-4 px-1 text-[9px]`}>{c.status}</Badge>
                </div>
              ))}
              {(snap?.commands ?? []).length === 0 && <p className="p-3 text-center text-xs text-zinc-500">шина пуста</p>}
            </CardContent>
          </Card>
        </section>

        {/* Колонка 3: EVENT LOG */}
        <section className="flex min-h-0 flex-col gap-4 lg:overflow-hidden" aria-label="Журнал событий">
          <Card className="flex min-h-0 flex-1 flex-col border-zinc-800 bg-zinc-900/40">
            <CardHeader className="flex-row items-center justify-between space-y-0 gap-2 border-b border-zinc-800 py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold tracking-widest text-zinc-400">
                <Activity className="h-4 w-4 text-cyan-400" /> EVENT LOG
              </CardTitle>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                  {liveTail ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {liveTail ? "live" : "пауза"}
                  <Switch checked={liveTail} onCheckedChange={setLiveTail} aria-label="Живой хвост событий" className="scale-75" />
                </label>
              </div>
            </CardHeader>
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
              <Input
                value={filter} onChange={(e) => setFilter(e.target.value)}
                placeholder="фильтр: тип или данные…"
                className="h-7 border-zinc-800 bg-zinc-900 font-mono text-[11px]"
              />
              <label className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
                автоскролл
                <Switch checked={autoScroll} onCheckedChange={setAutoScroll} aria-label="Автоскролл лога" className="scale-75" />
              </label>
            </div>
            <CardContent
              ref={logRef}
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 font-mono text-[10.5px] leading-relaxed max-h-96 lg:max-h-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent"
            >
              {filteredEvents.length === 0 && (
                <p className="p-4 text-center text-zinc-500">{events.length ? "ничего не найдено по фильтру" : "ожидание событий…"}</p>
              )}
              {filteredEvents.map((e) => (
                <div key={e.seq} className="flex gap-2 rounded px-1.5 py-0.5 hover:bg-zinc-800/50">
                  <span className="shrink-0 text-zinc-600">{e.seq}</span>
                  <span className="shrink-0 text-zinc-500">{new Date(e.ts).toLocaleTimeString("ru-RU", { hour12: false })}</span>
                  <span className={`w-36 shrink-0 font-semibold ${EVENT_STYLE[e.type] ?? "text-zinc-400"}`}>{e.type}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{e.data}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>

      {/* ── СТАТУС-БАР (sticky footer) ── */}
      <footer className="mt-auto flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 bg-zinc-900/80 px-4 py-2 text-[11px] text-zinc-400 backdrop-blur">
        <span className="flex items-center gap-1.5" aria-live="polite">
          <Dot on={connected} pulse /> {connected ? "daemon live" : "daemon offline"}
        </span>
        <span className="flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5 text-emerald-400" />
          флот: <b className="text-zinc-200">{stats.agentsBusy ?? 0}</b> занят / <b className="text-zinc-200">{stats.agentsIdle ?? 0}</b> свободен
        </span>
        <span className="flex items-center gap-1.5"><Crosshair className="h-3.5 w-3.5 text-amber-400" />
          задачи: <b className="text-zinc-200">{stats.tasksReady ?? 0}</b> ready · <b className="text-zinc-200">{stats.tasksRunning ?? 0}</b> running · <b className="text-emerald-400">{stats.tasksCompleted ?? 0}</b> done · <b className="text-rose-400">{stats.tasksFailed ?? 0}</b> fail
        </span>
        <span className="flex min-w-28 items-center gap-1.5"><Gauge className="h-3.5 w-3.5 text-fuchsia-400" />
          бюджет: <b className={budgetPct > 80 ? "text-rose-400" : "text-zinc-200"}>{budgetPct}%</b>
          <Progress value={budgetPct} className="h-1 w-16 bg-zinc-800 [&>div]:bg-fuchsia-500" />
        </span>
        <span className="ml-auto hidden font-mono text-[10px] text-zinc-600 md:inline">
          boot {snap?.meta.boot ? new Date(snap.meta.boot).toLocaleTimeString("ru-RU") : "—"} · ws :3040 · rest :3041
        </span>
      </footer>

      {/* ── ⌘K ПАЛИТРА ── */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="команда ME2… (47-action bus, M1: 10)" />
        <CommandList>
          <CommandEmpty>не найдено</CommandEmpty>
          <CommandGroup heading="Задачи">
            <CommandItem onSelect={() => { setCmdOpen(false); setNewTaskOpen(true); }}>
              <Plus className="mr-2 h-4 w-4 text-emerald-400" /> Новая задача… <span className="ml-auto text-xs text-zinc-500">MUTATION</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Флот">
            <CommandItem onSelect={() => spawnAgent("IMPLEMENTER")}>
              <Bot className="mr-2 h-4 w-4 text-amber-400" /> Создать агента IMPLEMENTER
            </CommandItem>
            <CommandItem onSelect={() => spawnAgent("RESEARCHER")}>
              <Bot className="mr-2 h-4 w-4 text-amber-400" /> Создать агента RESEARCHER
            </CommandItem>
            <CommandItem onSelect={() => { sendCommand("FLEET_RECONCILE", {}, { lane: "CONTROL" }); setCmdOpen(false); }}>
              <RefreshCw className="mr-2 h-4 w-4 text-amber-400" /> Сверка флота (reconcile) <span className="ml-auto text-xs text-zinc-500">CONTROL</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Диагностика">
            <CommandItem onSelect={() => { sendCommand("PING", {}, { quiet: true, successMsg: "pong" }); setCmdOpen(false); }}>
              <Zap className="mr-2 h-4 w-4 text-emerald-400" /> PING <span className="ml-auto text-xs text-zinc-500">READ_ONLY</span>
            </CommandItem>
            <CommandItem onSelect={() => { sendCommand("STATE_SNAPSHOT", {}, { quiet: true }); setCmdOpen(false); }}>
              <Boxes className="mr-2 h-4 w-4 text-cyan-400" /> Снапшот состояния
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Опасная зона">
            <CommandItem onSelect={() => { setCmdOpen(false); setResetConfirm(true); }} className="text-rose-400">
              <Trash2 className="mr-2 h-4 w-4" /> Сброс среды (EMERGENCY)…
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* ── НОВАЯ ЗАДАЧА ── */}
      <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm tracking-widest"><Rocket className="h-4 w-4 text-emerald-400" /> НОВАЯ ЗАДАЧА</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">через command bus · полоса MUTATION · бюджет 24/60s</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="t-title" className="text-xs text-zinc-400">Заголовок</Label>
              <Input id="t-title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="короткое имя задачи" className="border-zinc-800 bg-zinc-900 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-spec" className="text-xs text-zinc-400">Спецификация <span className="text-rose-500">*</span></Label>
              <Textarea id="t-spec" value={fSpec} onChange={(e) => setFSpec(e.target.value)} placeholder="что именно нужно сделать; агент получает это как задание" rows={5} className="border-zinc-800 bg-zinc-900 font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-zinc-400">Роль</Label>
                <Select value={fRole} onValueChange={setFRole}>
                  <SelectTrigger className="border-zinc-800 bg-zinc-900 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-950">
                    <SelectItem value="ANY">любая</SelectItem>
                    <SelectItem value="IMPLEMENTER">IMPLEMENTER</SelectItem>
                    <SelectItem value="RESEARCHER">RESEARCHER</SelectItem>
                    <SelectItem value="OPERATOR">OPERATOR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-steps" className="text-xs text-zinc-400">Макс. шагов</Label>
                <Input id="t-steps" type="number" min={1} max={24} value={fSteps} onChange={(e) => setFSteps(e.target.value)} className="border-zinc-800 bg-zinc-900 text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setNewTaskOpen(false)}>отмена</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={createTask} disabled={busyAction}>
              <Rocket className="mr-1 h-3.5 w-3.5" /> поставить в очередь
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ДЕТАЛЬ ЗАДАЧИ ── */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={`${STATUS_BADGE[detail.status] ?? ""} text-[10px]`}>{detail.status}</Badge>
                  {detail.role && <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">{detail.role}</Badge>}
                  <span className="ml-auto font-mono text-[10px] text-zinc-500">{detail.id}</span>
                </div>
                <SheetTitle className="text-sm leading-snug">{detail.title}</SheetTitle>
                <SheetDescription className="text-[11px] text-zinc-500">
                  шагов {detail.steps}/{detail.max_steps} · создана {age(detail.created_at)} назад · обновлена {age(detail.updated_at)} назад
                </SheetDescription>
              </SheetHeader>
              <div className="mt-2 space-y-4 px-4 pb-8">
                <div>
                  <p className="mb-1 text-[10px] font-semibold tracking-widest text-zinc-500">СПЕЦИФИКАЦИЯ</p>
                  <pre className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-[11px] text-zinc-300">{detail.spec}</pre>
                </div>
                {detail.result && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-emerald-500"><CheckCircle2 className="h-3 w-3" /> РЕЗУЛЬТАТ</p>
                    <pre className="whitespace-pre-wrap rounded-md border border-emerald-900/50 bg-emerald-950/30 p-3 font-mono text-[11px] text-emerald-200">{detail.result}</pre>
                  </div>
                )}
                {detail.error && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-widest text-rose-500"><AlertTriangle className="h-3 w-3" /> ОШИБКА</p>
                    <pre className="whitespace-pre-wrap rounded-md border border-rose-900/50 bg-rose-950/30 p-3 font-mono text-[11px] text-rose-200">{detail.error}</pre>
                  </div>
                )}
                {(detail.status === "READY" || detail.status === "RUNNING") && (
                  <Button variant="destructive" size="sm" className="w-full" onClick={() => cancelTask(detail.id)}>
                    <X className="mr-1 h-3.5 w-3.5" /> отменить задачу (CONTROL)
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── ПОДТВЕРЖДЕНИЕ СБРОСА ── */}
      <Dialog open={resetConfirm} onOpenChange={setResetConfirm}>
        <DialogContent className="border-rose-900 bg-zinc-950 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-rose-400"><Trash2 className="h-4 w-4" /> СБРОС СРЕДЫ · EMERGENCY</DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Будут удалены ВСЕ задачи, агенты и команды. Это полоса EMERGENCY — бюджет игнорируется. Действие необратимо.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setResetConfirm(false)}>отмена</Button>
            <Button variant="destructive" size="sm" onClick={environmentReset}>сбросить всё</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
