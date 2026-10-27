import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = 'metaengine.test.native-consent-helper-mechanics-proof.v1';
export const mechanicsSources = Object.freeze({
  native_consent: 'infra/client-state-runtime/fresh-provider-native-consent.mjs',
  native_no_helper: 'apps/metaengine-browser/scripts/qa-decline-fresh-provider-consent.ps1',
  native_no_controller: 'apps/metaengine-browser/scripts/qa-decline-fresh-provider-consent.mjs',
  inert_harness: 'apps/metaengine-browser/test/fixtures/native-consent-mechanics-runner.mjs',
});

export function verifyNativeConsentMechanicsProof(log, { runId, sourceHashes }) {
  assert.match(runId || '', /^[1-9][0-9]*$/, 'native_mechanics_run_invalid');
  assert.equal(typeof log, 'string');
  assert.ok(Buffer.byteLength(log) <= 1024 * 1024, 'native_mechanics_log_oversized');
  const rows = [];
  for (const line of log.split(/\r?\n/)) {
    const text = line.replace(/^\s*#\s?/, '').trim();
    if (!text.startsWith('{')) continue;
    let value;
    try { value = JSON.parse(text); } catch { continue; }
    if (value?.schema === schema) rows.push(value);
  }
  assert.equal(rows.length, 1, 'native_mechanics_exactly_one_proof_required');
  const proof = rows[0];
  assert.deepEqual(Object.keys(proof).sort(), ['schema', 'github_run_id', 'source_sha256', 'scope',
    'harness_pid', 'consent_pid', 'exact_process_tree_bound', 'native_control_id',
    'actual_native_exit_code', 'exact_declined_sentinel', 'generated_local_and_roaming_unchanged',
    'process_cleanup_confirmed', 'installed_browser_qualification', 'owner_boot_qualification',
    'database_provisioning_qualification', 'guardian_qualification', 'authority_effect'].sort(),
  'native_mechanics_fields_invalid');
  assert.equal(proof.github_run_id, runId, 'native_mechanics_run_mismatch');
  assert.equal(proof.scope, 'GENERATED_NODE_PARENT_NATIVE_NO_ONLY');
  assert.ok(Number.isSafeInteger(proof.harness_pid) && proof.harness_pid > 0);
  assert.ok(Number.isSafeInteger(proof.consent_pid) && proof.consent_pid > 0);
  assert.notEqual(proof.harness_pid, proof.consent_pid);
  assert.equal(proof.native_control_id, 7);
  assert.equal(proof.actual_native_exit_code, 2);
  for (const key of ['exact_process_tree_bound', 'exact_declined_sentinel',
    'generated_local_and_roaming_unchanged', 'process_cleanup_confirmed']) assert.equal(proof[key], true, key);
  for (const key of ['installed_browser_qualification', 'owner_boot_qualification',
    'database_provisioning_qualification', 'guardian_qualification', 'authority_effect']) assert.equal(proof[key], false, key);
  assert.deepEqual(Object.keys(sourceHashes).sort(), Object.keys(mechanicsSources).sort());
  for (const hash of Object.values(sourceHashes)) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(proof.source_sha256, sourceHashes, 'native_mechanics_source_mismatch');
  return Object.freeze({ schema: 'metaengine.native-mechanics-preflight.v1',
    github_run_id: runId, native_denial_mechanics_verified: true,
    installed_qualification: false, authority_effect: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [logPath, root] = process.argv.slice(2);
  assert.equal(process.argv.length, 4, 'native_mechanics_arguments_invalid');
  assert.ok(path.isAbsolute(logPath) && path.isAbsolute(root), 'native_mechanics_paths_invalid');
  const sourceHashes = Object.fromEntries(Object.entries(mechanicsSources).map(([name, relative]) =>
    [name, createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')]));
  console.log(JSON.stringify(verifyNativeConsentMechanicsProof(fs.readFileSync(logPath, 'utf8'),
    { runId: process.env.GITHUB_RUN_ID, sourceHashes })));
}
