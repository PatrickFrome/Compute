import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// Run separately from inference-policy.test.ts: each owns its isolated DB,
// module caches and a fetch guard. No live credentials or endpoints are used.
const root = mkdtempSync(join(tmpdir(), "metaengine-provider-transport-"));
process.env.ME2_DATA_DIR = join(root, "data");
process.env.ME2_CONTOUR_HOME = root;
process.env.ME2_REPO_ROOT = join(root, "repo");
process.env.ME2_CHAT_ROOT = join(root, "chats");
process.env.ME2_OPENAI_MODEL = "gpt-6.1-sol";
process.env.ME2_LLM_MIN_GAP_MS = "0";
process.env.OPENAI_API_KEY = "";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_JWT = "";
process.env.VERCEL_AI_GATEWAY_API_KEY = "";
for (const folder of [process.env.ME2_REPO_ROOT, process.env.ME2_CHAT_ROOT]) mkdirSync(folder, { recursive: true });
const originalFetch = globalThis.fetch;
type RequestRow = { url: string; method: string; body: Record<string, unknown>; redirect: unknown; authorization: string | null };
const requests: RequestRow[] = [];
let fixture: unknown = {};
let directFailure = false;
globalThis.fetch = (async (input, init = {}) => {
  const url = String(input);
  const method = String(init.method || "GET");
  const allowed = ["https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/responses", "https://ai.gateway.vercel.dev/v1/chat/completions"];
  if (!allowed.includes(url)) throw new Error("offline_transport_test_unexpected_destination");
  const body = init.body ? JSON.parse(String(init.body)) : {};
  requests.push({ url, method, body, redirect: init.redirect, authorization: new Headers(init.headers).get("authorization") });
  if (method === "HEAD") return new Response(null, { status: 200 });
  if (directFailure && url === allowed[0]) return new Response("test direct unavailable", { status: 401 });
  return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const store = await import("../store");
const providers = await import("../providers");
const tokens = await import("../src/tokens");
const policy = await import("../src/policy");
const review = await import("../src/review");
const governor = await import("../src/governor");
const chats = await import("../src/agentchat");
const quota = await import("../src/quota");
const active = "openai:gpt-6.1-sol";
const messages = [{ role: "user" as const, content: "fixture task" }];
const completed = (content: unknown = "fixture reply", finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content } }] });
const searchFixture = (summary = "Factual fixture answer: https://example.test/real") => ({
  status: "completed",
  output: [
    { type: "web_search_call", id: "ws_fixture", status: "completed", action: { type: "search", sources: [{ url: "https://example.test/real" }] } },
    { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: summary, annotations: [{ type: "url_citation", title: "Fixture source", url: "https://example.test/real" }] }] },
  ],
});

