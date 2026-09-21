// Poll fleet until it settles (expect 4 ACTIVE agents), then snapshot tabs.
import { readSupervisorState } from "../../src/lib/browser-tools";

for (let i = 0; i < 10; i++) {
  const s = await readSupervisorState();
  const agents = s?.fleet?.agents ?? [];
  const active = agents.filter((a) => a.lifecycle_state === "ACTIVE" || a.lifecycle_state === "BOUND_UNVERIFIED");
  console.log(
    `[${i}] tabs=${s?.tabs?.length} fleet=${agents.length} active-ish=${active.length} :: ${agents
      .filter((a) => a.lifecycle_state !== "LOST")
      .map((a) => `${a.role}:${a.lifecycle_state}:${a.tab_id?.slice(4, 12) ?? "-"}`)
      .join(" | ")}`,
  );
  if (active.length >= 4 && active.every((a) => a.lifecycle_state === "ACTIVE")) break;
  await new Promise((r) => setTimeout(r, 8000));
}
