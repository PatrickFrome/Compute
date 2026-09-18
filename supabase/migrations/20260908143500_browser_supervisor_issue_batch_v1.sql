-- METAENGINE Browser native command batch issuance v1.
-- One authority path: this wrapper delegates every command to the existing typed
-- h205f22_a2_browser_supervisor_issue_native_v1 validator/issuer inside one DB transaction.
-- It does not lease, execute, retry, or create a second scheduler.

create or replace function public.h205f22_a2_browser_supervisor_issue_batch_v1(
  p_client_id text,
  p_commands jsonb,
  p_ttl_seconds integer default 120,
  p_issued_by text default 'CHATGPT_SUPERVISOR',
  p_batch_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_batch_key text := trim(coalesce(p_batch_key,''));
  v_count integer;
  v_index integer := 0;
  v_row jsonb;
  v_action text;
  v_platform text;
  v_payload jsonb;
  v_key text;
  v_existing public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_issued jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_client = '' then raise exception 'native_supervisor_batch_client_required'; end if;
  if jsonb_typeof(p_commands) <> 'array' then raise exception 'native_supervisor_batch_commands_invalid'; end if;
  v_count := jsonb_array_length(p_commands);
  if v_count < 1 or v_count > 64 then raise exception 'native_supervisor_batch_count_invalid'; end if;
  if char_length(v_batch_key) < 16 or char_length(v_batch_key) > 120 or v_batch_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'native_supervisor_batch_key_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('native-supervisor-issue-batch:' || v_client || ':' || v_batch_key, 0));

  for v_row in select value from jsonb_array_elements(p_commands)
  loop
    v_index := v_index + 1;
    if jsonb_typeof(v_row) <> 'object' then raise exception 'native_supervisor_batch_command_invalid'; end if;
    if exists (
      select 1 from jsonb_object_keys(v_row) k
       where k not in ('action','platform','payload')
    ) then raise exception 'native_supervisor_batch_command_field_invalid'; end if;

    v_action := upper(trim(coalesce(v_row->>'action','')));
    v_platform := nullif(upper(trim(coalesce(v_row->>'platform',''))),'');
    v_payload := coalesce(v_row->'payload','{}'::jsonb);
    v_key := v_batch_key || ':' || lpad(v_index::text,2,'0');

    select * into v_existing
      from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where target_client_id = v_client and idempotency_key = v_key
     order by issued_at desc
     limit 1;

    if found then
      if v_existing.action <> v_action
         or coalesce(v_existing.platform,'') <> coalesce(v_platform,'')
         or v_existing.payload <> v_payload then
        raise exception 'native_supervisor_batch_idempotency_collision';
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'accepted', true,
        'replayed', true,
        'command_id', v_existing.command_id,
        'action', v_existing.action,
        'platform', v_existing.platform,
        'status', v_existing.status,
        'idempotency_key', v_existing.idempotency_key,
        'authority_effect', false
      ));
      continue;
    end if;

    v_issued := public.h205f22_a2_browser_supervisor_issue_native_v1(
      v_client,
      v_action,
      v_platform,
      v_payload,
      p_ttl_seconds,
      p_issued_by,
      v_key
    );
    v_results := v_results || jsonb_build_array(v_issued || jsonb_build_object('replayed',false));
  end loop;

  return jsonb_build_object(
    'schema','metaengine.native-supervisor.command-issue-batch.v1',
    'accepted',true,
    'client_id',v_client,
    'batch_key',v_batch_key,
    'issued_count',v_count,
    'commands',v_results,
    'command_leasing',false,
    'execution_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_issue_batch_v1(text,jsonb,integer,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_issue_batch_v1(text,jsonb,integer,text,text) to service_role;
