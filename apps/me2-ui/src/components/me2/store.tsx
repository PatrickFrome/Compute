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
import { presentationSyncStillCurrent } from "@/lib/r85-ui-contracts.mjs";
import { resolveExactTaskStreamResponse, taskStreamResponseStillCurrent } from "@/lib/r95e-evidence-contracts.mjs";

// ── Pages (DaVinci-Resolve принцип: специализированные рабочие контексты) ──────
export type PageKey =
  | "browser" | "code" | "tasks"
  | "supervisor" | "memory" | "observability" | "system";

// R97 native swarm convergence: COMMAND/AGENTS/COMPUTE were daemon/API-agent
// surfaces. They are intentionally absent from production navigation.
export const PAGES: { key: PageKey; label: string; num: string }[] = [
  { key: "browser", label: "BROWSER", num: "1" },
  { key: "tasks", label: "TASKS", num: "2" },
  { key: "code", label: "CODE", num: "3" },
  { key: "supervisor", label: "SUPERVISOR", num: "4" },
  { key: "memory", label: "MEMORY", num: "5" },
  { key: "observability", label: "OBSERV", num: "6" },
  { key: "system", label: "SYSTEM", num: "7" },
];

// R94 shell IA: workflow stages are the primary navigation vocabulary.
// Existing module pages remain first-class destinations (palette/deep links) but
// are grouped under the stage that matches the operator's real work.
export type WorkflowStageKey = "command" | "plan" | "build" | "run" | "fleet" | "observe" | "system";
export const WORKFLOW_STAGES: Array<{
  key: WorkflowStageKey;
  label: string;
  num: string;
  primaryPage: PageKey;
  pages: readonly PageKey[];
  hint: string;
}> = [
  { key: "run", label: "FLEET", num: "1", primaryPage: "browser", pages: ["browser"], hint: "native z.ai Agent fleet and selected Browser surface" },
  { key: "plan", label: "PLAN", num: "2", primaryPage: "tasks", pages: ["tasks"], hint: "tasks, dependencies, execution plan" },
  { key: "build", label: "BUILD", num: "3", primaryPage: "code", pages: ["code"], hint: "code, diffs, tests, terminal" },
  { key: "fleet", label: "SUPERVISE", num: "4", primaryPage: "supervisor", pages: ["supervisor"], hint: "objectives, coordination, recovery and approvals" },
  { key: "observe", label: "OBSERVE", num: "5", primaryPage: "observability", pages: ["observability", "memory"], hint: "events, traces, memory and outcomes" },
  { key: "system", label: "SYSTEM", num: "6", primaryPage: "system", pages: ["system"], hint: "runtime, releases and settings" },
];

export function workflowStageForPage(page: PageKey) {
  return WORKFLOW_STAGES.find((stage) => stage.pages.includes(page)) ?? WORKFLOW_STAGES[0];
}

// ── Workspaces (пресеты рабочих контекстов) ─────────────────────────────────────
export type WorkspaceKey = "development" | "browser-ops" | "debugging" | "monitoring" | "supervise";
export const WORKSPACES: { key: WorkspaceKey; label: string; page: PageKey; hint: string }[] = [
  { key: "development", label: "Development", page: "browser", hint: "native Agent fleet + selected Browser surface" },
  { key: "browser-ops", label: "Browser Ops", page: "browser", hint: "native fleet and browser infrastructure" },
  { key: "debugging", label: "Debugging", page: "code", hint: "code, exec and sandboxes" },
  { key: "monitoring", label: "Monitoring", page: "observability", hint: "evidence, metrics and health" },
  { key: "supervise", label: "Supervisor", page: "supervisor", hint: "objectives, orchestration and recovery" },
];

