-- Branch-local C0 evidence-only readback: compose accepted successor continuity with fresh durable Browser identity, keepalive, enrollment and canonical integration-head checks.
create or replace function public.h205f22_compute_unified_post_successor_continuity_readback_v1(
  p_workspace_id uuid, p_attempt_id text, p_effect_key text, p_receipt_fingerprint_sha256 text,
  p_checkpoint_id bigint, p_successor_client_id text, p_successor_process_incarnation_id text,
  p_successor_epoch bigint, p_expected_source_git_commit text,
  p_max_heartbeat_age interval default interval '120 seconds'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_continuity jsonb; v_state record; v_checkpoint record; v_keepalive jsonb; v_enrolled boolean:=false; v_ok boolean:=false; v_reason text:='UNSET';
begin
  if p_max_heartbeat_age<=interval '0 seconds' or p_max_heartbeat_age>interval '10 minutes' then
    return jsonb_build_object('verified',false,'reason','INVALID_HEARTBEAT_WINDOW','automatic_retry_allowed',false,'authority_effect',false);
  end if;
  v_continuity:=public.h205f22_compute_unified_verified_restart_successor_continuity_v1(p_workspace_id,p_attempt_id,p_effect_key,p_receipt_fingerprint_sha256,p_checkpoint_id,p_successor_process_incarnation_id,p_successor_epoch,p_expected_source_git_commit);
  if not coalesce((v_continuity->>'continuity_accepted')::boolean,false) then v_reason:='SUCCESSOR_CONTINUITY_NOT_ACCEPTED';
  elsif coalesce((v_continuity->>'authority_effect')::boolean,true) or coalesce((v_continuity->>'automatic_retry_allowed')::boolean,true) then v_reason:='CONTINUITY_AUTHORITY_REJECTED';
  else
    select s.client_id,s.last_seen_at,s.supervisor_mode,s.armed,s.state into v_state from public.compute_fabric_a2_browser_supervisor_state_h205f22 s where s.client_id=p_successor_client_id and s.workspace_id=p_workspace_id limit 1;
    if v_state.client_id is null then v_reason:='SUCCESSOR_BROWSER_STATE_MISSING';
    elsif v_state.last_seen_at<clock_timestamp()-p_max_heartbeat_age then v_reason:='SUCCESSOR_HEARTBEAT_STALE';
    elsif v_state.state->>'process_incarnation_id' is distinct from p_successor_process_incarnation_id then v_reason:='SUCCESSOR_PROCESS_MISMATCH';
    elsif v_state.supervisor_mode is distinct from 'CONTROL' or not coalesce(v_state.armed,false) then v_reason:='SUCCESSOR_CONTROL_NOT_ACTIVE';
    else
      v_keepalive:=v_state.state #> '{supervisor_lifecycle,keepalive}';
      if v_keepalive is null or v_keepalive->>'supervisor_id' is distinct from 'METAENGINE_SUPERVISOR' or v_keepalive->>'state' is distinct from 'ACTIVE' or coalesce((v_keepalive->>'supervisor_epoch')::bigint,-1) is distinct from p_successor_epoch then v_reason:='SUCCESSOR_KEEPALIVE_MISMATCH';
      elsif coalesce(v_state.state #>> '{supervisor_lifecycle,supervisor_generation}','UNKNOWN') is distinct from 'IDLE' then v_reason:='SUCCESSOR_GENERATION_NOT_IDLE';
      else
        select exists(select 1 from public.compute_fabric_a2_browser_device_h205f22 d where d.client_id=p_successor_client_id and d.active=true and d.revoked_at is null) into v_enrolled;
        if not v_enrolled then v_reason:='SUCCESSOR_ENROLLMENT_NOT_ACTIVE';
        else
          select c.architecture_version,c.git_branch,c.git_commit into v_checkpoint from public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 c where c.status='AUTHORITATIVE' order by c.created_at desc limit 1;
          if v_checkpoint.architecture_version is null or v_checkpoint.git_branch is distinct from 'integration/compute-unified-v1' or v_checkpoint.git_commit is distinct from p_expected_source_git_commit then v_reason:='INTEGRATION_HEAD_MISMATCH';
          else v_ok:=true; v_reason:='POST_SUCCESSOR_CONTINUITY_VERIFIED'; end if;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('schema','metaengine.compute-unified.post-successor-continuity-readback.v1','verified',v_ok,'reason',v_reason,'workspace_id',p_workspace_id,'successor_client_id',p_successor_client_id,'successor_process_incarnation_id',p_successor_process_incarnation_id,'successor_supervisor_epoch',p_successor_epoch,'expected_source_git_commit',p_expected_source_git_commit,'enrollment_active',v_enrolled,'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false,'authority_effect',false);
end; $$;
revoke all on function public.h205f22_compute_unified_post_successor_continuity_readback_v1(uuid,text,text,text,bigint,text,text,bigint,text,interval) from public,anon,authenticated;
grant execute on function public.h205f22_compute_unified_post_successor_continuity_readback_v1(uuid,text,text,text,bigint,text,text,bigint,text,interval) to service_role;
