import { issue } from "./cloud-cmd.ts";
const r = await issue("PROBE_FAKE_ACTION_XY", { test: true }, 60, 6000);
console.log("fake action result:", r.status, (r.error ?? JSON.stringify(r.result ?? "")).slice(0, 200));
