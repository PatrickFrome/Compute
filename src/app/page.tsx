"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/mc/badges";
import { OverviewPanel } from "@/components/mc/overview-panel";
import { EnrollmentPanel } from "@/components/mc/enrollment-panel";
import { CommandsPanel } from "@/components/mc/commands-panel";
import { EmergencyLanePanel } from "@/components/mc/emergency-panel";
import { CognitiveBusPanel } from "@/components/mc/cognitive-panel";
import { FleetPanel } from "@/components/mc/fleet-panel";
import { RoadmapPanel } from "@/components/mc/roadmap-panel";
import { E2ePanel } from "@/components/mc/e2e-panel";
import { usePoll, timeAgo, formatMs } from "@/components/mc/use-poll";
import { RefreshCw, RadioTower, Database, Hexagon, ChevronLast } from "lucide-react";

const REFRESH_OPTIONS = [
  { label: "2s", ms: 2000 },
  { label: "5s", ms: 5000 },
  { label: "15s", ms: 15000 },
  { label: "off", ms: null },
];

const TAB_ORDER = [
  "overview", "gate", "commands", "emergency", "cognitive", "fleet", "roadmap", "lab",
] as const;

interface OverviewData {
  ok: boolean;
  db: { version: string; port: number; connections: number };
  edge: { ok: boolean; ms: number };
  serverTime: string;
}
interface EnrollmentData {
  requests: { requestId: string; status: string }[];
}

