create table if not exists destruktion_meta.compute_fabric_a2_provider_block_h205f22 (
  block_id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  agent text not null check (agent in ('GPT','GLM')),
  provider text not null,
  requested_model text not null,
  failure_code text not null check (failure_code in ('AUTHENTICATION_REQUIRED','BILLING_REQUIRED','CUSTOMER_VERIFICATION_REQUIRED','AUTHORIZATION_REQUIRED','EXACT_MODEL_REPORT_MISMATCH','PERMANENT_PROVIDER_FAILURE')),
  triggering_event_id uuid not null references destruktion_meta.compute_fabric_a2_agent_event_h205f22(event_id),
  triggered_at timestamptz not null default clock_timestamp(),
  cleared_at timestamptz,
  recovery_probe jsonb,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false)
);

create unique index if not exists compute_fabric_a2_provider_block_active_uq
  on destruktion_meta.compute_fabric_a2_provider_block_h205f22(workspace_id,agent)
  where cleared_at is null;
create unique index if not exists compute_fabric_a2_provider_block_event_uq
  on destruktion_meta.compute_fabric_a2_provider_block_h205f22(triggering_event_id);
create index if not exists compute_fabric_a2_provider_block_workspace_idx
  on destruktion_meta.compute_fabric_a2_provider_block_h205f22(workspace_id,triggered_at desc);

alter table destruktion_meta.compute_fabric_a2_provider_block_h205f22 enable row level security;
revoke all on destruktion_meta.compute_fabric_a2_provider_block_h205f22 from public,anon,authenticated,service_role,a2_peer_runtime;

drop trigger if exists trg_a2_guard_provider_block on destruktion_meta.compute_fabric_a2_provider_block_h205f22;
create trigger trg_a2_guard_provider_block
before insert or update or delete on destruktion_meta.compute_fabric_a2_provider_block_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();

create or replace function destruktion_meta.compute_fabric_a2_provider_failure_fence_h205f22()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare
  v_reason text:=coalesce(new.payload->>'reason','');
  v_code text;
  v_provider text:=coalesce(new.model_provenance->>'provider','unknown');
  v_model text:=coalesce(new.model_provenance->>'requested_model','unknown');
  v_existing uuid;
begin
  if new.event_type<>'ERROR' then return new; end if;
  if not (
    v_reason ~ '^Error: model_(401|402|403):'
    or v_reason like '%customer_verification_required%'
    or v_reason like '%exact_model_report_mismatch%'
  ) then return new; end if;

  v_code:=case
    when v_reason like '%customer_verification_required%' then 'CUSTOMER_VERIFICATION_REQUIRED'
    when v_reason like '%model_401:%' then 'AUTHENTICATION_REQUIRED'
    when v_reason like '%model_402:%' then 'BILLING_REQUIRED'
    when v_reason like '%model_403:%' then 'AUTHORIZATION_REQUIRED'
    when v_reason like '%exact_model_report_mismatch%' then 'EXACT_MODEL_REPORT_MISMATCH'
    else 'PERMANENT_PROVIDER_FAILURE'
  end;

  perform set_config('metaengine.a2_rpc','on',true);
  select block_id into v_existing
  from destruktion_meta.compute_fabric_a2_provider_block_h205f22
  where workspace_id=new.workspace_id and agent=new.agent and cleared_at is null
  for update;

  if found then
    update destruktion_meta.compute_fabric_a2_provider_block_h205f22
    set failure_code=v_code, provider=v_provider, requested_model=v_model,
        triggering_event_id=new.event_id, triggered_at=clock_timestamp()
    where block_id=v_existing;
  else
    insert into destruktion_meta.compute_fabric_a2_provider_block_h205f22(
      workspace_id,agent,provider,requested_model,failure_code,triggering_event_id
    ) values (
      new.workspace_id,new.agent,v_provider,v_model,v_code,new.event_id
    );
  end if;

  update destruktion_meta.compute_fabric_a2_workspace_h205f22
  set mode='PAUSED',updated_at=clock_timestamp()
  where workspace_id=new.workspace_id and mode='COLLABORATE';
  return new;
end $$;

drop trigger if exists trg_a2_provider_failure_fence on destruktion_meta.compute_fabric_a2_agent_event_h205f22;
create trigger trg_a2_provider_failure_fence
after insert on destruktion_meta.compute_fabric_a2_agent_event_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_provider_failure_fence_h205f22();

create or replace function public.h205f22_a2_clear_provider_block_v1(
  p_workspace_id uuid,
  p_agent text,
  p_recovery_probe jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare
  v_expected_model text;
  v_cleared integer:=0;
  v_remaining integer:=0;
  v_mode text;
begin
  if p_agent not in ('GPT','GLM') then raise exception 'a2_provider_block_agent_invalid'; end if;
  v_expected_model:=case when p_agent='GPT' then 'openai/gpt-5.6-sol' else 'zai/glm-5.3' end;
  if coalesce((p_recovery_probe->>'ready')::boolean,false) is distinct from true
     or coalesce(p_recovery_probe->>'class','')<>'READY'
     or coalesce(p_recovery_probe->>'reported_model','')<>v_expected_model then
    raise exception 'a2_provider_recovery_probe_invalid';
  end if;

  perform set_config('metaengine.a2_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_provider_block_h205f22
  set cleared_at=clock_timestamp(),recovery_probe=p_recovery_probe
  where workspace_id=p_workspace_id and agent=p_agent and cleared_at is null;
  get diagnostics v_cleared=row_count;

  select count(*)::integer into v_remaining
  from destruktion_meta.compute_fabric_a2_provider_block_h205f22
  where workspace_id=p_workspace_id and cleared_at is null;

  if v_remaining=0 then
    update destruktion_meta.compute_fabric_a2_workspace_h205f22
    set mode='COLLABORATE',updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and mode='PAUSED';
  end if;
  select mode into v_mode from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id;

  return jsonb_build_object(
    'schema','metaengine.compute.a2-provider-block-clear.v1',
    'workspace_id',p_workspace_id,'agent',p_agent,'cleared',v_cleared>0,
    'remaining_active_blocks',v_remaining,'workspace_mode',v_mode,
    'canonical',false,'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_a2_clear_provider_block_v1(uuid,text,jsonb) from public,anon,authenticated,a2_peer_runtime;
grant execute on function public.h205f22_a2_clear_provider_block_v1(uuid,text,jsonb) to service_role;

comment on table destruktion_meta.compute_fabric_a2_provider_block_h205f22 is
  'Fail-closed non-authority provider availability fence. Permanent exact-model failures pause A2 instead of creating repeated lockstep rounds.';
