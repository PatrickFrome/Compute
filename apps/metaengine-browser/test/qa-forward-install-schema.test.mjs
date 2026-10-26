import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { EMPTY_SCHEMA_INPUT_PATHS, EMPTY_SCHEMA_EXPORTER_PATHS }
  from '../../../infra/client-state-runtime/canonical-empty-schema-contract.mjs';
import { FORWARD_SCHEMA_MANIFEST, FORWARD_SCHEMA_WORKFLOW, FORWARD_SCHEMA_REPOSITORY, FORWARD_SCHEMA_FILES,
  forwardSchemaArtifactName, validateForwardSchemaPin, validateForwardSchemaManifest, assertForwardSchemaQualification,
  inspectForwardSchemaToc, validateForwardSchemaToc, validateForwardSchemaFixtureDescriptor,
  assertForwardSchemaRuntimeCompatibility, verifyForwardSchemaDirectory } from '../scripts/qa-forward-install-schema.mjs';
import { validateForwardSchemaFixture } from '../scripts/qa-forward-install-fixture.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const schemaHead = 'a'.repeat(40), exporterHead = 'b'.repeat(40), sha = 'c'.repeat(64);
const toc = ['; Archive created at 2026-10-26 00:00:00',
  '; Format: CUSTOM', '; Dumped from database version: 17.11', '; Dumped by pg_dump version: 17.11',
  '10; 1262 5 DATABASE - postgres state_owner',
  '1; 2615 2200 SCHEMA - public pg_database_owner',
  '2; 1255 20001 FUNCTION public reviewed_read_v1(uuid) state_owner',
  '3; 1255 20002 FUNCTION public reviewed_write_v1(uuid, text) state_owner',
  '4; 1259 20003 TABLE public reviewed_state state_owner',
  '5; 1259 20004 SEQUENCE public reviewed_state_id_seq state_owner',
  '6; 0 0 ACL public FUNCTION reviewed_read_v1(uuid) state_owner',
  '7; 826 20005 DEFAULT ACL - DEFAULT PRIVILEGES FOR FUNCTIONS state_owner',
].join('\n') + '\n';

