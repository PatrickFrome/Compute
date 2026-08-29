import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import test from "node:test";

type ProbeOutput = {
  schema: string;
  agent: "GPT" | "GLM";
  requested_model: string;
  reported_model: string | null;
  ready: boolean;
  class: "READY" | "PERMANENT" | "TRANSIENT";
  code: string;
  canonical: false;
  authority_effect: false;
};

async function withGateway(
  status: number,
  body: unknown,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    request.resume();
    request.on("end", () => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function runProbe(
  baseUrl: string,
  agent: "GPT" | "GLM",
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; parsed: ProbeOutput }> {
  const requestedModel = agent === "GPT" ? "openai/gpt-5.6-sol" : "zai/glm-5.3";
  const provider = agent === "GPT" ? "openai" : "z.ai";
  const child = spawn(process.execPath, ["--import", "tsx", "src/a2_model_probe.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2_AGENT: agent,
      A2_PROVIDER: provider,
      A2_MODEL: requestedModel,
      A2_MODEL_URL: baseUrl,
      A2_MODEL_TOKEN: "test-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  assert.ok(line, `probe produced no JSON; stderr=${stderr}`);
  const parsed = JSON.parse(line) as ProbeOutput;
  return { ...outcome, stdout, stderr, parsed };
}

test("customer verification is a permanent provider failure", async () => {
  await withGateway(403, {
    error: {
      type: "customer_verification_required",
      message: "billing verification required",
    },
  }, async (url) => {
    const result = await runProbe(url, "GPT");
    assert.equal(result.code, 42);
    assert.equal(result.signal, null);
    assert.equal(result.parsed.ready, false);
    assert.equal(result.parsed.class, "PERMANENT");
    assert.equal(result.parsed.code, "CUSTOMER_VERIFICATION_REQUIRED");
    assert.equal(result.parsed.reported_model, null);
    assert.equal(result.parsed.canonical, false);
    assert.equal(result.parsed.authority_effect, false);
  });
});

test("rate limiting is transient and retryable", async () => {
  await withGateway(429, {
    error: { type: "rate_limit", message: "retry later" },
  }, async (url) => {
    const result = await runProbe(url, "GLM");
    assert.equal(result.code, 75);
    assert.equal(result.parsed.ready, false);
    assert.equal(result.parsed.class, "TRANSIENT");
    assert.equal(result.parsed.code, "RATE_LIMITED");
    assert.equal(result.parsed.canonical, false);
    assert.equal(result.parsed.authority_effect, false);
  });
});

test("exact reported model produces READY", async () => {
  await withGateway(200, {
    model: "openai/gpt-5.6-sol",
    choices: [{ message: { content: "{\"ready\":true}" } }],
  }, async (url) => {
    const result = await runProbe(url, "GPT");
    assert.equal(result.code, 0);
    assert.equal(result.parsed.ready, true);
    assert.equal(result.parsed.class, "READY");
    assert.equal(result.parsed.code, "OK");
    assert.equal(result.parsed.reported_model, "openai/gpt-5.6-sol");
    assert.equal(result.parsed.canonical, false);
    assert.equal(result.parsed.authority_effect, false);
  });
});
