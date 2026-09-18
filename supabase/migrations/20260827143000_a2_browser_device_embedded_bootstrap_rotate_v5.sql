create or replace function public.h205f22_a2_browser_device_rotate_embedded_bootstrap_v1(
  p_device_id uuid,
  p_bootstrap_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_pairing public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22%rowtype;
  v_grant_hash text;
  v_now timestamptz := clock_timestamp();
begin
  if p_device_id is null
     or p_bootstrap_token_hash is null
     or p_bootstrap_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted',false,'reason','INVALID_INPUT');
  end if;

  select * into v_device
    from public.compute_fabric_a2_browser_device_h205f22
   where device_id = p_device_id
   for update;
  if not found then return jsonb_build_object('accepted',false,'reason','DEVICE_NOT_FOUND'); end if;
  if v_device.active is not true or v_device.revoked_at is not null then return jsonb_build_object('accepted',false,'reason','DEVICE_REVOKED'); end if;

  select * into v_pairing
    from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
   where token_hash = p_bootstrap_token_hash
   for update;
  if not found or v_pairing.active is not true then return jsonb_build_object('accepted',false,'reason','BOOTSTRAP_NOT_ACTIVE'); end if;
  if v_pairing.label not like 'browser-operator-v065-embedded-once:%' then return jsonb_build_object('accepted',false,'reason','BOOTSTRAP_NOT_SINGLE_USE'); end if;
  if v_device.enrollment_pairing_token_hash is distinct from p_bootstrap_token_hash then return jsonb_build_object('accepted',false,'reason','DEVICE_BOOTSTRAP_BINDING_MISMATCH'); end if;

  v_grant_hash := encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex');
  insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash,label,active,created_at,last_used_at)
  values(v_grant_hash,'device-grant:'||p_device_id::text,true,v_now,v_now);
  update public.compute_fabric_a2_browser_device_h205f22
     set enrollment_pairing_token_hash=v_grant_hash,last_used_at=v_now
   where device_id=p_device_id;
  update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
     set active=false,last_used_at=v_now
   where token_hash=p_bootstrap_token_hash;

  return jsonb_build_object('accepted',true,'reason','BOOTSTRAP_ROTATED_TO_SERVER_DEVICE_GRANT','device_id',p_device_id,'bootstrap_revoked',true,'server_device_grant_created',true);
end;
$$;

revoke all on function public.h205f22_a2_browser_device_rotate_embedded_bootstrap_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_device_rotate_embedded_bootstrap_v1(uuid,text) to service_role;
comment on function public.h205f22_a2_browser_device_rotate_embedded_bootstrap_v1(uuid,text) is
  'Atomically rotates a v0.6.5 embedded single-use bootstrap pairing token into a server-only device grant and revokes the embedded token.';
