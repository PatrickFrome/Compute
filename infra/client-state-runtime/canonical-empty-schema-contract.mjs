// Test/export support only. These checks confer no installation or runtime authority.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

export const EMPTY_SCHEMA_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const EMPTY_SCHEMA_MAX_COMMAND_BYTES = 16 * 1024 * 1024;
export const EMPTY_SCHEMA_FILES = Object.freeze({
  archive: 'canonical-empty-schema.dump',
  manifest: 'canonical-empty-schema-manifest.json',
});
export const EMPTY_SCHEMA_EXPORTER_PATHS = Object.freeze([
  'infra/client-state-runtime/test/fresh-schema-disposable.mjs',
  'infra/client-state-runtime/canonical-empty-schema-contract.mjs',
  'infra/client-state-runtime/export-reviewed-empty-schema.mjs',
]);
export const EMPTY_SCHEMA_INPUT_PATHS = Object.freeze([
  'infra/client-state-runtime/fresh-schema-candidate-plan.json',
  'infra/client-state-runtime/fresh-schema-statement-selection.json',
  'infra/client-state-runtime/fresh-schema-prerequisites-v1.sql',
  'infra/client-state-runtime/fresh-schema-private-acl-v1.sql',
  'infra/client-state-runtime/fresh-schema-plan.mjs',
  'infra/client-state-runtime/fresh-schema-application-plan.mjs',
  'infra/client-state-runtime/local-runtime-migrations.mjs',
  'infra/client-state-runtime/local-vault-compat.sql',
  'infra/client-state-runtime/db-api-core.mjs',
]);
const contractErrorCodes = new WeakMap();
function contractError(code) {
  const error = new Error(code);
  contractErrorCodes.set(error, code);
  return error;
}
const fail = code => { throw contractError(code); };
export const emptySchemaSha256 = value => createHash('sha256').update(value).digest('hex');
const sha40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const forbiddenObject = /(?:^|[^a-z0-9_])(?:atomic_fresh_api|fresh_candidate_api|fresh_candidate_probe|fresh_default_acl_probe|canonical_empty_schema_probe|synthetic_rpc|fixture_rpc)(?:$|[^a-z0-9_])/i;

// Internal diagnostic custody. Never copy an error message, stack, query, argv,
// path, stderr, credentials or arbitrary properties into a public receipt.
const diagnosticStages = new Set([
  'UNCLASSIFIED','CLI_ARGUMENTS','INPUT_PREFLIGHT','SOURCE_BINDING','PLAN_LOAD',
  'NATIVE_ROUNDTRIP','EVIDENCE_COMPARE','SOURCE_RECHECK','PUBLICATION_PREFLIGHT',
  'PUBLICATION_CLAIM','PUBLICATION_IDENTITY','PUBLICATION_ARCHIVE_WRITE',
  'PUBLICATION_ARCHIVE_READBACK','PUBLICATION_MANIFEST_WRITE','PUBLICATION_CLEANUP',
  'WORKSPACE_CREATE','ARCHIVE_CLAIM','PG_TOOL_PIN','PG_TOOL_VERSION','SOURCE_FACTORY',
  'RESTORE_FACTORY','ROUNDTRIP_COMPARE','ARCHIVE_READBACK','ARCHIVE_CLEANUP','WORKSPACE_CLEANUP',
  ...['SOURCE','RESTORE'].flatMap(prefix => [
    'DIRECTORY_CREATE','PORT_RESERVE','PASSWORD_FILE','INITDB','CONTROL_READ','START',
    'DRIVER_CONNECT','IDENTITY_CHECK','EMPTY_CHECK','COMPAT_ROLES','RESTORE','INSPECTION',
    'DUMP','TOC_READ','TOC_VALIDATE','ARCHIVE_CHECK','SCHEMA_LOAD','BASELINE','UPGRADES',
    'ACL','CATALOGUE_VERIFY','ROLLBACK_CHECK','COMMIT','REPEAT_UPGRADES','API_PROBES',
    'RELEASE_CONNECTIONS','END_CONNECTIONS','STOP','DIRECTORY_CLEANUP',
    ...['SETTINGS','VERSION','CATALOGUE','NAMESPACES','ROLES','MEMBERSHIPS','EXTENSIONS',
      'FUNCTIONS','RELATIONS','COLUMNS','TYPES','CONSTRAINTS','INDEXES','TRIGGERS',
      'POLICIES','SEQUENCES','UNSUPPORTED','ACL','TABLE_ROWS','SEQUENCE_STATE'].map(name => 'INSPECT_' + name),
  ].map(name => prefix + '_' + name)),
]);
const diagnosticErrors = new WeakMap();
const filesystemCodes = new Set(['EACCES','EBUSY','EEXIST','EINVAL','EIO','EISDIR','EMFILE',
  'ENFILE','ENOENT','ENOMEM','ENOSPC','ENOTDIR','ENOTEMPTY','EPERM','EROFS','EXDEV']);
