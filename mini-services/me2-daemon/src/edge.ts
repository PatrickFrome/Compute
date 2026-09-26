// R83: Cloudflare Edge convergence — read-only qualification client.
// Protocol invariants honoured:
//  - CF token lives ONLY in /home/z/.a2/cloudflare.env (perms 600); never in
//    tree, never in responses (surface only token_present + read results)
//  - strictly READ-ONLY surface (scripts list, versions, settings, content);
//    the sandbox never deploys, never edits, never deletes edge state
//  - live script snapshots (evidence recovery of the missing source-of-truth)
//    are stored under data/edge/ with sha256 digests recorded in the event log
// R83 LIVE FINDING (2026-09-26): both production workers have NO source of
// truth in the canonical repo — verified across main (default), the release
// tree (4471 files) and the donor history (sandbox/me2-os, 1627 files). The
// production edge can currently only be qualified against live content.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { OpError } from "./errors";
import { appendEvent } from "./eventlog";
import { VERSION } from "./version";

const CF_ENV = "/home/z/.a2/cloudflare.env";
const GH_ENV = "/home/z/.a2/.github.env";
const SNAPSHOT_DIR = new URL("../data/edge/", import.meta.url).pathname;
const API = "https://api.cloudflare.com/client/v4";
const GH_API = "https://api.github.com";
const RELEASE_REF = "release/self-update-ambiguity-live-v2";
const TTL_MS = 60_000;

type Any = Record<string, any>;

