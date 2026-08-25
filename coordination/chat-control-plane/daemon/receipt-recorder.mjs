import { createHash } from 'node:crypto';

const MODES = new Set(['OFF', 'BEST_EFFORT', 'REQUIRED']);
const HEX64 = /^[0-9a-f]{64}$/;
const SEND_LIKE_STATUSES = new Set(['SENT_AND_DOM_VERIFIED', 'SENT_WEAK_DOM_VERIFIED', 'SENT_ALREADY_DURABLE']);

export const sha256 = (value) => createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function normalizedUrl(value) {
  const url = new URL(String(value || ''));
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin}${url.pathname}`;
}

function targetAgent(platform) {
  if (platform === 'CHATGPT') return 'GPT';
  if (platform === 'GLM_ZAI') return 'GLM';
  throw new Error(`receipt_invalid_platform:${platform}`);
}

function assertHex64(value, field) {
  if (!HEX64.test(String(value || ''))) throw new Error(`receipt_invalid_${field}`);
  return String(value);
}

export class BridgeReceiptRecorder {
  constructor({
    mode = 'OFF',
    bridgeInstanceId = '',
    workspaceId,
    supabaseUrl,
    serviceRoleKey,
    fetchImpl = globalThis.fetch,
    logger = console,
  }) {
    this.mode = String(mode || 'OFF').toUpperCase();
    if (!MODES.has(this.mode)) throw new Error(`receipt_invalid_mode:${this.mode}`);
    this.required = this.mode === 'REQUIRED';
    this.enabled = this.mode !== 'OFF';
    this.bridgeInstanceId = String(bridgeInstanceId || '');
    this.workspaceId = String(workspaceId || '');
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
    this.serviceRoleKey = String(serviceRoleKey || '');
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.latestTarget = new Map();
    this.leases = new Map();

    if (this.enabled) {
      if (this.bridgeInstanceId.length < 1 || this.bridgeInstanceId.length > 128) {
        throw new Error('receipt_bridge_instance_required');
      }
      if (!this.workspaceId) throw new Error('receipt_workspace_required');
      if (!this.supabaseUrl || !this.serviceRoleKey) throw new Error('receipt_supabase_credentials_required');
      if (typeof this.fetchImpl !== 'function') throw new Error('receipt_fetch_required');
    }
  }

  hasLease(commandId) {
    return this.leases.has(String(commandId || ''));
  }

  noteSnapshot(platform, snapshot) {
    if (!snapshot?.url) return;
    const canonical = normalizedUrl(snapshot.url);
    this.latestTarget.set(platform, {
      target_url: canonical,
      target_url_sha256: sha256(canonical),
      message_count: Number(snapshot.message_count || 0),
      generating: snapshot.generating === true,
      observed_at: new Date().toISOString(),
    });
  }

  async ingest(args) {
    const response = await this.fetchImpl(
      `${this.supabaseUrl}/rest/v1/rpc/h205f22_a2_chat_bridge_receipt_ingest_v1`,
      {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(args),
        cache: 'no-store',
      },
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`receipt_rpc_${response.status}:${text.slice(0, 240)}`);
    return text ? JSON.parse(text) : null;
  }

  async guarded(operation) {
    if (!this.enabled) return { persisted: false, mode: 'OFF' };
    try {
      return await operation();
    } catch (error) {
      if (this.required) throw error;
      this.logger?.error?.('A2 bridge receipt persistence degraded:', error?.message || error);
      return { persisted: false, mode: this.mode, error: String(error?.message || error) };
    }
  }

  async recordLease(command) {
    return this.guarded(async () => {
      if (!command?.command_id) throw new Error('receipt_command_id_required');
      const platform = String(command.target_platform || '');
      const target = this.latestTarget.get(platform);
      if (!target) throw new Error(`receipt_target_snapshot_required:${platform}`);
      const expectedAgent = targetAgent(platform);
      const explicitAgent = String(command.target_agent || '');
      if (!explicitAgent) throw new Error('receipt_target_agent_required');
      if (explicitAgent !== expectedAgent) throw new Error('receipt_target_pair_invalid');
      const frontier = Number(command.a2_head_message_seq);
      if (!Number.isInteger(frontier) || frontier < 0) throw new Error('receipt_a2_frontier_invalid');
      if (typeof command.a2_peer_payloads_exposed !== 'boolean') throw new Error('receipt_visibility_flag_required');
      if (command.authority_effect !== false) throw new Error('receipt_command_nonauthority_required');
      if (!Object.hasOwn(command, 'duel_id')) throw new Error('receipt_duel_lineage_required');
      const idempotency = assertHex64(command.idempotency_key, 'idempotency_key');
      const promptSha = assertHex64(command.prompt_sha256, 'prompt_sha256');
      const lease = {
        command_id: String(command.command_id),
        target_agent: explicitAgent,
        target_platform: platform,
        target_url_sha256: target.target_url_sha256,
        a2_head_message_seq: frontier,
        duel_id: command.duel_id || null,
        pending_payloads_exposed: command.a2_peer_payloads_exposed,
        idempotency_key_sha256: idempotency,
        prompt_sha256: promptSha,
      };

      const receipt = await this.ingest({
        p_workspace_id: this.workspaceId,
        p_bridge_instance_id: this.bridgeInstanceId,
        p_event_kind: 'COMMAND_LEASED',
        p_target_agent: lease.target_agent,
        p_target_platform: lease.target_platform,
        p_target_url_sha256: lease.target_url_sha256,
        p_a2_head_message_seq: lease.a2_head_message_seq,
        p_duel_id: lease.duel_id,
        p_pending_payloads_exposed: lease.pending_payloads_exposed,
        p_message_count: null,
        p_generating: null,
        p_snapshot_sha256: null,
        p_command_id: lease.command_id,
        p_idempotency_key_sha256: lease.idempotency_key_sha256,
        p_prompt_sha256: lease.prompt_sha256,
        p_result_status: null,
        p_clicked_send_button: null,
        p_dom_send_verified: null,
      });
      this.leases.set(lease.command_id, lease);
      return { persisted: true, mode: this.mode, receipt };
    });
  }

  async recordResult(commandId, result) {
    return this.guarded(async () => {
      const lease = this.leases.get(String(commandId));
      if (!lease) throw new Error(`receipt_lease_binding_missing:${commandId}`);
      const status = String(result?.status || '');
      if (!status) throw new Error('receipt_result_status_required');
      if (result?.authority_effect === true) throw new Error('receipt_result_authority_forbidden');
      const clicked = result?.clicked_send_button === true;
      const strong = status === 'SENT_AND_DOM_VERIFIED'
        && result?.verification?.verified === true
        && result?.verification?.exact_user_turn_seen === true;
      const durableReplay = status === 'SENT_ALREADY_DURABLE'
        && result?.verification?.verified === true
        && result?.verification?.durable_replay === true;
      const domVerified = strong || durableReplay;

      if (SEND_LIKE_STATUSES.has(status)) {
        if (String(result?.target_platform || '') !== lease.target_platform) {
          throw new Error('receipt_result_platform_mismatch');
        }
        let resultUrlHash;
        try {
          resultUrlHash = sha256(normalizedUrl(result?.target_url));
        } catch (_) {
          throw new Error('receipt_result_target_url_invalid');
        }
        if (resultUrlHash !== lease.target_url_sha256) throw new Error('receipt_result_target_url_mismatch');
      }

      const receipt = await this.ingest({
        p_workspace_id: this.workspaceId,
        p_bridge_instance_id: this.bridgeInstanceId,
        p_event_kind: 'SEND_RESULT',
        p_target_agent: lease.target_agent,
        p_target_platform: lease.target_platform,
        p_target_url_sha256: lease.target_url_sha256,
        p_a2_head_message_seq: lease.a2_head_message_seq,
        p_duel_id: lease.duel_id,
        p_pending_payloads_exposed: lease.pending_payloads_exposed,
        p_message_count: null,
        p_generating: null,
        p_snapshot_sha256: null,
        p_command_id: lease.command_id,
        p_idempotency_key_sha256: lease.idempotency_key_sha256,
        p_prompt_sha256: lease.prompt_sha256,
        p_result_status: status,
        p_clicked_send_button: clicked,
        p_dom_send_verified: domVerified,
      });
      return { persisted: true, mode: this.mode, receipt, dom_send_verified: domVerified };
    });
  }
}

export function createReceiptRecorderFromEnv(env = process.env, options = {}) {
  return new BridgeReceiptRecorder({
    mode: env.A2_BRIDGE_RECEIPTS_MODE || 'OFF',
    bridgeInstanceId: env.A2_BRIDGE_INSTANCE_ID || '',
    workspaceId: env.A2_WORKSPACE_ID || '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    supabaseUrl: env.SUPABASE_URL || 'https://xpeibufgzjknrhbhpffp.supabase.co',
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    ...options,
  });
}
