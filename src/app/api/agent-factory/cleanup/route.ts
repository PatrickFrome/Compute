/**
 * POST /api/agent-factory/cleanup — operator hygiene on the live browser.
 * Body: { targetAgents?: number; closeExtraTabs?: boolean }
 *  - FLEET_RECONCILE {target_agents} (browser may keep its persisted profile — reported honestly)
 *  - CLOSE_TAB batch for every tab not in the protected set
 *    (manifest agent tabs + rollover supervisor tab).
 */
import { closeExtraTabs, fleetReconcile, readSupervisorState } from "@/lib/browser-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ROLLOVER_TAB = "tab_1bf77894-e092-4936-a381-f50b463ebeec";

export async function POST(request: Request) {
  let body: { targetAgents?: number; closeExtraTabs?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch { /* defaults */ }

  const targetAgents = Math.min(Math.max(Number(body.targetAgents ?? 4), 0), 10);
  const doClose = body.closeExtraTabs !== false;
  const log: string[] = [];
  const push = (s: string) => log.push(`${new Date().toISOString().slice(11, 19)} ${s}`);

  try {
    const st0 = await readSupervisorState();
    const before = st0?.tabs?.length ?? 0;
    push(`tabs before: ${before}, live fleet: ${(st0?.fleet?.agents ?? []).filter((a) => a.lifecycle_state !== "LOST").length}`);

    const rec = await fleetReconcile(targetAgents);
    push(`FLEET_RECONCILE(target=${targetAgents}): ${rec.status} (browser may keep its persisted profile)`);

    if (doClose) {
      const manifestAgents = await readManifestTabIds();
      const keep = [...new Set([...manifestAgents, ROLLOVER_TAB])];
      const closed = await closeExtraTabs({ keepTabIds: keep });
      push(`closed ${closed.closed} extra tabs (kept ${keep.length})`);
    }

    await new Promise((r) => setTimeout(r, 2500));
    const st1 = await readSupervisorState();
    push(`tabs after: ${st1?.tabs?.length ?? "?"}`);

    return Response.json({
      ok: true,
      reconcile: rec.status,
      tabsBefore: before,
      tabsAfter: st1?.tabs?.length ?? null,
      log,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), log }, { status: 502 });
  }
}

async function readManifestTabIds(): Promise<string[]> {
  try {
    const fs = await import("node:fs");
    const m = JSON.parse(fs.readFileSync("/home/z/my-project/.a2/agent-factory-manifest.json", "utf8")) as { agents: { tabId: string }[] };
    return m.agents.map((a) => a.tabId);
  } catch {
    return [];
  }
}