const networkCodes = new Set(['EADDRINUSE','EADDRNOTAVAIL','ECONNREFUSED','ECONNRESET','ENETUNREACH','ETIMEDOUT']);
const commandReasons = new Map([
  ['empty_schema_command_timeout','TIMEOUT'],['empty_schema_command_output_limit','OUTPUT_LIMIT'],
  ['empty_schema_command_failed','FAILED'],
]);
const MAX_CLEANUP_FAILURES = 8;
const errorObject = error => error !== null && typeof error === 'object';
function ownErrorValue(error, key) {
  if (!errorObject(error)) return undefined;
  try { return Object.getOwnPropertyDescriptor(error, key)?.value; } catch { return undefined; }
}
function failureObservation(error, stage) {
  const code = ownErrorValue(error,'code'), registered = errorObject(error) ? contractErrorCodes.get(error) : undefined;
  if (registered && commandReasons.has(registered))
    return {stage,error_category:'COMMAND',command_reason:commandReasons.get(registered)};
  if (registered) return {stage,error_category:'CONTRACT',contract_code:registered};
  if (code === 'ERR_ASSERTION') return {stage,error_category:'ASSERTION'};
  if (filesystemCodes.has(code)) return {stage,error_category:'FILESYSTEM',system_code:code};
  if (networkCodes.has(code)) return {stage,error_category:'NETWORK',system_code:code};
  if (ownErrorValue(error,'name') === 'PostgresError' && typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code))
    return {stage,error_category:'POSTGRES',sqlstate:code};
  return {stage,error_category:'UNKNOWN'};
}
function diagnosticDetails(error, stage = 'UNCLASSIFIED') {
  const existing = errorObject(error) && diagnosticErrors.get(error);
  if (existing) return existing.primary_failure?.stage === 'UNCLASSIFIED' && stage !== 'UNCLASSIFIED'
    ? {...existing,primary_failure:{...existing.primary_failure,stage}} : existing;
  // assert.rejects keeps the unexpected rejection in .actual. Preserve its
  // already captured SQL boundary without inspecting arbitrary error causes.
  const actual = ownErrorValue(error,'code') === 'ERR_ASSERTION' ? ownErrorValue(error,'actual') : null;
  const inner = errorObject(actual) && diagnosticErrors.get(actual);
  if (inner) return inner;
  return {primary_failure:failureObservation(error,stage),cleanup_failures:[],cleanup_failures_truncated:false};
}
export async function runEmptySchemaStage(stage, action) {
  if (!diagnosticStages.has(stage) || typeof action !== 'function') fail('empty_schema_diagnostic_stage_invalid');
  try { return await action(); }
  catch (caught) {
    const error = errorObject(caught) ? caught : new Error('empty_schema_qualification_failed');
    diagnosticErrors.set(error,diagnosticDetails(error,stage));
    throw error; // Preserve the original exception and expected-refusal behavior.
  }
}
export function combineEmptySchemaCleanupFailure(primaryError, cleanupError) {
  const prior = primaryError == null
    ? {primary_failure:null,cleanup_failures:[],cleanup_failures_truncated:false}
    : diagnosticDetails(primaryError);
  const next = diagnosticDetails(cleanupError);
  const cleanup = [...prior.cleanup_failures,...(next.primary_failure ? [next.primary_failure] : []),...next.cleanup_failures];
  const error = new Error('empty_schema_qualification_failed',{cause:primaryError ?? cleanupError});
  diagnosticErrors.set(error,{primary_failure:prior.primary_failure,cleanup_failures:cleanup.slice(0,MAX_CLEANUP_FAILURES),
    cleanup_failures_truncated:prior.cleanup_failures_truncated || next.cleanup_failures_truncated || cleanup.length > MAX_CLEANUP_FAILURES});
  return error;
}
export function emptySchemaFailureMetadata(error) {
  const details = diagnosticDetails(error);
  return {code:details.primary_failure?.contract_code || (errorObject(error) && contractErrorCodes.get(error)) || 'empty_schema_qualification_failed',
    primary_failure:details.primary_failure ? {...details.primary_failure} : null,
    cleanup_failures:details.cleanup_failures.map(row => ({...row})),
    cleanup_failures_truncated:details.cleanup_failures_truncated};
}

