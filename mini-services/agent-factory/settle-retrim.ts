// Settle → reconcile(4) → verify trim; report final fleet truthfully.
import { fleetReconcile, readSupervisorState } from "../../src/lib/browser-tools";

// wait for spawn settle (no BOUND_UNVERIFIED transitions for 2 polls)
let prev = "";
let stable = 0;
for (let i = 0; i < 14; i++) {
  const s = await readSupervisorState();
  const agents = s?.fleet?.agents ?? [];
  const sig = agents
    .filter((a) => a.lifecycle_state !== "LOST")
    .map((a) => `${a.role}:${a.lifecycle_state}`)
    .sort()
    .join(",");
  console.log(`[${i}] tabs=${s?.tabs?.length} live=${sig.split(",").filter(Boolean).length} ${sig.slice(0, 130)}`);
  if (sig === prev) stable++;
  else stable = 0;
  prev = sig;
  if (stable >= 2) break;
  await new Promise((r) => setTimeout(r, 7000));
}

const rec = await fleetReconcile(4);
console.log("\nreconcile(4):", rec.status);

for (let i = 0; i < 5; i++) {
  await new Promise((r) => setTimeout(r, 8000));
  const s = await readSupervisorState();
  const agents = (s?.fleet?.agents ?? []).filter((a) => a.lifecycle_state !== "LOST");
  console.log(`[${i}] tabs=${s?.tabs?.length} liveAgents=${agents.length} :: ${agents.map((a) => a.role).join(",")}`);
  if (agents.length <= 4) break;
}
