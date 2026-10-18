#!/usr/bin/env node
/**
 * AUDIT FIXPACK2 (2026-10-18), priority 9 — contract drift check.
 *
 * METAENGINE's cross-app protocol (daemon / browser supervisor / edge functions /
 * me2-ui / coordination plane) was held together by hand-maintained literals:
 * the workspace UUID appeared in 94 files, the Supabase project URL in 30, the
 * same RPC names were defined in up to 7 SQL copies, and the emergency-lease /
 * cognitive-cursor SQL artifacts had already silently diverged from their
 * canonical migrations. This script makes the registry
 * (scripts/contract-registry.json) verifiable: every documented canonical value
 * must exist where the registry says, and every known divergence must carry its
 * banner pointing at the canonical counterpart.
 *
 * Exit 0 = invariants hold. Exit 1 = drift (CI fails). No dependencies.
 *
 * Usage: node scripts/check-contract-drift.mjs   (repo root or any cwd)
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = (() => {
  // locate repo root: registry must exist two levels above this script
  const here = dirname(fileURLToPath(import.meta.url));
  for (let dir = here; dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, "scripts", "contract-registry.json"))) return dir;
  }
  console.error("FATAL: scripts/contract-registry.json not found above", here);
  process.exit(2);
})();

const problems = [];
const notes = [];
const ok = (msg) => notes.push(`ok: ${msg}`);
const bad = (msg) => problems.push(msg);
const must = (cond, msg) => (cond ? ok(msg) : bad(msg));
const read = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) { bad(`missing file: ${rel}`); return null; }
  return readFileSync(p, "utf8");
};

// ── 1. registry itself ─────────────────────────────────────────────
const regPath = join(ROOT, "scripts", "contract-registry.json");
let reg;
try {
  reg = JSON.parse(readFileSync(regPath, "utf8"));
  must(reg.schema === "metaengine.contract.registry.v1", "registry schema is metaengine.contract.registry.v1");
  must(typeof reg.canonical?.workspace_uuid === "string" && /^[0-9a-f-]{36}$/.test(reg.canonical.workspace_uuid), "canonical.workspace_uuid looks like a UUID");
  must(typeof reg.canonical?.supabase_project_host === "string" && reg.canonical.supabase_project_host.endsWith(".supabase.co"), "canonical.supabase_project_host shape");
} catch (e) {
  console.error(`FATAL: registry unreadable: ${e.message}`);
  process.exit(2);
}

const c = reg.canonical;

// ── 2. canonical SQL files exist ───────────────────────────────────
for (const [name, rel] of Object.entries(c.sql ?? {})) {
  must(existsSync(join(ROOT, rel)), `canonical sql [${name}] exists: ${rel}`);
}

// ── 3. canonical port defaults still defined in src/ports.ts ───────
const portsSrc = read("apps/me2-daemon/src/ports.ts");
if (portsSrc) {
  must(portsSrc.includes(String(c.ports.daemon_ws)) && portsSrc.includes(String(c.ports.daemon_rest)),
    `ports.ts defines daemon defaults :${c.ports.daemon_ws}/:${c.ports.daemon_rest}`);
}

// ── 4. device enrollment endpoint contract across implementations ──
const edgeV4 = read("supabase/functions/a2-browser-supervisor-v4/index.ts");
if (edgeV4) {
  must(edgeV4.includes(c.device_enrollment_request_legacy_alias),
    `edge v4 serves legacy enrollment alias ${c.device_enrollment_request_legacy_alias} (documented)`);
}
const nativeSup = read(join(c.supervisor_plane, "index.ts"));
if (nativeSup) {
  must(nativeSup.includes(c.device_enrollment_request),
    `canonical supervisor plane serves ${c.device_enrollment_request}`);
  must(nativeSup.includes(c.workspace_uuid), "canonical supervisor plane pins the canonical workspace UUID");
}

// ── 5. workspace UUID carriers (spot registry: canonical surfaces) ──
for (const rel of ["supabase/functions/a2-browser-supervisor-v1/index.ts", "supabase/functions/a2-chat-bridge-remote/index.ts"]) {
  const src = read(rel);
  if (src) must(src.includes(c.workspace_uuid), `workspace UUID present in ${rel}`);
}

// ── 6. every known divergence carries its canonical banner ─────────
for (const d of reg.known_divergences ?? []) {
  const src = read(d.file);
  if (src === null) continue;
  if (d.requires_banner) {
    must(src.includes(d.requires_banner),
      `divergence ${d.file} references canonical ${d.requires_banner}`);
  } else {
    must(existsSync(join(ROOT, d.file)), `divergence ${d.file} present (tracked)`);
  }
}

// ── report ─────────────────────────────────────────────────────────
for (const n of notes) console.log(`  ✔ ${n}`);
if (problems.length) {
  console.error(`\nCONTRACT DRIFT: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✘ ${p}`);
  console.error(`\nFix the drift OR (if a divergence is now intended) update scripts/contract-registry.json with an explicit entry.`);
  process.exit(1);
}
console.log(`\nCONTRACT DRIFT CHECK: PASS (${notes.length} invariants, ${reg.known_divergences.length} tracked divergences)`);
