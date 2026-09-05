import { canonicalFabricJson, fabricSha256 } from './browser-fabric-effect-ledger.mjs';

export const BROWSER_FABRIC_TRACE_CONTEXT_SCHEMA = 'metaengine.browser-fabric.trace-context.v1';
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;

function fail(reason) {
  return Object.freeze({ ok: false, reason, authority_effect: false });
}

export function parseW3cTraceparent(value) {
  const match = TRACEPARENT.exec(String(value || '').trim().toLowerCase());
  if (!match) return null;
  if (match[1] === '0'.repeat(32) || match[2] === '0'.repeat(16)) return null;
  return Object.freeze({ version: '00', trace_id: match[1], parent_span_id: match[2], trace_flags: match[3] });
}

/**
 * Binds causal identifiers to one effect without propagating prompt text,
 * credentials, cookies, model content, or arbitrary baggage.
 */
export function bindBrowserFabricTraceContext({
  traceparent,
  effect_id,
  task_id,
  claim_generation,
  cell_id,
  cell_generation,
  browser_context_id,
  browser_process_incarnation,
  target_incarnation,
} = {}) {
  const parsed = parseW3cTraceparent(traceparent);
  if (!parsed) return fail('TRACEPARENT_INVALID');
  const exactIdentities = {
    effect_id,
    task_id,
    cell_id,
    browser_context_id,
    browser_process_incarnation,
    target_incarnation,
  };
  for (const [name, value] of Object.entries(exactIdentities)) {
    if (typeof value !== 'string' || !SAFE_ID.test(value)) return fail(`TRACE_BINDING_INVALID:${name}`);
  }
  if (!Number.isSafeInteger(claim_generation) || claim_generation <= 0) return fail('TRACE_BINDING_INVALID:claim_generation');
  if (!Number.isSafeInteger(cell_generation) || cell_generation <= 0) return fail('TRACE_BINDING_INVALID:cell_generation');
  const correlation = Object.freeze({
    trace_id: parsed.trace_id,
    effect_id,
    task_id,
    claim_generation,
    cell_id,
    cell_generation,
    browser_context_id,
    browser_process_incarnation,
    target_incarnation,
  });
  return Object.freeze({
    ok: true,
    schema: BROWSER_FABRIC_TRACE_CONTEXT_SCHEMA,
    trace_id: parsed.trace_id,
    parent_span_id: parsed.parent_span_id,
    trace_flags: parsed.trace_flags,
    correlation,
    correlation_sha256: fabricSha256(canonicalFabricJson(correlation)),
    arbitrary_baggage_allowed: false,
    sensitive_data_in_context_allowed: false,
    authority_effect: false,
  });
}

export function browserFabricTraceContextContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_TRACE_CONTEXT_SCHEMA,
    w3c_trace_context: true,
    logs_metrics_spans_share_trace_id: true,
    binds_effect_id: true,
    binds_task_and_claim_generation: true,
    binds_cell_and_process_generation: true,
    binds_browser_context_and_target_incarnation: true,
    traceparent_v00_reserved_flags_rejected: true,
    arbitrary_baggage_allowed: false,
    credentials_allowed: false,
    prompt_or_page_content_allowed: false,
    authority_effect: false,
  });
}
