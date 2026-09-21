import { edgeDevicePost, getProbeDevice, type ProbeIdentity } from "@/lib/probe-device";
import { query } from "@/lib/pg";

export const dynamic = "force-dynamic";

const WORKSPACE_ID = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Canonical DevOS task cycle driver — the console plays the role of a live
 * browser supervisor for one full T6/T7 rehearsal beat, through the REAL
 * device-signed edge routes (no SQL shortcuts):
 *
 *   1. /v1/state           — supervisor heartbeat projection (fleet roster +
 *                            supervisor_lifecycle ALIVE) — the admission
 *                            fence source of truth (<45s freshness contract)
 *   2. /v1/devos/cycle     — reconcile → snapshot → fair-share lease
 *   3. /v1/devos/mark-running — double proof (prompt/conversation sha256)
 *   4. /v1/devos/complete  — FINALISH state + claim close + event
 *
 * Every step's edge response is journaled into the in-memory run ring.
 */

interface DriveStep {
  step: string;
  route: string;
  status: number;
  ms: number;
  summary: Record<string, unknown>;
}

export interface DriveRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  clientId: string;
  taskId?: string;
  finalState?: string;
  steps: DriveStep[];
  error?: string;
}

const globalForDrive = globalThis as unknown as { __mcDriveRuns?: DriveRun[] };
function journal(run: DriveRun): DriveRun[] {
  const ring = (globalForDrive.__mcDriveRuns ?? []);
  ring.unshift(run);
  if (ring.length > 12) ring.length = 12;
  globalForDrive.__mcDriveRuns = ring;
  return ring;
}

function agentIdFor(clientId: string): string {
  // AGENT_RE (edge) = /^agent_[a-z0-9-]{8,64}$/ — literal "agent_" prefix,
  // body may only contain lowercase letters, digits and HYPHENS (no underscores)
  const slug = clientId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").padEnd(8, "0").slice(0, 32);
  return `agent_mc-${slug}`;
}

