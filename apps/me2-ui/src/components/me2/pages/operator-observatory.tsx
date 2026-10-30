"use client";

// W6/P4: seven read-only perspectives over ONE canonical operator context.
// This view deliberately does not use the ME2 daemon snapshot, agent roster,
// local HTTP /health, legacy task bus, arbitrary fetch URLs or client readiness.
// Only a trusted, authenticated native Operator bridge may supply context.
// Without that bridge, every facet and the event cursor remain UNKNOWN.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPhysicalReadGate } from "@/lib/ui-read-flight.mjs";
import { OBSERVATORY_VIEWS } from "@/lib/operator-observatory.mjs";
import { projectPrimaryOperatorView, type PrimaryDelivery } from "@/lib/operator-primary-views.mjs";
import {
  advanceOperatorObservatoryResync, emptyOperatorObservatoryResync,
  expireOperatorObservatoryResync,
} from "@/lib/operator-observatory-resync.mjs";

type ViewName = keyof typeof OBSERVATORY_VIEWS;
type OperatorBridge = {
  // Future W3 native preload/gateway integration: no key/token in the renderer.
  readContext?: () => Promise<unknown>;
};

function operatorBridge(): OperatorBridge | null {
  return (window as Window & { metaengineOperator?: OperatorBridge }).metaengineOperator ?? null;
}

const STATE_TONES: Record<string, string> = {
  READY: "border-emerald-800 bg-emerald-950/30 text-emerald-200",
  AVAILABLE: "border-cyan-900 bg-cyan-950/30 text-cyan-200",
  AMBIGUOUS: "border-rose-800 bg-rose-950/40 text-rose-200",
  STALE: "border-amber-800 bg-amber-950/30 text-amber-200",
  UNVERIFIED: "border-amber-800 bg-amber-950/30 text-amber-200",
  UNKNOWN: "border-zinc-700 bg-zinc-900 text-zinc-300",
  OFFLINE: "border-rose-900 bg-rose-950/30 text-rose-300",
};
const STATE_HINTS: Record<string, string> = {
  READY: "Upstream trusted readback reported READY; this is not an effect grant.",
  AVAILABLE: "Observed availability only. Does not establish execution activity.",
  UNKNOWN: "No trusted witness is connected. Not an offline or active claim.",
  UNVERIFIED: "Missing, malformed or untrusted evidence; positive claims suppressed.",
  STALE: "Observation is outside the configured freshness window.",
  AMBIGUOUS: "Conflicting identity, proof or monotonic event history. Reconciliation required.",
  DEGRADED: "Reported degraded by the source readback.",
  BLOCKED: "Reported blocked by the source readback.",
  OFFLINE: "Reported offline by the source readback.",
};

type ObservatoryFrame = ReturnType<typeof advanceOperatorObservatoryResync>;

// Shared across route mounts. Only physical settlement frees this readonly slot.
const observatoryReadFlight = createPhysicalReadGate();