export function parseEmptySchemaArguments(args) {
  const names = new Map([
    ['--application-mode', 'applicationMode'], ['--bin', 'bin'], ['--driver', 'driver'],
    ['--output-dir', 'outputDir'], ['--schema-source-head', 'schemaSourceHead'],
    ['--exporter-source-head', 'exporterSourceHead'],
  ]);
  const parsed = {};
  if (!Array.isArray(args)) fail('empty_schema_arguments_invalid');
  for (let i = 0; i < args.length; i += 2) {
    const key = names.get(args[i]), value = args[i + 1];
    if (!key || Object.hasOwn(parsed, key) || typeof value !== 'string' || !value
      || value.startsWith('--') || value.includes('\0') || /[\r\n]/.test(value))
      fail('empty_schema_arguments_invalid');
    parsed[key] = value;
  }
  assertEmptySchemaOptions(parsed);
  return Object.freeze(parsed);
}

export function assertEmptySchemaOptions(options) {
  const allowed = ['applicationMode','bin','driver','outputDir','schemaSourceHead','exporterSourceHead'];
  if (!options || Object.keys(options).some(key => !allowed.includes(key))
    || allowed.some(key => typeof options[key] !== 'string' || !options[key]
      || options[key].includes('\0') || /[\r\n]/.test(options[key])))
    fail('empty_schema_options_invalid');
  if (options.applicationMode !== 'ATOMIC_SLICE') fail('empty_schema_atomic_slice_required');
  if (!sha40(options.schemaSourceHead) || !sha40(options.exporterSourceHead))
    fail('empty_schema_exact_source_heads_required');
  for (const key of ['bin','driver','outputDir']) {
    if (!path.isAbsolute(options[key]) || /^(?:postgres(?:ql)?:|https?:)/i.test(options[key]))
      fail('empty_schema_absolute_file_paths_required');
  }
}

// Environment credentials/services/options must never select a different server.
// Factory-generated credentials are supplied only in the owned child environment.
export function emptySchemaProcessEnvironment(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  return { ...env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...extra };
}

export function runEmptySchemaCommand(file, args, { env, input, cwd, maxBytes = EMPTY_SCHEMA_MAX_COMMAND_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, {
      cwd, env: env || emptySchemaProcessEnvironment(), shell: false, windowsHide: true,
      encoding: 'buffer', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: maxBytes,
    }, (error, stdout) => {
      if (error) {
        // Never forward argv, environment, server stderr or potentially secret SQL.
        reject(contractError(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'empty_schema_command_output_limit'
          : error.killed || error.signal ? 'empty_schema_command_timeout'
          : 'empty_schema_command_failed'));
      } else resolve(stdout);
    });
    child.stdin.on('error', () => {}); // Early child refusal is reported by its completion callback.
    child.stdin.end(input);
  });
}

