"use client";
// ── ME2 STORE: единый центральный стор UI (R74 Page-архитектура) ────────────────
// WS-данные (snapshot/event) + навигация Pages + workspace + selection агентов +
// глобальные диалоги + hotkeys. Страничные REST-опросы живут ЛОКАЛЬНО в страницах
// (панели монтируются условно — перф-паттерн legacy сохранён).

import { useMemo } from "react";
import { create } from "zustand";
import {
  getSocket, setBusHandlers, startHeartbeat, me2Fetch, toastBus, sendCommand,
  type Snapshot, type Event, type ActionMeta, type Mirror, type Task,
} from "@/lib/me2-bus";

// ── Pages (DaVinci-Resolve принцип: специализированные рабочие контексты) ──────
export type PageKey =
  | "command" | "agents" | "browser" | "code" | "tasks"
  | "supervisor" | "compute" | "memory" | "observability" | "system";

export const PAGES: { key: PageKey; label: string; num: string }[] = [
  { key: "command", label: "COMMAND", num: "1" },
  { key: "agents", label: "AGENTS", num: "2" },
  { key: "browser", label: "BROWSER", num: "3" },
  { key: "code", label: "CODE", num: "4" },
  { key: "tasks", label: "TASKS", num: "5" },
  { key: "supervisor", label: "SUPERVISOR", num: "6" },
  { key: "compute", label: "COMPUTE", num: "7" },
  { key: "memory", label: "MEMORY", num: "8" },
  { key: "observability", label: "OBSERV", num: "9" },
  { key: "system", label: "SYSTEM", num: "0" },
];

// ── Workspaces (пресеты рабочих контекстов) ─────────────────────────────────────
export type WorkspaceKey = "development" | "browser-ops" | "debugging" | "monitoring" | "supervise";
export const WORKSPACES: { key: WorkspaceKey; label: string; page: PageKey; hint: string }[] = [
  { key: "development", label: "Development", page: "command", hint: "агенты + браузер + супервизор" },
  { key: "browser-ops", label: "Browser Ops", page: "browser", hint: "браузерная инфраструктура" },
  { key: "debugging", label: "Debugging", page: "code", hint: "код, exec, песочницы" },
  { key: "monitoring", label: "Monitoring", page: "observability", hint: "журналы, метрики, здоровье" },
  { key: "supervise", label: "Supervisor", page: "supervisor", hint: "цели, оркестрация, control-plane" },
];

export type PaletteMode = "all" | "actions" | "agents" | "tasks" | "pages";
export type DialogKind = "newTask" | "eventsSearch" | "budget" | "reset" | "openSite" | null;
export type ContextDrawerTab = "events" | "commands" | "runtime";

interface Me2State {
  // связь
  connected: boolean;
  snap: Snapshot | null;
  events: Event[];
  catalog: ActionMeta[];
  mirror: Mirror | null;
  nowMs: number;
  // навигация
  page: PageKey;
  recentPages: PageKey[];
  pageHistoryIndex: number;
  workspace: WorkspaceKey;
  // оверлеи
  paletteOpen: boolean;
  dialog: DialogKind;
  detail: Task | null;
  stream: Event[];
  // contextual drawer (read-only presentation plane)
  contextDrawerPreferredOpen: boolean;
  contextDrawerOpen: boolean;
  contextDrawerTab: ContextDrawerTab;
  commandRailPreferredOpen: boolean;
  // selection (agent-first)
  chatId: string | null;
  // служебное
  busyAction: boolean;
  chromeOverlaySources: string[];
  booted: boolean;

