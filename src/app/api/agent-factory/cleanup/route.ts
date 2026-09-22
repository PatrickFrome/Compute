/**
 * POST /api/agent-factory/cleanup — operator hygiene on the live browser.
 * Body: { targetAgents?: number; closeExtraTabs?: boolean }
 *  - FLEET_RECONCILE {target_agents} (browser may keep its persisted profile — reported honestly)
 *  - CLOSE_TAB batch for every tab not in the PROTECTED set.
 *
 * Architecture note (2026-09-21 audit): the protected set is DERIVED from the
 * live state — never hard-coded. A stale tab-id constant here once risked
 * closing the supervisor's own rollover surface. Protected (in priority
 * order): the keepalive-bound conversation tab, the in-flight rollover
 * attempt tab, the currently selected tab, and manifest agent tabs.
 */
import { closeExtraTabs, fleetReconcile, readSupervisorState } from "@/lib/browser-tools";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
      const keep = protectedTabIds(st0);
      push(`protected: ${keep.size} tabs (keepalive/rollover/selected/manifest)`);
      const closed = await closeExtraTabs({ keepTabIds: [...keep] });
      push(`closed ${closed.closed} extra tabs (kept ${keep.size})`);
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

/**
 * The tabs the supervisor lifecycle depends on. Derived from the LIVE state
 * each call — the audit finding was that a hard-coded rollover tab id went
 * stale across rollovers and would have classified the supervisor's own
 * surface as "extra".
 */
function protectedTabIds(st: Awaited<ReturnType<typeof readSupervisorState>>): Set<string> {
  const keep = new Set<string>();
  const lc = (st?.supervisor_lifecycle ?? {}) as Record<string, unknown>;
  const keepalive = (lc.keepalive ?? {}) as Record<string, unknown>;
  // 1. the keepalive-bound supervisor conversation
  const boundTabId = String(keepalive.tab_id ?? "");
  if (boundTabId) keep.add(boundTabId);
  // 2. the in-flight rollover attempt tab (the fresh surface being bound)
  const attempt = (keepalive.rollover_attempt ?? null) as { tab_id?: string } | null;
  if (attempt?.tab_id) keep.add(String(attempt.tab_id));
  // 3. the supervisor's bound conversation URL tab (by URL match)
  const boundUrl = String(keepalive.conversation_url ?? "");
  if (boundUrl) {
    for (const t of st?.tabs ?? []) if (t.url === boundUrl) keep.add(t.tab_id);
  }
  // 4. the currently selected tab (operator surface — never close blindly)
  if (st?.active_tab?.tab_id) keep.add(st.active_tab.tab_id);
  for (const t of st?.tabs ?? []) if (t.selected) keep.add(t.tab_id);
  // 5. manifest agent tabs (factory-trained conversations)
  try {
    const m = JSON.parse(fs.readFileSync("/home/z/my-project/.a2/agent-factory-manifest.json", "utf8")) as { agents: { tabId: string }[] };
    for (const a of m.agents) if (a.tabId) keep.add(a.tabId);
  } catch { /* no manifest — fine */ }
  return keep;
}
