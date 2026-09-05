import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../../sql/browser_cognitive_delta_ingest_v1.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function must(pattern, message) {
  assert.match(sql, pattern, message);
}

function mustNot(pattern, message) {
  assert.doesNotMatch(sql, pattern, message);
}

test('cognitive ingest SQL is rollback-only and cannot silently become live authority', () => {
  must(/^begin;$/mi, 'source contract must open an explicit transaction');
  must(/^rollback;$/mi, 'source contract must terminate with rollback');
  mustNot(/^\s*commit;\s*$/mi, 'source contract must never commit');
  mustNot(/grant\s+execute[^;]+\s+to\s+(public|anon|authenticated)\s*;/i, 'public execution must remain revoked');
  must(/revoke all on function public\.h205f22_a2_browser_cognitive_accept_v1[\s\S]+from public, anon, authenticated;/i);
  must(/revoke all on table public\.compute_fabric_a2_browser_cognitive_cursor_h205f22[\s\S]+from public, anon, authenticated;/i);
});

test('ingest persists O(1) cursor state per exact Browser stream instead of an event ledger', () => {
  must(/create table if not exists public\.compute_fabric_a2_browser_cognitive_cursor_h205f22/i);
  must(/primary key \(workspace_id, client_id, device_id, stream_id\)/i);
  must(/accepted_through_sequence bigint not null default 0/i);
  must(/accepted_batches bigint not null default 0/i);
  must(/accepted_events bigint not null default 0/i);
  mustNot(/\bevent_payload\b/i, 'raw event payload must not become durable row state');
  mustNot(/\bpage_text\b/i, 'page text must never be persisted by the cursor contract');
  mustNot(/\binput_value\b/i, 'input values must never be persisted by the cursor contract');
});

test('acceptor is exact-contiguous, duplicate-safe and same-stream concurrent-safe', () => {
  must(/on conflict \(workspace_id, client_id, device_id, stream_id\) do nothing;/i);
  must(/select accepted_through_sequence[\s\S]+for update;/i, 'same-stream writers must serialize on the cursor row');
  must(/if p_through_sequence <= v_current then/i, 'ACK-loss replay must be idempotently accepted');
  must(/'reason', 'DUPLICATE_ALREADY_ACCEPTED'/i);
  must(/if p_after_sequence <> v_current then/i, 'new batches must start at the exact durable cursor');
  must(/'reason', 'CURSOR_GAP_OR_OVERLAP'/i);
  must(/'full_state_resync_required', true/i);
  must(/accepted_through_sequence=p_through_sequence/i);
});

test('one sanitized batch becomes one private realtime cognitive broadcast in the cursor transaction', () => {
  must(/perform realtime\.send\(/i);
  must(/'schema', 'metaengine\.browser\.cognitive-delta-broadcast\.v1'/i);
  must(/'events', p_events/i);
  must(/'COGNITIVE_DELTA'/i);
  must(/'metaengine-cognitive:' \|\| p_workspace_id::text \|\| ':' \|\| v_client/i);
  must(/\n\s*true\n\s*\);/i, 'Realtime broadcast must use a private channel');
  mustNot(/exception\s+when\s+others[\s\S]+realtime/i, 'Realtime failure must not be swallowed after durable acceptance');
});

test('acceptor keeps the hot DB path bounded and zero-authority', () => {
  must(/v_event_count > 128/i);
  must(/octet_length\(p_events::text\) > 262144/i);
  must(/coalesce\(p_authority_effect,true\) is not false/i);
  must(/'delivery_is_authority', false/i);
  must(/'control_authority', false/i);
  must(/'command_leasing', false/i);
  must(/'authority_effect', false/i);
  mustNot(/jsonb_array_elements/i, 'DB must not reparse every already-projected event on the latency-critical path');
});