export function OperatorObservatoryPage({ observationScope = "primary" }: { observationScope?: string } = {}) {
  const [view, setView] = useState<ViewName>("Now");
  // Do not infer the initial UNKNOWN/null-only shape as the permanent state:
  // a real readback may carry a run, cursor, identity and all seven planes.
  const [resync, setResync] = useState<ObservatoryFrame>(() => emptyOperatorObservatoryResync());
  const [connection, setConnection] = useState<"UNBOUND" | "READING" | "OBSERVED" | "UNAVAILABLE">("UNBOUND");
  const [delivery, setDelivery] = useState<PrimaryDelivery>("LOADING");
  const [firstTruthMs, setFirstTruthMs] = useState<number | null>(null);
  const firstReadStart = useRef<number | null>(null);
  // A single shared checkpoint governs all seven panels. Keep it across
  // transport failures, remount-free navigation and expired readbacks.
  const checkpoint = useRef<ObservatoryFrame>(emptyOperatorObservatoryResync());
  const lifecycle = useRef(0);
  const lastScope = useRef(observationScope);
  const mounted = useRef(false);

  const update = useCallback((next: ObservatoryFrame) => {
    checkpoint.current = next;
    if (mounted.current) {
      setResync(next);
      setConnection(next.mode === "TRACKING" ? "OBSERVED" : "UNAVAILABLE");
      if (next.mode === "TRACKING" && firstReadStart.current !== null) {
        const elapsed = Math.max(0, Math.round(performance.now() - firstReadStart.current));
        setFirstTruthMs(previous => previous ?? elapsed);
      }
    }
  }, []);

  const refresh = useCallback(async (explicitResync = false) => {
    if (!mounted.current || observatoryReadFlight.isBusy() || (checkpoint.current.requires_explicit_resync && !explicitResync)) return;
    const bridge = operatorBridge();
    if (!bridge?.readContext) {
      update(advanceOperatorObservatoryResync(checkpoint.current, null));
      if (mounted.current) setDelivery("UNBOUND");
      return;
    }
    const epoch = lifecycle.current;
    const current = () => mounted.current && lifecycle.current === epoch;
    const physicalRead = observatoryReadFlight.run(() => {
      if (!bridge.readContext) throw new Error("operator_bridge_unavailable");
      return bridge.readContext();
    });
    if (!physicalRead) return;
    if (mounted.current) {
      setConnection("READING");
      setDelivery(checkpoint.current.mode === "TRACKING" ? "READING" : "LOADING");
    }
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      if (!current()) return;
      update(advanceOperatorObservatoryResync(checkpoint.current, null, {
        intent: explicitResync ? "EXPLICIT_RESYNC" : "POLL",
      }));
      setDelivery("TIMED_OUT");
    }, 2500);
    try {
      // The deadline changes presentation only. The native API has no cancel.
      // A late result is discarded; normal polling resumes after settlement.
      const result = await physicalRead;
      if (!current() || expired) return;
      update(advanceOperatorObservatoryResync(checkpoint.current, result, {
        intent: explicitResync ? "EXPLICIT_RESYNC" : "POLL",
      }));
      setDelivery("IDLE");
    } catch {
      if (current() && !expired) {
        update(advanceOperatorObservatoryResync(checkpoint.current, null, {
          intent: explicitResync ? "EXPLICIT_RESYNC" : "POLL",
        }));
        // Do not render the exception message: it may contain native secrets.
        setDelivery("FAILED");
      }
    } finally {
      clearTimeout(timer);
    }
  }, [update]);

  const projection = resync.projection;
  // Primary views use exactly the same redacted frame as the other four.
  // No legacy workbench, daemon, HTTP or roster fallback when proof is absent.
  const primary = view === "Now" || view === "Missions" || view === "Fleet"
    ? projectPrimaryOperatorView(resync, view, { delivery, firstTruthMs }) : null;

  useEffect(() => {
    mounted.current = true;
    const epoch = ++lifecycle.current;
    if (lastScope.current !== observationScope) {
      lastScope.current = observationScope;
      checkpoint.current = emptyOperatorObservatoryResync();
      firstReadStart.current = null;
    }
    firstReadStart.current ??= performance.now();
    let waitingTimer: ReturnType<typeof setTimeout> | null = null;
    queueMicrotask(() => {
      if (!mounted.current || lifecycle.current !== epoch) return;
      update(checkpoint.current);
      if (checkpoint.current.mode !== "TRACKING") setFirstTruthMs(null);
      if (observatoryReadFlight.isBusy()) {
        setDelivery("READING");
        waitingTimer = setTimeout(() => {
          if (mounted.current && lifecycle.current === epoch && observatoryReadFlight.isBusy()) setDelivery("TIMED_OUT");
        }, 2500);
      } else void refresh();
    });
    const ticker = window.setInterval(() => {
      // Expire visual truth on the clock EVEN if the window is hidden, the
      // trusted bridge is stalled or the network was lost. No cached ACTIVE.
      const current = expireOperatorObservatoryResync(checkpoint.current);
      if (current !== checkpoint.current) update(current);
      if (document.visibilityState === "visible"
        && !checkpoint.current.requires_explicit_resync) void refresh();
    }, 5000);
    return () => {
      mounted.current = false;
      lifecycle.current += 1;
      if (waitingTimer !== null) clearTimeout(waitingTimer);
      window.clearInterval(ticker);
    };
  }, [observationScope, refresh, update]);

  const names = OBSERVATORY_VIEWS[view];
  const cursor = projection.cursor_state === "VERIFIED_CURSOR"
    ? String(projection.event_seq)
    : projection.cursor_state;
  const displayRun = projection.run_id ?? "UNKNOWN";

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-5 pb-12" data-testid="operator-observatory"
      aria-label="Causal Observatory" data-authority-effect="false">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400">Unified Command / P4</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-100">Causal Observatory</h1>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-zinc-400">
            Seven projections of one authenticated Operator context. A connected HTTP endpoint,
            open tab or available database never proves an active mission, agent or supervisor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void refresh()} disabled={connection === "READING" || resync.requires_explicit_resync}
            data-testid="operator-observatory-refresh"
            className="min-h-9 border border-zinc-700 bg-zinc-900 px-4 text-[12px] text-zinc-200 hover:border-zinc-500 disabled:opacity-50">
            {connection === "READING" ? "Reading…" : resync.requires_explicit_resync ? "Reconciliation required" : "Refresh readback"}
          </button>
          {resync.requires_explicit_resync ? (
            <button type="button" onClick={() => void refresh(true)} disabled={connection === "READING"}
              data-testid="operator-observatory-explicit-resync"
              className="min-h-9 border border-amber-800 bg-amber-950/40 px-4 text-[12px] text-amber-200 disabled:opacity-50">
              {connection === "READING" ? "Checking proof…" : "Explicitly re-read & resynchronize"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4" aria-label="Canonical context identity">
        <div className="border border-zinc-800 bg-zinc-900/40 p-3" data-testid="operator-context-run">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Run</div>
          <div className="mt-1 break-all font-mono text-[12px] text-zinc-200">{displayRun}</div>
        </div>
        <div className="border border-zinc-800 bg-zinc-900/40 p-3" data-testid="operator-context-cursor">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Event cursor</div>
          <div className="mt-1 font-mono text-[12px] text-zinc-200">{cursor}</div>
        </div>
        <div className="border border-zinc-800 bg-zinc-900/40 p-3" data-testid="operator-context-truth">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Readback</div>
          <div className="mt-1 text-[12px] text-zinc-200">{resync.mode} · {projection.state}</div>
        </div>
        <div className="border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Observed at</div>
          <div className="mt-1 break-all font-mono text-[11px] text-zinc-200">
            {projection.generated_at ?? "UNKNOWN"}
          </div>
        </div>
      </div>

      {resync.mode !== "TRACKING" || projection.cursor_state !== "VERIFIED_CURSOR" ? (
        <p role="status" className="border-l-2 border-amber-600 bg-amber-950/20 px-3 py-2 text-[12px] text-amber-200"
          data-testid="operator-context-warning">
          {resync.requires_explicit_resync
            ? "AMBIGUOUS: cursor gap/rollback, source or Owner rollover. Manual re-read requires one fresh source-bound resync witness; clicking alone cannot clear this fence."
            : resync.mode === "STALE"
              ? "STALE: source snapshot expired; prior event watermark is preserved without current activity claims."
              : "UNKNOWN: canonical Owner/source/proof readback is missing or unverified. No activity is inferred."}
        </p>
      ) : null}

      <nav aria-label="Observatory views" className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
        {(Object.keys(OBSERVATORY_VIEWS) as ViewName[]).map(name => (
          <button type="button" key={name} onClick={() => setView(name)} aria-current={view === name ? "page" : undefined}
            data-testid={`operator-view-${name.toLowerCase()}`}
            className={`min-h-9 px-3 text-[12px] transition-colors ${view === name
              ? "border-b-2 border-cyan-400 bg-cyan-950/20 font-medium text-cyan-200"
              : "border-b-2 border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}>
            {name}
          </button>
        ))}
      </nav>
      <div>
        <h2 className="text-lg font-medium text-zinc-100">{view}</h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          {view === "Now" ? "All seven source planes, not a synthesized liveness badge." :
           view === "Missions" ? "Mission records await own-ledger readback; no task counts are inferred." :
           view === "Fleet" ? "Lease, supervisor and Host provenance only; no roster-derived ACTIVE state." :
           view === "Brain" ? "No dedicated Brain witness in Operator Context v1; Brain activity is UNKNOWN." :
           view === "Develop" ? "Source and Client witnesses; a commit or passing CI is not installed execution proof." :
           view === "System" ? "Own PostgreSQL and Host/Client/Supervisor facets; database AVAILABLE is not system READY." :
           "Proof provenance and event cursor; no unsourced event content."}
        </p>
      </div>
      {primary ? (
        <section className="border border-cyan-900/40 bg-cyan-950/10 p-4" data-testid="operator-primary-summary"
          aria-label={primary.title} aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[14px] font-medium text-zinc-100">{primary.title}</h3>
            <span data-testid="operator-primary-phase" className="border border-zinc-700 px-2 py-1 font-mono text-[11px] text-cyan-200">
              {primary.phase}
            </span>
          </div>
          <p className="mt-2 text-[12px] text-zinc-300" role="status" data-testid="operator-primary-boundary">
            {primary.hint}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="operator-primary-readback">
            {primary.facets.map(facet => (
              <div key={facet.name} className="border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <span className="text-[11px] capitalize text-zinc-400">{facet.name}</span>
                <strong className={`ml-2 font-mono text-[11px] ${facet.state === "UNKNOWN" ? "text-zinc-400" : "text-zinc-100"}`}>
                  {facet.state}
                </strong>
              </div>
            ))}
          </div>
          <p className="mt-3 border-l-2 border-zinc-600 pl-3 text-[12px] text-zinc-400"
            data-testid="operator-primary-missing">{primary.missing_detail}</p>
          <p className="mt-2 text-[11px] text-zinc-500" data-testid="operator-primary-ttft">
            First source-bound cursor: {primary.first_truth_ms === null
              ? "UNKNOWN" : `${primary.first_truth_ms} ms`} (UI elapsed; not execution readiness).
          </p>
        </section>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="operator-planes">
        {names.map((name: string) => {
          const facet = projection.planes[name] ?? { state: "UNKNOWN", fresh: false, proof: "NONE", observed_at: null };
          return <details key={name} className="group border border-zinc-800 bg-[#111114] p-4"
            data-testid={`operator-plane-${name}`}>
            <summary className="cursor-pointer list-none">
              <span className="flex items-center justify-between gap-2">
                <strong className="capitalize text-[14px] font-medium text-zinc-100">{name}</strong>
                <span className={`border px-2 py-1 font-mono text-[10px] ${STATE_TONES[facet.state] ?? STATE_TONES.UNKNOWN}`}>
                  {facet.state}
                </span>
              </span>
              <span className="mt-3 block text-[11px] leading-relaxed text-zinc-400">
                {STATE_HINTS[facet.state] ?? "Nonpositive upstream state; inspect verified source evidence."}
              </span>
            </summary>
            <dl className="mt-4 grid grid-cols-[80px_1fr] gap-2 border-t border-zinc-800 pt-3 text-[11px]">
              <dt className="text-zinc-500">Proof</dt><dd className="break-all font-mono text-zinc-300">{facet.proof}</dd>
              <dt className="text-zinc-500">Fresh</dt><dd className="text-zinc-300">{facet.fresh === true ? "YES" : "NO"}</dd>
              <dt className="text-zinc-500">Observed</dt>
              <dd className="break-all font-mono text-zinc-300">{facet.observed_at ?? "UNKNOWN"}</dd>
            </dl>
          </details>;
        })}
      </div>
      <section className="border border-zinc-800 bg-zinc-900/30 p-4" aria-label="Evidence identity"
        data-testid="operator-evidence">
        <h3 className="text-[13px] font-medium text-zinc-200">Causal evidence identity</h3>
        <dl className="mt-3 grid grid-cols-[110px_1fr] gap-2 text-[11px]">
          <dt className="text-zinc-500">Run</dt><dd className="break-all font-mono">{displayRun}</dd>
          <dt className="text-zinc-500">Event sequence</dt><dd className="font-mono">{cursor}</dd>
          <dt className="text-zinc-500">Owner epoch</dt>
          <dd className="font-mono" data-testid="operator-owner-epoch">{resync.identity?.owner_epoch ?? "UNKNOWN"}</dd>
          <dt className="text-zinc-500">Source SHA</dt>
          <dd className="break-all font-mono" data-testid="operator-source-sha">{resync.identity?.source_sha ?? "UNKNOWN"}</dd>
          <dt className="text-zinc-500">Proof fingerprint</dt>
          <dd className="break-all font-mono">{projection.proof_identity ?? "UNKNOWN"}</dd>
          <dt className="text-zinc-500">Authority</dt>
          <dd className="font-mono">READ_ONLY / authority_effect=false / no automatic retry</dd>
        </dl>
        <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
          Source-only resync checks do not attest native Owner/Guardian. Operator v1 does not expose bounded task, Brain, artifact or per-event drill-down yet.
          Missing records remain UNKNOWN until a trusted own-PostgreSQL ledger adapter and
          monotonic event API are independently qualified.
        </p>
      </section>
    </section>
  );
}