export type PaletteMode = "all" | "actions" | "tasks" | "pages";
export type DialogKind = "newTask" | "eventsSearch" | "budget" | "reset" | "openSite" | null;
export type ContextDrawerTab = "selection" | "events" | "commands" | "runtime";
export type ContextDrawerDock = "bottom" | "right";
export type PeekKind = "task" | "agent";
export type PeekTarget = { kind: PeekKind; id: string };

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
  inspectedTaskId: string | null;
  stream: Event[];
  streamTaskId: string | null;
  streamState: "UNBOUND" | "LOADING" | "EXACT" | "DEGRADED";
  // R96 temporary Peek is ephemeral presentation state only: no persistence/data authority.
  peekTarget: PeekTarget | null;
  // contextual drawer (read-only presentation plane)
  contextDrawerPreferredOpen: boolean;
  contextDrawerOpen: boolean;
  contextDrawerTab: ContextDrawerTab;
  contextDrawerFollowSelection: boolean;
  contextDrawerPreferredHeight: number;
  contextDrawerHeight: number;
  contextDrawerPreferredWidth: number;
  contextDrawerWidth: number;
  contextDrawerDock: ContextDrawerDock;
  runTelemetryInspectorVisible: boolean;
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
  setPeekTarget: (target: PeekTarget | null) => void;
  setContextDrawer: (open: boolean) => void;
  setContextDrawerTab: (tab: ContextDrawerTab) => void;
  setContextDrawerFollowSelection: (follow: boolean) => void;
  setContextDrawerHeight: (height: number, persist?: boolean) => void;
  setContextDrawerWidth: (width: number, persist?: boolean) => void;
  setContextDrawerDock: (dock: ContextDrawerDock) => void;
  syncContextDrawer: (preferred?: boolean, height?: number, width?: number, dock?: ContextDrawerDock) => void;
  setCommandRailPreference: (open: boolean) => void;
  resetWorkspaceLayout: () => void;
  openTask: (id: string) => void;
  closeTask: () => void;
  setChatId: (id: string | null) => void;
  setBusy: (b: boolean) => void;
  setChromeOverlay: (source: string, open: boolean) => void;
}

let initGuard = false;
let contextDrawerSyncSeq = 0;
let taskStreamRequestSeq = 0;
const PAGE_LS = "me2.page.v1";
const WS_LS = "me2.workspace.v1";
const CONTEXT_DRAWER_LS = "me2.context-drawer.open.v1"; // legacy migration
const CONTEXT_DRAWER_TAB_LS = "me2.context-drawer.tab.v1"; // legacy migration
const WORKSPACE_LAYOUTS_LS = "me2.workspace-layouts.v1";
const CONTEXT_DRAWER_DEFAULT_HEIGHT = 200;
const CONTEXT_DRAWER_MIN_HEIGHT = 160;
const CONTEXT_DRAWER_MAX_HEIGHT = 360;
const CONTEXT_DRAWER_DEFAULT_WIDTH = 380;
const CONTEXT_DRAWER_MIN_WIDTH = 320;
const CONTEXT_DRAWER_MAX_WIDTH = 520;
const clampContextDrawerHeight = (height: number) => Math.max(
  CONTEXT_DRAWER_MIN_HEIGHT,
  Math.min(CONTEXT_DRAWER_MAX_HEIGHT, Math.round(Number(height) || CONTEXT_DRAWER_DEFAULT_HEIGHT)),
);
const clampContextDrawerWidth = (width: number) => Math.max(
  CONTEXT_DRAWER_MIN_WIDTH,
  Math.min(CONTEXT_DRAWER_MAX_WIDTH, Math.round(Number(width) || CONTEXT_DRAWER_DEFAULT_WIDTH)),
);

type WorkspaceLayoutPreference = {
  drawerOpen: boolean;
  drawerTab: ContextDrawerTab;
  drawerFollowSelection: boolean;
  drawerHeight: number;
  drawerWidth: number;
  drawerDock: ContextDrawerDock;
  commandRailOpen: boolean;
};

