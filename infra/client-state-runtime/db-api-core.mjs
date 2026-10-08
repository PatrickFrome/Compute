import { createHash, timingSafeEqual } from 'node:crypto';

export const RPC_ALLOWLIST = Object.freeze([
  'client_v1_device_admin_readback_v1',
  'client_v1_goal_execution_proof_v1',
  'client_v1_goal_progress_v1',
  'client_v1_goal_submit_v1',
  'client_v1_goal_submit_v2',
  'client_v1_guardian_enrollment_ticket_consume_v1',
  'client_v1_guardian_enrollment_ticket_issue_v1',
  'client_v1_native_supervisor_state_merge_v1',
  'devos_environment_resume_v1',
  'devos_environment_state_v1',
  'devos_fleet_capacity_snapshot_v1',
  'devos_fleet_complete_v1',
  'devos_fleet_lease_v1',
  'devos_fleet_mark_running_v1',
  'devos_fleet_reconcile_ambiguous_v2',
  'devos_fleet_reconcile_v1',
  'devos_fleet_snapshot_v1',
  'devos_fleet_transport_promotion_lease_v1',
  'devos_fleet_transport_promotion_release_v1',
  'devos_runtime_capabilities_v1',
  'h205f22_a2_browser_cognitive_accept_v1',
  'h205f22_a2_browser_device_activate_approved_v1',
  'h205f22_a2_browser_device_consume_nonce_v3',
  'h205f22_a2_browser_supervisor_bind_effect_v1',
  'h205f22_a2_browser_supervisor_complete_batch_v1',
  'h205f22_a2_browser_supervisor_complete_v5',
  'h205f22_a2_browser_supervisor_issue_computer_v1',
  'h205f22_a2_browser_supervisor_issue_native_v1',
  'h205f22_a2_browser_supervisor_lease_batch_v1',
  'h205f22_a2_browser_supervisor_lease_emergency_v1',
  'h205f22_a2_browser_supervisor_lease_v3',
  'h205f22_a2_supervisor_mesh_sync_v1',
  'h205f22_a2_workspace_binding_snapshot_v1',
  'meta_orchestrator_authoritative_inputs_v1',
  'meta_orchestrator_controller_lease_v1',
  'meta_orchestrator_frontier_admit_v1',
  'meta_orchestrator_frontier_admit_v2',
  'meta_orchestrator_plan_activate_v1',
  'meta_orchestrator_plan_snapshot_v1',
  'meta_orchestrator_task_admit_v1',
]);

const columns = (value) => Object.freeze(value.split(','));
export const TABLE_ALLOWLIST = Object.freeze({
  compute_fabric_a2_browser_device_enrollment_request_h205f22: Object.freeze({
    select: columns('request_id,status,requested_at,expires_at,key_fingerprint_sha256,approved_at,device_id'),
    filters: columns('client_id,key_fingerprint_sha256,status,expires_at,request_id'),
    order: columns('requested_at'),
    insert: columns('client_id,profile,public_jwk,key_fingerprint_sha256,status,metadata,authority_effect'),
  }),
  compute_fabric_a2_browser_device_h205f22: Object.freeze({
    select: columns('device_id,client_id,profile,public_jwk,enrollment_pairing_token_hash,active,revoked_at,access_tier,admin_scopes,admin_grant_epoch,admin_granted_at,admin_revoked_at'),
    filters: columns('device_id,client_id'),
    order: [],
  }),
  compute_fabric_a2_chat_bridge_remote_pairing_h205f22: Object.freeze({
    select: columns('token_hash'), filters: columns('token_hash,active'), order: [],
  }),
  compute_fabric_a2_browser_supervisor_state_h205f22: Object.freeze({
    select: columns('client_id,workspace_id,last_seen_at,extension_version,operator_runtime,supervisor_mode,armed,operator_mode,ordering_policy,last_command_id,last_command_status,state,authority_effect'),
    filters: columns('workspace_id'), order: columns('last_seen_at'),
  }),
  compute_fabric_a2_browser_supervisor_command_h205f22: Object.freeze({
    select: columns('command_id,idempotency_key,action,platform,status,issued_by,issued_at,expires_at,leased_by,leased_at,completed_at,authority_effect,receipt,error'),
    filters: columns('workspace_id,command_id,leased_by'), order: columns('issued_at'),
  }),
});

export class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new ApiError(400, 'identifier_invalid');
  return '"' + value.replaceAll('"', '""') + '"';
}

export function authenticated(headers, secret) {
  const digest = (value) => createHash('sha256').update(String(value || '')).digest();
  const supplied = typeof headers.apikey === 'string' ? headers.apikey : '';
  const keyValid = timingSafeEqual(digest(supplied), digest(secret));
  const bearer = headers.authorization;
  const bearerValid = bearer === undefined || (typeof bearer === 'string'
    && bearer.startsWith('Bearer ') && timingSafeEqual(digest(bearer.slice(7)), digest(secret)));
  return keyValid && bearerValid;
}

const objectBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'json_object_required');
  return body;
};

