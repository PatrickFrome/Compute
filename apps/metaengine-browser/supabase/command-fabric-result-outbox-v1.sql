-- METAENGINE Command Fabric v2 durable result outbox source contract.
-- Intentionally rollback-only and outside supabase/migrations. The command table
-- remains authoritative; this table is only a monotonic terminal-result index.

begin;

create table public.compute_fabric_a2_browser_command_result_outbox_h205f22 (
  outbox_seq bigint generated always as identity primary key,
  workspace_id uuid not null,
  command_id uuid not null,
  result_client_id text,
  status text not null check (status in ('COMPLETED','FAILED','EXPIRED','CANCELLED')),
  completed_at timestamptz,
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_bytes integer not null check (receipt_bytes between 0 and 1048576),
  effect_binding_sha256 text,
  created_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check (authority_effect = false),
  unique (workspace_id, command_id)
);

alter table public.compute_fabric_a2_browser_command_result_outbox_h205f22 enable row level security;
revoke all on public.compute_fabric_a2_browser_command_result_outbox_h205f22 from public;
revoke all on public.compute_fabric_a2_browser_command_result_outbox_h205f22 from anon;
revoke all on public.compute_fabric_a2_browser_command_result_outbox_h205f22 from authenticated;
grant select on public.compute_fabric_a2_browser_command_result_outbox_h205f22 to service_role;

create or replace function public.h205f22_a2_browser_supervisor_result_outbox_capture_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_receipt_text text := coalesce(new.receipt, '{}'::jsonb)::text;
  v_client text := coalesce(nullif(trim(new.leased_by), ''), nullif(trim(new.target_client_id), ''));
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.status not in ('COMPLETED','FAILED','EXPIRED','CANCELLED') then return new; end if;
  if old.status = new.status then return new; end if;
  if old.status in ('COMPLETED','FAILED','EXPIRED','CANCELLED') then return new; end if;

  insert into public.compute_fabric_a2_browser_command_result_outbox_h205f22 (
    workspace_id, command_id, result_client_id, status, completed_at,
    receipt_sha256, receipt_bytes, effect_binding_sha256, authority_effect
  ) values (
    new.workspace_id,
    new.command_id,
    v_client,
    new.status,
    new.completed_at,
    encode(extensions.digest(convert_to(v_receipt_text, 'UTF8'), 'sha256'), 'hex'),
    octet_length(v_receipt_text),
    new.effect_binding_sha256,
    false
  )
  on conflict (workspace_id, command_id) do nothing;

  return new;
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_result_outbox_capture_v1() from public;
revoke all on function public.h205f22_a2_browser_supervisor_result_outbox_capture_v1() from anon;
revoke all on function public.h205f22_a2_browser_supervisor_result_outbox_capture_v1() from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_result_outbox_capture_v1() to service_role;

create trigger h205f22_a2_browser_supervisor_result_outbox_capture_v1
  after update of status on public.compute_fabric_a2_browser_supervisor_command_h205f22
  for each row
  when (
    new.status in ('COMPLETED','FAILED','EXPIRED','CANCELLED')
    and old.status is distinct from new.status
  )
  execute function public.h205f22_a2_browser_supervisor_result_outbox_capture_v1();

create or replace function public.h205f22_a2_browser_supervisor_result_delta_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_after_seq bigint default 0,
  p_limit integer default 16
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_client text := left(trim(coalesce(p_client_id, '')), 160);
  v_after bigint := greatest(0, coalesce(p_after_seq, 0));
  v_limit integer := greatest(1, least(16, coalesce(p_limit, 16)));
  v_rows jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_next bigint := v_after;
  v_has_more boolean := false;
begin
  if p_workspace_id is null or v_client = '' then
    raise exception 'supervisor_result_delta_identity_invalid';
  end if;

  with picked as (
    select o.*
    from public.compute_fabric_a2_browser_command_result_outbox_h205f22 o
    where o.workspace_id = p_workspace_id
      and o.result_client_id = v_client
      and o.outbox_seq > v_after
    order by o.outbox_seq
    limit v_limit
  ), hydrated as (
    select
      p.outbox_seq,
      p.command_id,
      p.status,
      p.completed_at,
      p.receipt_sha256,
      p.receipt_bytes,
      p.effect_binding_sha256,
      c.error,
      case
        when c.command_id is not null
          and p.receipt_bytes <= 4096
          and octet_length(coalesce(c.receipt, '{}'::jsonb)::text) = p.receipt_bytes
          and encode(extensions.digest(convert_to(coalesce(c.receipt, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex') = p.receipt_sha256
        then c.receipt
        else null
      end as receipt_inline
    from picked p
    left join public.compute_fabric_a2_browser_supervisor_command_h205f22 c
      on c.workspace_id = p.workspace_id and c.command_id = p.command_id
    order by p.outbox_seq
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'outbox_seq', outbox_seq,
      'command_id', command_id,
      'status', status,
      'completed_at', completed_at,
      'receipt_sha256', receipt_sha256,
      'receipt_bytes', receipt_bytes,
      'receipt_inline', receipt_inline,
      'receipt_inline_verified', receipt_inline is not null,
      'effect_binding_sha256', effect_binding_sha256,
      'error', case when error is null then null else left(error, 500) end,
      'authority_effect', false
    ) order by outbox_seq), '[]'::jsonb),
    coalesce(max(outbox_seq), v_after)
  into v_rows, v_next
  from hydrated;

  select exists(
    select 1
    from public.compute_fabric_a2_browser_command_result_outbox_h205f22 o
    where o.workspace_id = p_workspace_id
      and o.result_client_id = v_client
      and o.outbox_seq > v_next
  ) into v_has_more;

  v_payload := jsonb_build_object(
    'schema', 'metaengine.native-supervisor.result-delta.v1',
    'after_seq', v_after,
    'next_seq', v_next,
    'has_more', v_has_more,
    'results', v_rows,
    'inline_receipt_limit_bytes', 4096,
    'hard_response_limit_bytes', 16384,
    'transport_delivery_is_authority', false,
    'automatic_effect_retry_allowed', false,
    'authority_effect', false
  );

  if octet_length(v_payload::text) > 16384 then
    select coalesce(jsonb_agg(
      jsonb_set(jsonb_set(row_value, '{receipt_inline}', 'null'::jsonb, true), '{receipt_inline_verified}', 'false'::jsonb, true)
      order by (row_value->>'outbox_seq')::bigint
    ), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_rows) as rows(row_value);

    v_payload := jsonb_set(v_payload, '{results}', v_rows, true)
      || jsonb_build_object('receipt_inline_omitted_for_budget', true);
  end if;

  if octet_length(v_payload::text) > 16384 then
    raise exception 'supervisor_result_delta_budget_exceeded';
  end if;

  return v_payload;
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_result_delta_v1(uuid,text,bigint,integer) from public;
revoke all on function public.h205f22_a2_browser_supervisor_result_delta_v1(uuid,text,bigint,integer) from anon;
revoke all on function public.h205f22_a2_browser_supervisor_result_delta_v1(uuid,text,bigint,integer) from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_result_delta_v1(uuid,text,bigint,integer) to service_role;

rollback;
