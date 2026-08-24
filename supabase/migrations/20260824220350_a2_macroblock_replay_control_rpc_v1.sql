create or replace function public.h205f22_a2_macroblock_open_v1(p_workspace_id uuid,p_macroblock_key text,p_title text,p_start_snapshot_sha256 text,p_plan jsonb) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype; n jsonb; dep text; dep_ord int; node_ord int; node_key text; plan_sha text;
begin
 if nullif(p_macroblock_key,'') is null or nullif(p_title,'') is null then raise exception 'a2_macroblock_identity_invalid'; end if;
 if p_start_snapshot_sha256!~'^[0-9a-f]{64}$' then raise exception 'a2_macroblock_snapshot_invalid'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or jsonb_typeof(p_plan->'nodes')<>'array' or jsonb_array_length(p_plan->'nodes')<1 then raise exception 'a2_macroblock_plan_invalid'; end if;
 perform 1 from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id and mode<>'CLOSED'; if not found then raise exception 'a2_macroblock_workspace_not_open'; end if;
 for n in select value from jsonb_array_elements(p_plan->'nodes') loop
   node_key:=n->>'node_key'; node_ord:=nullif(n->>'ordinal','')::int;
   if nullif(node_key,'') is null or node_ord is null or node_ord<0 or (n->>'execution_class') not in('A_DETERMINISTIC','B_BOUNDED','C_SEMANTIC') or jsonb_typeof(n->'action')<>'object' then raise exception 'a2_macroblock_node_invalid:%',coalesce(node_key,'?'); end if;
   if(select count(*) from jsonb_array_elements(p_plan->'nodes')x where x->>'node_key'=node_key)<>1 then raise exception 'a2_macroblock_node_key_not_unique:%',node_key; end if;
   for dep in select jsonb_array_elements_text(coalesce(n->'depends_on','[]'::jsonb)) loop
     select(x->>'ordinal')::int into dep_ord from jsonb_array_elements(p_plan->'nodes')x where x->>'node_key'=dep;
     if dep_ord is null then raise exception 'a2_macroblock_dependency_missing:%->%',node_key,dep; end if;
     if dep_ord>=node_ord then raise exception 'a2_macroblock_dependency_not_earlier:%->%',node_key,dep; end if;
   end loop;
 end loop;
 plan_sha:=encode(extensions.digest(convert_to(p_plan::text,'UTF8'),'sha256'),'hex');
 perform set_config('metaengine.a2_macroblock_rpc','on',true);
 insert into destruktion_meta.compute_fabric_a2_macroblock_h205f22(workspace_id,macroblock_key,title,start_snapshot_sha256,plan,plan_sha256) values(p_workspace_id,p_macroblock_key,p_title,p_start_snapshot_sha256,p_plan,plan_sha) returning * into mb;
 for n in select value from jsonb_array_elements(p_plan->'nodes') loop
   insert into destruktion_meta.compute_fabric_a2_macroblock_node_h205f22(macroblock_id,node_key,ordinal,milestone_key,execution_class,depends_on,action,hard_gate_after)
   values(mb.macroblock_id,n->>'node_key',(n->>'ordinal')::int,nullif(n->>'milestone_key',''),n->>'execution_class',array(select jsonb_array_elements_text(coalesce(n->'depends_on','[]'::jsonb))),n->'action',coalesce((n->>'hard_gate_after')::boolean,false));
 end loop;
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock.v1','macroblock_id',mb.macroblock_id,'macroblock_key',mb.macroblock_key,'state',mb.state,'plan_sha256',mb.plan_sha256,'start_snapshot_sha256',mb.start_snapshot_sha256,'canonical',false,'authority_effect',false);
end$$;

