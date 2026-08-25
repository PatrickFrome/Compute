-- A2_CHAT_BRIDGE v1: non-authority transport receipts only.
-- Raw chat text, prompts, cookies, credentials and browser tokens are deliberately absent.

create table if not exists destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 (
  receipt_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  bridge_instance_id text not null check (length(bridge_instance_id) between 1 and 128),
  event_kind text not null check (event_kind in ('SNAPSHOT_META','COMMAND_QUEUED','COMMAND_LEASED','SEND_RESULT')),
  target_agent text not null check (target_agent in ('GPT','GLM')),
  target_platform text not null check (target_platform in ('CHATGPT','GLM_ZAI')),
  target_url_sha256 text not null check (target_url_sha256 ~ '^[0-9a-f]{64}$'),
  a2_head_message_seq bigint not null check (a2_head_message_seq >= 0),
  duel_id uuid,
  pending_payloads_exposed boolean not null,
  message_count integer check (message_count is null or message_count >= 0),
  generating boolean,
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  command_id uuid,
  idempotency_key_sha256 text check (idempotency_key_sha256 is null or idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  prompt_sha256 text check (prompt_sha256 is null or prompt_sha256 ~ '^[0-9a-f]{64}$'),
  result_status text check (result_status is null or length(result_status) between 1 and 96),
  clicked_send_button boolean,
  dom_send_verified boolean,
  receipt_sha256 text not null unique check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  canonical boolean not null default false check (canonical = false),
  authority_effect boolean not null default false check (authority_effect = false),
  created_at timestamptz not null default now(),
  check ((target_agent = 'GPT' and target_platform = 'CHATGPT') or (target_agent = 'GLM' and target_platform = 'GLM_ZAI')),
  check (
    (event_kind = 'SNAPSHOT_META' and snapshot_sha256 is not null and message_count is not null and generating is not null)
    or
    (event_kind in ('COMMAND_QUEUED','COMMAND_LEASED') and command_id is not null and idempotency_key_sha256 is not null and prompt_sha256 is not null)
    or
    (event_kind = 'SEND_RESULT' and command_id is not null and idempotency_key_sha256 is not null and prompt_sha256 is not null and result_status is not null and clicked_send_button is not null and dom_send_verified is not null)
  ),
  check (
    event_kind <> 'SEND_RESULT'
    or result_status <> 'SENT_AND_DOM_VERIFIED'
    or (clicked_send_button = true and dom_send_verified = true)
  ),
  check (
    event_kind <> 'SEND_RESULT'
    or result_status <> 'SENT_WEAK_DOM_VERIFIED'
    or (clicked_send_button = true and dom_send_verified = false)
  ),
  check (
    event_kind <> 'SEND_RESULT'
    or dom_send_verified = false
    or (clicked_send_button = true and result_status in ('SENT_AND_DOM_VERIFIED','SENT_ALREADY_DURABLE'))
  )
);

alter table destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 enable row level security;

revoke all on table destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 from public, anon, authenticated, service_role;

create index if not exists compute_fabric_a2_chat_bridge_receipt_workspace_created_idx
  on destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 (workspace_id, created_at desc);

create index if not exists compute_fabric_a2_chat_bridge_receipt_command_idx
  on destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 (command_id)
  where command_id is not null;

create unique index if not exists compute_fabric_a2_chat_bridge_receipt_event_command_uq
  on destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 (workspace_id, bridge_instance_id, event_kind, command_id)
  where command_id is not null;

create or replace function public.h205f22_a2_chat_bridge_receipt_ingest_v1(
  p_workspace_id uuid,
  p_bridge_instance_id text,
  p_event_kind text,
  p_target_agent text,
  p_target_platform text,
  p_target_url_sha256 text,
  p_a2_head_message_seq bigint,
  p_duel_id uuid default null,
  p_pending_payloads_exposed boolean default false,
  p_message_count integer default null,
  p_generating boolean default null,
  p_snapshot_sha256 text default null,
  p_command_id uuid default null,
  p_idempotency_key_sha256 text default null,
  p_prompt_sha256 text default null,
  p_result_status text default null,
  p_clicked_send_button boolean default null,
  p_dom_send_verified boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, extensions
as $$
declare
  v_receipt_id uuid := gen_random_uuid();
  v_hash text;
  v_created_at timestamptz := clock_timestamp();
  v_payload jsonb;
  v_inserted integer := 0;
  v_existing destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22%rowtype;
begin
  if p_workspace_id is null then raise exception 'bridge_workspace_required'; end if;
  if p_bridge_instance_id is null or length(p_bridge_instance_id) not between 1 and 128 then raise exception 'bridge_instance_invalid'; end if;
  if p_event_kind not in ('SNAPSHOT_META','COMMAND_QUEUED','COMMAND_LEASED','SEND_RESULT') then raise exception 'bridge_event_kind_invalid'; end if;
  if not ((p_target_agent = 'GPT' and p_target_platform = 'CHATGPT') or (p_target_agent = 'GLM' and p_target_platform = 'GLM_ZAI')) then raise exception 'bridge_target_pair_invalid'; end if;
  if p_target_url_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_target_url_hash_invalid'; end if;
  if coalesce(p_a2_head_message_seq, -1) < 0 then raise exception 'bridge_a2_frontier_invalid'; end if;
  if p_snapshot_sha256 is not null and p_snapshot_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_snapshot_hash_invalid'; end if;
  if p_idempotency_key_sha256 is not null and p_idempotency_key_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_idempotency_hash_invalid'; end if;
  if p_prompt_sha256 is not null and p_prompt_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_prompt_hash_invalid'; end if;

  if p_event_kind = 'SNAPSHOT_META' then
    if p_snapshot_sha256 is null or p_message_count is null or p_generating is null then raise exception 'bridge_snapshot_fields_required'; end if;
  elsif p_event_kind in ('COMMAND_QUEUED','COMMAND_LEASED') then
    if p_command_id is null or p_idempotency_key_sha256 is null or p_prompt_sha256 is null then raise exception 'bridge_command_fields_required'; end if;
  elsif p_event_kind = 'SEND_RESULT' then
    if p_command_id is null or p_idempotency_key_sha256 is null or p_prompt_sha256 is null or p_result_status is null or p_clicked_send_button is null or p_dom_send_verified is null then raise exception 'bridge_send_result_fields_required'; end if;
    if p_result_status = 'SENT_AND_DOM_VERIFIED' and not (p_clicked_send_button and p_dom_send_verified) then raise exception 'bridge_strong_send_verification_invalid'; end if;
    if p_result_status = 'SENT_WEAK_DOM_VERIFIED' and not (p_clicked_send_button and not p_dom_send_verified) then raise exception 'bridge_weak_send_verification_invalid'; end if;
    if p_dom_send_verified and (not p_clicked_send_button or p_result_status not in ('SENT_AND_DOM_VERIFIED','SENT_ALREADY_DURABLE')) then raise exception 'bridge_dom_verification_status_invalid'; end if;
  end if;

  v_payload := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'workspace_id', p_workspace_id,
    'bridge_instance_id', p_bridge_instance_id,
    'event_kind', p_event_kind,
    'target_agent', p_target_agent,
    'target_platform', p_target_platform,
    'target_url_sha256', p_target_url_sha256,
    'a2_head_message_seq', p_a2_head_message_seq,
    'duel_id', p_duel_id,
    'pending_payloads_exposed', p_pending_payloads_exposed,
    'message_count', p_message_count,
    'generating', p_generating,
    'snapshot_sha256', p_snapshot_sha256,
    'command_id', p_command_id,
    'idempotency_key_sha256', p_idempotency_key_sha256,
    'prompt_sha256', p_prompt_sha256,
    'result_status', p_result_status,
    'clicked_send_button', p_clicked_send_button,
    'dom_send_verified', p_dom_send_verified,
    'canonical', false,
    'authority_effect', false,
    'created_at', v_created_at
  );
  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 (
    receipt_id, workspace_id, bridge_instance_id, event_kind, target_agent, target_platform,
    target_url_sha256, a2_head_message_seq, duel_id, pending_payloads_exposed,
    message_count, generating, snapshot_sha256, command_id, idempotency_key_sha256,
    prompt_sha256, result_status, clicked_send_button, dom_send_verified,
    receipt_sha256, canonical, authority_effect, created_at
  ) values (
    v_receipt_id, p_workspace_id, p_bridge_instance_id, p_event_kind, p_target_agent, p_target_platform,
    p_target_url_sha256, p_a2_head_message_seq, p_duel_id, p_pending_payloads_exposed,
    p_message_count, p_generating, p_snapshot_sha256, p_command_id, p_idempotency_key_sha256,
    p_prompt_sha256, p_result_status, p_clicked_send_button, p_dom_send_verified,
    v_hash, false, false, v_created_at
  ) on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    if p_command_id is null then
      raise exception 'bridge_receipt_insert_conflict';
    end if;

    select * into v_existing
    from destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22
    where workspace_id = p_workspace_id
      and bridge_instance_id = p_bridge_instance_id
      and event_kind = p_event_kind
      and command_id = p_command_id;

    if not found then
      raise exception 'bridge_receipt_insert_conflict';
    end if;

    if v_existing.target_agent is distinct from p_target_agent
       or v_existing.target_platform is distinct from p_target_platform
       or v_existing.target_url_sha256 is distinct from p_target_url_sha256
       or v_existing.a2_head_message_seq is distinct from p_a2_head_message_seq
       or v_existing.duel_id is distinct from p_duel_id
       or v_existing.pending_payloads_exposed is distinct from p_pending_payloads_exposed
       or v_existing.message_count is distinct from p_message_count
       or v_existing.generating is distinct from p_generating
       or v_existing.snapshot_sha256 is distinct from p_snapshot_sha256
       or v_existing.idempotency_key_sha256 is distinct from p_idempotency_key_sha256
       or v_existing.prompt_sha256 is distinct from p_prompt_sha256
       or v_existing.result_status is distinct from p_result_status
       or v_existing.clicked_send_button is distinct from p_clicked_send_button
       or v_existing.dom_send_verified is distinct from p_dom_send_verified then
      raise exception 'bridge_receipt_conflict';
    end if;

    return jsonb_build_object(
      'schema','metaengine.compute.a2-chat-bridge-receipt.h205f22.v1',
      'receipt_id',v_existing.receipt_id,
      'receipt_sha256',v_existing.receipt_sha256,
      'replayed',true,
      'canonical',false,
      'authority_effect',false
    );
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.a2-chat-bridge-receipt.h205f22.v1',
    'receipt_id',v_receipt_id,
    'receipt_sha256',v_hash,
    'replayed',false,
    'canonical',false,
    'authority_effect',false
  );
