create table if not exists destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22(
  duel_id uuid primary key references destruktion_meta.compute_fabric_duel_session_h205f22(duel_id) on delete cascade,
  registered_by text not null,
  registered_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check(canonical is false),
  authority_effect boolean not null default false check(authority_effect is false)
);

revoke all on destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22 from public, anon, authenticated, service_role;

create or replace function destruktion_meta.compute_fabric_duel_autonomous_peer_register_after_insert_h205f()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $$
begin
  if coalesce((new.subject->>'peer_relay')::boolean,false) is true
     and new.subject->>'debate_protocol'='SAME_POINT_DUEL_V4'
     and coalesce((new.subject->>'autonomous_peer_completion')::boolean,true) is true
     and coalesce(new.subject->>'mode','') not like 'PROBE%'
     and new.subject->'peer_identities'->>'GPT'='chatgpt:gpt-5.6-sol'
     and new.subject->'peer_identities'->>'GLM'='glm:5.3' then
    insert into destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22(duel_id,registered_by)
    values(new.duel_id,'AUTO_ON_CREATE_V1')
    on conflict (duel_id) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists compute_fabric_duel_autonomous_peer_register_after_insert_h205f on destruktion_meta.compute_fabric_duel_session_h205f22;
create trigger compute_fabric_duel_autonomous_peer_register_after_insert_h205f
after insert on destruktion_meta.compute_fabric_duel_session_h205f22
for each row execute function destruktion_meta.compute_fabric_duel_autonomous_peer_register_after_insert_h205f();

create or replace function public.h205f22_duel_list_peer_relay_pending_v4(p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  items jsonb;
  head jsonb;
  head_checkpoint text;
  head_root text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 32 then
    raise exception 'peer_relay_pending_limit_out_of_range';
  end if;

  head := destruktion_meta.compute_fabric_roadmap_status_h205f22()->'semantic_head';
  head_checkpoint := head->>'checkpoint_id';
  head_root := head->>'payload_root_sha256';
  if head_checkpoint is null or head_root is null then raise exception 'semantic_head_unavailable'; end if;

  select coalesce(jsonb_agg(q.context order by q.created_at), '[]'::jsonb)
  into items
  from (
    select d.created_at,
      jsonb_build_object(
        'duel_id',d.duel_id,
        'duel_key',d.duel_key,
        'milestone_key',d.milestone_key,
        'base_github_sha',d.base_github_sha,
        'semantic_checkpoint_id',d.semantic_checkpoint_id,
        'semantic_payload_root_sha256',d.semantic_payload_root_sha256,
        'subject',d.subject,
        'peer_identities',d.subject->'peer_identities',
        'relay',public.h205f22_duel_read_peer_relay_v4(d.duel_id),
        'registration',jsonb_build_object('registered_by',a.registered_by,'registered_at',a.registered_at),
        'canonical',false,
        'authority_effect',false
      ) as context
    from destruktion_meta.compute_fabric_duel_session_h205f22 d
    join destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22 a using(duel_id)
    where coalesce((d.subject->>'peer_relay')::boolean,false) is true
      and d.subject->>'debate_protocol'='SAME_POINT_DUEL_V4'
      and d.subject->'peer_identities'->>'GPT'='chatgpt:gpt-5.6-sol'
      and d.subject->'peer_identities'->>'GLM'='glm:5.3'
      and d.semantic_checkpoint_id=head_checkpoint
      and d.semantic_payload_root_sha256=head_root
      and d.current_tick in (0,1)
      and d.status='BLOCKED'
      and not exists (select 1 from destruktion_meta.compute_fabric_duel_decision_h205f22 x where x.duel_id=d.duel_id)
      and (
        select count(*) from destruktion_meta.compute_fabric_duel_peer_submission_h205f22 s
        where s.duel_id=d.duel_id
          and s.wave=(case when d.current_tick=0 then 'PROPOSE' else 'REBUT' end)
      ) < 2
    order by d.created_at
    limit p_limit
  ) q;

  return jsonb_build_object(
    'schema','metaengine.compute.same-point-peer-relay-autonomous-context.h205f22.v2',
    'semantic_checkpoint_id',head_checkpoint,
    'semantic_payload_root_sha256',head_root,
    'items',items,
    'pending_payload_visibility','HIDDEN_UNTIL_ATOMIC_PAIR',
    'canonical',false,
    'authority_effect',false
  );
end
$$;

revoke all on function public.h205f22_duel_list_peer_relay_pending_v4(integer) from public, anon, authenticated;
grant execute on function public.h205f22_duel_list_peer_relay_pending_v4(integer) to service_role;
