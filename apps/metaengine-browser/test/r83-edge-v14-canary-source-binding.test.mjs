import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '../..');
const BINDING_PATH = path.join(REPO_ROOT, 'coordination', 'convergence', 'R83_EDGE_V14_CANARY_SOURCE_BINDING_V1.json');
const ADMIN_CONNECTIVITY_MIGRATION = path.join(REPO_ROOT, 'supabase', 'migrations', '20260930163000_client_v1_admin_connectivity_v1.sql');

function gitTextBlobSha1(bytes) {
  // actions/checkout on Windows may materialize CRLF even though the Git blob is
  // canonical LF. The R83 binding is to Git object bytes, not checkout EOLs.
  const canonical = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha1')
    .update(Buffer.from(`blob ${canonical.length}\0`))
    .update(canonical)
    .digest('hex');
}

async function binding() {
  return JSON.parse(await fs.readFile(BINDING_PATH, 'utf8'));
}

test('R83 v14 canary binding is exact and cannot silently authorize promotion', async () => {
  const value = await binding();
  assert.equal(value.schema, 'metaengine.r83.edge-canary-source-binding.v1');
  assert.equal(value.candidate.slug, 'a2-browser-native-supervisor-v14-canary');
  const manifest = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'coordination/convergence/R83_EDGE_CANARY_QUALIFICATION_V1.json'), 'utf8'));
  assert.equal(value.candidate.observed_function_version, manifest.candidate.deployed_version);
  assert.equal(value.candidate.source_commit, manifest.candidate.source_pin);
  assert.equal(value.candidate.observed_ezbr_sha256, manifest.candidate.ezbr_sha256);
  assert.ok(Number.isSafeInteger(value.candidate.observed_function_version) && value.candidate.observed_function_version > 0);
  assert.match(value.candidate.observed_ezbr_sha256, /^[a-f0-9]{64}$/);
  assert.match(value.candidate.source_commit, /^[a-f0-9]{40}$/);
  assert.equal(value.candidate.source_binding, 'PINNED_RAW_GITHUB_IMPORT_CLOSURE');
  assert.equal(value.production_observed.slug, 'a2-browser-native-supervisor-v1');
  assert.notEqual(value.candidate.observed_ezbr_sha256, value.production_observed.observed_ezbr_sha256);
  assert.equal(value.promotion_authorized, false);
  assert.equal(value.automatic_promotion_allowed, false);
  assert.equal(value.authority_effect, false);
});

test('R83 deployed v14 binding classifies source drift as requalification-required without rewriting evidence', async () => {
  const value = await binding();
  const source = await fs.readFile(path.join(APP_ROOT, 'supabase/a2-browser-native-supervisor-v1/index.ts'), 'utf8');
  const imports = [...source.matchAll(/from '\.\/([^']+)'/g)].map(m => 'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/' + m[1]);
  const currentImports = new Set(imports);
  const deployedImports = new Set(value.candidate.imports.map(row => row.path));
  const seen = new Set();
  const drift = [];
  for (const currentPath of currentImports) {
    if (!deployedImports.has(currentPath)) drift.push(Object.freeze({ path: currentPath, kind: 'IMPORT_ADDED' }));
  }
  for (const row of value.candidate.imports) {
    assert.equal(seen.has(row.path), false, `duplicate import binding: ${row.path}`);
    seen.add(row.path);
    assert.match(row.git_blob_sha1, /^[a-f0-9]{40}$/);
    if (!currentImports.has(row.path)) {
      drift.push(Object.freeze({ path: row.path, kind: 'IMPORT_REMOVED', deployed_blob: row.git_blob_sha1 }));
      continue;
    }
    const bytes = await fs.readFile(path.join(REPO_ROOT, row.path));
    const currentBlob = gitTextBlobSha1(bytes);
    if (currentBlob !== row.git_blob_sha1) {
      drift.push(Object.freeze({ path: row.path, kind: 'CONTENT_CHANGED', deployed_blob: row.git_blob_sha1, current_blob: currentBlob }));
    }
  }

  const state = drift.length === 0 ? 'DIRECT_IMPORT_BINDING_EQUIVALENT' : 'CANARY_REQUALIFICATION_REQUIRED';
  assert.ok(['DIRECT_IMPORT_BINDING_EQUIVALENT', 'CANARY_REQUALIFICATION_REQUIRED'].includes(state));
  assert.equal(value.promotion_authorized, false);
  assert.equal(value.automatic_promotion_allowed, false);
  assert.equal(value.authority_effect, false);

  // Generic Browser test suites must be able to validate a source candidate.
  // This diagnostic does not bind index.ts or transitive imports. The dedicated
  // R83 qualification workflow remains the hard full-source equivalence gate.
  if (state === 'CANARY_REQUALIFICATION_REQUIRED') {
    assert.ok(drift.length > 0);
    for (const row of drift) {
      if (row.kind === 'CONTENT_CHANGED') {
        assert.notEqual(row.current_blob, row.deployed_blob);
        assert.match(row.current_blob, /^[a-f0-9]{40}$/);
      } else if (row.kind === 'IMPORT_ADDED') {
        assert.equal(deployedImports.has(row.path), false);
        assert.equal(currentImports.has(row.path), true);
      } else {
        assert.equal(row.kind, 'IMPORT_REMOVED');
        assert.equal(currentImports.has(row.path), false);
        assert.equal(deployedImports.has(row.path), true);
      }
    }
  }
});

test('R83 canonical Edge source exposes every canary convergence capability before promotion', async () => {
  const source = await fs.readFile(path.join(APP_ROOT, 'supabase', 'a2-browser-native-supervisor-v1', 'index.ts'), 'utf8');
  const migration = await fs.readFile(ADMIN_CONNECTIVITY_MIGRATION, 'utf8');
  for (const pattern of [
    /createPostgresCommandWakeHub/,
    /createRsiResultReceiptReadback/,
    /createEmergencyCommandRoutes/,
    /client_v1_native_supervisor_state_merge_v1/,
    /cognitive_delta_route:true/,
    /postgres_notify_wake:Boolean\(DB_SESSION_URL\)/,
    /command_wait_batch:\(REALTIME_API_KEY&&REALTIME_ACCESS_TOKEN\)\?'REALTIME_BROADCAST_PROXY':\(DB_SESSION_URL\?'POSTGRES_NOTIFY_PROXY':'BOUNDED_DB_POLL'\)/,
    /result_receipt_readback:true/,
    /emergency_wait_route:true/,
  ]) assert.match(source, pattern);
  assert.match(migration, /create or replace function public\.client_v1_native_supervisor_state_merge_v1/);
  assert.match(migration, /state=coalesce\(target\.state,'\{\}'::jsonb\)\|\|excluded\.state/);
  assert.match(migration, /grant execute on function public\.client_v1_native_supervisor_state_merge_v1[\s\S]*to service_role/i);
});
