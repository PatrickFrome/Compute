-- METAENGINE A2 Chat Bridge — execution-class no-blind-retry fence.
--
-- A remote chat send is an external effect. A timeout/failure after possible
-- actuation must never become retryable merely because a cooldown elapsed.
-- Persist the extension's bounded execution class and make the DB issuance RPC
-- return the original command forever for ambiguous/actuated/verified outcomes.

alter table public.compute_fabric_a2_chat_bridge_remote_command_h205f22
  add column if not exists execution_class text null;

alter table public.compute_fabric_a2_chat_bridge_remote_command_h205f22
  drop constraint if exists compute_fabric_a2_chat_bridge_remote_command_execution_class_ck;

alter table public.compute_fabric_a2_chat_bridge_remote_command_h205f22
  add constraint compute_fabric_a2_chat_bridge_remote_command_execution_class_ck
  check (
    execution_class is null
    or execution_class in (
      'SAFE_RETRY_PRE_ACTUATION',
      'AMBIGUOUS_NO_RETRY',
      'ACTUATED',
      'VERIFIED',
      'BLOCKED'
    )
  );

create or replace function public.h205f22_a2_chat_bridge_issue_command_v2(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_target_platform text,
  p_target_agent text,
  p_client_id text,
  p_prompt_sha256 text,
  p_a2_head_message_seq bigint default 0,
  p_a2_peer_payloads_exposed boolean default false,
  p_duel_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.compute_fabric_a2_chat_bridge_remote_command_h205f22%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_key text := pg_catalog.btrim(coalesce(p_idempotency_key, ''));
  v_platform text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_target_platform, '')));
  v_agent text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_target_agent, '')));
  v_client text := pg_catalog.left(pg_catalog.btrim(coalesce(p_client_id, '')), 160);
  v_hash text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_prompt_sha256, '')));
  v_terminal_no_retry boolean := false;
begin
  if p_workspace_id is null or v_key !~ '^[0-9a-f]{64}$' then raise exception 'remote_idempotency_key_invalid'; end if;
  if v_platform <> 'CHATGPT' or v_agent <> 'GPT' then raise exception 'remote_legacy_provider_disabled'; end if;
  if v_client = '' or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'remote_command_identity_invalid'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || v_key, 0));

  select * into v_row
    from public.compute_fabric_a2_chat_bridge_remote_command_h205f22
   where idempotency_key = v_key
   order by created_at desc
   limit 1;

  if found and (v_row.target_platform <> 'CHATGPT' or v_row.target_agent <> 'GPT') then
    raise exception 'remote_idempotency_legacy_target_conflict';
  end if;

  if found then
    v_terminal_no_retry :=
      coalesce(v_row.execution_class,'') in ('AMBIGUOUS_NO_RETRY','ACTUATED','VERIFIED')
      or coalesce(v_row.result_status,'') like '%AMBIGUOUS%'
      or coalesce(v_row.result_status,'') like '%NO_RETRY%'
      or coalesce(v_row.result_status,'') like 'SENT_%'
      or coalesce(v_row.clicked_send_button,false);
  end if;

  if found and (
      v_row.status = 'COMPLETED'
      or v_terminal_no_retry
      or (v_row.status = 'FAILED' and v_now - v_row.created_at < interval '60 seconds')
      or (v_row.status = 'LEASED' and v_now - v_row.leased_at < interval '120 seconds')
    ) then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'created', false, 'command_id', v_row.command_id,
      'idempotency_key', v_row.idempotency_key, 'status', v_row.status,
      'target_platform', v_row.target_platform, 'target_agent', v_row.target_agent,
      'leased_to', v_row.client_id,
      'execution_class', v_row.execution_class,
      'terminal_no_retry', v_terminal_no_retry,
      'launch_order', 1,
      'predecessor_command_id', null,
      'ordering_basis', 'CHATGPT_ONLY',
      'authority_effect', false
    );
  end if;

  insert into public.compute_fabric_a2_chat_bridge_remote_command_h205f22(
    command_id, idempotency_key, target_platform, target_agent, client_id,
    status, created_at, leased_at, prompt_sha256, a2_head_message_seq,
    a2_peer_payloads_exposed, duel_id, authority_effect, execution_class
  ) values (
    pg_catalog.gen_random_uuid(), v_key, 'CHATGPT', 'GPT', v_client,
    'LEASED', v_now, v_now, v_hash, greatest(0, coalesce(p_a2_head_message_seq, 0)),
    coalesce(p_a2_peer_payloads_exposed, false), p_duel_id, false, null
  ) returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'created', true, 'command_id', v_row.command_id,
    'idempotency_key', v_row.idempotency_key, 'status', v_row.status,
    'target_platform', 'CHATGPT', 'target_agent', 'GPT',
    'leased_to', v_row.client_id,
    'prompt_sha256', v_row.prompt_sha256,
    'execution_class', null,
    'terminal_no_retry', false,
    'launch_order', 1,
    'predecessor_command_id', null,
    'ordering_basis', 'CHATGPT_ONLY',
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_a2_chat_bridge_issue_command_v2(uuid,text,text,text,text,text,bigint,boolean,uuid) from public, anon, authenticated;
grant execute on function public.h205f22_a2_chat_bridge_issue_command_v2(uuid,text,text,text,text,text,bigint,boolean,uuid) to service_role;

comment on column public.compute_fabric_a2_chat_bridge_remote_command_h205f22.execution_class is
  'Bounded effect classification. AMBIGUOUS_NO_RETRY/ACTUATED/VERIFIED permanently fence blind replay for the same idempotency key.';