export default function Home() {
  const [refreshIdx, setRefreshIdx] = useState(1); // 5s default
  const [tab, setTab] = useState<string>("overview");
  const interval = REFRESH_OPTIONS[refreshIdx].ms;

  const overview = usePoll<OverviewData>("/api/overview", interval);
  const enrollment = usePoll<EnrollmentData>("/api/enrollment", interval);
  const commands = usePoll("/api/commands?limit=60", interval);
  const emergency = usePoll("/api/emergency", interval ?? 15000);
  const cognitive = usePoll("/api/cognitive", interval ?? 15000);
  const fleet = usePoll("/api/fleet", interval ?? 15000);
  const roadmap = usePoll("/api/roadmap", null);

  // Alt+1..8 — quick tab navigation (hint in footer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TAB_ORDER.length) {
        e.preventDefault();
        setTab(TAB_ORDER[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pendingCount = enrollment.data?.requests.filter((r) => r.status === "PENDING").length ?? 0;
  const dbOk = !!overview.data?.db?.version;
  const edgeOk = overview.data?.edge.ok === true;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="mc-header-grid sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/75">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_18px_-4px_rgba(16,185,129,0.5)]">
              <Hexagon className="h-5 w-5 text-emerald-400" aria-hidden />
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="h-2.5 w-2.5 rounded-full border-2 border-zinc-950 bg-emerald-400" />
              </span>
            </div>
            <div>
              <h1 className="font-mono text-sm font-bold tracking-[0.22em] text-zinc-100">
                METAENGINE <span className="font-normal text-emerald-400">MISSION CONTROL</span>
              </h1>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">
                local contour console · pigsty + edge supervisor
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1" data-testid="db-indicator">
              <Database className="h-3 w-3 text-zinc-500" aria-hidden />
              <LiveDot ok={dbOk} />
              <span className="font-mono text-[10px] text-zinc-400">Pigsty :55432</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1" data-testid="edge-indicator">
              <RadioTower className="h-3 w-3 text-zinc-500" aria-hidden />
              <LiveDot ok={edgeOk} />
              <span className="font-mono text-[10px] text-zinc-400">Edge :3031</span>
              {edgeOk && overview.data && <span className="font-mono text-[9px] text-zinc-600">{overview.data.edge.ms}ms</span>}
            </div>
            {pendingCount > 0 && (
              <span
                data-testid="pending-gate-alert"
                className="flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/15 px-2 py-1 font-mono text-[10px] text-amber-300"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                </span>
                {pendingCount} pending gate
              </span>
            )}
            <div className="flex items-center overflow-hidden rounded-md border border-zinc-800">
              {REFRESH_OPTIONS.map((o, i) => (
                <button
                  key={o.label}
                  onClick={() => setRefreshIdx(i)}
                  data-testid={`refresh-${o.label}`}
                  className={`px-2 py-1 font-mono text-[10px] transition-colors ${
                    refreshIdx === i ? "bg-emerald-500/20 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Button
              size="sm" variant="outline"
              onClick={() => { void overview.refresh(); void enrollment.refresh(); void (commands.refresh as () => Promise<void>)(); }}
              disabled={overview.loading}
              className="h-7 border-zinc-700 px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Refresh all panels now"
            >
              <RefreshCw className={`h-3 w-3 ${overview.loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">
        {overview.error && (
          <div className="mb-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
            overview feed error: {overview.error} — check that PG (55432) is reachable
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1">
            <TabsTrigger value="overview" className="font-mono text-[11px] data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">Overview</TabsTrigger>
            <TabsTrigger value="gate" data-testid="tab-gate" className="font-mono text-[11px] data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300">
              Enrollment Gate{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="commands" className="font-mono text-[11px] data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-300">Command Plane</TabsTrigger>
            <TabsTrigger value="emergency" data-testid="tab-emergency" className="font-mono text-[11px] data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-300">
              Emergency Lane
            </TabsTrigger>
            <TabsTrigger value="cognitive" data-testid="tab-cognitive" className="font-mono text-[11px] data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-300">
              Cognitive Bus
            </TabsTrigger>
            <TabsTrigger value="fleet" className="font-mono text-[11px] data-[state=active]:bg-teal-500/15 data-[state=active]:text-teal-300">DevOS Fleet</TabsTrigger>
            <TabsTrigger value="roadmap" className="font-mono text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-200">Roadmap</TabsTrigger>
            <TabsTrigger value="lab" data-testid="tab-lab" className="font-mono text-[11px] data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">E2E Lab</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 outline-none">
            <OverviewPanel poll={overview} />
          </TabsContent>
          <TabsContent value="gate" className="mt-0 outline-none">
            <EnrollmentPanel poll={enrollment} refresh={enrollment.refresh} />
          </TabsContent>
          <TabsContent value="commands" className="mt-0 outline-none">
            <CommandsPanel poll={commands as unknown as Parameters<typeof CommandsPanel>[0]["poll"]} />
          </TabsContent>
          <TabsContent value="emergency" className="mt-0 outline-none">
            <EmergencyLanePanel poll={emergency as unknown as Parameters<typeof EmergencyLanePanel>[0]["poll"]} />
          </TabsContent>
          <TabsContent value="cognitive" className="mt-0 outline-none">
            <CognitiveBusPanel poll={cognitive as unknown as Parameters<typeof CognitiveBusPanel>[0]["poll"]} />
          </TabsContent>
          <TabsContent value="fleet" className="mt-0 outline-none">
            <FleetPanel poll={fleet as unknown as Parameters<typeof FleetPanel>[0]["poll"]} />
          </TabsContent>
          <TabsContent value="roadmap" className="mt-0 outline-none">
            <RoadmapPanel poll={roadmap as unknown as Parameters<typeof RoadmapPanel>[0]["poll"]} />
          </TabsContent>
          <TabsContent value="lab" className="mt-0 outline-none">
            <E2ePanel />
          </TabsContent>
        </Tabs>
      </main>

      {/* ── Footer (sticky bottom via mt-auto) ─────────────────── */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <p className="font-mono text-[10px] text-zinc-600">
            <span className="text-zinc-500">Compute rsi-contour</span> · rail release/self-update-ambiguity-live-v2 @ 6bf173c7 · release v0.7.0-dev.35532004761.1
          </p>
          <p className="flex items-center gap-3 font-mono text-[10px] text-zinc-600" data-testid="footer-status">
            <span className="hidden sm:inline text-zinc-700">Alt+1..8 tabs</span>
            <span className="hidden sm:inline text-zinc-800">│</span>
            <span>schema 103/103 + cursor</span>
            <span className="text-zinc-800">│</span>
            <span>E2E 10/10 (last audit)</span>
            <span className="text-zinc-800">│</span>
            <span className="flex items-center gap-1">
              <ChevronLast className="h-3 w-3" />
              updated {overview.lastUpdated ? timeAgo(overview.lastUpdated.toISOString()) : "—"}
              {overview.lastUpdated && <span className="text-zinc-800">· {formatMs(Date.now() - overview.lastUpdated.getTime()) === "0.0s" ? "just now" : ""}</span>}
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}
