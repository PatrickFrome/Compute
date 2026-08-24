create or replace function public.h205f22_a2_macroblock_bind_node_v1(p_macroblock_id uuid,p_node_key text,p_executor_binding jsonb,p_authority_binding jsonb,p_waiting_external boolean default false) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype; n destruktion_meta.compute_fabric_a2_macroblock_node_h205f22%rowtype; dep text;
begin
 select * into mb from destruktion_meta.compute_fabric_a2_macroblock_h205f22 where macroblock_id=p_macroblock_id for update; if not found or mb.state<>'EXECUTING' then raise exception 'a2_macroblock_not_executing'; end if;
 select * into n from destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 where macroblock_id=p_macroblock_id and node_key=p_node_key for update; if not found then raise exception 'a2_macroblock_node_not_found'; end if;
 if n.state not in('READY','WAITING_EXTERNAL') then raise exception 'a2_macroblock_node_not_bindable:%',n.state; end if;
 foreach dep in array n.depends_on loop perform 1 from destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 where macroblock_id=p_macroblock_id and node_key=dep and state='SUCCEEDED'; if not found then raise exception 'a2_macroblock_dependency_unsatisfied:%',dep; end if; end loop;
 perform set_config('metaengine.a2_macroblock_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 set state=case when p_waiting_external then 'WAITING_EXTERNAL' else 'RUNNING' end,executor_binding=coalesce(p_executor_binding,'{}'::jsonb),authority_binding=coalesce(p_authority_binding,'{}'::jsonb),started_at=coalesce(started_at,clock_timestamp()) where macroblock_id=p_macroblock_id and node_key=p_node_key returning * into n;
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock-node.v1','macroblock_id',p_macroblock_id,'node_key',p_node_key,'state',n.state,'canonical',false,'authority_effect',false);
end$$;

create or replace function public.h205f22_a2_macroblock_node_result_v1(p_macroblock_id uuid,p_node_key text,p_outcome text,p_evidence jsonb,p_hard_gate jsonb default null) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype; n destruktion_meta.compute_fabric_a2_macroblock_node_h205f22%rowtype; rsha text; gate_sha text;
begin
 if p_outcome not in('SUCCEEDED','FAILED','WAITING_EXTERNAL') then raise exception 'a2_macroblock_outcome_invalid'; end if;
 select * into mb from destruktion_meta.compute_fabric_a2_macroblock_h205f22 where macroblock_id=p_macroblock_id for update; if not found or mb.state<>'EXECUTING' then raise exception 'a2_macroblock_not_executing'; end if;
 select * into n from destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 where macroblock_id=p_macroblock_id and node_key=p_node_key for update; if not found or n.state not in('RUNNING','WAITING_EXTERNAL') then raise exception 'a2_macroblock_node_not_running:%',coalesce(n.state,'?'); end if;
 rsha:=encode(extensions.digest(convert_to(coalesce(p_evidence,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex'); perform set_config('metaengine.a2_macroblock_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 set state=p_outcome,evidence=coalesce(p_evidence,'{}'::jsonb),result_sha256=rsha,finished_at=case when p_outcome in('SUCCEEDED','FAILED') then clock_timestamp() else null end where macroblock_id=p_macroblock_id and node_key=p_node_key returning * into n;
 if p_hard_gate is not null or p_outcome='FAILED' or(p_outcome='SUCCEEDED' and n.hard_gate_after) then
   gate_sha:=encode(extensions.digest(convert_to(coalesce(p_hard_gate,jsonb_build_object('kind',case when p_outcome='FAILED' then 'NODE_FAILED' else 'NODE_BOUNDARY' end,'node_key',p_node_key,'result_sha256',rsha))::text,'UTF8'),'sha256'),'hex');
   update destruktion_meta.compute_fabric_a2_macroblock_h205f22 set state='HARD_GATE',current_hard_gate=coalesce(p_hard_gate,jsonb_build_object('kind',case when p_outcome='FAILED' then 'NODE_FAILED' else 'NODE_BOUNDARY' end,'node_key',p_node_key,'result_sha256',rsha)),hard_gate_sha256=gate_sha,gpt_gate_ack_sha256=null,glm_gate_ack_sha256=null where macroblock_id=p_macroblock_id returning * into mb;
 elsif p_outcome='SUCCEEDED' then
   update destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 x set state='READY' where x.macroblock_id=p_macroblock_id and x.state='PENDING' and not exists(select 1 from unnest(x.depends_on)d where not exists(select 1 from destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 y where y.macroblock_id=p_macroblock_id and y.node_key=d and y.state='SUCCEEDED'));
   if not exists(select 1 from destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 where macroblock_id=p_macroblock_id and state not in('SUCCEEDED','SKIPPED')) then update destruktion_meta.compute_fabric_a2_macroblock_h205f22 set state='COMPLETED' where macroblock_id=p_macroblock_id returning * into mb; end if;
 end if;
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock-node.v1','macroblock_id',p_macroblock_id,'node_key',p_node_key,'node_state',n.state,'macroblock_state',mb.state,'result_sha256',rsha,'hard_gate_sha256',mb.hard_gate_sha256,'canonical',false,'authority_effect',false);
end$$;

create or replace function public.h205f22_a2_macroblock_gate_ack_v1(p_macroblock_id uuid,p_agent text,p_hard_gate_sha256 text) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype;
begin
 if p_agent not in('GPT','GLM') then raise exception 'a2_macroblock_agent_invalid'; end if;
 select * into mb from destruktion_meta.compute_fabric_a2_macroblock_h205f22 where macroblock_id=p_macroblock_id for update; if not found or mb.state<>'HARD_GATE' then raise exception 'a2_macroblock_not_at_hard_gate'; end if;
 if p_hard_gate_sha256 is distinct from mb.hard_gate_sha256 then raise exception 'a2_macroblock_gate_sha_mismatch'; end if;
 perform set_config('metaengine.a2_macroblock_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_macroblock_h205f22 set gpt_gate_ack_sha256=case when p_agent='GPT' then p_hard_gate_sha256 else gpt_gate_ack_sha256 end,glm_gate_ack_sha256=case when p_agent='GLM' then p_hard_gate_sha256 else glm_gate_ack_sha256 end where macroblock_id=p_macroblock_id returning * into mb;
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock-gate.v1','macroblock_id',p_macroblock_id,'state',mb.state,'hard_gate_sha256',mb.hard_gate_sha256,'gpt_acked',mb.gpt_gate_ack_sha256 is not null,'glm_acked',mb.glm_gate_ack_sha256 is not null,'canonical',false,'authority_effect',false);
end$$;

create or replace function public.h205f22_a2_macroblock_gate_resume_v1(p_macroblock_id uuid) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype;
begin
 select * into mb from destruktion_meta.compute_fabric_a2_macroblock_h205f22 where macroblock_id=p_macroblock_id for update; if not found or mb.state<>'HARD_GATE' then raise exception 'a2_macroblock_not_at_hard_gate'; end if;
 if mb.gpt_gate_ack_sha256 is distinct from mb.hard_gate_sha256 or mb.glm_gate_ack_sha256 is distinct from mb.hard_gate_sha256 then raise exception 'a2_macroblock_gate_not_pair_acked'; end if;
 perform set_config('metaengine.a2_macroblock_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_macroblock_h205f22 set state='EXECUTING',current_hard_gate=null,hard_gate_sha256=null,gpt_gate_ack_sha256=null,glm_gate_ack_sha256=null where macroblock_id=p_macroblock_id returning * into mb;
 update destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 x set state='READY' where x.macroblock_id=p_macroblock_id and x.state='PENDING' and not exists(select 1 from unnest(x.depends_on)d where not exists(select 1 from destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 y where y.macroblock_id=p_macroblock_id and y.node_key=d and y.state='SUCCEEDED'));
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock.v1','macroblock_id',p_macroblock_id,'state',mb.state,'canonical',false,'authority_effect',false);
end$$;

revoke all on function public.h205f22_a2_macroblock_open_v1(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_a2_macroblock_ack_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_macroblock_start_v1(uuid) from public,anon,authenticated;
revoke all on function public.h205f22_a2_macroblock_read_v1(uuid) from public,anon,authenticated;
revoke all on function public.h205f22_a2_macroblock_bind_node_v1(uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.h205f22_a2_macroblock_node_result_v1(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_a2_macroblock_gate_ack_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_macroblock_gate_resume_v1(uuid) from public,anon,authenticated;
grant execute on function public.h205f22_a2_macroblock_open_v1(uuid,text,text,text,jsonb) to service_role;
grant execute on function public.h205f22_a2_macroblock_ack_v1(uuid,text,text) to service_role;
grant execute on function public.h205f22_a2_macroblock_start_v1(uuid) to service_role;
grant execute on function public.h205f22_a2_macroblock_read_v1(uuid) to service_role;
grant execute on function public.h205f22_a2_macroblock_bind_node_v1(uuid,text,jsonb,jsonb,boolean) to service_role;
grant execute on function public.h205f22_a2_macroblock_node_result_v1(uuid,text,text,jsonb,jsonb) to service_role;
grant execute on function public.h205f22_a2_macroblock_gate_ack_v1(uuid,text,text) to service_role;
grant execute on function public.h205f22_a2_macroblock_gate_resume_v1(uuid) to service_role;
