type Agent = "GPT" | "GLM";

type ProbeClass = "READY" | "PERMANENT" | "TRANSIENT";

type ProbeResult = {
  schema: "metaengine.compute.a2-model-readiness.v1";
  agent: Agent;
  provider: string;
  requested_model: string;
  ready: boolean;
  class: ProbeClass;
  code: string;
  reported_model: string | null;
  canonical: false;
  authority_effect: false;
};

const AGENT = required("A2_AGENT").toUpperCase() as Agent;
if (AGENT !== "GPT" && AGENT !== "GLM") throw new Error("A2_AGENT_invalid");
const MODEL_URL = required("A2_MODEL_URL").replace(/\/$/, "");
const MODEL_TOKEN = process.env.A2_MODEL_TOKEN || "";
const EXPECTED_MODEL = AGENT === "GPT" ? "openai/gpt-5.6-sol" : "zai/glm-5.3";
const MODEL = process.env.A2_MODEL || EXPECTED_MODEL;
if (MODEL !== EXPECTED_MODEL) throw new Error(`exact_model_required:${EXPECTED_MODEL}`);
const PROVIDER = process.env.A2_PROVIDER || (AGENT === "GPT" ? "openai" : "z.ai");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function result(ready: boolean, klass: ProbeClass, code: string, reportedModel: string | null): ProbeResult {
  return {
    schema: "metaengine.compute.a2-model-readiness.v1",
    agent: AGENT,
    provider: PROVIDER,
    requested_model: MODEL,
    ready,
    class: klass,
    code,
    reported_model: reportedModel,
    canonical: false,
    authority_effect: false,
  };
}

function classify(status: number, body: string): { klass: Exclude<ProbeClass, "READY">; code: string } {
  const lower = body.toLowerCase();
  if (status === 401) return { klass: "PERMANENT", code: "AUTHENTICATION_REQUIRED" };
  if (status === 402) return { klass: "PERMANENT", code: "BILLING_REQUIRED" };
  if (status === 403 && lower.includes("customer_verification_required")) return { klass: "PERMANENT", code: "CUSTOMER_VERIFICATION_REQUIRED" };
  if (status === 403) return { klass: "PERMANENT", code: "AUTHORIZATION_REQUIRED" };
  if (status === 404) return { klass: "PERMANENT", code: "EXACT_MODEL_ROUTE_MISSING" };
  if (status === 429) return { klass: "TRANSIENT", code: "RATE_LIMITED" };
  if (status >= 500) return { klass: "TRANSIENT", code: "UPSTREAM_UNAVAILABLE" };
  return { klass: "TRANSIENT", code: `HTTP_${status}` };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("probe_timeout"), 20_000);
  try {
    const response = await fetch(`${MODEL_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(MODEL_TOKEN ? { authorization: `Bearer ${MODEL_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 16,
        messages: [
          { role: "system", content: "Return a minimal JSON object only." },
          { role: "user", content: "Return exactly {\"ready\":true}." },
        ],
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      const failure = classify(response.status, body.slice(0, 2000));
      console.log(JSON.stringify(result(false, failure.klass, failure.code, null)));
      process.exitCode = failure.klass === "PERMANENT" ? 42 : 75;
      return;
    }
    let parsed: any;
    try { parsed = JSON.parse(body); } catch {
      console.log(JSON.stringify(result(false, "TRANSIENT", "RESPONSE_JSON_INVALID", null)));
      process.exitCode = 75;
      return;
    }
    const reported = typeof parsed?.model === "string" ? parsed.model : null;
    if (reported !== MODEL) {
      console.log(JSON.stringify(result(false, "PERMANENT", "EXACT_MODEL_REPORT_MISMATCH", reported)));
      process.exitCode = 42;
      return;
    }
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      console.log(JSON.stringify(result(false, "TRANSIENT", "MODEL_CONTENT_MISSING", reported)));
      process.exitCode = 75;
      return;
    }
    console.log(JSON.stringify(result(true, "READY", "OK", reported)));
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
    console.log(JSON.stringify(result(false, "TRANSIENT", aborted ? "PROBE_TIMEOUT" : "NETWORK_ERROR", null)));
    process.exitCode = 75;
  } finally {
    clearTimeout(timeout);
  }
}

void main();
