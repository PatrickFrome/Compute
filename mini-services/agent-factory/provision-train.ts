// Provision + train 4 console-owned agents via NEW_TAB + perception + SEMANTIC_TYPE.
import {
  batchIssue,
  issueCommand,
  readSupervisorState,
  selectTabAndWaitPerception,
  typeInto,
} from "../../src/lib/browser-tools";
import { buildBootstrap, TRAINING_ROLES } from "../../src/lib/agent-factory/bootstrap";
import fs from "node:fs";

const COMPOSER_RE = /how can i help you today|send a message|ask anything/i;
const MANIFEST = "/home/z/my-project/.a2/agent-factory-manifest.json";

interface AgentRec {
  role: string;
  agentId: string;
  tabId: string;
  conversationUrl?: string;
  trainedAt?: string;
  bootstrapVerified?: boolean;
}

const manifest: { agents: AgentRec[]; updatedAt: string } = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
  : { agents: [], updatedAt: "" };

console.log("== provisioning 4 console-owned agents (NEW_TAB, parallel batch)");
const urls = TRAINING_ROLES.map(() => ({ action: "NEW_TAB", payload: { url: "https://chat.z.ai/", select: false } }));
const opened = await batchIssue(urls, { waitMs: 40000 });
const newTabs: { role: string; tabId: string }[] = [];
for (let i = 0; i < opened.length; i++) {
  const r = opened[i];
  const tabId = String((r.result as { tab_id?: string } | null)?.tab_id ?? "");
  console.log(`- ${TRAINING_ROLES[i]}: ${r.status} tab=${tabId.slice(4, 12)} url=${(r.result as { url?: string } | null)?.url}`);
  if (r.ok && tabId) newTabs.push({ role: TRAINING_ROLES[i], tabId });
}

console.log(`\n== training ${newTabs.length} agents`);
const trained: AgentRec[] = [];
for (let i = 0; i < newTabs.length; i++) {
  const { role, tabId } = newTabs[i];
  const text = buildBootstrap(role, i);
  console.log(`\n-- ${role} @ ${tabId.slice(4, 12)} bootstrap=${text.length} chars`);
  await new Promise((r) => setTimeout(r, 2500));
  const r1 = await typeInto({ tabId, match: { name: COMPOSER_RE, role: "textbox" }, text, submitAfterType: true });
  console.log(`   type+submit: ${r1.status} ${r1.error ?? ""}`);
  let ok = r1.ok;
  if (!ok && r1.status === "NO_TARGET") {
    // retry once: perception may have needed another beat
    const r2 = await typeInto({ tabId, match: { name: COMPOSER_RE, role: "textbox" }, text, submitAfterType: true });
    console.log(`   retry: ${r2.status} ${r2.error ?? ""}`);
    ok = r2.ok;
  }
  trained.push({
    role,
    agentId: `mcagent_${tabId.slice(4, 12)}`,
    tabId,
    conversationUrl: (await readSupervisorState())?.tabs?.find((t) => t.tab_id === tabId)?.url,
    trainedAt: new Date().toISOString(),
    bootstrapVerified: ok,
  });
}

console.log("\n== parallel verification: READ_TRANSCRIPT x4");
const ver = await batchIssue(
  trained.map((a) => ({ action: "READ_TRANSCRIPT", payload: { tab_id: a.tabId } })),
  { waitMs: 40000 },
);
for (let i = 0; i < ver.length; i++) {
  const text = String((ver[i].result as { text?: string } | null)?.text ?? "");
  const seen = text.includes("BOOTSTRAP · AGENT FACTORY");
  console.log(`- ${trained[i].role}: ${ver[i].status} bootstrapSeen=${seen} len=${text.length}`);
  if (seen) trained[i].bootstrapVerified = true;
}

manifest.agents = trained;
manifest.updatedAt = new Date().toISOString();
fs.mkdirSync("/home/z/my-project/.a2", { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log("\nmanifest written:", MANIFEST);
console.log("TRAINING COMPLETE");
