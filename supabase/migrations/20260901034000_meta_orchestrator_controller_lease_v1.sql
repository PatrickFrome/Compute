-- METAENGINE Meta-Orchestrator controller lease v1.
-- Branch-local migration only. Do not apply to production from this audit task.
-- Continuous Meta reconciliation is driven by the existing Browser/DevOS heartbeat.
-- This short lease elects one semantic controller without creating a second scheduler.

create table if not exists destruktion_meta.meta_orchestrator_controller_lease_h205f22 (
  workspace_id uuid not null,
  roadmap_id text not null check (roadmap_id ~ '^[a-z0-9][a-z0-9._:-]{2,159}$'),
  holder_client_id text,
  leader_epoch bigint not null default 0 check (leader_epoch >= 0),
  state text not null default 'VACANT' check (state in ('VACANT','ACTIVE')),
  acquired_at timestamptz,
  renewed_at timestamptz,
  expires_at timestamptz,
  transitions bigint not null default 0 check (transitions >= 0),
  authority_effect boolean not null default false check (authority_effect = false),
  primary key (workspace_id, roadmap_id)
);

alter table destruktion_meta.meta_orchestrator_controller_lease_h205f22 enable row level security;
revoke all on destruktion_meta.meta_orchestrator_controller_lease_h205f22 from public, anon, authenticated;

create or replace function public.meta_orchestrator_controller_lease_v1(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_client_id text,
  p_seconds integer default 12
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_client_id text := trim(coalesce(p_client_id,''));
  v_seconds integer := greatest(6, least(30, coalesce(p_seconds,12)));
  v_now timestamptz := clock_timestamp();
  v_row destruktion_meta.meta_orchestrator_controller_lease_h205f22%rowtype;
begin
  if p_workspace_id is null then raise exception 'meta_controller_workspace_required' using errcode = '22023'; end if;
  if v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then raise exception 'meta_controller_roadmap_invalid' using errcode = '22023'; end if;
  if length(v_client_id) < 3 or length(v_client_id) > 160 or v_client_id ~ '[[:cntrl:]]' then raise exception 'meta_controller_client_invalid' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('meta-controller-lease:' || p_workspace_id::text || ':' || v_roadmap_id,0));

  select * into v_row
    from destruktion_meta.meta_orchestrator_controller_lease_h205f22
   where workspace_id = p_workspace_id and roadmap_id = v_roadmap_id
   for update;

  if not found then
    insert into destruktion_meta.meta_orchestrator_controller_lease_h205f22(
      workspace_id,roadmap_id,holder_client_id,leader_epoch,state,acquired_at,renewed_at,expires_at,transitions,authority_effect
    ) values (
      p_workspace_id,v_roadmap_id,v_client_id,1,'ACTIVE',v_now,v_now,v_now + make_interval(secs => v_seconds),1,false
    ) returning * into v_row;
  elsif v_row.state = 'ACTIVE' and v_row.holder_client_id = v_client_id and v_row.expires_at > v_now then
    update destruktion_meta.meta_orchestrator_controller_lease_h205f22
       set renewed_at=v_now, expires_at=v_now + make_interval(secs => v_seconds), authority_effect=false
     where workspace_id=p_workspace_id and roadmap_id=v_roadmap_id
    returning * into v_row;
  elsif v_row.state <> 'ACTIVE' or v_row.expires_at is null or v_row.expires_at <= v_now then
    update destruktion_meta.meta_orchestrator_controller_lease_h205f22
       set holder_client_id=v_client_id,
           leader_epoch=v_row.leader_epoch + 1,
           state='ACTIVE', acquired_at=v_now, renewed_at=v_now,
           expires_at=v_now + make_interval(secs => v_seconds),
           transitions=v_row.transitions + 1, authority_effect=false
     where workspace_id=p_workspace_id and roadmap_id=v_roadmap_id
    returning * into v_row;
  else
    return jsonb_build_object(
      'schema','metaengine.meta-orchestrator.controller-lease.v1','workspace_id',p_workspace_id,'roadmap_id',v_roadmap_id,
      'leased',false,'leader_epoch',v_row.leader_epoch,'holder_verified',false,'not_expired',v_row.expires_at > v_now,
      'expires_at',v_row.expires_at,'transitions',v_row.transitions,'lease_seconds',v_seconds,
      'scheduler_authority',false,'browser_authority',false,'release_authority',false,'authority_effect',false
    );
  end if;

  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.controller-lease.v1','workspace_id',p_workspace_id,'roadmap_id',v_roadmap_id,
    'leased',true,'leader_epoch',v_row.leader_epoch,'holder_verified',v_row.holder_client_id = v_client_id,
    'not_expired',v_row.expires_at > clock_timestamp(),'expires_at',v_row.expires_at,'transitions',v_row.transitions,
    'lease_seconds',v_seconds,'scheduler_authority',false,'browser_authority',false,'release_authority',false,'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_controller_lease_v1(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_controller_lease_v1(uuid,text,text,integer) to service_role;
