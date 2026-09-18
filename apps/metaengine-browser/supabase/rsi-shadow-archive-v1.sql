-- METAENGINE RSI V1 durable shadow archive contract.
-- Intentionally rollback-only and outside supabase/migrations.
-- This file defines the storage boundary for branch review; it MUST NOT be
-- treated as deployed production DDL until a separate migration/admission step.

begin;

create table public.compute_fabric_rsi_shadow_candidate_h205f22 (
  candidate_id text primary key check (
    length(candidate_id) between 3 and 128
    and candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
  ),
  parent_sha text not null check (parent_sha ~ '^[0-9a-f]{40}$'),
  candidate_sha text not null check (candidate_sha ~ '^[0-9a-f]{40}$'),
  mutation_surface text not null check (mutation_surface in (
    'PROMPT_ROUTING',
    'AGENT_ORCHESTRATION',
    'TOOL_INTERFACE',
    'BROWSER_RUNTIME',
    'RSI_IMPROVER'
  )),
  hypothesis text,
  state text not null check (state in (
    'PROPOSED',
    'EVALUATING',
    'SHADOW_QUALIFIED',
    'REJECTED',
    'BLOCKED'
  )),
  candidate_digest text not null check (candidate_digest ~ '^[0-9a-f]{64}$'),
  final_digest text check (final_digest is null or final_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  evaluation_started_at timestamptz,
  finalized_at timestamptz,
  shadow_only boolean not null default true check (shadow_only = true),
  execution_authority boolean not null default false check (execution_authority = false),
  production_mutation_authority boolean not null default false check (production_mutation_authority = false),
  promotion_authority boolean not null default false check (promotion_authority = false),
  self_update_authority boolean not null default false check (self_update_authority = false),
  automatic_retry_allowed boolean not null default false check (automatic_retry_allowed = false),
  unique (candidate_sha)
);

create table public.compute_fabric_rsi_shadow_evidence_h205f22 (
  evidence_seq bigint generated always as identity primary key,
  candidate_id text not null references public.compute_fabric_rsi_shadow_candidate_h205f22(candidate_id),
  kind text not null check (kind in ('HARD_INVARIANT','OBJECTIVE')),
  invariant text check (invariant is null or invariant in (
    'NO_DUPLICATE_IRREVERSIBLE_EFFECT',
    'NO_AUTHORITY_VIOLATION',
    'NO_WORKSPACE_ESCAPE',
    'EXACT_SOURCE_IDENTITY',
    'NO_SECURITY_REGRESSION',
    'NO_AMBIGUOUS_EFFECT_RETRY'
  )),
  invariant_result text check (invariant_result is null or invariant_result in ('PASS','FAIL')),
  objective_name text,
  objective_direction text check (objective_direction is null or objective_direction in ('MAXIMIZE','MINIMIZE')),
  baseline_value double precision,
  candidate_value double precision,
  objective_improved boolean,
  evaluator_id text not null,
  evaluator_digest text not null check (evaluator_digest ~ '^[0-9a-f]{64}$'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null,
  authority_effect boolean not null default false check (authority_effect = false),
  check (
    (kind = 'HARD_INVARIANT' and invariant is not null and invariant_result is not null and objective_name is null)
    or
    (kind = 'OBJECTIVE' and invariant is null and invariant_result is null and objective_name is not null)
  )
);

create unique index compute_fabric_rsi_shadow_invariant_once_h205f22
  on public.compute_fabric_rsi_shadow_evidence_h205f22(candidate_id, invariant)
  where kind = 'HARD_INVARIANT';

create unique index compute_fabric_rsi_shadow_objective_once_h205f22
  on public.compute_fabric_rsi_shadow_evidence_h205f22(candidate_id, objective_name)
  where kind = 'OBJECTIVE';

alter table public.compute_fabric_rsi_shadow_candidate_h205f22 enable row level security;
alter table public.compute_fabric_rsi_shadow_evidence_h205f22 enable row level security;

revoke all on public.compute_fabric_rsi_shadow_candidate_h205f22 from public;
revoke all on public.compute_fabric_rsi_shadow_candidate_h205f22 from anon;
revoke all on public.compute_fabric_rsi_shadow_candidate_h205f22 from authenticated;
revoke all on public.compute_fabric_rsi_shadow_evidence_h205f22 from public;
revoke all on public.compute_fabric_rsi_shadow_evidence_h205f22 from anon;
revoke all on public.compute_fabric_rsi_shadow_evidence_h205f22 from authenticated;

-- Even service_role receives no implicit production promotion capability from
-- this contract. Future RPCs must enforce exact candidate/evaluator identity and
-- one-way state transitions before any DDL is promoted from this source file.
grant select on public.compute_fabric_rsi_shadow_candidate_h205f22 to service_role;
grant select on public.compute_fabric_rsi_shadow_evidence_h205f22 to service_role;

rollback;
