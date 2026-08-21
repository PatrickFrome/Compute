import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "metaengine-h205f22-aop1-deploy";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const EXPECTED = {
  repository: "PatrickFrome/Compute",
  repository_id: "1341371143",
  repository_owner_id: "20597814",
  ref: "refs/heads/work/aop1-autonomous-orchestration",
  sub: "repo:PatrickFrome/Compute:ref:refs/heads/work/aop1-autonomous-orchestration",
  workflow_ref: "PatrickFrome/Compute/.github/workflows/aop1-live-deploy.yml@refs/heads/work/aop1-autonomous-orchestration",
};

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

async function issueBundle(payload: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("supabase_internal_auth_unavailable");
  const res = await fetch(`${url}/rest/v1/rpc/h205f22_aop1_issue_deploy_bundle_v1`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_oidc_jti: String(payload.jti ?? ""),
      p_repository_id: String(payload.repository_id ?? ""),
      p_github_sha: String(payload.sha ?? ""),
      p_github_run_id: String(payload.run_id ?? ""),
      p_github_run_attempt: Number(payload.run_attempt ?? 0),
      p_actor_id: String(payload.actor_id ?? ""),
      p_workflow_ref: String(payload.workflow_ref ?? ""),
      p_ref: String(payload.ref ?? ""),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("oidc_exchange_replay_denied")) throw new Error("oidc_exchange_replay_denied");
    throw new Error(`deploy_bundle_issue_failed:${res.status}`);
  }
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "github_oidc_required" }, 401);
  try {
    const { payload, protectedHeader } = await jwtVerify(auth.slice(7), JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    if (protectedHeader.typ !== "JWT") throw new Error("oidc_typ_invalid");
    if (payload.repository !== EXPECTED.repository) throw new Error("repository_forbidden");
    if (String(payload.repository_id ?? "") !== EXPECTED.repository_id) throw new Error("repository_id_forbidden");
    if (String(payload.repository_owner_id ?? "") !== EXPECTED.repository_owner_id) throw new Error("repository_owner_id_forbidden");
    if (payload.ref !== EXPECTED.ref) throw new Error("ref_forbidden");
    if (payload.sub !== EXPECTED.sub) throw new Error("subject_forbidden");
    if (payload.workflow_ref !== EXPECTED.workflow_ref) throw new Error("workflow_ref_forbidden");
    if (payload.event_name !== "push") throw new Error("event_forbidden");
    if (payload.runner_environment !== "github-hosted") throw new Error("runner_environment_forbidden");
    if (payload.repository_visibility !== "public") throw new Error("visibility_forbidden");
    if (!/^[0-9a-f]{40}$/.test(String(payload.sha ?? ""))) throw new Error("sha_invalid");
    if (!/^[0-9]+$/.test(String(payload.run_id ?? ""))) throw new Error("run_id_invalid");
    if (!/^[0-9]+$/.test(String(payload.actor_id ?? ""))) throw new Error("actor_id_invalid");
    if (!Number.isInteger(Number(payload.run_attempt ?? 0)) || Number(payload.run_attempt) < 1) throw new Error("run_attempt_invalid");
    if (typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 512) throw new Error("jti_invalid");
    return reply(await issueBundle(payload as Record<string, unknown>));
  } catch (error) {
    const message = error instanceof Error ? error.message : "deploy_exchange_denied";
    return reply({ error: /^[a-z0-9_:-]{1,120}$/i.test(message) ? message : "deploy_exchange_denied" }, 403);
  }
});
