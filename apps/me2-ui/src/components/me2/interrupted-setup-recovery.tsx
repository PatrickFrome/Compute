"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { refreshClientRuntimeStatus } from "@/hooks/use-client-runtime-status";

type RecoveryStatus = {
  schema: "metaengine.client.interrupted-setup-status.v1";
  eligible: boolean;
  reason: string | null;
  expected_recovery_sha256: string | null;
  affected_agent_count: number;
  previous_effect_outcome: "UNKNOWN";
};
type RecoveryRequest = {
  schema: "metaengine.client.interrupted-setup-request.v1";
  action: "ARCHIVE_INTERRUPTED_SETUP_AND_START_NEW";
  operator_initiated: true;
  expected_recovery_sha256: string;
};
type RecoveryReceipt = {
  state: string;
  recovery_id: string;
  supervisor_epoch: number;
  retired_agent_count: number;
  previous_effect_outcome: "UNKNOWN";
  previous_effect_replayed: false;
};
type RecoveryBridge = {
  inspectInterruptedSetupRecovery?: () => Promise<RecoveryStatus>;
  startFreshSetup?: (request: RecoveryRequest) => Promise<RecoveryReceipt>;
};
const bridge = () => (window as Window & { metaengineClient?: RecoveryBridge }).metaengineClient;

export function InterruptedSetupRecovery() {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useRef(false);
  const mounted = useRef(false);
  const observationGeneration = useRef(0);
  const readStatus = useCallback(async (generation: number) => {
    try {
      // Always settle through the external-read promise, including synchronous
      // bridge failures; initial loading is represented by initial state.
      const next = await Promise.resolve().then(() => bridge()?.inspectInterruptedSetupRecovery?.());
      if (mounted.current && generation === observationGeneration.current) setStatus(next?.schema === "metaengine.client.interrupted-setup-status.v1"
        && next.previous_effect_outcome === "UNKNOWN" ? next : null);
    } catch { if (mounted.current && generation === observationGeneration.current) { setStatus(null); setMessage("Session state could not be checked. Try reading it again."); } }
    finally { if (generation === observationGeneration.current) { operation.current = false; if (mounted.current) setBusy(false); } }
  }, []);
  const inspect = useCallback(() => {
    if (!mounted.current || operation.current) return;
    operation.current = true; setBusy(true);
    void readStatus(++observationGeneration.current);
  }, [readStatus]);
  useEffect(() => {
    mounted.current = true;
    operation.current = true;
    void readStatus(++observationGeneration.current);
    return () => { mounted.current = false; observationGeneration.current += 1; };
  }, [readStatus]);
  const start = async () => {
    if (!mounted.current || operation.current || !status?.eligible || !/^[a-f0-9]{64}$/.test(status.expected_recovery_sha256 || "")) return;
    const generation = observationGeneration.current;
    operation.current = true; setBusy(true); setMessage(null);
    try {
      const result = await bridge()?.startFreshSetup?.({ schema: "metaengine.client.interrupted-setup-request.v1",
        action: "ARCHIVE_INTERRUPTED_SETUP_AND_START_NEW", operator_initiated: true,
        expected_recovery_sha256: status.expected_recovery_sha256! });
      if (result?.state !== "FRESH_SETUP_PREPARED" || result.previous_effect_outcome !== "UNKNOWN" || result.previous_effect_replayed !== false) throw new Error("readback_unconfirmed");
      if (mounted.current && generation === observationGeneration.current) { setStatus(null); setMessage("Interrupted setup archived. New sessions are being prepared; their readiness will be checked independently."); }
      await refreshClientRuntimeStatus();
    } catch { if (mounted.current && generation === observationGeneration.current) setMessage("A new setup was not confirmed. Read the current session state before taking another action."); }
    finally { if (generation === observationGeneration.current) { operation.current = false; if (mounted.current) setBusy(false); } }
  };
  return <section className="mt-4 rounded-xl bg-zinc-900/60 p-4" data-testid="interrupted-setup-recovery" aria-labelledby="interrupted-setup-title">
    <h3 id="interrupted-setup-title" className="text-[13px] font-medium text-zinc-200">Interrupted session setup</h3>
    <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">Archive a setup left by a previous process and start new sessions. Previous unconfirmed sends stay recorded as unknown and are never replayed. Projects and task history are preserved.</p>
    {!status?.eligible ? <p role="status" className="mt-2 text-[12px] text-zinc-400">{busy ? "Checking existing sessions…" : status ? "Existing sessions need inspection before a new setup can start." : "Read session state to check whether a new setup is available."}</p> : null}
    {message ? <p role="status" className="mt-3 text-[13px] text-zinc-300">{message}</p> : null}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void start()} disabled={busy || !status?.eligible}
      className="mc-soft-action min-h-9 px-3 text-[12px] disabled:opacity-40" data-testid="start-fresh-session-setup">{busy ? "Checking…" : "Archive setup and start new sessions"}</button>
      <button type="button" onClick={() => void inspect()} disabled={busy} className="min-h-9 px-3 text-[12px] text-zinc-300">Read session state</button></div>
  </section>;
}
