var REPO = "PatrickFrome/Compute";
var REPO_NAME = "Compute";
var API = "https://api.github.com";
var API_VERSION = "2026-03-10";
var W1_PREFLIGHT_WORKFLOW = "w1-aws-persistent-host-preflight.yml";
var W1_PREFLIGHT_REF = "main";
var W1_PREFLIGHT_CONFIRMATION = "PREFLIGHT_W1_PERSISTENT_HOST_ONLY";
function branchFor(lease) {
  const branch = lease.role_config?.branch;
  if (!branch) throw new Error("role_branch_missing");
  if (branch === "main") throw new Error("main_branch_write_forbidden");
  return branch;
}
__name(branchFor, "branchFor");
function safeRepoPath(path) {
  if (!path || path.startsWith("/") || path.includes("..")) throw new Error("invalid_repo_path");
  return encodeURIComponent(path).replaceAll("%2F", "/");
}
__name(safeRepoPath, "safeRepoPath");
function appIssuer(env) {
  return env.GITHUB_APP_CLIENT_ID || env.GITHUB_APP_ID;
}
__name(appIssuer, "appIssuer");
function anyAppCredential(env) {
  return Boolean(appIssuer(env) || env.GITHUB_APP_INSTALLATION_ID || env.GITHUB_APP_PRIVATE_KEY);
}
__name(anyAppCredential, "anyAppCredential");
function githubAppConfigured(env) {
  return Boolean(appIssuer(env) && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
}
__name(githubAppConfigured, "githubAppConfigured");
function githubWriteConfigured(env) {
  return Boolean(env.GITHUB_TOKEN || githubAppConfigured(env));
}
__name(githubWriteConfigured, "githubWriteConfigured");
function githubAuthMode(env) {
  if (githubAppConfigured(env)) return "app";
  if (env.GITHUB_TOKEN) return "token";
  return "none";
}
__name(githubAuthMode, "githubAuthMode");
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function jsonToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}
__name(jsonToBase64Url, "jsonToBase64Url");
function base64ToBytes(value) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64ToBytes, "base64ToBytes");
function derLength(length) {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error("invalid_der_length");
  if (length < 128) return new Uint8Array([length]);
  const out = [];
  let n = length;
  while (n > 0) {
    out.unshift(n & 255);
    n >>>= 8;
  }
  return new Uint8Array([128 | out.length, ...out]);
}
__name(derLength, "derLength");
function concatBytes(...parts) {
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
__name(concatBytes, "concatBytes");
function wrapPkcs1AsPkcs8(pkcs1) {
  const version = new Uint8Array([2, 1, 0]);
  const rsaAlgorithm = new Uint8Array([48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0]);
  const octet = concatBytes(new Uint8Array([4]), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithm, octet);
  return concatBytes(new Uint8Array([48]), derLength(body.length), body);
}
__name(wrapPkcs1AsPkcs8, "wrapPkcs1AsPkcs8");
function privateKeyDer(pem) {
  const normalized = pem.trim();
  const pkcs8 = /^-----BEGIN PRIVATE KEY-----([\s\S]+)-----END PRIVATE KEY-----$/.exec(normalized);
  if (pkcs8) return base64ToBytes(pkcs8[1]);
  const pkcs1 = /^-----BEGIN RSA PRIVATE KEY-----([\s\S]+)-----END RSA PRIVATE KEY-----$/.exec(normalized);
  if (pkcs1) return wrapPkcs1AsPkcs8(base64ToBytes(pkcs1[1]));
  throw new Error("github_app_private_key_pem_invalid");
}
__name(privateKeyDer, "privateKeyDer");
async function githubAppJwt(env) {
  const issuer = appIssuer(env);
  if (!issuer || !env.GITHUB_APP_PRIVATE_KEY) throw new Error("github_app_configuration_incomplete");
  const now = Math.floor(Date.now() / 1e3);
  const header = jsonToBase64Url({ alg: "RS256", typ: "JWT" });
  const payload = jsonToBase64Url({ iat: now - 60, exp: now + 540, iss: issuer });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)));
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}
__name(githubAppJwt, "githubAppJwt");
async function installationToken(env) {
  if (!githubAppConfigured(env)) throw new Error("github_app_configuration_incomplete");
  const jwt = await githubAppJwt(env);
  const installationId = env.GITHUB_APP_INSTALLATION_ID;
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      "x-github-api-version": API_VERSION,
      "user-agent": "metaengine-aop1"
    },
    body: JSON.stringify({ repositories: [REPO_NAME], permissions: { contents: "write", pull_requests: "read", actions: "write", metadata: "read" } })
  });
  if (!res.ok) throw new Error(`github_app_token_failed:${res.status}:${(await res.text()).slice(0, 500)}`);
  const body = await res.json();
  if (!body.token || !body.expires_at) throw new Error("github_app_token_response_invalid");
  return body.token;
}
__name(installationToken, "installationToken");
async function mutationToken(env) {
  if (githubAppConfigured(env)) return installationToken(env);
  if (anyAppCredential(env)) throw new Error("github_app_configuration_incomplete");
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  throw new Error("github_mutation_credential_missing");
}
__name(mutationToken, "mutationToken");
async function gh(env, path, init = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  const mutation = method !== "GET" && method !== "HEAD";
  const token = mutation ? await mutationToken(env) : env.GITHUB_TOKEN;
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      ...token ? { authorization: `Bearer ${token}` } : {},
      "x-github-api-version": API_VERSION,
      "user-agent": "metaengine-aop1",
      ...init.headers ?? {}
    }
  });
}
__name(gh, "gh");
async function readAt(env, path, ref) {
  if (!ref || ref.length > 200) throw new Error("invalid_git_ref");
  const res = await gh(env, `/repos/${REPO}/contents/${safeRepoPath(path)}?ref=${encodeURIComponent(ref)}`);
  if (!res.ok) throw new Error(`github_read_failed:${res.status}:${await res.text()}`);
  const body = await res.json();
  if (body.type !== "file") throw new Error("github_path_not_file");
  return { path, ref, sha: body.sha, content: body.content, encoding: body.encoding };
}
__name(readAt, "readAt");
async function readFile(env, lease, path) {
  return readAt(env, path, branchFor(lease));
}
__name(readFile, "readFile");
async function readFileAtRef(env, path, ref) {
  return readAt(env, path, ref);
}
__name(readFileAtRef, "readFileAtRef");
async function writeFile(env, lease, path, contentUtf8, message) {
  if (!githubWriteConfigured(env)) throw new Error("github_mutation_credential_missing");
  const branch = branchFor(lease);
  const encodedPath = safeRepoPath(path);
  let sha;
  const existing = await gh(env, `/repos/${REPO}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`);
  if (existing.ok) {
    const body2 = await existing.json();
    if (body2.type !== "file") throw new Error("github_path_not_file");
    sha = String(body2.sha);
  } else if (existing.status !== 404) {
    throw new Error(`github_lookup_failed:${existing.status}:${await existing.text()}`);
  }
  const bytes = new TextEncoder().encode(contentUtf8);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary);
  const res = await gh(env, `/repos/${REPO}/contents/${encodedPath}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, content: encoded, branch, ...sha ? { sha } : {} })
  });
  if (!res.ok) throw new Error(`github_write_failed:${res.status}:${await res.text()}`);
  const body = await res.json();
  return { path, branch, commit_sha: body.commit?.sha ?? null, blob_sha: body.content?.sha ?? null };
}
__name(writeFile, "writeFile");
async function pullRequest(env, number) {
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("invalid_pr_number");
  const res = await gh(env, `/repos/${REPO}/pulls/${number}`);
  if (!res.ok) throw new Error(`github_pr_failed:${res.status}:${await res.text()}`);
  const b = await res.json();
  return {
    number: b.number,
    state: b.state,
    draft: b.draft,
    merged: b.merged,
    mergeable: b.mergeable,
    head: b.head?.sha,
    head_ref: b.head?.ref,
    base: b.base?.sha,
    base_ref: b.base?.ref
  };
}
__name(pullRequest, "pullRequest");
async function pullRequestFiles(env, number) {
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("invalid_pr_number");
  const files = [];
  for (let page = 1; page <= 10; page++) {
    const res = await gh(env, `/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`github_pr_files_failed:${res.status}:${await res.text()}`);
    const batch = await res.json();
    for (const f of batch) files.push({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.changes, sha: f.sha, patch: typeof f.patch === "string" ? f.patch : null });
    if (batch.length < 100) break;
  }
  return { number, files, truncated: files.length >= 1e3 };
}
__name(pullRequestFiles, "pullRequestFiles");
async function workflowRuns(env, lease) {
  const branch = branchFor(lease);
  const res = await gh(env, `/repos/${REPO}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`);
  if (!res.ok) throw new Error(`github_runs_failed:${res.status}:${await res.text()}`);
  const body = await res.json();
  return {
    branch,
    runs: (body.workflow_runs ?? []).map((r) => ({ id: r.id, name: r.name, event: r.event, status: r.status, conclusion: r.conclusion, head_sha: r.head_sha, created_at: r.created_at, updated_at: r.updated_at }))
  };
}
__name(workflowRuns, "workflowRuns");
async function w1PreflightRunsRaw(env) {
  const res = await gh(env, `/repos/${REPO}/actions/workflows/${W1_PREFLIGHT_WORKFLOW}/runs?branch=${W1_PREFLIGHT_REF}&event=workflow_dispatch&per_page=20`);
  if (!res.ok) throw new Error(`github_w1_preflight_runs_failed:${res.status}:${await res.text()}`);
  const body = await res.json();
  return body.workflow_runs ?? [];
}
__name(w1PreflightRunsRaw, "w1PreflightRunsRaw");
async function w1PreflightRuns(env) {
  const runs = await w1PreflightRunsRaw(env);
  return {
    workflow: W1_PREFLIGHT_WORKFLOW,
    ref: W1_PREFLIGHT_REF,
    runs: runs.map((r) => ({
      id: r.id,
      name: r.name,
      event: r.event,
      status: r.status,
      conclusion: r.conclusion,
      head_sha: r.head_sha,
      created_at: r.created_at,
      updated_at: r.updated_at,
      html_url: r.html_url
    }))
  };
}
__name(w1PreflightRuns, "w1PreflightRuns");
async function dispatchW1Preflight(env) {
  if (!githubAppConfigured(env)) throw new Error("w1_preflight_github_app_required");
  const recent = await w1PreflightRunsRaw(env);
  const active = recent.find((r) => ["queued", "in_progress", "waiting", "pending", "requested"].includes(String(r.status)));
  if (active) {
    return {
      dispatched: false,
      reason: "W1_PREFLIGHT_ALREADY_ACTIVE",
      workflow: W1_PREFLIGHT_WORKFLOW,
      ref: W1_PREFLIGHT_REF,
      existing_run_id: active.id ?? null,
      existing_run_url: active.html_url ?? null
    };
  }
  const res = await gh(env, `/repos/${REPO}/actions/workflows/${W1_PREFLIGHT_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: W1_PREFLIGHT_REF, inputs: { confirmation: W1_PREFLIGHT_CONFIRMATION } })
  });
  if (!res.ok) throw new Error(`github_w1_preflight_dispatch_failed:${res.status}:${(await res.text()).slice(0, 1e3)}`);
  const body = await res.json();
  return {
    dispatched: true,
    workflow: W1_PREFLIGHT_WORKFLOW,
    ref: W1_PREFLIGHT_REF,
    workflow_run_id: body.workflow_run_id ?? null,
    run_url: body.run_url ?? null,
    html_url: body.html_url ?? null,
    authority_effect: false,
    real_reboot_requested: false,
    persistent_worker_proof: false,
    w1_verified: false
  };
}
__name(dispatchW1Preflight, "dispatchW1Preflight");