  init: () => void;
  setPage: (p: PageKey) => void;
  setWorkspace: (w: WorkspaceKey) => void;
  setPalette: (open: boolean) => void;
  setDialog: (d: DialogKind) => void;
  setContextDrawer: (open: boolean) => void;
  setContextDrawerTab: (tab: ContextDrawerTab) => void;
  syncContextDrawer: (preferred?: boolean) => void;
  setCommandRailPreference: (open: boolean) => void;
  resetWorkspaceLayout: () => void;
  openTask: (id: string) => void;
  closeTask: () => void;
  setChatId: (id: string | null) => void;
  setBusy: (b: boolean) => void;
  setChromeOverlay: (source: string, open: boolean) => void;
}

let initGuard = false;
const PAGE_LS = "me2.page.v1";
const WS_LS = "me2.workspace.v1";
const CONTEXT_DRAWER_LS = "me2.context-drawer.open.v1"; // legacy migration
const CONTEXT_DRAWER_TAB_LS = "me2.context-drawer.tab.v1"; // legacy migration
const WORKSPACE_LAYOUTS_LS = "me2.workspace-layouts.v1";

type WorkspaceLayoutPreference = {
  drawerOpen: boolean;
  drawerTab: ContextDrawerTab;
  commandRailOpen: boolean;
};

function readWorkspaceLayout(workspace: WorkspaceKey): WorkspaceLayoutPreference {
  try {
    const raw = localStorage.getItem(WORKSPACE_LAYOUTS_LS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<WorkspaceKey, Partial<WorkspaceLayoutPreference>>>;
      const row = parsed?.[workspace];
      const tab = row?.drawerTab;
      if (row && typeof row.drawerOpen === "boolean" && (tab === "events" || tab === "commands" || tab === "runtime")) {
        const rail = typeof row.commandRailOpen === "boolean"
          ? row.commandRailOpen
          : localStorage.getItem(`me2.command.agent-rail.v2:${workspace}`) !== "0";
        return { drawerOpen: row.drawerOpen, drawerTab: tab, commandRailOpen: rail };
      }
    }
    const legacyTab = localStorage.getItem(CONTEXT_DRAWER_TAB_LS);
    const legacyRail = localStorage.getItem(`me2.command.agent-rail.v2:${workspace}`)
      ?? localStorage.getItem("me2.command.agent-rail.v1");
    return {
      drawerOpen: localStorage.getItem(CONTEXT_DRAWER_LS) === "1",
      drawerTab: legacyTab === "commands" || legacyTab === "runtime" ? legacyTab : "events",
      commandRailOpen: legacyRail !== "0",
    };
  } catch {
    return { drawerOpen: false, drawerTab: "events", commandRailOpen: true };
  }
}

function writeWorkspaceLayout(workspace: WorkspaceKey, patch: Partial<WorkspaceLayoutPreference>) {
  try {
    const raw = localStorage.getItem(WORKSPACE_LAYOUTS_LS);
    const parsed = raw ? JSON.parse(raw) as Partial<Record<WorkspaceKey, Partial<WorkspaceLayoutPreference>>> : {};
    const current = readWorkspaceLayout(workspace);
    parsed[workspace] = { ...current, ...patch };
    localStorage.setItem(WORKSPACE_LAYOUTS_LS, JSON.stringify(parsed));
  } catch { /* private mode */ }
}

function syncPagePresentation(p: PageKey) {
  try {
    localStorage.setItem(PAGE_LS, p);
    history.replaceState(null, "", `#${p}`);
  } catch { /* private mode */ }
  try {
    const shell = (window as Window & { metaengineShell?: { setPrimaryPage?: (page: string) => unknown; setPrimaryOverlay?: (active: boolean) => unknown } }).metaengineShell;
    void shell?.setPrimaryPage?.(p);
  } catch { /* Browser preload bridge absent in web-only mode */ }
  void (async () => {
    try {
      const { me2Desktop } = await import("@/lib/me2-desktop");
      me2Desktop()?.tabs.setActive("page", p);
    } catch { /* bridge absent */ }
  })();
}

