import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const root = mkdtempSync(join(tmpdir(), "metaengine-openai-policy-"));
process.env.ME2_DATA_DIR = join(root, "data");
process.env.ME2_CONTOUR_HOME = root;
process.env.ME2_REPO_ROOT = join(root, "repo");
process.env.ME2_CHAT_ROOT = join(root, "chats");
process.env.ME2_OPENAI_MODEL = "gpt-6.1-sol";
process.env.ME2_BROWSER_PROBE_AGENTCHAT_DISABLED = "false";
for (const folder of [process.env.ME2_REPO_ROOT, process.env.ME2_CHAT_ROOT]) mkdirSync(folder, { recursive: true });
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = (async () => { requests++; throw new Error("offline_policy_test_network_forbidden"); }) as typeof fetch;

const store = await import("../store");
const policy = await import("../src/inference");
const providers = await import("../providers");
const tokens = await import("../src/tokens");
// Restore an old session table before the real schema migration runs.
store.db.exec(`CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE', state TEXT NOT NULL DEFAULT 'IDLE',
  summary TEXT NOT NULL DEFAULT '', compactions INTEGER NOT NULL DEFAULT 0,
  turns_ok INTEGER NOT NULL DEFAULT 0, turns_fail INTEGER NOT NULL DEFAULT 0,
  fail_streak INTEGER NOT NULL DEFAULT 0, last_error TEXT, model TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO agent_sessions(id,agent_id,status,model,created_at,updated_at) VALUES
 ('ac_legacy_closed','ag_legacy','CLOSED','zai:glm-5.3','old','old'),
 ('ac_openai_restored','ag_legacy','ACTIVE','openai:gpt-6.1-sol','old','old'),
 ('ac_gateway_restored','ag_legacy','ACTIVE','gateway:openai/gpt-6-luna','old','old');`);
const chats = await import("../src/agentchat");
const commands = await import("../commands");
const { EVAL_DATASET } = await import("../src/eval");

