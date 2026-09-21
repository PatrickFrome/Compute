/**
 * GET /api/agent-factory/verify — parallel training verification.
 * Batch READ_TRANSCRIPT over all manifest agents (READ_ONLY lanes, concurrent),
 * checks for the bootstrap marker and GLM's acknowledgement ("BOOTSTRAP OK").
 */
import { batchIssue } from "@/lib/browser-tools";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface ManifestAgent {
  role: string;
  agentId: string;
  tabId: string;
  bootstrapVerified?: boolean;
}

export async function GET() {
  let agents: ManifestAgent[] = [];
  try {
    const m = JSON.parse(fs.readFileSync("/home/z/my-project/.a2/agent-factory-manifest.json", "utf8"));
    agents = (m.agents ?? []) as ManifestAgent[];
  } catch {
    return Response.json({ ok: true, agents: [], note: "no manifest" });
  }
  if (!agents.length) return Response.json({ ok: true, agents: [], note: "manifest empty" });

  try {
    const results = await batchIssue(
      agents.map((a) => ({ action: "READ_TRANSCRIPT", payload: { tab_id: a.tabId } })),
      { waitMs: 45000 },
    );
    const out = agents.map((a, i) => {
      const text = String((results[i].result as { text?: string } | null)?.text ?? "");
      return {
        role: a.role,
        agentId: a.agentId,
        tabId: a.tabId,
        commandStatus: results[i].status,
        bootstrapSeen: text.includes("BOOTSTRAP · AGENT FACTORY"),
        agentAcknowledged: /BOOTSTRAP OK/i.test(text),
        transcriptBytes: text.length,
        tail: text.slice(-300),
      };
    });
    return Response.json({ ok: true, agents: out, acknowledged: out.filter((o) => o.agentAcknowledged).length });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
