-- METAENGINE Sovereign Browser Compute Fabric: append-only Event/Effect Ledger pilot.
-- SOURCE-ONLY migration. Production rollout requires separate dry-run catalog diff,
-- direct-connection proof, rollback SQL, and smoke tests.

begin;

create table if not exists public.devos_effect_event_v1 (
  ledger_sequence bigint generated always as identity primary key,
  effect_id uuid not null,
  event_type text not null check (event_type in ('INTENT','CAPABILITY','ATTEMPT','READBACK','OUTCOME')),
  effect_domain text not null check (length(effect_domain) between 1 and 96),
  effect_generation bigint not null check (effect_generation > 0),
  idempotency_key text not null check (length(idempotency_key) between 1 and 256),
  plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),
  policy_hash text not null check (policy_hash ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  inserted_at timestamptz not null default clock_timestamp()
);

comment on table public.devos_effect_event_v1 is
  'Append-only causal event/effect ledger. Queue delivery is not authority; reducers reconstruct projections.';

create unique index if not exists devos_effect_event_v1_one_intent
  on public.devos_effect_event_v1(effect_id)
  where event_type = 'INTENT';

create unique index if not exists devos_effect_event_v1_one_attempt
  on public.devos_effect_event_v1(effect_id)
  where event_type = 'ATTEMPT';

create index if not exists devos_effect_event_v1_effect_order
  on public.devos_effect_event_v1(effect_id, ledger_sequence);

create index if not exists devos_effect_event_v1_correlation_order
  on public.devos_effect_event_v1(correlation_id, ledger_sequence);

create or replace function public.devos_effect_event_v1_forbid_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'devos_effect_event_v1_append_only';
end;
$$;

revoke all on function public.devos_effect_event_v1_forbid_mutation() from public, anon, authenticated;
grant execute on function public.devos_effect_event_v1_forbid_mutation() to service_role;

drop trigger if exists devos_effect_event_v1_append_only on public.devos_effect_event_v1;
create trigger devos_effect_event_v1_append_only
before update or delete on public.devos_effect_event_v1
for each row execute function public.devos_effect_event_v1_forbid_mutation();

alter table public.devos_effect_event_v1 enable row level security;
alter table public.devos_effect_event_v1 force row level security;
revoke all on table public.devos_effect_event_v1 from public, anon, authenticated;
grant select, insert on table public.devos_effect_event_v1 to service_role;
grant usage, select on sequence public.devos_effect_event_v1_ledger_sequence_seq to service_role;

create table if not exists public.devos_effect_delivery_outbox_v1 (
  outbox_id bigint generated always as identity primary key,
  effect_id uuid not null,
  correlation_id uuid not null,
  available_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  publish_attempts integer not null default 0 check (publish_attempts >= 0),
  created_at timestamptz not null default clock_timestamp(),
  check (published_at is null or published_at >= created_at)
);

comment on table public.devos_effect_delivery_outbox_v1 is
  'Durable delivery projection containing effect_id only; it conveys no execution authority.';

create unique index if not exists devos_effect_delivery_outbox_v1_effect
  on public.devos_effect_delivery_outbox_v1(effect_id);

alter table public.devos_effect_delivery_outbox_v1 enable row level security;
alter table public.devos_effect_delivery_outbox_v1 force row level security;
revoke all on table public.devos_effect_delivery_outbox_v1 from public, anon, authenticated;
grant select, insert, update on table public.devos_effect_delivery_outbox_v1 to service_role;
grant usage, select on sequence public.devos_effect_delivery_outbox_v1_outbox_id_seq to service_role;

create or replace view public.devos_effect_projection_v1
with (security_invoker = true)
as
select distinct on (effect_id)
  effect_id,
  effect_domain,
  effect_generation,
  idempotency_key,
  plan_digest,
  policy_hash,
  correlation_id,
  event_type as latest_event_type,
  ledger_sequence as latest_ledger_sequence,
  occurred_at as latest_occurred_at,
  payload as latest_payload
from public.devos_effect_event_v1
order by effect_id, ledger_sequence desc;

revoke all on public.devos_effect_projection_v1 from public, anon, authenticated;
grant select on public.devos_effect_projection_v1 to service_role;

-- No PUBLIC RPC and no queue payload beyond effect_id/correlation metadata.
-- Physical execution still requires exact capability verification plus current
-- readback at the actuator boundary.

commit;