afterAll(() => {
  globalThis.fetch = originalFetch;
  store.db.clearQueryCache();
  store.db.close();
  Bun.gc(true);
  const target = resolve(root);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("metaengine-openai-policy-")) throw new Error("unsafe_test_cleanup_target");
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test("legacy model hints converge to OpenAI; non-OpenAI models cannot be written", () => {
  for (const legacy of ["zai:default", "zai:zai:glm-5.3", "glm-eval-stub"]) {
    expect(policy.normalizeActiveAgentModelTag(legacy)).toBe("openai:gpt-6.1-sol");
  }
  expect(policy.normalizeActiveAgentModelTag("gateway:openai/gpt-6.1-sol")).toBe("openai:gpt-6.1-sol");
  expect(() => policy.normalizeActiveAgentModelTag("gateway:zai/glm-5.3")).toThrow();
  expect(() => store.createAgent("CRITIC", "zai:glm-5.3")).toThrow("inference_provider_not_allowed");
  const agent = store.createAgent("CRITIC", policy.activeAgentModelTag());
  expect(agent.provider).toBe("OPENAI");
  expect(agent.platform).toBe("CHATGPT");
  expect(() => store.setAgentModel(agent.id, "zai:default")).toThrow("inference_provider_not_allowed");
});

test("command bus normalizes spawn and model changes before durable rows and events", async () => {
  const spawn = store.enqueueCommand({ action: "AGENT_SPAWN", payload: { role: "RESEARCHER", model: "zai:default" } });
  expect(spawn.ok).toBe(true);
  const spawned = await commands.runOne(spawn.command!);
  expect(spawned.status).toBe("COMPLETED");
  const agent = store.listAgents().find((row) => row.role === "RESEARCHER")!;
  expect(agent.model).toBe(policy.activeAgentModelTag());
  const change = store.enqueueCommand({ action: "AGENT_MODEL", payload: { id: agent.id, model: "zai:glm-5.3" } });
  expect(change.ok).toBe(true);
  const changed = await commands.runOne(change.command!);
  expect(changed.status).toBe("COMPLETED");
  expect(store.getAgent(agent.id)?.provider).toBe("OPENAI");
  const created = store.tailEvents(0, 100).filter((row) => row.type === "AGENT_CREATED");
  expect(created.every((row) => JSON.parse(row.data || "{}").model.startsWith("openai:"))).toBe(true);
});

test("role sessions retain separate IDs, agents and message contexts on OpenAI", () => {
  const implementer = chats.agentChatCreate({ role: "IMPLEMENTER", model: "zai:default" });
  const critic = chats.agentChatCreate({ role: "CRITIC" });
  expect(implementer.id).not.toBe(critic.id);
  expect(implementer.agent_id).not.toBe(critic.agent_id);
  for (const session of [implementer, critic]) {
    expect(session.provider).toBe("OPENAI");
    expect(session.platform).toBe("CHATGPT");
    expect(session.model).toBe(policy.activeAgentModelTag());
  }
  chats.chatAppend(implementer.id, "user", "IMPLEMENTER_PRIVATE_CONTEXT");
  chats.chatAppend(critic.id, "user", "CRITIC_PRIVATE_CONTEXT");
  const contextA = JSON.stringify(chats.buildChatContext(implementer, "IMPLEMENTER"));
  const contextB = JSON.stringify(chats.buildChatContext(critic, "CRITIC"));
  expect(contextA).toContain("IMPLEMENTER_PRIVATE_CONTEXT");
  expect(contextA).not.toContain("CRITIC_PRIVATE_CONTEXT");
  expect(contextB).toContain("CRITIC_PRIVATE_CONTEXT");
  expect(contextB).not.toContain("IMPLEMENTER_PRIVATE_CONTEXT");
});

test("restored active sessions acquire provider metadata without rewriting closed GLM history", () => {
  const closed = chats.agentChatGet("ac_legacy_closed")!.session;
  expect(closed.model).toBe("zai:glm-5.3");
  expect(closed.provider).toBeNull();
  expect(closed.updated_at).toBe("old");
  const openai = chats.agentChatGet("ac_openai_restored")!.session;
  const gateway = chats.agentChatGet("ac_gateway_restored")!.session;
  expect(openai.provider).toBe("OPENAI");
  expect(gateway.platform).toBe("CHATGPT");
  expect(gateway.model).toBe("openai:gpt-6-luna");
});

test("gateway failover never changes provider model or admits ZAI, including old tags", () => {
  expect(tokens.tokenSet("VERCEL_AI_GATEWAY_API_KEY", "offline-fixture-only", "T1", "test").ok).toBe(true);
  for (const model of [policy.activeAgentModelTag(), "zai:default", "gateway:openai/gpt-6.1-sol"]) {
    const chain = providers.providerChain(model, true);
    expect(chain.every((choice) => ["openai", "gateway"].includes(choice.provider) && choice.modelId === "gpt-6.1-sol")).toBe(true);
    expect(providers.providerChain(model, false).map((choice) => choice.provider)).toEqual(["openai"]);
  }
  tokens.tokenDelete("VERCEL_AI_GATEWAY_API_KEY");
});

test("registry migration preserves historical evidence while adding current provider metadata", () => {
  const now = new Date().toISOString();
  store.db.query("INSERT INTO agents(id,role,status,model,paused,created_at,updated_at) VALUES(?,?,'IDLE',?,0,?,?)")
    .run("ag_legacy_fixture", "RESEARCHER", "zai:glm-5.3", now, now);
  const event = store.emit("LEGACY_MODEL_EVIDENCE", { model: "zai:glm-5.3", platform: "GLM_ZAI" }, "ag_legacy_fixture", null);
  const before = JSON.stringify(store.db.query("SELECT * FROM events WHERE seq=?").get(event.seq));
  policy.migrateAgentsToActiveInference();
  const migrated = store.getAgent("ag_legacy_fixture")!;
  expect(migrated.model).toBe(policy.activeAgentModelTag());
  expect(migrated.provider).toBe("OPENAI");
  expect(JSON.stringify(store.db.query("SELECT * FROM events WHERE seq=?").get(event.seq))).toBe(before);
});

for (const id of ["glm.currency", "inference.openai", "pool.executors", "agentchat.objective", "llm.failover_chain"]) {
  test(`the real offline daemon eval contract passes: ${id}`, () => {
    const check = EVAL_DATASET.find((row) => row.id === id)!;
    expect(check).toBeDefined();
    expect(check.run().ok).toBe(true);
  });
}

test("policy and session qualification never contact an inference or cloud endpoint", () => {
  expect(requests).toBe(0);
});
