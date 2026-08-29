-- A2 conflict state-machine bridge to the existing SAME_POINT_DUEL_V4 protocol.
create or replace function public.h205f22_a2_attach_duel_v1(p_conflict_id uuid,p_duel_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare c destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22%rowtype;
begin
  perform 1 from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id and subject->>'debate_protocol'='SAME_POINT_DUEL_V4';
  if not found then raise exception 'a2_duel_not_v4'; end if;
  perform set_config('metaengine.a2_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 set status='DUEL',duel_id=p_duel_id,updated_at=clock_timestamp() where conflict_id=p_conflict_id and status in ('OPEN','DIRECT_RESOLUTION') returning * into c;
  if not found then raise exception 'a2_conflict_not_attachable'; end if;
  update destruktion_meta.compute_fabric_a2_workspace_h205f22 set mode='DUEL',updated_at=clock_timestamp() where workspace_id=c.workspace_id and mode<>'CLOSED';
  return jsonb_build_object('schema','metaengine.compute.a2-conflict.v1','conflict_id',c.conflict_id,'workspace_id',c.workspace_id,'status','DUEL','duel_id',p_duel_id,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_resolve_conflict_from_duel_v1(p_conflict_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare c destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22%rowtype; d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype; still_duel boolean;
begin
  select * into c from destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 where conflict_id=p_conflict_id and status='DUEL' and duel_id is not null;
  if not found then raise exception 'a2_conflict_not_duel'; end if;
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=c.duel_id;
  if not found or d.status<>'DECIDED' then raise exception 'a2_duel_not_decided'; end if;
  perform set_config('metaengine.a2_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 set status='RESOLVED',updated_at=clock_timestamp() where conflict_id=p_conflict_id returning * into c;
  select exists(select 1 from destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 where workspace_id=c.workspace_id and status='DUEL') into still_duel;
  if not still_duel then update destruktion_meta.compute_fabric_a2_workspace_h205f22 set mode='COLLABORATE',updated_at=clock_timestamp() where workspace_id=c.workspace_id and mode='DUEL'; end if;
  return jsonb_build_object('schema','metaengine.compute.a2-conflict.v1','conflict_id',c.conflict_id,'workspace_id',c.workspace_id,'status','RESOLVED','duel_id',c.duel_id,'canonical',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_a2_resolve_conflict_from_duel_v1(uuid) from public,anon,authenticated,a2_peer_runtime;
grant execute on function public.h205f22_a2_resolve_conflict_from_duel_v1(uuid) to service_role;
