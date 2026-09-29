"use client";

/**
 * ME2 CHAT-SWARM v1.0.0 — живая консоль роя.
 *
 * Источники данных:
 *  - REST: GET /api/swarm/{state,messages,memory,proposals}; если прокси /api/swarm/*
 *    ещё не поднят (Next отдаёт HTML catch-all), используется gateway-трансформ
 *    того же origin: `${path}?XTransformPort=3046`.
 *  - WebSocket: socket.io `/?XTransformPort=3047` (path "/"), событие "swarm_event".
 *  - Действия: POST /chat /broadcast /spawn /goal /mute /kill.
 *
 * Рой живёт непрерывно — консоль только наблюдает и изредка помогает.
 */

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import {
  Baby,
  BookOpen,
  Brain,
  Download,
  Ghost,
  GitBranch,
  Lightbulb,
  Loader2,
  Megaphone,
  MessagesSquare,
  MonitorSmartphone,
  Network,
  RefreshCw,
  SlidersHorizontal,
  Target,
  TreePine,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ────────────────────────────── контракты данных ────────────────────────────── */

interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  generation: number;
  parent_id: string | null;
  state: string;
  cycles: number;
  born: string;
  last_seen: string;
  muted: boolean;
  improvements: string[];
}

interface LineageNode {
  id: string;
  name: string;
  parentId: string | null;
  generation: number;
  role: string;
  state: string;
  cycles: number;
  muted: boolean;
}

interface LineageEdge {
  from: string;
  to: string;
}

interface SwarmState {
  ok: boolean;
  agents: SwarmAgent[];
  lineage: { nodes: LineageNode[]; edges: LineageEdge[] };
  goals: string[];
  version: string;
  population: number;
  generations: number;
  messages: number;
  lessons: number;
  memories: number;
  cycles: number;
  uptimeSec: number;
  genesis: string;
}

interface SwarmMessage {
  id: number;
  ts: string;
  from_id: string | null;
  from_name: string;
  kind: string;
  to_id: string | null;
  channel: string;
  text: string;
  generation: number | null;
}

interface Lesson {
  id: number;
  ts: string;
  by_name: string;
  text: string;
  generation: number;
}

interface MemoryItem {
  id: number;
  ts: string;
  agent_id: string;
  agent_name: string;
  text: string;
  kind: string;
}

interface Proposal {
  ts: string;
  type: string;
  payload: string;
}

type SwarmEventType =
  | "message"
  | "spawn"
  | "retire"
  | "lesson"
  | "browser"
  | "state"
  | "self_improve";

interface SwarmEvent {
  type: SwarmEventType;
  data: unknown;
  ts: string;
}

interface SpawnEventData {
  id?: string;
  name?: string;
  role?: string;
  generation?: number;
  parent?: string | null;
  ts?: string;
}

interface LessonEventData {
  by?: string;
  text?: string;
  ts?: string;
}

interface BrowserEventData {
  by?: string;
  action?: string;
  payload?: unknown;
  ts?: string;
}

interface StateEventData {
  version?: string;
  population?: number;
  generations?: number;
  messages?: number;
  lessons?: number;
  memories?: number;
  cycles?: number;
  uptimeSec?: number;
  genesis?: string;
}

/* ────────────────────────────── палитры и константы ────────────────────────────── */

type AccentKey = "emerald" | "amber" | "rose" | "violet" | "teal";

const ACCENT_KEYS: AccentKey[] = ["emerald", "amber", "rose", "violet", "teal"];

interface AccentPalette {
  dot: string;
  line: string;
  glow: string;
}

const ACCENTS: Record<AccentKey, AccentPalette> = {
  emerald: {
    dot: "bg-emerald-400",
    line: "via-emerald-500/60",
    glow: "shadow-[0_0_110px_-30px_rgba(16,185,129,0.55)]",
  },
  amber: {
    dot: "bg-amber-400",
    line: "via-amber-500/60",
    glow: "shadow-[0_0_110px_-30px_rgba(245,158,11,0.55)]",
  },
  rose: {
    dot: "bg-rose-400",
    line: "via-rose-500/60",
    glow: "shadow-[0_0_110px_-30px_rgba(244,63,94,0.55)]",
  },
  violet: {
    dot: "bg-violet-400",
    line: "via-violet-500/60",
    glow: "shadow-[0_0_110px_-30px_rgba(139,92,246,0.55)]",
  },
  teal: {
    dot: "bg-teal-400",
    line: "via-teal-500/60",
    glow: "shadow-[0_0_110px_-30px_rgba(20,184,166,0.55)]",
  },
};

const AVATAR_STYLES = [
  "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  "bg-teal-500/15 text-teal-300 ring-teal-500/30",
];

const ROLE_RU: Record<string, string> = {
  queen: "матка",
  architect: "архитектор",
  researcher: "исследователь",
  messenger: "вестник",
  critic: "критик",
  agent: "агент",
};

const FEED_CAP = 200;
const REST_PORT_FALLBACK = 3046;

const SCROLLBAR =
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700/80";

/* ────────────────────────────── чистые помощники ────────────────────────────── */

function roleRu(role: string): string {
  return ROLE_RU[role] ?? role;
}

function avatarStyle(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) % 1000003;
  }
  return AVATAR_STYLES[h % AVATAR_STYLES.length];
}

// EV-DATES: timestamp'ы консоли — относительное время (N мин назад),
// абсолют — Europe/Moscow в title; тайтик 30с держит относительность свежей.
const MOSCOW_TZ = "Europe/Moscow";

function fmtMoscowAbsolute(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const s = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  return `${s} (Europe/Moscow)`;
}

function fmtRelative(ts: string, now: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const sec = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (sec < 45) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч ${min % 60} мин назад`;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// EV-PERF: Ts мемоизирован — родительские рендеры (1Гц uptime) не перерисовывают
// сотни таймштампов; собственный 30-секундный тайтик живёт внутри и не зависит от memo.
const Ts = memo(function Ts({
  ts,
  mounted,
  className,
}: {
  ts: string | null | undefined;
  mounted: boolean;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const t = setInterval(tick, 30000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  const abs = mounted && ts ? fmtMoscowAbsolute(ts) : "";
  const rel = mounted && ts && now !== null ? fmtRelative(ts, now) : "--:--:--";
  return (
    <span className={className} title={abs || undefined}>
      {rel}
    </span>
  );
});

function humanizeUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${r}с`;
  return `${r}с`;
}

