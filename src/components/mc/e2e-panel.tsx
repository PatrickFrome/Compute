"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatMs, timeAgo } from "@/components/mc/use-poll";
import {
  FlaskConical, Play, Zap, Loader2, History, Gauge, RadioTower,
} from "lucide-react";

interface E2eResult {
  ok: boolean; summary: string | null;
  passed: number; total: number; durationMs: number;
}

type SseEvent =
  | { type: "meta"; script: string; startedAt: string }
  | { type: "line"; text: string }
  | { type: "done"; exitCode: number; summary: string | null; durationMs: number };

interface WakeResult {
  ok: boolean; channel: string; commandId: string; latencyMs: number; insertMs: number; error?: string;
}

interface RunHistoryEntry {
  at: string; ok: boolean; summary: string | null; durationMs: number;
}

const TOTAL_CHECKS = 10;

export function E2ePanel() {
  const [running, setRunning] = useState(false);
  const [e2e, setE2e] = useState<E2eResult | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [livePassed, setLivePassed] = useState(0);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [wake, setWake] = useState<WakeResult | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [wakeHistory, setWakeHistory] = useState<number[]>([]);
  const termRef = useRef<HTMLPreElement>(null);

  const runE2e = useCallback(() => {
    if (running) return;
    setRunning(true);
    setE2e(null);
    setLines(["▊ spawning bun test-e2e.ts via SSE …"]);
    setLivePassed(0);
    let passed = 0;
    let failed = 0;
    const es = new EventSource("/api/e2e/stream");
    const finish = () => es.close();
    es.onmessage = (ev: MessageEvent<string>) => {
      let evt: SseEvent;
      try {
        evt = JSON.parse(ev.data) as SseEvent;
      } catch {
        return;
      }
      if (evt.type === "line") {
        if (evt.text.includes("✅")) passed += 1;
        if (evt.text.includes("❌")) failed += 1;
        setLivePassed(passed);
        setLines((prev) => {
          const next = [...prev, evt.text];
          return next.length > 400 ? next.slice(-400) : next;
        });
        requestAnimationFrame(() => termRef.current?.scrollTo({ top: termRef.current.scrollHeight }));
      } else if (evt.type === "done") {
        const ok = evt.exitCode === 0;
        const result: E2eResult = {
          ok,
          summary: evt.summary ?? `${passed} passed / ${failed} failed`,
          passed,
          total: passed + failed || TOTAL_CHECKS,
          durationMs: evt.durationMs,
        };
        setE2e(result);
        setHistory((h) => [{ at: new Date().toISOString(), ok, summary: evt.summary, durationMs: evt.durationMs }, ...h].slice(0, 6));
        if (ok) {
          toast.success(`E2E ${evt.summary ?? "all PASS"}`, { description: `${formatMs(evt.durationMs)} full contour · streamed live` });
        } else {
          toast.error("E2E failures detected", { description: evt.summary ?? `exit ${evt.exitCode}` });
        }
        finish();
        setRunning(false);
      }
    };
    es.onerror = () => {
      finish();
      setRunning(false);
      toast.error("SSE stream error", { description: "connection to /api/e2e/stream dropped" });
    };
  }, [running]);

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

  const passPct = e2e && e2e.total > 0 ? Math.round((e2e.passed / e2e.total) * 100) : running ? Math.round((livePassed / TOTAL_CHECKS) * 100) : 0;
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
              <Badge variant="outline" className="font-mono text-[9px] border-teal-500/40 text-teal-300" data-testid="e2e-sse-badge">
                <RadioTower className="mr-1 h-3 w-3" /> SSE live stream
              </Badge>
              {e2e && (
                <span className="font-mono text-[10px] text-zinc-500">
                  {formatMs(e2e.durationMs)} · exit {e2e.ok ? "0" : "1"}
                </span>
              )}
            </div>
            <Progress
              value={passPct}
              className="h-1.5 bg-zinc-800 [&>div]:bg-emerald-500"
              aria-label={`E2E pass rate ${passPct}%`}
            />
            <pre
              ref={termRef}
              data-testid="e2e-terminal"
              className="mc-terminal max-h-80 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px] leading-4 text-emerald-300/90"
            >
              {lines.length > 0
                ? lines.join("\n")
                : "▊ terminal idle — press Run to exercise the full command plane\n  (edge :3031 → DIRECT_POSTGRES → pigsty :55432)"}
            </pre>
            {history.length > 0 && (
              <div className="space-y-1" data-testid="e2e-history">
                <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                  <History className="h-3 w-3" /> session runs
                </p>
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between rounded border border-zinc-800/60 bg-zinc-900/60 px-2 py-1 font-mono text-[9px]">
                    <span className={h.ok ? "text-emerald-400" : "text-rose-400"}>{h.summary ?? (h.ok ? "PASS" : "FAIL")}</span>
                    <span className="text-zinc-600">{formatMs(h.durationMs)} · {timeAgo(h.at)}</span>
                  </div>
                ))}
              </div>
            )}
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
