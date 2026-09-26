// Action bus registry (protocol: new operations are REST families or actions
// here — the bus registry is the single catalogue).
// HONEST COUNT: this recovery build implements the actions below; the donor
// 47-action registry (v0.57.1, sandbox/me2-os) is pending GitHub recovery.
// Health reports implemented/implemented — never claims 47/47 falsely.
import { OpError } from "./errors";
import { appendEvent, tail, verifyChain, lastSeq } from "./eventlog";
import { listWorktrees, createWorktree, removeWorktree } from "./worktrees";
import { execWhitelisted, probe, whitelist } from "./sandbox";
import { evaluateVerdicts } from "./verdicts";
import { ROADMAP, RELEASE_AUTHORITY, DONOR_AUTHORITIES, RECOVERY_STATUS } from "./roadmap";
import { supervisorSnapshot, mirrorTail, runtimeCapabilities, writeMirrorAnchor } from "./controlplane";
import { monitorHistory } from "./monitor";
import { donorRegistry } from "./donor-registry";
import { convergenceStatus } from "./github";
import { r82Diagnosis } from "./r82";
import { edgeStatus, edgeImportPlan, edgeImportStatus } from "./edge";
import { readbackStatus } from "./readback";
import { r82Report } from "./report";
import { mirrorStatus, mirrorVerify, syncMirror } from "./mirror";
import { VERSION, ROUND, REST_PORT, WS_PORT, STARTED_AT } from "./version";
import { STARTED_VERSION } from "./boot";

export interface ActionDef {
  name: string;
  family: string;
  description: string;
}

export const ACTIONS: ActionDef[] = [
  { name: "health.check", family: "core", description: "Daemon health snapshot" },
  { name: "capabilities.list", family: "core", description: "Action registry listing" },
  { name: "events.tail", family: "events", description: "Tail of the hash-chained event log" },
  { name: "events.append", family: "events", description: "Append a typed event to the log" },
  { name: "eventlog.verify", family: "events", description: "Recompute and verify the hash chain" },
  { name: "worktrees.list", family: "worktrees", description: "List git worktrees of the sandbox repo" },
  { name: "worktrees.create", family: "worktrees", description: "Create whitelisted worktree wt-<name> + branch work/<name>" },
  { name: "worktrees.remove", family: "worktrees", description: "Remove a worktree (fail-closed if dirty)" },
  { name: "sandbox.probe", family: "sandbox", description: "prlimit-isolated whitelisted exec proof" },
  { name: "sandbox.exec", family: "sandbox", description: "Execute an exact-match whitelisted command" },
  { name: "verdicts.list", family: "verdicts", description: "Cold-start-safe verdict checks" },
  { name: "roadmap.get", family: "roadmap", description: "R81→R90 roadmap + release/donor authorities" },
  { name: "recovery.status", family: "roadmap", description: "Env-reset recovery inventory (restored/blocked)" },
  { name: "controlplane.supervisor", family: "controlplane", description: "Live Supabase supervisor snapshot (curated)" },
  { name: "controlplane.mirror-tail", family: "controlplane", description: "Last mirrored events from Supabase evidence mirror" },
  { name: "controlplane.capabilities", family: "controlplane", description: "DevOS runtime capabilities RPC (read-only)" },
  { name: "controlplane.history", family: "controlplane", description: "Supervisor convergence monitor ring buffer (chart data)" },
  { name: "controlplane.mirror-anchor", family: "controlplane", description: "Operator-triggered single anchor write to the evidence mirror" },
  { name: "donor.registry", family: "recovery", description: "Recovered donor 57-action manifest (sandbox/me2-os @ 56ba1b87) + local reconciliation" },
  { name: "convergence.status", family: "controlplane", description: "R81 convergence branch live status from GitHub (PR #968, head, CI rollup)" },
  { name: "r82.diagnosis", family: "controlplane", description: "R82 live supervisor diagnosis via command fastlane (READ-ONLY probes: attempt tab, draft canary, PR #981 CI)" },
  { name: "edge.status", family: "controlplane", description: "R83 Cloudflare Edge qualification (read-only): workers, versions, live digests, source-binding verdicts" },
  { name: "edge.import-plan", family: "controlplane", description: "R83 source-tree import plan: live snapshots decomposed into a reviewable repo layout (IMPORT_READY / NEEDS_UNBUNDLING per worker)" },
  { name: "edge.import-status", family: "controlplane", description: "R83 import PR #982 live status: state, CI rollup on branch head, digest contract" },
  { name: "r82.readback", family: "controlplane", description: "R82 exit-gate watch: release CI terminal, self-update landing, draft canary history, cycle growth — deterministic stage machine" },
  { name: "r82.report", family: "controlplane", description: "R82 before/after diff report: poisoned baseline (live-verified at diagnosis) vs live-now, metric by metric + key-moment timeline — release-readiness material for R89" },
  { name: "mirror.status", family: "controlplane", description: "R83 evidence auto-mirror status: chain cursor, live tail match, pending lag, sync history" },
  { name: "mirror.sync", family: "controlplane", description: "Operator-triggered evidence sync: batch-replicate pending local events into me2_event_mirror (fail-closed on divergence)" },
  { name: "mirror.verify", family: "controlplane", description: "Independent mirror-contract check (in-process port of verify-mirror.mjs): reads ALL rows paged, verifies seq continuity + prev_hash chain + row-hash recompute + local cross-bindings; the run lands in the hash-chain as MIRROR_VERIFY evidence" },
];