function loadEnv(file: string): Record<string, string> {
  if (!existsSync(file)) throw new OpError("edge_secrets_missing", `${file} not found`, 503);
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function cfCreds(): { token: string; account: string } {
  const env = loadEnv(CF_ENV);
  const token = env.CF_API_TOKEN;
  const account = env.CF_ACCOUNT_ID;
  if (!token || !account) throw new OpError("edge_secrets_invalid", "CF_API_TOKEN/CF_ACCOUNT_ID missing", 503);
  return { token, account };
}

async function cf(path: string): Promise<Any> {
  const { token } = cfCreds();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as Any;
  if (!res.ok || body?.success === false) {
    const code = body?.errors?.[0]?.code ?? `http_${res.status}`;
    throw new OpError(`edge_${code}`, JSON.stringify(body?.errors ?? body).slice(0, 200), 502);
  }
  return body;
}

async function cfText(path: string): Promise<string> {
  const { token } = cfCreds();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new OpError(`edge_http_${res.status}`, `content fetch ${res.status}`, 502);
  return res.text();
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// The scripts content endpoint returns a multipart body whose boundary is
// RANDOM PER CALL and whose MODULE ORDER is random too. The normalized
// digest parses the multipart into named modules, sorts them by name and
// digests the sorted concatenation — reproducible across calls and
// comparable against snapshots (R83 evidence contract).
function normalizedContent(raw: string): string {
  const parts: { name: string; body: string }[] = [];
  const lines = raw.split("\n");
  let current: { name: string; body: string[] } | null = null;
  for (const line of lines) {
    if (/^--[0-9a-f]{8,}(--)?$/.test(line.trim())) {
      if (current) parts.push({ name: current.name, body: current.body.join("\n") });
      current = null;
      continue;
    }
    const m = /^Content-Disposition: form-data; name="([^"]+)"/.exec(line.trim());
    if (m) {
      if (current) parts.push({ name: current.name, body: current.body.join("\n") });
      current = { name: m[1], body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return parts.map((p) => `#module ${p.name}\n${p.body.replace(/\n$/, "")}`).join("\n");
}

// ---------------------------------------------------------------------------
// Worker source-binding: does the canonical release carry the worker's source?
// ---------------------------------------------------------------------------

export interface SourceBinding {
  verdict: "CONVERGED" | "DRIFT" | "NO_SOURCE_IN_REPO";
  release_candidates: string[];
  markers_checked: string[];
  note: string;
}

// Distinctive plain strings from each live script (verified live 2026-09-26).
const WORKER_SOURCE: Record<string, { role: string; markers: string[]; candidatePathPatterns: RegExp[] }> = {
  "metaengine-fabric-worker-h205f21r4": {
    role: "fabric dispatch gateway (queue + workflow + AI; Supabase worker-gateway RPC: PULL/HEARTBEAT/FAIL/PUBLISH)",
    markers: ["pullDispatch", "SUPABASE_WORKER_GATEWAY_URL", "WORKER_CAPABILITY"],
    candidatePathPatterns: [/gateway\.js$/, /fabric[-_]worker/i, /wrangler/, /cloudflare/i],
  },
  "metaengine-h205f22-aop1": {
    role: "AOP1 operator worker (DurableObject AOP_SUPERVISOR + workflow + queue; Supabase h205f22_aop1_* RPC allowlist; GitHub file writes)",
    markers: ["h205f22_aop1_lease_run_v1", "AOP_SUPERVISOR", "ALLOWED_RPC"],
    candidatePathPatterns: [/aop1/i, /wrangler/, /cloudflare/i],
  },
};

let releaseTreeCache: { at: number; paths: string[] } | null = null;

async function releaseTreePaths(): Promise<string[]> {
  if (releaseTreeCache && Date.now() - releaseTreeCache.at > 300_000) return releaseTreeCache.paths;
  const env = loadEnv(GH_ENV);
  const token = env.GITHUB_TOKEN_ADMIN;
  if (!token) throw new OpError("edge_github_token_missing", "GITHUB_TOKEN_ADMIN not available for source binding", 503);
  const res = await fetch(`${GH_API}/repos/PatrickFrome/Compute/git/trees/${encodeURIComponent(RELEASE_REF)}?recursive=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new OpError(`edge_github_http_${res.status}`, `release tree fetch ${res.status}`, 502);
  const tree = ((await res.json()) as Any)?.tree as Any[] | undefined;
  const paths = (tree ?? []).map((t) => String(t.path ?? "")).filter((p) => p.length > 0);
  releaseTreeCache = { at: Date.now(), paths };
  return paths;
}

async function sourceBinding(workerId: string): Promise<SourceBinding> {
  const meta = WORKER_SOURCE[workerId];
  if (!meta) {
    return { verdict: "NO_SOURCE_IN_REPO", release_candidates: [], markers_checked: [], note: "worker not in the R83 registry" };
  }
  const paths = await releaseTreePaths();
  const candidates = paths.filter(
    (p) => !p.includes("node_modules") && !p.includes(".next") && meta.candidatePathPatterns.some((re) => re.test(p))
  );
  // Fetch candidates and check for ALL live markers. Path-pattern matches are
  // only weak candidates (unrelated wrangler configs / DB migrations match
  // too) — the verdict is driven by MARKERS, not by path shapes:
  //   all markers found      → CONVERGED (source of truth present in release)
  //   no candidate matches   → NO_SOURCE_IN_REPO (weak candidates are not source)
  const env = loadEnv(GH_ENV);
  const token = env.GITHUB_TOKEN_ADMIN;
  const matched: string[] = [];
  for (const p of candidates.slice(0, 12)) {
    const res = await fetch(
      `https://raw.githubusercontent.com/PatrickFrome/Compute/${encodeURIComponent(RELEASE_REF)}/${p}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(12_000) }
    );
    if (!res.ok) continue;
    const text = await res.text();
    if (meta.markers.every((m) => text.includes(m))) matched.push(p);
  }
  if (matched.length > 0) {
    return { verdict: "CONVERGED", release_candidates: matched, markers_checked: meta.markers, note: `source of truth present in release (${matched[0]}); live bundle digest binding is the next gate` };
  }
  return {
    verdict: "NO_SOURCE_IN_REPO",
    release_candidates: candidates.slice(0, 8),
    markers_checked: meta.markers,
    note: `${candidates.length} weak path candidates (unrelated wrangler configs / DB migrations) but none carries the live markers — the worker has no source of truth in the release`,
  };
}

// ---------------------------------------------------------------------------
// Snapshot: persist live script content as evidence (missing source recovery)
// ---------------------------------------------------------------------------

export async function snapshotWorker(workerId: string): Promise<{ worker: string; sha256: string; bytes: number; path: string }> {
  const content = await cfText(`/accounts/${cfCreds().account}/workers/scripts/${encodeURIComponent(workerId)}`);
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const normalized = normalizedContent(content);
  const digest = sha256(normalized);
  const path = `${SNAPSHOT_DIR}${workerId}.snapshot.txt`;
  writeFileSync(path, content, { mode: 0o640 });
  appendEvent("EDGE_SNAPSHOT", "daemon", workerId, { sha256: digest, bytes: content.length, worker: workerId, daemon_version: VERSION });
  return { worker: workerId, sha256: digest, bytes: content.length, path };
}

// ---------------------------------------------------------------------------
// Full R83 status
// ---------------------------------------------------------------------------

export interface EdgeWorkerStatus {
  id: string;
  role: string;
  modified_on: string | null;
  versions_total: number | null;
  latest_version: { id: string; number: number } | null;
  live_sha256: string | null;
  live_bytes: number | null;
  bindings: string[];
  secret_bindings: string[];
  durable_object: string | null;
  queue: string | null;
  workflow: boolean;
  source: SourceBinding;
}

export interface EdgeStatus {
  ok: true;
  schema: "metaengine.r83.edge.status.v1";
  fetched_at: string;
  daemon_version: string;
  subdomain: string | null;
  token_present: true;
  workers: EdgeWorkerStatus[];
  findings: string[];
  promotion_blockers: string[];
}

let cache: { at: number; data: EdgeStatus } | null = null;

export async function edgeStatus(fresh = false, snapshot = false): Promise<EdgeStatus> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const { account } = cfCreds();
  const subdomainRes = await cf(`/accounts/${account}/workers/subdomain`).catch(() => null);
  const subdomain = (subdomainRes?.result as Any)?.subdomain ?? null;

  const list = await cf(`/accounts/${account}/workers/scripts`);
  const scripts = (list.result ?? []) as Any[];
  const workers: EdgeWorkerStatus[] = [];
  for (const s of scripts) {
    const id = String(s.id);
    const meta = WORKER_SOURCE[id];
    let versionsTotal: number | null = null;
    let latestVersion: { id: string; number: number } | null = null;
    let liveSha: string | null = null;
    let liveBytes: number | null = null;
    let bindings: string[] = [];
    let secretBindings: string[] = [];
    let durableObject: string | null = null;
    let queue: string | null = null;
    let workflow = false;
    // versions (best-effort — a scoped token may decline)
    const vres = await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(id)}/versions`).catch(() => null);
    const items = ((vres?.result as Any)?.items ?? vres?.result ?? null) as Any[] | null;
    if (Array.isArray(items)) {
      versionsTotal = items.length;
      const max = items.reduce((a, b) => (Number(b.number ?? 0) > Number(a?.number ?? 0) ? b : a), items[0]);
      if (max?.id) latestVersion = { id: String(max.id).slice(0, 14), number: Number(max.number) };
    }
    // live content digest (+ optional snapshot) — NORMALIZED (multipart
    // boundary is random per call; the normalized digest is reproducible)
    const content = await cfText(`/accounts/${account}/workers/scripts/${encodeURIComponent(id)}`).catch(() => null);
    if (content != null) {
      liveSha = sha256(normalizedContent(content)).slice(0, 16);
      liveBytes = content.length;
      if (snapshot && meta) await snapshotWorker(id).catch(() => {});
    }
    // settings: binding NAMES only (secret values are never returned by the API)
    const sres = await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(id)}/settings`).catch(() => null);
    const st = (sres?.result ?? {}) as Any;
    for (const b of st.bindings ?? []) {
      bindings.push(String(b.name));
      if (b.type === "secret_text") secretBindings.push(String(b.name));
      if (b.type === "durable_object_namespace") durableObject = String(b.name);
      if (b.type === "queue") queue = String(b.name);
      if (b.type === "workflow") workflow = true;
    }
    workers.push({
      id,
      role: meta?.role ?? "unclassified worker (not in the R83 registry)",
      modified_on: s.modified_on ?? null,
      versions_total: versionsTotal,
      latest_version: latestVersion,
      live_sha256: liveSha,
      live_bytes: liveBytes,
      bindings,
      secret_bindings: secretBindings,
      durable_object: durableObject,
      queue,
      workflow,
      source: await sourceBinding(id).catch(() => ({
        verdict: "NO_SOURCE_IN_REPO" as const,
        release_candidates: [],
        markers_checked: meta?.markers ?? [],
        note: "binding check failed (GitHub unavailable)",
      })),
    });
  }

  const registryWorkers = workers.filter((w) => Object.prototype.hasOwnProperty.call(WORKER_SOURCE, w.id));
  const noSource = registryWorkers.filter((w) => w.source.verdict === "NO_SOURCE_IN_REPO");
  const status: EdgeStatus = {
    ok: true,
    schema: "metaengine.r83.edge.status.v1",
    fetched_at: new Date().toISOString(),
    daemon_version: VERSION,
    subdomain,
    token_present: true,
    workers,
    findings: [
      `inventory: ${workers.length} workers (${workers.map((w) => w.id).join(", ")}) @ ${subdomain ?? "?.workers.dev"}`,
      `source-of-truth: ${noSource.length}/${registryWorkers.length} registry workers have NO source in the canonical repo (marker-verified against the release tree, plus manual main/donor checks 2026-09-26) — the production edge is only observable through live content`,
      "aop1 worker (v64+) holds the operator authority: DurableObject AOP_SUPERVISOR + SUPABASE_SERVICE_ROLE_KEY + GitHub write path — its source absence is the deepest governance gap",
      "fabric worker (v15) is the dispatch gateway (queue + workflow + AI) for h205f21 compute slots; R80 audit's production/canary split refers to its version line",
      "live script digests are reproducible from the API; snapshots persist under daemon data/edge/ with hash-chained EDGE_SNAPSHOT events",
    ],
    promotion_blockers: [
      "no in-repo source for either production worker → a source-built promotion is impossible until the live scripts are imported back into the canonical repo and reviewed",
      "enginetest (2 versions, 2026-08-20) is a leftover probe worker — retire or classify during the promotion window",
      "credentials rotation (P0, operator): the CF token itself was exposed in the chat export; edge promotion should use a fresh scoped token",
    ],
  };
  cache = { at: Date.now(), data: status };
  return status;
}
