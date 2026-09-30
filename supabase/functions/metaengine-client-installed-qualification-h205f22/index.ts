import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "metaengine-client-installed-qualification";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

const REPO = "PatrickFrome/Compute";
const REPOSITORY_ID = "1341371143";
const OWNER_ID = "20597814";
const WORKFLOW_PATH = ".github/workflows/browser-windows-installed-chat-qualification.yml";
const WORKFLOW_REF_PREFIX = `${REPO}/${WORKFLOW_PATH}@`;
const SUBJECT = `repo:${REPO}:pull_request`;
const SHA40 = /^[0-9a-f]{40}$/;

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");

function serverSecretKey() {
  const modern = String(Deno.env.get("SUPABASE_SECRET_KEYS") || "").trim();
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      const value = String(parsed?.default || "").trim();
      if (value) return value;
    } catch {
      // Fall through to the legacy service-role key.
    }
  }
  return String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
}

const SERVICE_KEY = serverSecretKey();
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";

const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function boundedError(error: unknown) {
  return String((error as any)?.message || error || "unknown")
    .replace(/[^A-Za-z0-9_.:/-]+/g, "_")
    .slice(0, 240);
}

function serviceHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    accept: "application/json",
    ...extra,
  };
  if (SERVICE_KEY.split(".").length === 3) headers.authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