export async function dispatch(action: string, args: Record<string, unknown>): Promise<unknown> {
  const a = ACTIONS.find((x) => x.name === action);
  if (!a) {
    throw new OpError("action_unknown", `unknown action '${action}' (see /capabilities)`, 404);
  }
  appendEvent("ACTION_INVOKED", "operator", action, { args_keys: Object.keys(args ?? {}) });
  switch (action) {
    case "health.check":
      return {
        ok: true,
        version: VERSION,
        round: ROUND,
        uptime_s: Math.round((Date.now() - STARTED_VERSION.started_at_ms) / 1000),
        started_at: STARTED_AT,
        rest_port: REST_PORT,
        ws_port: WS_PORT,
        last_seq: lastSeq(),
      };
    case "capabilities.list":
      return { count: ACTIONS.length, actions: ACTIONS };
    case "events.tail":
      return { events: tail(Number(args.limit ?? 50)) };
    case "events.append":
      return appendEvent(
        String(args.type ?? ""),
        String(args.actor ?? "operator"),
        args.subject == null ? null : String(args.subject),
        args.payload ?? null
      );
    case "eventlog.verify":
      return verifyChain();
    case "worktrees.list":
      return { worktrees: listWorktrees() };
    case "worktrees.create":
      return createWorktree(String(args.name ?? ""));
    case "worktrees.remove":
      return removeWorktree(String(args.name ?? ""));
    case "sandbox.probe":
      return probe();
    case "sandbox.exec":
      return execWhitelisted(Array.isArray(args.cmd) ? (args.cmd as string[]) : []);
    case "verdicts.list":
      return evaluateVerdicts();
    case "roadmap.get":
      return { roadmap: ROADMAP, release_authority: RELEASE_AUTHORITY, donors: DONOR_AUTHORITIES };
    case "recovery.status":
      return RECOVERY_STATUS;
    case "controlplane.supervisor":
      return supervisorSnapshot(args.fresh === true);
    case "controlplane.mirror-tail":
      return mirrorTail();
    case "controlplane.capabilities":
      return runtimeCapabilities();
    case "controlplane.history":
      return monitorHistory();
    case "controlplane.mirror-anchor":
      return writeMirrorAnchor();
    case "donor.registry":
      return donorRegistry(ACTIONS.map((a) => ({ name: a.name, family: a.family })));
    case "convergence.status":
      return convergenceStatus(args.fresh === true);
    case "r82.diagnosis":
      return r82Diagnosis(args.fresh === true);
    case "edge.status":
      return edgeStatus(args.fresh === true, args.snapshot === true);
    case "edge.import-plan":
      return edgeImportPlan();
    case "edge.import-status":
      return edgeImportStatus(args.fresh === true);
    case "r82.readback":
      return readbackStatus(args.fresh === true);
    case "r82.report":
      return r82Report(args.fresh === true);
    case "mirror.status":
      return mirrorStatus(args.fresh === true);
    case "mirror.sync":
      return syncMirror("operator");
    case "mirror.verify":
      return mirrorVerify();
    default:
      throw new OpError("action_not_implemented", `${action} registered but not implemented`, 500);
  }
}
