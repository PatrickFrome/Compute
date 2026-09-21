"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatMs } from "@/components/mc/use-poll";
import {
  FlaskConical, Play, TerminalSquare, Zap, Loader2, History, Gauge,
} from "lucide-react";

interface E2eResult {
  ok: boolean; output: string; summary: string | null;
  passed: number; total: number; durationMs: number;
}

interface WakeResult {
  ok: boolean; channel: string; commandId: string; latencyMs: number; insertMs: number; error?: string;
}

export function E2ePanel() {
  const [running, setRunning] = useState(false);
  const [e2e, setE2e] = useState<E2eResult | null>(null);
  const [wake, setWake] = useState<WakeResult | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [wakeHistory, setWakeHistory] = useState<number[]>([]);
  const termRef = useRef<HTMLPreElement>(null);

  async function runE2e() {
    setRunning(true);
    setE2e(null);
    try {
      const res = await fetch("/api/e2e", { method: "POST" });
      const json = (await res.json()) as E2eResult & { error?: string };
      setE2e(json);
      if (json.ok) {
        toast.success(`E2E ${json.summary ?? "all PASS"}`, { description: `${formatMs(json.durationMs)} full contour` });
      } else {
        toast.error("E2E failures detected", { description: json.summary ?? json.error ?? "see terminal output" });
      }
      requestAnimationFrame(() => termRef.current?.scrollTo({ top: termRef.current.scrollHeight }));
    } catch (e) {
      toast.error("E2E run failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }

  async function runWake() {
    setWakeBusy(true);
    try {
      const res = await fetch("/api/wake-test", { method: "POST" });
      const json = (await res.json()) as WakeResult;
      setWake(json);
      if (json.ok) {
        setWakeHistory((h) => [...h.slice(-11), json.latencyMs]);
        toast.success(`Wake ${json.latencyMs}ms`, { description: `POSTGRES_NOTIFY via ${json.channel}` });
      } else {
        toast.error("Wake probe failed", { description: json.error ?? "unknown" });
      }
    } catch (e) {
      toast.error("Wake probe failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setWakeBusy(false);
    }
  }

  const passPct = e2e && e2e.total > 0 ? Math.round((e2e.passed / e2e.total) * 100) : 0;
  const best = wakeHistory.length ? Math.min(...wakeHistory) : null;

  return (
    <div className="space-y-4" data-testid="e2e-panel">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* E2E runner */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <FlaskConical className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> E2E Contour Lab
              {e2e?.summary && (
                <Badge
                  variant="outline"
                  className={`font-mono ${e2e.ok ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}`}
                >
                  {e2e.summary}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">
              canonical test-e2e.ts: T2 enrollment → T5 lease/readback → T11 wake (10 checks)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Button
                onClick={runE2e} disabled={running} data-testid="run-e2e"
                className="bg-emerald-600 font-mono text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {running ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
                {running ? "Running…" : "Run E2E Suite"}
              </Button>
              {e2e && (
                <span className="font-mono text-[10px] text-zinc-500">
                  {formatMs(e2e.durationMs)} · exit {e2e.ok ? "0" : "1"}
                </span>
              )}
            </div>
            {e2e && (
              <Progress
                value={passPct}
                className="h-1.5 bg-zinc-800 [&>div]:bg-emerald-500"
                aria-label={`E2E pass rate ${passPct}%`}
              />
            )}
            <pre
              ref={termRef}
              data-testid="e2e-terminal"
              className="mc-terminal max-h-80 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px] leading-4 text-emerald-300/90"
            >
              {running
                ? "▊ running canonical contour… enrollment → heartbeat → issue → lease → receipt → readback → wake"
                : e2e
                  ? e2e.output
                  : "▊ terminal idle — press Run to exercise the full command plane\n  (edge :3031 → DIRECT_POSTGRES → pigsty :55432)"}
            </pre>
          </CardContent>
        </Card>

        {/* Wake latency */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Wake Latency Probe
              {wake?.ok && (
                <Badge variant="outline" className="font-mono border-amber-500/40 text-amber-300">{wake.latencyMs}ms</Badge>
              )}
            </CardTitle>
            <CardDescription className="font-mono text-[10px] text-zinc-600">
              LISTEN glm_browser_pulse → INSERT probe → measure trigger→notify
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={runWake} disabled={wakeBusy} data-testid="run-wake"
                className="bg-amber-600 font-mono text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {wakeBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-2 h-3.5 w-3.5" />}
                {wakeBusy ? "Probing…" : "Fire Probe"}
              </Button>
              {best !== null && (
                <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                  <Gauge className="h-3 w-3" /> best {best}ms / n={wakeHistory.length}
                </span>
              )}
            </div>

            {wake && (
              <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px]" data-testid="wake-result">
                {wake.ok ? (
                  <>
                    <p className="text-zinc-500">channel <span className="text-amber-300">{wake.channel}</span> · insert {wake.insertMs}ms</p>
                    <p className="mt-1 text-zinc-300">
                      notify <span className={wake.latencyMs < 50 ? "text-emerald-400" : wake.latencyMs < 300 ? "text-amber-400" : "text-rose-400"}>{wake.latencyMs}ms</span>
                      {" "}→ probe {wake.commandId.slice(0, 8)}… consumed
                    </p>
                  </>
                ) : (
                  <p className="text-rose-400">probe failed: {wake.error}</p>
                )}
              </div>
            )}

            {wakeHistory.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  <History className="h-3 w-3" /> latency sparkline
                </p>
                <div className="flex h-14 items-end gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-2" data-testid="wake-sparkline">
                  {wakeHistory.map((ms, i) => {
                    const max = Math.max(...wakeHistory, 100);
                    return (
                      <div
                        key={i}
                        title={`${ms}ms`}
                        className={`w-3 rounded-sm transition-all ${ms < 50 ? "bg-emerald-500" : ms < 300 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ height: `${Math.max((ms / max) * 100, 6)}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