async function rest(path: string) {
  if (!REST_BASE || !SERVICE_KEY) throw new Error("supabase_server_identity_missing");
  if (!String(path || "").startsWith("/")) throw new Error("postgrest_path_invalid");
  const response = await fetch(`${REST_BASE}${path}`, {
    method: "GET",
    headers: serviceHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`postgrest_http_${response.status}:${text.slice(0, 180)}`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("postgrest_json_invalid");
  }
}

async function rpc(name: string, args: Record<string, unknown>) {
  if (!REST_BASE || !SERVICE_KEY) throw new Error("supabase_server_identity_missing");
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error("rpc_name_invalid");
  const response = await fetch(`${REST_BASE}/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: serviceHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`postgrest_http_${response.status}:${text.slice(0, 180)}`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("postgrest_json_invalid");
  }
}

async function exactNonceEnrollmentRows({
  runId,
  runAttempt,
  sourceHead,
  qualificationNonceSha256,
}: {
  runId: string;
  runAttempt: number;
  sourceHead: string;
  qualificationNonceSha256: string;
}) {
  const now = new Date();
  const minRequestedAt = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const params = new URLSearchParams();
  params.set("status", "in.(PENDING,APPROVED)");
  params.set("expires_at", `gt.${now.toISOString()}`);
  params.set("requested_at", `gte.${minRequestedAt}`);
  params.set("metadata->>qualification_kind", "eq.INSTALLED_ELECTRON");
  params.set("metadata->>client_kind", "eq.METAENGINE_BROWSER_ELECTRON_NATIVE");
  params.set("metadata->>qualification_run_id", `eq.${runId}`);
  params.set("metadata->>qualification_run_attempt", `eq.${runAttempt}`);
  params.set("metadata->>source_head", `eq.${sourceHead}`);
  params.set("metadata->>qualification_nonce_sha256", `eq.${qualificationNonceSha256}`);
  params.set("select", "request_id,client_id,status,requested_at,expires_at");
  params.set("order", "requested_at.desc");
  params.set("limit", "2");
  const rows = await rest(`/compute_fabric_a2_browser_device_enrollment_request_h205f22?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

async function githubRun(runId: string) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${runId}?_=${Date.now()}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "metaengine-client-installed-qualification-h205f22",
      "cache-control": "no-cache",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`github_run_http_${response.status}:${String((payload as any)?.message || "unknown").slice(0, 160)}`);
  }
  return payload as Record<string, any>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return reply(405, { error: "method_not_allowed", authority_effect: false });
  }

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return reply(401, { error: "github_oidc_required", authority_effect: false });
  }

  try {
    const { payload, protectedHeader } = await jwtVerify(authorization.slice(7), JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });

    if (protectedHeader.typ !== "JWT") throw new Error("oidc_typ_invalid");
    if (payload.repository !== REPO) throw new Error("repository_forbidden");
    if (String(payload.repository_id || "") !== REPOSITORY_ID) throw new Error("repository_id_forbidden");
    if (String(payload.repository_owner_id || "") !== OWNER_ID) throw new Error("repository_owner_id_forbidden");
    if (payload.event_name !== "pull_request") throw new Error("event_forbidden");
    if (payload.runner_environment !== "github-hosted") throw new Error("runner_environment_forbidden");
    if (payload.sub !== SUBJECT) throw new Error("subject_forbidden");
    if (!String(payload.workflow_ref || "").startsWith(WORKFLOW_REF_PREFIX)) {
      throw new Error("workflow_ref_forbidden");
    }
    if (!/^[0-9]+$/.test(String(payload.run_id || ""))) throw new Error("run_id_invalid");
    if (!Number.isInteger(Number(payload.run_attempt || 0)) || Number(payload.run_attempt) < 1) {
      throw new Error("run_attempt_invalid");
    }
    if (typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 512) {
      throw new Error("jti_invalid");
    }

    const body = await req.json().catch(() => ({}));
    const sourceHead = String((body as any)?.source_head || "").trim().toLowerCase();
    const qualificationNonceSha256 = String((body as any)?.qualification_nonce_sha256 || "").trim().toLowerCase();
    if (!SHA40.test(sourceHead)) throw new Error("source_head_invalid");
    if (!/^[0-9a-f]{64}$/.test(qualificationNonceSha256)) throw new Error("qualification_nonce_sha256_invalid");

    const runId = String(payload.run_id);
    const runAttempt = Number(payload.run_attempt);
    const run = await githubRun(runId);

    if (String(run?.repository?.full_name || "") !== REPO) throw new Error("run_repository_invalid");
    if (String(run?.path || "") !== WORKFLOW_PATH) throw new Error("run_workflow_path_invalid");
    if (String(run?.event || "") !== "pull_request") throw new Error("run_event_invalid");
    if (String(run?.head_sha || "").toLowerCase() !== sourceHead) throw new Error("run_head_sha_invalid");
    if (Number(run?.run_attempt || 0) !== runAttempt) throw new Error("run_attempt_drift");
    if (!["queued", "in_progress", "completed"].includes(String(run?.status || ""))) {
      throw new Error("run_status_invalid");
    }
    const exactPr = Array.isArray(run?.pull_requests)
      && run.pull_requests.some((row: any) => String(row?.head?.sha || "").toLowerCase() === sourceHead);
    if (!exactPr) throw new Error("run_pr_head_binding_missing");

    // Nonce preflight is performed in the OIDC verifier itself so the live
    // qualification path remains fail-closed even while the optional V2 SQL
    // nonce migration is not yet applied. The already-live V1 approval RPC
    // independently rejects an ambiguous run tuple (>1 matching request).
    const exactRows = await exactNonceEnrollmentRows({
      runId,
      runAttempt,
      sourceHead,
      qualificationNonceSha256,
    });
    if (exactRows.length === 0) {
      return reply(202, {
        schema: "metaengine.client-v1.installed-qualification-oidc.v1",
        accepted: false,
        reason: "WAITING_FOR_EXACT_ENROLLMENT_REQUEST",
        run_id: runId,
        run_attempt: runAttempt,
        source_head: sourceHead,
        nonce_bound: true,
        oidc_verified: true,
        github_run_verified: true,
        master_secret_exposed: false,
        automatic_retry_allowed: true,
        retry_scope: "READ_MATCH_AND_APPROVE_EXACT_ENROLLMENT_ONLY",
        authority_effect: false,
      });
    }
    if (exactRows.length !== 1) throw new Error("qualification_nonce_request_ambiguous");

    const approval = await rpc("client_v1_installed_qualification_approve_v1", {
      p_run_id: runId,
      p_run_attempt: runAttempt,
      p_source_head: sourceHead,
    });

    if (approval?.accepted === true) {
      return reply(200, {
        schema: "metaengine.client-v1.installed-qualification-oidc.v1",
        accepted: true,
        reason: approval.reason,
        request_id: approval.request_id,
        client_id: approval.client_id,
        run_id: runId,
        run_attempt: runAttempt,
        source_head: sourceHead,
        qualification_kind: "INSTALLED_ELECTRON",
        nonce_bound: true,
        oidc_verified: true,
        github_run_verified: true,
        master_secret_exposed: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }

    return reply(409, {
      schema: "metaengine.client-v1.installed-qualification-oidc.v1",
      accepted: false,
      reason: String(approval?.reason || "QUALIFICATION_APPROVAL_REJECTED").slice(0, 120),
      oidc_verified: true,
      github_run_verified: true,
      master_secret_exposed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  } catch (error) {
    const diagnostic = boundedError(error);
    console.error("installed_qualification_oidc_failure", diagnostic);
    return reply(403, {
      schema: "metaengine.client-v1.installed-qualification-oidc.v1",
      accepted: false,
      reason: "OIDC_OR_RUN_BINDING_REJECTED",
      diagnostic,
      master_secret_exposed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
});
