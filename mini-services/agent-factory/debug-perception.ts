// Debug perception refresh after SELECT_TAB.
import { issueCommand, readSupervisorState } from "../../src/lib/browser-tools";

const st = await readSupervisorState();
const agents = (st?.fleet?.agents ?? []).filter((a) => a.lifecycle_state !== "LOST" && a.tab_id);
const target = agents[0];
console.log("target:", target?.role, target?.tab_id);

const sel = await issueCommand({ action: "SELECT_TAB", payload: { tab_id: target.tab_id }, waitMs: 9000 });
console.log("select:", sel.status, JSON.stringify(sel.result));

for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const s = await readSupervisorState();
  const at = s?.active_tab as { tab_id?: string; url?: string } | null | undefined;
  const p = s?.perception;
  console.log(
    `[${i}] active=${at?.tab_id?.slice(4, 12)} perc=${p?.tab_id?.slice(4, 12)} captured=${p?.captured_at?.slice(11, 19)} targets=${p?.semantic_target_count} url=${p?.url?.slice(0, 30)}`,
  );
  if (p?.tab_id === target.tab_id) {
    console.log("PERCEPTION MATCHED");
    console.log("text:", p?.text_excerpt?.slice(0, 160)?.replace(/\n/g, " | "));
    break;
  }
}
