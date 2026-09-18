-- METAENGINE Browser Cognitive Delta Ingest V1
--
-- SOURCE-ONLY / DEVELOPMENT-STAGING CONTRACT.
-- This file is intentionally rollback-only. It must not be copied into production
-- migrations until the exact-head Browser + Edge + Realtime load/replay gates pass
-- and a controlled Supabase change window is explicitly approved.
--
-- Design goal: keep the hot observation path O(1) durable state per Browser stream,
-- never persist every DOM/process event, and broadcast one already-sanitized batch.
-- DB cursor acceptance is delivery durability only; it is never command authority.
--
-- Invariants:
--   * Edge device authentication/projection happens before this RPC.
--   * stream_id + sequence is the dedupe namespace.
--   * a new batch advances only from the exact durable cursor.
--   * an exact/older duplicate is ACKed without a second broadcast.
--   * an overlap/gap is rejected and requires full-state resync.
--   * realtime.send and cursor advancement share one transaction: no committed
--     cursor can claim a batch whose private broadcast failed.
--   * no page text, input value, raw CDP payload or command capability is accepted.
--   * no automatic physical-effect retry exists anywhere in this path.

begin;

create table if not exists public.compute_fabric_a2_browser_cognitive_cursor_h205f22 (
  workspace_id uuid not null,
  client_id text not null,
  device_id text not null,
  stream_id uuid not null,
  accepted_through_sequence bigint not null default 0,
  accepted_batches bigint not null default 0,
  accepted_events bigint not null default 0,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  constraint a2_browser_cognitive_cursor_pk
    primary key (workspace_id, client_id, device_id, stream_id),
  constraint a2_browser_cognitive_cursor_client_ck
    check (length(btrim(client_id)) between 1 and 160),
  constraint a2_browser_cognitive_cursor_device_ck
    check (length(btrim(device_id)) between 1 and 200),
  constraint a2_browser_cognitive_cursor_sequence_ck
    check (accepted_through_sequence >= 0 and accepted_batches >= 0 and accepted_events >= 0)
);

create index if not exists a2_browser_cognitive_cursor_recent_v1_idx
  on public.compute_fabric_a2_browser_cognitive_cursor_h205f22(workspace_id, client_id, last_seen_at desc);

revoke all on table public.compute_fabric_a2_browser_cognitive_cursor_h205f22
  from public, anon, authenticated;

create or replace function public.h205f22_a2_browser_cognitive_accept_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_device_id text,
  p_stream_id uuid,
  p_after_sequence bigint,
  p_through_sequence bigint,
  p_events jsonb,
  p_authority_effect boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client text := left(btrim(coalesce(p_client_id,'')),160);
  v_device text := left(btrim(coalesce(p_device_id,'')),200);
  v_now timestamptz := clock_timestamp();
  v_current bigint := 0;
  v_event_count integer := 0;
  v_topic text;
