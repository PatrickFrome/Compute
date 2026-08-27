import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "metaengine-h205f22-w1-authority-broker";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const EXPECTED = {
  repository: "PatrickFrome/Compute",
  repository_id: "1341371143",
  repository_owner_id: "20597814",
  ref: "refs/heads/main",
  workflow_ref: "PatrickFrome/Compute/.github/workflows/w1-aws-provider-reboot-proof.yml@refs/heads/main",
  environment: "w1-persistent-host-proof",
};
const ACTION = "W1_AWS_REBOOT_EXISTING_HOST";
const RECEIPT_TTL_MS = 90_000;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name}_unavailable`);
  return value;
}

async function rpc(fn: string, body: Record<string, unknown>) {
  const url = env("SUPABASE_URL");
  // The elevated database credential remains inside the hosted Edge Function.
  // GitHub Actions authenticates only with a short-lived GitHub OIDC token.
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error("w1_authority_broker_rpc_failed", fn, response.status, text.slice(0, 300));
    throw new Error(text.includes("a2_acceptance_oidc_replay_denied") ? "oidc_replay_denied" : "database_preflight_denied");
  }
  return text ? JSON.parse(text) : null;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

async function sha256Json(value: unknown) {
  const raw = JSON.stringify(stable(value));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parsePositiveInt(value: unknown, name: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name}_invalid`);
  return number;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "github_oidc_required" }, 401);

  try {
    const body = await req.json();
    if (!body || typeof body !== "object") throw new Error("request_body_invalid");
    const input = body as Record<string, unknown>;
    if (input.action !== ACTION) throw new Error("action_invalid");
    const claimId = parsePositiveInt(input.claim_id, "claim_id");
    const directiveId = parsePositiveInt(input.directive_id, "directive_id");
    const instanceId = String(input.instance_id ?? "");
    const workerId = String(input.worker_id ?? "");
    if (!/^i-[0-9a-f]+$/.test(instanceId)) throw new Error("instance_id_invalid");
    if (!/^[A-Za-z0-9._:-]{3,160}$/.test(workerId)) throw new Error("worker_id_invalid");

    const { payload, protectedHeader } = await jwtVerify(auth.slice(7), JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    if (protectedHeader.typ !== "JWT") throw new Error("oidc_typ_invalid");
    if (payload.repository !== EXPECTED.repository ||
        String(payload.repository_id ?? "") !== EXPECTED.repository_id ||
        String(payload.repository_owner_id ?? "") !== EXPECTED.repository_owner_id) {
      throw new Error("repository_forbidden");
    }
    if (payload.ref !== EXPECTED.ref || payload.workflow_ref !== EXPECTED.workflow_ref) throw new Error("workflow_forbidden");
    if (payload.environment !== EXPECTED.environment) throw new Error("environment_forbidden");
    if (payload.event_name !== "workflow_dispatch" || payload.runner_environment !== "github-hosted" || payload.repository_visibility !== "public") {
      throw new Error("event_forbidden");
    }

    const sha = String(payload.sha ?? "");
    const workflowSha = String(payload.workflow_sha ?? "");
    const runId = String(payload.run_id ?? "");
    const actorId = String(payload.actor_id ?? "");
    const attempt = Number(payload.run_attempt ?? 0);
    const jti = String(payload.jti ?? "");
    if (!/^[0-9a-f]{40}$/.test(sha) || workflowSha !== sha || !/^[0-9]+$/.test(runId) ||
        !/^[0-9]+$/.test(actorId) || !Number.isInteger(attempt) || attempt < 1 || jti.length < 8 || jti.length > 512 ||
        typeof payload.exp !== "number") {
      throw new Error("claims_invalid");
    }

    const consumed = await rpc("h205f22_a2_acceptance_consume_oidc_jti_v1", {
      p_oidc_jti: jti,
      p_repository_id: EXPECTED.repository_id,
      p_github_sha: sha,
      p_github_run_id: runId,
      p_github_run_attempt: attempt,
      p_actor_id: actorId,
      p_workflow_ref: EXPECTED.workflow_ref,
      p_ref: EXPECTED.ref,
    });

    const preflight = await rpc("h205f22_w1_effective_execution_preflight_v1", {
      p_claim_id: claimId,
      p_directive_id: directiveId,
    });
    if (preflight?.effective_execution_preflight_passed !== true || preflight?.outcome !== "PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY") {
      throw new Error("effective_execution_preflight_blocked");
    }
    if (preflight?.provider_mutation_authorized !== false || preflight?.authority_effect !== false || preflight?.canonical !== false) {
      throw new Error("preflight_semantics_invalid");
    }

    const observedMs = Date.parse(String(preflight?.evidence?.db_now ?? ""));
    const claimExpMs = Date.parse(String(preflight?.evidence?.claim?.expires_at ?? ""));
    const directiveExpMs = Date.parse(String(preflight?.evidence?.directive?.expires_at ?? ""));
    const oidcExpMs = payload.exp * 1000;
    if (![observedMs, claimExpMs, directiveExpMs, oidcExpMs].every(Number.isFinite)) throw new Error("expiry_invalid");
    const expiresMs = Math.min(observedMs + RECEIPT_TTL_MS, claimExpMs, directiveExpMs, oidcExpMs);
    if (expiresMs <= observedMs + 5_000) throw new Error("authority_window_too_short");

    const unsigned = {
      schema: "metaengine.compute.w1-provider-dispatch-authority-broker.h205f22.v1",
      outcome: "PASS_W1_PROVIDER_DISPATCH_AUTHORITY",
      dispatch_gate_passed: true,
      broker_mints_authority: false,
      canonical: false,
      authority_effect: false,
      broker_observed_at: iso(observedMs),
      receipt_expires_at: iso(expiresMs),
      oidc_expires_at: iso(oidcExpMs),
      oidc_jti_sha256: String(consumed?.oidc_jti_sha256 ?? ""),
      binding: {
        action: ACTION,
        repository: EXPECTED.repository,
        repository_id: EXPECTED.repository_id,
        github_sha: sha,
        github_run_id: runId,
        github_run_attempt: attempt,
        actor_id: actorId,
        workflow_ref: EXPECTED.workflow_ref,
        ref: EXPECTED.ref,
        environment: EXPECTED.environment,
        instance_id: instanceId,
        worker_id: workerId,
        claim_id: claimId,
        directive_id: directiveId,
      },
      effective_execution_preflight: preflight,
    };
    return reply({ ...unsigned, receipt_sha256: await sha256Json(unsigned) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error";
    console.error("w1_authority_broker_denied", detail);
    return reply({
      schema: "metaengine.compute.w1-provider-dispatch-authority-broker.h205f22.v1",
      outcome: "BLOCK_W1_PROVIDER_DISPATCH_AUTHORITY",
      dispatch_gate_passed: false,
      error: detail.includes("replay") ? "oidc_replay_denied" : "authority_broker_denied",
      canonical: false,
      authority_effect: false,
    }, 403);
  }
});
