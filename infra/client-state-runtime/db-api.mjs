import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { buildUnifiedOperatorContext } from './operator-unified-snapshot-core.mjs';
import { OPERATOR_DB_IDENTITY_SQL, qualifyLocalPostgresEvidence } from './operator-truth-readback.mjs';
import { qualifyOperatorOwner, readOwnPostgresOperatorTruth } from './operator-own-pg-fleet-truth.mjs';
import { bindOwnPostgresBirthProviderW61 } from './own-postgres-birth-w61.mjs';
import { admitOwnPg17LedgerReadback } from './operator-pg17-restart-admission.mjs';
import { ApiError, authenticated, compileTableRequest, compileRpcRequest, RPC_ALLOWLIST, RPC_CATALOG_QUERY, TABLE_ALLOWLIST, databaseError } from './db-api-core.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const CLAIMS = JSON.stringify({ role: 'service_role', aud: 'authenticated', iss: 'local-state-runtime' });

async function readBody(request) {
  const size = Number(request.headers['content-length']);
  if (Number.isFinite(size) && size > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large');
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) throw new ApiError(415, 'json_content_type_required');
  const chunks = await new Promise((resolve, reject) => {
    let bytes = 0;
    const parts = [];
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onAborted = () => onError(new ApiError(400, 'request_aborted'));
    const onEnd = () => { cleanup(); resolve(parts); };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        cleanup();
        request.resume();
        reject(new ApiError(413, 'body_too_large'));
      } else parts.push(chunk);
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'json_invalid'); }
}

function send(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(value === null ? '' : JSON.stringify(value));
}

function driverValues(sql, values) {
  return values.map(({ value, json, elementOid }) => {
    if (value === null) return null;
    if (json) return sql.json(value);
    if (elementOid) return sql.array(value, elementOid);
    return value;
  });
}

