"use client";
// ── COMMAND PALETTE (⌘K): универсальный переход к любому объекту системы ───────
// Режимы: Pages / Agents / Tasks / Commands+Реестр-47 (keyboard-first, §8 дизайн-дока).

import { useMemo, useState } from "react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { PAGES, useMe2 } from "@/components/me2/store";
import { sendCommand, spawnAgent, STATUS_BADGE, type ActionMeta } from "@/lib/me2-bus";
import {
  Plus, Bot, RefreshCw, Zap, Boxes, Download, Gauge, Trash2, Search, Rocket,
  LayoutDashboard, ListChecks, Terminal, Globe, ShieldCheck, Cpu, BrainCircuit,
  Activity, Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PAGE_META: Record<string, { icon: LucideIcon; hint: string }> = {
  command: { icon: LayoutDashboard, hint: "агенты + браузер + супервизор" },
  agents: { icon: Bot, hint: "флот агентов" },
  browser: { icon: Globe, hint: "браузерная инфраструктура" },
  code: { icon: Terminal, hint: "код, exec, песочницы" },
  tasks: { icon: ListChecks, hint: "задачи и граф" },
  supervisor: { icon: ShieldCheck, hint: "control-plane оркестрации" },
  compute: { icon: Cpu, hint: "пул, workers, квоты" },
  memory: { icon: BrainCircuit, hint: "память и знание" },
  observability: { icon: Activity, hint: "журналы и здоровье" },
  system: { icon: Settings2, hint: "конфигурация" },
};

function laneChip(lane: string): string {
  switch (lane) {
    case "EMERGENCY": return "border-rose-800 text-rose-300";
    case "CONTROL": return "border-amber-800 text-amber-300";
    case "MUTATION": return "border-fuchsia-800 text-fuchsia-300";
    default: return "border-zinc-700 text-zinc-400";
  }
}

export function CommandPalette() {
  const open = useMe2((s) => s.paletteOpen);
  const setOpen = useMe2((s) => s.setPalette);
  const setPage = useMe2((s) => s.setPage);
  const setDialog = useMe2((s) => s.setDialog);
  const catalog = useMe2((s) => s.catalog);
  const snap = useMe2((s) => s.snap);
  const openTask = useMe2((s) => s.openTask);
  const setChatId = useMe2((s) => s.setChatId);
  const [mode, setMode] = useState<"all" | "pages" | "agents" | "tasks">("all");

  const chats = snap?.agents ?? [];
  const tasks = useMemo(() => {
    const all = [...(snap?.tasks ?? []), ...(snap?.archived ?? [])];
    return all.slice(0, 40);
  }, [snap]);

  const runRegistryAction = (meta: ActionMeta) => {
    const direct: Record<string, () => void> = {
      PING: () => { void sendCommand("PING", {}, { quiet: true, successMsg: "pong" }); },
      STATE_SNAPSHOT: () => { void sendCommand("STATE_SNAPSHOT", {}, { quiet: true }); },
      EVENTS_TAIL: () => { void sendCommand("EVENTS_TAIL", { since: 0, limit: 50 }, { quiet: true, successMsg: "хвост событий запрошен" }); },
      WORKERS_LIST: () => { void sendCommand("WORKERS_LIST", {}, { quiet: true, successMsg: "список workers в шине" }); },
      ACTIONS_LIST: () => { void sendCommand("ACTIONS_LIST", {}, { quiet: true, successMsg: "реестр действий в шине" }); },
      FLEET_RECONCILE: () => { void sendCommand("FLEET_RECONCILE", {}, { lane: "CONTROL" }); },
      BUDGET_FLUSH: () => { void sendCommand("BUDGET_FLUSH", {}, { lane: "EMERGENCY", successMsg: "очередь шины сброшена" }); },
      ENVIRONMENT_RESET: () => setDialog("reset"),
      TASK_ENQUEUE: () => setDialog("newTask"),
      TASK_SCHEDULE: () => setDialog("newTask"),
      EVENTS_SEARCH: () => setDialog("eventsSearch"),
      BUDGET_ADJUST: () => setDialog("budget"),
    };
    const fn = direct[meta.action];
    if (fn) {
      fn();
      if (meta.action !== "ENVIRONMENT_RESET" && meta.action !== "TASK_ENQUEUE" && meta.action !== "TASK_SCHEDULE") setOpen(false);
    } else {
      setOpen(false);
      if (meta.args) {
        const raw = window.prompt(`Аргументы ${meta.action} (${meta.args}) — JSON, напр. {"id":"tk_..."}`, "{}");
        if (raw) {
          try {
            const payload = JSON.parse(raw) as Record<string, unknown>;
            void sendCommand(meta.action, payload, {});
          } catch {
            window.dispatchEvent(new CustomEvent("me2:toast", { detail: { title: `${meta.action} ✗`, description: "аргументы не JSON", variant: "destructive" } }));
          }
        }
      }
    }
  };

  const exportEvents = () => {
    const blob = new Blob([JSON.stringify(useMe2.getState().events, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `me2-events-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="ME2: страница (@) · агент · задача · команда… · реестр {реестр}/47" />
      <CommandList>
        <CommandEmpty>не найдено</CommandEmpty>

        {/* PAGES */}
        <CommandGroup heading="Pages · Alt+1..0">
          {PAGES.map((p) => {
            const m = PAGE_META[p.key];
            const Icon = m?.icon ?? LayoutDashboard;
            return (
              <CommandItem
                key={p.key} value={`page ${p.key} ${p.label} ${m?.hint ?? ""}`}
                onSelect={() => { setPage(p.key); setOpen(false); }}
              >
                <Icon className="mr-2 h-4 w-4 text-emerald-400" /> {p.label}
                <span className="ml-2 truncate text-[10px] text-zinc-500">{m?.hint}</span>
                <span className="ml-auto font-mono text-[9px] text-zinc-600">Alt+{p.num}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />

        {/* AGENTS (чаты) */}
        {(mode === "all") && (
          <CommandGroup heading={`Агенты · ${chats.length}`}>
            {chats.slice(0, 8).map((a) => (
              <CommandItem key={a.id} value={`agent ${a.id} ${a.role}`} onSelect={() => { setChatId(a.id); setPage("command"); setOpen(false); }}>
                <Bot className="mr-2 h-4 w-4 text-amber-400" /> {a.role}
                <Badge variant="outline" className={`ml-2 border px-1 font-mono text-[8px] ${STATUS_BADGE[a.status] ?? ""}`}>{a.status}</Badge>
                <span className="ml-auto font-mono text-[9px] text-zinc-600">{a.model}</span>
              </CommandItem>
            ))}
            {["IMPLEMENTER", "RESEARCHER", "OPERATOR"].map((r) => (
              <CommandItem key={`spawn-${r}`} value={`spawn создать агента ${r}`} onSelect={() => { void spawnAgent(r); setOpen(false); }}>
                <Plus className="mr-2 h-4 w-4 text-amber-400" /> Создать агента {r} <span className="ml-auto text-xs text-zinc-500">MUTATION</span>
              </CommandItem>
            ))}
            <CommandItem value="fleet reconcile сверка" onSelect={() => { void sendCommand("FLEET_RECONCILE", {}, { lane: "CONTROL" }); setOpen(false); }}>
              <RefreshCw className="mr-2 h-4 w-4 text-amber-400" /> Сверка флота (reconcile) <span className="ml-auto text-xs text-zinc-500">CONTROL</span>
            </CommandItem>
          </CommandGroup>
        )}

        {/* TASKS */}
        {(mode === "all") && (
          <CommandGroup heading={`Задачи · ${tasks.length}`}>
            <CommandItem value="new новая задача" onSelect={() => { setDialog("newTask"); setOpen(false); }}>
              <Rocket className="mr-2 h-4 w-4 text-emerald-400" /> Новая задача… <span className="ml-auto text-xs text-zinc-500">MUTATION</span>
            </CommandItem>
            {tasks.slice(0, 10).map((t) => (
              <CommandItem key={t.id} value={`task ${t.id} ${t.title}`} onSelect={() => { openTask(t.id); setOpen(false); }}>
                <ListChecks className="mr-2 h-3.5 w-3.5 text-cyan-400" />
                <span className="max-w-[45%] truncate text-xs">{t.title}</span>
                <span className={`ml-2 rounded px-1 font-mono text-[8px] ${STATUS_BADGE[t.status] ?? "bg-zinc-700 text-zinc-300"}`}>{t.status}</span>
                <span className="ml-auto font-mono text-[9px] text-zinc-600">{t.id}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* ДИАГНОСТИКА */}
        <CommandSeparator />
        <CommandGroup heading="Диагностика и действия">
          <CommandItem value="ping" onSelect={() => { void sendCommand("PING", {}, { quiet: true, successMsg: "pong" }); setOpen(false); }}>
            <Zap className="mr-2 h-4 w-4 text-emerald-400" /> PING <span className="ml-auto text-xs text-zinc-500">READ_ONLY</span>
          </CommandItem>
          <CommandItem value="snapshot состояния" onSelect={() => { void sendCommand("STATE_SNAPSHOT", {}, { quiet: true }); setOpen(false); }}>
            <Boxes className="mr-2 h-4 w-4 text-cyan-400" /> Снапшот состояния
          </CommandItem>
          <CommandItem value="events search поиск события" onSelect={() => { setDialog("eventsSearch"); setOpen(false); }}>
            <Search className="mr-2 h-4 w-4 text-cyan-400" /> Поиск по событиям…
          </CommandItem>
          <CommandItem value="export журнал" onSelect={exportEvents}>
            <Download className="mr-2 h-4 w-4 text-cyan-400" /> Экспорт журнала (300 событий, JSON)
          </CommandItem>
          <CommandItem value="budget лимит" onSelect={() => { setDialog("budget"); setOpen(false); }}>
            <Gauge className="mr-2 h-4 w-4 text-fuchsia-400" /> Лимит бюджета…
          </CommandItem>
        </CommandGroup>

        {/* ОПАСНАЯ ЗОНА */}
        <CommandSeparator />
        <CommandGroup heading="Опасная зона">
          <CommandItem value="flush сброс очередь" onSelect={() => { void sendCommand("BUDGET_FLUSH", {}, { lane: "EMERGENCY", successMsg: "очередь шины сброшена" }); setOpen(false); }} className="text-rose-400">
            <Gauge className="mr-2 h-4 w-4" /> Сбросить очередь шины (FLUSH)… <span className="ml-auto text-xs text-rose-500/70">EMERGENCY</span>
          </CommandItem>
          <CommandItem value="reset среда" onSelect={() => { setDialog("reset"); setOpen(false); }} className="text-rose-400">
            <Trash2 className="mr-2 h-4 w-4" /> Сброс среды (EMERGENCY)…
          </CommandItem>
        </CommandGroup>

        {/* РЕЕСТР-47 */}
        {catalog.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Реестр действий шины · ${catalog.length}/47`}>
              {catalog.map((m) => (
                <CommandItem key={m.action} value={`${m.action} ${m.desc} ${m.group}`} onSelect={() => runRegistryAction(m)}>
                  <Badge variant="outline" className={`mr-2 h-4 shrink-0 border px-1 font-mono text-[8px] ${laneChip(m.lane)}`}>{m.lane.slice(0, 4)}</Badge>
                  <span className="font-mono text-xs">{m.action}</span>
                  <span className="ml-2 truncate text-[10px] text-zinc-500">{m.desc}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-600">c{m.cost}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
