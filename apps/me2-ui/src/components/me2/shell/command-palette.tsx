"use client";
// ── COMMAND PALETTE (⌘K): универсальный переход к любому объекту системы ───────
// Режимы: Pages / Agents / Tasks / Commands+Реестр-47 (keyboard-first, §8 дизайн-дока).

import { useMemo, useState } from "react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { PAGES, useMe2 } from "@/components/me2/store";
import { sendCommand, STATUS_BADGE, type ActionMeta } from "@/lib/me2-bus";
import {
  Zap, Boxes, Download, Gauge, Trash2, Search, Rocket,
  LayoutDashboard, ListChecks, Terminal, Globe, ShieldCheck, BrainCircuit,
  Activity, Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PAGE_META: Record<string, { icon: LucideIcon; hint: string }> = {
  browser: { icon: Globe, hint: "браузерная инфраструктура" },
  code: { icon: Terminal, hint: "код, exec, песочницы" },
  tasks: { icon: ListChecks, hint: "задачи и граф" },
  supervisor: { icon: ShieldCheck, hint: "control-plane оркестрации" },
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
  const [mode, setMode] = useState<"all" | "pages" | "tasks" | "actions">("all");
  const [pendingAction, setPendingAction] = useState<ActionMeta | null>(null);
  const [pendingArgs, setPendingArgs] = useState("{}");
  const [confirmFlush, setConfirmFlush] = useState(false);

  const confirmBudgetFlush = () => {
    setConfirmFlush(true);
  };

  const runBudgetFlush = () => {
    void sendCommand("BUDGET_FLUSH", {}, { lane: "EMERGENCY", successMsg: "очередь шины сброшена" });
    setConfirmFlush(false);
    setOpen(false);
  };

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
      BUDGET_FLUSH: confirmBudgetFlush,
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
    } else if (meta.args) {
      // Keep argument entry inside the ME2 semantic overlay instead of falling
      // out to window.prompt, which was invisible to the composition model.
      setPendingArgs("{}");
      setPendingAction(meta);
    } else {
      setOpen(false);
    }
  };

  const runPendingRegistryAction = () => {
    if (!pendingAction) return;
    try {
      const payload = JSON.parse(pendingArgs) as Record<string, unknown>;
      void sendCommand(pendingAction.action, payload, {});
      setPendingAction(null);
      setPendingArgs("{}");
      setOpen(false);
    } catch {
      window.dispatchEvent(new CustomEvent("me2:toast", {
        detail: { title: `${pendingAction.action} ✗`, description: "аргументы не JSON", variant: "destructive" },
      }));
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
    <CommandDialog open={open} onOpenChange={(next) => { if (!next) { setPendingAction(null); setPendingArgs("{}"); setConfirmFlush(false); } setOpen(next); }}>
      <CommandInput placeholder="ME2: найти страницу · агента · задачу · команду…" />
      <div className="flex items-center gap-1 border-b border-zinc-800 px-2 py-1.5" aria-label="Режим Command Palette">
        {([
          ["all", "всё"],
          ["pages", "pages"],
          ["tasks", "tasks"],
          ["actions", "actions"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            aria-pressed={mode === key}
            className={`border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
              mode === key
                ? "border-emerald-800/70 bg-emerald-950/25 text-emerald-300"
                : "border-transparent text-zinc-500 hover:border-zinc-800 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {pendingAction ? (
        <div className="space-y-3 p-3" data-testid="registry-action-args">
          <div className="flex items-center gap-2">
            <Badge variant="outline" title={`Authority lane: ${pendingAction.lane}`} className={`h-5 border px-1.5 font-mono text-[8px] ${laneChip(pendingAction.lane)}`}>
              {pendingAction.lane.replace("_", " ")}
            </Badge>
            <span className="font-mono text-xs text-zinc-200">{pendingAction.action}</span>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            {pendingAction.desc}{pendingAction.args ? ` · args: ${pendingAction.args}` : ""}
          </p>
          <textarea
            value={pendingArgs}
            onChange={(event) => setPendingArgs(event.target.value)}
            rows={6}
            spellCheck={false}
            aria-label={`JSON аргументы для ${pendingAction.action}`}
            className="w-full resize-y border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200 outline-none focus:border-emerald-900"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setPendingAction(null); setPendingArgs("{}"); }}
              className="border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              назад
            </button>
            <button
              type="button"
              onClick={runPendingRegistryAction}
              className="border border-emerald-900 bg-emerald-950/30 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-950/60"
            >
              выполнить
            </button>
          </div>
        </div>
      ) : confirmFlush ? (
        <div className="space-y-3 p-3" data-testid="emergency-flush-confirm">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-5 border border-rose-800 px-1.5 font-mono text-[8px] text-rose-300">EMERGENCY</Badge>
            <span className="font-mono text-xs font-semibold text-rose-300">BUDGET_FLUSH</span>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Сбросить очередь command bus? Все отложенные команды будут сняты. Это явный effect и он не запускается из постоянного chrome.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmFlush(false)} className="border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-900">отмена</button>
            <button type="button" onClick={runBudgetFlush} className="border border-rose-800 bg-rose-950/30 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-950/60">подтвердить EMERGENCY</button>
          </div>
        </div>
      ) : (
      <CommandList>
        <CommandEmpty>не найдено</CommandEmpty>

        {/* PAGES */}
        {(mode === "all" || mode === "pages") && <CommandGroup heading="Advanced surfaces · search">
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
                <span className="ml-auto font-mono text-[9px] text-zinc-600">search</span>
              </CommandItem>
            );
          })}
        </CommandGroup>}
        {mode === "all" ? <CommandSeparator /> : null}

        {/* Native agents live in the Browser workspace rail. The palette does
            not spawn daemon/API agents or invent a second fleet projection. */}
        {mode === "all" ? (
          <CommandGroup heading="Native Agent fleet">
            <CommandItem value="fleet agents native browser" onSelect={() => { setPage("browser"); setOpen(false); }}>
              <Globe className="mr-2 h-4 w-4 text-cyan-400" /> Open native z.ai Agent fleet
              <span className="ml-auto text-[9px] text-zinc-500">Browser roster</span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {/* TASKS */}
        {(mode === "all" || mode === "tasks") && (
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
        {(mode === "all" || mode === "actions") && <>
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
          <CommandItem value="flush сброс очередь" onSelect={confirmBudgetFlush} className="text-rose-400">
            <Gauge className="mr-2 h-4 w-4" /> Сбросить очередь шины (FLUSH)… <span className="ml-auto text-xs text-rose-500/70">EMERGENCY</span>
          </CommandItem>
          <CommandItem value="reset среда" onSelect={() => { setDialog("reset"); setOpen(false); }} className="text-rose-400">
            <Trash2 className="mr-2 h-4 w-4" /> Сброс среды (EMERGENCY)…
          </CommandItem>
        </CommandGroup>
        </>}

        {/* РЕЕСТР-47 */}
        {catalog.length > 0 && (mode === "all" || mode === "actions") && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Реестр действий шины · ${catalog.length}/47`}>
              {catalog.map((m) => (
                <CommandItem key={m.action} value={`${m.action} ${m.desc} ${m.group}`} onSelect={() => runRegistryAction(m)}>
                  <Badge variant="outline" title={`Authority lane: ${m.lane}`} aria-label={`Authority lane ${m.lane}`} className={`mr-2 h-5 shrink-0 border px-1.5 font-mono text-[8px] ${laneChip(m.lane)}`}>{m.lane.replace("_", " ")}</Badge>
                  <span className="font-mono text-xs">{m.action}</span>
                  <span className="ml-2 truncate text-[10px] text-zinc-500">{m.desc}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-600">c{m.cost}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      )}
    </CommandDialog>
  );
}
