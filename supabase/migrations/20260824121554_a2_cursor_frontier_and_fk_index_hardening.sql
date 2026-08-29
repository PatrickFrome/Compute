-- A2 cursor/frontier consistency and advisor-driven FK index hardening.

create index if not exists compute_fabric_a2_event_session_idx
  on destruktion_meta.compute_fabric_a2_agent_event_h205f22(session_id);
create index if not exists compute_fabric_a2_event_visibility_proof_idx
  on destruktion_meta.compute_fabric_a2_agent_event_h205f22(visibility_proof_id)
  where visibility_proof_id is not null;
create index if not exists compute_fabric_a2_ingress_consumed_event_idx
  on destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22(consumed_event_id)
  where consumed_event_id is not null;
create index if not exists compute_fabric_a2_cursor_session_idx
  on destruktion_meta.compute_fabric_a2_peer_cursor_h205f22(session_id);
create index if not exists compute_fabric_a2_proof_accepted_event_idx
  on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22(accepted_event_id)
  where accepted_event_id is not null;
create index if not exists compute_fabric_a2_proof_session_idx
  on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22(session_id);
create index if not exists compute_fabric_a2_proof_workspace_idx
  on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22(workspace_id);

create or replace function public.h205f22_a2_read_frontier_at_v1(
  p_workspace_id uuid,
  p_through_commit_seq bigint
) returns jsonb
language sql
security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
with lim as (
  select greatest(coalesce(p_through_commit_seq,0),0) through_seq
), h as (
  select coalesce(max(commit_seq),0) head_commit_seq,
         coalesce(max(agent_seq) filter(where agent='GPT'),0) gpt_seq,
         coalesce(max(agent_seq) filter(where agent='GLM'),0) glm_seq
  from destruktion_meta.compute_fabric_a2_agent_event_h205f22,lim
  where workspace_id=p_workspace_id and commit_seq<=lim.through_seq
), gh as (
  select event_hash from destruktion_meta.compute_fabric_a2_agent_event_h205f22,lim
  where workspace_id=p_workspace_id and agent='GPT' and commit_seq<=lim.through_seq
  order by agent_seq desc limit 1
), lh as (
  select event_hash from destruktion_meta.compute_fabric_a2_agent_event_h205f22,lim
  where workspace_id=p_workspace_id and agent='GLM' and commit_seq<=lim.through_seq
  order by agent_seq desc limit 1
)
select jsonb_build_object(
  'schema','metaengine.compute.a2-frontier-at.v1',
  'workspace_id',p_workspace_id,
  'through_commit_seq',(select through_seq from lim),
  'head_commit_seq',h.head_commit_seq,
  'gpt_seq',h.gpt_seq,
  'glm_seq',h.glm_seq,
  'gpt_hash',(select event_hash from gh),
  'glm_hash',(select event_hash from lh),
  'frontier_hash',encode(extensions.digest(convert_to(jsonb_build_object(
    'workspace_id',p_workspace_id::text,
    'head_commit_seq',h.head_commit_seq,
    'gpt_seq',h.gpt_seq,
    'glm_seq',h.glm_seq,
    'gpt_hash',(select event_hash from gh),
    'glm_hash',(select event_hash from lh)
  )::text,'UTF8'),'sha256'),'hex'),
  'canonical',false,
  'authority_effect',false
) from h
$$;

create or replace function public.h205f22_a2_update_cursor_v1(
  p_session_id uuid,
  p_last_received_commit_seq bigint,
  p_last_applied_commit_seq bigint,
  p_causal_frontier_hash text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare
  s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  max_commit bigint;
  expected_frontier jsonb;
  prior destruktion_meta.compute_fabric_a2_peer_cursor_h205f22%rowtype;
begin
  select * into s
  from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where session_id=p_session_id and status='ACTIVE';
  if not found then raise exception 'a2_session_not_active'; end if;

  select coalesce(max(commit_seq),0) into max_commit
  from destruktion_meta.compute_fabric_a2_agent_event_h205f22
  where workspace_id=s.workspace_id;

  if p_last_received_commit_seq<0 or p_last_applied_commit_seq<0
     or p_last_applied_commit_seq>p_last_received_commit_seq
     or p_last_received_commit_seq>max_commit then
    raise exception 'a2_cursor_invalid';
  end if;

  select * into prior
  from destruktion_meta.compute_fabric_a2_peer_cursor_h205f22
  where workspace_id=s.workspace_id and session_id=s.session_id;
  if found and (p_last_received_commit_seq<prior.last_received_commit_seq
                or p_last_applied_commit_seq<prior.last_applied_commit_seq) then
    raise exception 'a2_cursor_regression';
  end if;

  expected_frontier:=public.h205f22_a2_read_frontier_at_v1(s.workspace_id,p_last_applied_commit_seq);
  if p_causal_frontier_hash<>(expected_frontier->>'frontier_hash') then
    raise exception 'a2_cursor_frontier_mismatch';
  end if;

  perform set_config('metaengine.a2_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_peer_cursor_h205f22(
    workspace_id,session_id,agent,last_received_commit_seq,last_applied_commit_seq,causal_frontier_hash,updated_at
  ) values (
    s.workspace_id,s.session_id,s.agent,p_last_received_commit_seq,p_last_applied_commit_seq,p_causal_frontier_hash,clock_timestamp()
  ) on conflict(workspace_id,session_id) do update
    set last_received_commit_seq=excluded.last_received_commit_seq,
        last_applied_commit_seq=excluded.last_applied_commit_seq,
        causal_frontier_hash=excluded.causal_frontier_hash,
        updated_at=excluded.updated_at;

  return jsonb_build_object(
    'schema','metaengine.compute.a2-peer-cursor.v1',
    'session_id',s.session_id,
    'workspace_id',s.workspace_id,
    'last_received_commit_seq',p_last_received_commit_seq,
    'last_applied_commit_seq',p_last_applied_commit_seq,
    'causal_frontier_hash',p_causal_frontier_hash,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_a2_read_frontier_at_v1(uuid,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_a2_read_frontier_at_v1(uuid,bigint) to service_role;