function readWorkspaceLayout(workspace: WorkspaceKey): WorkspaceLayoutPreference {
  try {
    const raw = localStorage.getItem(WORKSPACE_LAYOUTS_LS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<WorkspaceKey, Partial<WorkspaceLayoutPreference>>>;
      const row = parsed?.[workspace];
      const tab = row?.drawerTab;
      if (row && typeof row.drawerOpen === "boolean" && (tab === "selection" || tab === "events" || tab === "commands" || tab === "runtime")) {
        const rail = typeof row.commandRailOpen === "boolean"
          ? row.commandRailOpen
          : localStorage.getItem(`me2.command.agent-rail.v2:${workspace}`) !== "0";
        return {
          drawerOpen: row.drawerOpen,
          drawerTab: tab,
          drawerFollowSelection: typeof row.drawerFollowSelection === "boolean" ? row.drawerFollowSelection : true,
          drawerHeight: clampContextDrawerHeight(Number(row.drawerHeight ?? CONTEXT_DRAWER_DEFAULT_HEIGHT)),
          drawerWidth: clampContextDrawerWidth(Number(row.drawerWidth ?? CONTEXT_DRAWER_DEFAULT_WIDTH)),
          drawerDock: row.drawerDock === "right" ? "right" : "bottom",
          commandRailOpen: rail,
        };
      }
    }
    const legacyTab = localStorage.getItem(CONTEXT_DRAWER_TAB_LS);
    const legacyRail = localStorage.getItem(`me2.command.agent-rail.v2:${workspace}`)
      ?? localStorage.getItem("me2.command.agent-rail.v1");
    return {
      drawerOpen: localStorage.getItem(CONTEXT_DRAWER_LS) === "1",
      drawerTab: legacyTab === "selection" || legacyTab === "commands" || legacyTab === "runtime" ? legacyTab : "events",
      drawerFollowSelection: true,
      drawerHeight: CONTEXT_DRAWER_DEFAULT_HEIGHT,
      drawerWidth: CONTEXT_DRAWER_DEFAULT_WIDTH,
      drawerDock: "bottom",
      commandRailOpen: legacyRail !== "0",
    };
  } catch {
    return {
      drawerOpen: false,
      drawerTab: "events",
      drawerFollowSelection: true,
      drawerHeight: CONTEXT_DRAWER_DEFAULT_HEIGHT,
      drawerWidth: CONTEXT_DRAWER_DEFAULT_WIDTH,
      drawerDock: "bottom",
      commandRailOpen: true,
    };
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

function syncPagePresentation(p: PageKey): Promise<unknown> | null {
  try {
    localStorage.setItem(PAGE_LS, p);
    history.replaceState(null, "", `#${p}`);
  } catch { /* private mode */ }

  let primaryPageAck: Promise<unknown> | null = null;
  try {
    const shell = (window as Window & {
      metaengineShell?: {
        setPrimaryPage?: (page: string) => Promise<unknown> | unknown;
        setPrimaryOverlay?: (active: boolean) => unknown;
      };
    }).metaengineShell;
    const result = shell?.setPrimaryPage?.(p);
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      primaryPageAck = Promise.resolve(result);
    }
  } catch { /* Browser preload bridge absent in web-only mode */ }

  void (async () => {
    try {
      const { me2Desktop } = await import("@/lib/me2-desktop");
      me2Desktop()?.tabs.setActive("page", p);
    } catch { /* bridge absent */ }
  })();
  return primaryPageAck;
}

export const useMe2 = create<Me2State>((set, get) => ({
  connected: false,
  snap: null,
  events: [],
  catalog: [],
  mirror: null,
  nowMs: Date.now(),
  page: "browser",
  recentPages: ["browser"],
  pageHistoryIndex: 0,
  workspace: "development",
  paletteOpen: false,
  dialog: null,
  detail: null,
  inspectedTaskId: null,
  stream: [],
  streamTaskId: null,
  streamState: "UNBOUND",
  peekTarget: null,
  contextDrawerPreferredOpen: false,
  contextDrawerOpen: false,
  contextDrawerTab: "events",
  contextDrawerFollowSelection: true,
  contextDrawerPreferredHeight: CONTEXT_DRAWER_DEFAULT_HEIGHT,
  contextDrawerHeight: CONTEXT_DRAWER_DEFAULT_HEIGHT,
  contextDrawerPreferredWidth: CONTEXT_DRAWER_DEFAULT_WIDTH,
  contextDrawerWidth: CONTEXT_DRAWER_DEFAULT_WIDTH,
  contextDrawerDock: "bottom",
  runTelemetryInspectorVisible: false,
  commandRailPreferredOpen: true,
  chatId: null,
  busyAction: false,
  chromeOverlaySources: [],
  booted: false,

  setBusy: (b) => set({ busyAction: b }),
  setPeekTarget: (target) => set({ peekTarget: target }),
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

  syncContextDrawer: (preferred, height, width, dock) => {
    const request = {
      seq: ++contextDrawerSyncSeq,
      workspace: get().workspace,
      page: get().page,
    };
    const want = typeof preferred === "boolean" ? preferred : get().contextDrawerPreferredOpen;
    const wantedHeight = clampContextDrawerHeight(
      typeof height === "number" ? height : get().contextDrawerPreferredHeight,
    );
    const wantedWidth = clampContextDrawerWidth(
      typeof width === "number" ? width : get().contextDrawerPreferredWidth,
    );
    const wantedDock: ContextDrawerDock = dock === "right" || dock === "bottom"
      ? dock
      : get().contextDrawerDock;

    if (request.page !== "browser") {
      set({
        contextDrawerPreferredOpen: want,
        contextDrawerOpen: want,
        contextDrawerPreferredHeight: wantedHeight,
        contextDrawerHeight: wantedHeight,
        contextDrawerPreferredWidth: wantedWidth,
        contextDrawerWidth: wantedWidth,
        contextDrawerDock: wantedDock,
        runTelemetryInspectorVisible: false,
      });
      return;
    }

    const shell = (window as Window & {
      metaengineShell?: {
        setPrimaryContextDrawer?: (
          open: boolean,
          dock: ContextDrawerDock,
          height: number,
          width: number,
        ) => Promise<{
          effective_open?: boolean;
          dock?: ContextDrawerDock;
          drawer_height?: number;
          drawer_width?: number;
          run_inspector_visible?: boolean;
        } | null>;
      };
    }).metaengineShell;

    if (!shell?.setPrimaryContextDrawer) {
      set({
        contextDrawerPreferredOpen: want,
        contextDrawerOpen: want,
        contextDrawerPreferredHeight: wantedHeight,
        contextDrawerHeight: wantedHeight,
        contextDrawerPreferredWidth: wantedWidth,
        contextDrawerWidth: wantedWidth,
        contextDrawerDock: wantedDock,
        runTelemetryInspectorVisible:
          typeof window !== "undefined"
          && window.innerWidth >= 1124
          && !(want && wantedDock === "right"),
      });
      return;
    }

    void shell.setPrimaryContextDrawer(want, wantedDock, wantedHeight, wantedWidth).then((result) => {
      if (!presentationSyncStillCurrent(request, {
        seq: contextDrawerSyncSeq,
        workspace: get().workspace,
        page: get().page,
      })) return;
      const effectiveOpen = typeof result?.effective_open === "boolean" ? result.effective_open : want;
      const effectiveHeight = effectiveOpen && wantedDock === "bottom"
        ? clampContextDrawerHeight(Number(result?.drawer_height ?? wantedHeight))
        : wantedHeight;
      const effectiveWidth = effectiveOpen && wantedDock === "right"
        ? clampContextDrawerWidth(Number(result?.drawer_width ?? wantedWidth))
        : wantedWidth;
      set({
        contextDrawerPreferredOpen: want,
        contextDrawerOpen: effectiveOpen,
        contextDrawerPreferredHeight: wantedHeight,
        contextDrawerHeight: effectiveHeight,
        contextDrawerPreferredWidth: wantedWidth,
        contextDrawerWidth: effectiveWidth,
        contextDrawerDock: wantedDock,
        runTelemetryInspectorVisible: result?.run_inspector_visible === true,
      });
    }).catch(() => {
      if (!presentationSyncStillCurrent(request, {
        seq: contextDrawerSyncSeq,
        workspace: get().workspace,
        page: get().page,
      })) return;
      set({
        contextDrawerPreferredOpen: want,
        contextDrawerOpen: false,
        contextDrawerPreferredHeight: wantedHeight,
        contextDrawerHeight: wantedHeight,
        contextDrawerPreferredWidth: wantedWidth,
        contextDrawerWidth: wantedWidth,
        contextDrawerDock: wantedDock,
        runTelemetryInspectorVisible: false,
      });
    });
  },

  setContextDrawer: (open) => {
    set({ contextDrawerPreferredOpen: open });
    writeWorkspaceLayout(get().workspace, { drawerOpen: open });
    get().syncContextDrawer(open, get().contextDrawerPreferredHeight, get().contextDrawerPreferredWidth, get().contextDrawerDock);
  },

  setContextDrawerTab: (tab) => {
    set({ contextDrawerTab: tab });
    writeWorkspaceLayout(get().workspace, { drawerTab: tab });
  },

  setContextDrawerFollowSelection: (follow) => {
    set({ contextDrawerFollowSelection: follow });
    writeWorkspaceLayout(get().workspace, { drawerFollowSelection: follow });
  },

  setContextDrawerHeight: (height, persist = true) => {
    const wantedHeight = clampContextDrawerHeight(height);
    set({ contextDrawerPreferredHeight: wantedHeight });
    if (persist) writeWorkspaceLayout(get().workspace, { drawerHeight: wantedHeight });
    get().syncContextDrawer(get().contextDrawerPreferredOpen, wantedHeight, get().contextDrawerPreferredWidth, get().contextDrawerDock);
  },

  setContextDrawerWidth: (width, persist = true) => {
    const wantedWidth = clampContextDrawerWidth(width);
    set({ contextDrawerPreferredWidth: wantedWidth });
    if (persist) writeWorkspaceLayout(get().workspace, { drawerWidth: wantedWidth });
    get().syncContextDrawer(get().contextDrawerPreferredOpen, get().contextDrawerPreferredHeight, wantedWidth, get().contextDrawerDock);
  },

  setContextDrawerDock: (dock) => {
    if (dock !== "bottom" && dock !== "right") return;
    set({ contextDrawerDock: dock });
    writeWorkspaceLayout(get().workspace, { drawerDock: dock });
    get().syncContextDrawer(get().contextDrawerPreferredOpen, get().contextDrawerPreferredHeight, get().contextDrawerPreferredWidth, dock);
  },

  setCommandRailPreference: (open) => {
    set({ commandRailPreferredOpen: open });
    writeWorkspaceLayout(get().workspace, { commandRailOpen: open });
  },

  resetWorkspaceLayout: () => {
    const defaults: WorkspaceLayoutPreference = {
      drawerOpen: false,
      drawerTab: "events",
      drawerFollowSelection: true,
      drawerHeight: CONTEXT_DRAWER_DEFAULT_HEIGHT,
      drawerWidth: CONTEXT_DRAWER_DEFAULT_WIDTH,
      drawerDock: "bottom",
      commandRailOpen: true,
    };
    writeWorkspaceLayout(get().workspace, defaults);
    set({
      contextDrawerPreferredOpen: defaults.drawerOpen,
      contextDrawerTab: defaults.drawerTab,
      contextDrawerFollowSelection: defaults.drawerFollowSelection,
      contextDrawerPreferredHeight: defaults.drawerHeight,
      contextDrawerHeight: defaults.drawerHeight,
      contextDrawerPreferredWidth: defaults.drawerWidth,
      contextDrawerWidth: defaults.drawerWidth,
      contextDrawerDock: defaults.drawerDock,
      commandRailPreferredOpen: defaults.commandRailOpen,
    });
    get().syncContextDrawer(defaults.drawerOpen, defaults.drawerHeight, defaults.drawerWidth, defaults.drawerDock);
    try {
      window.dispatchEvent(new CustomEvent("me2:workspace-layout-reset", { detail: get().workspace }));
    } catch { /* browser unavailable */ }
  },

  init: () => {
    if (initGuard) return;
    initGuard = true;
    set({ booted: true });

    // R97 single-main-workspace: every browser launch returns to the live
    // chat-fleet workspace. Advanced pages remain reachable only through the
    // command palette / Settings during the current session; stale page/hash
    // persistence never replaces the primary workspace on the next boot.
    window.setTimeout(() => {
      try {
        const restoredPage: PageKey = "browser";
        set({ page: restoredPage, recentPages: [restoredPage], pageHistoryIndex: 0 });
        const primaryPageAck = syncPagePresentation(restoredPage);
        const storedWs = localStorage.getItem(WS_LS) as WorkspaceKey | null;
        const activeWorkspace = storedWs && WORKSPACES.some((item) => item.key === storedWs) ? storedWs : get().workspace;
        if (activeWorkspace !== get().workspace) set({ workspace: activeWorkspace });
        const workspaceLayout = readWorkspaceLayout(activeWorkspace);
        set({
          contextDrawerPreferredOpen: workspaceLayout.drawerOpen,
          contextDrawerTab: workspaceLayout.drawerTab,
          contextDrawerFollowSelection: workspaceLayout.drawerFollowSelection,
          contextDrawerPreferredHeight: workspaceLayout.drawerHeight,
          contextDrawerHeight: workspaceLayout.drawerHeight,
          contextDrawerPreferredWidth: workspaceLayout.drawerWidth,
          contextDrawerWidth: workspaceLayout.drawerWidth,
          contextDrawerDock: workspaceLayout.drawerDock,
          commandRailPreferredOpen: workspaceLayout.commandRailOpen,
        });
        writeWorkspaceLayout(activeWorkspace, workspaceLayout); // materialize legacy preference once
        const reconcileRestoredGeometry = () => {
          if (get().page !== restoredPage) return;
          get().syncContextDrawer(
            workspaceLayout.drawerOpen,
            workspaceLayout.drawerHeight,
            workspaceLayout.drawerWidth,
            workspaceLayout.drawerDock,
          );
        };
        if (restoredPage === "browser" && primaryPageAck) {
          void primaryPageAck.then(reconcileRestoredGeometry).catch(() => {
            if (get().page === "browser") set({ runTelemetryInspectorVisible: false });
          });
        } else {
          reconcileRestoredGeometry();
        }
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
          const stream = st.inspectedTaskId
            && st.streamTaskId === st.inspectedTaskId
            && e.task_id === st.inspectedTaskId
            && !st.stream.some((x) => x.seq === e.seq)
            ? [...st.stream, e].slice(-200)
            : st.stream;
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

    // R97 single-main-workspace: the only global UI shortcut is Ctrl/Cmd+K.
    // Advanced pages/drawers are intentionally NOT reachable through legacy
    // Alt+stage, history, Ctrl+J, or bare-N shortcuts; use Settings or search.
    document.addEventListener("keydown", (e) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        set({ paletteOpen: !get().paletteOpen });
      }
    });

    // Electron-мост (унификация оболочки, R46): native-события + TabRegistry
    void (async () => {
      try {
        const { me2Desktop } = await import("@/lib/me2-desktop");
        const d = me2Desktop();
        if (!d) return;
        d.onTabActivated((p) => {
          // R97: native/legacy page-tab activation may only return to the
          // primary Chat Fleet workspace. Hidden advanced pages open through
          // Settings or the command palette, never through a third nav rail.
          if (p?.kind === "page" && p.key === "browser") get().setPage("browser");
        });
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
    // R97 compatibility fence: historical deep links into daemon/API-agent
    // surfaces never resurrect those control planes. They converge to the
    // canonical native Browser fleet workspace.
    const nextPage: PageKey = (p === "command" || p === "agents" || p === "compute") ? "browser" : p;
    // Any page transition invalidates in-flight drawer geometry replies.
    // A new RUN/Browser sync below gets a fresh sequence/context token.
    contextDrawerSyncSeq += 1;
    set((st) => {
      if (st.page === nextPage) return st;
      const prefix = st.recentPages.slice(0, st.pageHistoryIndex + 1);
      const history = [...prefix, nextPage].slice(-20);
      return {
        page: nextPage,
        peekTarget: null,
        recentPages: history,
        pageHistoryIndex: history.length - 1,
      };
    });
    const primaryPageAck = syncPagePresentation(nextPage);
    if (nextPage === "browser") {
      const reconcileRunGeometry = () => {
        if (get().page === "browser") get().syncContextDrawer();
      };
      if (primaryPageAck) {
        void primaryPageAck.then(reconcileRunGeometry).catch(() => {
          if (get().page === "browser") set({ runTelemetryInspectorVisible: false });
        });
      } else {
        reconcileRunGeometry();
      }
    } else {
      set({
        contextDrawerOpen: get().contextDrawerPreferredOpen,
        contextDrawerHeight: get().contextDrawerPreferredHeight,
        contextDrawerWidth: get().contextDrawerPreferredWidth,
        runTelemetryInspectorVisible: false,
      });
    }
  },

  setWorkspace: (w) => {
    // Workspace is part of the causal identity of a layout request.
    contextDrawerSyncSeq += 1;
    const layoutPreference = readWorkspaceLayout(w);
    set({
      workspace: w,
      peekTarget: null,
      contextDrawerPreferredOpen: layoutPreference.drawerOpen,
      contextDrawerTab: layoutPreference.drawerTab,
      contextDrawerFollowSelection: layoutPreference.drawerFollowSelection,
      contextDrawerPreferredHeight: layoutPreference.drawerHeight,
      contextDrawerHeight: layoutPreference.drawerHeight,
      contextDrawerPreferredWidth: layoutPreference.drawerWidth,
      contextDrawerWidth: layoutPreference.drawerWidth,
      contextDrawerDock: layoutPreference.drawerDock,
      commandRailPreferredOpen: layoutPreference.commandRailOpen,
    });
    try { localStorage.setItem(WS_LS, w); } catch { /* приватный режим */ }
    const ws = WORKSPACES.find((x) => x.key === w);
    if (ws) get().setPage(ws.page);
  },

  setPalette: (open) => set({ paletteOpen: open }),
  setDialog: (d) => set({ dialog: d }),

  openTask: (id) => {
    const requestSeq = ++taskStreamRequestSeq;
    const st = get();
    const task = st.snap?.tasks.find((t) => t.id === id) ?? (st.snap?.archived ?? []).find((t) => t.id === id) ?? null;
    set((state) => ({
      detail: task,
      inspectedTaskId: task?.id ?? id,
      stream: [],
      streamTaskId: id,
      streamState: "LOADING",
      contextDrawerTab: state.contextDrawerPreferredOpen && state.contextDrawerFollowSelection ? "selection" : state.contextDrawerTab,
    }));
    if (get().contextDrawerPreferredOpen && get().contextDrawerFollowSelection) {
      writeWorkspaceLayout(get().workspace, { drawerTab: "selection" });
    }
    void me2Fetch<{ events: Event[] }>(
      `/events?task=${encodeURIComponent(id)}&limit=200&XTransformPort=3041`,
      { signal: AbortSignal.timeout(8_000) },
    ).then((d) => {
      set((state) => {
        if (!taskStreamResponseStillCurrent(
          { seq: requestSeq, taskId: id },
          { seq: taskStreamRequestSeq, taskId: state.inspectedTaskId, streamTaskId: state.streamTaskId },
        )) return {};
        const resolved = resolveExactTaskStreamResponse({
          request: { seq: requestSeq, taskId: id },
          current: {
            seq: taskStreamRequestSeq,
            taskId: state.inspectedTaskId,
            streamTaskId: state.streamTaskId,
            stream: state.stream,
          },
          responseEvents: d?.events ?? null,
          limit: 200,
        });
        if (!resolved.applied || !resolved.patch) return {};
        return resolved.patch as Pick<Me2State, "stream" | "streamState">;
      });
    });
  },

  closeTask: () => {
    // Closing the Task Sheet is not deselection. Keep the bounded exact stream
    // alive for OBSERVE; a later openTask() advances generation and replaces it.
    set({ detail: null });
  },

  setChatId: (id) => {
    // единая точка выбора агента: store + window-события (совместимость компонентов)
    if (id !== get().chatId) {
      set((state) => ({
        chatId: id,
        contextDrawerTab: id && state.contextDrawerPreferredOpen && state.contextDrawerFollowSelection ? "selection" : state.contextDrawerTab,
      }));
      if (id && get().contextDrawerPreferredOpen && get().contextDrawerFollowSelection) {
        writeWorkspaceLayout(get().workspace, { drawerTab: "selection" });
      }
    }
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
