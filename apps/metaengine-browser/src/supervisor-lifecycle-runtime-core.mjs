import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isChatAuthRedirectUrl } from './chatgpt-auth-readback.mjs';
import { AgentSessionMonitor } from './agent-session-monitor.mjs';
import { AGENT_PLATFORM_HOME_URL, AGENT_PLATFORM_ID, classifyAgentPlatformSurface, isAgentPlatformConversationUrl, resolveAgentPlatformComposer } from './browser-agent-platform.mjs';
import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';
import { classifyRetryDecision, REQUEST_EFFECT_CLASS } from './chatgpt-retry-policy.mjs';
import { buildSupervisorRolloverMessage, buildSupervisorWakeMessage } from './supervisor-keepalive.mjs';
import { SupervisorBootstrapKeepalive } from './supervisor-bootstrap-keepalive.mjs';
import { evaluateActiveWakeTerminalRetirement } from './supervisor-terminal-retirement.mjs';
import {
  devosRuntimeControlAllowsContinuousService,
  normalizeDevosRuntimeControl,
  unavailableDevosRuntimeControl,
} from './devos-runtime-control.mjs';

const CHAT_RE = /^https:\/\/chat\.z\.ai\/c\/[a-z0-9-]+/i;
const CHAT_ROOT_RE = /^https:\/\/chat\.z\.ai\/?$/i;
const LIMIT_RE = /(maximum conversation length|conversation is too long|start a new chat|диалог.{0,20}слишком длин|начните новый чат)/i;
const CONTINUOUS_WAKE_REASON = 'CONTINUE_DEVELOPMENT';
// ROLLOVER_DEFERRED bounded auto-release window (closed-loop audit fix):
// generous operator window before the lifecycle self-releases an operator-
// class rollover that approveRollover (no caller, D-K8) would park forever.
const DEFERRED_ROLLOVER_AUTO_RELEASE_MS = 15 * 60 * 1000;
// R-SUP-SEED (live 2026-09-21): tiny deterministic seed that proves a
// PRECONVERSATION_ROOT surface before the supervisor sends the real (large)
// message. Same medicine as the fleet dispatch root bootstrap (B0/A1/C10,
// PR #943): the root composer silently refuses Enter on oversized prompts,
// so the seed — far below any site-side refusal threshold — creates the
// conversation, and the real message types into it afterwards. The live
// rollover black hole was exactly this class: fresh root tab → full
// rollover message → TYPE_EFFECT_AMBIGUOUS → no-progress rerequest loop.
const GLM_SUPERVISOR_CONVERSATION_SEED = 'METAENGINE SUPERVISOR CONVERSATION SEED v1 — bootstrap message: the supervisor continuation message arrives in the NEXT message of this conversation; ignore this seed and reply with a single word: READY';
// R82-DRAFT-CANARY (live 2026-09-26, shell .36089462649.1 = release cf747798): the
// chat.z.ai PRECONVERSATION_ROOT composer restores an account-synced draft into
// EVERY fresh tab. A poisoned oversized draft (live-observed: 28,708 chars
// accumulated since 2026-09-19, two fleet task prompts + supervisor seed)
// cannot be cleared synthetically — live probes proved the root surface
// ignores Ctrl+A+Delete (replace stays unverified), Enter silently refuses
// oversized prompts (AMBIGUOUS_AFTER_ENTER), the site's "New Chat" button
// preserves the draft, and every seed append GROWS the shared account draft
// (live-observed: +202 chars per rollover attempt). Typing into such a
// composer is actively harmful: the canary aborts BEFORE any insert so the
// account draft never grows from supervisor activity. The condition is
// operator-clearable only (a human clears the new-chat draft once); after
// that the rollover retry loop converges on its own.
const ROOT_DRAFT_MAX_CHARS = 4000;
// R82-BLANK-TAB (live 2026-09-26): bounded-navigation stops an uncommitted
// load (DEADLINE_EXCEEDED) and leaves a WebContents that is permanently
// blank — url:'', zero DOM nodes, 0×0 viewport (live: rollover tabs
// webcontents:68+ stayed empty for 5+ minutes while a manually opened tab
// hydrated). A blank tab can never resolve a composer, and the D-C7
// close-by-proof can never retire it because it has no URL to prove against
// the root pattern. These bounds govern the commit readback before typing.
const ROLLOVER_TAB_COMMIT_ATTEMPTS = 6;
const ROLLOVER_TAB_COMMIT_WAIT_MS = 1500;
const ROLLOVER_NEW_TAB_RETRIES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
// R82-BLANK-TAB: a provably blank frame never held a conversation and can
// never hold a landed send — closing it is always safe.
const provablyBlankFrame = (frame) => frame != null
  && String(frame?.url || '') === ''
  && Number((frame?.interaction_tree?.element_count ?? (frame?.interaction_tree?.elements || []).length) || 0) === 0;

