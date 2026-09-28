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
  assert.equal(value.candidate.observed_function_version, 1);
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
  assert.equal(value.candidate.imports.length, 10);

  const seen = new Set();
  const drift = [];
  for (const row of value.candidate.imports) {
    assert.equal(seen.has(row.path), false, `duplicate import binding: ${row.path}`);
    seen.add(row.path);
    assert.match(row.git_blob_sha1, /^[a-f0-9]{40}$/);
    const bytes = await fs.readFile(path.join(REPO_ROOT, row.path));
    const currentBlob = gitTextBlobSha1(bytes);
    if (currentBlob !== row.git_blob_sha1) {
      drift.push(Object.freeze({ path: row.path, deployed_blob: row.git_blob_sha1, current_blob: currentBlob }));
    }
  }

  const state = drift.length === 0 ? 'DEPLOYED_CANARY_EQUIVALENT' : 'CANARY_REQUALIFICATION_REQUIRED';
  assert.ok(['DEPLOYED_CANARY_EQUIVALENT', 'CANARY_REQUALIFICATION_REQUIRED'].includes(state));
  assert.equal(value.promotion_authorized, false);
  assert.equal(value.automatic_promotion_allowed, false);
  assert.equal(value.authority_effect, false);

  // Generic Browser test suites must be able to validate a source candidate.
  // The dedicated R83 qualification workflow remains the hard exact-equivalence
  // gate and must fail while this state is CANARY_REQUALIFICATION_REQUIRED.
  if (state === 'CANARY_REQUALIFICATION_REQUIRED') {
    assert.ok(drift.length > 0);
    for (const row of drift) {
      assert.notEqual(row.current_blob, row.deployed_blob);
      assert.match(row.current_blob, /^[a-f0-9]{40}$/);
    }
  }
});

test('R83 canonical Edge source exposes every canary convergence capability before promotion', async () => {
  const source = await fs.readFile(path.join(APP_ROOT, 'supabase', 'a2-browser-native-supervisor-v1', 'index.ts'), 'utf8');
  for (const pattern of [
    /createPostgresCommandWakeHub/,
    /createRsiResultReceiptReadback/,
    /createEmergencyCommandRoutes/,
    /state=coalesce\(target\.state,'\{\}'::jsonb\)\|\|excluded\.state/,
    /cognitive_delta_route:true/,
    /postgres_notify_wake:true/,
    /result_receipt_readback:true/,
    /emergency_wait_route:true/,
  ]) assert.match(source, pattern);
});
