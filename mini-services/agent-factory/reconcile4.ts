import { issue } from "./cloud-cmd.ts";
const r = await issue("FLEET_RECONCILE", { active: true, target_agents: 4 }, 120, 30000);
console.log("FLEET_RECONCILE:", r.status, JSON.stringify(r.result ?? {}).slice(0, 400), r.error ?? "");
