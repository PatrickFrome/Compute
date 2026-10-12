import { AGENT_PLATFORM_HOME_URL, isAgentPlatformUrl, isAgentPlatformAuthRedirectUrl } from './browser-agent-platform.mjs';
import { submitFencedChatGptPrompt } from './chatgpt-fenced-submit.mjs';

export const CHAT_FLEET_OPERATOR_SCHEMA = 'metaengine.chat-fleet-operator.v1';
const ID = /^[A-Za-z0-9._:-]{16,128}$/;
const TAB = /^tab_[0-9a-f-]{36}$/i;
const MAX_SESSIONS = 16;
const MAX_BATCH = 8;
const MAX_MESSAGE = 12000;
const MAX_READ = 20000;

function requestId(value) {
  const id = String(value ?? '').trim();
  if (!ID.test(id)) throw new Error('chat_fleet_request_id_invalid');
  return id;
}
function tabId(value) {
  const id = String(value ?? '').trim();
  if (!TAB.test(id)) throw new Error('chat_fleet_tab_id_invalid');
  return id;
}
function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('chat_fleet_request_invalid');
  for (const field of Object.keys(value)) if (!allowed.includes(field)) throw new Error('chat_fleet_unknown_field:' + field);
}
function rejectState() {
  return Object.freeze({ schema: CHAT_FLEET_OPERATOR_SCHEMA, state: 'AMBIGUOUS', automatic_retry_allowed: false, authority_effect: false });
}
function tabBinding(frame, tab, target) {
  if (String(frame?.tab_id || '') !== tab || String(frame?.target_id || '').toLowerCase() !== target.toLowerCase()
    || !isAgentPlatformUrl(frame?.url) || isAgentPlatformAuthRedirectUrl(frame?.url)) {
    throw new Error('chat_fleet_live_target_or_origin_mismatch');
  }
}

export class ChatFleetOperator {
  #execute;
  #authorize;
  #chats = new Map();
  #requests = new Map();
  #active = false;

  constructor({ executeCommand, authorize } = {}) {
    if (typeof executeCommand !== 'function' || typeof authorize !== 'function') throw new Error('chat_fleet_operator_dependencies_invalid');
    this.#execute = executeCommand;
    this.#authorize = authorize;
  }

