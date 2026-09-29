import { issue } from "./cloud-cmd.ts";
const r1 = await issue("FLEET_RECONCILE", { active: false, target_agents: 0 }, 120, 30000);
console.log("FLEET_RECONCILE(0):", r1.status, JSON.stringify(r1.result ?? {}).slice(0, 250), r1.error ?? "");
const r2 = await issue("FLEET_SET_PROFILE", { profile: "BALANCED", desired_agents: 0, elastic: false }, 120, 25000);
console.log("FLEET_SET_PROFILE(0):", r2.status, JSON.stringify(r2.result ?? {}).slice(0, 250), r2.error ?? "");
