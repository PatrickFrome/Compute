import type { AopLease, Env, JsonObject, ModelOutcome } from "./types";
import { pullRequest, pullRequestFiles, readFile, readFileAtRef, workflowRuns, writeFile } from "./github";
import { rpc, supervisorAdoptClaim, supervisorReturnAuthority } from "./supabase";

const MAX_TOOL_ROUNDS = 18;
const MAX_TRANSCRIPT_BYTES = 400_000;
const READ_ONLY_TOOL_NAMES = new Set([
  "github_read_file",
  "github_read_file_ref",
  "github_pull_request",
  "github_pull_request_files",
  "github_workflow_runs",
  "aop_snapshot",
]);
interface ToolCall { type: "function_call"; call_id: string; name: string; arguments: string; }

function aiConfigured(env: Env): boolean { return Boolean(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN && env.AOP_MODEL); }

export function executorReady(env: Env, lease: AopLease): { ready: boolean; reason?: string } {
  if (lease.role_kind === "SUPERVISOR" && lease.input?.reason === "AUTHORITY_REBIND_REQUIRED") {
    return env.AOP_SUPERVISOR_TOKEN ? { ready: true } : { ready: false, reason: "AOP_SUPERVISOR_TOKEN_MISSING" };
  }
  if (!aiConfigured(env)) return { ready: false, reason: "AI_EXECUTOR_NOT_CONFIGURED" };
  return { ready: true };
}

function responseUrl(env: Env): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/responses`;
}

function fn(name: string, description: string, parameters: Record<string, unknown>): Record<string, unknown> {
  return { type: "function", name, description, strict: true, parameters };
}

function toolsFor(env: Env, lease: AopLease): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [
    fn("github_read_file", "Read a file from the role-owned GitHub branch. Public-repository reads do not require a GitHub token.", { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false }),
    fn("github_read_file_ref", "Read a file from any explicit Git ref. Read-only; useful for independent PR audit.", { type: "object", properties: { path: { type: "string" }, ref: { type: "string" } }, required: ["path", "ref"], additionalProperties: false }),
    fn("github_pull_request", "Read pull-request metadata including head/base refs and SHAs.", { type: "object", properties: { number: { type: "integer" } }, required: ["number"], additionalProperties: false }),
    fn("github_pull_request_files", "Read changed files and patches for a pull request. Read-only; paginate up to 1000 files.", { type: "object", properties: { number: { type: "integer" } }, required: ["number"], additionalProperties: false }),
    fn("github_workflow_runs", "Read recent workflow runs for the role-owned branch.", { type: "object", properties: {}, additionalProperties: false }),
    fn("aop_snapshot", "Read the current AOP snapshot. Read-only.", { type: "object", properties: {}, additionalProperties: false }),
  ];
  if (lease.role_kind === "IMPLEMENTER" && env.GITHUB_TOKEN) {
    tools.push(fn("github_write_file", "Create or replace a UTF-8 file on the role-owned branch. Requires a dedicated GitHub runtime credential; main is forbidden.", { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"], additionalProperties: false }));
  }
  if (lease.role_kind === "SUPERVISOR") {
    tools.push(
      fn("supervisor_adopt_active_claim", "Rebind a legacy ACTIVE claim to the AOP implementer. Requires supervisor capability.", { type: "object", properties: {}, additionalProperties: false }),
      fn("supervisor_return_authority", "Return EVIDENCE_READY work for changes and issue a new AOP implementer claim. Requires supervisor capability.", { type: "object", properties: { instructions: { type: "object", additionalProperties: true } }, required: ["instructions"], additionalProperties: false }),
    );
  }
  return tools;
}

function systemInstructions(env: Env, lease: AopLease): string {
  const valid = lease.role_kind === "IMPLEMENTER" ? ["CONTINUE", "EVIDENCE_READY", "WAITING_EVENT", "FAILED"] : lease.role_kind === "ANALYST" ? ["ACCEPT", "ACCEPT_WITH_REBASE", "REQUEST_CHANGES", "HOLD", "REJECT"] : ["ACCEPT", "RETURN", "WAIT", "VERIFIED", "REJECT"];
  const writeCapability = lease.role_kind === "IMPLEMENTER"
    ? (env.GITHUB_TOKEN
      ? "GitHub write capability is available. Use github_write_file only on the role-owned branch and only for the required milestone changes."
      : "GitHub write capability is unavailable. Do not fail solely for that. Complete read-only analysis and return WAITING_EVENT with wake_condition=GITHUB_WRITE_EXECUTOR_AVAILABLE. output.mutation_plan MUST be an object with a changes array; each change must contain path, full UTF-8 content, and commit message. Include verification steps and research evidence. Do not claim proposed files were written or post-mutation tests ran.")
    : "";
  return [
    "You are an execution slot in METAENGINE H205F22 AOP1. The conversation is not state; the supplied lease is state.",
    "Supabase roadmap/claims/directives/checkpoints are authoritative. Never infer authority from GitHub or an auxiliary ledger.",
    `Role: ${lease.role_key} (${lease.role_kind}). Milestone: ${lease.milestone_key ?? "none"}.`,
    `Owned mutation domains: ${(lease.mutation_domains ?? []).join(", ") || "none"}.`,
    `Owned branch: ${lease.role_config?.branch ?? "none"}. Never write main.`,
    `Valid result_code values: ${valid.join(", ")}.`,
    writeCapability,
    "Implementer EVIDENCE_READY output MUST include object fields summary, evidence, research and must represent tests, negative tests, advisors where applicable, and deep research.",
    "Analyst is strictly read-only in GitHub tools and audits independently. For PR audit, inspect PR metadata, changed-file patches and exact head-ref files; REQUEST_CHANGES/HOLD/REJECT route through Supervisor and never grant authority directly.",
    "Supervisor must not claim VERIFIED until authoritative roadmap already says VERIFIED. Checkpoint seal and main merge are intentionally not exposed as tools in AOP1 v1.",
    "Distinguish LIVE, SYNTHETIC, CONTROL_PLANE_ONLY, SCHEMA_ONLY, EVIDENCE_READY, VERIFIED.",
    "Use tools as needed. Final answer MUST be JSON only with keys result_code, output, github_sha, wake_condition. output must be an object.",
  ].filter(Boolean).join("\n");
}

async function callAi(env: Env, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.CF_AI_TOKEN}`,
    "content-type": "application/json",
  };
  const gatewayId = env.AOP_AI_GATEWAY_ID || (env.AOP_MODEL?.startsWith("@cf/") ? "default" : "");
  if (gatewayId) headers["cf-aig-gateway-id"] = gatewayId;
  const res = await fetch(responseUrl(env), { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ai_gateway_failed:${res.status}:${text.slice(0, 1600)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function responseItems(response: Record<string, unknown>): Array<Record<string, unknown>> {
  const output = Array.isArray(response.output) ? response.output : [];
  return output.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x));
}

function toolCalls(response: Record<string, unknown>): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const x of responseItems(response)) {
    if (x.type === "function_call" && typeof x.call_id === "string" && typeof x.name === "string" && typeof x.arguments === "string") {
      calls.push({ type: "function_call", call_id: x.call_id, name: x.name, arguments: x.arguments });
    }
  }
  return calls;
}

function outputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;
  const texts: string[] = [];
  for (const r of responseItems(response)) {
    if (r.type !== "message" || !Array.isArray(r.content)) continue;
    for (const c of r.content as Array<Record<string, unknown>>) if (typeof c.text === "string") texts.push(c.text);
  }
  return texts.join("\n");
}

function canonicalReadOnlyToolName(lease: AopLease, name: string): string {
  if (READ_ONLY_TOOL_NAMES.has(name)) return name;
  if (lease.role_kind !== "ANALYST") return name;
  const match = /^([A-Za-z0-9_]+)<\|channel\|>(analysis|commentary|final)$/.exec(name);
  if (match && READ_ONLY_TOOL_NAMES.has(match[1])) return match[1];
  return name;
}

async function runTool(env: Env, lease: AopLease, workerId: string, call: ToolCall): Promise<unknown> {
  const parsed = JSON.parse(call.arguments || "{}");
  const args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const toolName = canonicalReadOnlyToolName(lease, call.name);
  switch (toolName) {
    case "github_read_file": return readFile(env, lease, String(args.path));
    case "github_read_file_ref": return readFileAtRef(env, String(args.path), String(args.ref));
    case "github_write_file":
      if (lease.role_kind !== "IMPLEMENTER") throw new Error("github_write_tool_forbidden_for_role");
      if (!env.GITHUB_TOKEN) throw new Error("github_token_required_for_mutation");
      return writeFile(env, lease, String(args.path), String(args.content), String(args.message));
    case "github_pull_request": return pullRequest(env, Number(args.number));
    case "github_pull_request_files": return pullRequestFiles(env, Number(args.number));
    case "github_workflow_runs": return workflowRuns(env, lease);
    case "aop_snapshot": return rpc<JsonObject>(env, "h205f22_aop1_snapshot_v1", {});
    case "supervisor_adopt_active_claim": if (lease.role_kind !== "SUPERVISOR") throw new Error("supervisor_tool_forbidden"); return supervisorAdoptClaim(env, lease, workerId);
    case "supervisor_return_authority": if (lease.role_kind !== "SUPERVISOR") throw new Error("supervisor_tool_forbidden"); return supervisorReturnAuthority(env, lease, workerId, (args.instructions ?? {}) as JsonObject);
    default: throw new Error(`unknown_tool:${call.name}`);
  }
}

