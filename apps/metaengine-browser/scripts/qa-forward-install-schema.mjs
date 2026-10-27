// Read-only consumer for a separately qualified canonical, empty PG17 schema.
// Reviewed pins come from the coordinator, never from the current migration
// target. The caller must additionally bind these files to the pinned artifact
// ZIP on every revalidation; this helper does not acquire or execute a dump.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EMPTY_SCHEMA_FILES, EMPTY_SCHEMA_INPUT_PATHS, EMPTY_SCHEMA_EXPORTER_PATHS,
  EMPTY_SCHEMA_MAX_ARCHIVE_BYTES, EMPTY_SCHEMA_MAX_COMMAND_BYTES, validateEmptySchemaToc }
  from '../../../infra/client-state-runtime/canonical-empty-schema-contract.mjs';
import { assertPublishableEmptySchemaEvidence }
  from '../../../infra/client-state-runtime/export-reviewed-empty-schema.mjs';

export const FORWARD_SCHEMA_MANIFEST = 'compute.reviewed-empty-schema-export.v1';
export const FORWARD_SCHEMA_WORKFLOW = '.github/workflows/client-reviewed-empty-schema.yml';
export const FORWARD_SCHEMA_REPOSITORY = 'PatrickFrome/Compute';
export const FORWARD_SCHEMA_FILES = EMPTY_SCHEMA_FILES;
const SHA = /^[a-f0-9]{64}$/, HEAD = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]{0,19}$/;
const MAX_ARCHIVE = EMPTY_SCHEMA_MAX_ARCHIVE_BYTES, MAX_TOC = EMPTY_SCHEMA_MAX_COMMAND_BYTES, MAX_MANIFEST = 1024 ** 2;
const MAX_ARTIFACT = 2 * 1024 ** 3;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { const error = new Error('qa_forward_schema_' + code); error.code = error.message; throw error; };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => record(value) && Object.keys(value).length === allowed.length
  && Object.keys(value).every(key => allowed.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const pg17 = value => Number.isSafeInteger(value) && value >= 170000 && value < 180000;
const localPath = value => typeof value === 'string' && path.isAbsolute(value)
  && !/^(?:\\\\|\/\/)/.test(value) && !/[\x00-\x1f]/.test(value);
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameFile = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs
  && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;

export function forwardSchemaArtifactName(schemaSourceHead, exporterSourceHead) {
  if (!HEAD.test(schemaSourceHead || '') || !HEAD.test(exporterSourceHead || '')) fail('source_pin_invalid');
  return 'metaengine-reviewed-empty-schema-' + schemaSourceHead + '-' + exporterSourceHead;
}

export function validateForwardSchemaPin(value) {
  if (!keys(value, ['schema_source_head', 'exporter_source_head', 'source_plan_sha256',
    'upgrade_sources_sha256', 'archive_sha256', 'toc_sha256', 'qualification'])
    || !HEAD.test(value.schema_source_head || '') || !HEAD.test(value.exporter_source_head || '')
    || !['source_plan_sha256', 'upgrade_sources_sha256', 'archive_sha256', 'toc_sha256'].every(key => SHA.test(value[key] || '')))
    fail('reviewed_pins_required');
  const qualifier = value.qualification;
  if (!keys(qualifier, ['repository', 'workflow', 'source_head', 'run_id', 'run_attempt', 'artifact'])
    || qualifier.repository !== FORWARD_SCHEMA_REPOSITORY || qualifier.workflow !== FORWARD_SCHEMA_WORKFLOW
    || qualifier.source_head !== value.exporter_source_head || typeof qualifier.run_id !== 'string' || !ID.test(qualifier.run_id)
    || !positive(qualifier.run_attempt)) fail('qualification_pin_invalid');
  const artifact = qualifier.artifact;
  if (!keys(artifact, ['id', 'name', 'sha256']) || typeof artifact.id !== 'string' || !ID.test(artifact.id)
    || artifact.name !== forwardSchemaArtifactName(value.schema_source_head, value.exporter_source_head)
    || !SHA.test(artifact.sha256 || '')) fail('artifact_pin_invalid');
  return { schema_source_head: value.schema_source_head, exporter_source_head: value.exporter_source_head,
    source_plan_sha256: value.source_plan_sha256, upgrade_sources_sha256: value.upgrade_sources_sha256,
    archive_sha256: value.archive_sha256, toc_sha256: value.toc_sha256,
    qualification: { repository: qualifier.repository, workflow: qualifier.workflow, source_head: qualifier.source_head,
      run_id: qualifier.run_id, run_attempt: qualifier.run_attempt,
      artifact: { id: artifact.id, name: artifact.name, sha256: artifact.sha256 } } };
}

function validateSourceRecords(records, expectedSha256, { exporter = false } = {}) {
  if (!Array.isArray(records) || !records.length || records.length > EMPTY_SCHEMA_INPUT_PATHS.length + 256
    || !SHA.test(expectedSha256 || '')) fail('source_records_invalid');
  const canonical = [], seen = new Set(); let previous = '';
  for (const row of records) {
    if (!keys(row, ['path', 'bytes', 'sha256', 'git_blob_sha1']) || typeof row.path !== 'string'
      || !/^[A-Za-z0-9_./-]+$/.test(row.path) || row.path.length > 512
      || row.path.split('/').some(part => !part || part === '.' || part === '..') || row.path <= previous
      || seen.has(row.path) || !positive(row.bytes) || row.bytes > EMPTY_SCHEMA_MAX_COMMAND_BYTES
      || !SHA.test(row.sha256 || '') || !HEAD.test(row.git_blob_sha1 || '')) fail('source_records_invalid');
    if (exporter ? !EMPTY_SCHEMA_EXPORTER_PATHS.includes(row.path)
      : !EMPTY_SCHEMA_INPUT_PATHS.includes(row.path)
        && !/^(?:supabase\/migrations|infra\/client-state-runtime)\/[A-Za-z0-9_-]+\.sql$/.test(row.path))
      fail('source_records_scope_invalid');
    seen.add(row.path); previous = row.path;
    canonical.push({ path: row.path, bytes: row.bytes, sha256: row.sha256, git_blob_sha1: row.git_blob_sha1 });
  }
  const required = exporter ? EMPTY_SCHEMA_EXPORTER_PATHS : EMPTY_SCHEMA_INPUT_PATHS;
  if (required.some(file => !seen.has(file)) || (exporter && records.length !== required.length)
    || hash(JSON.stringify(canonical)) !== expectedSha256) fail('source_records_digest_mismatch');
  return canonical;
}

function validateSourcePlan(plan, manifest, pin) {
  const hashes = ['candidate_sha256', 'selection_sha256', 'source_manifest_sha256',
    'upgrade_sources_sha256', 'prerequisite_sha256', 'post_upgrade_acl_sha256'];
  if (!keys(plan, [...hashes, 'ordered_baseline_applications', 'unique_baseline_sources',
    'upgrade_resources', 'exact_rpc_signatures']) || !hashes.every(key => SHA.test(plan[key] || ''))
    || plan.source_manifest_sha256 !== pin.source_plan_sha256 || plan.upgrade_sources_sha256 !== pin.upgrade_sources_sha256
    || !positive(plan.ordered_baseline_applications) || plan.ordered_baseline_applications > 128
    || !positive(plan.unique_baseline_sources) || plan.unique_baseline_sources > plan.ordered_baseline_applications
    || !positive(plan.upgrade_resources) || plan.upgrade_resources > 128
    || !positive(plan.exact_rpc_signatures) || plan.exact_rpc_signatures > 10000) fail('canonical_plan_mismatch');
  for (const [field, name] of [['candidate_sha256', 'fresh-schema-candidate-plan.json'],
    ['selection_sha256', 'fresh-schema-statement-selection.json'],
    ['prerequisite_sha256', 'fresh-schema-prerequisites-v1.sql'], ['post_upgrade_acl_sha256', 'fresh-schema-private-acl-v1.sql']]) {
    if (manifest.schema_inputs.find(row => row.path === 'infra/client-state-runtime/' + name)?.sha256 !== plan[field])
      fail('plan_source_record_mismatch');
  }
}

const tocKinds = new Set(['SEQUENCE OWNED BY', 'CHECK CONSTRAINT', 'FK CONSTRAINT', 'DEFAULT ACL', 'ROW SECURITY',
  'DATABASE PROPERTIES', 'SCHEMA', 'EXTENSION', 'COMMENT', 'TYPE', 'DOMAIN', 'FUNCTION', 'TABLE', 'SEQUENCE',
  'DEFAULT', 'INDEX', 'CONSTRAINT', 'TRIGGER', 'POLICY', 'ACL', 'VIEW', 'MATERIALIZED VIEW',
  'ENCODING', 'STDSTRINGS', 'SEARCHPATH', 'DATABASE']);
function validateTocReceipt(toc) {
  if (!keys(toc, ['schema', 'raw_sha256', 'normalized_sha256', 'entries', 'counts', 'database_version',
    'pg_dump_version', 'data_entries', 'sequence_set_entries', 'temporary_api_or_fixture_objects',
    'acl_preserved', 'database_creation_restored']) || toc.schema !== 'compute.canonical-empty-schema-toc.v1'
    || !SHA.test(toc.raw_sha256 || '') || !SHA.test(toc.normalized_sha256 || '') || !positive(toc.entries) || toc.entries > 50000
    || !record(toc.counts) || !Object.keys(toc.counts).length
    || Object.entries(toc.counts).some(([kind, count]) => !tocKinds.has(kind) || !positive(count))
    || Object.values(toc.counts).reduce((sum, value) => sum + value, 0) !== toc.entries
    || toc.counts.DATABASE !== 1 || !positive(toc.counts.FUNCTION) || !positive(toc.counts.TABLE)
    || !positive(toc.counts.ACL) || !positive(toc.counts['DEFAULT ACL'])
    || !/^17\.(?:0|[1-9][0-9]{0,3})$/.test(toc.database_version || '') || toc.pg_dump_version !== toc.database_version
    || toc.data_entries !== 0 || toc.sequence_set_entries !== 0 || toc.temporary_api_or_fixture_objects !== 0
    || toc.acl_preserved !== true || toc.database_creation_restored !== false) fail('canonical_toc_receipt_invalid');
}

function validateNativeQualification(value, manifest, pin) {
  const fields = ['postgres_version_num', 'catalogue_check', 'catalogue_sha256', 'acl_sha256', 'table_rows_sha256',
    'sequence_state_sha256', 'empty_tables', 'application_rows', 'sequences', 'toc', 'archive_sha256', 'archive_bytes',
    'source_manifest_sha256', 'selection_sha256', 'upgrade_sources_sha256', 'prerequisite_sha256', 'post_upgrade_acl_sha256',
    'classification', 'status', 'production_qualified', 'runtime_ready', 'owner_enrollment_qualified', 'application_rows_seeded',
    'independent_disposable_clusters', 'independent_identities_verified', 'source_identity_sha256', 'restore_identity_sha256',
    'cleanup_complete', 'pg_tools', 'pg_tool_version', 'binary_pin_scope', 'restored_catalogue_sha256', 'restored_acl_sha256'];
  if (!keys(value, fields) || value.classification !== 'NATIVE_PG17' || value.status !== 'CANONICAL_EMPTY_SCHEMA_ROUNDTRIP_PASSED'
    || !pg17(value.postgres_version_num) || !['production_qualified', 'runtime_ready', 'owner_enrollment_qualified',
      'application_rows_seeded'].every(key => value[key] === false)
    || value.application_rows !== 0 || !positive(value.empty_tables) || value.empty_tables > 10000
    || !Number.isSafeInteger(value.sequences) || value.sequences < 0 || value.sequences > 10000
    || value.independent_disposable_clusters !== 2 || value.independent_identities_verified !== true || value.cleanup_complete !== true
    || !['catalogue_sha256', 'acl_sha256', 'table_rows_sha256', 'sequence_state_sha256',
      'source_identity_sha256', 'restore_identity_sha256'].every(key => SHA.test(value[key] || ''))
    || value.source_identity_sha256 === value.restore_identity_sha256
    || value.restored_catalogue_sha256 !== value.catalogue_sha256 || value.restored_acl_sha256 !== value.acl_sha256
    || value.archive_sha256 !== pin.archive_sha256 || value.archive_bytes !== manifest.archive.bytes
    || !['source_manifest_sha256', 'selection_sha256', 'upgrade_sources_sha256', 'prerequisite_sha256',
      'post_upgrade_acl_sha256'].every(key => value[key] === manifest.source_plan[key])) fail('native_roundtrip_required');
  const catalogue = value.catalogue_check;
  if (!keys(catalogue, ['schema', 'exact_rpc_signatures', 'rest_tables', 'rest_columns', 'excluded_legacy_entrypoints_absent',
    'public_function_execute', 'default_environment_fenced', 'runtime_ready', 'automatic_population_required'])
    || catalogue.schema !== 'compute.fresh-schema-catalogue.v1' || catalogue.exact_rpc_signatures !== manifest.source_plan.exact_rpc_signatures
    || !positive(catalogue.rest_tables) || !positive(catalogue.rest_columns) || catalogue.excluded_legacy_entrypoints_absent !== true
    || catalogue.public_function_execute !== false || catalogue.default_environment_fenced !== true
    || catalogue.runtime_ready !== false || catalogue.automatic_population_required !== true) fail('native_catalogue_unverified');
  validateTocReceipt(value.toc);
  if (value.toc.normalized_sha256 !== pin.toc_sha256 || value.toc.counts.FUNCTION < catalogue.exact_rpc_signatures
    || value.pg_tool_version !== value.toc.database_version
    || value.postgres_version_num !== 170000 + Number(value.pg_tool_version.split('.')[1])
    || value.binary_pin_scope !== 'LISTED_PG_EXECUTABLES_ONLY_NOT_A_RUNTIME_BUNDLE') fail('native_toc_binding_mismatch');
  const names = ['initdb', 'pg_ctl', 'pg_controldata', 'postgres', 'pg_dump', 'pg_restore'];
  if (!Array.isArray(value.pg_tools) || value.pg_tools.length !== names.length) fail('native_tool_binding_invalid');
  for (let index = 0; index < names.length; index++) {
    const tool = value.pg_tools[index];
    if (!keys(tool, ['name', 'bytes', 'sha256', 'version']) || ![names[index], names[index] + '.exe'].includes(tool.name)
      || !positive(tool.bytes) || tool.bytes > 128 * 1024 ** 2 || !SHA.test(tool.sha256 || '')
      || tool.version !== value.pg_tool_version) fail('native_tool_binding_invalid');
  }
  const windows = value.pg_tools[0].name.endsWith('.exe');
  if (value.pg_tools.some(tool => tool.name.endsWith('.exe') !== windows)) fail('native_tool_binding_invalid');
}

export function validateForwardSchemaManifest(value, suppliedPin) {
  const pin = validateForwardSchemaPin(suppliedPin);
  if (!keys(value, ['schema', 'application_mode', 'artifact_kind', 'schema_only', 'custom_archive', 'owner_commands_restored',
    'acl_preserved', 'installed_data_exported', 'installation_authorized', 'production_qualified', 'runtime_ready',
    'schema_source_head', 'exporter_source_head', 'schema_inputs_equal_at_both_heads', 'actual_working_bytes_verified',
    'schema_inputs', 'schema_inputs_sha256', 'exporter_inputs', 'exporter_inputs_sha256', 'source_plan', 'archive', 'qualification'])
    || value.schema !== FORWARD_SCHEMA_MANIFEST || value.application_mode !== 'ATOMIC_SLICE'
    || value.artifact_kind !== 'REVIEWED_CANONICAL_EMPTY_SCHEMA_FIXTURE'
    || !['schema_only', 'custom_archive', 'acl_preserved', 'schema_inputs_equal_at_both_heads',
      'actual_working_bytes_verified'].every(key => value[key] === true)
    || !['owner_commands_restored', 'installed_data_exported', 'installation_authorized', 'production_qualified',
      'runtime_ready'].every(key => value[key] === false)
    || value.schema_source_head !== pin.schema_source_head || value.exporter_source_head !== pin.exporter_source_head)
    fail('canonical_closure_mismatch');
  validateSourceRecords(value.schema_inputs, value.schema_inputs_sha256);
  validateSourceRecords(value.exporter_inputs, value.exporter_inputs_sha256, { exporter: true });
  validateSourcePlan(value.source_plan, value, pin);
  if (!keys(value.archive, ['file', 'sha256', 'bytes']) || value.archive.file !== FORWARD_SCHEMA_FILES.archive
    || value.archive.sha256 !== pin.archive_sha256 || !positive(value.archive.bytes) || value.archive.bytes > MAX_ARCHIVE)
    fail('schema_archive_unbound');
  validateNativeQualification(value.qualification, value, pin);
  return value;
}

// The complete list is independently paged by the acquisition layer. A total
// count and unique IDs prevent a filtered first page from concealing an alias.
export function assertForwardSchemaQualification({ pin: suppliedPin, run, artifacts }) {
  const pin = validateForwardSchemaPin(suppliedPin), qualifier = pin.qualification, expected = qualifier.artifact;
  if (!record(run) || String(run.id) !== qualifier.run_id || run.repository?.full_name !== qualifier.repository
    || run.path !== qualifier.workflow || run.head_sha !== qualifier.source_head || run.run_attempt !== qualifier.run_attempt
    || !positive(run.run_number) || run.status !== 'completed' || run.conclusion !== 'success'
    || !['push', 'pull_request', 'workflow_dispatch'].includes(run.event)
    || !Number.isFinite(Date.parse(run.run_started_at)) || !Number.isFinite(Date.parse(run.updated_at))
    || Date.parse(run.updated_at) < Date.parse(run.run_started_at)) fail('qualification_not_exact_terminal_success');
  if (!record(artifacts) || !Number.isSafeInteger(artifacts.total_count) || artifacts.total_count < 1
    || artifacts.total_count > 10000 || !Array.isArray(artifacts.artifacts)
    || artifacts.total_count !== artifacts.artifacts.length) fail('artifact_list_incomplete');
  const ids = new Set();
  for (const artifact of artifacts.artifacts) {
    if (!record(artifact) || !ID.test(String(artifact.id)) || ids.has(String(artifact.id))
      || typeof artifact.name !== 'string' || !artifact.name) fail('artifact_list_ambiguous');
    ids.add(String(artifact.id));
  }
  const byName = artifacts.artifacts.filter(artifact => artifact.name === expected.name);
  const byId = artifacts.artifacts.filter(artifact => String(artifact.id) === expected.id);
  if (byName.length !== 1 || byId.length !== 1 || byName[0] !== byId[0]) fail('artifact_list_ambiguous');
  const artifact = byId[0];
  if (artifact.expired !== false || artifact.digest !== 'sha256:' + expected.sha256
    || String(artifact.workflow_run?.id) !== qualifier.run_id || artifact.workflow_run?.head_sha !== qualifier.source_head
    || !positive(artifact.size_in_bytes) || artifact.size_in_bytes > MAX_ARTIFACT
    || !Number.isFinite(Date.parse(artifact.created_at)) || Date.parse(artifact.created_at) < Date.parse(run.run_started_at)
    || Date.parse(artifact.created_at) > Date.parse(run.updated_at)) fail('artifact_binding_mismatch');
  return artifact;
}

function readTocText(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : Buffer.isBuffer(value)
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value) : null;
  } catch { fail('toc_encoding_invalid'); }
  if (typeof text !== 'string' || !text || Buffer.byteLength(text) > MAX_TOC || text.startsWith('\ufeff')
    || text.includes('\0') || Buffer.from(text).toString('utf8') !== text) fail('toc_encoding_invalid');
  return text;
}

