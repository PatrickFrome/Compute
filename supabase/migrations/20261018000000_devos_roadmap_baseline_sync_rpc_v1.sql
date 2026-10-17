-- DEVOS roadmap baseline push-sync RPCs v1 (read + commit).
--
-- The edge function supabase/functions/metaengine-devos-baseline-push-sync-h205f22/index.ts
-- calls two RPCs that existed nowhere in the migration chain (they are only listed as
-- FREEZE "legacy cycle; DEPRECATED" entries in sql/0002-rpc-registry.sql). This migration
-- closes that gap so the edge function has its backing SQL surface on a fresh project.
--
-- Contract extracted verbatim from the edge function (task 10-b2):
--   read  : select public.devos_roadmap_baseline_sync_read_v1() as result
--           The edge parser reads only result?.baseline_sha (must match 40-hex),
--           result?.source_repo (must equal "PatrickFrome/Compute") and
--           result?.source_branch (must equal "integration/metaengine-development-os-v1").
--           Any other shape -> the edge function raises
--           roadmap_authority_readback_invalid and fails closed with HTTP 403.
--   commit: select public.devos_roadmap_baseline_sync_commit_v1(
--             <expected>::text, <candidate>::text, <proof>::jsonb) as result
--           The edge function calls it only after proving, against the GitHub compare
--           API, that candidate is exactly one fast-forward ahead of expected
--           (status='ahead', merge_base=base=expected, head=candidate). The proof jsonb
--           fields it sends: schema, source_repo, source_branch, base_sha, merge_base_sha,
--           branch_head_sha, head_sha, compare_status, observed_at, proof_source,
--           github_run_id, github_run_attempt, github_actor_id, github_oidc_jti,
--           caller_candidate_ignored, authority_effect. The returned jsonb is spread
--           into the HTTP 200 body (null or any object is handled gracefully).
--
-- Backing schema (already created by 20260929133000, canonical migration-chain shape):
--   destruktion_meta.metaengine_devos_roadmap_authority_h205f22(
--     authority_key text primary key, roadmap_id text unique, active_milestone_key,
--     integration_line, baseline_sha 40-hex, alignment_epoch bigint, updated_at,
--     authority_effect boolean=false)
--   Row convention: authority_key='METAENGINE_DEVOS' AND
--   integration_line='integration/metaengine-development-os-v1' — exactly the row the
--   READY base-drift fence trigger (20260902182000) binds to, so advancing the baseline
--   through commit_v1 also drives the existing drift fence by design.
--
-- Documented ambiguity decisions (fail-closed, task 10-b2):
--   * The authority table stores no source_repo column. The GitHub repository binding is
--     already enforced upstream by the edge function's OIDC claims (repository,
--     repository_id, repository_owner_id, sub, workflow_ref, event_name, visibility), so
--     the read RPC returns the pinned constant 'PatrickFrome/Compute' and the commit RPC
--     refuses proofs whose source_repo/source_branch do not match the pinned constants.
--   * read_v1 never throws: when the authority row is absent or unshaped it returns an
--     explicit available=false object. The edge parser treats any object without a SHA40
--     baseline_sha as roadmap_authority_readback_invalid (HTTP 403, fail closed).
--   * commit_v1 is update-only: without a pre-seeded authority row nothing can advance
--     the baseline. Seeding the initial row is an operator action (no bootstrap from an
--     empty state is exposed on the wire).
--   * Idempotency key: github_oidc_jti — the unique JWT ID of the GitHub Actions OIDC
--     token (edge function validates 8..512 chars). Every commit outcome is recorded in
--     destruktion_meta.devos_roadmap_baseline_sync_log_h205f22 keyed by that jti, so a
--     replayed run returns its recorded result instead of re-advancing the baseline.
--     A jti replay with a different expected/candidate pair is a hard collision (22023).
--
-- The RPCs carry no scheduler, lease, retry, release or browser authority: they only
-- advance one text pointer (baseline_sha) of one authority row and emit no task effects.

