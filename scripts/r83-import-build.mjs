#!/usr/bin/env node
// R83 edge source-import builder.
// Parses the live edge snapshots (data/edge/*.snapshot.txt, captured by the
// daemon from the Cloudflare scripts API) and emits a repo-ready source tree
// into build/r83-import/edge/ with:
//   - fabric-worker: 7 verbatim ESM modules (1:1 with live module set)
//   - aop1: verbatim deployable bundle + recovered src-section slices
//   - wrangler.jsonc stubs from LIVE bindings (secrets = placeholders only)
//   - PROVENANCE.json with digest binding (normalized digest == live digest)
//   - tools/verify-digests.mjs so CI/operator can prove repo == live
// READ-ONLY by design: touches nothing outside build/r83-import/.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SNAP_DIR = join(ROOT, "mini-services/me2-daemon/data/edge");
const OUT_DIR = join(ROOT, "build/r83-import");
rmSync(OUT_DIR, { recursive: true, force: true }); // deterministic rebuild

const FABRIC_ID = "metaengine-fabric-worker-h205f21r4";
const AOP1_ID = "metaengine-h205f22-aop1";

// live-verified 2026-09-26 via GET /edge?fresh=1 (daemon edge.ts, 3-fetch stable)
const LIVE = {
  [FABRIC_ID]: {
    live_sha256: "9c55419e37b04d41",
    live_bytes: 16944,
    version: 15,
    versions_total: 10,
    modified_on: "2026-08-20T02:48:38.952989Z",
    compatibility_date: "2026-08-19",
    observability_enabled: false,
  },
  [AOP1_ID]: {
    live_sha256: "29b36254b0b4cb4f",
    live_bytes: 95380,
    version: 64,
    versions_total: 10,
    modified_on: "2026-08-24T10:37:20.722214Z",
    compatibility_date: "2026-08-21",
    observability_enabled: true,
  },
};

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// MUST mirror daemon edge.ts normalizedContent() byte-for-byte semantics:
// parse multipart (random boundary, random module order), sort by name,
// join as `#module {name}\n{body}` with a single trailing \n removed per body.
function parseMultipart(raw) {
  const parts = [];
  const lines = raw.split("\n");
  let current = null;
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
  return parts;
}

const normalized = (parts) =>
  [...parts]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => `#module ${p.name}\n${p.body.replace(/\n$/, "")}`)
    .join("\n");

// ---------------------------------------------------------------------------
// 1) parse snapshots + digest verification (the core contract)
// ---------------------------------------------------------------------------
const fabricParts = parseMultipart(readFileSync(join(SNAP_DIR, `${FABRIC_ID}.snapshot.txt`), "utf8"));
const aop1Parts = parseMultipart(readFileSync(join(SNAP_DIR, `${AOP1_ID}.snapshot.txt`), "utf8"));

const fabricNorm = normalized(fabricParts);
const aop1Norm = normalized(aop1Parts);
const fabricDigest = sha256(fabricNorm).slice(0, 16);
const aop1Digest = sha256(aop1Norm).slice(0, 16);