create or replace function public.h205f22_a2_macroblock_ack_v1(p_macroblock_id uuid,p_agent text,p_plan_sha256 text) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype;
begin
 if p_agent not in('GPT','GLM') then raise exception 'a2_macroblock_agent_invalid'; end if;
 select * into mb from destruktion_meta.compute_fabric_a2_macroblock_h205f22 where macroblock_id=p_macroblock_id for update; if not found then raise exception 'a2_macroblock_not_found'; end if;
 if mb.state<>'ACK_OPEN' then raise exception 'a2_macroblock_ack_closed:%',mb.state; end if;
 if p_plan_sha256 is distinct from mb.plan_sha256 then raise exception 'a2_macroblock_plan_sha_mismatch'; end if;
 if p_agent='GPT' and mb.gpt_ack_sha256 is not null and mb.gpt_ack_sha256<>p_plan_sha256 then raise exception 'a2_macroblock_gpt_ack_conflict'; end if;
 if p_agent='GLM' and mb.glm_ack_sha256 is not null and mb.glm_ack_sha256<>p_plan_sha256 then raise exception 'a2_macroblock_glm_ack_conflict'; end if;
 perform set_config('metaengine.a2_macroblock_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_macroblock_h205f22 set gpt_ack_sha256=case when p_agent='GPT' then p_plan_sha256 else gpt_ack_sha256 end,glm_ack_sha256=case when p_agent='GLM' then p_plan_sha256 else glm_ack_sha256 end where macroblock_id=p_macroblock_id returning * into mb;
 if mb.gpt_ack_sha256 is not null and mb.glm_ack_sha256 is not null then update destruktion_meta.compute_fabric_a2_macroblock_h205f22 set state='SEALED' where macroblock_id=p_macroblock_id returning * into mb; end if;
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock.v1','macroblock_id',mb.macroblock_id,'state',mb.state,'plan_sha256',mb.plan_sha256,'gpt_acked',mb.gpt_ack_sha256 is not null,'glm_acked',mb.glm_ack_sha256 is not null,'canonical',false,'authority_effect',false);
end$$;

create or replace function public.h205f22_a2_macroblock_start_v1(p_macroblock_id uuid) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype;
begin
 select * into mb from destruktion_meta.compute_fabric_a2_macroblock_h205f22 where macroblock_id=p_macroblock_id for update; if not found then raise exception 'a2_macroblock_not_found'; end if;
 if mb.state<>'SEALED' then raise exception 'a2_macroblock_not_sealed:%',mb.state; end if;
 perform set_config('metaengine.a2_macroblock_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_macroblock_h205f22 set state='EXECUTING' where macroblock_id=p_macroblock_id returning * into mb;
 update destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 set state='READY' where macroblock_id=p_macroblock_id and state='PENDING' and cardinality(depends_on)=0;
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock.v1','macroblock_id',mb.macroblock_id,'state',mb.state,'canonical',false,'authority_effect',false);
end$$;

create or replace function public.h205f22_a2_macroblock_read_v1(p_macroblock_id uuid) returns jsonb language plpgsql stable security definer set search_path='pg_catalog','destruktion_meta' as $$
declare mb destruktion_meta.compute_fabric_a2_macroblock_h205f22%rowtype; nodes jsonb;
begin
 select * into mb from destruktion_meta.compute_fabric_a2_macroblock_h205f22 where macroblock_id=p_macroblock_id; if not found then raise exception 'a2_macroblock_not_found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('node_key',node_key,'ordinal',ordinal,'milestone_key',milestone_key,'execution_class',execution_class,'depends_on',depends_on,'action',action,'hard_gate_after',hard_gate_after,'state',state,'executor_binding',executor_binding,'authority_binding',authority_binding,'evidence',evidence,'result_sha256',result_sha256)order by ordinal,node_key),'[]'::jsonb) into nodes from destruktion_meta.compute_fabric_a2_macroblock_node_h205f22 where macroblock_id=p_macroblock_id;
 return jsonb_build_object('schema','metaengine.compute.a2-macroblock.v1','macroblock_id',mb.macroblock_id,'workspace_id',mb.workspace_id,'macroblock_key',mb.macroblock_key,'title',mb.title,'start_snapshot_sha256',mb.start_snapshot_sha256,'plan_sha256',mb.plan_sha256,'plan',mb.plan,'state',mb.state,'gpt_acked',mb.gpt_ack_sha256 is not null,'glm_acked',mb.glm_ack_sha256 is not null,'current_hard_gate',mb.current_hard_gate,'hard_gate_sha256',mb.hard_gate_sha256,'nodes',nodes,'canonical',false,'authority_effect',false);
end$$;
