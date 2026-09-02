import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "metaengine-h205f22-devos-baseline-sync";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const REPO = "PatrickFrome/Compute";
const REPOSITORY_ID = "1341371143";
const OWNER_ID = "20597814";
const BRANCH = "integration/metaengine-development-os-v1";
const REF = `refs/heads/${BRANCH}`;
const SUBJECT = `repo:PatrickFrome@${OWNER_ID}/Compute@${REPOSITORY_ID}:ref:${REF}`;
const WORKFLOW_REF = `PatrickFrome/Compute/.github/workflows/metaengine-devos-baseline-push-sync.yml@${REF}`;
const SHA40 = /^[0-9a-f]{40}$/;

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers });
}

function boundedError(error: unknown) {
  return String((error as any)?.message || error || "unknown")
    .replace(/[^A-Za-z0-9_.:/-]+/g, "_")
    .slice(0, 240);
}

function internalAuth() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("supabase_internal_auth_unavailable");
  return { url, key };
}

async function callRpc(fn: string, body: Record<string, unknown>) {
  const { url, key } = internalAuth();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${fn}_failed:${response.status}:${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : null;
}

async function readAuthority() {
  return await callRpc("devos_roadmap_baseline_sync_read_v1", {});
}

async function githubCompare(expected: string, candidate: string) {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/compare/${expected}...${candidate}?_=${Date.now()}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "metaengine-devos-baseline-push-sync-h205f22",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`github_${response.status}:${String((payload as any)?.message || "unknown").slice(0, 180)}`);
  return payload as Record<string, any>;
}

async function commitAdvance(expected: string, candidate: string, compare: Record<string, any>, payload: Record<string, any>) {
  const commits = Array.isArray(compare.commits) ? compare.commits : [];
  const mergeBase = String(compare?.merge_base_commit?.sha || "").toLowerCase();
  const baseSha = String(compare?.base_commit?.sha || "").toLowerCase();
  const headSha = String(commits.at(-1)?.sha || "").toLowerCase();
  const status = String(compare?.status || "");
  if (status !== "ahead" || mergeBase !== expected || baseSha !== expected || headSha !== candidate) {
    return reply(409, {
      schema: "metaengine.devos.baseline-push-sync-observation.v1",
      advanced: false,
      reason: "NON_FAST_FORWARD_OR_UNPROVEN",
      baseline_sha: expected,
      candidate_sha: candidate,
      compare_status: status,
      merge_base_sha: mergeBase || null,
      base_sha: baseSha || null,
      head_sha: headSha || null,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  const observedAt = new Date().toISOString();
  const proof = {
    schema: "metaengine.devos.github-baseline-proof.v1",
    source_repo: REPO,
    source_branch: BRANCH,
    base_sha: expected,
    merge_base_sha: mergeBase,
    branch_head_sha: candidate,
    head_sha: headSha,
    compare_status: status,
    observed_at: observedAt,
    proof_source: "GITHUB_OIDC_PUSH_SHA_PLUS_COMPARE_V1",
    github_run_id: String(payload.run_id || ""),
    github_run_attempt: Number(payload.run_attempt || 0),
    github_actor_id: String(payload.actor_id || ""),
    github_oidc_jti: String(payload.jti || "").slice(0, 512),
    caller_candidate_ignored: true,
    authority_effect: false,
  };
  const result = await callRpc("devos_roadmap_baseline_sync_commit_v1", {
    p_expected_base: expected,
    p_next_base: candidate,
    p_github_proof: proof,
  });
  return reply(200, {
    schema: "metaengine.devos.baseline-push-sync-observation.v1",
    ...(result && typeof result === "object" ? result : {}),
    candidate_source: "VERIFIED_GITHUB_OIDC_SHA",
    polling_fallback_preserved: true,
    caller_candidate_ignored: true,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed", authority_effect: false });
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply(401, { error: "github_oidc_required", authority_effect: false });
  try {
    const { payload, protectedHeader } = await jwtVerify(auth.slice(7), JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    if (protectedHeader.typ !== "JWT") throw new Error("oidc_typ_invalid");
    if (payload.repository !== REPO) throw new Error("repository_forbidden");
    if (String(payload.repository_id || "") !== REPOSITORY_ID) throw new Error("repository_id_forbidden");
    if (String(payload.repository_owner_id || "") !== OWNER_ID) throw new Error("repository_owner_id_forbidden");
    if (payload.ref !== REF) throw new Error("ref_forbidden");
    if (payload.sub !== SUBJECT) throw new Error("subject_forbidden");
    if (payload.workflow_ref !== WORKFLOW_REF) throw new Error("workflow_ref_forbidden");
    if (payload.event_name !== "push") throw new Error("event_forbidden");
    if (payload.runner_environment !== "github-hosted") throw new Error("runner_environment_forbidden");
    if (payload.repository_visibility !== "public") throw new Error("visibility_forbidden");
    const candidate = String(payload.sha || "").toLowerCase();
    if (!SHA40.test(candidate)) throw new Error("sha_invalid");
    if (!/^[0-9]+$/.test(String(payload.run_id || ""))) throw new Error("run_id_invalid");
    if (!Number.isInteger(Number(payload.run_attempt || 0)) || Number(payload.run_attempt) < 1) throw new Error("run_attempt_invalid");
    if (!/^[0-9]+$/.test(String(payload.actor_id || ""))) throw new Error("actor_id_invalid");
    if (typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 512) throw new Error("jti_invalid");

    const authority = await readAuthority();
    const expected = String(authority?.baseline_sha || "").toLowerCase();
    if (authority?.source_repo !== REPO || authority?.source_branch !== BRANCH || !SHA40.test(expected)) {
      throw new Error("roadmap_authority_readback_invalid");
    }
    if (candidate === expected) {
      return reply(200, {
        schema: "metaengine.devos.baseline-push-sync-observation.v1",
        advanced: false,
        reason: "ALREADY_CURRENT",
        baseline_sha: expected,
        candidate_sha: candidate,
        candidate_source: "VERIFIED_GITHUB_OIDC_SHA",
        polling_fallback_preserved: true,
        caller_candidate_ignored: true,
        authority_effect: false,
      });
    }

    const compare = await githubCompare(expected, candidate);
    return await commitAdvance(expected, candidate, compare, payload as Record<string, any>);
  } catch (error) {
    const reason = boundedError(error);
    console.error("devos_baseline_push_sync_failure", reason);
    return reply(403, {
      schema: "metaengine.devos.baseline-push-sync-observation.v1",
      advanced: false,
      reason: "OIDC_OR_FAST_FORWARD_PROOF_REJECTED",
      diagnostic: reason,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
});