export function inspectForwardSchemaToc(value) {
  const text = readTocText(value), functionIdentities = [], relationIdentities = [];
  // The writer intentionally omits source identity lists from its public
  // receipt. Recovering tokens here only supplies the shared parser's syntax
  // input; it is NOT independent evidence of source catalogue completeness.
  // That evidence comes from the reviewed writer's native two-cluster
  // qualification and the externally pinned full normalized TOC/dump hashes.
  for (const line of text.split(/\r?\n/)) {
    const match = /^\d+;\s+\d+\s+\d+\s+(FUNCTION|TABLE|SEQUENCE|VIEW|MATERIALIZED VIEW) ([a-z_][a-z_0-9]*) (.+) state_owner$/.exec(line);
    if (match) (match[1] === 'FUNCTION' ? functionIdentities : relationIdentities).push(match[2] + '.' + match[3]);
  }
  try { return validateEmptySchemaToc(text, { functionIdentities, relationIdentities }); }
  catch { fail('canonical_toc_invalid'); }
}

export function validateForwardSchemaToc(value, expectedSha256, { expectedReceipt } = {}) {
  if (!SHA.test(expectedSha256 || '')) fail('toc_pin_invalid');
  const actual = inspectForwardSchemaToc(value);
  if (actual.normalized_sha256 !== expectedSha256) fail('toc_digest_mismatch');
  if (expectedReceipt !== undefined) {
    validateTocReceipt(expectedReceipt);
    if (expectedReceipt.normalized_sha256 !== expectedSha256) fail('toc_digest_mismatch');
    const comparable = receipt => Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'raw_sha256')
      .map(([key, item]) => [key, key === 'counts' ? Object.fromEntries(Object.entries(item).sort()) : item]).sort());
    if (JSON.stringify(comparable(actual)) !== JSON.stringify(comparable(expectedReceipt))) fail('toc_receipt_mismatch');
  }
  return Object.freeze(actual);
}

