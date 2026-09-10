import { controlActionDescriptor } from './control-actions-manifest.mjs';
import { nativeActionRequiresExactTabTarget } from './native-supervisor-command-lanes.mjs';
import { nativeActionRequiresEffectBinding } from './native-effect-binding.mjs';

export const LEASED_BROWSER_PLAN_SCHEMA = 'metaengine.leased-browser-plan.v1';
export const LEASED_BROWSER_PLAN_MAX_COMMANDS = 32;
// Browser Executor currently reuses the Host Agent IPC protocol whose payload cap is
// 48 KiB. Keep a little envelope headroom rather than accepting a plan that cannot
// cross the physical process boundary.
export const LEASED_BROWSER_PLAN_MAX_BYTES = 40 * 1024;
export const LEASED_BROWSER_PLAN_MAX_DEADLINE_MS = 60_000;

const PLAN_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{16,160}$/;
const SHA256_RE = /^(?:sha256:)?[a-f0-9]{64}$/i;

const ALLOWED_ACTIONS = new Set([
  'POLL', 'CAPTURE', 'CAPTURE_VIEW', 'DOWNLOAD_STATUS',
  'DEV_PLANE_STATUS', 'DEV_PLANE_HEALTH', 'DEV_PLANE_CAPABILITIES',
  'DEV_PLANE_PROCESS_METRICS', 'DEV_PLANE_REPO_HEAD',
  'STOP_GENERATION', 'SCROLL', 'SEMANTIC_FOCUS', 'SEMANTIC_TYPE', 'TYPED_CLICK',
  'SELECT_TAB', 'CLOSE_TAB', 'NAVIGATE', 'BACK', 'FORWARD', 'RELOAD', 'NEW_TAB',
]);
const PAGE_ACTIONS = new Set([
  'STOP_GENERATION', 'SCROLL', 'SEMANTIC_FOCUS', 'SEMANTIC_TYPE', 'TYPED_CLICK',
  'NAVIGATE', 'BACK', 'FORWARD', 'RELOAD',
]);

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function normalizeOrigins(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error('leased_browser_plan_allowed_origins_invalid');
  const out = [];
  for (const raw of value) {
    let origin;
    try { origin = new URL(String(raw)).origin; } catch { throw new Error('leased_browser_plan_allowed_origin_invalid'); }
    if (!/^https?:\/\//.test(origin)) throw new Error('leased_browser_plan_allowed_origin_invalid');
    if (!out.includes(origin)) out.push(origin);
  }
  return Object.freeze(out);
}

function originAllowed(value, allowedOrigins) {
  try { return allowedOrigins.includes(new URL(String(value || '')).origin); } catch { return false; }
}

function normalizeEffectBinding(command, action) {
  if (!nativeActionRequiresEffectBinding(action)) return;
  if (!plainObject(command.effect_binding)) throw new Error(`leased_browser_plan_effect_binding_required:${action}`);
  if (command.effect_binding.authority_effect !== false) throw new Error('leased_browser_plan_effect_binding_authority_flag_invalid');
  if (String(command.effect_binding.command_id || '').toLowerCase() !== String(command.command_id || '').toLowerCase()) {
    throw new Error('leased_browser_plan_effect_binding_command_mismatch');
  }
  if (String(command.effect_binding.action || '').toUpperCase() !== action) throw new Error('leased_browser_plan_effect_binding_action_mismatch');
  if (String(command.effect_binding.tab_id || '') !== String(command.payload?.tab_id || '')) throw new Error('leased_browser_plan_effect_binding_tab_mismatch');
  const digest = command.effect_binding_sha256 == null ? null : String(command.effect_binding_sha256);
  if (digest != null && !SHA256_RE.test(digest)) throw new Error('leased_browser_plan_effect_binding_digest_invalid');
}

function normalizeCommand(value, index, nowMs) {
  if (!plainObject(value)) throw new Error(`leased_browser_plan_command_invalid:${index}`);
  const commandId = String(value.command_id || '').trim().toLowerCase();
  if (!UUID_RE.test(commandId)) throw new Error(`leased_browser_plan_command_id_invalid:${index}`);
  const action = String(value.action || '').trim().toUpperCase();
  const descriptor = controlActionDescriptor(action);
  if (!ALLOWED_ACTIONS.has(action) || descriptor?.browser_implemented !== true) throw new Error(`leased_browser_plan_action_denied:${action || index}`);
  const payload = value.payload == null ? {} : value.payload;
  if (!plainObject(payload)) throw new Error(`leased_browser_plan_payload_invalid:${index}`);
  const expiresAt = Date.parse(String(value.expires_at || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) throw new Error(`leased_browser_plan_command_expired:${commandId}`);
  const idempotencyKey = String(value.idempotency_key || '').trim();
  if (descriptor.effect === 'MUTATING' && !IDEMPOTENCY_RE.test(idempotencyKey)) {
    throw new Error(`leased_browser_plan_idempotency_key_required:${action}`);
  }
  if (nativeActionRequiresExactTabTarget(action)) {
    const tabId = String(payload.tab_id || '').trim();
    if (!TAB_ID_RE.test(tabId)) throw new Error(`leased_browser_plan_exact_tab_required:${action}`);
  }
  const normalized = structuredClone(value);
  normalized.command_id = commandId;
  normalized.action = action;
  normalized.payload = structuredClone(payload);
  normalized.expires_at = new Date(expiresAt).toISOString();
  if (descriptor.effect === 'MUTATING') normalized.idempotency_key = idempotencyKey;
  normalizeEffectBinding(normalized, action);
  return Object.freeze({
    command: Object.freeze(normalized),
    descriptor,
    page_action: PAGE_ACTIONS.has(action),
    mutating: descriptor.effect === 'MUTATING',
  });
}

function normalizeEnvelope(value, nowMs) {
  if (!plainObject(value)) throw new Error('leased_browser_plan_invalid');
  if (value.schema !== LEASED_BROWSER_PLAN_SCHEMA) throw new Error('leased_browser_plan_schema_invalid');
  if (byteLength(value) > LEASED_BROWSER_PLAN_MAX_BYTES) throw new Error('leased_browser_plan_too_large');
  const planId = String(value.plan_id || '').trim();
  if (!PLAN_ID_RE.test(planId)) throw new Error('leased_browser_plan_id_invalid');
  if (!Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > LEASED_BROWSER_PLAN_MAX_COMMANDS) {
    throw new Error('leased_browser_plan_commands_invalid');
  }
  const allowedOrigins = normalizeOrigins(value.allowed_origins);
  const seen = new Set();
  const commands = value.commands.map((command, index) => {
    const row = normalizeCommand(command, index, nowMs);
    if (seen.has(row.command.command_id)) throw new Error('leased_browser_plan_duplicate_command_id');
    seen.add(row.command.command_id);
    return row;
  });
  const deadlineMs = Math.max(250, Math.min(LEASED_BROWSER_PLAN_MAX_DEADLINE_MS, Number(value.deadline_ms) || 30_000));
  return Object.freeze({ plan_id: planId, commands: Object.freeze(commands), allowed_origins: allowedOrigins, deadline_ms: deadlineMs });
}

function receipt(plan, state, completed, currentCommandId, results, extra = {}) {
  return Object.freeze({
    schema: 'metaengine.leased-browser-plan.receipt.v1',
    plan_id: plan.plan_id,
    state,
    completed_commands: completed,
    current_command_id: currentCommandId,
    results: Object.freeze(results.map((row) => Object.freeze(structuredClone(row)))),
    db_lease_required: true,
    transport_delivery_is_authority: false,
    browser_plan_is_authority: false,
    automatic_effect_retry_allowed: false,
    ...extra,
    authority_effect: false,
  });
}

export class LeasedBrowserPlanExecutor {
  #authorizeCommand;
  #executeCommand;
  #verifyCommand;
  #getCurrentUrl;
  #active = new Map();

  constructor({ authorizeCommand, executeCommand, verifyCommand, getCurrentUrl } = {}) {
    if (typeof authorizeCommand !== 'function') throw new Error('leased_browser_plan_authorizer_required');
    if (typeof executeCommand !== 'function') throw new Error('leased_browser_plan_executor_required');
    if (typeof verifyCommand !== 'function') throw new Error('leased_browser_plan_verifier_required');
    if (typeof getCurrentUrl !== 'function') throw new Error('leased_browser_plan_current_url_required');
    this.#authorizeCommand = authorizeCommand;
    this.#executeCommand = executeCommand;
    this.#verifyCommand = verifyCommand;
    this.#getCurrentUrl = getCurrentUrl;
  }

  cancel(planId, reason = 'EXTERNAL_CANCEL') {
    const active = this.#active.get(String(planId || ''));
    if (!active) return Object.freeze({ cancelled: false, reason: 'PLAN_NOT_ACTIVE', authority_effect: false });
    active.reason = String(reason || 'EXTERNAL_CANCEL').slice(0, 160);
    active.controller.abort(active.reason);
    return Object.freeze({ cancelled: true, reason: active.reason, authority_effect: false });
  }

  async execute(input) {
    const plan = normalizeEnvelope(input, Date.now());
    if (this.#active.has(plan.plan_id)) throw new Error('leased_browser_plan_already_active');
    const controller = new AbortController();
    const active = { controller, reason: null };
    this.#active.set(plan.plan_id, active);
    const timer = setTimeout(() => {
      active.reason = 'PLAN_DEADLINE_EXCEEDED';
      controller.abort(active.reason);
    }, plan.deadline_ms);
    timer.unref?.();
    const results = [];
    let completed = 0;

    try {
      for (const row of plan.commands) {
        const command = row.command;
        if (controller.signal.aborted) return receipt(plan, 'CANCELLED', completed, command.command_id, results, { reason: active.reason || 'ABORTED' });
        if (Date.parse(command.expires_at) <= Date.now()) {
          return receipt(plan, 'NEEDS_REPLAN', completed, command.command_id, results, { reason: 'COMMAND_EXPIRED_BEFORE_EFFECT' });
        }
        if (row.page_action) {
          const currentUrl = await this.#getCurrentUrl(structuredClone(command), { signal: controller.signal, plan_id: plan.plan_id });
          if (!originAllowed(currentUrl, plan.allowed_origins)) {
            return receipt(plan, 'NEEDS_REPLAN', completed, command.command_id, results, { reason: 'ORIGIN_FENCE_MISMATCH', observed_url: String(currentUrl || '').slice(0, 1200) });
          }
        }
        if (command.action === 'NAVIGATE' && !originAllowed(command.payload?.url, plan.allowed_origins)) {
          return receipt(plan, 'NEEDS_REPLAN', completed, command.command_id, results, { reason: 'NAVIGATION_TARGET_ORIGIN_DENIED' });
        }

        let authorization;
        try {
          authorization = await this.#authorizeCommand(structuredClone(command), {
            signal: controller.signal,
            plan_id: plan.plan_id,
            command_id: command.command_id,
          });
        } catch (error) {
          return receipt(plan, 'NEEDS_REPLAN', completed, command.command_id, results, {
            reason: 'LOCAL_AUTHORIZATION_ERROR',
            error: String(error?.message || error).slice(0, 240),
          });
        }
        if (authorization?.authorized !== true) {
          return receipt(plan, 'NEEDS_REPLAN', completed, command.command_id, results, { reason: 'LOCAL_AUTHORIZATION_DENIED' });
        }
        if (controller.signal.aborted) return receipt(plan, 'CANCELLED', completed, command.command_id, results, { reason: active.reason || 'ABORTED' });

        let value;
        const started = Date.now();
        try {
          // Do not project this into {action,payload}: the Browser dispatcher must
          // receive the exact DB-leased command together with its sealed effect data.
          value = await this.#executeCommand(structuredClone(command), {
            signal: controller.signal,
            plan_id: plan.plan_id,
            command_id: command.command_id,
          });
        } catch (error) {
          const errorText = String(error?.message || error).slice(0, 240);
          return receipt(plan, row.mutating ? 'AMBIGUOUS' : (controller.signal.aborted ? 'CANCELLED' : 'NEEDS_REPLAN'), completed, command.command_id, results, {
            reason: controller.signal.aborted ? (active.reason || 'ABORTED') : 'EXECUTION_ERROR',
            error: errorText,
          });
        }

        let verification = null;
        if (row.mutating) {
          try {
            verification = await this.#verifyCommand(structuredClone(command), structuredClone(value), {
              signal: controller.signal,
              plan_id: plan.plan_id,
              command_id: command.command_id,
            });
          } catch (error) {
            return receipt(plan, 'AMBIGUOUS', completed, command.command_id, results, {
              reason: 'VERIFICATION_ERROR',
              error: String(error?.message || error).slice(0, 240),
            });
          }
          if (verification?.confirmed !== true) {
            return receipt(plan, verification?.no_effect_proven === true ? 'NEEDS_REPLAN' : 'AMBIGUOUS', completed, command.command_id, results, {
              reason: verification?.no_effect_proven === true ? 'NO_EFFECT_PROVEN' : 'POSTCONDITION_UNPROVEN',
              verification: plainObject(verification) ? structuredClone(verification) : null,
            });
          }
        }

        completed += 1;
        results.push({
          command_id: command.command_id,
          action: command.action,
          effect_binding_sha256: command.effect_binding_sha256 || null,
          execution_ms: Date.now() - started,
          result: value ?? null,
          verification: verification == null ? null : structuredClone(verification),
          authority_effect: false,
        });
      }
      return receipt(plan, 'COMPLETED', completed, null, results);
    } finally {
      clearTimeout(timer);
      this.#active.delete(plan.plan_id);
    }
  }

  snapshot() {
    return Object.freeze({
      schema: LEASED_BROWSER_PLAN_SCHEMA,
      active_plans: this.#active.size,
      max_commands: LEASED_BROWSER_PLAN_MAX_COMMANDS,
      max_bytes: LEASED_BROWSER_PLAN_MAX_BYTES,
      max_deadline_ms: LEASED_BROWSER_PLAN_MAX_DEADLINE_MS,
      allowed_actions: Object.freeze([...ALLOWED_ACTIONS]),
      full_command_preserved: true,
      sealed_effect_binding_required: true,
      local_reauthorization_required: true,
      db_lease_required: true,
      transport_delivery_is_authority: false,
      browser_plan_is_authority: false,
      arbitrary_eval: false,
      raw_cdp_passthrough: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