export async function startDbApi({ databaseUrl, apiKey, host = '127.0.0.1', port = 15432, instanceId = '', roleMode = 'service_role', sql: injectedSql, hostObservationReadback = null, operatorOwnerReadback = null, trustedNativeOwnerBirthReadback = null } = {}) {
  if (hostObservationReadback !== null && typeof hostObservationReadback !== 'function') throw new Error('operator_host_readback_invalid');
  if (operatorOwnerReadback !== null && typeof operatorOwnerReadback !== 'function') throw new Error('operator_owner_readback_invalid');
  if (trustedNativeOwnerBirthReadback !== null && typeof trustedNativeOwnerBirthReadback !== 'function') throw new Error('native_owner_birth_readback_invalid');
  if (!['service_role', 'direct'].includes(roleMode)) throw new Error('local_state_api_role_mode_invalid');
  if (host !== '127.0.0.1') throw new Error('local_state_loopback_host_required');
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(apiKey)) throw new Error('local_state_random_api_key_required');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('local_state_api_port_invalid');
  if (!databaseUrl && !injectedSql) throw new Error('local_state_database_url_required');
  if (databaseUrl) {
    const db = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname)) throw new Error('local_state_loopback_database_required');
  }
  const sql = injectedSql || postgres(databaseUrl, {
    max: 6, prepare: false, connect_timeout: 5, idle_timeout: 30, max_lifetime: 1800,
    types: { bigint: { to: 20, from: [20], serialize: String, parse(value) {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error('local_state_integer_out_of_range');
      return number;
    } } },
  });
  let signatures;
  let tableAccess;
  let activeRequests = 0;
  let activeHealthRequests = 0;
  const transaction = (run, { readOnly = false } = {}) => sql.begin(async (tx) => {
    if (readOnly) await tx.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (roleMode === 'service_role') await tx.unsafe("SET LOCAL ROLE service_role");
    await tx.unsafe("SET LOCAL search_path = pg_catalog, public, extensions");
    await tx.unsafe("SET LOCAL statement_timeout = '10s'");
    await tx.unsafe("SET LOCAL lock_timeout = '3s'");
    await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.role', 'service_role', true)", [CLAIMS]);
    return run(tx);
  });
  // Private service capability: never routable over HTTP, page or Gateway.
  // Absent W60 authenticated Host producer: null, not a fabricated birth.
  const readOwnPostgresBirth = bindOwnPostgresBirthProviderW61({
    transaction, trustedOwnerReadback: trustedNativeOwnerBirthReadback,
  });

  try {
    if (!injectedSql) {
      const [role] = await sql.unsafe('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = session_user');
      if (!role || Object.values(role).some((value) => value === true)) throw new Error('local_state_restricted_login_required');
      if (roleMode === 'direct') {
        const [direct] = await sql.unsafe(`SELECT r.rolcanlogin AND NOT r.rolinherit AS restricted,
          NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS no_memberships
          FROM pg_catalog.pg_roles r WHERE r.rolname=session_user`);
        if (direct?.restricted !== true || direct?.no_memberships !== true) throw new Error('local_state_direct_login_required');
      }
    }
    signatures = await transaction((tx) => tx.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]));
    if (!signatures.length) throw new Error('local_state_rpc_catalog_empty');
    if (roleMode === 'direct') {
      if (RPC_ALLOWLIST.some(name => !signatures.some(signature => signature.name === name))) throw new Error('local_state_rpc_catalog_incomplete');
      if (signatures.length !== RPC_ALLOWLIST.length) throw new Error('local_state_rpc_catalog_overloaded');
    }
    if (roleMode === 'direct' && !injectedSql) {
      const privileges = await transaction(tx => tx.unsafe(`SELECT p.oid FROM pg_catalog.pg_proc p
        WHERE p.oid IN (SELECT (pg_catalog.jsonb_array_elements_text($1::text::jsonb))::oid)
        AND pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')`, [JSON.stringify(signatures.map(row => row.oid))]));
      if (privileges.length !== signatures.length) throw new Error('local_state_rpc_grants_incomplete');
    }
    tableAccess = injectedSql ? Object.keys(TABLE_ALLOWLIST).map((name) => ({ name, readable: true, writable: true }))
      : await transaction((tx) => tx.unsafe(`SELECT c.relname AS name,
        NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(policy.value->'select') col(name)
          WHERE NOT pg_catalog.has_column_privilege(current_user,c.oid,col.name,'SELECT')) AS readable,
        NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(policy.value->'insert') col(name)
          WHERE NOT pg_catalog.has_column_privilege(current_user,c.oid,col.name,'INSERT')) AS writable
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.jsonb_each($1::text::jsonb) policy ON policy.key=c.relname
        WHERE n.nspname = 'public'`, [JSON.stringify(Object.fromEntries(Object.entries(TABLE_ALLOWLIST)
          .map(([name, policy]) => [name, { select: [...new Set([...policy.select, ...policy.filters, ...policy.order])], insert: policy.insert || [] }])))]));
    if (roleMode === 'direct' && Object.keys(TABLE_ALLOWLIST).some(name => !tableAccess.some(table => table.name === name && table.readable && table.writable))) {
      throw new Error('local_state_table_grants_incomplete');
    }
  } catch (error) {
    if (!injectedSql) await sql.end({ timeout: 5 });
    throw error;
  }
  const server = createServer(async (request, response) => {
    request.on('error', () => response.destroy());
    response.on('error', () => request.destroy());
    let admitted = false;
    let healthAdmitted = false;
    try {
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) throw new ApiError(403, 'loopback_required');
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== expectedHost || request.headers.origin !== undefined) throw new ApiError(403, 'local_service_request_required');
      if (!authenticated(request.headers, apiKey)) throw new ApiError(401, 'local_service_key_required');
      const url = new URL(request.url, `http://${expectedHost}`);
      // Health must still inspect the DB when all six application requests
      // are busy. It has one separate bounded read slot, with the same auth.
      if(url.pathname==='/health'&&request.method==='GET'&&!url.search) {
        if(activeHealthRequests>=1) throw new ApiError(503,'local_state_health_busy');
        activeHealthRequests++;healthAdmitted=true;
      } else {
        if (activeRequests >= 6) throw new ApiError(503, 'local_state_api_busy');
        activeRequests += 1;admitted = true;
      }
      if (url.pathname === '/operator/v1/context') {
        if (request.method !== 'GET') throw new ApiError(405, 'operator_context_get_required');
        if (url.search) throw new ApiError(400, 'operator_context_query_forbidden');
        // P0: ask only the local PostgreSQL capabilities function. PID/socket presence is
        // NOT sufficient evidence of Agent, Browser, Guardian or Supervisor readiness.
        const missing = RPC_ALLOWLIST.filter((name) => !signatures.some((item) => item.name === name));
        const unavailable = Object.keys(TABLE_ALLOWLIST).filter((name) => !tableAccess.some((table) => table.name === name && table.readable && table.writable));
        const plan = compileRpcRequest('devos_runtime_capabilities_v1', {}, signatures);
        // Local PostgreSQL capability and identity witnesses share a transaction.
        const [rows, clockRows] = await transaction(async tx => [
          await tx.unsafe(plan.text, driverValues(sql, plan.values)),
          await tx.unsafe(OPERATOR_DB_IDENTITY_SQL),
        ]);
        // Only a trusted in-process Owner may inject optional Host evidence.
        let hostObservation = null;
        if (hostObservationReadback) {
          let timer;
          try {
            hostObservation = await Promise.race([
              Promise.resolve().then(() => hostObservationReadback()),
              new Promise(resolve => { timer = setTimeout(() => resolve(null), 750); }),
            ]);
          } catch { hostObservation = null; }
          finally { clearTimeout(timer); }
        }
        // The service key authenticates this route but does NOT prove the Owner.
        // Owner evidence can only enter from a trusted in-process adapter.
        let owner = null;
        if (operatorOwnerReadback) {
          let timer;
          try {
            owner = await Promise.race([
              Promise.resolve().then(() => operatorOwnerReadback()),
              new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); }),
            ]);
          } catch { owner = null; }
          finally { clearTimeout(timer); }
        }
        const nowMs = Date.now();
        // Never run the ledger SELECTs without a fresh, exact Owner/generation.
        // Missing SELECT grants, schema, or SQL readback leave both planes UNKNOWN.
        let ledger = null;
        let postmasterChanged = false;
        if (qualifyOperatorOwner(owner, nowMs)) {
          try {
            ledger = await transaction(async tx => {
              // A pool may reconnect to a NEW postmaster after the capability
              // query. Schema, role grants, PG17 and restart identity must be
              // rechecked in THIS ledger transaction before any lease/event read.
              const admission = await admitOwnPg17LedgerReadback({ tx, priorClockRows: clockRows, nowMs });
              if (!admission.admitted) {
                if (admission.reason === 'POSTMASTER_CHANGED') postmasterChanged = true;
                return null;
              }
              return readOwnPostgresOperatorTruth({ tx, owner, nowMs });
            }, { readOnly: true });
          } catch { ledger = null; }
        }
        // W37: the capability/PG17 transaction fences postmaster changes, but
        // the independently observed Owner may reincarnate DURING that async
        // transaction. Before emitting positive lease/cursor data, re-read the
        // in-process Owner generation. A caller's "verified" field alone does
        // not attest native birth or authorize effects.
        if (ledger) {
          let ownerAfter = null;
          let timer;
          try {
            ownerAfter = await Promise.race([
              Promise.resolve().then(() => operatorOwnerReadback()),
              new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); }),
            ]);
          } catch { ownerAfter = null; }
          finally { clearTimeout(timer); }
          const ownerKeys = ['project_id', 'workspace_id', 'device_id', 'owner_id',
            'client_id', 'admin_grant_epoch', 'owner_generation',
            'process_incarnation', 'event_after_seq'];
          if (!qualifyOperatorOwner(ownerAfter, Date.now()) ||
            !ownerKeys.every(key => (owner[key] ?? null) === (ownerAfter[key] ?? null))) {
            ledger = null; // Owner changed or became UNKNOWN: no stale lease truth.
          }
        }
        return send(response, 200, buildUnifiedOperatorContext({ nowMs, observations: {
          ...(hostObservation ? { host: hostObservation } : {}),
          ...(ledger?.fleet ? { fleet: ledger.fleet } : {}),
          ...(ledger?.continuity ? { continuity: ledger.continuity } : {}),
          database: qualifyLocalPostgresEvidence({
            // Never combine pre-restart catalog evidence with post-restart
            // ledger evidence or report the old postmaster as still available.
            clockRows: postmasterChanged ? [] : clockRows, capabilityRows: rows, nowMs,
            rpcAvailable: RPC_ALLOWLIST.length - missing.length,
            rpcExpected: RPC_ALLOWLIST.length,
            tablesAvailable: Object.keys(TABLE_ALLOWLIST).length - unavailable.length,
            tablesExpected: Object.keys(TABLE_ALLOWLIST).length,
          }),
        } }));
      }
      if (url.pathname === '/health' && request.method === 'GET' && !url.search) {
        const missing = RPC_ALLOWLIST.filter((name) => !signatures.some((signature) => signature.name === name));
        const unavailableTables = Object.keys(TABLE_ALLOWLIST).filter((name) => !tableAccess.some((table) => table.name === name && table.readable && table.writable));
        const capabilityPlan = compileRpcRequest('devos_runtime_capabilities_v1', {}, signatures);
        const capabilityRows = await transaction((tx) => tx.unsafe(capabilityPlan.text, driverValues(sql, capabilityPlan.values)));
        return send(response, missing.length || unavailableTables.length ? 503 : 200, {
          ok: missing.length === 0 && unavailableTables.length === 0, schema: 'metaengine.client-state.health.v1', mode: 'LOCAL_POSTGRES',
          instance_id: instanceId, version: 1, rpc_catalog: { available: RPC_ALLOWLIST.length - missing.length, allowed: RPC_ALLOWLIST.length, missing },
          table_catalog: { available: Object.keys(TABLE_ALLOWLIST).length - unavailableTables.length, allowed: Object.keys(TABLE_ALLOWLIST).length, unavailable: unavailableTables },
          runtime_capabilities: capabilityRows[0]?.value ?? null,
        });
      }
      const rpcMatch = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
      const tableMatch = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(url.pathname);
      let plan;
      if (rpcMatch) {
        if (request.method !== 'POST') throw new ApiError(405, 'rpc_post_required');
        if (url.search) throw new ApiError(400, 'rpc_query_parameters_forbidden');
        plan = compileRpcRequest(rpcMatch[1], await readBody(request), signatures);
      } else if (tableMatch) {
        plan = compileTableRequest({ table: tableMatch[1], method: request.method, params: url.searchParams,
          body: request.method === 'POST' ? await readBody(request) : undefined, prefer: request.headers.prefer });
      } else throw new ApiError(404, 'route_not_found');
      const rows = await transaction((tx) => tx.unsafe(plan.text, driverValues(sql, plan.values)));
      send(response, plan.status, plan.scalar ? rows[0]?.value ?? null : plan.returning === false ? null : Array.from(rows));
    } catch (error) {
      const mapped = databaseError(error);
      send(response, mapped.status, mapped.body);
    } finally {
      if (admitted) activeRequests -= 1;
      if (healthAdmitted) activeHealthRequests -= 1;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } catch (error) {
    if (!injectedSql) await sql.end({ timeout: 5 });
    throw error;
  }
  return {
    server,
    readOwnPostgresBirth,
    address: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeIdleConnections();
      await new Promise((resolve) => server.close(resolve));
      if (!injectedSql) await sql.end({ timeout: 5 });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDbApi({
    databaseUrl: process.env.LOCAL_STATE_DATABASE_URL,
    roleMode: process.env.LOCAL_STATE_API_ROLE_MODE || 'service_role',
    apiKey: process.env.LOCAL_STATE_API_KEY,
    host: process.env.LOCAL_STATE_API_HOST || '127.0.0.1',
    port: Number(process.env.LOCAL_STATE_API_PORT || 15432),
    instanceId: process.env.LOCAL_STATE_INSTANCE_ID || '',
  }).then((runtime) => {
    console.log(JSON.stringify({ event: 'local_state_api_ready', address: runtime.address, instance_id: process.env.LOCAL_STATE_INSTANCE_ID || '' }));
    const stop = () => runtime.close().then(() => process.exit(0));
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }).catch((error) => {
    console.error(JSON.stringify({ event: 'local_state_api_failed', code: error?.code || 'startup_failed' }));
    process.exitCode = 1;
  });
}