function requestedColumns(params, policy) {
  const selected = (params.get('select') || policy.select.join(',')).split(',');
  if (!selected.length || selected.some((name) => !policy.select.includes(name)) || new Set(selected).size !== selected.length) {
    throw new ApiError(400, 'select_columns_forbidden');
  }
  return selected.map(quoteIdentifier).join(', ');
}

export function compileTableRequest({ table, method, params = new URLSearchParams(), body, prefer }) {
  if (!Object.hasOwn(TABLE_ALLOWLIST, table)) throw new ApiError(404, 'table_not_allowed');
  const policy = TABLE_ALLOWLIST[table];
  if (method !== 'GET' && !(method === 'POST' && policy.insert)) throw new ApiError(405, 'table_method_not_allowed');
  const seen = new Set();
  for (const [name] of params) {
    if (seen.has(name)) throw new ApiError(400, 'duplicate_query_parameter');
    seen.add(name);
  }
  if (seen.size > 32) throw new ApiError(400, 'query_parameters_exceeded');
  const projection = requestedColumns(params, policy);
  const qualified = '"public".' + quoteIdentifier(table);
  const values = [];
  if (method === 'POST') {
    if ([...seen].some((name) => name !== 'select')) throw new ApiError(400, 'insert_query_parameter_forbidden');
    objectBody(body);
    const names = Object.keys(body);
    if (!names.length || names.some((name) => !policy.insert.includes(name))) throw new ApiError(400, 'insert_columns_forbidden');
    if (prefer && prefer !== 'return=representation' && prefer !== 'return=minimal') throw new ApiError(400, 'preference_not_supported');
    for (const name of names) values.push({ value: body[name], json: name === 'public_jwk' || name === 'metadata' });
    const returning = prefer === 'return=representation';
    return {
      text: `INSERT INTO ${qualified} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map((_, index) => '$' + (index + 1)).join(', ')})${returning ? ' RETURNING ' + projection : ''}`,
      values, returning, status: 201,
    };
  }
  const clauses = [];
  for (const [name, raw] of params) {
    if (['select', 'order', 'limit'].includes(name)) continue;
    if (!policy.filters.includes(name)) throw new ApiError(400, 'filter_column_forbidden');
    const dot = raw.indexOf('.');
    const operator = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    if (dot < 1 || value.length > 2048) throw new ApiError(400, 'filter_invalid');
    if (operator === 'eq' || operator === 'gt') {
      if (name === 'active' && (operator !== 'eq' || !['true', 'false'].includes(value))) throw new ApiError(400, 'boolean_filter_invalid');
      values.push({ value: name === 'active' ? value === 'true' : value });
      clauses.push(`${quoteIdentifier(name)} ${operator === 'eq' ? '=' : '>'} $${values.length}`);
    } else if (operator === 'in' && name === 'status' && table === 'compute_fabric_a2_browser_device_enrollment_request_h205f22') {
      if (!/^\([A-Z_]+(?:,[A-Z_]+){0,7}\)$/.test(value)) throw new ApiError(400, 'in_filter_invalid');
      const items = value.slice(1, -1).split(',');
      const slots = items.map((item) => { values.push({ value: item }); return '$' + values.length; });
      clauses.push(`${quoteIdentifier(name)} IN (${slots.join(', ')})`);
    } else throw new ApiError(400, 'filter_operator_not_supported');
  }
  let order = '';
  if (params.has('order')) {
    const [name, direction, ...extra] = params.get('order').split('.');
    if (extra.length || !policy.order.includes(name) || !['asc', 'desc'].includes(direction)) throw new ApiError(400, 'order_not_allowed');
    order = ` ORDER BY ${quoteIdentifier(name)} ${direction.toUpperCase()}`;
  }
  const limitText = params.get('limit') || '100';
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new ApiError(400, 'limit_invalid');
  values.push({ value: limit });
  return {
    text: `SELECT ${projection} FROM ${qualified}${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''}${order} LIMIT $${values.length}`,
    values, returning: true, status: 200,
  };
}

export function compileRpcRequest(name, args, signatures) {
  if (!RPC_ALLOWLIST.includes(name)) throw new ApiError(404, 'rpc_not_allowed');
  objectBody(args);
  const supplied = Object.keys(args);
  const candidates = signatures.filter((signature) => signature.name === name && supplied.every((key) => signature.args.some((arg) => arg.name === key))
    && signature.args.every((arg, index) => index >= signature.args.length - signature.defaults || Object.hasOwn(args, arg.name)));
  if (!candidates.length) throw new ApiError(400, 'rpc_arguments_invalid');
  if (candidates.length !== 1) throw new ApiError(409, 'rpc_signature_ambiguous');
  const signature = candidates[0];
  const values = [];
  const bindings = signature.args.filter((arg) => Object.hasOwn(args, arg.name)).map((arg) => {
    const value = args[arg.name];
    if (arg.elementOid && value !== null && !Array.isArray(value)) throw new ApiError(400, 'rpc_array_required');
    values.push({ value, json: ['json', 'jsonb'].includes(arg.typeName) && arg.typeSchema === 'pg_catalog', elementOid: arg.elementOid || null });
    return `${quoteIdentifier(arg.name)} => $${values.length}::${quoteIdentifier(arg.typeSchema)}.${quoteIdentifier(arg.typeName)}`;
  });
  const call = `"public".${quoteIdentifier(name)}(${bindings.join(', ')})`;
  return {
    text: signature.returnsSet || signature.returnComposite ? `SELECT * FROM ${call}` : `SELECT ${call} AS value`,
    values, scalar: !signature.returnsSet && !signature.returnComposite, status: 200,
  };
}

