// Full perception dump + fleet agents.
import { cloudLatestState } from "../../src/lib/cloud";

const st = await cloudLatestState();
const state = (st?.state ?? {}) as Record<string, unknown>;
console.log("PERCEPTION:", JSON.stringify(state.perception, null, 1));
const fleet = state.fleet as { agents?: { role: string; agent_id: string; tab_id: string; lifecycle_state: string }[] } | null;
console.log("\nFLEET AGENTS:", fleet?.agents?.length);
for (const a of fleet?.agents ?? []) {
  console.log(`- ${a.role} ${a.agent_id.slice(0, 16)} tab=${a.tab_id.slice(4, 14)} ${a.lifecycle_state}`);
}
