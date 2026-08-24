-- METAENGINE H205F22 SAME_POINT_DUEL_V4 RECOVERY READBACK
-- A V4 runner that recovers after a crash between PROPOSE and REBUT must receive
-- the persisted proposal pair with the recovery lease, so REBUT sees the exact
-- peer events and hashes instead of reconstructing from local process memory.

create or replace function public.h205f22_duel_lease_lockstep_v2(
  p_worker text,
  p_lease_seconds integer default 1200
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','extensions'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  v_hosted boolean;
  v_sovereign boolean;
  v_v4 boolean;
  v_debate text;
  v_readback jsonb := null;
begin
  if p_worker is null or length(trim(p_worker))<3 then raise exception 'worker_required'; end if;
  if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'lease_seconds_out_of_range'; end if;
  v_hosted := p_worker like 'cf-workflow:%';
  v_sovereign := p_worker like 'sovereign:%';
  v_v4 := p_worker like 'sovereign:v4:%';

  update destruktion_meta.compute_fabric_duel_session_h205f22
  set status='READY',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp()
  where protocol_version='LOCKSTEP_V2' and status='RUNNING' and lease_expires_at<=clock_timestamp();

  select * into d
  from destruktion_meta.compute_fabric_duel_session_h205f22
  where protocol_version='LOCKSTEP_V2'
    and status='READY'
    and (
      (v_v4 and coalesce(subject->>'debate_protocol','MICROSTEP_LOCKSTEP_V2')='SAME_POINT_DUEL_V4')
      or
      (not v_v4 and coalesce(subject->>'debate_protocol','MICROSTEP_LOCKSTEP_V2')<>'SAME_POINT_DUEL_V4')
    )
    and not (v_hosted and coalesce(subject->>'execution_policy','ANY')='SOVEREIGN_ONLY')
    and not (v_sovereign and coalesce(subject->>'execution_policy','ANY')='HOSTED_ONLY')
  order by created_at
  for update skip locked
  limit 1;

  if not found then return jsonb_build_object('schema','metaengine.compute.duel-lockstep-lease.h205f22.v2','leased',false); end if;

  update destruktion_meta.compute_fabric_duel_session_h205f22
  set status='RUNNING',lease_owner=p_worker,lease_generation=lease_generation+1,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp()
  where duel_id=d.duel_id returning * into d;

  v_debate := coalesce(d.subject->>'debate_protocol','MICROSTEP_LOCKSTEP_V2');
  if v_debate='SAME_POINT_DUEL_V4' then
    v_readback := public.h205f22_duel_read_lockstep_v2(d.duel_id,0);
  end if;

  return jsonb_build_object('schema','metaengine.compute.duel-lockstep-lease.h205f22.v2','leased',true,
    'duel_id',d.duel_id,'duel_key',d.duel_key,'milestone_key',d.milestone_key,
    'checkpoint_id',d.semantic_checkpoint_id,'payload_root_sha256',d.semantic_payload_root_sha256,
    'base_github_sha',d.base_github_sha,'subject',d.subject,'gpt_model',d.gpt_model,'glm_model',d.glm_model,
    'protocol_version',d.protocol_version,'current_tick',d.current_tick,'current_checkpoint_sha256',d.current_checkpoint_sha256,
    'max_ticks',d.max_ticks,'lease_generation',d.lease_generation,'lease_expires_at',d.lease_expires_at,
    'execution_policy',coalesce(d.subject->>'execution_policy','ANY'),'debate_protocol',v_debate,
    'readback',v_readback,'canonical',false,'authority_effect',false);
end
$$;
