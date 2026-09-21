"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard, MiniBars } from "@/components/mc/stat-card";
import { LiveDot } from "@/components/mc/badges";
import { formatMs, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import {
  Activity, Database, Cpu, ShieldCheck, Route, Boxes, KeyRound, Timer,
} from "lucide-react";

interface OverviewData {
  ok: boolean;
  db: {
    version: string; connections: number; port: number; uptimeMs: number;
    tables: number; functions: number;
    extensions: { extname: string; extversion: string }[];
  };
  counts: {
    commands: number; enrollments: number; devices: number;
    fleetTasks: number; fleetEvents: number; actuationLeases: number;
  };
  lanes: { lane: string; n: number }[];
  statuses: { status: string; n: number }[];
  edge: { ok: boolean; ms: number; error?: string; health?: Record<string, unknown> };
  serverTime: string;
}

export function OverviewPanel({ poll }: { poll: PollState<OverviewData> }) {
  const d = poll.data;
  const total = d?.statuses.reduce((a, s) => a + s.n, 0) ?? 0;

  const LANE_COLORS: Record<string, string> = {
    EMERGENCY: "bg-rose-500",
    DEVELOPER_EMERGENCY_UPDATE: "bg-amber-500",
    READ_ONLY: "bg-zinc-500",
  };
  const STATUS_COLORS: Record<string, string> = {
    COMPLETED: "bg-emerald-500",
    FAILED: "bg-rose-500",
    PENDING: "bg-amber-500",
    LEASED: "bg-violet-500",
    EXPIRED: "bg-zinc-600",
    CANCELLED: "bg-zinc-600",
  };

  return (
    <div className="space-y-4" data-testid="overview-panel">
      {/* top stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Database} label="PostgreSQL" tone="emerald" loading={poll.loading}
          value={d ? <span className="text-lg">{d.db.version}</span> : "—"}
          sub={d ? <span>:{d.db.port} · {d.db.connections} conns · up {formatMs(d.db.uptimeMs)}</span> : null}
        />
        <StatCard
          icon={Route} label="Edge Supervisor" tone={d?.edge.ok ? "teal" : "rose"} loading={poll.loading}
          value={d ? (d.edge.ok ? <span className="text-lg">ONLINE</span> : <span className="text-lg">OFFLINE</span>) : "—"}
          sub={d?.edge.ok
            ? <span>health {d.edge.ms}ms · {d.edge.health?.backend_transport as string}</span>
            : <span className="text-rose-400">{d?.edge.error ?? "unreachable"}</span>}
        />
        <StatCard
          icon={Activity} label="Commands" tone="violet" loading={poll.loading}
          value={d?.counts.commands ?? "—"}
          sub={d ? <span>{d.counts.actuationLeases} leases · {d.counts.fleetEvents} fleet events</span> : null}
        />
        <StatCard
          icon={KeyRound} label="Devices" tone="amber" loading={poll.loading}
          value={d?.counts.devices ?? "—"}
          sub={d ? <span>{d.counts.enrollments} enrollment requests</span> : null}
        />
      </div>

      {/* second row: schema + lanes */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Boxes className="h-3.5 w-3.5 text-teal-400" aria-hidden /> Schema Parity
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">local pigsty vs cloud era</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
                <p className="font-mono text-lg font-semibold text-emerald-300">{d?.db.tables ?? "—"}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">tables</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
                <p className="font-mono text-lg font-semibold text-teal-300">{d?.db.functions ?? "—"}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">functions</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
                <p className="font-mono text-lg font-semibold text-amber-300">{d?.db.extensions.length ?? "—"}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">extensions</p>
              </div>
            </div>
            <div className="max-h-28 space-y-1 overflow-y-auto pr-1 mc-scroll" data-testid="extensions-list">
              {d?.db.extensions.map((e) => (
                <div key={e.extname} className="flex items-center justify-between rounded border border-zinc-800/80 bg-zinc-900/80 px-2 py-1">
                  <span className="font-mono text-[11px] text-zinc-300">{e.extname}</span>
                  <span className="font-mono text-[10px] text-zinc-500">v{e.extversion}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <ShieldCheck className="h-3.5 w-3.5 text-rose-400" aria-hidden /> Lane Distribution
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">command_plane.classify_v1</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniBars
              total={total}
              items={(d?.lanes ?? []).map((l) => ({
                label: l.lane,
                n: l.n,
                className: LANE_COLORS[l.lane] ?? "bg-teal-500",
              }))}
            />
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Timer className="h-3.5 w-3.5 text-violet-400" aria-hidden /> Status Mix
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">terminal vs in-flight</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniBars
              total={total}
              items={(d?.statuses ?? []).map((s) => ({
                label: s.status,
                n: s.n,
                className: STATUS_COLORS[s.status] ?? "bg-teal-500",
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* edge capability strip */}
      {d?.edge.ok && d.edge.health && (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Cpu className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Edge Capability Flags
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">
              canonical a2-browser-native-supervisor-v1 · updated {timeAgo(d.serverTime)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5" data-testid="edge-capabilities">
              {Object.entries(d.edge.health)
                .filter(([, v]) => typeof v === "boolean")
                .map(([k, v]) => (
                  <span
                    key={k}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      v
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-500"
                    }`}
                  >
                    <LiveDot ok={v as boolean} pulse={false} className="h-1.5 w-1.5" />
                    {k}
                  </span>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
