// Retire 6 fleet agents explicitly, keep PLANNER/RESEARCHER/IMPLEMENTER/CRITIC.
import { fleetReconcile, readSupervisorState } from "../../src/lib/browser-tools";

const st = await readSupervisorState();
const agents = st?.fleet?.agents ?? [];
const KEEP_ROLES = new Set(["PLANNER", "RESEARCHER", "IMPLEMENTER", "CRITIC"]);
const seen = new Set<string>();
const keep: string[] = [];
const retire: string[] = [];
for (const a of agents) {
  if (KEEP_ROLES.has(a.role) && !seen.has(a.role)) {
    seen.add(a.role);
    keep.push(a.agent_id);
  } else retire.push(a.agent_id);
}
console.log("keep:", keep.map((id, i) => `${agents.find((a) => a.agent_id === id)?.role}:${id.slice(6, 14)}`).join(", "));
console.log("retire:", retire.length);

const rec = await fleetReconcile(4, retire);
console.log("reconcile:", rec.status, "result agents:", (rec.result as { agents?: unknown[] } | null)?.agents?.length ?? "?");

await new Promise((r) => setTimeout(r, 4000));
const st2 = await readSupervisorState();
console.log("\nfleet now:", st2?.fleet?.agents?.length);
for (const a of st2?.fleet?.agents ?? []) console.log(`- ${a.role} ${a.agent_id.slice(6, 14)} tab=${a.tab_id.slice(4, 14)} ${a.lifecycle_state}`);
console.log("\ntabs now:", st2?.tabs?.length);
for (const t of st2?.tabs ?? []) console.log(`- ${t.url.slice(0, 40)} ${t.tab_id.slice(4, 14)}`);