async function step(
  run: DriveRun,
  name: string,
  route: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await edgeDevicePost(route, body);
  // keep only bounded summary fields (avoid dumping whole payloads into journal)
  const summary = Object.fromEntries(
    Object.entries(res.json)
      .filter(([k]) =>
        [
          "accepted",
          "leased",
          "task_id",
          "state",
          "lease_generation",
          "reason",
          "error",
          "admission_fenced",
          "lease_fenced",
          "lease_fence_reason",
          "automatic_retry_allowed",
        ].includes(k),
      )
      .map(([k, v]) => [k, typeof v === "object" && v !== null ? "[object]" : v]),
  );
  run.steps.push({ step: name, route, status: res.status, ms: res.ms, summary });
  return { status: res.status, json: res.json };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const role = String(body.role ?? "CLOSER").trim().toUpperCase();
  if (!ROLE_RE.test(role)) {
    return Response.json({ ok: false, error: "role_invalid" }, { status: 400 });
  }

  const run: DriveRun = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    ok: false,
    clientId: "",
    steps: [],
  };
  journal(run);

  try {
    const identity: ProbeIdentity = await getProbeDevice();
    run.clientId = identity.clientId;
    const agentId = agentIdFor(identity.clientId);
    const tabId = `tab_${crypto.randomUUID()}`;
    const targetId = "webcontents:1";
    const generationEpoch = 1;

    // 1. Supervisor heartbeat projection (admission fence contract):
    //    fresh <45s state with fleet roster + ALIVE lifecycle
    const nowIso = new Date().toISOString();
    const conversationUrlSha = await sha256(`https://local-reheural/mc-drive/${run.id}/${agentId}`);
    const stateBody = {
      shell_version: "0.7.0-dev.35532004761.1",
      // MONITOR + !armed ⇒ persisted authority_effect=false, which the claim
      // admission trigger requires (it only reads non-authoritative rows)
      supervisor_mode: "MONITOR",
      armed: false,
      operator_mode: "CONTROL",
      supervisor_lifecycle: {
        continuous_service: { enabled: true },
        actuation_enabled: true,
        keepalive: { state: "ALIVE" },
      },
      fleet: {
        schema: "metaengine.browser.fleet-snapshot.v1",
        readiness_contract: "TRANSPORT_PROOF_REQUIRED",
        agents: [
          {
            agent_id: agentId,
            role,
            ownership: "FLEET_OWNED",
            lifecycle_state: "ACTIVE",
            lifecycle_reason: "MC_CONSOLE_DRIVE",
            tab_id: tabId,
            target_id: targetId,
            generation_epoch: generationEpoch,
            transport_proof: {
              schema: "metaengine.browser.fleet-transport-proof.v1",
              tab_id: tabId,
              target_id: targetId,
              generation_epoch: generationEpoch,
              conversation_url_sha256: conversationUrlSha,
              proven_at: nowIso,
              authority_effect: false,
            },
            authority_effect: false,
            automatic_retry_allowed: false,
          },
        ],
        authority_effect: false,
      },
    };
    const stateRes = await step(run, "state-heartbeat", "/v1/state", { state: stateBody });
    if (stateRes.status !== 202) throw new Error(`state heartbeat rejected: HTTP ${stateRes.status}`);

    // 2. Cycle: reconcile → snapshot → fair-share lease
    const cycleRes = await step(run, "devos-cycle", "/v1/devos/cycle", {
      fleet: {
        agents: [
          {
            agent_id: agentId,
            role,
            lifecycle_state: "ACTIVE",
            tab_id: tabId,
            target_id: targetId,
            generation_epoch: generationEpoch,
          },
        ],
      },
    });
    const lease = (cycleRes.json.lease ?? null) as Record<string, unknown> | null;
    if (cycleRes.json.admission_fenced === true) {
      run.error = "admission_fenced";
      run.finishedAt = new Date().toISOString();
      return Response.json({ ok: false, run, error: "ADMISSION_FENCED" });
    }
    if (!lease || lease.leased !== true) {
      run.error = `no lease: ${String(lease?.reason ?? "NO_READY_TASK")}`;
      run.finishedAt = new Date().toISOString();
      return Response.json({ ok: false, run, error: run.error });
    }

    const taskId = String(lease.task_id);
    const binding = {
      task_id: taskId,
      agent_id: String(lease.agent_id),
      lease_generation: Number(lease.lease_generation),
      tab_id: String(lease.tab_id),
      target_id: String(lease.target_id),
      agent_generation_epoch: Number(lease.agent_generation_epoch),
    };
    run.taskId = taskId;

    // 3. Mark running with double proof (sha256 of prompt + conversation URL)
    const proof = {
      prompt_sha256: await sha256(`mc-drive:${run.id}:${taskId}:prompt`),
      conversation_url_sha256: conversationUrlSha,
      effect_state: "PROVEN_GENERATING",
    };
    const runningRes = await step(run, "mark-running", "/v1/devos/mark-running", { ...binding, proof });
    if (runningRes.json.accepted !== true) throw new Error(`mark-running rejected: ${JSON.stringify(runningRes.json).slice(0, 200)}`);

    // 4. Complete (FINALISH) with summary receipt
    const summary = {
      objective: String(lease.point_id ?? ""),
      operator: "MISSION_CONTROL_CONSOLE",
      role,
      base_sha: String(lease.base_sha ?? ""),
      proof,
      closed_at: new Date().toISOString(),
    };
    const completeRes = await step(run, "complete", "/v1/devos/complete", {
      ...binding,
      state: "COMPLETED",
      summary,
    });
    if (completeRes.json.accepted !== true) throw new Error(`complete rejected: ${JSON.stringify(completeRes.json).slice(0, 200)}`);

    run.finalState = String(completeRes.json.state ?? "COMPLETED");
    run.ok = true;
    run.finishedAt = new Date().toISOString();

    // durable readback from the DB (authoritative, not from edge response)
    const db = await query(
      `select state, lease_generation, finished_at from destruktion_meta.devos_fleet_task_h205f22 where task_id = $1`,
      [taskId],
    );
    run.finalState = String(db.rows[0]?.state ?? run.finalState);

    return Response.json({ ok: true, run });
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    run.finishedAt = new Date().toISOString();
    return Response.json({ ok: false, run, error: run.error }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ ok: true, runs: globalForDrive.__mcDriveRuns ?? [] });
}

async function sha256(v: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
