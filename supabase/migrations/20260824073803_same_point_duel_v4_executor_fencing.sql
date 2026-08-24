-- METAENGINE H205F22 SAME_POINT_DUEL_V4 EXECUTOR FENCING
-- Prevents legacy sovereign/Cloudflare executors from claiming V4 sessions and gives
-- V4 a dedicated PostgreSQL notification channel.

create or replace function public.h205f22_duel_create_same_point_v4(
  p_duel_key text,
  p_milestone_key text,
  p_base_github_sha text,
  p_subject jsonb default '{}'::jsonb,
  p_execution_policy text default 'SOVEREIGN_ONLY',
  p_gpt_model text default 'openai/gpt-oss-20b',
  p_glm_model text default 'zai-org/GLM-4.7-Flash'
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare s jsonb; r jsonb;
begin
  if p_execution_policy not in ('SOVEREIGN_ONLY','ANY') then
    raise exception 'v4_hosted_executor_not_implemented';
  end if;
  if jsonb_typeof(coalesce(p_subject,'{}'::jsonb)) <> 'object' then raise exception 'subject_must_be_object'; end if;
  s := coalesce(p_subject,'{}'::jsonb) || jsonb_build_object(
    'debate_protocol','SAME_POINT_DUEL_V4',
    'wave_plan',jsonb_build_array('PROPOSE','REBUT'),
    'reasoning_visibility','OBSERVABLE_ENGINEERING_REASONING_V1',
    'arbitration_policy','EVIDENCE_FIRST_ONE_ACTION_V1',
    'execution_policy',p_execution_policy,
    'executor_class','SOVEREIGN_V4_PERSISTENT',
    'managed_inference_required',false
  );
  r := public.h205f22_duel_create_lockstep_v2(p_duel_key,p_milestone_key,p_base_github_sha,s,p_gpt_model,p_glm_model,2);
  return r || jsonb_build_object(
    'debate_protocol','SAME_POINT_DUEL_V4',
    'wave_plan',jsonb_build_array('PROPOSE','REBUT'),
    'reasoning_visibility','OBSERVABLE_ENGINEERING_REASONING_V1',
    'arbitration_policy','EVIDENCE_FIRST_ONE_ACTION_V1',
    'execution_policy',p_execution_policy,
    'executor_class','SOVEREIGN_V4_PERSISTENT',
    'max_ticks',2,'canonical',false,'authority_effect',false
  );
end
$$;

create or replace function public.h205f22_duel_lease_target_lockstep_v3(
  p_duel_id uuid,
  p_worker text,
  p_lease_seconds integer default 1200,
  p_after_tick bigint default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','extensions'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  v_readback jsonb;
  v_now timestamptz := clock_timestamp();
  v_policy text;
  v_debate text;
  v_hosted boolean;
  v_sovereign boolean;
  v_v4 boolean;
begin
  if p_worker is null or length(trim(p_worker))<3 then raise exception 'worker_required'; end if;
  if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'lease_seconds_out_of_range'; end if;
  if p_after_tick<0 then raise exception 'after_tick_out_of_range'; end if;

  v_hosted := p_worker like 'cf-workflow:%';
  v_sovereign := p_worker like 'sovereign:%';
  v_v4 := p_worker like 'sovereign:v4:%';

  select * into d
  from destruktion_meta.compute_fabric_duel_session_h205f22
  where duel_id=p_duel_id
  for update;

  if not found then
    return jsonb_build_object('schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',false,'reason','NOT_FOUND','canonical',false,'authority_effect',false);
  end if;
  if d.protocol_version<>'LOCKSTEP_V2' then raise exception 'duel_protocol_mismatch'; end if;

  v_policy := coalesce(d.subject->>'execution_policy','ANY');
  v_debate := coalesce(d.subject->>'debate_protocol','MICROSTEP_LOCKSTEP_V2');
  if v_policy not in ('ANY','SOVEREIGN_ONLY','HOSTED_ONLY') then raise exception 'invalid_execution_policy'; end if;

  if v_debate='SAME_POINT_DUEL_V4' and not v_v4 then
    return jsonb_build_object('schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',false,'reason','EXECUTOR_PROTOCOL_FENCED','debate_protocol',v_debate,'duel_id',d.duel_id,'canonical',false,'authority_effect',false);
  end if;
  if v_debate<>'SAME_POINT_DUEL_V4' and v_v4 then
    return jsonb_build_object('schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',false,'reason','EXECUTOR_PROTOCOL_FENCED','debate_protocol',v_debate,'duel_id',d.duel_id,'canonical',false,'authority_effect',false);
  end if;

  if v_policy='SOVEREIGN_ONLY' and v_hosted then
    return jsonb_build_object('schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',false,'reason','EXECUTOR_POLICY_FENCED','execution_policy',v_policy,'duel_id',d.duel_id,'canonical',false,'authority_effect',false);
  end if;
  if v_policy='HOSTED_ONLY' and v_sovereign then
    return jsonb_build_object('schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',false,'reason','EXECUTOR_POLICY_FENCED','execution_policy',v_policy,'duel_id',d.duel_id,'canonical',false,'authority_effect',false);
  end if;

  if d.status='RUNNING' and d.lease_expires_at is not null and d.lease_expires_at<=v_now then
    update destruktion_meta.compute_fabric_duel_session_h205f22
    set status='READY',lease_owner=null,lease_expires_at=null,updated_at=v_now
    where duel_id=p_duel_id returning * into d;
  end if;

  if d.status='READY' then
    update destruktion_meta.compute_fabric_duel_session_h205f22
    set status='RUNNING',lease_owner=p_worker,lease_generation=lease_generation+1,
        lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),updated_at=v_now
    where duel_id=p_duel_id returning * into d;
  elsif d.status='RUNNING' and d.lease_owner=p_worker and d.lease_expires_at>v_now then
    null;
  elsif d.status='RUNNING' then
    return jsonb_build_object('schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',false,'reason','BUSY','duel_id',d.duel_id,'status',d.status,'execution_policy',v_policy,'debate_protocol',v_debate,'canonical',false,'authority_effect',false);
  else
    return jsonb_build_object('schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',false,'reason','TERMINAL','duel_id',d.duel_id,'status',d.status,'execution_policy',v_policy,'debate_protocol',v_debate,'canonical',false,'authority_effect',false);
  end if;

  v_readback := public.h205f22_duel_read_lockstep_v2(p_duel_id,p_after_tick);
  return jsonb_build_object(
    'schema','metaengine.compute.duel-target-lease-read.h205f22.v3','leased',true,
    'duel_id',d.duel_id,'duel_key',d.duel_key,'milestone_key',d.milestone_key,
    'checkpoint_id',d.semantic_checkpoint_id,'payload_root_sha256',d.semantic_payload_root_sha256,
    'base_github_sha',d.base_github_sha,'subject',d.subject,
    'gpt_model',d.gpt_model,'glm_model',d.glm_model,'protocol_version',d.protocol_version,
    'current_tick',d.current_tick,'current_checkpoint_sha256',d.current_checkpoint_sha256,
    'max_ticks',d.max_ticks,'lease_generation',d.lease_generation,'lease_expires_at',d.lease_expires_at,
    'readback',v_readback,'execution_policy',v_policy,'debate_protocol',v_debate,
    'targeted',true,'canonical',false,'authority_effect',false
  );
end
$$;

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

  return jsonb_build_object('schema','metaengine.compute.duel-lockstep-lease.h205f22.v2','leased',true,
    'duel_id',d.duel_id,'duel_key',d.duel_key,'milestone_key',d.milestone_key,
    'checkpoint_id',d.semantic_checkpoint_id,'payload_root_sha256',d.semantic_payload_root_sha256,
    'base_github_sha',d.base_github_sha,'subject',d.subject,'gpt_model',d.gpt_model,'glm_model',d.glm_model,
    'protocol_version',d.protocol_version,'current_tick',d.current_tick,'current_checkpoint_sha256',d.current_checkpoint_sha256,
    'max_ticks',d.max_ticks,'lease_generation',d.lease_generation,'lease_expires_at',d.lease_expires_at,
    'execution_policy',coalesce(d.subject->>'execution_policy','ANY'),
    'debate_protocol',coalesce(d.subject->>'debate_protocol','MICROSTEP_LOCKSTEP_V2'),
    'canonical',false,'authority_effect',false);
end
$$;

create or replace function destruktion_meta.compute_fabric_duel_enqueue_wake_h205f22(p_duel_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','extensions','vault','net'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  u text; k text; body jsonb; wake_id text; msg text; sig text; req bigint; evt jsonb; notify_evt jsonb;
  v_policy text; v_debate text;
begin
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id;
  if not found or d.protocol_version<>'LOCKSTEP_V2' or d.status<>'READY' then return null; end if;

  v_policy := coalesce(d.subject->>'execution_policy','ANY');
  v_debate := coalesce(d.subject->>'debate_protocol','MICROSTEP_LOCKSTEP_V2');
  wake_id := 'duel:'||d.duel_id::text||':'||d.current_checkpoint_sha256;

  perform pg_notify('h205f22_duel_ready_v1',jsonb_build_object('duel_id',d.duel_id,'duel_key',d.duel_key,'checkpoint_sha256',d.current_checkpoint_sha256,'execution_policy',v_policy,'debate_protocol',v_debate)::text);
  if v_debate='SAME_POINT_DUEL_V4' then
    perform pg_notify('h205f22_same_point_v4_ready',jsonb_build_object('duel_id',d.duel_id,'duel_key',d.duel_key,'checkpoint_sha256',d.current_checkpoint_sha256,'execution_policy',v_policy,'debate_protocol',v_debate)::text);
  end if;

  notify_evt := jsonb_build_object('wake_id',wake_id,'channels',case when v_debate='SAME_POINT_DUEL_V4' then jsonb_build_array('h205f22_duel_ready_v1','h205f22_same_point_v4_ready') else jsonb_build_array('h205f22_duel_ready_v1') end,'execution_policy',v_policy,'debate_protocol',v_debate,'canonical',false,'authority_effect',false);
  insert into destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,phase,actor,payload,payload_sha256)
  values(d.duel_id,case when v_debate='SAME_POINT_DUEL_V4' then 'SAME_POINT_V4_WAKE_NOTIFIED' else 'SOVEREIGN_WAKE_NOTIFIED' end,'SYSTEM',notify_evt,encode(extensions.digest(convert_to(notify_evt::text,'utf8'),'sha256'),'hex'));

  if v_policy='SOVEREIGN_ONLY' then return null; end if;
  if v_debate='SAME_POINT_DUEL_V4' then return null; end if;

  select runtime_url into u from destruktion_meta.compute_fabric_aop_runtime_endpoint_h205f22 where endpoint_key='PRIMARY';
  if u is null then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='aop1_wake_secret' order by created_at desc limit 1;
  if k is null or length(k)<16 then raise exception 'duel_wake_secret_unavailable'; end if;

  body:=jsonb_build_object('id',wake_id,'reason','DUEL_DB_INSERT','source','supabase-pg-net','payload',jsonb_build_object('duel_id',d.duel_id,'duel_key',d.duel_key,'checkpoint_sha256',d.current_checkpoint_sha256));
  msg:=concat_ws('|',wake_id,'DUEL_DB_INSERT',d.duel_id::text,d.current_checkpoint_sha256);
  sig:=encode(extensions.hmac(convert_to(msg,'utf8'),convert_to(k,'utf8'),'sha256'),'hex');
  select net.http_post(url:=u||'/duel/db-wake',body:=body,headers:=jsonb_build_object('Content-Type','application/json','X-Metaengine-Duel-Signature-256','sha256='||sig),timeout_milliseconds:=5000) into req;
  evt:=jsonb_build_object('request_id',req,'runtime_url_sha256',encode(extensions.digest(convert_to(u,'utf8'),'sha256'),'hex'),'wake_id',wake_id,'message_sha256',encode(extensions.digest(convert_to(msg,'utf8'),'sha256'),'hex'),'canonical',false,'authority_effect',false);
  insert into destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,phase,actor,payload,payload_sha256)
  values(d.duel_id,'WAKE_ENQUEUED','SYSTEM',evt,encode(extensions.digest(convert_to(evt::text,'utf8'),'sha256'),'hex'));
  return req;
end
$$;
