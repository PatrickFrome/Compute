create or replace function public.h205f22_verify_browser_transport_promotion_lease_v1(
  p_lease_id uuid,
  p_agent_id text,
  p_holder_supervisor_instance_id text,
  p_target_client_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
  expected_key text := 'fleet.transport-promotion:' || btrim(coalesce(p_agent_id, ''));
  now_db timestamptz := clock_timestamp();
  reason text := null;
begin
  if p_lease_id is null or btrim(coalesce(p_agent_id, '')) = '' then
    return jsonb_build_object('valid', false, 'reason', 'IDENTITY_REQUIRED', 'authority_effect', false);
  end if;

  select * into v
  from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
  where lease_id = p_lease_id;

  if not found then reason := 'LEASE_NOT_FOUND';
  elsif v.status <> 'ACTIVE' then reason := 'LEASE_NOT_ACTIVE';
  elsif v.released_at is not null then reason := 'LEASE_RELEASED';
  elsif v.expires_at is null or v.expires_at <= now_db then reason := 'LEASE_EXPIRED';
  elsif v.effect_scope <> 'BROWSER_CLIENT_ACTUATION' then reason := 'SCOPE_MISMATCH';
  elsif v.effect_key <> expected_key then reason := 'EFFECT_KEY_MISMATCH';
  elsif v.holder_supervisor_instance_id <> btrim(coalesce(p_holder_supervisor_instance_id, '')) then reason := 'HOLDER_MISMATCH';
  elsif v.target_client_id <> btrim(coalesce(p_target_client_id, '')) then reason := 'TARGET_MISMATCH';
  end if;

  return jsonb_build_object(
    'valid', reason is null,
    'reason', reason,
    'lease_id', v.lease_id,
    'agent_id', btrim(coalesce(p_agent_id, '')),
    'status', v.status,
    'released_at', v.released_at,
    'not_expired', reason is null and v.expires_at > now_db,
    'effect_scope', v.effect_scope,
    'effect_key', v.effect_key,
    'holder_verified', reason is null and v.holder_supervisor_instance_id = btrim(coalesce(p_holder_supervisor_instance_id, '')),
    'target_verified', reason is null and v.target_client_id = btrim(coalesce(p_target_client_id, '')),
    'verified_at', now_db,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_verify_browser_transport_promotion_lease_v1(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_verify_browser_transport_promotion_lease_v1(uuid,text,text,text) to service_role;