// Catalog identifiers are quoted; values remain driver parameters, including JSON and arrays.
export const RPC_CATALOG_QUERY = `
  SELECT p.oid, p.proname AS name, p.pronargdefaults AS defaults,
    p.proretset AS "returnsSet", rt.typtype = 'c' AS "returnComposite",
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', p.proargnames[a.ordinality], 'typeName', t.typname,
      'typeSchema', tn.nspname, 'elementOid', NULLIF(t.typelem, 0)
    ) ORDER BY a.ordinality)
    FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(type_oid, ordinality)
    JOIN pg_catalog.pg_type t ON t.oid = a.type_oid
    JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace), '[]'::jsonb) AS args
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_type rt ON rt.oid = p.prorettype
  WHERE n.nspname = 'public' AND p.proname::text IN (SELECT pg_catalog.jsonb_array_elements_text($1::text::jsonb)) AND p.prokind = 'f'
`;

export function databaseError(error) {
  if (error instanceof ApiError) return { status: error.status, body: { code: error.code, message: error.message } };
  const code = String(error?.code || 'database_error');
  const status = code === '42501' ? 403 : code === '57014' ? 504
    : /^(22|23)/.test(code) ? 400 : code === 'P0001' || code === '55000' ? 409 : 503;
  const message = status === 503 ? 'database_request_failed' : String(error?.message || code).slice(0, 512);
  return { status, body: { code, message } };
}

// Read-only catalog inventory for a FUTURE owner-approved schema installer.
// It does not claim API runtime readiness, RLS/grant correctness or authority.
export async function inspectLocalApiSchemaCatalog({ sql } = {}) {
  if (typeof sql?.unsafe !== 'function') throw new Error('local_schema_catalog_connection_required');
  const tables = Object.keys(TABLE_ALLOWLIST);
  const read = async (query, values = []) => {
    try { return await sql.unsafe(query, values); }
    catch { throw new Error('local_schema_catalog_readback_failed'); }
  };
  const [current] = await read(`SELECT r.rolsuper AS "superuser" FROM pg_catalog.pg_roles r WHERE r.rolname = CURRENT_USER`);
  if (current?.superuser !== true) throw new Error('local_schema_catalog_superuser_required');
  const [rpcs, columns, roles, extensions] = await Promise.all([
    read(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]),
    read(`SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name
        IN (SELECT pg_catalog.jsonb_array_elements_text($1::jsonb))`, [JSON.stringify(tables)]),
    read(`SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role'`),
    read(`SELECT e.extname FROM pg_catalog.pg_extension e WHERE e.extname = 'pgcrypto'`),
  ]);
  if (![rpcs, columns, roles, extensions].every(Array.isArray))
    throw new Error('local_schema_catalog_readback_invalid');
  const installed = new Set(rpcs.map(row => row.name));
  const actualColumns = new Set(columns.map(row => row.table_name + '.' + row.column_name));
  const missingRpc = RPC_ALLOWLIST.filter(name => !installed.has(name));
  const missingTable = [];
  const missingColumn = [];
  for (const [table, policy] of Object.entries(TABLE_ALLOWLIST)) {
    const required = new Set([...policy.select, ...policy.filters, ...policy.order, ...(policy.insert || [])]);
    if (!columns.some(row => row.table_name === table)) missingTable.push(table);
    for (const column of required) if (!actualColumns.has(table + '.' + column)) missingColumn.push(table + '.' + column);
  }
  const serviceRolePresent = roles.some(row => row.rolname === 'service_role');
  const pgcryptoPresent = extensions.some(row => row.extname === 'pgcrypto');
  const catalogComplete = missingRpc.length === 0 && missingTable.length === 0 &&
    missingColumn.length === 0 && serviceRolePresent && pgcryptoPresent;
  // Presence is NOT RLS, function-body, migration-source or privilege attestation.
  return Object.freeze({
    schema: 'compute.local-api-schema-catalog.v1',
    state: catalogComplete ? 'CATALOG_PRESENT_UNATTESTED' : 'BASELINE_SCHEMA_MISSING',
    required_rpc_count: RPC_ALLOWLIST.length,
    required_table_count: tables.length,
    missing_rpc: Object.freeze(missingRpc),
    missing_table: Object.freeze(missingTable),
    missing_column: Object.freeze(missingColumn),
    service_role_present: serviceRolePresent,
    pgcrypto_present: pgcryptoPresent,
    complete_catalog_only: catalogComplete,
    grants_attested: false,
    rls_attested: false,
    migration_sources_attested: false,
    runtime_ready: false,
    initialization_authorized: false,
    authority_effect: false,
  });
}
