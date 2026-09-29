// Retire by closing their tabs; then confirm fleet settles at 4.
import { batchIssue, fleetReconcile, readSupervisorState } from "../../src/lib/browser-tools";

const KEEP = new Set(["agent_4a7d8556", "agent_8028dbe0", "agent_167e1b74", "agent_488ca713"]);
const ROLLOVER_TAB = "tab_1bf77894-e092-4936-a381-f50b463ebeec";

const st = await readSupervisorState();
const agents = st?.fleet?.agents ?? [];
const retireTabs = agents.filter((a) => !KEEP.has(a.agent_id.slice(0, 12))).map((a) => a.tab_id);
console.log("retiring tabs:", retireTabs.length, retireTabs.map((t) => t.slice(4, 14)).join(", "));

if (retireTabs.length) {
  const res = await batchIssue(
    retireTabs.map((tab_id) => ({ action: "CLOSE_TAB", payload: { tab_id } })),
    { waitMs: 25000 },
  );
  console.log("closed:", res.filter((r) => r.ok).length, "/", res.length);
}

await new Promise((r) => setTimeout(r, 6000));
const st2 = await readSupervisorState();
console.log("\nfleet now:", st2?.fleet?.agents?.length);
for (const a of st2?.fleet?.agents ?? []) {
  console.log(`- ${a.role} ${a.agent_id.slice(6, 14)} tab=${a.tab_id.slice(4, 14)} ${a.lifecycle_state}${a.lost_reason ? " lost=" + a.lost_reason : ""}`);
}
console.log("\ntabs now:", st2?.tabs?.length);
for (const t of st2?.tabs ?? []) console.log(`- ${t.url.slice(0, 40)} ${t.tab_id.slice(4, 14)}`);

// confirm fleet target 4
const rec = await fleetReconcile(4);
console.log("\nreconcile(4):", rec.status, "agents in receipt:", (rec.result as { agents?: unknown[] } | null)?.agents?.length ?? "?");
