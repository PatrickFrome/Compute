-- Native Supervisor signed-request nonce hot-path concurrency repair v3.
--
-- Live evidence (2026-10-06):
--   * h205f22_a2_browser_device_consume_nonce_v2 was the highest lock-wait /
--     statement-timeout PostgREST query in the inspected failure window.
--   * v2 takes FOR UPDATE on the one device row for every authenticated request,
--     deletes expired nonces on every request, then updates last_used_at.
--   * the resulting queue contributes to PostgREST/Edge saturation across state,
--     command wait/lease, admin status, workspace snapshot and heartbeat routes.
--
-- Security invariant:
--   * request timestamp remains bounded to +/- 2 minutes;
--   * exact device/client/profile/revocation binding remains checked;
--   * durable anti-replay remains the unique (device_id, nonce_sha256) insert;
--   * revocation/rotation UPDATEs still conflict with the shared device-row lock.
--
-- Performance invariant:
--   * authenticated requests may share the device row concurrently;
--   * no telemetry UPDATE occurs in the authentication transaction;
--   * expiry cleanup is indexed, probabilistically amortized, advisory-singleton,
--     bounded and SKIP LOCKED rather than an unconditional per-request sweep.
--   * no pg_cron or second scheduler/event source is introduced.

create index if not exists compute_fabric_a2_browser_device_nonce_expires_idx
  on public.compute_fabric_a2_browser_device_nonce_h205f22(expires_at);

create or replace function public.h205f22_a2_browser_device_consume_nonce_v3(
  p_device_id uuid,
  p_client_id text,
  p_nonce_sha256 text,
  p_request_timestamp timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_device_id is null
     or p_client_id is null
     or char_length(p_client_id) < 1
     or char_length(p_client_id) > 160
     or p_nonce_sha256 is null
     or p_nonce_sha256 !~ '^[0-9a-f]{64}$'
     or p_request_timestamp is null then
    return jsonb_build_object('accepted', false, 'reason', 'INVALID_INPUT');
  end if;

  if p_request_timestamp < v_now - interval '2 minutes'
     or p_request_timestamp > v_now + interval '2 minutes' then
    return jsonb_build_object('accepted', false, 'reason', 'TIMESTAMP_OUT_OF_WINDOW');
  end if;

  -- Shared row lock is deliberate. Concurrent signed requests from the same
  -- enrolled device may authenticate together, while a revocation/rotation
  -- UPDATE must wait until all already-admitted authentication transactions
  -- leave this gate. This preserves the v2 revocation ordering without the
  -- per-request exclusive device-row convoy.
  select * into v_device
    from public.compute_fabric_a2_browser_device_h205f22
   where device_id = p_device_id
   for share;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'DEVICE_NOT_FOUND');
  end if;
  if v_device.active is not true or v_device.revoked_at is not null then
    return jsonb_build_object('accepted', false, 'reason', 'DEVICE_REVOKED');
  end if;
  if v_device.client_id <> p_client_id
     or v_device.profile <> 'A2_DEVICE_HTTP_SIGNATURE_V1' then
    return jsonb_build_object('accepted', false, 'reason', 'DEVICE_BINDING_MISMATCH');
  end if;

  -- The PK is the replay authority. Concurrent insertion of the same nonce is
  -- serialized by the unique index itself; exactly one transaction can win.
  begin
    insert into public.compute_fabric_a2_browser_device_nonce_h205f22(
      device_id,
      nonce_sha256,
      seen_at,
      expires_at
    ) values (
      p_device_id,
      p_nonce_sha256,
      v_now,
      v_now + interval '10 minutes'
    );
  exception when unique_violation then
    return jsonb_build_object('accepted', false, 'reason', 'NONCE_REPLAY');
  end;

  -- Browser nonces are crypto.randomBytes(24), and p_nonce_sha256 is therefore
  -- uniformly distributed for normal enrolled clients. Roughly 1/256 accepted
  -- requests attempts one bounded cleanup. The advisory lock is non-blocking:
  -- overlapping cleaners skip rather than form another convoy. The batch can
  -- retire 1024 rows per ~256 inserts, so cleanup capacity exceeds production.
  if left(p_nonce_sha256, 2) = '00'
     and pg_try_advisory_xact_lock(20522, 82703) then
    with victims as (
      select ctid
        from public.compute_fabric_a2_browser_device_nonce_h205f22
       where expires_at < v_now - interval '1 minute'
       order by expires_at
       limit 1024
       for update skip locked
    )
    delete from public.compute_fabric_a2_browser_device_nonce_h205f22 n
    using victims v
     where n.ctid = v.ctid;
  end if;

  -- last_used_at is telemetry, not admission authority. Updating it on every
  -- signed request would upgrade the shared lock back into a hot exclusive
  -- write and recreate the v2 convoy. Enrollment/rotation paths may continue to
  -- maintain their own durable last_used_at observations.
  return jsonb_build_object(
    'accepted', true,
    'reason', 'ACCEPTED',
    'device_id', p_device_id,
    'profile', v_device.profile,
    'key_fingerprint_sha256', v_device.key_fingerprint_sha256
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_device_consume_nonce_v3(uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_device_consume_nonce_v3(uuid,text,text,timestamptz)
  to service_role;

comment on function public.h205f22_a2_browser_device_consume_nonce_v3(uuid,text,text,timestamptz) is
  'Concurrent durable anti-replay admission: shared device binding lock + unique nonce insert + bounded amortized expiry cleanup; no hot-row telemetry update.';
