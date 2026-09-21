import { NextResponse } from "next/server";
import { ensureFallbackTables, getFallbackConsole, recentTransitions } from "@/lib/fallback-console";

export const dynamic = "force-dynamic";

/**
 * GET /api/fallback — sentinel snapshot (throttled probe, ≥4s between ticks)
 * + persisted transition log tail from local Pigsty.
 */
export async function GET() {
  try {
    const fc = getFallbackConsole();
    const snap = await fc.tickIfDue();
    let transitions: Record<string, unknown>[] = [];
    try {
      await ensureFallbackTables();
      transitions = await recentTransitions(12);
    } catch {
      // table unavailable — snapshot still returns in-memory tail
    }
    return NextResponse.json({ ok: true, snapshot: snap, dbTransitions: transitions, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * POST /api/fallback — actions:
 *   { action: "probe" }                          — force sentinel tick
 *   { action: "drill" }                          — read-only reserve-path drill
 *   { action: "simulate-outage", enabled, secs } — QA outage simulation (marked simulated)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      enabled?: boolean;
      secs?: number;
    };
    const fc = getFallbackConsole();
    switch (body.action) {
      case "probe": {
        const snapshot = await fc.forceTick();
        return NextResponse.json({ ok: true, snapshot });
      }
      case "drill": {
        const drill = await fc.drill();
        return NextResponse.json({ ok: true, drill });
      }
      case "simulate-outage": {
        const snapshot = await fc.setSimulation(body.enabled !== false, body.secs);
        return NextResponse.json({ ok: true, snapshot });
      }
      default:
        return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