end;
$$;

revoke execute on function public.h205f22_a2_chat_bridge_receipt_ingest_v1(uuid,text,text,text,text,text,bigint,uuid,boolean,integer,boolean,text,uuid,text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.h205f22_a2_chat_bridge_receipt_ingest_v1(uuid,text,text,text,text,text,bigint,uuid,boolean,integer,boolean,text,uuid,text,text,text,boolean,boolean) to service_role;

create or replace function public.h205f22_a2_chat_bridge_receipt_read_v1(
  p_workspace_id uuid,
  p_limit integer default 100
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public, destruktion_meta
as $$
  select jsonb_build_object(
    'schema','metaengine.compute.a2-chat-bridge-receipt-read.h205f22.v1',
    'workspace_id',p_workspace_id,
    'canonical',false,
    'authority_effect',false,
    'receipts',coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  )
  from (
    select receipt_id, bridge_instance_id, event_kind, target_agent, target_platform,
           target_url_sha256, a2_head_message_seq, duel_id, pending_payloads_exposed,
           message_count, generating, snapshot_sha256, command_id, idempotency_key_sha256,
           prompt_sha256, result_status, clicked_send_button, dom_send_verified,
           receipt_sha256, created_at
    from destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22
    where workspace_id = p_workspace_id
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit,100),500))
  ) x;
$$;

revoke execute on function public.h205f22_a2_chat_bridge_receipt_read_v1(uuid,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_chat_bridge_receipt_read_v1(uuid,integer) to service_role;

comment on table destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 is
  'A2_CHAT_BRIDGE non-authority transport receipts. Stores hashes/metadata only; never raw chat text, prompts, cookies, credentials or browser tokens.';