create table if not exists destruktion_meta.devos_roadmap_baseline_sync_log_h205f22 (
  github_oidc_jti text primary key
    constraint devos_baseline_sync_jti_ck check (char_length(github_oidc_jti) between 8 and 512),
  expected_sha text not null
    constraint devos_baseline_sync_expected_ck check (expected_sha ~ '^[0-9a-f]{40}$'),
  candidate_sha text not null
    constraint devos_baseline_sync_candidate_ck check (candidate_sha ~ '^[0-9a-f]{40}$'),
  proof jsonb not null,
  result jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false
    constraint devos_baseline_sync_authority_effect_ck check (authority_effect = false),
  constraint devos_baseline_sync_proof_schema_ck check (proof->>'schema' = 'metaengine.devos.github-baseline-proof.v1')
);

alter table destruktion_meta.devos_roadmap_baseline_sync_log_h205f22 enable row level security;
revoke all on table destruktion_meta.devos_roadmap_baseline_sync_log_h205f22
  from public, anon, authenticated;

comment on table destruktion_meta.devos_roadmap_baseline_sync_log_h205f22 is
  'Idempotency ledger for public.devos_roadmap_baseline_sync_commit_v1, keyed by the GitHub OIDC jti of the calling workflow run. Records every commit outcome (advance, replay, already-current, moved-baseline refusal) so replays return their recorded result. Grants no scheduler, lease, retry or browser authority.';

create or replace function public.devos_roadmap_baseline_sync_read_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row destruktion_meta.metaengine_devos_roadmap_authority_h205f22%rowtype;
begin
  select *
    into v_row
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where authority_key = 'METAENGINE_DEVOS'
     and integration_line = 'integration/metaengine-development-os-v1'
   order by updated_at desc
   limit 1;

  if not found
     or v_row.baseline_sha is null
     or v_row.baseline_sha !~ '^[0-9a-f]{40}$' then
    -- Explicit unavailable shape: the edge parser requires a 40-hex baseline_sha and
    -- fails closed (roadmap_authority_readback_invalid) on anything else. It never
    -- advances without a seeded authority row.
    return jsonb_build_object(
      'schema','metaengine.devos.roadmap-baseline-authority.v1',
      'available',false,
      'source_repo','PatrickFrome/Compute',
      'source_branch','integration/metaengine-development-os-v1',
      'baseline_sha',null::text,
      'reason','ROADMAP_AUTHORITY_ROW_UNAVAILABLE',
      'authority_effect',false
    );
  end if;

  return jsonb_build_object(
    'schema','metaengine.devos.roadmap-baseline-authority.v1',
    'available',true,
    'source_repo','PatrickFrome/Compute',
    'source_branch','integration/metaengine-development-os-v1',
    'roadmap_id',v_row.roadmap_id,
    'active_milestone_key',v_row.active_milestone_key,
    'integration_line',v_row.integration_line,
    'baseline_sha',v_row.baseline_sha,
    'alignment_epoch',v_row.alignment_epoch,
    'updated_at',v_row.updated_at,
    'authority_effect',false
  );
end;
$function$;

