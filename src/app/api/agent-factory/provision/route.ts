/**
 * POST /api/agent-factory/provision — provision + train console-owned agents.
 *
 * Body: { count?: number; roles?: string[] }
 * Flow per agent (browser command plane, zero geometry):
 *   NEW_TAB(chat.z.ai) → SELECT_TAB + perception push → SEMANTIC_TYPE(bootstrap,
 *   submit_after_type) → READ_TRANSCRIPT verification.
 * Credentials come from the operator vault (/home/z/.a2/agent-factory-secrets.env).
 */
import {
  batchIssue,
  issueCommand,
  readSupervisorState,
  typeInto,
} from "@/lib/browser-tools";
import { buildBootstrap, TRAINING_ROLES } from "@/lib/agent-factory/bootstrap";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MANIFEST = "/home/z/my-project/.a2/agent-factory-manifest.json";
const COMPOSER_RE = /how can i help you today|send a message|ask anything/i;

interface ManifestAgent {
  role: string;
  agentId: string;
  tabId: string;
  conversationUrl?: string;
  trainedAt?: string;
  bootstrapVerified?: boolean;
  typeStatus?: string;
}

export async function POST(request: Request) {
  let body: { count?: number; roles?: string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch { /* defaults */ }

  const count = Math.min(Math.max(Number(body.count ?? 4), 1), 8);
  const roles: string[] =
    Array.isArray(body.roles) && body.roles.length >= count
      ? body.roles.slice(0, count).map(String)
      : TRAINING_ROLES.slice(0, count) as unknown as string[];

  const log: string[] = [];
  const push = (s: string) => { log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); };

  try {
    // 1) open N tabs in parallel (TAB_MUTATION batch)
    push(`opening ${count} tabs (parallel NEW_TAB batch)`);
    const opened = await batchIssue(
      roles.map(() => ({ action: "NEW_TAB", payload: { url: "https://chat.z.ai/", select: false } })),
      { waitMs: 45000 },
    );
    const fresh: { role: string; tabId: string }[] = [];
    for (let i = 0; i < opened.length; i++) {
      const tabId = String((opened[i].result as { tab_id?: string } | null)?.tab_id ?? "");
      push(`NEW_TAB ${roles[i]}: ${opened[i].status} ${tabId ? `tab=${tabId.slice(4, 12)}` : opened[i].error ?? ""}`);
      if (opened[i].ok && tabId) fresh.push({ role: roles[i], tabId });
    }

    if (!fresh.length) {
      return Response.json({ ok: false, stage: "new_tab", log, error: "no_tabs_opened — browser command lanes busy (keepalive/idle maintenance)" }, { status: 502 });
    }

    // 2) train each: select → perception → SEMANTIC_TYPE bootstrap
    const trained: ManifestAgent[] = [];
    for (let i = 0; i < fresh.length; i++) {
      const { role, tabId } = fresh[i];
      const text = buildBootstrap(role, i);
      push(`training ${role} @ ${tabId.slice(4, 12)} (bootstrap ${text.length} chars)`);
      const r = await typeInto({
        tabId,
        match: { name: COMPOSER_RE, role: "textbox" },
        text,
        submitAfterType: true,
      });
      push(`SEMANTIC_TYPE ${role}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
      trained.push({
        role,
        agentId: `mcagent_${tabId.slice(4, 12)}`,
        tabId,
        trainedAt: new Date().toISOString(),
        bootstrapVerified: r.ok,
        typeStatus: r.status,
      });
      await new Promise((res) => setTimeout(res, 2000));
    }

    // 3) parallel transcript verification
    push("verifying via parallel READ_TRANSCRIPT batch");
    const ver = await batchIssue(
      trained.map((a) => ({ action: "READ_TRANSCRIPT", payload: { tab_id: a.tabId } })),
      { waitMs: 40000 },
    );
    for (let i = 0; i < ver.length; i++) {
      const text = String((ver[i].result as { text?: string } | null)?.text ?? "");
      const seen = text.includes("BOOTSTRAP · AGENT FACTORY");
      if (seen) trained[i].bootstrapVerified = true;
      push(`verify ${trained[i].role}: ${ver[i].status} bootstrapSeen=${seen}`);
    }

    // 4) persist manifest
    const prev = (() => {
      try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { agents: ManifestAgent[] }; } catch { return { agents: [] as ManifestAgent[] }; }
    })();
    const byTab = new Map(prev.agents.map((a) => [a.tabId, a]));
    for (const a of trained) byTab.set(a.tabId, a);
    const agents = [...byTab.values()];
    fs.mkdirSync("/home/z/my-project/.a2", { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify({ agents, updatedAt: new Date().toISOString() }, null, 2));

    const verified = agents.filter((a) => a.bootstrapVerified).length;
    push(`manifest updated: ${agents.length} agents, ${verified} verified`);

    return Response.json({ ok: true, agents, verified, log });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 502 },
    );
  }
}

/** GET — current manifest only (cheap). */
export async function GET() {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    return Response.json({ ok: true, ...manifest });
  } catch {
    return Response.json({ ok: true, agents: [], updatedAt: "" });
  }
}

// keep issueCommand imported for potential single-tab retry extensions
void issueCommand;
void readSupervisorState;
