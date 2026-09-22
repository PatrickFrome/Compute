/**
 * POST /api/agent-factory/task — assign tasks to trained fleet agents.
 *
 * Body (either shape):
 *   { tasks: [{ agentId? , tabId?, role?, text }] }   — batch (parallel)
 *   { role: string, text }                            — single agent by role
 *   { text, all: true }                               — broadcast to every manifest agent
 *
 * Flow per agent (zero geometry): resolve the manifest tab → SEMANTIC_TYPE
 * (submit_after_type, platform GLM_ZAI) — the per-tab TAB_MUTATION lanes run
 * in parallel. Optional transcript verification happens in a second parallel
 * batch once the agents had a bounded window to start executing.
 */
import { batchIssue, typeInto } from "@/lib/browser-tools";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MANIFEST = "/home/z/my-project/.a2/agent-factory-manifest.json";
const COMPOSER_RE = /^send a message$|^how can i help you today$/i;

interface ManifestAgent {
  role: string;
  agentId: string;
  tabId: string;
  kind: "AGENT_TASK" | "GLM_CHAT";
  conversationUrl?: string;
  trainedAt?: string;
  bootstrapVerified?: boolean;
  typeStatus?: string;
}

interface TaskSpec {
  agentId?: string;
  tabId?: string;
  role?: string;
  text: string;
}

function readManifest(): ManifestAgent[] {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { agents?: ManifestAgent[] };
    return Array.isArray(m.agents) ? m.agents : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  let body: { tasks?: TaskSpec[]; role?: string; text?: string; all?: boolean; verify?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch { /* handled below */ }

  const verify = body.verify !== false;
  const agents = readManifest();

  let specs: TaskSpec[] = [];
  if (Array.isArray(body.tasks) && body.tasks.length) {
    specs = body.tasks.filter((t) => t && typeof t.text === "string" && t.text.trim().length > 0);
  } else if (typeof body.text === "string" && body.text.trim()) {
    if (body.all) {
      specs = agents.map((a) => ({ tabId: a.tabId, role: a.role, text: String(body.text) }));
    } else if (body.role) {
      specs = [{ role: String(body.role), text: String(body.text) }];
    }
  }

  if (!specs.length) {
    return Response.json({ ok: false, error: "no_task_specs — pass {tasks:[{tabId|agentId|role,text}]} or {role,text} or {all:true,text}" }, { status: 400 });
  }

  const log: string[] = [];
  const push = (s: string) => { log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); };

  // resolve each spec to a manifest tab
  const resolved: { spec: TaskSpec; agent: ManifestAgent | undefined }[] = specs.map((spec) => {
    let agent: ManifestAgent | undefined;
    if (spec.tabId) agent = agents.find((a) => a.tabId === spec.tabId);
    else if (spec.agentId) agent = agents.find((a) => a.agentId === spec.agentId);
    else if (spec.role) agent = agents.find((a) => a.role === String(spec.role).toUpperCase());
    return { spec, agent };
  });

  const missing = resolved.filter((r) => !r.agent);
  if (missing.length === resolved.length) {
    return Response.json({ ok: false, error: "no_resolved_agents — provision first (manifest empty or roles unknown)", log }, { status: 404 });
  }

  // parallel dispatch — one TAB_MUTATION lane per agent
  push(`dispatching ${resolved.filter((r) => r.agent).length} task(s) in parallel`);
  const dispatches = await Promise.all(
    resolved.map(async ({ spec, agent }) => {
      if (!agent) return { spec, ok: false as const, status: "NO_AGENT" };
      const r = await typeInto({
        tabId: agent.tabId,
        match: { name: COMPOSER_RE, role: "textbox" },
        text: spec.text,
        submitAfterType: true,
        platform: "GLM_ZAI",
        issuedBy: "AGENT_FACTORY_TASK",
      });
      push(`task → ${agent.role} (${agent.tabId.slice(4, 12)}): ${r.status}${r.error ? ` (${r.error})` : ""}`);
      return { spec, agent, ...r };
    }),
  );

  const sent = dispatches.filter((d) => d.ok);
  if (verify && sent.length) {
    // bounded execution window, then a parallel transcript sweep
    const EXECUTION_WINDOW_MS = 15000;
    await new Promise((res) => setTimeout(res, EXECUTION_WINDOW_MS));
    push("verification sweep (parallel READ_TRANSCRIPT)");
    const ver = await batchIssue(
      sent.map((d) => ({ action: "READ_TRANSCRIPT", payload: { tab_id: (d as { agent?: ManifestAgent }).agent?.tabId ?? "" } })),
      { waitMs: 40000 },
    );
    for (let i = 0; i < ver.length; i++) {
      const text = String((ver[i].result as { text?: string } | null)?.text ?? "");
      push(`transcript ${(sent[i] as { agent?: ManifestAgent }).agent?.role ?? i}: ${ver[i].status} (${text.length} chars captured)`);
    }
  }

  const okCount = sent.length;
  push(`done: ${okCount}/${resolved.length} dispatched`);
  return Response.json({
    ok: okCount > 0,
    dispatched: okCount,
    total: resolved.length,
    results: dispatches.map((d) => ({
      role: ("agent" in d ? d.agent?.role : d.spec.role) ?? d.spec.role ?? null,
      tabId: ("agent" in d ? d.agent?.tabId : d.spec.tabId) ?? d.spec.tabId ?? null,
      ok: d.ok,
      status: d.status,
      error: ("error" in d ? d.error : null) ?? null,
    })),
    log,
  });
}

/** GET — manifest summary (which agents can receive tasks right now). */
export async function GET() {
  const agents = readManifest();
  return Response.json({
    ok: true,
    agents: agents.map((a) => ({ agentId: a.agentId, role: a.role, tabId: a.tabId, kind: a.kind, verified: a.bootstrapVerified === true })),
    count: agents.length,
  });
}
