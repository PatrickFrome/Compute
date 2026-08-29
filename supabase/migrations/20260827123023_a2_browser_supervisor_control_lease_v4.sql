create or replace function public.h205f22_a2_browser_supervisor_lease_control_v4(
  p_workspace_id uuid,
  p_client_id text,
  p_lease_timeout_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_lease_timeout integer := greatest(30, least(600, coalesce(p_lease_timeout_seconds,120)));
begin
  if v_client = '' then raise exception 'supervisor_client_id_required'; end if;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=clock_timestamp(), error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at <= clock_timestamp();
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=clock_timestamp(), error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id and status='LEASED'
     and (expires_at <= clock_timestamp() or leased_at is null or leased_at <= clock_timestamp() - make_interval(secs=>v_lease_timeout));
  select * into v_row
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id and status='PENDING' and expires_at > clock_timestamp()
    and action <> 'SET_SUPERVISOR_MODE'
    and (target_client_id is null or target_client_id=v_client)
  order by issued_at asc
  for update skip locked
  limit 1;
  if not found then return jsonb_build_object('command',null); end if;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='LEASED', leased_by=v_client, leased_at=clock_timestamp()
   where command_id=v_row.command_id;
  return jsonb_build_object('command',jsonb_build_object(
    'command_id',v_row.command_id,'idempotency_key',v_row.idempotency_key,'action',v_row.action,'platform',v_row.platform,
    'payload',v_row.payload,'issued_at',v_row.issued_at,'expires_at',v_row.expires_at,'issued_by',v_row.issued_by,'authority_effect',false));
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_lease_control_v4(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_lease_control_v4(uuid,text,integer) to service_role;
comment on function public.h205f22_a2_browser_supervisor_lease_control_v4(uuid,text,integer) is 'Normal Browser Supervisor CONTROL lease; deliberately excludes SET_SUPERVISOR_MODE, which is reserved for the bootstrap authority lane.';
