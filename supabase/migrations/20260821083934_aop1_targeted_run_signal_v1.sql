create or replace function public.h205f22_aop1_signal_run_v1(
  p_run_id uuid,
  p_condition text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype;
  v_event jsonb;
begin
  if p_run_id is null then raise exception 'run_id_required' using errcode='22023'; end if;
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then raise exception 'signal_payload_must_be_object' using errcode='22023'; end if;
  if octet_length(coalesce(p_payload,'{}'::jsonb)::text) > 65536 then raise exception 'signal_payload_too_large' using errcode='22023'; end if;

  select * into v_run
  from destruktion_meta.compute_fabric_aop_run_h205f22
  where run_id=p_run_id
  for update;

  if not found then raise exception 'unknown_run' using errcode='22023'; end if;
  if v_run.state <> 'WAITING_EVENT' then raise exception 'run_not_waiting_event' using errcode='55000'; end if;
  if v_run.wake_condition is distinct from p_condition then raise exception 'wake_condition_mismatch' using errcode='55000'; end if;

  update destruktion_meta.compute_fabric_aop_run_h205f22
  set state='READY',
      wake_condition=null,
      input=coalesce(input,'{}'::jsonb) || jsonb_build_object(
        'resume_signal',jsonb_build_object(
          'condition',p_condition,
          'payload',coalesce(p_payload,'{}'::jsonb),
          'received_at',clock_timestamp()
        )
      ),
      updated_at=clock_timestamp()
  where run_id=p_run_id;

  v_event:=destruktion_meta.compute_fabric_aop_emit_event_h205f22(
    'CONDITION_SIGNAL_TARGETED',v_run.milestone_key,v_run.run_id,v_run.role_key,'EXTERNAL',
    jsonb_build_object('condition',p_condition,'payload',coalesce(p_payload,'{}'::jsonb),'resume_payload_attached',true),
    'targeted-signal:'||p_run_id::text||':'||p_condition||':'||clock_timestamp()::text,
    v_run.expected_github_sha
  );

  return jsonb_build_object(
    'schema','metaengine.compute.aop-targeted-signal.h205f22.v1',
    'run_id',p_run_id,
    'condition',p_condition,
    'woken',true,
    'resume_payload_attached',true,
    'event_id',(v_event->>'event_id')::bigint,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_aop1_signal_run_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_aop1_signal_run_v1(uuid,text,jsonb) to service_role;