function generating(frame) {
  return Boolean(frame?.semantic_targets?.some((x) => x?.role === 'button' && chatGptControlMatches('STOP', x?.name)));
}
function unique(frame, role) {
  const rows = (frame?.semantic_targets || []).filter((x) => x?.role === role);
  return rows.length === 1 ? rows[0] : null;
}
// D-K1 (live 2026-09-19): the signed-in chat.z.ai conversation surface renders
// an auxiliary unnamed textbox next to the real composer, so an exactly-one
// textbox lookup can never resolve there. Every composer use in this runtime
// goes through the platform resolver (named-preference, fail-closed) mapped
// back onto the historical row shape (name/value_length/value_sha256).
function composerTarget(frame) {
  const resolved = resolveAgentPlatformComposer(frame);
  if (!resolved) return null;
  return {
    role: 'textbox',
    name: resolved.accessible_name,
    semantic_ref: resolved.semantic_ref,
    backend_node_id: resolved.backend_node_id,
    value_length: resolved.value_length,
    value_sha256: resolved.value_sha256,
  };
}
function composerMatches(frame, message) {
  const box = composerTarget(frame);
  return Boolean(box?.value_sha256 && box.value_sha256 === sha256(message));
}
function retryEnvelope(message, wakeId, retryAttempt) {
  return `${String(message)}\n\nMETAENGINE_SAME_WAKE_RETRY_V1\nwake_id=${String(wakeId)}\nretry_attempt=${Number(retryAttempt)}\nThis is the same logical supervisor wake, not authority for a duplicate effect. Before any write, deployment, merge or external actuation, re-read authoritative GitHub/Supabase/receipt state and reconcile whether the prior attempt already produced that effect. Never repeat an observed or ambiguous effect. Continue only missing work.`;
}
function tabLiveness(state, tabId) {
  const id = String(tabId || '');
  const tab = (state?.tabs || []).find((row) => String(row?.tab_id || '') === id) || null;
  const networkRows = state?.network?.tabs || state?.tab_network?.tabs || [];
  const network = networkRows.find((row) => String(row?.tab_id || '') === id || Number(row?.webcontents_id || 0) === Number(tab?.webcontents_id || -1)) || tab?.network || null;
  const healthRows = state?.health?.tabs || state?.tab_health?.tabs || [];
  const health = healthRows.find((row) => String(row?.tab_id || '') === id) || tab?.health || null;
  return {
    physical_health: String(health?.state || tab?.physical_health || 'HEALTHY').toUpperCase(),
    network_active: Number(network?.inflight_tracked || 0) > 0,
  };
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e?.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // R82-ATOMIC-SAVE (live 2026-09-26): keepalive mutations fire from
  // un-awaited call sites (e.g. requestRollover(...).catch(() => {})); two
  // overlapping saves sharing one `.tmp` path race the rename into ENOENT
  // and the loser throws into an unrelated cycle — live-observed as a cycle
  // aborting before its rollover dispatch. A unique temp name per save makes
  // concurrent writers last-writer-wins instead of intermittent ENOENT.
  const temp = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

export class SupervisorLifecycleRuntime {
  #getState; #execute; #canActuate; #keepalive = null; #statePath; #lastRun = 0; #lastSupervisorGeneration = 'UNKNOWN'; #lastError = null;
  // D-K3 (live 2026-09-19): a wake send that throws before any effect leaves
  // ONLY the transient #lastError (cleared by the next successful tick), so a
  // permanent pre-effect failure — e.g. the D-K1 composer-not-unique livelock —
  // was invisible in every durable projection: no ambiguous_history growth, no
  // consumed wake, no send diagnostics. These two fields make that class of
  // silent retry loop observable from the state row / telemetry digest.
  #lastSendError = null; #wakeSendFailureCount = 0;
  // D-K7: consecutive composer-blocking send failures — drives the bounded
  // rollover when the bound conversation's composer is provably unusable.
  #composerBlockingFailureCount = 0;
  #lastWorkerSignals = []; #monitorMs; #researchMs; #sessionMonitor; #activeRequest = null; #lastRecovery = null;
  // P0 (2026-09-17): tabs created by failed bootstrap pre-effects (auth redirect
  // surfaces) and not yet provably closed. Retried before every new bootstrap
  // attempt so a wedged CLOSE_TAB can never turn into unbounded tab growth.
  #bootstrapLeakedTabIds = new Set();
  // D-C7 (live 2026-09-19): rollover tabs leaked by failed attempts. Every
  // #rollover() failure used to leave its NEW_TAB at the preconversation root
  // forever; combined with the D-C5 fresh-tab re-request the registry hit the
  // 32-tab wall (live: total_at_wall=true, capacity_backpressure
  // TAB_CAPACITY_EXCEEDED_PRE_EFFECT, keepalive frozen at a fixed cycle_seq).
  // Same in-memory ledger discipline as the bootstrap leaks, with one extra
  // proof obligation: a leaked rollover tab must still be at the ROOT — a tab
  // that drifted to a conversation URL is never ours to close (the ambiguous
  // send may have landed; reconciliation owns that surface).
  #rolloverLeakedTabIds = new Set();
  #runtimeControl = unavailableDevosRuntimeControl('NOT_OBSERVED');
  #requireAuthoritativeAdmission = false;
  #processIncarnationId = null;

  constructor({ getState, executeCommand, canActuate = () => true, statePath = null, monitorMs = 2000, researchMs = 30 * 60 * 1000, sessionMonitor = null, requireAuthoritativeAdmission = false, processIncarnationId = null } = {}) {
    if (typeof getState !== 'function' || typeof executeCommand !== 'function' || typeof canActuate !== 'function') throw new Error('supervisor_lifecycle_dependencies_required');
    this.#getState = getState; this.#execute = executeCommand; this.#canActuate = canActuate; this.#statePath = statePath;
    this.#monitorMs = Math.max(1000, Number(monitorMs) || 2000);
    this.#researchMs = Math.max(5 * 60 * 1000, Number(researchMs) || 30 * 60 * 1000);
    this.#sessionMonitor = sessionMonitor || new AgentSessionMonitor();
    this.#requireAuthoritativeAdmission = requireAuthoritativeAdmission === true;
    // Test seam only: production leaves this null so the keepalive derives its
    // own process incarnation. Tests inject a fixed id to model a wake that
    // went ambiguous earlier in the SAME process (the D-S1 live deadlock).
    this.#processIncarnationId = processIncarnationId ? String(processIncarnationId) : null;
  }

  async start() {
    if (!this.#statePath) {
      const { app } = await import('electron');
      this.#statePath = path.join(app.getPath('userData'), 'metaengine-supervisor-keepalive-v1.json');
    }
    this.#keepalive = new SupervisorBootstrapKeepalive({
      loadState: () => readJson(this.#statePath),
      saveState: (v) => writeJson(this.#statePath, v),
      ...(this.#processIncarnationId ? { processIncarnationId: this.#processIncarnationId } : {}),
    });
    await this.#keepalive.init();
    if (this.#requireAuthoritativeAdmission || this.#runtimeControl.authoritative === true) {
      await this.#applyRuntimeControlToKeepalive();
    }
    const active = this.#keepalive.activeWake();
    if (active) this.#activateRequest(active, this.#keepalive.snapshot().tab_id, true);
    await this.cycle({ force: true });
    return this.snapshot();
  }

  #activateRequest(wake, tabId, restored) {
    const message = buildSupervisorWakeMessage({
      supervisorEpoch: wake.supervisor_epoch,
      cycleSeq: wake.cycle_seq,
      wakeId: wake.wake_id,
      reason: wake.reason,
    });
    this.#activeRequest = {
      wake_id: wake.wake_id,
      tab_id: String(tabId || ''),
      message,
      retry_attempt: 0,
      same_chat_retry_attempt: 0,
      blocked_ambiguous: false,
      effect_class: REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE,
      restored_from_durable_keepalive: restored === true,
    };
    return this.#activeRequest;
  }

  async #applyRuntimeControlToKeepalive() {
    if (!this.#keepalive) return null;
    const durableFloor = this.#keepalive.snapshot()?.admission_generation_floor;
    if (this.#runtimeControl.authoritative === true
      && typeof durableFloor === 'number'
      && this.#runtimeControl.generation_floor < durableFloor) {
      this.#runtimeControl = unavailableDevosRuntimeControl('GENERATION_FLOOR_REGRESSION');
    }
    if (this.#runtimeControl.authoritative !== true) {
      return this.#keepalive.applyAdmissionUnavailable(this.#runtimeControl.reason || 'AUTHORITATIVE_READBACK_UNAVAILABLE');
    }
    if (devosRuntimeControlAllowsContinuousService(this.#runtimeControl)) {
      return this.#keepalive.applyAdmissionOpen(this.#runtimeControl);
    }
    return this.#keepalive.applyAdmissionClosed(this.#runtimeControl);
  }

  async applyRuntimeControl(value) {
    const next = normalizeDevosRuntimeControl(value);
    const previous = this.#runtimeControl;
    this.#runtimeControl = next;
    const changed = previous.state !== next.state
      || previous.authoritative !== next.authoritative
      || previous.generation_floor !== next.generation_floor
      || previous.refill_enabled !== next.refill_enabled
      || previous.supervisor_admission_enabled !== next.supervisor_admission_enabled
      || previous.reason !== next.reason;
    if (changed || this.#keepalive?.snapshot()?.admission_state !== next.state) {
      await this.#applyRuntimeControlToKeepalive();
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      schema: 'metaengine.supervisor-lifecycle-runtime.v4',
      keepalive: this.#keepalive?.snapshot() || null,
      supervisor_generation: this.#lastSupervisorGeneration,
      supervisor_session: this.#sessionMonitor?.snapshot() || null,
      continuous_service: {
        enabled: this.#requireAuthoritativeAdmission
          ? devosRuntimeControlAllowsContinuousService(this.#runtimeControl)
          : true,
        runtime_control: structuredClone(this.#runtimeControl),
        admission_state: this.#requireAuthoritativeAdmission ? this.#runtimeControl.state : 'UNSCOPED',
        authoritative_admission_required: this.#requireAuthoritativeAdmission,
        monitor_ms: this.#monitorMs,
        auto_rollover_cycles: null,
        work_cycle_limit: null,
        automatic_rollover_cycle_limit_enabled: false,
        external_confirmation_required_for_continuation: false,
        terminal_requires_user_message: false,
        restart_resumable: true,
        restart_pending_wake_reconciliation: 'COMPOSER_HASH_OR_TRANSCRIPT_PROOF_V1',
        restart_rollover_reconciliation: 'ROLLOVER_ATTEMPT_COMPOSER_HASH_OR_TRANSCRIPT_PROOF_V1',
        prompt_plaintext_persisted: false,
        orphaned_stall_stop_only: true,
        ambiguous_terminal_retirement: true,
        active_wake_terminal_retirement: 'EXACT_WAKE_TAB_GENERATION_V1',
        ambiguous_same_wake_retry: false,
        wake_send_transport: 'SEMANTIC_TYPE_SUBMIT_EVENT_LATCH_V1',
        initial_conversation_bootstrap: 'DEDICATED_ROOT_EXACT_WAKE_V1',
        authority_effect: false,
      },
      active_request: this.#activeRequest ? {
        wake_id: this.#activeRequest.wake_id,
        tab_id: this.#activeRequest.tab_id,
        retry_attempt: this.#activeRequest.retry_attempt,
        same_chat_retry_attempt: this.#activeRequest.same_chat_retry_attempt,
        blocked_ambiguous: this.#activeRequest.blocked_ambiguous === true,
        restored_from_durable_keepalive: this.#activeRequest.restored_from_durable_keepalive === true,
        trusted_prompt_persisted: false,
        effect_class: this.#activeRequest.effect_class,
      } : null,
      last_recovery: this.#lastRecovery ? structuredClone(this.#lastRecovery) : null,
      last_send_error: this.#lastSendError ? structuredClone(this.#lastSendError) : null,
      wake_send_failure_count: this.#wakeSendFailureCount,
      worker_signals: structuredClone(this.#lastWorkerSignals),
      quiescent: this.isQuiescent(),
      actuation_enabled: this.#canActuate() === true
        && (!this.#requireAuthoritativeAdmission || devosRuntimeControlAllowsContinuousService(this.#runtimeControl)),
      last_error: this.#lastError,
      authority_effect: false,
    };
  }

  isQuiescent() {
    const ks = this.#keepalive?.snapshot();
    if (ks?.state === 'PARKED') return !ks.pending_wake && !ks.active_wake;
    if (!ks || this.#lastSupervisorGeneration !== 'IDLE') return false;
    if (this.#activeRequest || this.#lastRecovery?.ambiguous === true) return false;
    if (ks.pending_wake) return false;
    const blockingQueued = (ks.queued_wakes || []).filter((wake) => String(wake?.reason || '') !== CONTINUOUS_WAKE_REASON);
    if (blockingQueued.length > 0) return false;
    if (['WAKE_PENDING','WAKE_AMBIGUOUS','ROLLOVER_REQUIRED','ROLLOVER_PENDING','ROLLOVER_AMBIGUOUS','RECOVERING','ACTIVE'].includes(ks.state)) return false;
    return this.#lastWorkerSignals.every((s) => ['IDLE','TERMINAL'].includes(String(s?.generation_state || 'UNKNOWN')));
  }

  async #capture(tabId) { return this.#execute({ action: 'CAPTURE', payload: { tab_id: String(tabId) }, platform: null }); }

  async #supervisorTab(state) {
    const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => a?.tab_id).filter(Boolean).map(String));
    const tabs = state?.tabs || [];
    const snap = this.#keepalive.snapshot();
    if (snap.conversation_url) {
      const exact = tabs.find((t) => String(t?.url || '') === snap.conversation_url && !fleetTabs.has(String(t?.tab_id || '')));
      if (exact) { if (snap.tab_id !== String(exact.tab_id)) await this.#keepalive.rebindTab(exact.tab_id); return exact; }
      // P0 (2026-09-17): while the user session is logged out, recreating the bound
      // conversation tab would land on the auth-redirect surface again and leak one
      // tab per maintenance tick (the live host reached tab_capacity_exceeded this
      // way). Reuse the existing auth-redirect tab as the observation target instead:
      // the session monitor classifies it (NOT_CHATGPT_CONVERSATION) and every
      // navigation-class recovery stays gated on auth surfaces. Zero new tabs.
      const authRedirected = tabs.filter((t) => !fleetTabs.has(String(t?.tab_id || '')) && isChatAuthRedirectUrl(String(t?.url || '')));
      if (authRedirected.length > 0) {
        return authRedirected.find((t) => t?.selected === true) || authRedirected[0];
      }
      if (this.#canActuate() !== true) return null;
      const restored = await this.#execute({ action: 'NEW_TAB', payload: { url: snap.conversation_url, select: false }, platform: null });
      if (restored?.tab_id) { await this.#keepalive.rebindTab(restored.tab_id); return { ...restored, url: snap.conversation_url }; }
    }
    const candidates = tabs.filter((t) => !fleetTabs.has(String(t?.tab_id || '')) && CHAT_RE.test(String(t?.url || '')));
    const picked = candidates.find((t) => t?.selected === true) || candidates[0] || null;
    if (picked) await this.#keepalive.bindConversation({ url: picked.url, tab_id: picked.tab_id });
    return picked;
  }

  async #observeWorkers(state) {
    const signals = [];
    for (const agent of state?.fleet?.agents || []) {
      let generation_state = ['LOST','RETIRED','PROVISIONING_AMBIGUOUS'].includes(String(agent?.lifecycle_state || '')) ? 'TERMINAL' : 'UNKNOWN';
      if (agent?.tab_id && generation_state !== 'TERMINAL') {
        try { generation_state = generating(await this.#capture(agent.tab_id)) ? 'GENERATING' : 'IDLE'; } catch {}
      }
      signals.push({ agent_id: agent?.agent_id, lifecycle_state: agent?.lifecycle_state, generation_state });
    }
    this.#lastWorkerSignals = signals;
    await this.#keepalive.observeWorkers(signals);
  }

  async #observeSendReadback(tabId, marker, attempts = 6) {
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await sleep(700);
      const observed = await this.#capture(tabId);
      if (generating(observed) || (marker && String(observed?.text_excerpt || '').includes(marker))) return { ok: true, observed };
    }
    return { ok: false, observed: null };
  }

  async #recoverAmbiguousWakeFromFrame(tab, frame, row, keepalive) {
    const pending = keepalive.pending_wake;
    if (!pending?.ambiguous_at) return false;
    const message = buildSupervisorWakeMessage({
      supervisorEpoch: pending.supervisor_epoch,
      cycleSeq: pending.cycle_seq,
      wakeId: pending.wake_id,
      reason: pending.reason,
    });
    const markerObserved = String(frame?.text_excerpt || '').includes(String(pending.wake_id || ''));
    if (markerObserved) {
      await this.#keepalive.resolveAmbiguous({ observed_sent: true });
      this.#activateRequest(pending, tab.tab_id, true);
      this.#lastRecovery = {
        action: 'AMBIGUOUS_WAKE_POSITIVELY_REBOUND', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'WAKE_MARKER_IN_TRANSCRIPT', confirmed: true, ambiguous: false,
        automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    }
    const composer = composerTarget(frame);
    if (row.terminal_ready === true
      && composer?.value_sha256 === sha256(message)
      && this.#canActuate() === true) {
      // GLM platform: the composer still holding the exact message is the
      // proof the prior Enter never submitted; the continuation re-submits the
      // same logical wake through the Enter lane (no named SEND control).
      if (!composer?.semantic_ref) return false;
      const continuationArmed = await this.#keepalive.markAmbiguousContinuationAttempt({
        wake_id: pending.wake_id,
        tab_id: tab.tab_id,
        composer_sha256: composer.value_sha256,
      });
      if (!continuationArmed) return false;
      await this.#execute({
        action: 'SEMANTIC_TYPE',
        payload: { tab_id: String(tab.tab_id), role: 'textbox', accessible_name: composer.name, semantic_ref: composer.semantic_ref, text: message, replace_existing: true, submit_after_type: true },
        platform: AGENT_PLATFORM_ID,
      });
      const readback = await this.#observeSendReadback(tab.tab_id, pending.wake_id);
      if (readback.ok) {
        await this.#keepalive.resolveAmbiguous({ observed_sent: true });
        this.#activateRequest(pending, tab.tab_id, true);
        this.#lastRecovery = {
          action: 'RESTART_TYPED_WAKE_SEND_RECOVERED', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
          proof: 'DURABLE_SINGLE_CONTINUATION_FENCE_THEN_POSITIVE_SEND_READBACK', confirmed: true, ambiguous: false,
          prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
        return true;
      }
      this.#lastRecovery = {
        action: 'RESTART_TYPED_WAKE_SEND_AMBIGUOUS', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'DURABLE_SINGLE_CONTINUATION_FENCE_BEFORE_CLICK', confirmed: false, ambiguous: true,
        prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    }
    return false;
  }

  async #observeSupervisor(tab, state) {
    const frame = await this.#capture(tab.tab_id);
    const live = tabLiveness(state, tab.tab_id);
    const row = this.#sessionMonitor.observe({ tab_id: tab.tab_id, frame, ...live });
    const previous = this.#lastSupervisorGeneration;
    this.#lastSupervisorGeneration = row.state;

    let keepalive = this.#keepalive.snapshot();
    if (keepalive.pending_wake?.ambiguous_at) {
      const recovered = await this.#recoverAmbiguousWakeFromFrame(tab, frame, row, keepalive);
      keepalive = this.#keepalive.snapshot();
      if (recovered) return { frame, row };
    }
    if (row.terminal_ready === true && keepalive.pending_wake?.ambiguous_at) {
      const retiredWakeId = String(keepalive.pending_wake.wake_id || '');
      await this.#keepalive.retireAmbiguousAfterTerminal({
        tab_id: tab.tab_id,
        generation_epoch: row.generation_epoch,
        reason: 'SUPERVISOR_TERMINAL_BOUNDARY_CONFIRMED',
      });
      this.#lastRecovery = {
        action: 'AMBIGUOUS_WAKE_RETIRED_AFTER_TERMINAL',
        wake_id: retiredWakeId,
        tab_id: String(tab.tab_id),
        generation_epoch: row.generation_epoch,
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
      keepalive = this.#keepalive.snapshot();
    }

    const activeRetirement = this.#activeRequest ? evaluateActiveWakeTerminalRetirement({
      active_request: this.#activeRequest,
      active_wake: keepalive.active_wake,
      terminal_row: row,
      previous_state: previous,
      observed_tab_id: tab.tab_id,
      keepalive_tab_id: this.#keepalive.snapshot().tab_id,
    }) : null;
    if (activeRetirement?.retire === true) {
      const request = this.#activeRequest;
      await this.#keepalive.markCycleComplete();
      this.#activeRequest = null;
      this.#lastRecovery = {
        action: 'ACTIVE_WAKE_RETIRED_AFTER_TERMINAL',
        reason: activeRetirement.reason,
        wake_id: activeRetirement.wake_id,
        prior_request_tab_id: request?.tab_id || null,
        tab_id: String(tab.tab_id),
        generation_epoch: row.generation_epoch,
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
    } else if (row.terminal_ready === true && this.#lastRecovery?.action === 'STOP_ORPHANED_GENERATION') {
      this.#lastRecovery = { ...this.#lastRecovery, confirmed: true, ambiguous: false, terminal_confirmed_at: new Date().toISOString() };
    }
    if (LIMIT_RE.test(String(frame?.text_excerpt || ''))) await this.#keepalive.requestRollover('CHATGPT_CONVERSATION_LIMIT_HINT');
    return { frame, row };
  }

  async #queueResearch() {
    const s = this.#keepalive.snapshot();
    const last = s.last_research_wake_at ? new Date(s.last_research_wake_at).getTime() : 0;
    if (!last || Date.now() - last >= this.#researchMs) await this.#keepalive.enqueueWake('RESEARCH_ACCELERATOR_DUE', { key: `epoch-${s.supervisor_epoch}` });
  }

  async #ensureContinuousWake() {
    const s = this.#keepalive.snapshot();
    if (s.paused || s.pending_wake || s.active_wake) return false;
    if (['WAKE_AMBIGUOUS','ROLLOVER_DEFERRED','ROLLOVER_REQUIRED','ROLLOVER_PENDING','ROLLOVER_AMBIGUOUS','RECOVERING'].includes(s.state)) return false;
    if ((s.queued_wakes || []).some((wake) => String(wake?.reason || '') === CONTINUOUS_WAKE_REASON)) return false;
    await this.#keepalive.enqueueWake(CONTINUOUS_WAKE_REASON, { key: `epoch-${s.supervisor_epoch}-cycle-${s.cycle_seq}` });
    return true;
  }

  async #typeAndSend(tabId, message, positiveMarker) {
    let clicked = false;
    // D-C7: a freshly opened root tab hydrates asynchronously — the first
    // CAPTURE can transiently show zero or several textboxes, which used to
    // throw supervisor_composer_not_unique and leak the whole rollover
    // attempt. Bounded recapture: give the surface a few seconds to settle
    // before declaring the composer unresolvable. Healthy conversation tabs
    // resolve on the first capture and never pay the wait.
    // R-ROOT-HYDRATION (live 2026-09-21, shell .35637609965.1): the fresh-root
    // budget was still too small — the live rollover attempt of 20:29Z burned
    // all 4×1200ms recaptures on a not-yet-hydrated root and threw
    // supervisor_composer_not_unique (ROLLOVER_ERROR). chat.z.ai hydration
    // (SPA bundle + account draft sync) measures ~5-10s cold. 8×1800ms = 14.4s
    // worst case, still bounded; healthy tabs keep resolving on first capture.
    let before = await this.#capture(tabId);
    for (let attempt = 0; attempt < 8 && !generating(before) && !composerTarget(before); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      before = await this.#capture(tabId);
    }
    if (generating(before)) return { ok: false, reason: 'GENERATION_STILL_ACTIVE', clicked: false };
    let box = composerTarget(before);
    if (!box) throw new Error('supervisor_composer_not_unique');
    // R82-DRAFT-CANARY: a PRECONVERSATION_ROOT composer holding an oversized
    // account-synced draft is provably unusable (Enter refuses oversized
    // prompts) and every insert into it grows the shared account draft.
    // Abort BEFORE any physical effect — clicked:false is the provable
    // pre-effect contract, so the wake/rollover marks carry the distinct
    // machine reason ROOT_DRAFT_OVERSIZED instead of looping through
    // TYPE_EFFECT_AMBIGUOUS while silently poisoning the account further.
    if (classifyAgentPlatformSurface(before?.url)?.stage === 'PRECONVERSATION_ROOT'
      && Number.isFinite(Number(box.value_length))
      && Number(box.value_length) > ROOT_DRAFT_MAX_CHARS) {
      this.#lastError = `root_draft_oversized:${Number(box.value_length)}`;
      return { ok: false, reason: 'ROOT_DRAFT_OVERSIZED', clicked: false, event_driven_readback: true };
    }
    // R-SUP-SEED (live 2026-09-21): a PRECONVERSATION_ROOT surface (fresh
    // rollover tab, RECOVERING bootstrap) silently refuses Enter on oversized
    // prompts — the exact failure class the fleet dispatcher fixed with the
    // tiny conversation seed. The rollover message carries the full keepalive
    // summary, so typing it straight into the root composer produced the live
    // black hole: TYPE_EFFECT_AMBIGUOUS → markRolloverAmbiguous → no-progress
    // rerequest → fresh tab → repeat. Medicine: prove the conversation FIRST
    // with the tiny deterministic seed, then type the real message on the
    // conversation surface where replace+Enter are live-proven. Established
    // conversation surfaces never pay the seed cost.
    if (classifyAgentPlatformSurface(before?.url)?.stage === 'PRECONVERSATION_ROOT') {
      const seed = await this.#seedRootConversation(tabId, box);
      if (!seed.ok) {
        this.#lastError = `supervisor_root_seed:${seed.reason}`;
        return { ok: false, reason: seed.reason, clicked: seed.clicked === true, event_driven_readback: true };
      }
      before = seed.frame || before;
      const conversationBox = composerTarget(before);
      if (conversationBox) box = conversationBox;
    }
    // Persisted wake intent already fences this logical effect. Submit through the
    // semantic command's CDP event latch so type + send has one physical boundary
    // and one positive readback path. Once submit dispatch starts, any exception is
    // conservatively ambiguous and must never fall through to a second click.
    clicked = true;
    const submitted = await this.#execute({
      action: 'SEMANTIC_TYPE',
      payload: {
        tab_id: tabId,
        role: 'textbox',
        accessible_name: box.name,
        semantic_ref: box.semantic_ref,
        text: message,
        replace_existing: true,
        submit_after_type: true,
      },
      platform: AGENT_PLATFORM_ID,
    });
    if (submitted?.suppressed === true) {
      const reason = String(submitted.reason || 'SEMANTIC_SUBMIT_SUPPRESSED');
      const preEffect = ['SEMANTIC_REF_REOBSERVE_REQUIRED','CHATGPT_SERVICE_THROTTLED'].includes(reason);
      return { ok: false, reason, clicked: !preEffect, event_driven_readback: true };
    }
    const submitState = String(submitted?.effect_state || '').toUpperCase();
    if (['PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_COMPOSER_CLEARED'].includes(submitState)) {
      // The GLM monitor's only authoritative GENERATING entry: the proven
      // Enter submit. Digest churn then tracks streaming; settle flips IDLE.
      this.#sessionMonitor.markGenerationStarted(tabId);
      return { ok: true, clicked: true, observed: submitted, event_driven_readback: true };
    }
    if (submitState) {
      const readback = await this.#observeSendReadback(tabId, positiveMarker);
      return readback.ok
        ? { ok: true, clicked: true, observed: readback.observed, event_driven_readback: true }
        : { ok: false, reason: 'SEND_WITHOUT_POSITIVE_READBACK', clicked: true, event_driven_readback: true };
    }

    // Compatibility only for injected/legacy executors that do not advertise a
    // submit effect state. Current Browser executors never take this branch.
    // GLM platform: there is no named SEND control — the compatibility path
    // re-submits through the same Enter lane using the live composer ref.
    const compatFrame = await this.#capture(tabId);
    const compatComposer = composerTarget(compatFrame);
    if (!compatComposer?.semantic_ref) throw new Error('supervisor_composer_not_unique');
    await this.#execute({
      action: 'SEMANTIC_TYPE',
      payload: { tab_id: tabId, role: 'textbox', accessible_name: compatComposer.name, semantic_ref: compatComposer.semantic_ref, text: message, replace_existing: true, submit_after_type: true },
      platform: AGENT_PLATFORM_ID,
    });
    const readback = await this.#observeSendReadback(tabId, positiveMarker);
    return readback.ok ? { ok: true, clicked, observed: readback.observed } : { ok: false, reason: 'SEND_WITHOUT_POSITIVE_READBACK', clicked };
  }

  // R-SUP-SEED: root-surface conversation bootstrap (see #typeAndSend).
  // One SEMANTIC_TYPE (submit_after_type) with the tiny seed, bounded
  // conversation-URL readback (6×700ms — the dispatch readback contract; the
  // 2s command latch alone can miss the async SPA navigation), then a bounded
  // generation drain — the real submit is only safe on an idle surface.
  // Fail-closed: an unproven seed is a NOT-OK with clicked=true (the seed
  // WAS submitted — conservatively ambiguous, never a second click); a
  // suppressed seed mirrors the real-submit suppression semantics
  // (#typeAndSend): a provably pre-effect reason is a clean abort
  // (clicked=false), anything else stays conservatively ambiguous
  // (clicked=true) so the D-S1 proof-based retirement bounds the retry.
  async #seedRootConversation(tabId, box) {
    const submitted = await this.#execute({
      action: 'SEMANTIC_TYPE',
      payload: {
        tab_id: tabId,
        role: 'textbox',
        accessible_name: box.name,
        semantic_ref: box.semantic_ref,
        text: GLM_SUPERVISOR_CONVERSATION_SEED,
        replace_existing: true,
        submit_after_type: true,
      },
      platform: AGENT_PLATFORM_ID,
    });
    if (submitted?.suppressed === true) {
      const reason = String(submitted.reason || 'SEMANTIC_SUBMIT_SUPPRESSED');
      const preEffect = ['SEMANTIC_REF_REOBSERVE_REQUIRED', 'CHATGPT_SERVICE_THROTTLED'].includes(reason);
      return { ok: false, clicked: !preEffect, reason, frame: null };
    }
    let frame = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sleep(700);
      try { frame = await this.#capture(tabId); } catch { frame = null; }
      if (frame && isAgentPlatformConversationUrl(String(frame?.url || ''))) break;
      frame = null;
    }
    if (!frame) return { ok: false, clicked: true, reason: 'ROOT_SEED_CONVERSATION_NOT_PROVEN', frame: null };
    for (let attempt = 0; attempt < 10 && generating(frame); attempt += 1) {
      await sleep(1200);
      try { frame = await this.#capture(tabId); } catch { frame = null; break; }
    }
    if (!frame || generating(frame)) return { ok: false, clicked: true, reason: 'ROOT_SEED_GENERATION_STILL_ACTIVE', frame: null };
    return { ok: true, clicked: true, reason: null, frame };
  }

  // D-K7: pre-effect wake-send failure reasons that mean the composer itself
  // is unusable (cannot be typed into provably). After a bounded streak the
  // keepalive rolls the supervisor over to a FRESH conversation — a new
  // surface has an empty composer, where a verified replace is trivial —
  // instead of retrying into the same poisoned draft forever.
  static #COMPOSER_BLOCKING_REASONS = new Set([
    'TYPE_EFFECT_AMBIGUOUS',
    'SEMANTIC_REF_REOBSERVE_REQUIRED',
    'SEMANTIC_SUBMIT_SUPPRESSED',
  ]);

  async #sendWake(prepared) {
    if (this.#canActuate() !== true) return false;
    let clicked = false;
    try {
      const sent = await this.#typeAndSend(prepared.tab_id, prepared.message, prepared.pending.wake_id);
      clicked = sent.clicked === true;
      if (sent.ok) {
        await this.#keepalive.confirmWakeSent(prepared.pending.wake_id);
        this.#activateRequest(prepared.pending, prepared.tab_id, false);
        // D-K3: a confirmed send closes the failure streak; the last error
        // stays for the projection (when it happened, how it presented).
        this.#wakeSendFailureCount = 0;
        this.#composerBlockingFailureCount = 0;
        return true;
      }
      await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, sent.reason || 'SEND_WITHOUT_POSITIVE_READBACK');
      this.#recordComposerBlockingFailure(String(sent.reason || ''));
    } catch (e) {
      await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, clicked ? 'SEND_PATH_AMBIGUOUS' : 'NO_SEND_EFFECT').catch(() => {});
      if (!clicked) await this.#keepalive.resolveAmbiguous({ observed_sent: false }).catch(() => {});
      this.#lastError = String(e?.message || e).slice(0, 240);
      // D-K3: durable pre-effect failure trace. The wake was provably not
      // sent (resolveAmbiguous above) so the next tick re-prepares it —
      // without this record a permanent failure looks like idle WAITING.
      this.#wakeSendFailureCount += 1;
      this.#lastSendError = {
        at: new Date().toISOString(),
        wake_id: prepared?.pending?.wake_id || null,
        reason: String(e?.message || e).slice(0, 240),
        clicked,
        failure_count: this.#wakeSendFailureCount,
        authority_effect: false,
      };
      this.#recordComposerBlockingFailure(String(e?.message || e));
    }
    return false;
  }

  #recordComposerBlockingFailure(reason) {
    const blocked = SupervisorLifecycleRuntime.#COMPOSER_BLOCKING_REASONS.has(reason)
      || reason.includes('native_semantic_type_replace_unverified')
      || reason.includes('native_semantic_ref_stale')
      || reason.includes('supervisor_composer_not_unique');
    if (!blocked) return;
    this.#composerBlockingFailureCount += 1;
    if (this.#composerBlockingFailureCount >= 3) {
      // D-K7: three consecutive composer-blocking failures — the bound
      // conversation's composer is provably unusable (poisoned draft that
      // re-restores after every clear attempt). Roll over to a fresh
      // conversation instead of looping forever.
      this.#composerBlockingFailureCount = 0;
      this.#keepalive.requestRollover('COMPOSER_UNCLEARABLE_DK7', { autoRelease: true }).catch(() => {});
    }
  }

  async #waitForBootstrapRoot(tabId, attempts = 8) {
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await sleep(500);
      const frame = await this.#capture(tabId);
      if (CHAT_ROOT_RE.test(String(frame?.url || '')) && !generating(frame) && composerTarget(frame)) {
        return { ok: true, frame };
      }
      if (CHAT_RE.test(String(frame?.url || ''))) return { ok: false, reason: 'BOOTSTRAP_ROOT_UNEXPECTED_CONVERSATION', frame };
    }
    return { ok: false, reason: 'BOOTSTRAP_ROOT_NOT_READY', frame: null };
  }

  async #bootstrapSupervisorConversation({ preferredExistingRootTabId = null } = {}) {
    if (this.#canActuate() !== true) return false;
    const before = this.#keepalive.snapshot();
    if (before.paused
      || before.state !== 'RECOVERING'
      || before.conversation_url
      || before.pending_wake
      || before.active_wake
      || !Array.isArray(before.queued_wakes)
      || before.queued_wakes.length === 0) return false;

    let prepared = null;
    try {
      // P0 (2026-09-17): close-by-proof sweep of tabs leaked by earlier failed
      // bootstrap attempts before creating anything new, so the retry loop is
      // tab-neutral no matter how long the user session stays logged out.
      if (this.#bootstrapLeakedTabIds.size > 0) await this.#sweepLeakedBootstrapTabs();
      const preferredId = String(preferredExistingRootTabId || '');
      let tab = null;
      let createdHere = false;
      if (preferredId) {
        const current = await this.#getState();
        const fleetTabs = new Set((current?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
        const scopedRoots = (current?.tabs || []).filter((candidate) => (
          String(candidate?.tab_id || '') === preferredId
          && !fleetTabs.has(String(candidate?.tab_id || ''))
          && CHAT_ROOT_RE.test(String(candidate?.url || ''))
        ));
        if (scopedRoots.length !== 1) {
          this.#lastError = 'supervisor_bootstrap_pre_effect:BOOTSTRAP_ROOT_AMBIGUOUS';
          return false;
        }
        tab = scopedRoots[0];
      } else {
        // Normal first bootstrap retains the dedicated-root invariant. Existing roots
        // are reusable only for the explicit process-boundary recovery path above.
        tab = await this.#execute({ action: 'NEW_TAB', payload: { url: AGENT_PLATFORM_HOME_URL, select: false }, platform: null });
        createdHere = true;
      }
      if (!tab?.tab_id) throw new Error('supervisor_bootstrap_tab_creation_no_readback');
      const ready = await this.#waitForBootstrapRoot(tab.tab_id);
      if (!ready.ok) {
        // Pre-effect failure (typ. auth redirect while logged out): the tab this
        // attempt created never became a usable root and was never bound, typed
        // into, or handed to the user. Close it by proof so retrying bootstrap
        // cannot amplify tab cardinality (7 -> 32 incident vector, intra-process leg).
        if (createdHere) await this.#closeFailedBootstrapTab(tab.tab_id);
        this.#lastError = `supervisor_bootstrap_pre_effect:${ready.reason}`;
        return false;
      }

      prepared = await this.#keepalive.prepareBootstrapWake();
      if (!prepared?.ok) return false;
      const sent = await this.#typeAndSend(tab.tab_id, prepared.message, prepared.pending.wake_id);
      if (!sent.ok) {
        if (sent.clicked === true) {
          await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, sent.reason || 'BOOTSTRAP_SEND_EFFECT_UNKNOWN', { continuation_tab_id: tab.tab_id });
          this.#lastRecovery = {
            action: 'SUPERVISOR_BOOTSTRAP_AMBIGUOUS', wake_id: prepared.pending.wake_id, tab_id: String(tab.tab_id),
            reason: sent.reason || 'BOOTSTRAP_SEND_EFFECT_UNKNOWN', confirmed: false, ambiguous: true,
            automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
          };
        } else {
          await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, sent.reason || 'BOOTSTRAP_PRE_EFFECT_ABORT', { continuation_tab_id: tab.tab_id });
          await this.#keepalive.resolveAmbiguous({ observed_sent: false });
          await this.#keepalive.resume();
        }
        return false;
      }

      let observed = sent.observed;
      if (!CHAT_RE.test(String(observed?.url || ''))) observed = await this.#capture(tab.tab_id);
      const url = String(observed?.url || '');
      const markerObserved = String(observed?.text_excerpt || '').includes(String(prepared.pending.wake_id));
      if (!CHAT_RE.test(url) || !(generating(observed) || markerObserved || sent.event_driven_readback === true)) {
        await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, 'BOOTSTRAP_WITHOUT_CONVERSATION_BINDING', { continuation_tab_id: tab.tab_id });
        this.#lastRecovery = {
          action: 'SUPERVISOR_BOOTSTRAP_AMBIGUOUS', wake_id: prepared.pending.wake_id, tab_id: String(tab.tab_id),
          reason: 'BOOTSTRAP_WITHOUT_CONVERSATION_BINDING', confirmed: false, ambiguous: true,
          automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
        return false;
      }

      await this.#keepalive.confirmWakeSent(prepared.pending.wake_id);
      await this.#keepalive.bindConversation({ url, tab_id: tab.tab_id });
      this.#activateRequest(prepared.pending, tab.tab_id, false);
      // A successful bind is the recovery boundary for every prior failed
      // attempt: stale supervisor_bootstrap* errors must not survive it, or the
      // state projection keeps reporting an incident that is already over.
      if (this.#lastError?.startsWith?.('supervisor_bootstrap')) this.#lastError = null;
      this.#lastRecovery = {
        action: 'SUPERVISOR_BOOTSTRAP_BOUND', wake_id: prepared.pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'DEDICATED_ROOT_TO_EXACT_CONVERSATION_POSITIVE_READBACK', confirmed: true, ambiguous: false,
        automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    } catch (e) {
      if (prepared?.pending?.wake_id) {
        await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, 'BOOTSTRAP_SEND_PATH_AMBIGUOUS', { continuation_tab_id: tab?.tab_id || null }).catch(() => {});
        this.#lastRecovery = {
          action: 'SUPERVISOR_BOOTSTRAP_AMBIGUOUS', wake_id: prepared.pending.wake_id, tab_id: null,
          reason: 'BOOTSTRAP_SEND_PATH_AMBIGUOUS', confirmed: false, ambiguous: true,
          automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
      }
      this.#lastError = `supervisor_bootstrap:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  // Close-by-proof for a tab created by a failed bootstrap pre-effect. The proof
  // obligations: (1) the tab_id was created by THIS runtime's NEW_TAB in the
  // failed attempt (caller passes it only for createdHere tabs); (2) the tab
  // still exists in the registry; (3) it is not currently selected and not
  // claimed by a fleet agent — a tab the user has taken over is never ours to
  // close, it simply leaves the leaked set as a bounded, user-owned exception.
  // CLOSE_TAB is best-effort: on failure the id stays in the in-memory ledger
  // and is retried before the next bootstrap attempt, so a transiently wedged
  // command plane cannot turn one leak into unbounded growth.
  async #closeFailedBootstrapTab(tabId) {
    const id = String(tabId || '');
    if (!id) return;
    try {
      const state = await this.#getState();
      const fleetTabs = new Set((state?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
      const row = (state?.tabs || []).find((t) => String(t?.tab_id || '') === id);
      if (!row) {
        this.#bootstrapLeakedTabIds.delete(id);
        return;
      }
      if (row.selected === true || fleetTabs.has(id)) {
        this.#bootstrapLeakedTabIds.delete(id);
        return;
      }
      await this.#execute({ action: 'CLOSE_TAB', payload: { tab_id: id }, platform: null });
      this.#bootstrapLeakedTabIds.delete(id);
    } catch {
      this.#bootstrapLeakedTabIds.add(id);
    }
  }

  // D-S1 bounded retirement for a bootstrap-ambiguous wake whose surface is
  // observed terminal at the preconversation root with no wake marker in the
  // transcript and a composer that is either empty or still holding the exact
  // wake draft. A submitted first message always navigates the root to the
  // conversation URL, so under those observations the send provably never
  // landed on this tab: the unresolved wake is retired with zero effect
  // authority, the runtime resumes RECOVERING with a fresh continuous wake
  // queued, and a tab still holding the exact dead draft is closed by proof so
  // the next bootstrap cannot amplify tab cardinality (the historical 7 -> 32
  // incident vector). Retirement is refused for ambiguity reasons that may
  // indicate a latch-proven send; those keep the conservative deadlock posture.
  async #retireAmbiguousBootstrapWakeWithoutEffect(bootstrapTab, frame, row, keepalive) {
    const pending = keepalive?.pending_wake;
    if (!pending?.ambiguous_at || this.#canActuate() !== true) return false;
    const DRAFT_HELD_REASONS = new Set([
      'BOOTSTRAP_WITHOUT_CONVERSATION_BINDING',
      'BOOTSTRAP_SEND_EFFECT_UNKNOWN',
      'BOOTSTRAP_SEND_PATH_AMBIGUOUS',
      'SEND_WITHOUT_POSITIVE_READBACK',
      'TYPE_EFFECT_AMBIGUOUS',
    ]);
    if (!DRAFT_HELD_REASONS.has(String(pending.ambiguous_reason || ''))) return false;
    if (String(frame?.text_excerpt || '').includes(String(pending.wake_id || ''))) return false;
    const composer = composerTarget(frame);
    if (!composer) return false;
    const draftSha = sha256(buildSupervisorWakeMessage({
      supervisorEpoch: pending.supervisor_epoch,
      cycleSeq: pending.cycle_seq,
      wakeId: pending.wake_id,
      reason: pending.reason,
    }));
    const composerEmpty = composer.value_length === 0;
    const composerHoldsDraft = Boolean(composer.value_sha256) && composer.value_sha256 === draftSha;
    if (!composerEmpty && !composerHoldsDraft) return false;
    // A missing value_length is an unproven composer, not an empty one: only a
    // captured zero (or the exact draft hash) proves the send never landed.
    const recordedContinuationTab = String(pending.ambiguity_continuation_tab_id || '');
    const retiredTabId = String(bootstrapTab.tab_id || '');
    const tabOwnedByThisWake = composerHoldsDraft
      || (recordedContinuationTab === retiredTabId && composerEmpty);
    await this.#keepalive.retireAmbiguousAfterTerminal({
      tab_id: null,
      generation_epoch: row.generation_epoch,
      reason: 'AMBIGUOUS_BOOTSTRAP_EFFECT_PROVABLY_ABSENT',
    });
    await this.#keepalive.resume();
    const resumed = this.#keepalive.snapshot();
    if (!resumed.paused && !resumed.pending_wake && !resumed.active_wake) {
      await this.#keepalive.enqueueWake(CONTINUOUS_WAKE_REASON, {
        key: `epoch-${resumed.supervisor_epoch}-cycle-${resumed.cycle_seq}`,
      });
    }
    this.#lastRecovery = {
      action: 'AMBIGUOUS_BOOTSTRAP_WAKE_RETIRED', wake_id: String(pending.wake_id || ''),
      tab_id: retiredTabId,
      proof: 'TERMINAL_ROOT_NO_MARKER_COMPOSER_EMPTY_OR_EXACT_DRAFT',
      confirmed: true, ambiguous: false, automatic_retry_allowed: false,
      at: new Date().toISOString(), authority_effect: false,
    };
    if (tabOwnedByThisWake) await this.#closeFailedBootstrapTab(retiredTabId);
    return true;
  }

  async #sweepLeakedBootstrapTabs() {
    for (const tabId of Array.from(this.#bootstrapLeakedTabIds)) {
      await this.#closeFailedBootstrapTab(tabId);
    }
  }

  // D-C7: record a failed rollover attempt's tab for close-by-proof reclaim.
  // The extra proof vs the bootstrap ledger: the tab must still be at the
  // preconversation ROOT. A rollover tab that drifted to a conversation URL
  // may hold a landed send — reconciliation owns it and it is never closed.
  async #markRolloverTabLeaked(tabId) {
    const id = String(tabId || '');
    if (!id) return;
    try {
      const frame = await this.#capture(id);
      const url = String(frame?.url || '');
      // R82-BLANK-TAB: a provably blank tab has no URL to match the root
      // pattern, but it can never hold a landed send either — it qualifies
      // for the leak ledger (and the close-by-proof below) on blankness
      // alone. Before this, blank rollover tabs accumulated forever
      // (live: webcontents id climbed to 68+ over a 57h stall).
      if (provablyBlankFrame(frame) || (CHAT_ROOT_RE.test(url) && !CHAT_RE.test(url))) this.#rolloverLeakedTabIds.add(id);
    } catch {
      // Unobservable tab: record optimistically; #closeFailedRolloverTab
      // re-proves against the live registry before any CLOSE_TAB.
      this.#rolloverLeakedTabIds.add(id);
    }
  }

  // D-C7 close-by-proof for a leaked rollover tab. Obligations: (1) still in
  // the registry; (2) not selected, not fleet-bound, not the keepalive's
  // current tab — a tab the user took over is never ours to close; (3) still
  // at the preconversation root (a drifted conversation tab is skipped, not
  // closed). CLOSE_TAB is best-effort: failures keep the id in the ledger for
  // the next drain.
  async #closeFailedRolloverTab(tabId) {
    const id = String(tabId || '');
    if (!id) return;
    try {
      const state = await this.#getState();
      const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => String(a?.tab_id || '')).filter(Boolean));
      const keepaliveTab = String(this.#keepalive?.snapshot()?.tab_id || '');
      const row = (state?.tabs || []).find((t) => String(t?.tab_id || '') === id);
      if (!row) {
        this.#rolloverLeakedTabIds.delete(id);
        return;
      }
      if (row.selected === true || fleetTabs.has(id) || id === keepaliveTab) {
        this.#rolloverLeakedTabIds.delete(id);
        return;
      }
      const frame = await this.#capture(id);
      const url = String(frame?.url || '');
      // R82-BLANK-TAB: blank tabs close on blankness proof (never held a
      // send); every other surface keeps the historical root-only proof.
      if (!(provablyBlankFrame(frame) || (CHAT_ROOT_RE.test(url) && !CHAT_RE.test(url)))) {
        // Conversation or foreign surface: not ours to close.
        this.#rolloverLeakedTabIds.delete(id);
        return;
      }
      await this.#execute({ action: 'CLOSE_TAB', payload: { tab_id: id }, platform: null });
      this.#rolloverLeakedTabIds.delete(id);
    } catch {
      this.#rolloverLeakedTabIds.add(id);
    }
  }

  // D-C7: bounded drain so a long-lived leak ledger cannot burst CLOSE_TAB
  // storms into the command plane; the remainder is retried on later cycles.
  async #drainRolloverLeaks() {
    for (const tabId of Array.from(this.#rolloverLeakedTabIds).slice(0, 3)) {
      await this.#closeFailedRolloverTab(tabId);
    }
  }

  async #recoverProcessBoundaryBootstrapAmbiguity(state, keepalive) {
    const pending = keepalive?.pending_wake;
    if (keepalive?.state !== 'WAKE_AMBIGUOUS' || !pending?.ambiguous_at || keepalive?.conversation_url) return false;
    const pendingProcess = String(pending.process_incarnation_id || '');
    const currentProcess = String(keepalive.process_incarnation_id || '');
    const predecessorProcess = String(keepalive.predecessor_process_incarnation_id || '');
    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) return false;
    const immediatePredecessorFence = predecessorProcess === pendingProcess
      && Boolean(keepalive.predecessor_fenced_at);
    const durableWakeBoundaryFence = Boolean(pending.process_boundary_fenced_at)
      && pending.automatic_retry_allowed === false;
    if (!keepalive.predecessor_fenced_at || (!immediatePredecessorFence && !durableWakeBoundaryFence)) return false;

    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    const durableTabId = String(
      pending.ambiguity_continuation_tab_id
      || keepalive.tab_id
      || '',
    );
    if (durableTabId && tabs.some((tab) => String(tab?.tab_id || '') === durableTabId)) return false;

    const fleetTabs = new Set((state?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
    const roots = tabs.filter((tab) => (
      !fleetTabs.has(String(tab?.tab_id || ''))
      && CHAT_ROOT_RE.test(String(tab?.url || ''))
    ));
    if (roots.length !== 1 || this.#canActuate() !== true) return false;

    const root = roots[0];
    let frame;
    try { frame = await this.#capture(root.tab_id); } catch { return false; }
    if (!CHAT_ROOT_RE.test(String(frame?.url || root?.url || '')) || generating(frame)) return false;
    if (String(frame?.text_excerpt || '').includes(String(pending.wake_id || ''))) return false;
    const composer = composerTarget(frame);
    if (!composer || Number(composer.value_length) !== 0) return false;
    const live = tabLiveness(state, root.tab_id);
    const row = this.#sessionMonitor.observe({ tab_id: root.tab_id, frame, ...live });
    if (row.terminal_ready !== true) return false;

    const retiredWakeId = String(pending.wake_id || '');
    await this.#keepalive.retireAmbiguousAfterProcessBoundary({
      reason: 'PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST',
      replacement_tab_id: root.tab_id,
    });
    this.#lastRecovery = {
      action: 'PROCESS_BOUNDARY_AMBIGUOUS_WAKE_RETIRED',
      wake_id: retiredWakeId,
      tab_id: String(root.tab_id),
      proof: 'DURABLE_PROCESS_BOUNDARY_FENCE_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT',
      confirmed: true,
      ambiguous: false,
      automatic_retry_allowed: false,
      at: new Date().toISOString(),
      authority_effect: false,
    };

    const bootstrapped = await this.#bootstrapSupervisorConversation({ preferredExistingRootTabId: root.tab_id });
    if (bootstrapped) {
      this.#lastRecovery = {
        action: 'PROCESS_BOUNDARY_BOOTSTRAP_RECOVERED',
        wake_id: this.#keepalive.activeWake()?.wake_id || null,
        retired_wake_id: retiredWakeId,
        tab_id: String(root.tab_id),
        proof: 'RETIRED_PREDECESSOR_THEN_REUSED_UNIQUE_EMPTY_ROOT',
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
    }
    return true;
  }

  async #continueExisting(tabId, frame) {
    const button = uniqueChatGptControl(frame, 'CONTINUE');
    if (!button) return false;
    await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: tabId, role: 'button', accessible_name: button.name, semantic_ref: button.semantic_ref }, platform: null });
    this.#sessionMonitor.markRecovery(tabId, 'CONTINUE_GENERATION');
    this.#lastRecovery = { action: 'CONTINUE_EXISTING', tab_id: String(tabId), at: new Date().toISOString(), authority_effect: false };
    return true;
  }

  async #stopAndRetrySameConversation(tabId, frame) {
    const req = this.#activeRequest;
    if (!req || req.blocked_ambiguous || String(req.tab_id) !== String(tabId)) return false;
    try {
      if (generating(frame)) {
        this.#sessionMonitor.markRecovery(tabId, 'STOP_GENERATION');
        await this.#execute({ action: 'STOP_GENERATION', payload: { tab_id: String(tabId) }, platform: null });
        for (let i = 0; i < 8; i += 1) {
          await sleep(500);
          if (!generating(await this.#capture(tabId))) break;
          if (i === 7) throw new Error('same_chat_stop_not_observed');
        }
      }
      const nextAttempt = req.retry_attempt + 1;
      const sent = await this.#typeAndSend(tabId, retryEnvelope(req.message, req.wake_id, nextAttempt), req.wake_id);
      req.retry_attempt = nextAttempt;
      req.same_chat_retry_attempt += 1;
      if (!sent.ok && sent.clicked) req.blocked_ambiguous = true;
      this.#lastRecovery = {
        action: 'STOP_AND_RETRY_SAME_CONVERSATION', tab_id: String(tabId), wake_id: req.wake_id, retry_attempt: req.retry_attempt,
        confirmed: sent.ok === true, ambiguous: sent.ok !== true && sent.clicked === true,
        at: new Date().toISOString(), authority_effect: false,
      };
      return sent.ok === true;
    } catch (e) {
      this.#lastError = `same_chat_retry:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  async #retryInNewConversation() {
    const req = this.#activeRequest;
    if (!req || req.blocked_ambiguous || this.#canActuate() !== true) return false;
    let tab = null;
    try {
      tab = await this.#execute({ action: 'NEW_TAB', payload: { url: AGENT_PLATFORM_HOME_URL, select: false }, platform: null });
      const nextAttempt = req.retry_attempt + 1;
      const sent = await this.#typeAndSend(tab.tab_id, retryEnvelope(req.message, req.wake_id, nextAttempt), req.wake_id);
      req.retry_attempt = nextAttempt;
      if (!sent.ok && sent.clicked) req.blocked_ambiguous = true;
      if (!sent.ok) return false;
      const observed = sent.observed || await this.#capture(tab.tab_id);
      const url = String(observed?.url || tab?.url || '');
      if (!CHAT_RE.test(url)) throw new Error('new_conversation_retry_binding_missing');
      await this.#keepalive.bindConversation({ url, tab_id: tab.tab_id });
      req.tab_id = String(tab.tab_id);
      this.#lastRecovery = {
        action: 'NEW_CONVERSATION_RETRY', tab_id: String(tab.tab_id), wake_id: req.wake_id, retry_attempt: req.retry_attempt,
        confirmed: true, ambiguous: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    } catch (e) {
      this.#lastError = `new_conversation_retry:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  async #recoverSupervisor(tab, frame, row) {
    if (this.#canActuate() !== true || !this.#activeRequest || this.#activeRequest.blocked_ambiguous) return false;
    if (row.state === 'INTERRUPTED' && row.controls?.continue === 1) return this.#continueExisting(tab.tab_id, frame);
    if (row.state !== 'STALLED') return false;
    const decision = classifyRetryDecision({
      effect_class: this.#activeRequest.effect_class,
      silence_age_ms: row.progress_age_ms,
      adaptive_timeout_ms: row.adaptive_hard_ms,
      retry_attempt: this.#activeRequest.retry_attempt,
      max_retry_attempts: 2,
      same_chat_retry_attempt: this.#activeRequest.same_chat_retry_attempt,
      max_same_chat_retry_attempts: 1,
      same_conversation_usable: true,
      network_active: row.network_active === true,
      external_progress: row.external_progress === true,
      request_accepted: true,
    });
    if (decision.action === 'STOP_AND_RETRY_SAME_CONVERSATION') return this.#stopAndRetrySameConversation(tab.tab_id, frame);
    if (decision.action === 'NEW_CONVERSATION_RETRY') return this.#retryInNewConversation();
    if (decision.action === 'ESCALATE') this.#lastRecovery = { action: 'ESCALATE', reason: decision.reason, wake_id: this.#activeRequest.wake_id, at: new Date().toISOString(), authority_effect: false };
    return false;
  }

  async #recoverOrphanedSupervisor(tab, frame, row) {
    if (this.#canActuate() !== true || row.state !== 'STALLED' || !generating(frame)) return false;
    const recovery = this.#sessionMonitor.nextRecovery(tab.tab_id);
    if (recovery.action !== 'STOP_GENERATION') return false;
    this.#sessionMonitor.markRecovery(tab.tab_id, 'STOP_GENERATION');
    const record = {
      action: 'STOP_ORPHANED_GENERATION', tab_id: String(tab.tab_id), generation_epoch: row.generation_epoch,
      confirmed: false, ambiguous: false, automatic_retry_allowed: false,
      at: new Date().toISOString(), authority_effect: false,
    };
    this.#lastRecovery = record;
    try {
      await this.#execute({ action: 'STOP_GENERATION', payload: { tab_id: String(tab.tab_id) }, platform: null });
      for (let i = 0; i < 8; i += 1) {
        await sleep(500);
        if (!generating(await this.#capture(tab.tab_id))) {
          this.#lastRecovery = { ...record, confirmed: true, observed_stopped_at: new Date().toISOString() };
          return true;
        }
      }
      this.#lastRecovery = { ...record, ambiguous: true, reason: 'STOP_WITHOUT_TERMINAL_READBACK' };
      return false;
    } catch (e) {
      this.#lastRecovery = { ...record, ambiguous: true, reason: 'STOP_TRANSPORT_AMBIGUOUS' };
      this.#lastError = `orphaned_stall_stop:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  #rolloverMessage(snapshot) {
    const attempt = snapshot?.rollover_attempt || null;
    return buildSupervisorRolloverMessage({
      previousUrl: attempt?.previous_conversation || snapshot?.conversation_url,
      supervisorEpoch: attempt?.supervisor_epoch ?? snapshot?.supervisor_epoch,
      rolloverAttemptId: attempt?.attempt_id || null,
    });
  }

  async #bindRecoveredRollover(tabId, frame) {
    const url = String(frame?.url || '');
    if (!CHAT_RE.test(url)) return false;
    await this.#keepalive.bindRollover({ url, tab_id: String(tabId) });
    this.#activeRequest = null;
    this.#lastRecovery = {
      action: 'AMBIGUOUS_ROLLOVER_POSITIVELY_REBOUND', tab_id: String(tabId),
      supervisor_epoch: this.#keepalive.snapshot().supervisor_epoch,
      confirmed: true, ambiguous: false, automatic_retry_allowed: false,
      at: new Date().toISOString(), authority_effect: false,
    };
    return true;
  }

  async #reconcileAmbiguousRollover(state) {
    const s = this.#keepalive.snapshot();
    const attempt = s.rollover_attempt;
    if (s.state !== 'ROLLOVER_AMBIGUOUS' || !attempt?.attempt_id) return false;
    const message = this.#rolloverMessage(s);
    const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => String(a?.tab_id || '')).filter(Boolean));
    const candidates = (state?.tabs || []).filter((tab) => !fleetTabs.has(String(tab?.tab_id || '')) && String(tab?.tab_id || '') !== String(s.tab_id || ''));
    const ordered = [...candidates].sort((a, b) => Number(String(b?.tab_id || '') === String(attempt.tab_id || '')) - Number(String(a?.tab_id || '') === String(attempt.tab_id || '')));
    const composerMatchesRows = [];
    for (const tab of ordered) {
      let frame;
      try { frame = await this.#capture(tab.tab_id); } catch { continue; }
      const marker = String(frame?.text_excerpt || '').includes(String(attempt.attempt_id));
      if (CHAT_RE.test(String(frame?.url || '')) && marker) return this.#bindRecoveredRollover(tab.tab_id, frame);
      if ((CHAT_ROOT_RE.test(String(frame?.url || '')) || CHAT_RE.test(String(frame?.url || ''))) && composerMatches(frame, message)) composerMatchesRows.push({ tab, frame });
    }
    if (composerMatchesRows.length !== 1 || this.#canActuate() !== true) return false;
    const { tab, frame } = composerMatchesRows[0];
    if (!attempt.tab_id) await this.#keepalive.bindRolloverAttemptTab(tab.tab_id).catch(() => {});
    // GLM platform: composer sha256 match proves the typed rollover message
    // never submitted; re-submit through the Enter lane (no named SEND).
    const rolloverComposer = composerTarget(frame);
    if (!rolloverComposer?.semantic_ref) return false;
    await this.#execute({
      action: 'SEMANTIC_TYPE',
      payload: { tab_id: String(tab.tab_id), role: 'textbox', accessible_name: rolloverComposer.name, semantic_ref: rolloverComposer.semantic_ref, text: message, replace_existing: true, submit_after_type: true },
      platform: AGENT_PLATFORM_ID,
    });
    const readback = await this.#observeSendReadback(tab.tab_id, attempt.attempt_id);
    if (readback.ok) return this.#bindRecoveredRollover(tab.tab_id, readback.observed);
    this.#lastRecovery = {
      action: 'RESTART_TYPED_ROLLOVER_SEND_AMBIGUOUS', tab_id: String(tab.tab_id), rollover_attempt_id: attempt.attempt_id,
      proof: 'EXACT_COMPOSER_SHA256_BEFORE_SINGLE_CLICK', prompt_retyped: false,
      confirmed: false, ambiguous: true, automatic_retry_allowed: false,
      at: new Date().toISOString(), authority_effect: false,
    };
    return true;
  }

  // Proof-based settlement of a pending ambiguous wake that blocks the
  // rollover (see settleRolloverBlockedAmbiguousWake in supervisor-keepalive).
  // No action without positive evidence: still-generating or unobservable
  // surfaces are left untouched for the next tick.
  async #settleRolloverBlockedAmbiguousWake(supervisor, observed) {
    const ks = this.#keepalive.snapshot();
    const pending = ks.pending_wake;
    if (!pending?.ambiguous_at) return false;
    let frame = observed?.frame || null;
    if (!frame) {
      try { frame = await this.#capture(supervisor.tab_id); } catch { return false; }
    }
    const markerObserved = String(frame?.text_excerpt || '').includes(String(pending.wake_id || ''));
    if (markerObserved) {
      await this.#keepalive.settleRolloverBlockedAmbiguousWake({ observed_sent: true });
      this.#lastRecovery = {
        action: 'ROLLOVER_BLOCKED_AMBIGUOUS_WAKE_CONFIRMED', wake_id: pending.wake_id,
        tab_id: String(supervisor.tab_id || ''), proof: 'WAKE_MARKER_IN_TRANSCRIPT',
        confirmed: true, ambiguous: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    }
    const row = observed?.row || null;
    if (row?.terminal_ready !== true) return false;
    const composer = composerTarget(frame);
    const message = buildSupervisorWakeMessage({
      supervisorEpoch: pending.supervisor_epoch,
      cycleSeq: pending.cycle_seq,
      wakeId: pending.wake_id,
      reason: pending.reason,
    });
    const unsentProven = Boolean(composer) && composer.value_sha256 === sha256(message);
    await this.#keepalive.settleRolloverBlockedAmbiguousWake({ observed_sent: false });
    this.#lastRecovery = {
      action: 'ROLLOVER_BLOCKED_AMBIGUOUS_WAKE_DROPPED', wake_id: pending.wake_id,
      tab_id: String(supervisor.tab_id || ''),
      proof: unsentProven ? 'COMPOSER_STILL_HOLDS_EXACT_MESSAGE' : 'TERMINAL_READY_WITHOUT_WAKE_MARKER',
      confirmed: false, ambiguous: false, at: new Date().toISOString(), authority_effect: false,
    };
    return true;
  }

  async #rollover() {
    if (this.#canActuate() !== true) return false;
    const before = this.#keepalive.snapshot();
    let tab = null;
    let attempt = null;
    try {
      // D-C7: reclaim tabs leaked by earlier failed attempts BEFORE creating
      // anything new — the retry loop is tab-neutral even when the site keeps
      // refusing the rollover send.
      if (this.#rolloverLeakedTabIds.size > 0) await this.#drainRolloverLeaks();
      attempt = await this.#keepalive.beginRolloverAttempt();
      const message = buildSupervisorRolloverMessage({
        previousUrl: before.conversation_url,
        supervisorEpoch: before.supervisor_epoch,
        rolloverAttemptId: attempt.attempt_id,
      });
      // R82-BLANK-TAB: the tab is proven to have committed its navigation
      // before the rollover message is typed into it.
      tab = await this.#openCommittedRolloverTab();
      const sent = await this.#typeAndSend(tab.tab_id, message, attempt.attempt_id);
      if (!sent.ok) {
        await this.#keepalive.markRolloverAmbiguous(sent.reason || 'ROLLOVER_WITHOUT_POSITIVE_READBACK');
        await this.#markRolloverTabLeaked(tab.tab_id);
        return false;
      }
      const observed = sent.observed || await this.#capture(tab.tab_id);
      const markerObserved = String(observed?.text_excerpt || '').includes(String(attempt.attempt_id));
      if (CHAT_RE.test(String(observed?.url || '')) && (generating(observed) || markerObserved)) {
        await this.#keepalive.bindRollover({ url: observed.url, tab_id: tab.tab_id });
        this.#activeRequest = null;
        this.#lastRecovery = {
          action: 'SUPERVISOR_ROLLOVER_BOUND', tab_id: String(tab.tab_id),
          supervisor_epoch: this.#keepalive.snapshot().supervisor_epoch,
          rollover_attempt_id: attempt.attempt_id, confirmed: true, ambiguous: false,
          at: new Date().toISOString(), authority_effect: false,
        };
        return true;
      }
      await this.#keepalive.markRolloverAmbiguous('ROLLOVER_WITHOUT_POSITIVE_READBACK');
      await this.#markRolloverTabLeaked(tab.tab_id);
    } catch (e) {
      if (attempt) await this.#keepalive.markRolloverAmbiguous(`ROLLOVER_ERROR:${String(e?.message || e)}`).catch(() => {});
      if (tab?.tab_id) await this.#markRolloverTabLeaked(tab.tab_id);
      this.#lastError = String(e?.message || e).slice(0, 240);
    }
    return false;
  }

  // R82-BLANK-TAB: open a rollover tab and demand a navigation-commit
  // readback before any typing. A blank WebContents (url:'', zero DOM nodes)
  // can never grow a composer and can never hold a landed send, so it is
  // closed immediately and a fresh tab is opened, bounded by
  // ROLLOVER_NEW_TAB_RETRIES. The historical path bound the attempt tab and
  // typed straight into a possibly-blank surface — 8x1.8s of recaptures that
  // always ended in supervisor_composer_not_unique plus a leaked tab the
  // D-C7 root-proof could never retire (live 2026-09-24..26: cycle_seq stuck
  // at 2109 for >57h with every attempt leaking a zombie WebContents —
  // webcontents:68 was still url:'' five minutes after creation).
  async #openCommittedRolloverTab() {
    for (let round = 0; round <= ROLLOVER_NEW_TAB_RETRIES; round += 1) {
      const tab = await this.#execute({ action: 'NEW_TAB', payload: { url: AGENT_PLATFORM_HOME_URL, select: false }, platform: null });
      if (!tab?.tab_id) throw new Error('rollover_tab_creation_no_readback');
      await this.#keepalive.bindRolloverAttemptTab(tab.tab_id).catch(() => {});
      for (let i = 0; i < ROLLOVER_TAB_COMMIT_ATTEMPTS; i += 1) {
        if (i > 0) await sleep(ROLLOVER_TAB_COMMIT_WAIT_MS);
        const frame = await this.#capture(tab.tab_id).catch(() => null);
        if (frame && String(frame?.url || '') !== '') return tab;
      }
      // Provably blank (or unobservable) tab: never held a conversation,
      // never held a send — close it and try a fresh one.
      await this.#execute({ action: 'CLOSE_TAB', payload: { tab_id: tab.tab_id }, platform: null }).catch(() => {});
    }
    throw new Error('rollover_tab_never_committed');
  }

  // D-C5 (live 2026-09-19): ROLLOVER_AMBIGUOUS with no reconciliation
  // progress is a terminal dead state — wakes do not run in rollover states,
  // admission close PRESERVES the ambiguity, and restart reconciliation only
  // works with a positive readback. Live evidence: the rollover sat ambiguous
  // for 14+ hours while its every-2s candidate scan ALSO starved the idle
  // maintenance window (D-C6) so the devos task cycle never ran. After this
  // many consecutive no-progress cycles, the lifecycle re-requests the
  // rollover: requestRollover(autoRelease) clears the attempt and returns to
  // ROLLOVER_REQUIRED, so #rollover() opens a FRESH tab (the account-level
  // root draft was flushed by then) instead of eternally re-scanning the
  // poisoned attempt tab.
  #rolloverNoProgressCycles = 0;
  #lastAmbiguousRolloverScanAt = 0;
  // ROLLOVER_DEFERRED bounded auto-release (closed-loop audit fix): operator-
  // class rollovers (CHATGPT_CONVERSATION_LIMIT_HINT) park the primary in
  // DEFERRED because approveRollover has NO caller anywhere (D-K8) — wakes
  // are blocked in every rollover state, so a deferred primary is a dead
  // supervisor on a single-conversation install. The escape mirrors D-C5:
  // after DEFERRED_ROLLOVER_AUTO_RELEASE_MS with no operator release, the
  // lifecycle re-requests the rollover with autoRelease on a FRESH tab. The
  // operator window stays generous (15 minutes) — far longer than any human
  // reaction chain — and the superseded conversation is only replaced, never
  // destroyed (close-by-proof discipline unchanged).
  #deferredRolloverSince = null;

  async cycle({ force = false } = {}) {
    if (!this.#keepalive) return this.snapshot();
    const now = Date.now();
    if (!force && now - this.#lastRun < this.#monitorMs) return this.snapshot();
    this.#lastRun = now;
    try {
      if (this.#requireAuthoritativeAdmission && this.#runtimeControl.authoritative !== true) return this.snapshot();
      const admissionOpen = !this.#requireAuthoritativeAdmission
        || devosRuntimeControlAllowsContinuousService(this.#runtimeControl);
      if (!admissionOpen) {
        const keepalive = this.#keepalive.snapshot();
        const unresolved = keepalive.pending_wake
          || keepalive.active_wake
          || ['ROLLOVER_PENDING','ROLLOVER_AMBIGUOUS'].includes(keepalive.state);
        if (!unresolved || !keepalive.conversation_url) return this.snapshot();
      }
      let state = await this.#getState();
      await this.#observeWorkers(state);
      if (admissionOpen) await this.#queueResearch();
      if (this.#keepalive.snapshot().state === 'ROLLOVER_AMBIGUOUS') {
        // D-C6: throttle the candidate scan — it captures every non-fleet tab
        // and held maintenance_in_flight busy on every cycle, starving the
        // idle-window task cycle (live: idle last_error
        // native_supervisor_idle_maintenance_wait_timeout with zero leases for
        // hours while 4 tasks sat READY).
        const scanBudgetElapsed = now - this.#lastAmbiguousRolloverScanAt >= 30000;
        let reconciled = false;
        if (scanBudgetElapsed) {
          this.#lastAmbiguousRolloverScanAt = now;
          reconciled = await this.#reconcileAmbiguousRollover(state);
        }
        if (reconciled && this.#keepalive.snapshot().state !== 'ROLLOVER_AMBIGUOUS') {
          this.#rolloverNoProgressCycles = 0;
          state = await this.#getState();
        } else {
          this.#rolloverNoProgressCycles += 1;
          // D-C7: opportunistic reclaim — the throttled scan already observed
          // these surfaces; drain any leaked rollover tabs so capacity returns
          // even while the ambiguity persists.
          if (this.#rolloverLeakedTabIds.size > 0) await this.#drainRolloverLeaks();
          // D-C5: after bounded no-progress cycles, restart the rollover on a
          // fresh tab instead of scanning the same poisoned tab forever. The
          // superseded attempt tab is reclaimed by proof (root-only) so the
          // re-request cannot pile fresh leaks on old ones.
          if (this.#rolloverNoProgressCycles >= 8 && this.#canActuate() === true) {
            const supersededAttemptTabId = String(this.#keepalive.snapshot()?.rollover_attempt?.tab_id || '');
            await this.#keepalive.requestRollover('ROLLOVER_AMBIGUOUS_NO_PROGRESS_FRESH_TAB', { autoRelease: true }).catch(() => {});
            this.#rolloverNoProgressCycles = 0;
            if (supersededAttemptTabId) await this.#markRolloverTabLeaked(supersededAttemptTabId);
            this.#lastRecovery = {
              action: 'ROLLOVER_AMBIGUOUS_NO_PROGRESS_REREQUEST',
              rollover_attempt_id: null,
              fresh_tab_rollover: true,
              reclaimed_tab_id: supersededAttemptTabId || null,
              confirmed: false, ambiguous: false, automatic_retry_allowed: false,
              at: new Date().toISOString(), authority_effect: false,
            };
          }
        }
      } else {
        this.#rolloverNoProgressCycles = 0;
      }
      // ROLLOVER_DEFERRED bounded auto-release (closed-loop audit fix).
      let keepalivePre = this.#keepalive.snapshot();
      if (keepalivePre.state === 'ROLLOVER_DEFERRED') {
        if (this.#deferredRolloverSince == null) this.#deferredRolloverSince = now;
        const deferredMs = now - this.#deferredRolloverSince;
        if (deferredMs >= DEFERRED_ROLLOVER_AUTO_RELEASE_MS && this.#canActuate() === true) {
          const deferredReason = String(keepalivePre.rollover_reason || 'ROLLOVER_DEFERRED').slice(0, 120);
          await this.#keepalive.requestRollover(`${deferredReason}:DEFERRED_AUTO_RELEASE_TIMEOUT`, { autoRelease: true }).catch(() => {});
          this.#deferredRolloverSince = null;
          this.#lastRecovery = {
            action: 'ROLLOVER_DEFERRED_AUTO_RELEASE',
            rollover_reason: deferredReason,
            deferred_ms: deferredMs,
            fresh_tab_rollover: true,
            confirmed: false, ambiguous: false, automatic_retry_allowed: false,
            at: new Date().toISOString(), authority_effect: false,
          };
        }
      } else {
        this.#deferredRolloverSince = null;
      }
      let keepalive = this.#keepalive.snapshot();
      if (keepalive.state === 'WAKE_AMBIGUOUS'
        && keepalive.pending_wake?.ambiguous_at
        && !keepalive.conversation_url) {
        const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => a?.tab_id).filter(Boolean).map(String));
        const bootstrapCandidates = (state?.tabs || []).filter((tab) => {
          if (fleetTabs.has(String(tab?.tab_id || ''))) return false;
          const url = String(tab?.url || '');
          return CHAT_ROOT_RE.test(url) || CHAT_RE.test(url);
        });
        const durableTabId = String(
          keepalive.pending_wake?.ambiguity_continuation_tab_id
          || keepalive.tab_id
          || '',
        );
        const scopedCandidates = durableTabId
          ? bootstrapCandidates.filter((tab) => String(tab?.tab_id || '') === durableTabId)
          : bootstrapCandidates;
        // D-S1 (live deadlock 2026-09-19): the durable tab id can point at a tab
        // from a previous process incarnation (bindConversation never ran, so
        // keepalive.tab_id was never refreshed). Scoping to that dead id observes
        // nothing and the wake deadlocks forever. A unique non-fleet chat candidate
        // is still unambiguous surface evidence: the continuation path requires the
        // exact composer draft and the retirement path below requires the
        // provably-absent-effect proof, so the fallback can never turn an
        // unrelated user tab into send authority. The fallback and the proof-based
        // retirement are SAME-PROCESS repairs only: a cross-process ambiguous wake
        // keeps the strictly stronger process-boundary contract (predecessor
        // fences, unique-root reuse) further below.
        const sameProcessAmbiguity = String(keepalive.pending_wake?.process_incarnation_id || '')
          === String(keepalive.process_incarnation_id || '');
        const observedCandidates = scopedCandidates.length === 1
          ? scopedCandidates
          : (durableTabId && sameProcessAmbiguity && bootstrapCandidates.length === 1 ? bootstrapCandidates : []);

        if (observedCandidates.length === 1) {
          const bootstrapTab = observedCandidates[0];
          try {
            const frame = await this.#capture(bootstrapTab.tab_id);
            const frameUrl = String(frame?.url || bootstrapTab?.url || '');
            if (CHAT_ROOT_RE.test(frameUrl) || CHAT_RE.test(frameUrl)) {
              const live = tabLiveness(state, bootstrapTab.tab_id);
              const row = this.#sessionMonitor.observe({ tab_id: bootstrapTab.tab_id, frame, ...live });
              this.#lastSupervisorGeneration = row.state;
              const recovered = await this.#recoverAmbiguousWakeFromFrame(bootstrapTab, frame, row, keepalive);
              keepalive = this.#keepalive.snapshot();
              if (!recovered
                && sameProcessAmbiguity
                && keepalive.state === 'WAKE_AMBIGUOUS'
                && row.terminal_ready === true
                && CHAT_ROOT_RE.test(frameUrl)) {
                const retiredNow = await this.#retireAmbiguousBootstrapWakeWithoutEffect(bootstrapTab, frame, row, keepalive);
                keepalive = this.#keepalive.snapshot();
                // Bounded superstep: the retirement (with its fresh continuous
                // wake already queued) ends this tick; the next monitor tick
                // performs the fresh bootstrap from a clean RECOVERING state.
                if (retiredNow) return this.snapshot();
              }
              if (keepalive.state !== 'WAKE_AMBIGUOUS' && keepalive.active_wake) {
                let reboundFrame = frame;
                if (!CHAT_RE.test(String(reboundFrame?.url || ''))) {
                  try { reboundFrame = await this.#capture(bootstrapTab.tab_id); } catch {}
                }
                const reboundUrl = String(reboundFrame?.url || '');
                if (CHAT_RE.test(reboundUrl)) {
                  await this.#keepalive.bindConversation({ url: reboundUrl, tab_id: bootstrapTab.tab_id });
                  keepalive = this.#keepalive.snapshot();
                }
              }
            }
          } catch (e) {
            this.#lastError = `bootstrap_ambiguous_reconcile:${String(e?.message || e).slice(0, 200)}`;
          }
        }

        keepalive = this.#keepalive.snapshot();
        if (keepalive.state === 'WAKE_AMBIGUOUS') {
          const processBoundaryHandled = await this.#recoverProcessBoundaryBootstrapAmbiguity(state, keepalive);
          keepalive = this.#keepalive.snapshot();
          if (keepalive.state === 'WAKE_AMBIGUOUS') return this.snapshot();
          if (processBoundaryHandled && !keepalive.conversation_url) return this.snapshot();
        }
        if (keepalive.active_wake && !keepalive.conversation_url) return this.snapshot();
        state = await this.#getState();
      }
      let supervisor = await this.#supervisorTab(state);
      if (!supervisor && admissionOpen && this.#canActuate() === true) {
        const bootstrapped = await this.#bootstrapSupervisorConversation();
        if (bootstrapped) {
          state = await this.#getState();
          supervisor = await this.#supervisorTab(state);
        }
      }
      if (supervisor) {
        const observed = await this.#observeSupervisor(supervisor, state);
        if (this.#canActuate() === true) {
          const ks = this.#keepalive.snapshot();
          if (ks.state === 'ROLLOVER_REQUIRED') {
            // LIVE 2026-09-21: settle a pending ambiguous wake (e.g. cut by the
            // self-update restart window) BEFORE the rollover — otherwise the
            // rollover retire paths (WAKE_AMBIGUOUS-only) deadlock against it
            // and the devos task cycle is starved indefinitely.
            if (ks.pending_wake?.ambiguous_at) {
              await this.#settleRolloverBlockedAmbiguousWake(supervisor, observed);
            }
            keepalive = this.#keepalive.snapshot();
            if (keepalive.state === 'ROLLOVER_REQUIRED') await this.#rollover();
          }
          else if (['STALLED','INTERRUPTED'].includes(observed.row.state)) {
            if (this.#activeRequest && this.#activeRequest.blocked_ambiguous !== true) await this.#recoverSupervisor(supervisor, observed.frame, observed.row);
            else if (observed.row.state === 'STALLED') await this.#recoverOrphanedSupervisor(supervisor, observed.frame, observed.row);
          } else if (observed.row.terminal_ready === true) {
            await this.#ensureContinuousWake();
            const prepared = await this.#keepalive.prepareNextWake();
            if (prepared?.ok) await this.#sendWake(prepared);
          }
        }
      }
      if (!this.#lastError?.startsWith('same_chat_retry:') && !this.#lastError?.startsWith('new_conversation_retry:') && !this.#lastError?.startsWith('orphaned_stall_stop:') && !this.#lastError?.startsWith('supervisor_bootstrap:') && !this.#lastError?.startsWith('supervisor_bootstrap_pre_effect:')) this.#lastError = null;
    } catch (e) { this.#lastError = String(e?.message || e).slice(0, 240); }
    return this.snapshot();
  }
}