begin
  if p_workspace_id is null or v_client='' or v_device='' or p_stream_id is null then
    raise exception 'cognitive_accept_identity_invalid';
  end if;
  if coalesce(p_authority_effect,true) is not false then
    raise exception 'cognitive_accept_authority_forbidden';
  end if;
  if p_after_sequence is null or p_after_sequence < 0
     or p_through_sequence is null or p_through_sequence <= p_after_sequence then
    raise exception 'cognitive_accept_range_invalid';
  end if;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'cognitive_accept_events_invalid';
  end if;

  v_event_count := jsonb_array_length(p_events);
  if v_event_count < 1 or v_event_count > 128
     or p_through_sequence - p_after_sequence <> v_event_count then
    raise exception 'cognitive_accept_event_count_invalid';
  end if;
  if octet_length(p_events::text) > 262144 then
    raise exception 'cognitive_accept_events_too_large';
  end if;

  -- The Edge route has already projected every event into the zero-authority schema.
  -- Keep DB validation constant-cost: prove the envelope fences and boundary events,
  -- rather than reparsing every DOM/Network event on the latency-critical path.
  if coalesce((p_events->0->>'stream_id')::uuid, p_stream_id) <> p_stream_id
     or coalesce((p_events->0->>'sequence')::bigint, -1) <> p_after_sequence + 1
     or coalesce((p_events->(v_event_count-1)->>'stream_id')::uuid, p_stream_id) <> p_stream_id
     or coalesce((p_events->(v_event_count-1)->>'sequence')::bigint, -1) <> p_through_sequence
     or coalesce((p_events->0->>'authority_effect')::boolean, true) is not false
     or coalesce((p_events->(v_event_count-1)->>'authority_effect')::boolean, true) is not false
     or coalesce((p_events->0->>'control_authority')::boolean, true) is not false
     or coalesce((p_events->(v_event_count-1)->>'control_authority')::boolean, true) is not false
     or coalesce((p_events->0->>'command_leasing')::boolean, true) is not false
     or coalesce((p_events->(v_event_count-1)->>'command_leasing')::boolean, true) is not false then
    raise exception 'cognitive_accept_event_fence_invalid';
  end if;

  insert into public.compute_fabric_a2_browser_cognitive_cursor_h205f22(
    workspace_id, client_id, device_id, stream_id,
    accepted_through_sequence, accepted_batches, accepted_events,
    first_seen_at, last_seen_at
  ) values (
    p_workspace_id, v_client, v_device, p_stream_id,
    0, 0, 0, v_now, v_now
  )
  on conflict (workspace_id, client_id, device_id, stream_id) do nothing;

  select accepted_through_sequence
    into v_current
    from public.compute_fabric_a2_browser_cognitive_cursor_h205f22
   where workspace_id=p_workspace_id
     and client_id=v_client
     and device_id=v_device
     and stream_id=p_stream_id
   for update;

  -- ACK replay after an ambiguous HTTP outcome. The original transaction already
  -- committed its private broadcast, so never emit the same batch twice here.
  if p_through_sequence <= v_current then
    update public.compute_fabric_a2_browser_cognitive_cursor_h205f22
       set last_seen_at=v_now
     where workspace_id=p_workspace_id
       and client_id=v_client
       and device_id=v_device
       and stream_id=p_stream_id;
    return jsonb_build_object(
      'accepted', true,
      'reason', 'DUPLICATE_ALREADY_ACCEPTED',
      'stream_id', p_stream_id,
      'accepted_through_sequence', p_through_sequence,
      'durable_cursor_through_sequence', v_current,
      'event_count', v_event_count,
      'broadcasted', false,
      'duplicate', true,
      'full_state_resync_required', false,
      'delivery_is_authority', false,
      'control_authority', false,
      'command_leasing', false,
      'authority_effect', false
    );
  end if;

  if p_after_sequence <> v_current then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'CURSOR_GAP_OR_OVERLAP',
      'stream_id', p_stream_id,
      'expected_after_sequence', v_current,
      'received_after_sequence', p_after_sequence,
      'received_through_sequence', p_through_sequence,
      'full_state_resync_required', true,
      'delivery_is_authority', false,
      'control_authority', false,
      'command_leasing', false,
      'authority_effect', false
    );
  end if;

  v_topic := 'metaengine-cognitive:' || p_workspace_id::text || ':' || v_client;

  -- Private Broadcast is the low-latency perception transport. It is deliberately
  -- inside the same transaction as the cursor advance: a failed broadcast cannot
  -- leave a durable ACK that would make the Browser skip that observation batch.
  perform realtime.send(
    jsonb_build_object(
      'schema', 'metaengine.browser.cognitive-delta-broadcast.v1',
      'workspace_id', p_workspace_id,
      'client_id', v_client,
      'stream_id', p_stream_id,
      'after_sequence', p_after_sequence,
      'through_sequence', p_through_sequence,
      'event_count', v_event_count,
      'events', p_events,
      'delivery_is_authority', false,
      'control_authority', false,
      'command_leasing', false,
      'authority_effect', false
    ),
    'COGNITIVE_DELTA',
    v_topic,
    true
  );

  update public.compute_fabric_a2_browser_cognitive_cursor_h205f22
     set accepted_through_sequence=p_through_sequence,
         accepted_batches=accepted_batches+1,
         accepted_events=accepted_events+v_event_count,
         last_seen_at=v_now
   where workspace_id=p_workspace_id
     and client_id=v_client
     and device_id=v_device
     and stream_id=p_stream_id;

  return jsonb_build_object(
    'accepted', true,
    'reason', 'ACCEPTED',
    'stream_id', p_stream_id,
    'accepted_through_sequence', p_through_sequence,
    'durable_cursor_through_sequence', p_through_sequence,
    'event_count', v_event_count,
    'broadcasted', true,
    'duplicate', false,
    'full_state_resync_required', false,
    'delivery_is_authority', false,
    'control_authority', false,
    'command_leasing', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_cognitive_accept_v1(
  uuid,text,text,uuid,bigint,bigint,jsonb,boolean
) from public, anon, authenticated;

-- Graduation proofs before any live apply:
-- 1. exact contiguous batches advance one cursor row and broadcast once per batch.
-- 2. ACK-loss replay returns success without a duplicate private broadcast.
-- 3. gap/overlap returns full_state_resync_required and never advances cursor.
-- 4. concurrent same-stream batches serialize through SELECT ... FOR UPDATE.
-- 5. one Browser stream stores O(1) durable cursor state, never an event ledger.
-- 6. private Realtime topic authorization prevents cross-workspace/client reads.
-- 7. realtime.send failure rolls back cursor advancement and Browser retains cursor.
-- 8. 128-event / 256 KiB batches stay inside measured p50/p95/p99 ingest SLO.
-- 9. no public/anon/authenticated EXECUTE or table access is granted.
-- 10. source SQL stays rollback-only until an explicit production change window.

rollback;
