/**
 * POST /api/agent-factory/provision — provision + train console-owned agents.
 *
 * Body: { count?: number; roles?: string[]; mode?: "agent" | "chat" }
 * Default mode is "agent": every tab is switched to the z.ai AGENT surface
 * (full stack + long running tasks) before the bootstrap is typed — the
 * operator directive: fleet agents must be agent-mode tasks, not plain chats.
 *
 * Flow per agent (browser command plane, zero geometry):
 *   NEW_TAB(chat.z.ai) → SELECT_TAB + perception push → TYPED_CLICK("Agent"
 *   mode chip, exact accessible name) → SEMANTIC_TYPE(bootstrap,
 *   submit_after_type, platform GLM_ZAI) → READ_TRANSCRIPT verification.
 * Credentials come from the operator vault (/home/z/.a2/agent-factory-secrets.env).
 */
import {
  batchIssue,
  clickByName,
  issueCommand,
  readSupervisorState,
  typeInto,
} from "@/lib/browser-tools";
import { buildBootstrap, TRAINING_ROLES } from "@/lib/agent-factory/bootstrap";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MANIFEST = "/home/z/my-project/.a2/agent-factory-manifest.json";
// Composer accessible names: agent surface = "Send a Message", chat surface =
// "How can I help you today?" (localized placeholder — matched loosely).
const COMPOSER_RE = /^send a message$|^how can i help you today$/i;
const AGENT_CHIP_RE = /^agent$/i;

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

/** Click the Agent mode chip with bounded retries (fresh tabs hydrate slowly). */
async function enterAgentMode(tabId: string, log: string[]): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const r = await clickByName({ tabId, match: { name: AGENT_CHIP_RE, role: "button" } });
    if (r.ok) {
      log.push(`agent chip clicked (attempt ${attempt})`);
      return true;
    }
    log.push(`agent chip attempt ${attempt}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
    await new Promise((res) => setTimeout(res, 2500));
  }
  return false;
}

export async function POST(request: Request) {
  let body: { count?: number; roles?: string[]; mode?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch { /* defaults */ }

  const count = Math.min(Math.max(Number(body.count ?? 4), 1), 8);
  const mode: "agent" | "chat" = body.mode === "chat" ? "chat" : "agent";
  const roles: string[] =
    Array.isArray(body.roles) && body.roles.length >= count
      ? body.roles.slice(0, count).map(String)
      : TRAINING_ROLES.slice(0, count) as unknown as string[];

  const log: string[] = [];
  const push = (s: string) => { log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); };

  try {
    // 0) the draft poison guard: any root composer carrying an oversized
    // account-synced draft would swallow the bootstrap submit — the tabs are
    // opened fresh and the KEY_ATOMIC replace (R-DRAFT-FOCUS shell) clears
    // whatever the site restores, so no pre-scrub is required here.
    push(`opening ${count} tabs (parallel NEW_TAB batch, mode=${mode})`);
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

    // 1) train each: select → (agent mode) → SEMANTIC_TYPE bootstrap
    const trained: ManifestAgent[] = [];
    for (let i = 0; i < fresh.length; i++) {
      const { role, tabId } = fresh[i];
      if (mode === "agent") {
        const chipOk = await enterAgentMode(tabId, log);
        if (!chipOk) push(`WARN ${role}: agent chip not confirmed — typing into whatever surface is live`);
      }
      const text = buildBootstrap(role, i);
      push(`training ${role} @ ${tabId.slice(4, 12)} (bootstrap ${text.length} chars)`);
      const r = await typeInto({
        tabId,
        match: { name: COMPOSER_RE, role: "textbox" },
        text,
        submitAfterType: true,
        platform: "GLM_ZAI",
      });
      push(`SEMANTIC_TYPE ${role}: ${r.status}${r.error ? ` (${r.error})` : ""}${r.result?.effect_state ? ` effect=${String(r.result.effect_state)}` : ""}`);
      trained.push({
        role,
        agentId: `mcagent_${tabId.slice(4, 12)}`,
        tabId,
        kind: mode === "agent" ? "AGENT_TASK" : "GLM_CHAT",
        conversationUrl: r.perceptionUrl,
        trainedAt: new Date().toISOString(),
        bootstrapVerified: r.ok,
        typeStatus: r.status,
      });
      await new Promise((res) => setTimeout(res, 2000));
    }

    // 2) parallel transcript verification
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

    // 3) persist manifest
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

    return Response.json({ ok: true, mode, agents, verified, log });
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