const failures = [];
if (fabricDigest !== LIVE[FABRIC_ID].live_sha256) failures.push(`fabric digest ${fabricDigest} != live ${LIVE[FABRIC_ID].live_sha256}`);
if (aop1Digest !== LIVE[AOP1_ID].live_sha256) failures.push(`aop1 digest ${aop1Digest} != live ${LIVE[AOP1_ID].live_sha256}`);
if (failures.length) {
  console.error("DIGEST MISMATCH — refusing to emit tree:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(`digest contract OK: fabric=${fabricDigest} aop1=${aop1Digest} (== live)`);

// ---------------------------------------------------------------------------
// 2) emit fabric source tree (verbatim modules, path == live module name)
// ---------------------------------------------------------------------------
const fabricDir = join(OUT_DIR, "edge/fabric-worker-h205f21r4");
mkdirSync(join(fabricDir, "src"), { recursive: true });
const fabricModules = [];
for (const p of fabricParts) {
  const body = p.body.replace(/\n$/, "\n"); // keep exactly one trailing newline per file
  writeFileSync(join(fabricDir, p.name), body);
  fabricModules.push({
    path: `edge/fabric-worker-h205f21r4/${p.name}`,
    bytes: body.length,
    lines: body.split("\n").length,
    sha256_12: sha256(body).slice(0, 12),
  });
}

// ---------------------------------------------------------------------------
// 3) emit aop1: verbatim deployable bundle + recovered src-section slices
// ---------------------------------------------------------------------------
const aop1Module = aop1Parts[0]; // single module "index.js"
const aop1Bundle = aop1Module.body.replace(/\n$/, "\n");
const aop1Dir = join(OUT_DIR, "edge/metaengine-h205f22-aop1");
mkdirSync(join(aop1Dir, "bundle"), { recursive: true });
mkdirSync(join(aop1Dir, "recovered"), { recursive: true });
writeFileSync(join(aop1Dir, "bundle/index.js"), aop1Bundle);

// split at `// src/*` markers (esbuild kept them in the output)
const bundleLines = aop1Bundle.split("\n");
const sections = [];
let section = null;
for (let i = 0; i < bundleLines.length; i++) {
  const m = /^\/\/ (src\/[A-Za-z0-9_./-]+)$/.exec(bundleLines[i]);
  if (m) {
    if (section) sections.push(section);
    section = { marker: m[1], from: i + 1, lines: [] };
    continue;
  }
  if (section) section.lines.push(bundleLines[i]);
}
if (section) sections.push(section);

// preamble = everything before the first marker (esbuild runtime helpers + hoisted imports)
const firstMarkerIdx = bundleLines.findIndex((l) => /^\/\/ src\//.test(l));
const preamble = bundleLines.slice(0, firstMarkerIdx).join("\n");
writeFileSync(join(aop1Dir, "recovered/00-preamble.js"), preamble.endsWith("\n") ? preamble : preamble + "\n");

const recoveredIndex = [];
for (const s of sections) {
  const safe = s.marker.replace(/\//g, "-"); // src/duel_db_wake.ts -> src-duel_db_wake.ts (extension already present)
  const fileName = `recovered/${safe}`;
  const body = s.lines.join("\n");
  writeFileSync(join(aop1Dir, fileName), body.endsWith("\n") ? body : body + "\n");
  recoveredIndex.push({
    file: `edge/metaengine-h205f22-aop1/${fileName}`,
    marker: s.marker,
    lines: s.lines.length,
    note: s.marker === "src/index.ts" ? "entry module (esbuild emits it last; first occurrence is the hoisted import block)" : undefined,
  });
}

// ---------------------------------------------------------------------------
// 4) wrangler.jsonc stubs from LIVE settings (fetched 2026-09-26, /settings API)
//    secrets are NEVER inlined — placeholder + README note (repo stays secret-free)
// ---------------------------------------------------------------------------
const fabricWrangler = {
  $schema: "node_modules/wrangler/config-schema.json",
  name: FABRIC_ID,
  main: "src/index.js",
  compatibility_date: LIVE[FABRIC_ID].compatibility_date,
  observability: { enabled: LIVE[FABRIC_ID].observability_enabled },
  // digest binding: deployed script must equal live sha256 9c55419e37b0…
  // (see ../../PROVENANCE.json and tools/verify-digests.mjs)
  vars: {
    AI_MODEL: "@cf/zai-org/glm-4.7-flash",
    ALLOWED_SLOTS: "C0,C3,C5,C6,C7",
    MAX_AGENT_TURNS: "8",
    SUPABASE_WORKER_GATEWAY_URL: "https://sibnfciqcpkuquxzduqr.supabase.co/functions/v1/metaengine-compute-federation-worker-h205f22",
  },
  queues: { producers: [{ binding: "DISPATCH_QUEUE", queue: "metaengine-fabric-dispatch-h205f21r4" }] },
  workflows: [{ binding: "FABRIC_WORKFLOW", name: "metaengine-fabric-workflow-h205f21r4", class_name: "FabricWorkflow" }],
  ai: { binding: "AI" },
  // secrets (live secret_text bindings — values live in CF dashboard/API only):
  //   wrangler secret put WAKE_TOKEN | WAKE_TOKEN1 | WORKER_CAPABILITY
  secrets_hint: ["WAKE_TOKEN", "WAKE_TOKEN1", "WORKER_CAPABILITY"],
};
writeFileSync(join(fabricDir, "wrangler.jsonc"), JSON.stringify(fabricWrangler, null, 2) + "\n");

const aop1Wrangler = {
  $schema: "node_modules/wrangler/config-schema.json",
  name: AOP1_ID,
  main: "bundle/index.js",
  compatibility_date: LIVE[AOP1_ID].compatibility_date,
  observability: { enabled: LIVE[AOP1_ID].observability_enabled },
  // digest binding: deployed script must equal live sha256 29b36254b0b4cb4f…
  vars: {
    AOP_MODEL: "@cf/openai/gpt-oss-20b",
    DUEL_MAX_OUTPUT_TOKENS: "1200",
    SUPABASE_URL: "https://xpeibufgzjknrhbhpffp.supabase.co",
  },
  durable_objects: { bindings: [{ name: "AOP_SUPERVISOR", class_name: "ComputeFabricSupervisor" }] },
  queues: { producers: [{ binding: "AOP_WAKE_QUEUE", queue: "metaengine-h205f22-aop-wake" }] },
  workflows: [{ binding: "AOP_RUN_WORKFLOW", name: "metaengine-h205f22-aop-run", class_name: "AopRunWorkflow" }],
  // secrets (live secret_text bindings — values live in CF dashboard/API only):
  //   AOP_SUPERVISOR_TOKEN, AOP_WAKE_SECRET, CF_ACCOUNT_ID, CF_AI_TOKEN,
  //   SUPABASE_SERVICE_ROLE_KEY, VERCEL_AI_GATEWAY_API_KEY
  secrets_hint: [
    "AOP_SUPERVISOR_TOKEN", "AOP_WAKE_SECRET", "CF_ACCOUNT_ID",
    "CF_AI_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_AI_GATEWAY_API_KEY",
  ],
};
writeFileSync(join(aop1Dir, "wrangler.jsonc"), JSON.stringify(aop1Wrangler, null, 2) + "\n");

// ---------------------------------------------------------------------------
// 5) tools/verify-digests.mjs — repo-side promotion-gate verifier
// ---------------------------------------------------------------------------
mkdirSync(join(OUT_DIR, "edge/tools"), { recursive: true });
writeFileSync(
  join(OUT_DIR, "edge/tools/verify-digests.mjs"),
  `#!/usr/bin/env node
// Promotion-gate verifier: proves the source tree in this repo byte-matches
// the LIVE Cloudflare workers (R83 digest contract). Run from edge/:
//   node tools/verify-digests.mjs
// Exit 0 = repo tree == live modules (sorted-module normalized digest equal).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const normalized = (parts) =>
  [...parts]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => \`#module \${p.name}\\n\${p.body.replace(/\\n$/, "")}\`)
    .join("\\n");

const LIVE_DIGESTS = {
  "metaengine-fabric-worker-h205f21r4": "9c55419e37b04d41",
  "metaengine-h205f22-aop1": "29b36254b0b4cb4f",
};

const FABRIC_MODULES = ["src/ai.js", "src/auth.js", "src/core.mjs", "src/gateway.js", "src/handlers.js", "src/index.js", "src/workflow.js"];

let failed = false;

const fabricParts = FABRIC_MODULES.map((name) => ({ name, body: readFileSync(join("fabric-worker-h205f21r4", name), "utf8") }));
const fabricDigest = sha256(normalized(fabricParts)).slice(0, 16);
const fabricOk = fabricDigest === LIVE_DIGESTS["metaengine-fabric-worker-h205f21r4"];
console.log(\`fabric-worker  \${fabricDigest} \${fabricOk ? "== LIVE ✓" : "!= LIVE ✗"}\`);
if (!fabricOk) failed = true;

const aop1Body = readFileSync(join("metaengine-h205f22-aop1", "bundle/index.js"), "utf8");
const aop1Digest = sha256(normalized([{ name: "index.js", body: aop1Body }])).slice(0, 16);
const aop1Ok = aop1Digest === LIVE_DIGESTS["metaengine-h205f22-aop1"];
console.log(\`h205f22-aop1  \${aop1Digest} \${aop1Ok ? "== LIVE ✓" : "!= LIVE ✗"}\`);
if (!aop1Ok) failed = true;

if (failed) { console.error("VERIFY FAILED — repo tree diverged from live workers"); process.exit(1); }
console.log("repo tree == live edge (both workers) — promotion gate digest contract holds");
`
);

// ---------------------------------------------------------------------------
// 6) PROVENANCE.json (machine-readable digest binding)
// ---------------------------------------------------------------------------
const provenance = {
  schema: "metaengine.r83.edge.provenance.v1",
  generated_at: new Date().toISOString(),
  source: "Cloudflare Workers scripts API (live content endpoint, multipart)",
  captured_by: "ME2 daemon edge.ts snapshotWorker() — hash-chained EDGE_SNAPSHOT events",
  live_verified_at: "2026-09-26T08:00Z",
  digest_contract: {
    normalization: "parse multipart → sort modules by name → sha256 of `#module {name}\\n{body}` concatenation (single trailing newline stripped per body) — random boundary/module-order defeated, 3-fetch stable",
    fabric_live_sha256: LIVE[FABRIC_ID].live_sha256,
    aop1_live_sha256: LIVE[AOP1_ID].live_sha256,
  },
  workers: {
    [FABRIC_ID]: {
      ...LIVE[FABRIC_ID],
      source_character: "ORIGINAL_MODULES",
      repo_prefix: "edge/fabric-worker-h205f21r4/",
      entry: "src/index.js (exports FabricWorkflow + default {fetch, queue})",
      modules: fabricModules,
    },
    [AOP1_ID]: {
      ...LIVE[AOP1_ID],
      source_character: "ESBUILD_BUNDLE (single module index.js; original per-module source lost before this import)",
      repo_prefix: "edge/metaengine-h205f22-aop1/",
      deployable: "bundle/index.js (verbatim live bytes — wrangler main)",
      recovered: recoveredIndex,
      bundle_sha256_12: sha256(aop1Bundle).slice(0, 12),
    },
  },
  secrets_policy: "no secret values in repo; live secret_text bindings are listed in wrangler.jsonc secrets_hint and must be re-provisioned via `wrangler secret put` before any deploy",
  deploy_policy: "IMPORT ONLY — this PR does NOT deploy anything; promotion requires operator review + digest re-verification + CF token rotation (chat-export token)",
};
writeFileSync(join(OUT_DIR, "edge/PROVENANCE.json"), JSON.stringify(provenance, null, 2) + "\n");

// ---------------------------------------------------------------------------
// 7) READMEs
// ---------------------------------------------------------------------------
writeFileSync(
  join(OUT_DIR, "edge/README.md"),
  `# edge/ — Cloudflare Workers source-of-truth (R83 import)

## Why this exists

R83 live qualification (2026-09-26) proved that **2/2 registry workers had NO
source in the canonical repo** — the production edge was code living only
inside Cloudflare. This directory establishes the repo side of the
source → build → deploy → verify loop for both workers:

| worker | role | source character | live digest (normalized) |
| --- | --- | --- | --- |
| \`fabric-worker-h205f21r4\` | dispatch gateway (queue + workflow + AI; Supabase worker-gateway RPC PULL/HEARTBEAT/FAIL/PUBLISH) | original ESM modules, 7/7 readable | \`9c55419e37b04d41\` |
| \`metaengine-h205f22-aop1\` | operator authority (DO \`ComputeFabricSupervisor\` + workflow + queue; Supabase \`h205f22_aop1_*\` allowlist; GitHub writes) | esbuild bundle (per-module source lost pre-import) | \`29b36254b0b4cb4f\` |

## Layout

- \`fabric-worker-h205f21r4/src/*\` — **verbatim** live module bytes (module
  names preserved: \`src/index.js\` is the entry).
- \`metaengine-h205f22-aop1/bundle/index.js\` — **verbatim** live bundle bytes;
  \`wrangler.jsonc\` \`main\` points here so a repo-built deploy equals live bytes.
- \`metaengine-h205f22-aop1/recovered/*\` — esbuild \`// src/*\` section slices
  (review artifacts, not standalone modules; the bundle keeps them in order).
- \`*/wrangler.jsonc\` — stubs built from **live settings** (bindings, compat
  dates, observability). Secret bindings are listed as \`secrets_hint\` only.
- \`PROVENANCE.json\` — machine-readable digest binding (per-module sha256_12,
  snapshot provenance, policies).
- \`tools/verify-digests.mjs\` — promotion-gate verifier:
  \`cd edge && node tools/verify-digests.mjs\` must print \`== LIVE ✓\` for both.

## Policies

1. **Import only.** This PR deploys nothing. Promotion (deploy from repo)
   requires: operator review, digest re-verification, CF token rotation.
2. **No secrets in repo.** Live \`secret_text\` bindings are enumerated but
   never inlined; re-provision with \`wrangler secret put <NAME>\`.
3. **Digest contract.** Any edit to files under this tree breaks
   \`tools/verify-digests.mjs\` by design — the fix is to deploy the change and
   update PROVENANCE.json with the new live digest in the same review.
4. \`enginetest\` (v2, 275b probe leftover) is intentionally NOT imported —
   it is an unclassified remnant; disposition under operator review.
`
);

writeFileSync(
  join(fabricDir, "README.md"),
  `# fabric-worker-h205f21r4 (dispatch gateway)

Imported verbatim from the live Cloudflare worker (v15, compat 2026-08-19).
Module map:

- \`src/index.js\` — entry: exports \`FabricWorkflow\` (WorkflowEntrypoint) and
  default \`{ fetch, queue }\`.
- \`src/handlers.js\` — fetch/queue routing (dispatch wake + capability proof).
- \`src/gateway.js\` — Supabase worker-gateway RPC client
  (\`pullDispatch\`, \`heartbeat\`, \`runtimeFail\`, \`publishEvent\`, \`workerStatus\`).
- \`src/workflow.js\` — fabric workflow steps (agent turns via AI binding).
- \`src/ai.js\` — AI model calls.
- \`src/auth.js\` — wake-token auth.
- \`src/core.mjs\` — shared core helpers.

Digest binding: \`tools/verify-digests.mjs\` (repo root \`edge/\`) recomputes the
sorted-module normalized digest and compares with live \`9c55419e37b04d41\`.
`
);

writeFileSync(
  join(aop1Dir, "README.md"),
  `# metaengine-h205f22-aop1 (operator authority worker)

Live worker v64 (compat 2026-08-21, observability on). The live script is a
**single esbuild bundle** — the original per-module TypeScript source was lost
before this import, so this directory imports the bytes that production
actually runs:

- \`bundle/index.js\` — verbatim live module (95,380 bytes). \`wrangler.jsonc\`
  \`main\` points here: a repo deploy equals live bytes exactly.
- \`recovered/00-preamble.js\` — esbuild runtime helpers + hoisted imports
  (\`__defProp\`, \`__name\`, \`cloudflare:workers\` import).
- \`recovered/src-*.ts\` — verbatim \`// src/*\` section slices of the bundle
  (\`supabase\`, \`github\`, \`executor\`, \`duel_microstep\`, \`peer_relay_v4\`,
  \`duel_db_wake\`, and \`index\` — the entry, which esbuild emits last).
  These are **review artifacts**: readable, greppable, diffable — but not
  standalone-valid modules (they share the bundle scope).

Bindings (from live settings): DO \`AOP_SUPERVISOR\` → class
\`ComputeFabricSupervisor\`; workflow \`AOP_RUN_WORKFLOW\` → class
\`AopRunWorkflow\` (name \`metaengine-h205f22-aop-run\`); queue producer
\`AOP_WAKE_QUEUE\` → \`metaengine-h205f22-aop-wake\`; vars \`AOP_MODEL\`,
\`DUEL_MAX_OUTPUT_TOKENS\`, \`SUPABASE_URL\`; six \`secret_text\` bindings listed
in \`wrangler.jsonc\` (\`secrets_hint\`).

Reconstruction of true per-module source (with real imports/exports) is a
follow-up under operator review — until then the bundle IS the source of
truth, digest-bound to live \`29b36254b0b4cb4f\`.
`
);

// ---------------------------------------------------------------------------
// 8) inventory + final report
// ---------------------------------------------------------------------------
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ path: relative(OUT_DIR, p), bytes: statSync(p).size });
  }
})(OUT_DIR);

const manifest = {
  ok: true,
  branch: "work/r83-edge-source-import-v1",
  base: "release/self-update-ambiguity-live-v2 @ e7fccd08da180f324490da85c151fcbe656053a3",
  files: files.map((f) => ({ ...f, sha256_12: sha256(readFileSync(join(OUT_DIR, f.path), "utf8")).slice(0, 12) })),
  digest_contract: { fabric: fabricDigest, aop1: aop1Digest },
  counts: {
    fabric_modules: fabricModules.length,
    aop1_recovered_sections: recoveredIndex.length + 1, // + preamble
    total_files: files.length,
    total_bytes: files.reduce((s, f) => s + f.bytes, 0),
  },
};
writeFileSync(join(OUT_DIR, "import-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`emitted ${files.length} files (${manifest.counts.total_bytes} bytes) → ${OUT_DIR}/edge/`);
console.log(`  fabric: ${fabricModules.length} verbatim modules; aop1: bundle + ${recoveredIndex.length + 1} recovered slices`);