function values() {
  // All source/blob/SQL metadata below is inert contract-test data. No test
  // exports a usable dump, publishes a receipt or claims native qualification.
  const archive = Buffer.concat([Buffer.from('PGDMP'), Buffer.from([1, 16, 0, 4, 8, 1, 0]), Buffer.from('inert source-test fixture')]);
  const records = names => names.slice().sort().map(file => {
    const bytes = Buffer.from('inert unit source ' + file);
    return { path: file, bytes: bytes.length, sha256: digest(bytes),
      git_blob_sha1: createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex') };
  });
  const schemaInputs = records([...EMPTY_SCHEMA_INPUT_PATHS, 'supabase/migrations/reviewed_unit_source.sql',
    'infra/client-state-runtime/reviewed_unit_upgrade.sql']);
  const exporterInputs = records(EMPTY_SCHEMA_EXPORTER_PATHS);
  const resource = name => schemaInputs.find(row => row.path === 'infra/client-state-runtime/' + name).sha256;
  const tocReceipt = inspectForwardSchemaToc(toc);
  const pin = { schema_source_head: schemaHead, exporter_source_head: exporterHead,
    source_plan_sha256: sha, upgrade_sources_sha256: 'd'.repeat(64), archive_sha256: digest(archive), toc_sha256: tocReceipt.normalized_sha256,
    qualification: { repository: FORWARD_SCHEMA_REPOSITORY, workflow: FORWARD_SCHEMA_WORKFLOW,
      source_head: exporterHead, run_id: '12345', run_attempt: 2,
      artifact: { id: '23456', name: forwardSchemaArtifactName(schemaHead, exporterHead), sha256: 'e'.repeat(64) } } };
  const sourcePlan = { candidate_sha256: resource('fresh-schema-candidate-plan.json'),
    selection_sha256: resource('fresh-schema-statement-selection.json'), source_manifest_sha256: pin.source_plan_sha256,
    upgrade_sources_sha256: pin.upgrade_sources_sha256, prerequisite_sha256: resource('fresh-schema-prerequisites-v1.sql'),
    post_upgrade_acl_sha256: resource('fresh-schema-private-acl-v1.sql'),
    ordered_baseline_applications: 1, unique_baseline_sources: 1, upgrade_resources: 1, exact_rpc_signatures: 2 };
  const native = { postgres_version_num: 170011,
    catalogue_check: { schema: 'compute.fresh-schema-catalogue.v1', exact_rpc_signatures: 2, rest_tables: 1, rest_columns: 3,
      excluded_legacy_entrypoints_absent: true, public_function_execute: false, default_environment_fenced: true,
      runtime_ready: false, automatic_population_required: true },
    catalogue_sha256: '1'.repeat(64), acl_sha256: '2'.repeat(64), table_rows_sha256: '3'.repeat(64), sequence_state_sha256: '4'.repeat(64),
    empty_tables: 1, application_rows: 0, sequences: 1, toc: tocReceipt, archive_sha256: pin.archive_sha256, archive_bytes: archive.length,
    source_manifest_sha256: sourcePlan.source_manifest_sha256, selection_sha256: sourcePlan.selection_sha256,
    upgrade_sources_sha256: sourcePlan.upgrade_sources_sha256, prerequisite_sha256: sourcePlan.prerequisite_sha256,
    post_upgrade_acl_sha256: sourcePlan.post_upgrade_acl_sha256, classification: 'NATIVE_PG17',
    status: 'CANONICAL_EMPTY_SCHEMA_ROUNDTRIP_PASSED', production_qualified: false, runtime_ready: false,
    owner_enrollment_qualified: false, application_rows_seeded: false, independent_disposable_clusters: 2,
    independent_identities_verified: true, source_identity_sha256: '5'.repeat(64), restore_identity_sha256: '6'.repeat(64),
    cleanup_complete: true,
    pg_tools: ['initdb', 'pg_ctl', 'pg_controldata', 'postgres', 'pg_dump', 'pg_restore'].map(name =>
      ({ name: name + '.exe', bytes: 100, sha256: digest(name), version: '17.11' })),
    pg_tool_version: '17.11', binary_pin_scope: 'LISTED_PG_EXECUTABLES_ONLY_NOT_A_RUNTIME_BUNDLE',
    restored_catalogue_sha256: '1'.repeat(64), restored_acl_sha256: '2'.repeat(64) };
  const manifest = { schema: FORWARD_SCHEMA_MANIFEST, application_mode: 'ATOMIC_SLICE',
    artifact_kind: 'REVIEWED_CANONICAL_EMPTY_SCHEMA_FIXTURE', schema_only: true, custom_archive: true,
    owner_commands_restored: false, acl_preserved: true, installed_data_exported: false,
    installation_authorized: false, production_qualified: false, runtime_ready: false,
    schema_source_head: schemaHead, exporter_source_head: exporterHead, schema_inputs_equal_at_both_heads: true,
    actual_working_bytes_verified: true, schema_inputs: schemaInputs, schema_inputs_sha256: digest(JSON.stringify(schemaInputs)),
    exporter_inputs: exporterInputs, exporter_inputs_sha256: digest(JSON.stringify(exporterInputs)), source_plan: sourcePlan,
    archive: { file: FORWARD_SCHEMA_FILES.archive, sha256: pin.archive_sha256, bytes: archive.length }, qualification: native };
  const run = { id: 12345, repository: { full_name: FORWARD_SCHEMA_REPOSITORY }, path: FORWARD_SCHEMA_WORKFLOW,
    head_sha: exporterHead, run_attempt: 2, run_number: 12, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
    run_started_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:05:00Z' };
  const artifact = { id: 23456, name: pin.qualification.artifact.name, expired: false, digest: 'sha256:' + pin.qualification.artifact.sha256,
    size_in_bytes: 1024, workflow_run: { id: run.id, head_sha: run.head_sha }, created_at: '2026-10-26T00:04:00Z' };
  return { archive, pin, manifest, run, artifacts: { total_count: 1, artifacts: [artifact] } };
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forward-schema-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'schema'); await fs.mkdir(directory);
  const input = values(), manifestBytes = Buffer.from(JSON.stringify(input.manifest) + '\n');
  await fs.writeFile(path.join(directory, FORWARD_SCHEMA_FILES.manifest), manifestBytes);
  await fs.writeFile(path.join(directory, FORWARD_SCHEMA_FILES.archive), input.archive);
  return { ...input, root, directory, manifestSha256: digest(manifestBytes) };
}
async function replaceManifest(input) {
  const bytes = Buffer.from(JSON.stringify(input.manifest) + '\n');
  input.manifestSha256 = digest(bytes);
  await fs.writeFile(path.join(input.directory, FORWARD_SCHEMA_FILES.manifest), bytes);
}

test('canonical schema and exporter retain distinct exact sources and independently pinned workflow origin', () => {
  const { pin } = values(); assert.deepEqual(validateForwardSchemaPin(pin), pin);
  for (const change of [p => p.schema_source_head = 'main', p => p.exporter_source_head = 'latest',
    p => p.source_plan_sha256 = '', p => p.upgrade_sources_sha256 = 'unknown', p => p.archive_sha256 = '',
    p => p.qualification.source_head = schemaHead, p => p.qualification.run_id = 12345, p => p.qualification.run_attempt = 0,
    p => p.qualification.repository = 'other/repo', p => p.qualification.workflow = '.github/workflows/browser-windows-package-smoke.yml',
    p => p.qualification.artifact.name = 'old-predecessor-sidecar', p => p.qualification.artifact.id = 'latest',
    p => p.qualification.artifact.sha256 = '', p => p.verified = true]) {
    const changed = structuredClone(pin); change(changed); assert.throws(() => validateForwardSchemaPin(changed), /qa_forward_schema_/);
  }
});

test('actual writer schema rejects another canonical plan, synthetic claims, restored owner commands or authority', () => {
  const { pin, manifest } = values(); assert.equal(validateForwardSchemaManifest(manifest, pin), manifest);
  for (const change of [m => m.schema = 'metaengine.browser.reviewed-empty-schema.v1', m => m.application_mode = 'HISTORICAL_CANDIDATE',
    m => m.schema_source_head = 'f'.repeat(40), m => m.exporter_source_head = schemaHead,
    m => m.source_plan.source_manifest_sha256 = 'f'.repeat(64), m => m.source_plan.upgrade_sources_sha256 = 'f'.repeat(64),
    m => m.artifact_kind = 'SYNTHETIC_CATALOG', m => m.synthetic_rpc_bodies = true, m => m.installed_data_exported = true,
    m => m.schema_only = false, m => m.custom_archive = false, m => m.owner_commands_restored = true,
    m => m.acl_preserved = false, m => m.installation_authorized = true, m => m.production_qualified = true,
    m => m.qualification = pin.qualification, m => m.archive.sha256 = 'f'.repeat(64), m => m.archive.file = '../outside.dump']) {
    const changed = structuredClone(manifest); change(changed);
    assert.throws(() => validateForwardSchemaManifest(changed, pin), /qa_forward_schema_/);
  }
});

test('full source/exporter Git blob closures have exact sorted records, separate digests and plan-resource links', () => {
  const { pin, manifest } = values();
  for (const change of [m => m.schema_inputs_equal_at_both_heads = false, m => m.actual_working_bytes_verified = false,
    m => m.schema_inputs.reverse(), m => m.exporter_inputs.reverse(), m => m.schema_inputs.pop(),
    m => m.exporter_inputs.pop(), m => m.schema_inputs.push(m.schema_inputs[0]), m => m.schema_inputs[0].path = '../escape.sql',
    m => m.schema_inputs[0].sha256 = 'f'.repeat(64), m => m.schema_inputs[0].git_blob_sha1 = 'main',
    m => m.exporter_inputs[0].sha256 = 'f'.repeat(64), m => m.source_plan.prerequisite_sha256 = 'f'.repeat(64),
    m => m.schema_inputs_sha256 = 'f'.repeat(64), m => m.exporter_inputs_sha256 = 'f'.repeat(64)]) {
    const changed = structuredClone(manifest); change(changed);
    assert.throws(() => validateForwardSchemaManifest(changed, pin), /qa_forward_schema_/);
  }
});

test('native receipt requires two independent PG17 clusters, matching function/ACL catalogues and zero rows', () => {
  const { pin, manifest } = values();
  for (const patch of [{ status: 'PENDING' }, { classification: 'WASM_SQL18_ONLY' }, { postgres_version_num: 180000 },
    { source_manifest_sha256: 'f'.repeat(64) }, { empty_tables: 0 }, { application_rows: 1 }, { application_rows_seeded: true },
    { cleanup_complete: false }, { independent_disposable_clusters: 1 }, { independent_identities_verified: false },
    { restore_identity_sha256: manifest.qualification.source_identity_sha256 }, { restored_catalogue_sha256: 'f'.repeat(64) },
    { restored_acl_sha256: 'f'.repeat(64) }, { runtime_ready: true }, { owner_enrollment_qualified: true },
    { pg_tools: [] }, { binary_pin_scope: 'FULL_RUNTIME_BUNDLE' }]) {
    assert.throws(() => validateForwardSchemaManifest({ ...manifest, qualification: { ...manifest.qualification, ...patch } }, pin), /qa_forward_schema_/);
  }
  for (const patch of [{ data_entries: 1 }, { sequence_set_entries: 1 }, { temporary_api_or_fixture_objects: 1 },
    { acl_preserved: false }, { database_creation_restored: true }, { normalized_sha256: 'f'.repeat(64) }]) {
    const changed = structuredClone(manifest); Object.assign(changed.qualification.toc, patch);
    assert.throws(() => validateForwardSchemaManifest(changed, pin), /qa_forward_schema_/);
  }
});

test('native evidence cannot impersonate an original producer, other-source or nonterminal independent workflow', () => {
  const input = values(); assert.equal(assertForwardSchemaQualification(input), input.artifacts.artifacts[0]);
  for (const patch of [{ status: 'in_progress' }, { conclusion: 'failure' }, { head_sha: schemaHead }, { run_attempt: 1 },
    { id: 40382079975 }, { path: '.github/workflows/browser-windows-package-smoke.yml' },
    { repository: { full_name: 'other/repo' } }, { run_number: 0 }, { event: 'untrusted' }]) {
    assert.throws(() => assertForwardSchemaQualification({ ...input, run: { ...input.run, ...patch } }), /qualification_not_exact_terminal_success/);
  }
});

test('only a complete unambiguous artifact list can bind the exact independent qualifier artifact', () => {
  const input = values(), original = input.artifacts.artifacts[0];
  for (const artifacts of [{ total_count: 2, artifacts: [original] }, { total_count: 1, artifacts: [] },
    { total_count: 2, artifacts: [original, { ...original }] }, { total_count: 2, artifacts: [original, { ...original, id: 23457 }] },
    { total_count: 1, artifacts: [{ ...original, name: original.name + '-wrong' }] }]) {
    assert.throws(() => assertForwardSchemaQualification({ ...input, artifacts }), /artifact_list_/);
  }
  for (const patch of [{ expired: true }, { digest: 'sha256:' + sha }, { size_in_bytes: 0 },
    { workflow_run: { id: 12344, head_sha: exporterHead } }, { workflow_run: { id: 12345, head_sha: schemaHead } },
    { created_at: '2026-10-25T00:00:00Z' }, { created_at: '2026-10-27T00:00:00Z' }]) {
    assert.throws(() => assertForwardSchemaQualification({ ...input,
      artifacts: { total_count: 1, artifacts: [{ ...original, ...patch }] } }), /artifact_binding_mismatch/);
  }
});

test('authoritative normalized TOC hash ignores headers/comments/object IDs and retains all semantic entries', () => {
  const { pin, manifest } = values(), expectedReceipt = manifest.qualification.toc;
  let id = 100;
  const decorated = toc.replace('2026-10-26 00:00:00', 'different textual header')
    .replace(/^\d+;\s+\d+\s+\d+\s+/gm, () => String(id++) + '; 0 0 ').replaceAll('\n', '\r\n');
  const observed = validateForwardSchemaToc(decorated, pin.toc_sha256, { expectedReceipt });
  assert.equal(observed.normalized_sha256, pin.toc_sha256); assert.notEqual(observed.raw_sha256, expectedReceipt.raw_sha256);
  const changedVersion = toc.replaceAll('17.11', '17.10');
  assert.throws(() => validateForwardSchemaToc(changedVersion, pin.toc_sha256, { expectedReceipt }), /toc_receipt_mismatch/);
  for (const invalid of [Buffer.from([255, 254, 255]), '\ufeff' + toc, toc + '\0'])
    assert.throws(() => inspectForwardSchemaToc(invalid), /toc_encoding_invalid/);
});

test('self-extracted identities add no source proof: missing, extra or changed identities fail the EXTERNAL normalized pin', () => {
  const { pin } = values();
  const altered = [toc.replace('reviewed_write_v1(uuid, text)', 'reviewed_other_v1(uuid, text)'),
    toc.replace(/^3;.*\n/m, ''), toc + '20; 1255 29999 FUNCTION public extra_function() state_owner\n',
    toc.replace('TABLE public reviewed_state ', 'TABLE public other_state '), toc.replace(/^5;.*\n/m, ''),
    toc + '20; 1259 29999 TABLE public extra_table state_owner\n'];
  for (const text of altered) {
    // Parsing this same list can still succeed; it cannot establish that it is
    // the canonical source catalogue. The independent pin must reject it.
    assert.doesNotThrow(() => inspectForwardSchemaToc(text));
    assert.throws(() => validateForwardSchemaToc(text, pin.toc_sha256), /toc_digest_mismatch/);
  }
});

test('shared parser rejects data, sequence state, external effects, probes, missing ACL and malformed PG17 archives', () => {
  const { pin } = values();
  for (const suffix of ['TABLE DATA public reviewed_state state_owner', 'SEQUENCE SET public reviewed_state_id_seq state_owner',
    'BLOB - 17 state_owner', 'FOREIGN TABLE public foreign_state state_owner', 'EVENT TRIGGER - event state_owner',
    'FUNCTION public synthetic_rpc() state_owner', 'FUNCTION public atomic_fresh_api() state_owner']) {
    assert.throws(() => validateForwardSchemaToc(toc + '20; 0 0 ' + suffix + '\n', pin.toc_sha256), /canonical_toc_invalid/);
  }
  for (const text of [toc.replace(/^6;.*\n/m, ''), toc.replace(/^7;.*\n/m, ''), toc.replaceAll('17.11', '18.1'),
    toc.replace('DATABASE - postgres', 'DATABASE - user_database'), toc + '1; 0 0 COMMENT - SCHEMA public state_owner\n']) {
    assert.throws(() => validateForwardSchemaToc(text, pin.toc_sha256), /canonical_toc_invalid/);
  }
});

test('two canonical writer files produce a descriptor retaining every source record and separate native/workflow evidence', async t => {
  const input = await fixture(t), result = await verifyForwardSchemaDirectory(input);
  assert.deepEqual((await fs.readdir(input.directory)).sort(), ['canonical-empty-schema-manifest.json', 'canonical-empty-schema.dump']);
  assert.equal(result.file, path.join(input.directory, FORWARD_SCHEMA_FILES.archive));
  assert.equal(result.archive_sha256, input.pin.archive_sha256); assert.equal(result.archive_bytes, input.archive.length);
  assert.equal(result.source_head, undefined); assert.equal(result.toc_file, undefined); assert.equal(result.physical_migration_qualified, undefined);
  assert.deepEqual(result.canonical_manifest, input.manifest); assert.deepEqual(result.qualification, input.pin.qualification);
  assert.notEqual(result.qualification, result.canonical_manifest.qualification);
  assert(Object.isFrozen(result.canonical_manifest.schema_inputs)); assert(Object.isFrozen(result.canonical_manifest.qualification));
  assert.equal(validateForwardSchemaFixtureDescriptor(result).manifest_sha256, input.manifestSha256);
  assert.equal(validateForwardSchemaFixture(result).archive_sha256, result.archive_sha256);
  assert.equal(assertForwardSchemaRuntimeCompatibility(result, input.pin.upgrade_sources_sha256), true);
  assert.throws(() => assertForwardSchemaRuntimeCompatibility(result, sha), /predecessor_upgrade_closure_mismatch/);
});

test('extracted manifest and internally consistent replacement source records cannot inherit the pinned ZIP origin', async t => {
  const input = await fixture(t);
  await assert.rejects(verifyForwardSchemaDirectory({ ...input, manifestSha256: undefined }), /archive_manifest_pin_required/);
  input.manifest.exporter_inputs[0].sha256 = 'f'.repeat(64);
  input.manifest.exporter_inputs_sha256 = digest(JSON.stringify(input.manifest.exporter_inputs));
  await fs.writeFile(path.join(input.directory, FORWARD_SCHEMA_FILES.manifest), JSON.stringify(input.manifest));
  await assert.rejects(verifyForwardSchemaDirectory(input), /manifest_archive_binding_mismatch/);
});

test('changed dump or canonical manifest invalidates a previously routed fixture', async t => {
  const input = await fixture(t);
  for (const name of Object.values(FORWARD_SCHEMA_FILES)) {
    const file = path.join(input.directory, name), original = await fs.readFile(file);
    await fs.appendFile(file, 'changed'); await assert.rejects(verifyForwardSchemaDirectory(input), /qa_forward_schema_/);
    await fs.writeFile(file, original);
  }
  input.manifest.source_plan.source_manifest_sha256 = 'f'.repeat(64); await replaceManifest(input);
  await assert.rejects(verifyForwardSchemaDirectory(input), /canonical_plan_mismatch/);
});

test('extra files, old standalone TOC and directory aliases cannot enter the canonical two-file artifact', async t => {
  const input = await fixture(t), extra = path.join(input.directory, 'reviewed-empty-schema.toc');
  await fs.writeFile(extra, toc); await assert.rejects(verifyForwardSchemaDirectory(input), /schema_file_set_invalid/);
  await fs.unlink(extra);
  const alias = path.join(input.root, 'archive-alias'); await fs.link(path.join(input.directory, FORWARD_SCHEMA_FILES.archive), alias);
  await assert.rejects(verifyForwardSchemaDirectory(input), /path_alias_forbidden/); await fs.unlink(alias);
  const linkedDirectory = path.join(input.root, 'schema-alias');
  await fs.symlink(input.directory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyForwardSchemaDirectory({ ...input, directory: linkedDirectory }), /path_alias_forbidden/);
});

test('malformed custom archive cannot pass even when a new manifest and supplied digest are internally consistent', async t => {
  const input = await fixture(t), bytes = Buffer.from(input.archive); bytes[10] = 3;
  await fs.writeFile(path.join(input.directory, FORWARD_SCHEMA_FILES.archive), bytes);
  input.pin.archive_sha256 = digest(bytes); input.manifest.archive.sha256 = digest(bytes);
  input.manifest.qualification.archive_sha256 = digest(bytes); await replaceManifest(input);
  await assert.rejects(verifyForwardSchemaDirectory(input), /schema_archive_unbound/);
});

test('missing filesystem state produces only a bounded error, without private path disclosure', async t => {
  const input = await fixture(t), privatePath = path.join(input.root, 'private-missing-schema');
  await assert.rejects(verifyForwardSchemaDirectory({ ...input, directory: privatePath }), error =>
    error.message === 'qa_forward_schema_directory_readback_unverified' && !error.message.includes(privatePath));
});
