-- METAENGINE H205F22 development gate policy.
-- GATE_DISABLE_ALL_DEV makes noncritical development gates advisory only.
-- Hard safety/authority gates remain enforced and cannot be disabled by this policy.

create table if not exists public.compute_fabric_development_gate_policy_h205f22 (
  workspace_id uuid primary key,
  mode text not null,
  scope text not null default 'DEVELOPMENT_ONLY',
  noncritical_gate_mode text not null,
  hard_safety_mode text not null,
  policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false,
  constraint development_gate_policy_mode_ck check (mode in ('DEFAULT','GATE_DISABLE_ALL_DEV')),
  constraint development_gate_policy_scope_ck check (scope = 'DEVELOPMENT_ONLY'),
  constraint development_gate_policy_noncritical_ck check (noncritical_gate_mode in ('ENFORCED','ADVISORY')),
  constraint development_gate_policy_hard_safety_ck check (hard_safety_mode = 'ENFORCED'),
  constraint development_gate_policy_json_ck check (jsonb_typeof(policy) = 'object' and octet_length(policy::text) <= 32768),
  constraint development_gate_policy_authority_effect_ck check (authority_effect = false)
);

insert into public.compute_fabric_development_gate_policy_h205f22(
  workspace_id, mode, scope, noncritical_gate_mode, hard_safety_mode, policy, updated_at, authority_effect
) values (
  '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid,
  'GATE_DISABLE_ALL_DEV',
  'DEVELOPMENT_ONLY',
  'ADVISORY',
  'ENFORCED',
  jsonb_build_object(
    'schema','metaengine.development-gate-policy.v1',
    'disabled_noncritical_gate_classes',jsonb_build_array(
      'QUALITY_THRESHOLD','STYLE_LINT','DUPLICATION_THRESHOLD','OPTIONAL_REVIEW','OPTIONAL_BENCHMARK',
      'OPTIONAL_RESEARCH','ROADMAP_DEPENDENCY_HOLD','CANARY_DURATION','NONCRITICAL_ROLLOUT_HOLD','OPTIONAL_CI'
    ),
    'hard_gate_classes',jsonb_build_array(
      'TYPED_COMMAND_ONLY','ONE_RESOURCE_ONE_ACTUATION_LEASE','NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT',
      'EXACT_TARGET_PROCESS_TAB_INCARNATION_BINDING','SECRET_BOUNDARIES','PAGE_MODEL_WEBMCP_ZERO_AUTHORITY',
      'NO_ARBITRARY_EVAL','DURABLE_PRE_EFFECT_RECORD','LIVE_REVALIDATION_BEFORE_ACTUATION',
      'MAIN_PRODUCTION_IRREVERSIBLE_EFFECT_AUTHORIZATION'
    ),
    'parallel_development_allowed',true,
    'branch_local_implementation_allowed',true,
    'noncritical_failure_blocks_development',false,
    'main_or_production_promotion_unchanged',true,
    'authority_effect',false
  ),
  clock_timestamp(),
  false
)
on conflict (workspace_id) do update set
  mode = excluded.mode,
  scope = excluded.scope,
  noncritical_gate_mode = excluded.noncritical_gate_mode,
  hard_safety_mode = 'ENFORCED',
  policy = excluded.policy,
  updated_at = clock_timestamp(),
  authority_effect = false;

create or replace function public.h205f22_development_gate_policy_v1()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'schema','metaengine.development-gate-policy.v1',
    'workspace_id',workspace_id,
    'mode',mode,
    'scope',scope,
    'noncritical_gate_mode',noncritical_gate_mode,
    'hard_safety_mode',hard_safety_mode,
    'policy',policy,
    'updated_at',updated_at,
    'authority_effect',false
  )
  from public.compute_fabric_development_gate_policy_h205f22
  where workspace_id = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
$$;

revoke all on table public.compute_fabric_development_gate_policy_h205f22 from public;
revoke all on function public.h205f22_development_gate_policy_v1() from public;

comment on table public.compute_fabric_development_gate_policy_h205f22 is
'Authoritative development-only gate policy. GATE_DISABLE_ALL_DEV converts noncritical gates to advisory while hard safety/authority gates remain enforced.';
