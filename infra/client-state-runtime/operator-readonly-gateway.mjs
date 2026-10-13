import { createServer } from 'node:http';
import { authenticated } from './db-api-core.mjs';

// W3/P1: strictly observational gateway. Nothing here has SQL, scheduler or effect authority.
// Caller must provide an attested local Owner instance and optional trusted in-process
// PostgreSQL read adapters. There is deliberately no automatic startup or external bind.
export const OPERATOR_GATEWAY_SCHEMA = 'metaengine.operator.gateway.v1';
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/i;
const STATES = new Set(['UNKNOWN', 'PENDING', 'ADMITTED', 'RUNNING', 'BLOCKED', 'DEGRADED',
  'AMBIGUOUS', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'VERIFIED']);
const MAX_AGE_MS = 30_000;
const MAX_FUTURE_MS = 5_000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_EVENTS = 64;
const validId = value => typeof value === 'string' && IDENTIFIER.test(value);
const validSeq = value => Number.isSafeInteger(value) && value >= 0;
const canonicalTime = value => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const isFresh = (value, now) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) && ms >= now - MAX_AGE_MS && ms <= now + MAX_FUTURE_MS;
};

class GatewayError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function requireId(value, name) {
  if (!validId(value)) throw new GatewayError(400, name + '_invalid');
  return value;
}
function optionalId(value, name) {
  return value === null ? null : requireId(value, name);
}
function requireCursor(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value)) {
    throw new GatewayError(400, 'event_cursor_invalid');
  }
  const result = Number(value);
  if (!validSeq(result)) throw new GatewayError(400, 'event_cursor_invalid');
  return result;
}
function queryObject(url, names) {
  const allowed = new Set(names);
  const out = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key) || Object.hasOwn(out, key)) throw new GatewayError(400, 'query_not_allowed');
    out[key] = value;
  }
  return out;
}
function gatewayEnvelope(operation, now) {
  return { schema: OPERATOR_GATEWAY_SCHEMA, version: 1, operation,
    observed_at: new Date(now).toISOString(), scope: 'READ_ONLY',
    storage: 'OWN_POSTGRES_ONLY', authority_effect: false, scheduler_authority: false,
    automatic_retry_allowed: false };
}
function unknown(operation, now, state = 'UNKNOWN') {
  return { ...gatewayEnvelope(operation, now), state, proof: 'NONE', fresh: false,
    project_id: null, run_id: null, cursor: null };
}
function projectPlane(plane) {
  if (!plane || typeof plane !== 'object') return { state: 'UNKNOWN', proof: 'NONE', fresh: false };
  const state = ['READY', 'AVAILABLE', 'DEGRADED', 'BLOCKED', 'OFFLINE', 'AMBIGUOUS',
    'UNKNOWN', 'UNVERIFIED', 'STALE'].includes(plane.state) ? plane.state : 'UNVERIFIED';
  const verified = plane.fresh === true && plane.proof === 'TRUSTED_READBACK';
  const safe = { state: state === 'READY' && !verified ? 'UNVERIFIED' : state,
    fresh: verified, proof: verified ? 'TRUSTED_READBACK' : 'NONE' };
  if (canonicalTime(plane.observed_at)) safe.observed_at = canonicalTime(plane.observed_at);
  if (Number.isSafeInteger(plane.age_ms) && plane.age_ms >= 0) safe.age_ms = plane.age_ms;
  if (plane.details && typeof plane.details === 'object') {
    const details = {};
    for (const name of ['catalog_rpc_available', 'catalog_rpc_expected',
      'catalog_tables_available', 'catalog_tables_expected']) {
      if (validSeq(plane.details[name])) details[name] = plane.details[name];
    }
    if (typeof plane.details.capability_schema === 'string' &&
      /^[-.A-Za-z0-9]{1,100}$/.test(plane.details.capability_schema)) {
      details.capability_schema = plane.details.capability_schema;
    }
    if (Object.keys(details).length) safe.details = details;
  }
  return safe;
}
function validateContext(value, now) {
  if (!value || value.schema !== 'metaengine.operator.context.v1' ||
    value.storage !== 'OWN_POSTGRES_ONLY' || value.scope !== 'READ_ONLY' ||
    value.authority_effect !== false || value.scheduler_authority !== false ||
    value.cloud_database_dependency !== false || value.remote_fallback_allowed !== false ||
    !isFresh(value.generated_at, now) || !value.planes || typeof value.planes !== 'object') {
    throw new GatewayError(503, 'owner_context_unverified');
  }
  const planes = {};
  for (const name of ['database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity']) {
    planes[name] = projectPlane(value.planes[name]);
  }
  return { schema: 'metaengine.operator.context.v1', generated_at: canonicalTime(value.generated_at),
    storage: 'OWN_POSTGRES_ONLY', scope: 'READ_ONLY', authority_effect: false,
    operational_state: Object.values(planes).every(plane => plane.state === 'READY')
      ? 'ALL_PLANES_REPORTED_READY' : 'NOT_PROVEN', planes };
}
function readIdentity(raw, now, ownerId) {
  if (raw == null) return null;
  if (!raw || raw.source !== 'OWN_POSTGRES_READBACK' || raw.proven !== true ||
    raw.owner_id !== ownerId || !validId(raw.project_id) || !validId(raw.run_id) ||
    !validSeq(raw.owner_epoch) || !validSeq(raw.event_seq) ||
    !isFresh(raw.observed_at, now)) {
    throw new GatewayError(503, 'run_identity_unverified');
  }
  return { project_id: raw.project_id, run_id: raw.run_id,
    owner_epoch: raw.owner_epoch, cursor: String(raw.event_seq),
    source: 'OWN_POSTGRES_READBACK', proof: 'TRUSTED_READBACK', fresh: true,
    observed_at: canonicalTime(raw.observed_at) };
}
function validateProjection(raw, identity, now, requiredFields) {
  if (!raw || raw.source !== 'OWN_POSTGRES_READBACK' || raw.proven !== true ||
    raw.project_id !== identity.project_id || raw.run_id !== identity.run_id ||
    !isFresh(raw.observed_at, now) || !STATES.has(raw.state) ||
    !validSeq(raw.event_seq) || raw.event_seq > Number(identity.cursor)) {
    throw new GatewayError(503, 'operator_projection_unverified');
  }
  for (const field of [...requiredFields, ...(raw.task_id == null ? [] : ['task_id'])]) if (!validId(raw[field])) {
    throw new GatewayError(503, 'operator_projection_unverified');
  }
  return { state: raw.state, event_seq: raw.event_seq,
    observed_at: canonicalTime(raw.observed_at) };
}
async function localGet(upstreamBaseUrl, apiKey, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(upstreamBaseUrl + path, {
      headers: { apikey: apiKey }, signal: controller.signal, redirect: 'error',
      cache: 'no-store',
    });
    if (response.status !== 200 && !(path === '/health' && response.status === 503)) {
      throw new GatewayError(503, 'owner_upstream_unavailable');
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      throw new GatewayError(503, 'owner_response_oversize');
    }
    // Bound streaming reads even when the upstream omits content-length.
    const reader = response.body?.getReader();
    if (!reader) throw new GatewayError(503, 'owner_response_invalid');
    const parts = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new GatewayError(503, 'owner_response_oversize');
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(parts.map(part => Buffer.from(part)))));
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(503, 'owner_upstream_unavailable');
  } finally { clearTimeout(timeout); }
}
function send(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer' });
  response.end(JSON.stringify(body));
}
function validateEventBatch(raw, identity, after, limit, now) {
  if (!raw || raw.proven !== true || raw.source !== 'OWN_POSTGRES_READBACK' ||
    raw.project_id !== identity.project_id || raw.run_id !== identity.run_id ||
    !isFresh(raw.observed_at, now) || !Array.isArray(raw.events) ||
    raw.events.length > limit || raw.events.length > MAX_EVENTS ||
    !validSeq(raw.watermark_event_seq) ||
    raw.watermark_event_seq !== Number(identity.cursor)) {
    throw new GatewayError(503, 'event_readback_unverified');
  }
  let previous = after;
  const events = [];
  for (const event of raw.events) {
    if (!event || !validSeq(event.event_seq) || event.event_seq <= previous ||
      event.event_seq > raw.watermark_event_seq || !validId(event.kind) ||
      !canonicalTime(event.occurred_at) || !HASH.test(event.proof_sha256 || '') ||
      (event.task_id !== null && event.task_id !== undefined && !validId(event.task_id))) {
      throw new GatewayError(503, 'event_readback_unverified');
    }
    previous = event.event_seq;
    events.push({ event_seq: event.event_seq, kind: event.kind,
      task_id: event.task_id || null, occurred_at: canonicalTime(event.occurred_at),
      proof_sha256: event.proof_sha256.toLowerCase() });
  }
  if (after < raw.watermark_event_seq && events.length === 0) {
    throw new GatewayError(503, 'event_window_unverified');
  }
  return { events, next_cursor: String(previous), watermark_cursor: identity.cursor,
    has_more: previous < raw.watermark_event_seq };
}

