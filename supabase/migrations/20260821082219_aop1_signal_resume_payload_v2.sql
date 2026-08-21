create or replace function public.h205f22_aop1_signal_v1(p_condition text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
begin
  if p_condition is null or char_length(p_condition)<3 then
    raise exception 'invalid_condition' using errcode='22023';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'signal_payload_must_be_object' using errcode='22023';
  end if;
  if octet_length(v_payload::text) > 65536 then
    raise exception 'signal_payload_too_large' using errcode='22023';
  end if;

  update destruktion_meta.compute_fabric_aop_run_h205f22
  set state='READY',
      wake_condition=null,
      input=coalesce(input,'{}'::jsonb) || jsonb_build_object(
        'resume_signal', jsonb_build_object(
          'condition',p_condition,
          'payload',v_payload,
          'received_at',v_now
        )
      ),
      updated_at=v_now
  where state='WAITING_EVENT' and wake_condition=p_condition;
  get diagnostics v_count=row_count;

  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22(
    'CONDITION_SIGNAL',null,null,null,'EXTERNAL',
    jsonb_build_object('condition',p_condition,'payload',v_payload,'woken_runs',v_count,'resume_payload_attached',true),
    'signal:'||p_condition||':'||v_now::text,null
  );

  return jsonb_build_object(
    'schema','metaengine.compute.aop-signal.h205f22.v1',
    'condition',p_condition,
    'woken_runs',v_count,
    'resume_payload_attached',true,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_aop1_signal_v1(text,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_aop1_signal_v1(text,jsonb) to service_role;