function sourcePath(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(value)
    || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..'))
    fail('empty_schema_source_path_invalid');
  return value;
}

export async function assertNewEmptySchemaOutputDirectory(outputDir) {
  if (!path.isAbsolute(outputDir) || outputDir.includes('\0')) fail('empty_schema_output_path_invalid');
  const destination = path.resolve(outputDir), parent = path.dirname(destination);
  if (destination === parent) fail('empty_schema_output_path_invalid');
  // Refuse symlink/junction ancestors rather than publish under an unexpected root.
  let cursor = parent;
  while (true) {
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('empty_schema_output_parent_alias');
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  try { await fs.lstat(destination); fail('empty_schema_output_already_exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return destination;
}

export async function validateEmptySchemaSourceBinding({
  repositoryRoot, schemaSourceHead, exporterSourceHead, inputPaths, exporterPaths = EMPTY_SCHEMA_EXPORTER_PATHS,
}) {
  if (!sha40(schemaSourceHead) || !sha40(exporterSourceHead)) fail('empty_schema_exact_source_heads_required');
  if (!Array.isArray(inputPaths) || !inputPaths.length || !Array.isArray(exporterPaths) || !exporterPaths.length)
    fail('empty_schema_source_paths_required');
  const gitEnv = Object.fromEntries(Object.entries(emptySchemaProcessEnvironment()).filter(([key]) => !/^GIT_/i.test(key)));
  const git = async args => runEmptySchemaCommand('git', ['-C', repositoryRoot, ...args], {env:gitEnv});
  const rootStat = await fs.lstat(repositoryRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('empty_schema_repository_alias');
  const gitRoot = (await git(['rev-parse','--show-toplevel'])).toString('utf8').trim();
  if (await fs.realpath(gitRoot) !== await fs.realpath(repositoryRoot)) fail('empty_schema_repository_mismatch');
  const head = (await git(['rev-parse','--verify','HEAD'])).toString('utf8').trim();
  if (head !== exporterSourceHead) fail('empty_schema_exporter_head_mismatch');
  const prior = (await git(['rev-parse','--verify',schemaSourceHead + '^{commit}'])).toString('utf8').trim();
  if (prior !== schemaSourceHead) fail('empty_schema_schema_head_mismatch');
  await git(['merge-base','--is-ancestor',schemaSourceHead,exporterSourceHead]);
  const readBound = async (relative, compareSchema) => {
    sourcePath(relative);
    const fullPath = path.join(repositoryRoot, ...relative.split('/'));
    const stat = await fs.lstat(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > EMPTY_SCHEMA_MAX_COMMAND_BYTES)
      fail('empty_schema_source_file_alias');
    let cursor = path.dirname(fullPath);
    const root = path.resolve(repositoryRoot);
    while (cursor !== root) {
      if (cursor === path.dirname(cursor)) fail('empty_schema_source_outside_repository');
      const parent = await fs.lstat(cursor);
      if (!parent.isDirectory() || parent.isSymbolicLink()) fail('empty_schema_source_file_alias');
      cursor = path.dirname(cursor);
    }
    const disk = await fs.readFile(fullPath);
    const current = await git(['show',exporterSourceHead + ':' + relative]);
    if (!disk.equals(current)) fail('empty_schema_working_source_changed');
    if (compareSchema && !current.equals(await git(['show',schemaSourceHead + ':' + relative])))
      fail('empty_schema_predecessor_inputs_changed');
    return { path: relative, bytes: current.length, sha256: emptySchemaSha256(current),
      git_blob_sha1: createHash('sha1').update(Buffer.from('blob ' + current.length + '\0')).update(current).digest('hex') };
  };
  const schemaInputs = [];
  for (const relative of [...new Set(inputPaths)].sort()) schemaInputs.push(await readBound(relative, true));
  const exporterInputs = [];
  for (const relative of [...new Set(exporterPaths)].sort()) exporterInputs.push(await readBound(relative, false));
  return Object.freeze({
    schema_source_head: schemaSourceHead, exporter_source_head: exporterSourceHead,
    schema_inputs_equal_at_both_heads: true, actual_working_bytes_verified: true,
    schema_inputs: schemaInputs, schema_inputs_sha256: emptySchemaSha256(JSON.stringify(schemaInputs)),
    exporter_inputs: exporterInputs, exporter_inputs_sha256: emptySchemaSha256(JSON.stringify(exporterInputs)),
  });
}

const allowedTocKinds = Object.freeze([
  'SEQUENCE OWNED BY','CHECK CONSTRAINT','FK CONSTRAINT','DEFAULT ACL','ROW SECURITY','DATABASE PROPERTIES',
  'SCHEMA','EXTENSION','COMMENT','TYPE','DOMAIN','FUNCTION','TABLE','SEQUENCE','DEFAULT',
  'INDEX','CONSTRAINT','TRIGGER','POLICY','ACL','VIEW','MATERIALIZED VIEW',
  'ENCODING','STDSTRINGS','SEARCHPATH','DATABASE',
].sort((a,b) => b.length - a.length));

export function validateEmptySchemaToc(text, { functionIdentities, relationIdentities } = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > EMPTY_SCHEMA_MAX_COMMAND_BYTES || text.includes('\0'))
    fail('empty_schema_toc_invalid');
  if (!Array.isArray(functionIdentities) || !functionIdentities.length || !Array.isArray(relationIdentities)
    || !relationIdentities.length) fail('empty_schema_toc_catalogue_required');
  const expectedFunctions = new Set(functionIdentities), expectedRelations = new Set(relationIdentities);
  if (expectedFunctions.size !== functionIdentities.length || expectedRelations.size !== relationIdentities.length)
    fail('empty_schema_toc_duplicate_catalogue_identity');
  const entries = [], ids = new Set(), functions = new Set(), relations = new Set();
  let serverVersion, dumpVersion, custom = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith(';')) {
      const from = /^;\s*Dumped from database version:\s*(17\.\d+)(?:\s|$)/.exec(line);
      const by = /^;\s*Dumped by pg_dump version:\s*(17\.\d+)(?:\s|$)/.exec(line);
      if (from) serverVersion = from[1];
      if (by) dumpVersion = by[1];
      if (/^;\s*Format:\s*CUSTOM\s*$/.test(line)) custom = true;
      continue;
    }
    const match = /^(\d+);\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match || ids.has(match[1])) fail('empty_schema_toc_entry_invalid');
    ids.add(match[1]);
    const rest = match[4];
    if (/^(?:TABLE DATA|SEQUENCE SET|MATERIALIZED VIEW DATA|BLOB|BLOBS|LARGE OBJECT|FOREIGN|SERVER|USER MAPPING|PUBLICATION|SUBSCRIPTION|EVENT TRIGGER)(?:\s|$)/.test(rest))
      fail('empty_schema_toc_non_schema_content');
    const kind = allowedTocKinds.find(value => rest.startsWith(value + ' '));
    if (!kind || forbiddenObject.test(rest)) fail('empty_schema_toc_unreviewed_content');
    const payload = rest.slice(kind.length + 1);
    // Custom archives always contain the source database descriptor, even
    // without pg_dump --create. Restore never uses --create; only this factory's
    // fixed fresh database may be named, never a caller-selected database.
    if ((kind === 'DATABASE' || kind === 'DATABASE PROPERTIES') && payload !== '- postgres state_owner')
      fail('empty_schema_toc_non_schema_content');
    if (kind === 'FUNCTION' || ['TABLE','SEQUENCE','VIEW','MATERIALIZED VIEW'].includes(kind)) {
      const object = /^([a-z_][a-z_0-9]*) (.+) state_owner$/.exec(payload);
      if (!object) fail('empty_schema_toc_owner_or_identity_invalid');
      const identity = object[1] + '.' + object[2];
      const actual = kind === 'FUNCTION' ? functions : relations;
      const expected = kind === 'FUNCTION' ? expectedFunctions : expectedRelations;
      if (!expected.has(identity) || actual.has(identity)) fail('empty_schema_toc_catalogue_mismatch');
      actual.add(identity);
    }
    entries.push({ kind, payload });
  }
  if (!custom || !serverVersion || !dumpVersion || serverVersion !== dumpVersion)
    fail('empty_schema_toc_pg17_custom_required');
  if (entries.filter(row => row.kind === 'DATABASE').length !== 1)
    fail('empty_schema_toc_factory_database_required');
  if (functions.size !== expectedFunctions.size || relations.size !== expectedRelations.size)
    fail('empty_schema_toc_catalogue_mismatch');
  if (!entries.some(row => row.kind === 'ACL') || !entries.some(row => row.kind === 'DEFAULT ACL'))
    fail('empty_schema_toc_acl_missing');
  const counts = {};
  for (const row of entries) counts[row.kind] = (counts[row.kind] || 0) + 1;
  return { schema: 'compute.canonical-empty-schema-toc.v1', raw_sha256: emptySchemaSha256(text),
    normalized_sha256: emptySchemaSha256(JSON.stringify(entries)), entries: entries.length,
    counts, database_version: serverVersion, pg_dump_version: dumpVersion,
    data_entries: 0, sequence_set_entries: 0, temporary_api_or_fixture_objects: 0, acl_preserved: true,
    database_creation_restored: false };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  return typeof value === 'bigint' ? String(value) : value;
}
export function emptySchemaCatalogueDigest(sections) {
  const normalized = Object.fromEntries(Object.keys(sections).sort().map(key => [key,
    sections[key].map(canonicalValue).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))]));
  return emptySchemaSha256(JSON.stringify(normalized));
}
export function assertEmptySchemaRoundtrip(source, restored) {
  for (const key of ['catalogue_sha256','acl_sha256','table_rows_sha256','sequence_state_sha256','postgres_version_num']) {
    if (source[key] !== restored[key]) fail('empty_schema_roundtrip_' + key + '_mismatch');
  }
  if (!source.empty_tables || source.empty_tables !== restored.empty_tables
    || source.application_rows !== 0 || restored.application_rows !== 0)
    fail('empty_schema_roundtrip_empty_tables_required');
  assert.deepEqual(source.catalogue_check, restored.catalogue_check);
}