/**
 * No default listener, mutation route, source auto-discovery, or database credential.
 * readRunIdentity/readInspect/readRunStatus/readEvents are trusted in-process *read-only*
 * adapters supplied by a separately qualified own-PostgreSQL Owner. NULL means UNKNOWN.
 */
export async function startOperatorReadOnlyGateway({
  apiKey, ownerId, upstreamBaseUrl, port = 0, host = '127.0.0.1',
  readRunIdentity = null, readInspect = null, readRunStatus = null, readEvents = null,
} = {}) {
  if (host !== '127.0.0.1') throw new Error('operator_gateway_loopback_required');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('operator_gateway_port_invalid');
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(apiKey)) {
    throw new Error('operator_gateway_owner_key_required');
  }
  if (!validId(ownerId)) throw new Error('operator_gateway_owner_identity_required');
  let upstream;
  try { upstream = new URL(upstreamBaseUrl); } catch { throw new Error('operator_gateway_upstream_invalid'); }
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' ||
    !/^[1-9][0-9]*$/.test(upstream.port) || Number(upstream.port) > 65535 ||
    upstream.pathname !== '/' || upstream.search || upstream.hash ||
    upstream.username || upstream.password) throw new Error('operator_gateway_upstream_loopback_required');
  for (const callback of [readRunIdentity, readInspect, readRunStatus, readEvents]) {
    if (callback !== null && typeof callback !== 'function') throw new Error('operator_gateway_readback_invalid');
  }
  const base = upstream.origin;
  let active = 0;
  const server = createServer(async (request, response) => {
    const now = Date.now();
    let admitted = false;
    let operation = 'unknown';
    try {
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) ||
        request.headers.host !== '127.0.0.1:' + server.address().port ||
        request.headers.origin !== undefined) throw new GatewayError(403, 'loopback_owner_required');
      const protectedHeaders = new Set(['host', 'apikey', 'authorization']);
      const seen = new Set();
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        const name = request.rawHeaders[i].toLowerCase();
        if (protectedHeaders.has(name) && seen.has(name)) throw new GatewayError(400, 'duplicate_auth_header');
        seen.add(name);
      }
      if (!authenticated(request.headers, apiKey)) throw new GatewayError(401, 'owner_key_required');
      if (request.method !== 'GET') throw new GatewayError(405, 'readonly_get_required');
      if (request.headers['transfer-encoding'] ||
        (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
        throw new GatewayError(400, 'get_body_forbidden');
      }
      if (active >= 6) throw new GatewayError(503, 'gateway_busy');
      active++; admitted = true;
      const url = new URL(request.url, base);
      const route = url.pathname;
      if (!['/operator/v1/context', '/operator/v1/inspect',
        '/operator/v1/run_status', '/operator/v1/events'].includes(route)) {
        throw new GatewayError(404, 'route_not_found');
      }
      operation = route.slice('/operator/v1/'.length);
      const expectedKeys = operation === 'context' ? [] :
        operation === 'inspect' ? ['run_id', 'task_id'] :
        operation === 'events' ? ['run_id', 'after', 'limit'] : ['run_id'];
      const query = queryObject(url, expectedKeys);
      if (operation !== 'context') requireId(query.run_id, 'run_id');
      if (operation === 'inspect' && query.task_id !== undefined) requireId(query.task_id, 'task_id');
      if (operation === 'events') {
        if (query.after !== undefined) requireCursor(query.after);
        if (query.limit !== undefined &&
          (!/^[1-9][0-9]?$/.test(query.limit) || Number(query.limit) > MAX_EVENTS)) {
          throw new GatewayError(400, 'event_limit_invalid');
        }
      }
      const health = await localGet(base, apiKey, '/health');
      if (health.instance_id !== ownerId || health.mode !== 'LOCAL_POSTGRES') {
        throw new GatewayError(503, 'owner_identity_mismatch');
      }
      const identity = readIdentity(readRunIdentity ? await readRunIdentity({ ownerId }) : null, now, ownerId);
      if (operation === 'context') {
        const context = validateContext(await localGet(base, apiKey, '/operator/v1/context'), now);
        send(response, 200, { ...gatewayEnvelope(operation, now), context,
          run: identity ? { ...identity, state: 'AVAILABLE' } : unknown('run_identity', now) });
        return;
      }
      if (!identity) throw new GatewayError(503, 'run_identity_unknown');
      if (query.run_id !== identity.run_id) throw new GatewayError(409, 'run_identity_mismatch');
      const envelope = { ...gatewayEnvelope(operation, now), ...identity };
      if (operation === 'inspect') {
        if (!readInspect) throw new GatewayError(503, 'inspect_readback_unknown');
        const raw = await readInspect({ projectId: identity.project_id, runId: identity.run_id,
          taskId: optionalId(query.task_id ?? null, 'task_id'), ownerEpoch: identity.owner_epoch });
        const data = validateProjection(raw, identity, now, query.task_id ? ['task_id'] : []);
        if (query.task_id && raw.task_id !== query.task_id) throw new GatewayError(503, 'inspect_task_mismatch');
        send(response, 200, { ...envelope, ...data, task_id: raw.task_id || null,
          proof: 'TRUSTED_READBACK', authority_effect: false });
        return;
      }
      if (operation === 'run_status') {
        if (!readRunStatus) throw new GatewayError(503, 'run_status_readback_unknown');
        const raw = await readRunStatus({ projectId: identity.project_id, runId: identity.run_id,
          ownerEpoch: identity.owner_epoch });
        const data = validateProjection(raw, identity, now, []);
        send(response, 200, { ...envelope, ...data, proof: 'TRUSTED_READBACK', authority_effect: false });
        return;
      }
      if (!readEvents) throw new GatewayError(503, 'events_readback_unknown');
      const after = requireCursor(query.after ?? '0');
      const limit = Number(query.limit ?? 32);
      if (after > Number(identity.cursor)) throw new GatewayError(409, 'event_cursor_ahead');
      const raw = await readEvents({ projectId: identity.project_id, runId: identity.run_id,
        ownerEpoch: identity.owner_epoch, after, limit });
      send(response, 200, { ...envelope, ...validateEventBatch(raw, identity, after, limit, now),
        proof: 'TRUSTED_READBACK', authority_effect: false });
    } catch (error) {
      const status = error instanceof GatewayError ? error.status : 503;
      const code = error instanceof GatewayError ? error.code : 'readback_unavailable';
      send(response, status, { ...unknown(operation, now), error: code });
    } finally { if (admitted) active--; }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 2000;
  server.maxHeadersCount = 24;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { address: 'http://127.0.0.1:' + server.address().port, server,
    async close() { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); } };
}
