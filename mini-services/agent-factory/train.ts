// Train the 4 live fleet agents: inject role bootstrap via SEMANTIC_TYPE, verify via transcript.
import {
  batchIssue,
  readSupervisorState,
  selectTabAndWaitPerception,
  typeInto,
} from "../../src/lib/browser-tools";
import { buildBootstrap } from "../../src/lib/agent-factory/bootstrap";

const COMPOSER_RE = /how can i help you today|send a message|ask anything/i;

const st = await readSupervisorState();
const agents = (st?.fleet?.agents ?? []).filter((a) => a.lifecycle_state !== "LOST" && a.tab_id);
console.log("live agents:", agents.length, agents.map((a) => a.role).join(","));

// pick first occurrence of each distinct role, up to 4 training targets
const picked: { role: string; tabId: string; agentId: string }[] = [];
const seen = new Set<string>();
for (const a of agents) {
  if (picked.length >= 4) break;
  if (seen.has(a.role)) continue;
  seen.add(a.role);
  picked.push({ role: a.role, tabId: a.tab_id, agentId: a.agent_id });
}
console.log("training targets:", picked.map((p) => `${p.role}@${p.tabId.slice(4, 12)}`).join(", "));

const results: { role: string; tabId: string; typeStatus: string; submitHint: string }[] = [];
for (let i = 0; i < picked.length; i++) {
  const p = picked[i];
  const text = buildBootstrap(p.role, i);
  console.log(`\n== training ${p.role} @ ${p.tabId.slice(4, 12)} (bootstrap ${text.length} chars)`);
  // first attempt: submit_after_type
  let r = await typeInto({
    tabId: p.tabId,
    match: { name: COMPOSER_RE, role: "textbox" },
    text,
    replaceExisting: true,
    submitAfterType: true,
  });
  if (!r.ok) {
    // fallback: non-submit type, then Enter via composer focus
    console.log(`   submit_after_type -> ${r.status} (${r.error ?? ""}); retry without submit`);
    r = await typeInto({
      tabId: p.tabId,
      match: { name: COMPOSER_RE, role: "textbox" },
      text,
      replaceExisting: true,
      submitAfterType: false,
    });
  }
  console.log(`   type result: ${r.status} ${r.error ?? ""} url=${r.perceptionUrl?.slice(0, 40)}`);
  results.push({ role: p.role, tabId: p.tabId, typeStatus: r.status, submitHint: r.error ?? "" });
  await new Promise((res) => setTimeout(res, 2500));
}

// parallel verification: READ_TRANSCRIPT on all trained tabs at once (READ_ONLY lanes)
console.log("\n== parallel transcript verification (batch READ_TRANSCRIPT x4)");
const batch = await batchIssue(
  picked.map((p) => ({ action: "READ_TRANSCRIPT", payload: { tab_id: p.tabId } })),
  { waitMs: 30000 },
);
for (let i = 0; i < batch.length; i++) {
  const b = batch[i];
  const text = String((b.result as { text?: string } | null)?.text ?? "");
  const hasBootstrap = text.includes("BOOTSTRAP · AGENT FACTORY");
  const hasRole = text.toUpperCase().includes(picked[i].role);
  console.log(`- ${picked[i].role}: ${b.status} bootstrapInTranscript=${hasBootstrap} roleVisible=${hasRole} textLen=${text.length}`);
}
console.log("\nTRAINING DONE");