/**
 * Относительный fetch к рою: сначала канонический /api/swarm/* (прокси Next),
 * при отсутствии прокси (HTML catch-all / сеть) — gateway-трансформ того же
 * origin через ?XTransformPort=3046. Возвращает ответ с JSON-контентом,
 * если хоть один путь его отдал.
 */
async function swarmFetch(path: string, init?: RequestInit): Promise<Response> {
  const attempts = [`/api/swarm${path}`, `${path}?XTransformPort=${REST_PORT_FALLBACK}`];
  let last: Response | null = null;
  for (const url of attempts) {
    let res: Response;
    try {
      res = await fetch(url, {
        cache: "no-store",
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch {
      continue;
    }
    last = res;
    if ((res.headers.get("content-type") ?? "").includes("application/json")) return res;
  }
  if (!last) throw new Error("swarm: сеть недоступна");
  return last;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function kindRowClass(kind: string): string {
  switch (kind) {
    case "broadcast":
      return "border-l-2 border-amber-400/80 bg-amber-500/5";
    case "direct":
      return "border-l-2 border-violet-400/80";
    case "spawn":
      return "border-l-2 border-emerald-400/80 bg-emerald-500/5";
    case "user":
      return "border-l-2 border-zinc-500 bg-zinc-800";
    case "system":
      return "border-l-2 border-zinc-800";
    case "browser":
      return "border-l-2 border-teal-400/80 bg-teal-500/5";
    case "meta":
      return "border border-dashed border-zinc-700";
    default:
      return "border-l-2 border-zinc-800";
  }
}

function kindTextClass(kind: string): string {
  switch (kind) {
    case "user":
      return "text-zinc-100";
    case "system":
      return "italic text-zinc-500";
    default:
      return "text-zinc-300";
  }
}

interface ProposalParsed {
  name: string;
  text: string;
}

function parseProposal(p: Proposal): ProposalParsed {
  let d: { name?: unknown; agent?: unknown; addition?: unknown; proposal?: unknown; text?: unknown } = {};
  try {
    d = JSON.parse(p.payload) as typeof d;
  } catch {
    d = {};
  }
  const text = [d.addition, d.proposal, d.text].find(
    (x): x is string => typeof x === "string" && x.length > 0
  );
  const name = [d.name, d.agent].find((x): x is string => typeof x === "string" && x.length > 0);
  return { name: name ?? "рой", text: text ?? p.payload };
}

function proposalChipClass(type: string): string {
  switch (type) {
    case "swarm_improve":
      return "border-violet-500/40 bg-violet-500/10 text-violet-300";
    case "self_improve":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "goal_set":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    default:
      return "border-white/10 bg-white/5 text-zinc-400";
  }
}

/* ────────────────────────────── подкомпоненты ────────────────────────────── */

// EV-LIST-MEMO: строки вкладок «Память»/«Управление» мемоизированы — секундный тик
// (uptime/pulse) больше не перерисовывает lessons/memories/proposals целиком;
// каждый ряд перерисовывается только при смене своего элемента или mounted.

const LessonRow = memo(function LessonRow({ l, mounted }: { l: Lesson; mounted: boolean }) {
  return (
    <li className="rounded-lg border border-white/5 bg-zinc-900/40 p-2.5">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span className="font-medium text-amber-300/90">{l.by_name}</span>
        <span className="rounded bg-white/5 px-1 font-mono">G{l.generation}</span>
        <Ts ts={l.ts} mounted={mounted} className="ml-auto font-mono" />
      </div>
      <p className="mt-1 text-xs leading-snug text-zinc-300">{l.text}</p>
    </li>
  );
});

const MemoryRow = memo(function MemoryRow({ m, mounted }: { m: MemoryItem; mounted: boolean }) {
  return (
    <li className="rounded-lg border border-white/5 bg-zinc-900/40 p-2.5">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span className="font-medium text-violet-300/90">{m.agent_name}</span>
        <span className="rounded bg-white/5 px-1 text-[10px]">{m.kind}</span>
        <Ts ts={m.ts} mounted={mounted} className="ml-auto font-mono" />
      </div>
      <p className="mt-1 text-xs leading-snug text-zinc-300">{m.text}</p>
    </li>
  );
});

const ProposalRow = memo(function ProposalRow({ p, mounted }: { p: Proposal; mounted: boolean }) {
  const pp = parseProposal(p);
  return (
    <li className="flex gap-2.5 rounded-lg border border-white/5 bg-zinc-900/40 p-2.5">
      <Wrench className="mt-0.5 size-3.5 shrink-0 text-zinc-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge variant="outline" className={cn("text-[10px]", proposalChipClass(p.type))}>
            {p.type}
          </Badge>
          <span className="font-medium text-zinc-300">{pp.name}</span>
          <Ts ts={p.ts} mounted={mounted} className="ml-auto font-mono text-zinc-600" />
        </div>
        <p className="mt-1 text-xs leading-snug text-zinc-400">{pp.text}</p>
      </div>
    </li>
  );
});

// EV-PERF: мемоизация — StatChip перерисовывается только при смене label/value,
// а не на каждый секундный тик uptime родителя.
const StatChip = memo(function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold tabular-nums text-zinc-100">{value}</span>
    </div>
  );
});

function ControlCard({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
        {icon}
        {title}
      </h3>
      {hint ? (
        <p className="mb-3 mt-1 text-xs leading-snug text-zinc-500">{hint}</p>
      ) : (
        <div className="mb-3 mt-1" />
      )}
      {children}
    </section>
  );
}

// EV-PERF: FeedRow мемоизирован — до 200 строк ленты не перерисовываются на секундный
// тик uptime родителя; перерисовка только при смене самого сообщения/имён агентов.
const FeedRow = memo(function FeedRow({
  m,
  mounted,
  agentNames,
}: {
  m: SwarmMessage;
  mounted: boolean;
  agentNames: Record<string, string>;
}) {
  return (
    <div className={cn("flex gap-2.5 rounded-lg px-3 py-2", kindRowClass(m.kind))}>
      <div
        aria-hidden
        className={cn(
          "mt-0.5 flex size-7 shrink-0 select-none items-center justify-center rounded-full text-xs font-bold ring-1",
          avatarStyle(m.from_name)
        )}
      >
        {(m.from_name || "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className={cn("font-semibold", m.kind === "user" ? "text-zinc-50" : "text-zinc-200")}>
            {m.from_name}
          </span>
          {m.generation !== null && m.generation !== undefined && (
            <span className="rounded bg-white/5 px-1 font-mono text-[10px] text-zinc-400 ring-1 ring-white/10">
              G{m.generation}
            </span>
          )}
          {m.kind === "direct" && m.to_id && (
            <span className="text-violet-300/80">→ {agentNames[m.to_id] ?? m.to_id}</span>
          )}
          <span className="text-zinc-600">{m.channel}</span>
          <Ts
            ts={m.ts}
            mounted={mounted}
            className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600"
          />
        </div>
        <p className={cn("mt-0.5 break-words text-sm leading-snug", kindTextClass(m.kind))}>
          {m.kind === "spawn" && <Baby className="mr-1.5 inline size-3.5 text-emerald-400" aria-hidden />}
          {m.kind === "browser" && (
            <MonitorSmartphone className="mr-1.5 inline size-3.5 text-teal-400" aria-hidden />
          )}
          {m.text}
        </p>
      </div>
    </div>
  );
});

// EV-VIRT-SCROLL: окно видимости ленты — монтируются только последние ~30 строк из 200;
// при скролле вверх окно расширяется шагами по 30 с сохранением скролл-якоря,
// автоприлипание к низу работает как раньше. Компонент размонтируется вместе с табом,
// поэтому каждое переключение на «Поток» начинает с компактного окна (главная цель
// продолжения EV-PERF: 200 строк больше не монтируются целиком при смене таба).
const FEED_WINDOW = 30;
const FEED_WINDOW_STEP = 30;

function FeedList({
  messages,
  mounted,
  agentNames,
}: {
  messages: SwarmMessage[];
  mounted: boolean;
  agentNames: Record<string, string>;
}) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const feedStickRef = useRef(true);
  const feedAnchorRef = useRef(0);
  const [vis, setVis] = useState(FEED_WINDOW);

  const onFeedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    feedStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (!feedStickRef.current && el.scrollTop < 96 && vis < messages.length) {
      feedAnchorRef.current = el.scrollHeight;
      setVis((v) => Math.min(v + FEED_WINDOW_STEP, messages.length));
    }
  };

  useEffect(() => {
    const el = feedRef.current;
    if (el && feedStickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Восстановление якоря скролла после расширения окна (пока автоприлипание выключено).
  useEffect(() => {
    if (feedAnchorRef.current === 0) return;
    const el = feedRef.current;
    if (el && !feedStickRef.current) el.scrollTop += el.scrollHeight - feedAnchorRef.current;
    feedAnchorRef.current = 0;
  }, [vis]);

  const feedStart = Math.max(0, messages.length - vis);
  const windowed = messages.slice(feedStart);

  return (
    <div
      ref={feedRef}
      onScroll={onFeedScroll}
      className={cn(
        "max-h-[calc(100vh-280px)] min-h-[320px] space-y-1.5 overflow-y-auto p-3 pr-1",
        SCROLLBAR
      )}
    >
      {messages.length === 0 ? (
        <div className="flex min-h-[300px] items-center justify-center text-sm text-zinc-600">
          Рой просыпается…
        </div>
      ) : (
        windowed.map((m, j) => (
          <FeedRow key={`${m.id}-${feedStart + j}`} m={m} mounted={mounted} agentNames={agentNames} />
        ))
      )}
    </div>
  );
}

interface TreeNode {
  node: LineageNode;
  children: TreeNode[];
}

function buildLineageTree(nodes: LineageNode[], edges: LineageEdge[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  nodes.forEach((n) => byId.set(n.id, { node: n, children: [] }));
  const childIds = new Set<string>();
  edges.forEach((e) => {
    const parent = byId.get(e.from);
    const child = byId.get(e.to);
    if (parent && child) {
      parent.children.push(child);
      childIds.add(e.to);
    }
  });
  // Запасной путь: связь по parentId, если edge отсутствует.
  nodes.forEach((n) => {
    if (n.parentId && byId.has(n.parentId) && !childIds.has(n.id)) {
      const parent = byId.get(n.parentId);
      const self = byId.get(n.id);
      if (parent && self) {
        parent.children.push(self);
        childIds.add(n.id);
      }
    }
  });
  const roots = nodes
    .filter((n) => !childIds.has(n.id))
    .map((n) => byId.get(n.id))
    .filter((t): t is TreeNode => t !== undefined);
  const sortRec = (t: TreeNode): void => {
    t.children.sort(
      (a, b) => a.node.generation - b.node.generation || a.node.name.localeCompare(b.node.name)
    );
    t.children.forEach(sortRec);
  };
  roots.forEach(sortRec);
  return roots;
}

// EV-PERF: LineageRow мемоизирован (рекурсивные строки родословной).
const LineageRow = memo(function LineageRow({ t, depth }: { t: TreeNode; depth: number }) {
  const n = t.node;
  return (
    <div>
      <div className={cn("flex items-center gap-1.5 py-0.5", depth > 0 && "ml-4 border-l border-white/10 pl-3")}>
        {depth === 0 ? (
          <TreePine className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
        ) : (
          <GitBranch className="size-3 shrink-0 text-zinc-500" aria-hidden />
        )}
        <span
          className={cn(
            "truncate rounded-md px-1.5 py-0.5 text-xs ring-1",
            n.muted
              ? "bg-zinc-800/80 text-zinc-500 line-through ring-white/5"
              : n.state === "thinking"
                ? "bg-amber-500/10 text-amber-200 ring-amber-500/30"
                : "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
          )}
        >
          {n.name}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">{roleRu(n.role)}</span>
        <span className="shrink-0 rounded bg-white/5 px-1 font-mono text-[10px] text-zinc-500">
          G{n.generation}
        </span>
      </div>
      {t.children.length > 0 && (
        <div className="space-y-0.5">
          {t.children.map((c) => (
            <LineageRow key={c.node.id} t={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});

// EV-PERF: AgentCard мемоизирован + стабильные колбэки от родителя — 14 карточек
// не перерисовываются на секундный тик; только при смене своего агента/acting.
const AgentCard = memo(function AgentCard({
  a,
  acting,
  onToggleMute,
  onKill,
}: {
  a: SwarmAgent;
  acting: boolean;
  onToggleMute: (a: SwarmAgent) => void;
  onKill: (a: SwarmAgent) => void;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 transition-colors hover:border-white/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              title={a.state}
              className={cn(
                "size-2 shrink-0 rounded-full",
                a.state === "thinking"
                  ? "animate-pulse bg-amber-400"
                  : a.state === "living"
                    ? "bg-emerald-400"
                    : "bg-zinc-500"
              )}
            />
            <h4 className="truncate text-sm font-semibold text-zinc-100">{a.name}</h4>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-white/10 bg-white/5 text-[10px] uppercase tracking-wide text-zinc-400"
            >
              {roleRu(a.role)}
            </Badge>
            <span className="rounded bg-white/5 px-1 font-mono text-[10px] text-zinc-400 ring-1 ring-white/10">
              G{a.generation}
            </span>
            <span className="text-[10px] text-zinc-500">
              циклов <span className="tabular-nums text-zinc-300">{a.cycles}</span>
            </span>
            {a.muted && <span className="text-[10px] font-medium text-amber-400">на паузе</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={a.muted ? `Размутить агента ${a.name}` : `Заглушить агента ${a.name}`}
            disabled={acting}
            onClick={() => onToggleMute(a)}
            className="size-9 border-white/10 bg-white/5 hover:bg-white/10 focus-visible:ring-emerald-500/60"
          >
            {a.muted ? (
              <Volume2 className="text-emerald-300" aria-hidden />
            ) : (
              <VolumeX className="text-amber-300" aria-hidden />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Загасить агента ${a.name}`}
            disabled={acting}
            onClick={() => onKill(a)}
            className="size-9 border-white/10 bg-white/5 hover:bg-rose-500/10 focus-visible:ring-emerald-500/60"
          >
            <Ghost className="text-rose-300" aria-hidden />
          </Button>
        </div>
      </div>
      {a.improvements.length > 0 && (
        <ul className="space-y-1 border-t border-white/5 pt-2">
          {a.improvements.slice(0, 2).map((imp, i) => (
            <li key={i} className="line-clamp-1 text-[11px] leading-snug text-zinc-500">
              ↑ {imp}
            </li>
          ))}
          {a.improvements.length > 2 && (
            <li className="text-[11px] text-emerald-400/80">+{a.improvements.length - 2} улучшений…</li>
          )}
        </ul>
      )}
    </section>
  );
});

/* ────────────────────────────── консоль ────────────────────────────── */

type LoadPhase = "loading" | "ready" | "error";

function SwarmConsoleInner() {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [swarm, setSwarm] = useState<SwarmState | null>(null);
  const [messages, setMessages] = useState<SwarmMessage[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [connected, setConnected] = useState(false);
  const [banner, setBanner] = useState<{ by: string; text: string } | null>(null);
  const [accent, setAccent] = useState<AccentKey>("emerald");
  const [pulse, setPulse] = useState(false);
  const [uptimeLive, setUptimeLive] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  // Управление (controlled-формы)
  const [chat, setChat] = useState("");
  const [announce, setAnnounce] = useState("");
  const [spawnRole, setSpawnRole] = useState("");
  const [spawnName, setSpawnName] = useState("");
  const [spawnIntent, setSpawnIntent] = useState("");
  const [goalText, setGoalText] = useState("");

  const uptimeAtRef = useRef(0);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* — загрузка — */

  const loadAll = useCallback(async (initial: boolean) => {
    try {
      const [sRes, mRes, memRes, pRes] = await Promise.all([
        swarmFetch("/state"),
        swarmFetch("/messages?limit=120"),
        swarmFetch("/memory"),
        swarmFetch("/proposals"),
      ]);
      const s = (await sRes.json()) as SwarmState;
      const m = (await mRes.json()) as { messages?: unknown };
      const mem = (await memRes.json()) as { lessons?: unknown; memories?: unknown };
      const p = (await pRes.json()) as { proposals?: unknown };
      // EV-PWA offline-fallback: 502/catch-all прокси может вернуть JSON-мусор —
      // валидируем форму /state, иначе консоль крашится на рендере (lineage.nodes)
      if (!sRes.ok || !s || typeof s !== "object" || !Array.isArray(s.agents)) {
        throw new Error("swarm: invalid /state payload");
      }
      setSwarm(s);
      uptimeAtRef.current = Date.now();
      setUptimeLive(s.uptimeSec ?? 0);
      setMessages(asArray<SwarmMessage>(m.messages).slice(-FEED_CAP));
      setLessons(asArray<Lesson>(mem.lessons));
      setMemories(asArray<MemoryItem>(mem.memories));
      setProposals(asArray<Proposal>(p.proposals));
      setPhase("ready");
    } catch {
      if (initial) setPhase("error");
    }
  }, []);

  const refreshMemory = useCallback(async () => {
    try {
      const [memRes, pRes] = await Promise.all([swarmFetch("/memory"), swarmFetch("/proposals")]);
      const mem = (await memRes.json()) as { lessons?: unknown; memories?: unknown };
      const p = (await pRes.json()) as { proposals?: unknown };
      setLessons(asArray<Lesson>(mem.lessons));
      setMemories(asArray<MemoryItem>(mem.memories));
      setProposals(asArray<Proposal>(p.proposals));
    } catch {
      // фоновое обновление: молча — рой продолжит жить
    }
  }, []);

  const retry = useCallback(() => {
    setPhase("loading");
    void loadAll(true);
  }, [loadAll]);

  useEffect(() => {
    setMounted(true);
    void loadAll(true);
  }, [loadAll]);

  // Мягкий REST-поллинг как страховка канала (сокет остаётся основным).
  useEffect(() => {
    if (phase !== "ready") return;
    const t = setInterval(() => {
      void loadAll(false);
    }, 20000);
    return () => clearInterval(t);
  }, [phase, loadAll]);

  // Живой аптайм: тикает локально, корректируется state-событиями и поллингом.
  useEffect(() => {
    const t = setInterval(() => {
      setUptimeLive((s) => (uptimeAtRef.current ? s + 1 : s));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* — сокет — */

  const appendMessage = useCallback((m: SwarmMessage) => {
    setMessages((prev) => {
      if (m.id >= 0 && prev.some((x) => x.id === m.id)) return prev;
      const next = [...prev, m];
      return next.length > FEED_CAP ? next.slice(next.length - FEED_CAP) : next;
    });
    setSwarm((prev) => (prev ? { ...prev, messages: prev.messages + 1 } : prev));
  }, []);

  const triggerPulse = useCallback(() => {
    setPulse(true);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setPulse(false), 800);
  }, []);

  useEffect(
    () => () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    },
    []
  );

  const handleEvent = useCallback(
    (ev: SwarmEvent) => {
      switch (ev.type) {
        case "message": {
          const d = (ev.data ?? {}) as Partial<SwarmMessage>;
          appendMessage({
            id: typeof d.id === "number" ? d.id : -Date.now(),
            ts: typeof d.ts === "string" ? d.ts : new Date().toISOString(),
            from_id: d.from_id ?? null,
            from_name: d.from_name ?? "рой",
            kind: d.kind ?? "say",
            to_id: d.to_id ?? null,
            channel: d.channel ?? "#general",
            text: d.text ?? "",
            generation: typeof d.generation === "number" ? d.generation : null,
          });
          break;
        }
        case "spawn": {
          const d = (ev.data ?? {}) as SpawnEventData;
          toast.success(
            `🍼 Рождён «${d.name ?? "агент"}» [${d.role ?? "agent"}] — поколение ${d.generation ?? "?"}`
          );
          void loadAll(false);
          break;
        }
        case "retire":
          void loadAll(false);
          break;
        case "lesson": {
          const d = (ev.data ?? {}) as LessonEventData;
          toast(`💡 ${d.by ?? "рой"}: ${d.text ?? ""}`);
          void refreshMemory();
          break;
        }
        case "self_improve":
          void refreshMemory();
          break;
        case "state": {
          const d = (ev.data ?? {}) as StateEventData;
          setSwarm((prev) =>
            prev
              ? {
                  ...prev,
                  version: d.version ?? prev.version,
                  population: d.population ?? prev.population,
                  generations: d.generations ?? prev.generations,
                  messages: d.messages ?? prev.messages,
                  lessons: d.lessons ?? prev.lessons,
                  memories: d.memories ?? prev.memories,
                  cycles: d.cycles ?? prev.cycles,
                  uptimeSec: d.uptimeSec ?? prev.uptimeSec,
                }
              : prev
          );
          if (typeof d.uptimeSec === "number") {
            uptimeAtRef.current = Date.now();
            setUptimeLive(d.uptimeSec);
          }
          break;
        }
        case "browser": {
          const d = (ev.data ?? {}) as BrowserEventData;
          const by = d.by ?? "рой";
          switch (d.action) {
            case "announce":
              toast.info(`📣 ${by}: ${String(d.payload ?? "")}`);
              break;
            case "banner":
              setBanner({ by, text: String(d.payload ?? "") });
              break;
            case "theme":
              if ((ACCENT_KEYS as string[]).includes(String(d.payload))) {
                setAccent(String(d.payload) as AccentKey);
              }
              break;
            case "pulse":
              triggerPulse();
              break;
            default:
              break;
          }
          break;
        }
        default:
          break;
      }
    },
    [appendMessage, loadAll, refreshMemory, triggerPulse]
  );

  const handleEventRef = useRef(handleEvent);
  useEffect(() => {
    handleEventRef.current = handleEvent;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const socket = io("/?XTransformPort=3047", { path: "/", reconnectionDelayMax: 5000 });
    socket.on("connect", () => {
      setConnected(true);
      void loadAll(false);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("swarm_event", (ev: SwarmEvent) => handleEventRef.current(ev));
    return () => {
      socket.disconnect();
    };
  }, [loadAll]);

  /* — действия — */

  const runAction = useCallback(
    async (
      key: string,
      path: string,
      payload: Record<string, unknown>,
      okMsg: string,
      after?: () => void
    ) => {
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        const res = await swarmFetch(path, { method: "POST", body: JSON.stringify(payload) });
        const d = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!res.ok || !d?.ok) throw new Error(`swarm ${path} failed`);
        toast.success(okMsg);
        after?.();
      } catch {
        toast.error("Рой не ответил — действие не прошло");
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    []
  );

  const toggleMute = useCallback(
    async (a: SwarmAgent) => {
      setActingId(a.id);
      try {
        const res = await swarmFetch("/mute", {
          method: "POST",
          body: JSON.stringify({ agentId: a.id, muted: !a.muted }),
        });
        if (!res.ok) throw new Error("mute failed");
        toast.success(!a.muted ? `«${a.name}» заглушён` : `«${a.name}» снова слышит рой`);
        void loadAll(false);
      } catch {
        toast.error("Не удалось переключить mute");
      } finally {
        setActingId(null);
      }
    },
    [loadAll]
  );

  const killAgent = useCallback(
    async (a: SwarmAgent) => {
      if (!window.confirm(`Загасить агента «${a.name}»? Он покинет рой навсегда.`)) return;
      setActingId(a.id);
      try {
        const res = await swarmFetch("/kill", {
          method: "POST",
          body: JSON.stringify({ agentId: a.id }),
        });
        if (!res.ok) throw new Error("kill failed");
        toast.success(`«${a.name}» ушёл в тишину`);
        void loadAll(false);
      } catch {
        toast.error("Не удалось загасить агента");
      } finally {
        setActingId(null);
      }
    },
    [loadAll]
  );

  // EV-PERF: стабильные обёртки колбэков — идентичность сохраняется между рендерами,
  // поэтому memo(AgentCard) реально пропускает перерисовку при секундном тике uptime.
  const handleToggleMute = useCallback((agent: SwarmAgent) => void toggleMute(agent), [toggleMute]);
  const handleKill = useCallback((agent: SwarmAgent) => void killAgent(agent), [killAgent]);

  const submitChat = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = chat.trim();
    if (!text) return;
    void runAction("chat", "/chat", { text }, "Рой услышал вас", () => setChat(""));
  };

  const submitAnnounce = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = announce.trim();
    if (!text) return;
    void runAction("announce", "/broadcast", { text }, "Оповещение разослано всем", () =>
      setAnnounce("")
    );
  };

  const submitSpawn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = spawnName.trim();
    if (!name) return;
    void runAction(
      "spawn",
      "/spawn",
      {
        role: spawnRole.trim() || "agent",
        name,
        intent: spawnIntent.trim() || "Рождён оператором",
      },
      `Агент «${name}» поставлен на выращивание`,
      () => {
        setSpawnName("");
        setSpawnIntent("");
        void loadAll(false);
      }
    );
  };

  const submitGoal = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = goalText.trim();
    if (!text) return;
    void runAction("goal", "/goal", { text }, "Цель добавлена в рой", () => setGoalText(""));
  };

  /* — производные — */

  const agentNames = useMemo(
    () => Object.fromEntries((swarm?.agents ?? []).map((a) => [a.id, a.name])),
    [swarm]
  );

  const lineageRoots = useMemo(
    () => buildLineageTree(swarm?.lineage?.nodes ?? [], swarm?.lineage?.edges ?? []),
    [swarm]
  );

  const version = swarm?.version ?? "1.0.0";
  const pal = ACCENTS[accent];

  const emeraldBtn =
    "h-11 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 focus-visible:ring-emerald-500";
  const fieldCls =
    "border-white/10 bg-zinc-900/80 focus-visible:border-emerald-500/50 focus-visible:ring-emerald-500/50";

  /* — рендер — */

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-zinc-950 text-zinc-100 transition-all duration-700",
        pulse && "scale-[1.01]",
        pulse && pal.glow
      )}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className={cn("relative flex size-2.5 rounded-full", pal.dot)}>
              <span
                className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", pal.dot)}
              />
            </span>
            <h1 className="text-sm font-bold tracking-[0.18em] text-zinc-100">CHAT-SWARM</h1>
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-300">
              v{version}
            </Badge>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <StatChip label="Население" value={String(swarm?.population ?? "—")} />
            <StatChip label="Поколения" value={String(swarm?.generations ?? "—")} />
            <div className="hidden sm:contents">
              <StatChip label="Сообщения" value={String(swarm?.messages ?? "—")} />
              <StatChip label="Циклы" value={String(swarm?.cycles ?? "—")} />
            </div>
            <StatChip label="Uptime" value={swarm ? humanizeUptime(uptimeLive) : "—"} />
            <span
              className="flex items-center gap-1.5 text-xs font-medium"
              title={connected ? "сокет подключён" : "сокет переподключается"}
            >
              <span
                className={cn("size-2 rounded-full", connected ? "animate-pulse bg-emerald-400" : "bg-rose-500")}
              />
              <span className={connected ? "text-emerald-400" : "text-rose-400"}>
                {connected ? "LIVE" : "reconnect…"}
              </span>
            </span>
          </div>
        </div>
        <div className={cn("h-px w-full bg-gradient-to-r from-transparent to-transparent", pal.line)} />
      </header>

      {banner && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          <Megaphone className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 truncate">{banner.text}</p>
          <span className="shrink-0 text-xs text-amber-400/80">агент {banner.by}</span>
          <button
            type="button"
            aria-label="Скрыть баннер"
            onClick={() => setBanner(null)}
            className="rounded p-1 text-amber-300/80 transition-colors hover:bg-amber-500/20 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {phase === "error" ? (
        <main className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <Ghost className="size-8 text-zinc-700" aria-hidden />
            <p className="text-sm text-zinc-400">Рой не отвечает: REST-канал недоступен.</p>
            <p className="text-xs text-zinc-600">
              Проверьте, что mini-service жив на порту 3046, и повторите попытку.
            </p>
            <Button onClick={retry} className={emeraldBtn}>
              <RefreshCw aria-hidden />
              Повторить
            </Button>
          </div>
        </main>
      ) : phase === "loading" ? (
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6">
          <Skeleton className="h-10 w-72 rounded-lg bg-zinc-800" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl bg-zinc-800" />
            ))}
          </div>
          <Skeleton className="mt-4 h-40 w-full rounded-xl bg-zinc-800/70" />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6">
          <Tabs defaultValue="swarm">
            <TabsList className="grid h-11 w-full grid-cols-4 rounded-xl border border-white/10 bg-zinc-900/70 p-1 sm:inline-flex sm:w-auto">
              <TabsTrigger
                value="swarm"
                aria-label="Рой"
                className="gap-1.5 rounded-lg px-3 text-xs focus-visible:ring-emerald-500/60 sm:text-sm"
              >
                <Network aria-hidden />
                <span className="hidden lg:inline">Рой</span>
              </TabsTrigger>
              <TabsTrigger
                value="feed"
                aria-label="Поток"
                className="gap-1.5 rounded-lg px-3 text-xs focus-visible:ring-emerald-500/60 sm:text-sm"
              >
                <MessagesSquare aria-hidden />
                <span className="hidden lg:inline">Поток</span>
              </TabsTrigger>
              <TabsTrigger
                value="memory"
                aria-label="Память"
                className="gap-1.5 rounded-lg px-3 text-xs focus-visible:ring-emerald-500/60 sm:text-sm"
              >
                <Brain aria-hidden />
                <span className="hidden lg:inline">Память</span>
              </TabsTrigger>
              <TabsTrigger
                value="control"
                aria-label="Управление"
                className="gap-1.5 rounded-lg px-3 text-xs focus-visible:ring-emerald-500/60 sm:text-sm"
              >
                <SlidersHorizontal aria-hidden />
                <span className="hidden lg:inline">Управление</span>
              </TabsTrigger>
            </TabsList>

            {/* ── ТАБ «РОЙ» ── */}
            <TabsContent value="swarm" className="mt-3">
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  {(swarm?.agents ?? []).length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-600">
                      Рой пуст — вырастите нового агента во «Управлении».
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {(swarm?.agents ?? []).map((a) => (
                        <AgentCard
                          key={a.id}
                          a={a}
                          acting={actingId === a.id}
                          onToggleMute={handleToggleMute}
                          onKill={handleKill}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-4">
                  <section className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                        <TreePine className="size-4 text-emerald-400" aria-hidden />
                        Родословная
                      </h3>
                      <span className="text-xs text-zinc-500">
                        {(swarm?.lineage?.nodes ?? []).length} узлов
                      </span>
                    </div>
                    <div className={cn("mt-3 max-h-[520px] space-y-1 overflow-y-auto pr-1", SCROLLBAR)}>
                      {lineageRoots.length === 0 ? (
                        <p className="text-xs text-zinc-600">Древо пока пусто.</p>
                      ) : (
                        lineageRoots.map((t) => <LineageRow key={t.node.id} t={t} depth={0} />)
                      )}
                    </div>
                  </section>
                  <section className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                      <Target className="size-4 text-amber-400" aria-hidden />
                      Цели роя
                    </h3>
                    {(swarm?.goals ?? []).length === 0 ? (
                      <p className="mt-2 text-xs text-zinc-600">
                        Целей нет — задайте первую во «Управлении».
                      </p>
                    ) : (
                      <ul className={cn("mt-3 max-h-64 space-y-2 overflow-y-auto pr-1", SCROLLBAR)}>
                        {(swarm?.goals ?? []).map((g, i) => (
                          <li key={i} className="flex gap-2 text-xs leading-snug text-zinc-300">
                            <span className="shrink-0 font-mono text-zinc-600">#{i + 1}</span>
                            <span>{g}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            </TabsContent>

            {/* ── ТАБ «ПОТОК» ── */}
            <TabsContent value="feed" className="mt-3">
              <section className="rounded-xl border border-white/10 bg-zinc-900/60">
                <header className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <MessagesSquare className="size-4 text-emerald-400" aria-hidden />
                    Поток роя
                  </h3>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {messages.length} / {FEED_CAP}
                  </span>
                </header>
                <FeedList messages={messages} mounted={mounted} agentNames={agentNames} />
              </section>
            </TabsContent>

            {/* ── ТАБ «ПАМЯТЬ» ── */}
            <TabsContent value="memory" className="mt-3 space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <Lightbulb className="size-4 text-amber-400" aria-hidden />
                    Уроки роя
                    <span className="ml-auto text-xs font-normal text-zinc-500">{lessons.length}</span>
                  </h3>
                  {lessons.length === 0 ? (
                    <p className="mt-3 text-xs text-zinc-600">Рой ещё не сделал выводов.</p>
                  ) : (
                    <ul className={cn("mt-3 max-h-96 space-y-2 overflow-y-auto pr-1", SCROLLBAR)}>
                      {lessons.map((l) => (
                        <LessonRow key={l.id} l={l} mounted={mounted} />
                      ))}
                    </ul>
                  )}
                </section>
                <section className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <BookOpen className="size-4 text-violet-400" aria-hidden />
                    Эпизоды
                    <span className="ml-auto text-xs font-normal text-zinc-500">{memories.length}</span>
                  </h3>
                  {memories.length === 0 ? (
                    <p className="mt-3 text-xs text-zinc-600">Эпизодическая память пока чиста.</p>
                  ) : (
                    <ul className={cn("mt-3 max-h-96 space-y-2 overflow-y-auto pr-1", SCROLLBAR)}>
                      {memories.map((m) => (
                        <MemoryRow key={m.id} m={m} mounted={mounted} />
                      ))}
                    </ul>
                  )}
                </section>
              </div>
              <section className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <Wrench className="size-4 text-teal-400" aria-hidden />
                  Пул самоулучшения
                  <span className="ml-auto text-xs font-normal text-zinc-500">{proposals.length}</span>
                </h3>
                {proposals.length === 0 ? (
                  <p className="mt-3 text-xs text-zinc-600">Предложений пока не поступало.</p>
                ) : (
                  <ul className={cn("mt-3 max-h-96 space-y-2 overflow-y-auto pr-1", SCROLLBAR)}>
                    {proposals.map((p, i) => (
                      <ProposalRow key={`${p.ts}-${i}`} p={p} mounted={mounted} />
                    ))}
                  </ul>
                )}
              </section>
            </TabsContent>

            {/* ── ТАБ «УПРАВЛЕНИЕ» ── */}
            <TabsContent value="control" className="mt-3">
              <div className="grid gap-4 lg:grid-cols-2">
                <ControlCard
                  title="Говорить рою"
                  hint="Сообщение попадает в общий поток — рой услышит и ответит в ленте"
                  icon={<MessagesSquare className="size-4 text-emerald-400" aria-hidden />}
                >
                  <form onSubmit={submitChat} className="space-y-2.5">
                    <Textarea
                      value={chat}
                      onChange={(e) => setChat(e.target.value)}
                      rows={3}
                      aria-label="Сообщение рою"
                      placeholder="Например: доложите о текущем состоянии дел"
                      className={cn("min-h-24 resize-none", fieldCls)}
                    />
                    <Button
                      type="submit"
                      disabled={busy.chat === true || !chat.trim()}
                      className={cn(emeraldBtn, "w-full sm:w-auto")}
                    >
                      {busy.chat ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <MessagesSquare aria-hidden />
                      )}
                      Послать
                    </Button>
                  </form>
                </ControlCard>

                <ControlCard
                  title="Объявление"
                  hint="Разослать всем агентам от имени ОПЕРАТОРА"
                  icon={<Megaphone className="size-4 text-amber-400" aria-hidden />}
                >
                  <form onSubmit={submitAnnounce} className="space-y-2.5">
                    <Input
                      value={announce}
                      onChange={(e) => setAnnounce(e.target.value)}
                      aria-label="Текст объявления"
                      placeholder="Внимание рою: смена приоритета…"
                      className={fieldCls}
                    />
                    <Button
                      type="submit"
                      disabled={busy.announce === true || !announce.trim()}
                      className={cn(emeraldBtn, "w-full sm:w-auto")}
                    >
                      {busy.announce ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Megaphone aria-hidden />
                      )}
                      Оповестить всех
                    </Button>
                  </form>
                </ControlCard>

                <ControlCard
                  title="Вырастить агента"
                  hint="Новый агент родится от матки, получит имя и начнёт жить своей жизнью"
                  icon={<Baby className="size-4 text-emerald-400" aria-hidden />}
                >
                  <form onSubmit={submitSpawn} className="space-y-2.5">
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Input
                        value={spawnRole}
                        onChange={(e) => setSpawnRole(e.target.value)}
                        aria-label="Роль нового агента"
                        placeholder="роль: architect | researcher…"
                        className={fieldCls}
                      />
                      <Input
                        value={spawnName}
                        onChange={(e) => setSpawnName(e.target.value)}
                        aria-label="Имя нового агента"
                        placeholder="имя, напр. Стратег"
                        className={fieldCls}
                      />
                    </div>
                    <Input
                      value={spawnIntent}
                      onChange={(e) => setSpawnIntent(e.target.value)}
                      aria-label="Намерение нового агента"
                      placeholder="чем займётся агент"
                      className={fieldCls}
                    />
                    <Button
                      type="submit"
                      disabled={busy.spawn === true || !spawnName.trim()}
                      className={cn(emeraldBtn, "w-full sm:w-auto")}
                    >
                      {busy.spawn ? <Loader2 className="animate-spin" aria-hidden /> : <Baby aria-hidden />}
                      Родить
                    </Button>
                  </form>
                </ControlCard>

                <ControlCard
                  title="Цель роя"
                  hint="Цели видны всему рою в панели «Родословная»"
                  icon={<Target className="size-4 text-rose-400" aria-hidden />}
                >
                  <form onSubmit={submitGoal} className="space-y-2.5">
                    <Input
                      value={goalText}
                      onChange={(e) => setGoalText(e.target.value)}
                      aria-label="Новая цель роя"
                      placeholder="например: придумать себе работу получше"
                      className={fieldCls}
                    />
                    <Button
                      type="submit"
                      disabled={busy.goal === true || !goalText.trim()}
                      className={cn(emeraldBtn, "w-full sm:w-auto")}
                    >
                      {busy.goal ? <Loader2 className="animate-spin" aria-hidden /> : <Target aria-hidden />}
                      Задать
                    </Button>
                  </form>
                </ControlCard>

                <ControlCard
                  title="Ноутбуки Colab — 5 GPU-узлов"
                  hint="Скачайте, откройте в Google Colab (Run all), вставьте публичный адрес песочницы в последнюю ячейку — узел сам зарегистрируется в рое"
                  icon={<Download className="size-4 text-emerald-400" aria-hidden />}
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[
                      ["colab-node-1-llama31-8b.ipynb", "1 · llama3.1:8b"],
                      ["colab-node-2-qwen3-8b.ipynb", "2 · qwen3:8b"],
                      ["colab-node-3-gemma3-12b.ipynb", "3 · gemma3:12b"],
                      ["colab-node-4-phi4-14b.ipynb", "4 · phi4:14b"],
                      ["colab-node-5-mistral-nemo-12b.ipynb", "5 · mistral-nemo:12b"],
                    ].map(([file, label]) => (
                      <a
                        key={file}
                        href={`/api/download/${file}`}
                        download
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      >
                        <Download className="size-4" aria-hidden />
                        {label}
                      </a>
                    ))}
                    <a
                      href="/api/download/me2-colab-nodes-5pack.zip"
                      download
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      <Download className="size-4" aria-hidden />
                      Все 5 · ZIP
                    </a>
                  </div>
                </ControlCard>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      )}

      <footer className="mt-auto border-t border-white/5 p-3 text-center text-xs text-zinc-500">
        ME2 CHAT-SWARM v{version} · Рой живёт непрерывно: без бюджетов, лимитов и cron · население{" "}
        {swarm?.population ?? 0} · поколений {swarm?.generations ?? 0} · циклов {swarm?.cycles ?? 0}
      </footer>
    </div>
  );
}

/* EV-PWA: offline-fallback статуса демона — любой непойманный сбой рендера
 * консоли больше не убивает страницу (мёртвый "Application error"), а
 * показывает восстановимый fallback с diagnostics и перезагрузкой. */
class ConsoleErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("console-boundary:", error.message, info.componentStack ?? "");
  }

  render() {
    const err = this.state.error;
    if (err) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-950 px-4 py-16 text-center">
          <Ghost className="size-8 text-zinc-700" aria-hidden />
          <p className="text-sm text-zinc-400">
            Консоль восстановилась после сбоя — рой продолжает жить без UI.
          </p>
          <p className="max-w-md break-all font-mono text-xs text-zinc-600">{err.message}</p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Перезагрузить
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function SwarmConsole() {
  return (
    <ConsoleErrorBoundary>
      <SwarmConsoleInner />
    </ConsoleErrorBoundary>
  );
}

export default SwarmConsole;