async function physical(file, directory = false) {
  if (!localPath(file)) fail('local_path_required');
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root;
  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  for (let index = 0; index <= parts.length; index++) {
    if (index) current = path.join(current, parts[index - 1]);
    const isDirectory = index < parts.length || directory, before = await fs.lstat(current, { bigint: true });
    if (before.isSymbolicLink() || before.ino <= 0n
      || (isDirectory ? !before.isDirectory() : !before.isFile() || before.nlink !== 1n)) fail('path_alias_forbidden');
    const resolved = await fs.realpath(current), other = await fs.lstat(resolved, { bigint: true });
    const after = await fs.lstat(current, { bigint: true });
    if (!sameIdentity(before, other) || !sameIdentity(before, after) || other.isSymbolicLink() || after.isSymbolicLink()
      || (isDirectory ? !other.isDirectory() || !after.isDirectory()
        : !other.isFile() || !after.isFile() || other.nlink !== 1n || !sameFile(before, after))) fail('path_changed');
  }
  // Preserve caller spelling on Windows (short temp names are valid aliases
  // when their kernel identity agrees); never relax link/reparse checks.
  return absolute;
}

async function readEvidence(file, maxBytes, collect = false) {
  await physical(file);
  const before = await fs.lstat(file, { bigint: true });
  if (before.size <= 0n || before.size > BigInt(maxBytes)) fail('file_size_invalid');
  const handle = await fs.open(file, 'r');
  const digest = createHash('sha256'), chunks = [];
  let bytes = 0, header = Buffer.alloc(0);
  try {
    if (!sameFile(before, await handle.stat({ bigint: true }))) fail('file_changed');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maxBytes) fail('file_size_invalid');
      if (header.length < 12) header = Buffer.concat([header, chunk]).subarray(0, 12);
      digest.update(chunk);
      if (collect) chunks.push(chunk);
    }
    if (BigInt(bytes) !== before.size || !sameFile(before, await handle.stat({ bigint: true }))) fail('file_changed');
  } finally { await handle.close(); }
  await physical(file);
  if (!sameFile(before, await fs.lstat(file, { bigint: true }))) fail('file_changed');
  return { sha256: digest.digest('hex'), bytes, header, identity: before, ...(collect ? { contents: Buffer.concat(chunks) } : {}) };
}

