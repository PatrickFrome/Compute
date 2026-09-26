#!/usr/bin/env node
// R83 edge source-import: pushes the built tree (build/r83-import/edge/)
// to a new branch work/r83-edge-source-import-v1 in PatrickFrome/Compute via
// the Git Data API (blobs → tree → commit → ref) and opens a PR into the
// canonical release branch. No local clone needed, no force-push, base tree
// is preserved via base_tree. Token stays server-side in /home/z/.a2/.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "PatrickFrome/Compute";
const BRANCH = "work/r83-edge-source-import-v1";
const BASE_BRANCH = "release/self-update-ambiguity-live-v2";
const BASE_SHA = "e7fccd08da180f324490da85c151fcbe656053a3"; // live-verified release head (PR #981 merge)
const ROOT = new URL("..", import.meta.url).pathname;
const TREE_DIR = join(ROOT, "build/r83-import/edge");

const token = (() => {
  const raw = readFileSync("/home/z/.a2/.github.env", "utf8");
  const m = raw.match(/^GITHUB_TOKEN_ADMIN=([^\s]+)$/m);
  if (!m) throw new Error("no GITHUB_TOKEN_ADMIN in /home/z/.a2/.github.env");
  return m[1];
})();

async function api(path, method = "GET", body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "me2-r83-import",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${text.slice(0, 400)}`);
  return { json: text ? JSON.parse(text) : null, headers: res.headers };
}

// ---------------------------------------------------------------------------
// 1) base commit + tree
// ---------------------------------------------------------------------------
const baseCommit = await api(`/repos/${REPO}/git/commits/${BASE_SHA}`);
const baseTreeSha = baseCommit.json.tree.sha;
console.log(`base commit ${BASE_SHA.slice(0, 10)} → base tree ${baseTreeSha.slice(0, 10)}`);

// guard: branch must not already exist (no force-push ever)
const existing = await api(`/repos/${REPO}/git/ref/heads%2F${encodeURIComponent(BRANCH).replace(/%2F/g, "%2F")}`).catch(() => null);
if (existing?.json?.object) {
  console.error(`branch ${BRANCH} already exists at ${existing.json.object.sha} — refusing to force-push`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2) blobs (one per file — verbatim utf-8)
// ---------------------------------------------------------------------------
import { readdirSync, statSync } from "node:fs";
const files = [];
(function walk(dir, prefix = "") {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, `${prefix}${e.name}/`);
    else files.push({ path: `edge/${prefix}${e.name}`, abs: p });
  }
})(TREE_DIR);
console.log(`uploading ${files.length} blobs…`);

const tree = [];
for (const f of files) {
  const content = readFileSync(f.abs, "utf8");
  const blob = await api(`/repos/${REPO}/git/blobs`, "POST", { content, encoding: "utf-8" });
  tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.json.sha });
  process.stdout.write(".");
}
console.log("");

// ---------------------------------------------------------------------------
// 3) tree → commit → ref
// ---------------------------------------------------------------------------
const newTree = await api(`/repos/${REPO}/git/trees`, "POST", { base_tree: baseTreeSha, tree });
const commitMsg = [
  "R83: import live edge workers as source-of-truth (fabric 7/7 modules verbatim; aop1 verbatim bundle + recovered src-sections)",
  "",
  "- fabric-worker-h205f21r4: 7 ESM modules byte-identical to live v15 (normalized digest 9c55419e37b04d41)",
  "- metaengine-h205f22-aop1: verbatim deployable bundle (95,200 bytes, digest 29b36254b0b4cb4f) + 8 esbuild src-section slices for review",
  "- wrangler.jsonc stubs from live settings/bindings (secrets as placeholders ONLY — no values in repo)",
  "- PROVENANCE.json digest binding + tools/verify-digests.mjs promotion-gate verifier (repo == live, both workers)",
  "- IMPORT ONLY: no deploy; promotion requires operator review + digest re-verification + CF token rotation",
].join("\n");

const commit = await api(`/repos/${REPO}/git/commits`, "POST", {
  message: commitMsg,
  tree: newTree.json.sha,
  parents: [BASE_SHA],
});
console.log(`commit ${commit.json.sha.slice(0, 10)} (tree ${newTree.json.sha.slice(0, 10)}, +${files.length} files)`);

const ref = await api(`/repos/${REPO}/git/refs`, "POST", { ref: `refs/heads/${BRANCH}`, sha: commit.json.sha });
console.log(`branch ${BRANCH} → ${ref.json.object.sha.slice(0, 10)}`);

// ---------------------------------------------------------------------------
// 4) PR
// ---------------------------------------------------------------------------
const prBody = [
  "## What",
  "",
  "R83 live qualification proved **2/2 registry Cloudflare workers had no source in the canonical repo** — production edge was code living only inside Cloudflare (markers absent from main, release and donor trees). This PR imports the live bytes into `edge/` and establishes the repo side of the source → build → deploy → verify loop.",
  "",
  "## Contents",
  "",
  "| worker | character | digest (normalized) | repo side |",
  "| --- | --- | --- | --- |",
  "| `metaengine-fabric-worker-h205f21r4` (v15) | original ESM modules, 7/7 readable | `9c55419e37b04d41` | `edge/fabric-worker-h205f21r4/src/*` verbatim |",
  "| `metaengine-h205f22-aop1` (v64) | esbuild bundle (per-module source lost pre-import) | `29b36254b0b4cb4f` | `edge/metaengine-h205f22-aop1/bundle/index.js` verbatim + `recovered/*` review slices |",
  "",
  "- `wrangler.jsonc` stubs built from **live settings** (compat dates, DO class `ComputeFabricSupervisor`, workflows, queues `metaengine-fabric-dispatch-h205f21r4` / `metaengine-h205f22-aop-wake`, vars). `secret_text` bindings are enumerated as `secrets_hint` — **no secret values in this repo**.",
  "- `PROVENANCE.json` — machine-readable provenance + per-module `sha256_12` digest binding.",
  "- `tools/verify-digests.mjs` — promotion gate: `cd edge && node tools/verify-digests.mjs` must print `== LIVE ✓` for both workers.",
  "",
  "## Verification",
  "",
  "Digest contract mirrors the daemon's normalized-content algorithm (parse multipart → sort modules by name → sha256 of `#module {name}\\n{body}` concatenation; random boundary/module-order defeated). Verified at build time AND from the emitted tree:",
  "",
  "```",
  "fabric-worker  9c55419e37b04d41 == LIVE ✓",
  "h205f22-aop1  29b36254b0b4cb4f == LIVE ✓",
  "repo tree == live edge (both workers) — promotion gate digest contract holds",
  "```",
  "",
  "## Policies (operator review)",
  "",
  "1. **Import only — this PR deploys nothing.**",
  "2. Promotion (deploy-from-repo) requires: operator review, digest re-verification, CF token rotation (current token lineage from chat export).",
  "3. Any edit under `edge/` breaks the digest verifier by design — changed code must be deployed and PROVENANCE.json re-bound in the same review.",
  "4. `enginetest` (v2, 275b probe remnant) intentionally NOT imported — disposition under operator review.",
  "",
  "Supersedes nothing; purely additive (`edge/` prefix, 23 files, ~220KB).",
].join("\n");

const pr = await api(`/repos/${REPO}/pulls`, "POST", {
  title: "R83: import live edge workers as repo source-of-truth (fabric verbatim modules + aop1 verbatim bundle, digest-bound)",
  head: BRANCH,
  base: BASE_BRANCH,
  body: prBody,
  maintainer_can_modify: true,
});
console.log(`\nPR #${pr.json.number}: ${pr.json.html_url}`);
console.log(`  state=${pr.json.state} draft=${pr.json.draft} base=${pr.json.base.ref}`);
