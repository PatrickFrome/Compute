-- METAENGINE A2 Chat Bridge — ChatGPT-only active command issuance.
-- Historical GLM/ZAI rows remain readable; no new GLM lease may be created.
--
-- IMPORTANT: this migration is intentionally compatible with the baseline
-- remote-runtime-v1 table. The old dual-provider transport FSM added optional
-- ordering/progress columns on some historical lineages, but the fresh Client
-- project does not carry those columns. ChatGPT-only issuance must not depend
-- on that superseded schema.

update public.compute_fabric_a2_chat_bridge_remote_command_h205f22
   set status='FAILED',
       completed_at=pg_catalog.clock_timestamp(),
       result_status='BLOCKED_LEGACY_GLM_DISABLED'
 where target_platform='GLM_ZAI'
   and status='LEASED';

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
  v_key text := pg_catalog.trim(pg_catalog.coalesce(p_idempotency_key, ''));
  v_platform text := pg_catalog.upper(pg_catalog.trim(pg_catalog.coalesce(p_target_platform, '')));
  v_agent text := pg_catalog.upper(pg_catalog.trim(pg_catalog.coalesce(p_target_agent, '')));
  v_client text := pg_catalog.left(pg_catalog.trim(pg_catalog.coalesce(p_client_id, '')), 160);
  v_hash text := pg_catalog.lower(pg_catalog.trim(pg_catalog.coalesce(p_prompt_sha256, '')));
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

  if found and (v_row.status = 'COMPLETED'
      or (v_row.status = 'FAILED' and v_now - v_row.created_at < interval '60 seconds')
      or (v_row.status = 'LEASED' and v_now - v_row.leased_at < interval '120 seconds')) then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'created', false, 'command_id', v_row.command_id,
      'idempotency_key', v_row.idempotency_key, 'status', v_row.status,
      'target_platform', v_row.target_platform, 'target_agent', v_row.target_agent,
      'leased_to', v_row.client_id,
      'launch_order', 1,
      'predecessor_command_id', null,
      'ordering_basis', 'CHATGPT_ONLY',
      'authority_effect', false
    );
  end if;

  insert into public.compute_fabric_a2_chat_bridge_remote_command_h205f22(
    command_id, idempotency_key, target_platform, target_agent, client_id,
    status, created_at, leased_at, prompt_sha256, a2_head_message_seq,
    a2_peer_payloads_exposed, duel_id, authority_effect
  ) values (
    pg_catalog.gen_random_uuid(), v_key, 'CHATGPT', 'GPT', v_client,
    'LEASED', v_now, v_now, v_hash, greatest(0, coalesce(p_a2_head_message_seq, 0)),
    coalesce(p_a2_peer_payloads_exposed, false), p_duel_id, false
  ) returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'created', true, 'command_id', v_row.command_id,
    'idempotency_key', v_row.idempotency_key, 'status', v_row.status,
    'target_platform', 'CHATGPT', 'target_agent', 'GPT',
    'leased_to', v_row.client_id,
    'prompt_sha256', v_row.prompt_sha256,
    'launch_order', 1,
    'predecessor_command_id', null,
    'ordering_basis', 'CHATGPT_ONLY',
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_a2_chat_bridge_issue_command_v2(uuid,text,text,text,text,text,bigint,boolean,uuid) from public, anon, authenticated;
grant execute on function public.h205f22_a2_chat_bridge_issue_command_v2(uuid,text,text,text,text,text,bigint,boolean,uuid) to service_role;

comment on function public.h205f22_a2_chat_bridge_issue_command_v2(uuid,text,text,text,text,text,bigint,boolean,uuid) is
  'ChatGPT-only non-authority bridge issuance. GLM/ZAI rows are historical read compatibility only.';