export function validateForwardSchemaFixtureDescriptor(value) {
  if (!keys(value, ['file', 'sha256', 'archive_sha256', 'archive_bytes', 'toc_sha256', 'schema_source_head', 'exporter_source_head',
    'source_plan_sha256', 'upgrade_sources_sha256', 'qualification', 'manifest_sha256', 'canonical_manifest'])
    || !localPath(value.file) || path.basename(value.file) !== FORWARD_SCHEMA_FILES.archive
    || value.archive_sha256 !== value.sha256 || !positive(value.archive_bytes)
    || value.archive_bytes !== value.canonical_manifest?.archive?.bytes
    || !SHA.test(value.manifest_sha256 || '')) fail('canonical_fixture_required');
  const pin = validateForwardSchemaPin({ schema_source_head: value.schema_source_head, exporter_source_head: value.exporter_source_head,
    source_plan_sha256: value.source_plan_sha256, upgrade_sources_sha256: value.upgrade_sources_sha256,
    archive_sha256: value.sha256, toc_sha256: value.toc_sha256, qualification: value.qualification });
  validateForwardSchemaManifest(value.canonical_manifest, pin);
  const freeze = object => {
    for (const child of Object.values(object)) if (child && typeof child === 'object') freeze(child);
    return Object.freeze(object);
  };
  return freeze({ ...structuredClone(value), file: path.resolve(value.file), qualification: pin.qualification });
}