const userSchemas = "n.nspname !~ '^pg_' and n.nspname <> 'information_schema'";
const extensionOwned = "(exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))";

// Full semantic catalogue and explicit/effective ACLs; no OIDs, paths, passwords,
// row values or server logs leave this function. Source bodies are hashed in memory.
export async function inspectCanonicalEmptySchema({ sql, plan, verifyCatalogue, phase = 'SOURCE' }) {
  if (!['SOURCE','RESTORE'].includes(phase)) fail('empty_schema_diagnostic_stage_invalid');
  const query = (step,statement,args) => runEmptySchemaStage(phase + '_INSPECT_' + step,() => sql.unsafe(statement,args));
  await query('SETTINGS',"set search_path=pg_catalog; set statement_timeout='120s'; set lock_timeout='5s'");
  const [version] = await query('VERSION',"select current_setting('server_version_num')::int as value");
  if (Math.floor(Number(version.value) / 10000) !== 17) fail('empty_schema_native_pg17_required');
  const catalogueCheck = await runEmptySchemaStage(phase + '_INSPECT_CATALOGUE',() => verifyCatalogue({sql,plan}));
  const namespaces = await query('NAMESPACES',"select n.nspname as name,pg_catalog.pg_get_userbyid(n.nspowner) as owner from pg_catalog.pg_namespace n where " + userSchemas);
  if (namespaces.some(row => !['public','destruktion_meta','extensions','vault'].includes(row.name)))
    fail('empty_schema_unreviewed_namespace');
  const sections = { namespaces };
  sections.roles = await query('ROLES',"select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text from pg_catalog.pg_roles where rolname !~ '^pg_'");
  if (sections.roles.length !== 4 || sections.roles.some(row => !['state_owner','anon','authenticated','service_role'].includes(row.rolname)
    || row.rolname !== 'state_owner' && (row.rolcanlogin || row.rolsuper || row.rolcreaterole || row.rolcreatedb || row.rolreplication || row.rolbypassrls)))
    fail('empty_schema_temporary_or_foreign_role');
  sections.memberships = await query('MEMBERSHIPS',"select pg_get_userbyid(roleid) as role,pg_get_userbyid(member) as member,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members");
  sections.extensions = await query('EXTENSIONS',"select e.extname,e.extversion,n.nspname,e.extrelocatable from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace");
  if (sections.extensions.some(row => !['plpgsql','pgcrypto'].includes(row.extname))) fail('empty_schema_unreviewed_extension');
  sections.functions = await query('FUNCTIONS',`select n.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' as identity,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,pg_catalog.pg_get_functiondef(p.oid) as definition,
    ${extensionOwned} as extension_owned from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where ${userSchemas} and p.prokind in ('f','p','w')`);
  if (sections.functions.some(row => forbiddenObject.test(row.identity))) fail('empty_schema_synthetic_function');
  sections.relations = await query('RELATIONS',`select n.nspname as schema,c.relname as name,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
    c.relreplident,c.reloptions,pg_catalog.pg_get_userbyid(c.relowner) as owner,
    case when c.relkind in ('v','m') then pg_catalog.pg_get_viewdef(c.oid,false) else null end as view_definition,
    pg_catalog.pg_get_expr(c.relpartbound,c.oid) as partition_bound
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where ${userSchemas} and c.relkind in ('r','p','v','m','S','f')`);
  if (sections.relations.some(row => row.relkind === 'f' || forbiddenObject.test(row.name)))
    fail('empty_schema_unreviewed_relation');
  sections.columns = await query('COLUMNS',`select n.nspname,c.relname,
    row_number() over (partition by c.oid order by a.attnum)::int as ordinal,a.attname,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,a.attidentity,a.attgenerated,
    co.collname,cn.nspname as collation_schema,pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    left join pg_catalog.pg_collation co on co.oid=a.attcollation left join pg_catalog.pg_namespace cn on cn.oid=co.collnamespace
    where ${userSchemas} and a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','S')`);
  sections.types = await query('TYPES',`select n.nspname,t.typname,t.typtype,t.typcategory,t.typnotnull,t.typdefault,
    case when t.typbasetype=0 then null else pg_catalog.format_type(t.typbasetype,t.typtypmod) end as base_type,
    pg_catalog.pg_get_userbyid(t.typowner) as owner,
    (select pg_catalog.json_agg(e.enumlabel order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid=t.oid) as enum_labels
    from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace where ${userSchemas}`);
  sections.constraints = await query('CONSTRAINTS',`select n.nspname,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,
    case when c.conrelid=0 then null else c.conrelid::regclass::text end as relation,
    case when c.contypid=0 then null else c.contypid::regtype::text end as domain,
    pg_catalog.pg_get_constraintdef(c.oid,false) as definition
    from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid=c.connamespace where ${userSchemas}`);
  sections.indexes = await query('INDEXES',`select n.nspname,c.relname,pg_catalog.pg_get_indexdef(c.oid) as definition,
    i.indisvalid,i.indisready,i.indisreplident from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${userSchemas}`);
  sections.triggers = await query('TRIGGERS',`select n.nspname,c.relname,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,false) as definition
    from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where ${userSchemas} and not t.tgisinternal`);
  sections.policies = await query('POLICIES',"select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_catalog.pg_policies where schemaname !~ '^pg_'");
  sections.sequences = await query('SEQUENCES',`select n.nspname,c.relname,pg_catalog.format_type(s.seqtypid,null) as type,
    s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle
    from pg_catalog.pg_sequence s join pg_catalog.pg_class c on c.oid=s.seqrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${userSchemas}`);
  const [unsupported] = await query('UNSUPPORTED',`select
    (select count(*) from pg_catalog.pg_largeobject_metadata)::int as large_objects,
    (select count(*) from pg_catalog.pg_event_trigger)::int as event_triggers,
    (select count(*) from pg_catalog.pg_foreign_server)::int as foreign_servers,
    (select count(*) from pg_catalog.pg_publication)::int as publications,
    (select count(*) from pg_catalog.pg_subscription)::int as subscriptions`);
  if (Object.values(unsupported).some(value => Number(value) !== 0)) fail('empty_schema_unsupported_external_or_data_object');
  const acls = await query('ACL',`with objects as (
    select 'schema:'||n.nspname as identity,coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner)) as acl
      from pg_catalog.pg_namespace n where ${userSchemas}
    union all select 'function:'||n.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')',
      coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace where ${userSchemas}
    union all select 'relation:'||n.nspname||'.'||c.relname,
      coalesce(c.relacl,pg_catalog.acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where ${userSchemas} and c.relkind in ('r','p','v','m','S')
    union all select 'column:'||n.nspname||'.'||c.relname||'.'||a.attname,a.attacl
      from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${userSchemas} and a.attnum>0 and not a.attisdropped and a.attacl is not null
    union all select 'type:'||n.nspname||'.'||t.typname,coalesce(t.typacl,pg_catalog.acldefault('T',t.typowner))
      from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace where ${userSchemas}
    union all select 'default:'||pg_catalog.pg_get_userbyid(d.defaclrole)||':'||coalesce(n.nspname,'GLOBAL')||':'||d.defaclobjtype,d.defaclacl
      from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
    union all select 'database:postgres',coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))
      from pg_catalog.pg_database d where d.datname=current_database()
  ) select o.identity,case when a.grantor=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantor) end as grantor,
    case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
    a.privilege_type,a.is_grantable from objects o cross join lateral pg_catalog.aclexplode(o.acl) a`);
  const tableRows = [];
  for (const table of sections.relations.filter(row => ['r','p','m'].includes(row.relkind))) {
    const [row] = await query('TABLE_ROWS','select count(*)::text as count from ' + quote(table.schema) + '.' + quote(table.name));
    if (row.count !== '0') fail('empty_schema_application_rows_present');
    tableRows.push({schema:table.schema,name:table.name,rows:0});
  }
  if (!tableRows.length) fail('empty_schema_application_tables_missing');
  const sequenceState = [];
  for (const sequence of sections.sequences) {
    const [row] = await query('SEQUENCE_STATE','select last_value::text,is_called from ' + quote(sequence.nspname) + '.' + quote(sequence.relname));
    if (row.is_called !== false || row.last_value !== sequence.seqstart) fail('empty_schema_sequence_already_used');
    sequenceState.push({schema:sequence.nspname,name:sequence.relname,last_value:row.last_value,is_called:false});
  }
  return {
    postgres_version_num:Number(version.value),catalogue_check:catalogueCheck,
    catalogue_sha256:emptySchemaCatalogueDigest(sections),acl_sha256:emptySchemaCatalogueDigest({acls}),
    table_rows_sha256:emptySchemaCatalogueDigest({tableRows}),sequence_state_sha256:emptySchemaCatalogueDigest({sequenceState}),
    empty_tables:tableRows.length,application_rows:0,sequences:sequenceState.length,
    functionIdentities:sections.functions.filter(row => !row.extension_owned).map(row => row.identity).sort(),
    relationIdentities:sections.relations.map(row => row.schema + '.' + row.name).sort(),
  };
}
