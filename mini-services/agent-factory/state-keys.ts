// Dump supervisor state top-level keys + tab object shape + any semantic snapshots.
import { cloudLatestState } from "../../src/lib/cloud";

const st = await cloudLatestState();
const state = (st?.state ?? {}) as Record<string, unknown>;
console.log("STATE KEYS:", Object.keys(state).join(", "));
for (const k of Object.keys(state)) {
  const v = state[k];
  const s = JSON.stringify(v);
  console.log(`\n== ${k} (${typeof v}${s ? ", " + s.length + " chars" : ""}):`, s?.slice(0, 300));
}
