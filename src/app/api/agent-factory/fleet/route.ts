import {
  readSupervisorState,
  type FleetAgent,
  type TabInfo,
} from "@/lib/browser-tools";
import { redactedInventory } from "@/lib/agent-factory/bootstrap";
import fs from "node:fs";

export const dynamic = "force-dynamic";

const MANIFEST = "/home/z/my-project/.a2/agent-factory-manifest.json";

interface ManifestAgent {
  role: string;
  agentId: string;
  tabId: string;
  conversationUrl?: string;
  trainedAt?: string;
  bootstrapVerified?: boolean;
}

function readManifest(): { agents: ManifestAgent[]; updatedAt: string } {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return { agents: [], updatedAt: "" };
  }
}

export async function GET() {
  try {
    const st = await readSupervisorState();
    const tabs = (st?.tabs ?? []) as TabInfo[];
    const fleet = (st?.fleet?.agents ?? []) as FleetAgent[];
    const live = fleet.filter((a) => a.lifecycle_state !== "LOST");
    const lifecycle = (st?.supervisor_lifecycle ?? {}) as Record<string, unknown>;
    const keepalive = (lifecycle.keepalive ?? {}) as Record<string, unknown>;
    const devosRuntime = (lifecycle.devos_runtime ?? {}) as Record<string, unknown>;
    const manifest = readManifest();

    return Response.json({
      ok: true,
      heartbeat: {
        lastSeenAt: st?.last_seen_at ?? null,
        armed: st?.armed ?? null,
        supervisorMode: st?.supervisor_mode ?? null,
        shellVersion: st?.shell_version ?? null,
        keepaliveState: keepalive.state ?? null,
        keepaliveCycleSeq: keepalive.cycle_seq ?? null,
        idleError: (devosRuntime.idle as { last_error?: string } | null)?.last_error ?? null,
        commandLeasePrecedesIdleWork:
          (devosRuntime.idle as { command_lease_precedes_idle_work?: boolean } | null)
            ?.command_lease_precedes_idle_work ?? null,
      },
      tabs,
      fleetAgents: fleet,
      fleetLive: live.length,
      perception: {
        tabId: st?.perception?.tab_id ?? null,
        url: st?.perception?.url ?? null,
        capturedAt: st?.perception?.captured_at ?? null,
        semanticTargetCount: st?.perception?.semantic_target_count ?? null,
        textExcerpt: (st?.perception?.text_excerpt ?? "").slice(0, 400),
      },
      manifest,
      secrets: redactedInventory(),
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
