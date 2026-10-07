import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { qualifyR83V30Source, validateR83V30Manifest } from '../r83-v30-source-qualification.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = () => JSON.parse(fs.readFileSync(path.join(repoRoot,
  'coordination/convergence/R83_EDGE_CANARY_V30_SOURCE_QUALIFICATION_V1.json'), 'utf8'));

test('v30 backend and installed frozen client qualify only as a static pair', () => {
  const result = qualifyR83V30Source({ repoRoot, manifest: manifest() });
  assert.equal(result.state, 'STATIC_QUALIFIED_LIVE_GATES_OPEN');
  assert.equal(result.backend_source, '6aeea9f68fa91ef38f4d0aea4eddaf1e4d29c0f9');
  assert.equal(result.installed_client_source, 'be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c');
  assert.notEqual(result.backend_source, result.installed_client_source);
  assert.equal(result.live_qualification_completed, false);
  assert.equal(result.promotion_authorized, false);
  assert.equal(result.automatic_promotion_allowed, false);
  assert.equal(result.authority_effect, false);
});

const corruptions = [
  ['historical v27 cannot replace this lineage', m => { m.candidate.deployed_version = 27; }],
  ['another backend SHA cannot reuse the v30 digest', m => { m.candidate.source_pin = m.installed_client.source_head; }],
  ['another deployment digest cannot reuse the v30 lineage', m => { m.candidate.ezbr_sha256 = 'a'.repeat(64); }],
  ['another project cannot reuse this observation', m => { m.project_ref = 'xpeibufgzjknrhbhpffp'; }],
  ['mixed candidate import pins require new qualification', m => { m.candidate.observed_import_pins.push(m.installed_client.source_head); }],
  ['missing candidate binding fails closed', m => { m.candidate.source_binding_complete = false; }],
  ['another installed installer cannot reuse the pair', m => { m.installed_client.installer_sha256 = 'a'.repeat(64); }],
  ['another installed client source cannot reuse the pair', m => { m.installed_client.source_head = m.candidate.source_pin; }],
  ['another client version cannot reuse the pair', m => { m.installed_client.package_version = '0.7.0-dev.37493000002.1'; }],
  ['another stable digest invalidates rollback', m => { m.stable.ezbr_sha256 = 'a'.repeat(64); }],
  ['another rollback digest is not an exact clone', m => { m.rollback.ezbr_sha256 = 'a'.repeat(64); }],
  ['an undeployed rollback cannot qualify', m => { m.rollback.rollback_snapshot_deployed = false; }],
  ['duplicate rollback pins are rejected', m => { m.rollback.observed_import_pins.push(m.rollback.observed_import_pins[0]); }],
  ['malformed rollback pins are rejected', m => { m.rollback.observed_import_pins[0] = 'main'; }],
  ['source manifest cannot mark live qualification completed', m => { m.live_qualification.completed = true; }],
  ['source manifest cannot record a successful live test', m => { m.live_evidence.completed = true; }],
  ['source manifest cannot record a rollback drill', m => { m.live_evidence.rollback_drill_completed = true; }],
  ['live evidence must remain external', m => { m.live_evidence.recorded_in_source_manifest = true; }],
  ['post-evidence manifest mutation is forbidden', m => { m.evidence_policy.source_manifest_mutation_after_live_evidence = true; }],
  ['external evidence must bind backend and installed client', m => { m.evidence_policy.live_evidence_must_bind_exact_backend_and_client_subjects = false; }],
  ['static qualification cannot grant promotion', m => { m.promotion_authorized = true; }],
  ['static qualification cannot grant automatic promotion', m => { m.automatic_promotion_allowed = true; }],
  ['static qualification cannot grant effects', m => { m.authority_effect = true; }],
  ['missing capability is rejected', m => { m.required_capabilities.pop(); }],
  ['duplicate import bindings are rejected', m => { m.candidate.imports.push(m.candidate.imports[0]); }],
  ['path traversal cannot leave the exact Edge root', m => { m.candidate.imports[0].path += '/../extra.mjs'; }],
];
for (const [name, corrupt] of corruptions) test(name, () => {
  const m = manifest(); corrupt(m);
  assert.throws(() => validateR83V30Manifest(m), /^Error: r83_v30_/);
});
for (const gate of ['signed_health_required', 'installed_electron_signed_e2e_required',
  'bounded_durable_lease_readback_required', 'result_receipt_readback_required', 'rollback_drill_required']) {
  test(`required live gate cannot be disabled: ${gate}`, () => {
    const m = manifest(); m.live_qualification[gate] = false;
    assert.throws(() => validateR83V30Manifest(m), new RegExp(`r83_v30_gate_${gate}`));
  });
}
test('a plausible but false root blob fails the actual Git readback', () => {
  const m = manifest(); m.candidate.index_git_blob_sha1 = 'a'.repeat(40);
  assert.throws(() => qualifyR83V30Source({ repoRoot, manifest: m }), /r83_v30_root_blob_mismatch/);
});
test('a plausible but false module blob fails the actual Git readback', () => {
  const m = manifest(); m.candidate.imports[0].git_blob_sha1 = 'a'.repeat(40);
  assert.throws(() => qualifyR83V30Source({ repoRoot, manifest: m }), /r83_v30_import_blob_mismatch/);
});
test('omitting a real imported module fails actual source closure readback', () => {
  const m = manifest(); m.candidate.imports.pop();
  assert.throws(() => qualifyR83V30Source({ repoRoot, manifest: m }), /r83_v30_source_import_closure_mismatch/);
});