beforeEach(() => {
  requests.length = 0;
  fixture = completed();
  directFailure = false;
  tokens.tokenSet("OPENAI_API_KEY", "test-fixture-key", "T1", "test");
  tokens.tokenDelete("VERCEL_AI_GATEWAY_API_KEY");
  governor.governorTestReset();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  store.db.clearQueryCache();
  store.db.close();
  Bun.gc(true);
  const target = resolve(root);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("metaengine-provider-transport-")) throw new Error("unsafe_test_cleanup_target");
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test("real direct transport pins the OpenAI model and sends separate message contexts", async () => {
  const contexts = [{ role: "user" as const, content: "implementer fixture" }];
  expect(await providers.chat(active, contexts, { temperature: 0.4, lane: "P0" })).toBe("fixture reply");
  expect(await providers.chat("zai:default", messages, { lane: "P0" })).toBe("fixture reply");
  const calls = requests.filter(row => row.method === "POST");
  expect(calls.length).toBe(2);
  expect(calls.map(row => row.url)).toEqual(["https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/chat/completions"]);
  for (const call of calls) {
    expect(call.body.model).toBe("gpt-6.1-sol");
    expect(call.body.store).toBe(false);
    expect(call.redirect).toBe("error");
    expect(call.authorization).toBe("Bearer test-fixture-key");
    expect(call.body.temperature).toBeUndefined();
  }
  expect(calls[0].body.messages).toEqual(contexts);
  expect(calls[1].body.messages).toEqual(messages);
});

test("API credential rotation changes the actual request header; legacy tokens cannot substitute", async () => {
  expect(await providers.chat(active, messages, { lane: "P1" })).toBe("fixture reply");
  tokens.tokenSet("OPENAI_API_KEY", "rotated-fixture-key", "T1", "test");
  expect(await providers.chat(active, messages, { lane: "P1" })).toBe("fixture reply");
  expect(requests.map(row => row.authorization)).toEqual(["Bearer test-fixture-key", "Bearer rotated-fixture-key"]);
  tokens.tokenDelete("OPENAI_API_KEY");
  tokens.tokenSet("ZAI_API_KEY", "legacy-fixture-key", "T1", "test");
  const before = requests.length;
  await expect(providers.chat(active, messages, { lane: "P1" })).rejects.toThrow("openai_no_key");
  expect(requests.length).toBe(before);
});

for (const [label, value] of [
  ["missing choices", {}], ["empty choices", { choices: [] }],
  ["empty text", completed("")], ["whitespace", completed("  ")], ["non-text", completed({ text: "invented" })],
]) {
  test(`HTTP 200 with ${label} fails closed`, async () => {
    fixture = value;
    await expect(providers.chat(active, messages, { lane: "P0" })).rejects.toThrow(label.includes("choices") ? "openai_chat_response_choice_missing" : "openai_chat_response_empty");
    expect(requests.filter(row => row.method === "POST").length).toBe(1);
  });
}

test("truncated/refused model generations never become successful chat replies", async () => {
  for (const reason of ["length", "content_filter", "tool_calls"]) {
    fixture = completed("partial fixture answer", reason);
    await expect(providers.chat(active, messages, { lane: "P0" })).rejects.toThrow("openai_chat_response_not_completed");
  }
});

test("missing generation completion metadata cannot prove a completed reply", async () => {
  fixture = { choices: [{ message: { content: "unterminated fixture reply" } }] };
  await expect(providers.chat(active, messages, { lane: "P1" })).rejects.toThrow("openai_chat_response_not_completed:missing");
});

test("a historical empty cache entry cannot bypass response validation", async () => {
  const key = quota.quotaCacheKey(active, messages, 0);
  expect(quota.quotaCachePut(key, active, "")).toBe(true);
  await expect(providers.chat(active, messages, { lane: "P1", cache: true, temperature: 0 })).rejects.toThrow("inference_cached_empty_response");
  expect(requests.length).toBe(0);
});

test("an empty provider result cannot fabricate a successful agent turn", async () => {
  fixture = { choices: [] };
  const session = chats.agentChatCreate({ role: "IMPLEMENTER" });
  const result = await chats.agentChatTurn(session.id, "fixture task");
  expect(result.ok).toBe(false);
  expect(result.error).toContain("openai_chat_response_choice_missing");
  const after = chats.agentChatGet(session.id, 20)!;
  expect(after.session.turns_ok).toBe(0);
  expect(after.session.turns_fail).toBe(1);
});

test("gateway fallback still invokes the same OpenAI model and validates its response", async () => {
  tokens.tokenSet("VERCEL_AI_GATEWAY_API_KEY", "test-gateway-key", "T1", "test");
  directFailure = true;
  expect(await providers.chat(active, messages, { lane: "P0" })).toBe("fixture reply");
  const calls = requests.filter(row => row.method === "POST");
  expect(calls.map(row => row.url)).toEqual(["https://api.openai.com/v1/chat/completions", "https://ai.gateway.vercel.dev/v1/chat/completions"]);
  expect(calls[1].body.model).toBe("openai/gpt-6.1-sol");
  expect(calls[1].authorization).toBe("Bearer test-gateway-key");
  fixture = { choices: [] };
  await expect(providers.chat(active, messages, { lane: "P0" })).rejects.toThrow("gateway_chat_response_choice_missing");
});

test("classifier defaults and old bare zai policies normalize before active inference", async () => {
  expect(policy.normalizeClassifierModel("zai")).toBe(active);
  expect(review.classifierConfig().model).toBe(active);
  expect(review.classifierSetOverride({ model: "zai", llm_enabled: true, timeout_ms: 1000 }).model).toBe(active);
  fixture = completed(JSON.stringify({ verdict: "allow", reason: "fixture classified" }));
  const result = await review.classifyDry({ cmd: "git status", cwd: root, binaries: ["git"], segments: ["git status"] });
  expect(result.engine).toBe("llm");
  expect(result.verdict).toBe("allow");
  expect(result.model).toBe(active);
  expect(requests.filter(row => row.method === "POST")[0].body.model).toBe("gpt-6.1-sol");
  expect(() => review.classifierSetOverride({ model: "gateway:zai/glm-5.3" })).toThrow();
  expect(review.classifierConfig().model).toBe(active);
});

test("web search requires a completed call, completed assistant answer and cited sources", async () => {
  fixture = searchFixture("Supported https://example.test/real and invented https://invented.test/fake");
  const result = JSON.parse(await providers.webSearch("fixture research", { lane: "P0" }));
  expect(result.provider).toBe("OPENAI");
  expect(result.completed_search_calls).toEqual(["ws_fixture"]);
  expect(result.sources[0].url).toBe("https://example.test/real");
  expect(result.summary).toContain("https://example.test/real");
  expect(result.summary).not.toContain("https://invented.test/fake");
  expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
  expect(requests[0].body.tool_choice).toBe("required");
  expect(requests[0].body.include).toEqual(["web_search_call.action.sources"]);
});

for (const defect of ["incomplete response", "text only", "incomplete search", "incomplete assistant", "missing sources"]) {
  test(`web search rejects ${defect} evidence`, async () => {
    const row = searchFixture();
    if (defect === "incomplete response") row.status = "incomplete";
    if (defect === "text only") row.output = row.output.filter(item => item.type === "message");
    if (defect === "incomplete search") row.output[0].status = "in_progress";
    if (defect === "incomplete assistant") row.output[1].status = "in_progress";
    if (defect === "missing sources") { row.output[0].action!.sources = []; row.output[1].content![0].annotations = []; }
    fixture = row;
    await expect(providers.webSearch("fixture research", { lane: "P0" })).rejects.toThrow("openai_web_search_");
    expect(requests.filter(request => request.method === "POST").length).toBe(1);
  });
}
