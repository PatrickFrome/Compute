// Wait for LOST transitions, then reconcile fleet to exactly 4 fresh agents.
import { fleetReconcile, readSupervisorState } from "../../src/lib/browser-tools";

const dump = (label: string) => {
  const st = readSupervisorState();
  return st.then((s) => {
    console.log(`\n== ${label} tabs=${s?.tabs?.length} fleet=${s?.fleet?.agents?.length}`);
    for (const a of s?.fleet?.agents ?? []) {
      console.log(`- ${a.role} ${a.agent_id?.slice(6, 14)} tab=${a.tab_id?.slice(4, 14) ?? "null"} ${a.lifecycle_state}${a.lost_reason ? " lost=" + a.lost_reason : ""}`);
    }
    return s;
  });
};

await dump("before reconcile");
const rec = await fleetReconcile(4);
console.log("\nreconcile(4):", rec.status, "receipt agents:", (rec.result as { agents?: unknown[] } | null)?.agents?.length ?? "?");

await new Promise((r) => setTimeout(r, 9000));
const s = await dump("after reconcile +9s");
console.log("\nurls:", (s?.tabs ?? []).map((t) => `${t.url.slice(0, 30)}#${t.tab_id.slice(4, 12)}`).join(" | "));