export function assertForwardSchemaRuntimeCompatibility(schema, upgradeSourcesSha256) {
  const value = validateForwardSchemaFixtureDescriptor(schema);
  if (!SHA.test(upgradeSourcesSha256 || '') || value.upgrade_sources_sha256 !== upgradeSourcesSha256)
    fail('predecessor_upgrade_closure_mismatch');
  return true;
}

export async function verifyForwardSchemaDirectory({ directory, pin: suppliedPin, run, artifacts, manifestSha256 }) {
  try {
    const pin = validateForwardSchemaPin(suppliedPin);
    if (!SHA.test(manifestSha256 || '')) fail('archive_manifest_pin_required');
    assertForwardSchemaQualification({ pin, run, artifacts });
    const root = await physical(directory, true), expectedNames = Object.values(FORWARD_SCHEMA_FILES).sort();
    if (JSON.stringify((await fs.readdir(root)).sort()) !== JSON.stringify(expectedNames)) fail('schema_file_set_invalid');
    const manifestFile = await readEvidence(path.join(root, FORWARD_SCHEMA_FILES.manifest), MAX_MANIFEST, true);
    // The acquisition layer obtains this expected value from the retained,
    // hash-pinned ZIP member. A replacement extracted manifest cannot inherit
    // that artifact's origin merely by remaining structurally valid.
    if (manifestFile.sha256 !== manifestSha256) fail('manifest_archive_binding_mismatch');
    let manifest;
    try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(manifestFile.contents)); }
    catch { fail('manifest_json_invalid'); }
    validateForwardSchemaManifest(manifest, pin);
    const archive = await readEvidence(path.join(root, FORWARD_SCHEMA_FILES.archive), MAX_ARCHIVE, true);
    if (archive.sha256 !== pin.archive_sha256 || archive.bytes !== manifest.archive.bytes
      || archive.header.length < 12 || !archive.header.subarray(0, 5).equals(Buffer.from('PGDMP'))
      || archive.header[10] !== 1) fail('schema_archive_unbound');
    // Reuse the authoritative publisher's archive/native qualification check.
    // No exporter entry point, SQL factory or current-target plan is executed.
    try { assertPublishableEmptySchemaEvidence({ archive: archive.contents, evidence: manifest.qualification }); }
    catch { fail('native_roundtrip_unverified'); }
    if (JSON.stringify((await fs.readdir(root)).sort()) !== JSON.stringify(expectedNames)) fail('schema_file_set_changed');
    for (const [name, evidence] of [[FORWARD_SCHEMA_FILES.manifest, manifestFile], [FORWARD_SCHEMA_FILES.archive, archive]]) {
      const file = path.join(root, name); await physical(file);
      if (!sameFile(evidence.identity, await fs.lstat(file, { bigint: true }))) fail('file_changed');
    }
    await physical(root, true);
    return validateForwardSchemaFixtureDescriptor({ file: path.join(root, FORWARD_SCHEMA_FILES.archive), sha256: pin.archive_sha256,
      archive_sha256: pin.archive_sha256, archive_bytes: archive.bytes, toc_sha256: pin.toc_sha256,
      schema_source_head: pin.schema_source_head, exporter_source_head: pin.exporter_source_head,
      source_plan_sha256: pin.source_plan_sha256, upgrade_sources_sha256: pin.upgrade_sources_sha256,
      qualification: pin.qualification, manifest_sha256: manifestFile.sha256, canonical_manifest: manifest });
  } catch (error) {
    if (/^qa_forward_schema_[a-z_]+$/.test(error?.code || '')) throw error;
    fail('directory_readback_unverified');
  }
}