  #owner() {
    const status = this.#authorize();
    if (!status || status.own_postgres_only !== true || status.trusted_local_owner !== true) {
      throw new Error('chat_fleet_own_postgres_owner_required');
    }
  }

  #dedupe(id) {
    if (!this.#requests.has(id)) return null;
    return structuredClone(this.#requests.get(id));
  }

  #record(id, status) {
    if (this.#requests.size >= 256 && !this.#requests.has(id)) throw new Error('chat_fleet_request_history_capacity');
    this.#requests.set(id, structuredClone(status));
    return status;
  }

  #reserve(id) {
    if (this.#active) throw new Error('chat_fleet_mutation_busy');
    if (this.#requests.size >= 256) throw new Error('chat_fleet_request_history_capacity');
    this.#active = true;
    this.#record(id, rejectState());
  }

  snapshot() {
    return Object.freeze({
      schema: CHAT_FLEET_OPERATOR_SCHEMA,
      state: 'LOCAL_ONLY',
      sessions: [...this.#chats.values()].map(row => ({
        tab_id: row.tab_id, target_id: row.target_id, state: row.state, last_request_id: row.last_request_id,
      })),
      session_count: this.#chats.size,
      max_sessions: MAX_SESSIONS,
      own_postgres_only: true,
      request_history_process_local: true,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      authority_effect: false,
    });
  }

  async create(input) {
    exactKeys(input, ['request_id', 'count']);
    const id = requestId(input.request_id);
    const count = Number(input.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BATCH) throw new Error('chat_fleet_create_count_invalid');
    this.#owner();
    const prior = this.#dedupe(id);
    if (prior) return prior;
    if (this.#chats.size + count > MAX_SESSIONS) throw new Error('chat_fleet_capacity_exceeded');
    this.#reserve(id);
    const result = [];
    try {
      for (let i = 0; i < count; i++) {
        // One explicit operator-issued NEW_TAB per requested slot. We never
        // substitute an existing supervisor/fleet tab and never retry an
        // unknown outcome.
        const opened = await this.#execute({ action: 'NEW_TAB', platform: 'CHATGPT',
          payload: { url: AGENT_PLATFORM_HOME_URL, select: false } });
        const tab = tabId(opened?.tab_id);
        if (opened.effect_outcome !== 'CONFIRMED') throw new Error('chat_fleet_new_tab_not_confirmed');
        const frame = await this.#execute({ action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: tab } });
        if (String(frame?.tab_id) !== tab || !isAgentPlatformUrl(frame?.url) || isAgentPlatformAuthRedirectUrl(frame?.url)
          || !/^webcontents:[1-9][0-9]*$/.test(String(frame?.target_id || ''))) {
          throw new Error('chat_fleet_tab_binding_unverified');
        }
        const row = { tab_id: tab, target_id: frame.target_id, state: 'BOUND', last_request_id: null };
        this.#chats.set(tab, row);
        result.push({ tab_id: tab, target_id: row.target_id, url: frame.url });
      }
      return this.#record(id, Object.freeze({ schema: CHAT_FLEET_OPERATOR_SCHEMA, state: 'CREATED',
        sessions: result, created_count: result.length, automatic_retry_allowed: false, authority_effect: false }));
    } catch {
      return this.#record(id, Object.freeze({ ...rejectState(), reason: 'CREATE_EFFECT_REQUIRES_READBACK',
        known_sessions: result, created_count_proven: result.length }));
    } finally { this.#active = false; }
  }

  async read(input) {
    exactKeys(input, ['tab_id', 'offset', 'max_chars']);
    this.#owner();
    const tab = tabId(input.tab_id);
    const row = this.#chats.get(tab);
    if (!row) throw new Error('chat_fleet_session_not_owned_by_operator');
    const offset = input.offset == null ? 0 : Number(input.offset);
    const maxChars = input.max_chars == null ? MAX_READ : Number(input.max_chars);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 240000
      || !Number.isSafeInteger(maxChars) || maxChars < 1000 || maxChars > MAX_READ) throw new Error('chat_fleet_read_bounds_invalid');
    const transcript = await this.#execute({ action: 'READ_TRANSCRIPT', platform: 'CHATGPT',
      payload: { tab_id: tab, offset, max_chars: maxChars } });
    tabBinding(transcript, tab, row.target_id);
    if (transcript.schema !== 'metaengine.native-browser.transcript.v1'
      || transcript.authority_effect !== false || transcript.text?.length > maxChars) throw new Error('chat_fleet_transcript_unverified');
    return Object.freeze({
      schema: CHAT_FLEET_OPERATOR_SCHEMA, state: 'READ',
      tab_id: tab, target_id: row.target_id, conversation_url: transcript.url,
      captured_at: transcript.captured_at, offset: transcript.offset,
      total_chars: transcript.total_chars, has_more: transcript.has_more, text: transcript.text,
      page_content_is_untrusted: true, automatic_retry_allowed: false, authority_effect: false,
    });
  }

  async assign(input) {
    exactKeys(input, ['request_id', 'tab_id', 'text']);
    const id = requestId(input.request_id);
    const tab = tabId(input.tab_id);
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > MAX_MESSAGE) {
      throw new Error('chat_fleet_assign_message_invalid');
    }
    this.#owner();
    const prior = this.#dedupe(id);
    if (prior) return prior;
    const row = this.#chats.get(tab);
    if (!row) throw new Error('chat_fleet_session_not_owned_by_operator');
    if (row.state === 'AMBIGUOUS') throw new Error('chat_fleet_session_requires_reconciliation');
    this.#reserve(id);
    try {
      const frame = await this.#execute({ action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: tab } });
      tabBinding(frame, tab, row.target_id);
      // Never infer dispatch from an RPC transport ack. The underlying
      // ChatGPT semantic submit verifies the typed draft and Send outcome.
      const submitted = await submitFencedChatGptPrompt({
        executeCommand: this.#execute, tab_id: tab, frame, text: input.text,
      });
      const proven = /^PROVEN_/.test(String(submitted?.effect_state || ''));
      if (!proven) throw new Error('chat_fleet_send_outcome_unverified');
      row.last_request_id = id;
      return this.#record(id, Object.freeze({
        schema: CHAT_FLEET_OPERATOR_SCHEMA, state: 'SENT',
        tab_id: tab, target_id: row.target_id, effect_state: submitted.effect_state,
        prompt_sha256: submitted.prompt_sha256 || null,
        automatic_retry_allowed: false, authority_effect: false,
      }));
    } catch {
      // A failure may occur after the click; do not issue the same prompt
      // again. Read the transcript of this exact tab to reconcile manually.
      row.state = 'AMBIGUOUS';
      return this.#record(id, Object.freeze({ ...rejectState(),
        reason: 'CHAT_SEND_OUTCOME_REQUIRES_READBACK', tab_id: tab, target_id: row.target_id }));
    } finally { this.#active = false; }
  }
}