create or replace function public.devos_roadmap_baseline_sync_commit_v1(
  p_expected_sha text,
  p_candidate_sha text,
  p_proof jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected text := lower(coalesce(p_expected_sha,''));
  v_candidate text := lower(coalesce(p_candidate_sha,''));
  v_proof jsonb := p_proof;
  v_jti text;
  v_log destruktion_meta.devos_roadmap_baseline_sync_log_h205f22%rowtype;
  v_row destruktion_meta.metaengine_devos_roadmap_authority_h205f22%rowtype;
  v_result jsonb;
begin
  -- Shape validation before any state is touched.
  if v_expected !~ '^[0-9a-f]{40}$' then
    raise exception 'baseline_sync_expected_sha_invalid';
  end if;
  if v_candidate !~ '^[0-9a-f]{40}$' then
    raise exception 'baseline_sync_candidate_sha_invalid';
  end if;
  if v_proof is null or jsonb_typeof(v_proof) <> 'object' then
    raise exception 'baseline_sync_proof_invalid';
  end if;
  if v_proof->>'schema' <> 'metaengine.devos.github-baseline-proof.v1' then
    raise exception 'baseline_sync_proof_schema_invalid';
  end if;
  if v_proof->>'proof_source' <> 'GITHUB_OIDC_PUSH_SHA_PLUS_COMPARE_V1' then
    raise exception 'baseline_sync_proof_source_invalid';
  end if;
  if v_proof->>'source_repo' is distinct from 'PatrickFrome/Compute'
     or v_proof->>'source_branch' is distinct from 'integration/metaengine-development-os-v1' then
    raise exception 'baseline_sync_source_binding_invalid';
  end if;
  -- CAS fence mirrors the edge function proof guard exactly: the caller must present the
  -- same expected/candidate pair it proved fast-forward for on the GitHub compare API.
  if v_proof->>'base_sha' is distinct from v_expected
     or v_proof->>'merge_base_sha' is distinct from v_expected
     or v_proof->>'branch_head_sha' is distinct from v_candidate
     or v_proof->>'head_sha' is distinct from v_candidate then
    raise exception 'baseline_sync_proof_sha_mismatch';
  end if;
  if v_proof->>'compare_status' is distinct from 'ahead' then
    raise exception 'baseline_sync_compare_not_fast_forward';
  end if;
  if coalesce(v_proof->>'caller_candidate_ignored','') is distinct from 'true'
     or coalesce(v_proof->>'authority_effect','') is distinct from 'false' then
    raise exception 'baseline_sync_proof_authority_invalid';
  end if;

  v_jti := coalesce(nullif(trim(coalesce(v_proof->>'github_oidc_jti','')),''),'');
  if char_length(v_jti) < 8 or char_length(v_jti) > 512 then
    raise exception 'baseline_sync_jti_invalid';
  end if;

  -- Serialize concurrent commits for this sync plane, then re-check idempotency inside
  -- the lock so two parallel runs sharing a jti cannot double-advance or race the CAS.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('metaengine:devos-roadmap-baseline-sync:v1',0));

  select *
    into v_log
    from destruktion_meta.devos_roadmap_baseline_sync_log_h205f22
   where github_oidc_jti = v_jti;
  if found then
    if v_log.expected_sha is distinct from v_expected
       or v_log.candidate_sha is distinct from v_candidate then
      raise exception 'baseline_sync_idempotency_collision' using errcode = '22023';
    end if;
    return v_log.result || jsonb_build_object('replayed',true);
  end if;

  select *
    into v_row
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where authority_key = 'METAENGINE_DEVOS'
     and integration_line = 'integration/metaengine-development-os-v1'
   order by updated_at desc
   limit 1
   for update;

  if not found
     or v_row.baseline_sha is null
     or v_row.baseline_sha !~ '^[0-9a-f]{40}$' then
    -- Fail closed: seeding the initial authority row is an operator action; this wire
    -- surface never bootstraps a baseline from nothing.
    raise exception 'baseline_sync_authority_missing';
  end if;

  if v_row.baseline_sha = v_candidate then
    -- Another runner already advanced the baseline to this candidate between the edge
    -- function read and this commit: report already-current without re-advancing.
    v_result := jsonb_build_object(
      'schema','metaengine.devos.baseline-push-sync-observation.v1',
      'advanced',false,
      'reason','ALREADY_CURRENT',
      'baseline_sha',v_row.baseline_sha,
      'candidate_sha',v_candidate,
      'github_oidc_jti',v_jti,
      'polling_fallback_preserved',true,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
    insert into destruktion_meta.devos_roadmap_baseline_sync_log_h205f22(
      github_oidc_jti,expected_sha,candidate_sha,proof,result,authority_effect)
    values (v_jti,v_expected,v_candidate,v_proof,v_result,false)
    on conflict (github_oidc_jti) do nothing;
    return v_result;
  end if;

  if v_row.baseline_sha <> v_expected then
    -- The stored baseline moved underneath the proven fast-forward pair: refuse and
    -- record the refusal so a replayed run gets the same bounded answer.
    v_result := jsonb_build_object(
      'schema','metaengine.devos.baseline-push-sync-observation.v1',
      'advanced',false,
      'reason','BASELINE_MOVED',
      'baseline_sha',v_row.baseline_sha,
      'expected_sha',v_expected,
      'candidate_sha',v_candidate,
      'github_oidc_jti',v_jti,
      'polling_fallback_preserved',true,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
    insert into destruktion_meta.devos_roadmap_baseline_sync_log_h205f22(
      github_oidc_jti,expected_sha,candidate_sha,proof,result,authority_effect)
    values (v_jti,v_expected,v_candidate,v_proof,v_result,false)
    on conflict (github_oidc_jti) do nothing;
    return v_result;
  end if;

  -- Proven fast-forward: advance the single baseline pointer. The AFTER UPDATE trigger
  -- devos_fence_ready_base_drift_h205f22 (20260902182000) fences stale READY tasks.
  update destruktion_meta.metaengine_devos_roadmap_authority_h205f22
     set baseline_sha = v_candidate,
         alignment_epoch = alignment_epoch + 1,
         updated_at = clock_timestamp()
   where authority_key = v_row.authority_key
     and integration_line = v_row.integration_line
   returning * into v_row;

  v_result := jsonb_build_object(
    'schema','metaengine.devos.baseline-push-sync-observation.v1',
    'advanced',true,
    'accepted',true,
    'replayed',false,
    'baseline_sha',v_candidate,
    'prior_baseline_sha',v_expected,
    'candidate_sha',v_candidate,
    'roadmap_id',v_row.roadmap_id,
    'alignment_epoch',v_row.alignment_epoch,
    'proof_source',v_proof->>'proof_source',
    'github_run_id',v_proof->>'github_run_id',
    'github_run_attempt',v_proof->>'github_run_attempt',
    'github_actor_id',v_proof->>'github_actor_id',
    'github_oidc_jti',v_jti,
    'observed_at',v_proof->>'observed_at',
    'polling_fallback_preserved',true,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );

  insert into destruktion_meta.devos_roadmap_baseline_sync_log_h205f22(
    github_oidc_jti,expected_sha,candidate_sha,proof,result,authority_effect)
  values (v_jti,v_expected,v_candidate,v_proof,v_result,false)
  on conflict (github_oidc_jti) do nothing;

  return v_result;
end;
$function$;

revoke all on function public.devos_roadmap_baseline_sync_read_v1()
  from public, anon, authenticated;
revoke all on function public.devos_roadmap_baseline_sync_commit_v1(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.devos_roadmap_baseline_sync_read_v1()
  to service_role;
grant execute on function public.devos_roadmap_baseline_sync_commit_v1(text,text,jsonb)
  to service_role;

comment on function public.devos_roadmap_baseline_sync_read_v1() is
  'Reads the current DEVOS roadmap baseline authority (row authority_key=METAENGINE_DEVOS, integration_line=integration/metaengine-development-os-v1) for the baseline push-sync edge function. Returns source_repo/source_branch/baseline_sha or an explicit available=false object that the caller fails closed on. No scheduler, lease, retry or browser authority.';

comment on function public.devos_roadmap_baseline_sync_commit_v1(text,text,jsonb) is
  'Advance-only CAS commit of a GitHub-proven fast-forward baseline advance: persists candidate_sha into the DEVOS roadmap authority row, bumps alignment_epoch, records the outcome under the caller OIDC jti for idempotent replay, and refuses moved baselines or unproven shapes. The READY base-drift fence trigger reacts to the baseline_sha update by design. No scheduler, lease, retry or browser authority.';
