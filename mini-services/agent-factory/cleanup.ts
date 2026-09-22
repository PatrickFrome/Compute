// Cleanup: trim fleet to 4 agents, close all extra tabs (keep 4 agent tabs + rollover supervisor).
import { closeExtraTabs, fleetReconcile, readSupervisorState } from "../../src/lib/browser-tools";

const ROLLOVER_TAB = "tab_1bf77894-e092-4936-a381-f50b463ebeec";

console.log("=== 1) FLEET_RECONCILE target_agents=4");
const rec = await fleetReconcile(4);
console.log("reconcile:", rec.status, JSON.stringify(rec.result)?.slice(0, 400));

await new Promise((r) => setTimeout(r, 3000));
const st = await readSupervisorState();
const agents = st?.fleet?.agents ?? [];
console.log("\n=== fleet after reconcile:", agents.length);
for (const a of agents) console.log(`- ${a.role} ${a.agent_id.slice(0, 18)} tab=${a.tab_id}`);

const keep = [...new Set([...agents.map((a) => a.tab_id), ROLLOVER_TAB])];
console.log("\n=== keep tabs:", keep.length);
const before = st?.tabs?.length ?? 0;
console.log("tabs before close:", before);

const closed = await closeExtraTabs({ keepTabIds: keep });
console.log("closed:", closed.closed, "of", toCloseCount(before, keep.length));

await new Promise((r) => setTimeout(r, 2500));
const st2 = await readSupervisorState();
console.log("\n=== tabs after:", st2?.tabs?.length);
for (const t of st2?.tabs ?? []) console.log(`- ${t.url.slice(0, 44)} ${t.tab_id.slice(4, 14)}${t.selected ? " *" : ""}`);

function toCloseCount(before: number, keep: number) {
  return Math.max(0, before - keep);
}