export const useMe2 = create<Me2State>((set, get) => ({
  connected: false,
  snap: null,
  events: [],
  catalog: [],
  mirror: null,
  nowMs: Date.now(),
  page: "command",
  recentPages: ["command"],
  pageHistoryIndex: 0,
  workspace: "development",
  paletteOpen: false,
  dialog: null,
  detail: null,
  stream: [],
  contextDrawerPreferredOpen: false,
  contextDrawerOpen: false,
  contextDrawerTab: "events",
  commandRailPreferredOpen: true,
  chatId: null,
  busyAction: false,
  chromeOverlaySources: [],
  booted: false,

  setBusy: (b) => set({ busyAction: b }),
  setChromeOverlay: (source, open) => {
    const key = String(source || "").trim().slice(0, 64);
    if (!key) return;
    set((st) => {
      const next = open
        ? Array.from(new Set([...st.chromeOverlaySources, key]))
        : st.chromeOverlaySources.filter((item) => item !== key);
      return { chromeOverlaySources: next };
    });
  },

  syncContextDrawer: (preferred) => {
    const want = typeof preferred === "boolean" ? preferred : get().contextDrawerPreferredOpen;
    if (get().page !== "command") {
      set({ contextDrawerPreferredOpen: want, contextDrawerOpen: want });
      return;
    }
    const shell = (window as Window & {
      metaengineShell?: {
        setPrimaryContextDrawer?: (open: boolean) => Promise<{ effective_open?: boolean } | null>;
      };
    }).metaengineShell;
    if (!shell?.setPrimaryContextDrawer) {
      set({ contextDrawerPreferredOpen: want, contextDrawerOpen: want });
      return;
    }
    void shell.setPrimaryContextDrawer(want).then((result) => {
      set({
        contextDrawerPreferredOpen: want,
        contextDrawerOpen: typeof result?.effective_open === "boolean" ? result.effective_open : want,
      });
    }).catch(() => {
      set({ contextDrawerPreferredOpen: want, contextDrawerOpen: false });
    });
  },

  setContextDrawer: (open) => {
    set({ contextDrawerPreferredOpen: open });
    writeWorkspaceLayout(get().workspace, { drawerOpen: open });
    get().syncContextDrawer(open);
  },

  setContextDrawerTab: (tab) => {
    set({ contextDrawerTab: tab });
    writeWorkspaceLayout(get().workspace, { drawerTab: tab });
  },

  setCommandRailPreference: (open) => {
    set({ commandRailPreferredOpen: open });
    writeWorkspaceLayout(get().workspace, { commandRailOpen: open });
  },

  resetWorkspaceLayout: () => {
    const defaults: WorkspaceLayoutPreference = { drawerOpen: false, drawerTab: "events", commandRailOpen: true };
    writeWorkspaceLayout(get().workspace, defaults);
    set({
      contextDrawerPreferredOpen: defaults.drawerOpen,
      contextDrawerTab: defaults.drawerTab,
      commandRailPreferredOpen: defaults.commandRailOpen,
    });
    get().syncContextDrawer(defaults.drawerOpen);
    try {
      window.dispatchEvent(new CustomEvent("me2:workspace-layout-reset", { detail: get().workspace }));
    } catch { /* browser unavailable */ }
  },

  init: () => {
    if (initGuard) return;
    initGuard = true;
    set({ booted: true });

    // восстановление страницы/workspace (после гидрации — без mismatch)
    window.setTimeout(() => {
      try {
        const h = window.location.hash.replace("#", "");
        const stored = localStorage.getItem(PAGE_LS);
        const raw = (PAGES.some((p) => p.key === h) && h) || stored;
        if (raw && PAGES.some((p) => p.key === raw)) {
          set({ page: raw as PageKey, recentPages: [raw as PageKey], pageHistoryIndex: 0 });
          try {
            const shell = (window as Window & { metaengineShell?: { setPrimaryPage?: (page: string) => unknown; setPrimaryOverlay?: (active: boolean) => unknown } }).metaengineShell;
            void shell?.setPrimaryPage?.(raw);
          } catch { /* Browser preload bridge absent in web-only mode */ }
        } else {
          try {
            const shell = (window as Window & { metaengineShell?: { setPrimaryPage?: (page: string) => unknown; setPrimaryOverlay?: (active: boolean) => unknown } }).metaengineShell;
            void shell?.setPrimaryPage?.("command");
          } catch { /* Browser preload bridge absent in web-only mode */ }
        }
        const storedWs = localStorage.getItem(WS_LS) as WorkspaceKey | null;
        const activeWorkspace = storedWs && WORKSPACES.some((item) => item.key === storedWs) ? storedWs : get().workspace;
        if (activeWorkspace !== get().workspace) set({ workspace: activeWorkspace });
        const workspaceLayout = readWorkspaceLayout(activeWorkspace);
        set({
          contextDrawerPreferredOpen: workspaceLayout.drawerOpen,
          contextDrawerTab: workspaceLayout.drawerTab,
          commandRailPreferredOpen: workspaceLayout.commandRailOpen,
        });
        writeWorkspaceLayout(activeWorkspace, workspaceLayout); // materialize legacy preference once
        get().syncContextDrawer(workspaceLayout.drawerOpen);
      } catch { /* приватный режим */ }
    }, 0);

    // WS-шина
    setBusHandlers({
      onConnect: () => set({ connected: true }),
      onDisconnect: () => set({ connected: false }),
      onSnapshot: (s) => {
        set((st) => {
          // live-синхронизация открытой детали задачи
          let detail = st.detail;
          if (detail) {
            const fresh = s.tasks.find((t) => t.id === detail!.id) ?? (s.archived ?? []).find((t) => t.id === detail!.id);
            if (fresh && fresh !== detail) detail = fresh;
          }
          return { snap: s, detail };
        });
        if (s.events?.length) {
          set((st) => {
            const map = new Map(st.events.map((e) => [e.seq, e]));
            for (const e of s.events) map.set(e.seq, e);
            return { events: [...map.values()].sort((a, b) => b.seq - a.seq).slice(0, 300) };
          });
        }
      },
      onEvent: (e) => {
        set((st) => {
          const events = st.events.some((x) => x.seq === e.seq) ? st.events : [e, ...st.events].slice(0, 300);
          const stream = st.detail && e.task_id === st.detail.id && !st.stream.some((x) => x.seq === e.seq)
            ? [...st.stream, e] : st.stream;
          return { events, stream };
        });
      },
    });
    void getSocket().then(() => startHeartbeat());

    // REST-fallback начального состояния + каталог + зеркало + тик
    void me2Fetch<Snapshot>("/state?XTransformPort=3041").then((d) => {
      if (d?.ok) set({ snap: d, events: d.events ?? [] });
    });
    void me2Fetch<{ ok?: boolean; actions: ActionMeta[] }>("/actions?XTransformPort=3041").then((d) => {
      if (d?.ok) set({ catalog: d.actions ?? [] });
    });
    const loadMirror = () => {
      void me2Fetch<Mirror & { ok: boolean }>("/evidence?XTransformPort=3041").then((d) => {
        if (d?.ok) set({ mirror: { mode: d.mode, pending: d.pending, method: d.method, last_error: d.last_error, last_sent_seq: d.last_sent_seq, storage: d.storage, ddl: d.ddl } });
      });
    };
    loadMirror();
    const ev = setInterval(loadMirror, 10_000);
    const tick = setInterval(() => set({ nowMs: Date.now() }), 1000);

    // selection-мост (legacy-совместимость): fleet-grid → me2:select-chat → store
    window.addEventListener("me2:select-chat", ((e: CustomEvent<string>) => {
      const id = e.detail ?? null;
      if (id !== get().chatId) set({ chatId: id });
      window.dispatchEvent(new CustomEvent("me2:chat-selected", { detail: id }));
    }) as EventListener);

    // hotkeys: ⌘K палитра · N новая задача · Alt+1..0 страницы · Alt+←/→ недавние
    document.addEventListener("keydown", (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); set({ paletteOpen: !get().paletteOpen });
      } else if ((e.key === "j" || e.key === "J") && (e.metaKey || e.ctrlKey) && !e.altKey && !typing) {
        e.preventDefault(); get().setContextDrawer(!get().contextDrawerPreferredOpen);
      } else if ((e.key === "n" || e.key === "n") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        e.preventDefault(); set({ dialog: "newTask" });
      } else if (e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.key >= "1" && e.key <= "9") {
          const p = PAGES[Number(e.key) - 1]; if (p) { e.preventDefault(); get().setPage(p.key); }
        } else if (e.key === "0") {
          e.preventDefault(); get().setPage("system");
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const st = get();
          const delta = e.key === "ArrowLeft" ? -1 : 1;
          const nextIndex = st.pageHistoryIndex + delta;
          if (nextIndex >= 0 && nextIndex < st.recentPages.length) {
            e.preventDefault();
            const target = st.recentPages[nextIndex];
            set({ page: target, pageHistoryIndex: nextIndex });
            syncPagePresentation(target);
          }
        }
      }
    });

    // Electron-мост (унификация оболочки, R46): native-события + TabRegistry
    void (async () => {
      try {
        const { me2Desktop } = await import("@/lib/me2-desktop");
        const d = me2Desktop();
        if (!d) return;
        d.onTabActivated((p) => { if (p?.kind === "page" && p.key) get().setPage(p.key as PageKey); });
        d.onNativeEvent((p) => {
          const type = String(p?.type ?? "");
          if (type === "open-site-prompt") {
            // Renderer-owned dialog participates in primary-overlay composition,
            // unlike window.prompt which bypassed ME2 semantic/visual state.
            set({ dialog: "openSite" });
          } else if (type === "update-check") {
            void d.update.check().then((u) => {
              toastBus({ title: u.updateAvailable ? `обновление доступно: ${u.latest}` : `актуальная версия (${u.current})`, description: u.updateAvailable ? "Применить обновление может только оболочка MetaEngine" : u.error ?? "GitHub Releases" });
            });
          } else if (type === "chat-create") {
            window.dispatchEvent(new CustomEvent("me2:chat-create"));
          }
        });
      } catch { /* браузерный рантайм */ }
    })();

    // Native Browser geometry can force the drawer closed on short windows.
    // Reconcile presentation after resize without changing the saved preference.
    let drawerResizeFrame = 0;
    const onDrawerResize = () => {
      window.cancelAnimationFrame(drawerResizeFrame);
      drawerResizeFrame = window.requestAnimationFrame(() => get().syncContextDrawer());
    };
    window.addEventListener("resize", onDrawerResize);

    // cleanup при выгрузке страницы
    window.addEventListener("beforeunload", () => {
      clearInterval(ev);
      clearInterval(tick);
      window.cancelAnimationFrame(drawerResizeFrame);
      window.removeEventListener("resize", onDrawerResize);
    });
  },

  setPage: (p) => {
    set((st) => {
      if (st.page === p) return st;
      const prefix = st.recentPages.slice(0, st.pageHistoryIndex + 1);
      const history = [...prefix, p].slice(-20);
      return {
        page: p,
        recentPages: history,
        pageHistoryIndex: history.length - 1,
      };
    });
    syncPagePresentation(p);
    if (p === "command") get().syncContextDrawer();
    else set({ contextDrawerOpen: get().contextDrawerPreferredOpen });
  },

  setWorkspace: (w) => {
    const layoutPreference = readWorkspaceLayout(w);
    set({
      workspace: w,
      contextDrawerPreferredOpen: layoutPreference.drawerOpen,
      contextDrawerTab: layoutPreference.drawerTab,
      commandRailPreferredOpen: layoutPreference.commandRailOpen,
    });
    try { localStorage.setItem(WS_LS, w); } catch { /* приватный режим */ }
    const ws = WORKSPACES.find((x) => x.key === w);
    if (ws) get().setPage(ws.page);
    get().syncContextDrawer(layoutPreference.drawerOpen);
  },

  setPalette: (open) => set({ paletteOpen: open }),
  setDialog: (d) => set({ dialog: d }),

  openTask: (id) => {
    const st = get();
    const task = st.snap?.tasks.find((t) => t.id === id) ?? (st.snap?.archived ?? []).find((t) => t.id === id) ?? null;
    set({ detail: task, stream: [] });
    void me2Fetch<{ events: Event[] }>(`/events?task=${encodeURIComponent(id)}&limit=200&XTransformPort=3041`).then((d) => {
      if (d?.events) set({ stream: d.events });
    });
  },

  closeTask: () => set({ detail: null, stream: [] }),

  setChatId: (id) => {
    // единая точка выбора агента: store + window-события (совместимость компонентов)
    if (id !== get().chatId) set({ chatId: id });
    window.dispatchEvent(new CustomEvent("me2:select-chat", { detail: id }));
  },
}));

