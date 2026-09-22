"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shortId, timeAgo } from "@/components/mc/use-poll";
import type { PollState } from "@/components/mc/use-poll";
import { Gauge, ShieldCheck, ShieldAlert, CircleDashed, RefreshCw } from "lucide-react";

interface MechanicsData {
  ok: boolean;
  contour: {
    db_h205f22_objects: number;
    rpc: { core_rpcs?: number; h205f22_rpcs?: number; devos_rpcs?: number };
    wake_triggers: string[];
    runtime_control: Record<string, unknown>;
    probe_device: Record<string, unknown>;
    edge: Record<string, unknown>;
  };
  mechanics: { id: string; name: string; verdict: string; probe: string; source: string }[];
  gaps: { id: string; title: string; severity: string; status: string; closure: string }[];
  generatedAt: string;
}

const VERDICT_TONE: Record<string, string> = {
  WORKS: "text-emerald-300 border-emerald-800/60",
  CAVEAT: "text-amber-300 border-amber-800/60",
  DECOR: "text-zinc-400 border-zinc-700",
  BROKEN: "text-rose-300 border-rose-800/60",
};

const GAP_TONE: Record<string, string> = {
  CLOSED: "bg-emerald-500/15 text-emerald-300 border-emerald-800/60",
  "CLOSED (local)": "bg-emerald-500/15 text-emerald-300 border-emerald-800/60",
  COMPENSATED: "bg-teal-500/10 text-teal-300 border-teal-800/60",
  MITIGATED: "bg-teal-500/10 text-teal-300 border-teal-800/60",
  "BY-DESIGN": "bg-zinc-800/60 text-zinc-400 border-zinc-700",
  OPEN: "bg-amber-500/10 text-amber-300 border-amber-800/60",
  "OPEN (operator)": "bg-amber-500/10 text-amber-300 border-amber-800/60",
};

function verdictTone(v: string): string {
  return VERDICT_TONE[v] ?? "text-zinc-400 border-zinc-700";
}

export function MechanicsPanel({ poll }: { poll: PollState<MechanicsData> }) {
  const d = poll.data;
  const [detail, setDetail] = useState<string | null>(null);

  const works = d?.mechanics.filter((m) => m.verdict === "WORKS").length ?? 0;
  const total = d?.mechanics.length ?? 0;
  const closed = d?.gaps.filter((g) => g.status.startsWith("CLOSED")).length ?? 0;
  const gapTotal = d?.gaps.length ?? 0;

  return (
    <div className="space-y-4" data-testid="mechanics-panel">
      {/* summary strip */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex items-center gap-3 p-4">
            <Gauge className="h-8 w-8 text-emerald-400/80" aria-hidden />
            <div>
              <p className="font-mono text-2xl font-bold tabular-nums text-zinc-100">{works}/{total}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">механик живые</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldCheck className="h-8 w-8 text-teal-400/80" aria-hidden />
            <div>
              <p className="font-mono text-2xl font-bold tabular-nums text-zinc-100">{closed}/{gapTotal}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">разрывов закрыто (R-реестр)</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Контур</p>
            <div className="mt-1.5 space-y-1 font-mono text-[10px] text-zinc-400">
              <p>h205f22-объектов: <span className="text-emerald-300">{d?.contour.db_h205f22_objects ?? "—"}</span></p>
              <p>RPC: <span className="text-emerald-300">{d?.contour.rpc?.h205f22_rpcs ?? "—"}</span> h205f22 / <span className="text-emerald-300">{d?.contour.rpc?.devos_rpcs ?? "—"}</span> devos / <span className="text-emerald-300">{d?.contour.rpc?.core_rpcs ?? "—"}</span> core</p>
              <p>wake-триггеры: <span className={d?.contour.wake_triggers?.length === 3 ? "text-emerald-300" : "text-amber-300"}>{d?.contour.wake_triggers?.join(", ") ?? "—"}</span></p>
              <p>probe: <span className="text-violet-300">{d?.contour.probe_device?.clientId ? String(d.contour.probe_device.clientId) : "n/a"}</span></p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* mechanics matrix */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Mechanics Matrix — live вердикты</CardTitle>
            <CardDescription className="mt-1 font-mono text-[10px] text-zinc-600">
              18 механик M1..M18 (реестр 2026-09-21); LIVE = проверено через консоль в этом контуре
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => poll.refresh()} className="h-7 w-7 shrink-0 self-start p-0 text-zinc-400 hover:bg-zinc-800" aria-label="refresh mechanics">
            <RefreshCw className={`h-3 w-3 ${poll.loading ? "animate-spin" : ""}`} aria-hidden />
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96 pr-2 mc-scroll">
            <div className="grid gap-1.5 md:grid-cols-2">
              {d?.mechanics.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setDetail(detail === m.id ? null : m.id)}
                  className="rounded border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-2 text-left transition-colors hover:border-zinc-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-zinc-300">
                      <span className="text-zinc-600">{m.id}</span> {m.name}
                    </span>
                    <Badge variant="outline" className={`shrink-0 font-mono text-[9px] ${verdictTone(m.verdict)}`}>{m.verdict}</Badge>
                  </div>
                  {detail === m.id && (
                    <div className="mt-1.5 space-y-0.5 border-t border-zinc-800/70 pt-1.5">
                      <p className="font-mono text-[9px] text-emerald-500/90">{m.probe}</p>
                      <p className="font-mono text-[9px] text-zinc-600">источник: {m.source}</p>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* gap registry */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">R-реестр разрывов — статус закрытия</CardTitle>
          <CardDescription className="font-mono text-[10px] text-zinc-600">
            R2/R5/B-3 закрыты PR #939 · R3 закрыт enqueue+Drive Cycle консоли · B-1/B-2 требуют оператора
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {d?.gaps.map((g) => (
              <div key={g.id} className="rounded border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-zinc-200">{g.id}</span>
                  <span className="font-mono text-[11px] text-zinc-300">{g.title}</span>
                  <Badge variant="outline" className={`ml-auto font-mono text-[9px] ${GAP_TONE[g.status] ?? "border-zinc-700 text-zinc-400"}`}>
                    {g.status === "OPEN" || g.status === "OPEN (operator)" ? (
                      <span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" aria-hidden />{g.status}</span>
                    ) : (
                      <span className="flex items-center gap-1"><CircleDashed className="h-3 w-3" aria-hidden />{g.status}</span>
                    )}
                  </Badge>
                  <span className="font-mono text-[9px] text-zinc-600">{g.severity}</span>
                </div>
                <p className="mt-1 font-mono text-[9px] text-zinc-500">{g.closure}</p>
              </div>
            ))}
          </div>
          {d?.generatedAt && (
            <p className="mt-2 text-right font-mono text-[9px] text-zinc-700">
              проба от {timeAgo(d.generatedAt)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
