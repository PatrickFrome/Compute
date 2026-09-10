import { CONTROL_ACTION_MANIFEST_REVISION } from './control-actions-manifest.mjs';

export const FAST_CONTROL_GATEWAY_SCHEMA = 'metaengine.fast-control-gateway.v1';
export const FAST_CONTROL_MAX_STEPS = 64;
export const FAST_CONTROL_MAX_INPUT_BYTES = 64 * 1024;

const TOOL_NAMES = Object.freeze(['context_get', 'run_submit', 'run_status', 'emergency_stop']);
export const FAST_CONTROL_TOOL_NAMES = TOOL_NAMES;

const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
const clip = (value, max) => value == null ? null : String(value).slice(0, max);

function assertPlain(value, code) {
  if (!plainObject(value)) throw new Error(code);
  if (byteLength(value) > FAST_CONTROL_MAX_INPUT_BYTES) throw new Error('fast_control_input_too_large');
  return value;
}

function exactKeys(value, allowed, code) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${code}:${key}`);
}

function validateCapabilityRevision(value) {
  const revision = String(value || '');
  if (revision !== CONTROL_ACTION_MANIFEST_REVISION) throw new Error('fast_control_capability_revision_mismatch');
  return revision;
}

function normalizeRunStep(step, index) {
  assertPlain(step, `fast_control_run_step_invalid:${index}`);
  exactKeys(step, new Set(['idempotency_key', 'action', 'platform', 'payload']), 'fast_control_run_step_field_unknown');
  const action = String(step.action || '').trim().toUpperCase();
  const idempotencyKey = String(step.idempotency_key || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) throw new Error(`fast_control_idempotency_key_invalid:${index}`);
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(action)) throw new Error(`fast_control_action_invalid:${index}`);
  const payload = step.payload == null ? {} : assertPlain(step.payload, `fast_control_payload_invalid:${index}`);
  if (byteLength(payload) > 16 * 1024) throw new Error(`fast_control_payload_too_large:${index}`);
  return Object.freeze({
    idempotency_key: idempotencyKey,
    action,
    platform: clip(step.platform, 80),
    payload: structuredClone(payload),
    authority_effect: false,
  });
}

function normalizeRunSubmit(input) {
  assertPlain(input, 'fast_control_run_submit_invalid');
  exactKeys(input, new Set(['capability_revision', 'steps']), 'fast_control_run_submit_field_unknown');
  const capabilityRevision = validateCapabilityRevision(input.capability_revision);
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > FAST_CONTROL_MAX_STEPS) {
    throw new Error('fast_control_run_steps_invalid');
  }
  const seen = new Set();
  const steps = input.steps.map((step, index) => {
    const normalized = normalizeRunStep(step, index);
    if (seen.has(normalized.idempotency_key)) throw new Error(`fast_control_duplicate_idempotency_key:${index}`);
    seen.add(normalized.idempotency_key);
    return normalized;
  });
  return Object.freeze({
    schema: 'metaengine.fast-control-run-submit.v1',
    capability_revision: capabilityRevision,
    steps,
    command_count: steps.length,
    authority_effect: false,
  });
}

function normalizeEmergency(input) {
  assertPlain(input, 'fast_control_emergency_invalid');
  exactKeys(input, new Set(['kind', 'idempotency_key', 'reason']), 'fast_control_emergency_field_unknown');
  const kind = String(input.kind || 'DISARM').trim().toUpperCase();
  if (!['DISARM', 'OFF'].includes(kind)) throw new Error('fast_control_emergency_kind_invalid');
  const idempotencyKey = String(input.idempotency_key || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) throw new Error('fast_control_emergency_idempotency_key_invalid');
  const reason = clip(input.reason, 240);
  return Object.freeze({
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    command: Object.freeze({
      idempotency_key: idempotencyKey,
      action: kind === 'DISARM' ? 'DISARM' : 'SET_SUPERVISOR_MODE',
      platform: null,
      payload: kind === 'DISARM' ? { reason } : { mode: 'OFF', reason },
      authority_effect: false,
    }),
    authority_effect: false,
  });
}

export function fastControlToolManifest() {
  return Object.freeze({
    schema: 'metaengine.fast-control-tools.v1',
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    tools: Object.freeze([
      Object.freeze({ name: 'context_get', purpose: 'bounded source-of-truth context', mutating: false }),
      Object.freeze({ name: 'run_submit', purpose: 'issue one bounded typed command batch', mutating: true }),
      Object.freeze({ name: 'run_status', purpose: 'read monotonic terminal result delta', mutating: false }),
      Object.freeze({ name: 'emergency_stop', purpose: 'issue DB-authoritative DISARM or OFF command', mutating: true }),
    ]),
    raw_sql: false,
    arbitrary_eval: false,
    raw_cdp_passthrough: false,
    command_leasing_authority: false,
    browser_execution_authority: false,
    authority_effect: false,
  });
}

export class FastControlGatewayCore {
  #contextGet;
  #issueBatch;
  #resultDelta;
  #issueEmergency;

  constructor({ contextGet, issueBatch, resultDelta, issueEmergency } = {}) {
    if (typeof contextGet !== 'function') throw new Error('fast_control_context_get_required');
    if (typeof issueBatch !== 'function') throw new Error('fast_control_issue_batch_required');
    if (typeof resultDelta !== 'function') throw new Error('fast_control_result_delta_required');
    if (typeof issueEmergency !== 'function') throw new Error('fast_control_issue_emergency_required');
    this.#contextGet = contextGet;
    this.#issueBatch = issueBatch;
    this.#resultDelta = resultDelta;
    this.#issueEmergency = issueEmergency;
  }

  manifest() { return fastControlToolManifest(); }

  async invoke(name, input = {}) {
    const tool = String(name || '').trim();
    if (!TOOL_NAMES.includes(tool)) throw new Error('fast_control_tool_unknown');
    assertPlain(input, 'fast_control_tool_input_invalid');

    if (tool === 'context_get') {
      exactKeys(input, new Set(['fields', 'if_none_match', 'max_bytes']), 'fast_control_context_field_unknown');
      const result = await this.#contextGet({
        fields: Array.isArray(input.fields) ? input.fields.slice(0, 32).map((value) => String(value).slice(0, 80)) : null,
        if_none_match: clip(input.if_none_match, 96),
        max_bytes: input.max_bytes,
      });
      return Object.freeze({ tool, result, authority_effect: false });
    }

    if (tool === 'run_submit') {
      const plan = normalizeRunSubmit(input);
      const result = await this.#issueBatch(plan);
      return Object.freeze({
        tool,
        capability_revision: plan.capability_revision,
        command_count: plan.command_count,
        result,
        browser_effect_executed_by_gateway: false,
        command_leasing_authority: false,
        authority_effect: false,
      });
    }

    if (tool === 'run_status') {
      exactKeys(input, new Set(['after_seq', 'limit']), 'fast_control_run_status_field_unknown');
      const afterSeq = Number(input.after_seq ?? 0);
      const limit = Number(input.limit ?? 16);
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('fast_control_after_seq_invalid');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) throw new Error('fast_control_result_limit_invalid');
      const result = await this.#resultDelta({ after_seq: afterSeq, limit });
      return Object.freeze({ tool, result, authority_effect: false });
    }

    const emergency = normalizeEmergency(input);
    const result = await this.#issueEmergency(emergency);
    return Object.freeze({
      tool,
      capability_revision: emergency.capability_revision,
      result,
      browser_effect_executed_by_gateway: false,
      command_leasing_authority: false,
      emergency_transport_is_authority: false,
      authority_effect: false,
    });
  }
}