// ── удобные селекторы ───────────────────────────────────────────────────────────
export function useKpis() {
  const ready = useMe2((s) => s.snap?.stats.tasksReady ?? 0);
  const running = useMe2((s) => s.snap?.stats.tasksRunning ?? 0);
  const done = useMe2((s) => s.snap?.stats.tasksCompleted ?? 0);
  const fail = useMe2((s) => s.snap?.stats.tasksFailed ?? 0);
  const agentsBusy = useMe2((s) => s.snap?.stats.agentsBusy ?? 0);
  const agentsIdle = useMe2((s) => s.snap?.stats.agentsIdle ?? 0);
  const workersOnline = useMe2((s) => s.snap?.stats.workersOnline ?? 0);
  const budgetUsed = useMe2((s) => s.snap?.budget.used ?? 0);
  const budgetLimit = useMe2((s) => s.snap?.budget.limit ?? 24);
  return { ready, running, done, fail, agentsBusy, agentsIdle, workersOnline, budgetUsed, budgetLimit };
}

/** Активность для спарклайна: count по 12 окнам по 10с. */
export function useActivity(): number[] {
  const events = useMe2((s) => s.events);
  const nowMs = useMe2((s) => s.nowMs);
  return useMemo(() => {
    const win = 10_000;
    const arr = new Array(12).fill(0);
    for (const e of events.slice(0, 60)) {
      const dt = nowMs - new Date(e.ts).getTime();
      const idx = Math.floor(dt / win);
      if (idx >= 0 && idx < 12) arr[11 - idx] += 1;
    }
    return arr;
  }, [events, nowMs]);
}

/** Порождить задачу из диалога (legacy-контракт). */
export async function createTaskFromForm(f: { title: string; spec: string; role: string; steps: string; delay: string }): Promise<boolean> {
  const payload: Record<string, unknown> = {
    title: f.title.trim(),
    spec: f.spec,
    role: f.role === "ANY" ? null : f.role,
    max_steps: Math.max(1, Math.min(24, Number(f.steps) || 6)),
  };
  const delaySec = Math.max(0, Number(f.delay) || 0);
  const res = delaySec > 0
    ? await sendCommand("TASK_SCHEDULE", { ...payload, delay_sec: delaySec }, { quiet: true })
    : await sendCommand("TASK_ENQUEUE", payload, { quiet: true });
  if (res) {
    toastBus({
      title: delaySec > 0 ? `TASK_SCHEDULE ✓ (+${delaySec}s)` : "TASK_ENQUEUE ✓",
      description: `«${f.title.trim() || "без имени"}» — в очереди задач (TASKS)`,
    });
    return true;
  }
  toastBus({ title: "TASK_ENQUEUE ✗", description: "не удалось поставить задачу", variant: "destructive" });
  return false;
}