function validateOutcome(lease: AopLease, value: unknown): ModelOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("model_outcome_not_object");
  const o = value as Record<string, unknown>;
  if (typeof o.result_code !== "string" || !o.output || typeof o.output !== "object" || Array.isArray(o.output)) throw new Error("model_outcome_shape_invalid");
  const allowed = lease.role_kind === "IMPLEMENTER" ? new Set(["CONTINUE", "EVIDENCE_READY", "WAITING_EVENT", "FAILED"]) : lease.role_kind === "ANALYST" ? new Set(["ACCEPT", "ACCEPT_WITH_REBASE", "REQUEST_CHANGES", "HOLD", "REJECT"]) : new Set(["ACCEPT", "RETURN", "WAIT", "VERIFIED", "REJECT"]);
  if (!allowed.has(o.result_code)) throw new Error(`model_result_not_allowed:${o.result_code}`);
  if (o.result_code === "EVIDENCE_READY") {
    const out = o.output as Record<string, unknown>;
    for (const k of ["summary", "evidence", "research"]) if (!out[k] || typeof out[k] !== "object" || Array.isArray(out[k])) throw new Error(`evidence_ready_missing_${k}`);
  }
  if (lease.role_kind === "IMPLEMENTER" && o.result_code === "WAITING_EVENT") {
    const out = o.output as Record<string, unknown>;
    if (!out.mutation_plan || typeof out.mutation_plan !== "object" || Array.isArray(out.mutation_plan)) throw new Error("waiting_event_requires_mutation_plan");
    if (typeof o.wake_condition !== "string" || !o.wake_condition) throw new Error("waiting_event_requires_wake_condition");
  }
  return { result_code: o.result_code as ModelOutcome["result_code"], output: o.output as JsonObject, github_sha: typeof o.github_sha === "string" ? o.github_sha : null, wake_condition: typeof o.wake_condition === "string" ? o.wake_condition : null };
}

export async function executeRole(env: Env, lease: AopLease, workerId: string): Promise<ModelOutcome> {
  if (lease.role_kind === "SUPERVISOR" && lease.input?.reason === "AUTHORITY_REBIND_REQUIRED") {
    const adoption = await supervisorAdoptClaim(env, lease, workerId);
    return { result_code: "RETURN", output: { automation: "AUTHORITY_REBIND_APPLIED", adoption, requested_by: lease.input ?? {} }, github_sha: lease.expected_github_sha ?? null, wake_condition: null };
  }

  const instructions = systemInstructions(env, lease);
  const tools = toolsFor(env, lease);
  const transcript: Array<Record<string, unknown>> = [
    { role: "user", content: [{ type: "input_text", text: JSON.stringify({ lease }) }] },
  ];
  let response = await callAi(env, { model: env.AOP_MODEL, instructions, input: transcript, tools, parallel_tool_calls: false, store: false });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = toolCalls(response);
    if (!calls.length) {
      const text = outputText(response).trim();
      if (!text) throw new Error("model_no_final_output");
      return validateOutcome(lease, JSON.parse(text));
    }

    const outputs: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      try {
        const result = await runTool(env, lease, workerId, call);
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true, result }) });
      } catch (error) {
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: false, error: String(error) }) });
      }
    }

    transcript.push(...responseItems(response), ...outputs);
    if (JSON.stringify(transcript).length > MAX_TRANSCRIPT_BYTES) throw new Error("model_transcript_limit_exceeded");
    response = await callAi(env, { model: env.AOP_MODEL, instructions, input: transcript, tools, parallel_tool_calls: false, store: false });
  }
  throw new Error("tool_round_limit_exceeded");
}
