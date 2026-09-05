-- METAENGINE Sovereign Browser Compute Fabric: Event/Effect Ledger staging pilot.
--
-- ENGINE-NEUTRAL / STAGING-ONLY SOURCE CONTRACT.
-- This file is intentionally outside supabase/migrations. Do not apply to the
-- production project from CI. First apply to an isolated development branch,
-- replay fixtures, compare projections with existing journals, benchmark, then
-- graduate a separately reviewed migration.
--
-- Queue/outbox invariant: delivery carries only effect_id + immutable event
-- identity. It never grants authority. Existing Guardian domain journals remain
-- the effect boundary during the strangler migration.

begin;

create table if not exists destruktion_meta.browser_fabric_effect_event_v1 (
  event_seq bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid(),
  effect_id text not null,
  effect_domain text not null,
  event_type text not null,
  effect_sequence bigint not null,
  previous_event_sha256 text,
  event_sha256 text not null,
  occurred_at timestamptz not null,
  material jsonb not null,
  reducer_version text not null,
  authority_effect boolean not null default false,
  inserted_at timestamptz not null default clock_timestamp(),
  constraint browser_fabric_event_id_unique unique (event_id),
  constraint browser_fabric_event_sha_unique unique (event_sha256),
  constraint browser_fabric_effect_sequence_unique unique (effect_id, effect_sequence),
  constraint browser_fabric_event_sha_shape check (event_sha256 ~ '^[0-9a-f]{64}$'),
  constraint browser_fabric_previous_sha_shape check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  constraint browser_fabric_effect_id_shape check (effect_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$'),
  constraint browser_fabric_domain_shape check (effect_domain ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint browser_fabric_event_type check (event_type in ('INTENT','CAPABILITY','ATTEMPT','READBACK','OUTCOME')),
  constraint browser_fabric_effect_sequence_positive check (effect_sequence > 0),
  constraint browser_fabric_authority_effect_false check (authority_effect = false),
  constraint browser_fabric_material_object check (jsonb_typeof(material) = 'object')
);

-- One causal intent/capability/attempt/outcome per effect. Multiple independent
-- readbacks are allowed so ambiguity can be reconciled without replay.
create unique index if not exists browser_fabric_one_intent_v1
  on destruktion_meta.browser_fabric_effect_event_v1(effect_id)
  where event_type = 'INTENT';
create unique index if not exists browser_fabric_one_capability_v1
  on destruktion_meta.browser_fabric_effect_event_v1(effect_id)
  where event_type = 'CAPABILITY';
create unique index if not exists browser_fabric_one_attempt_v1
  on destruktion_meta.browser_fabric_effect_event_v1(effect_id)
  where event_type = 'ATTEMPT';
create unique index if not exists browser_fabric_one_outcome_v1
  on destruktion_meta.browser_fabric_effect_event_v1(effect_id)
  where event_type = 'OUTCOME';
create index if not exists browser_fabric_effect_readback_v1
  on destruktion_meta.browser_fabric_effect_event_v1(effect_id, event_seq)
  where event_type = 'READBACK';

create table if not exists destruktion_meta.browser_fabric_effect_outbox_v1 (
  outbox_seq bigint generated always as identity primary key,
  event_id uuid not null,
  effect_id text not null,
  event_sha256 text not null,
  available_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  archived_at timestamptz,
  delivery_count integer not null default 0,
  authority_effect boolean not null default false,
  constraint browser_fabric_outbox_event_unique unique (event_id),
  constraint browser_fabric_outbox_event_sha_unique unique (event_sha256),
  constraint browser_fabric_outbox_count_nonnegative check (delivery_count >= 0),
  constraint browser_fabric_outbox_authority_effect_false check (authority_effect = false),
  constraint browser_fabric_outbox_event_fk foreign key (event_id)
    references destruktion_meta.browser_fabric_effect_event_v1(event_id) on delete restrict
);

create or replace function destruktion_meta.browser_fabric_effect_event_append_only_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, destruktion_meta
as $$
begin
  raise exception 'browser_fabric_effect_event_append_only';
end;
$$;

drop trigger if exists browser_fabric_effect_event_no_update_delete_v1
  on destruktion_meta.browser_fabric_effect_event_v1;
create trigger browser_fabric_effect_event_no_update_delete_v1
before update or delete on destruktion_meta.browser_fabric_effect_event_v1
for each row execute function destruktion_meta.browser_fabric_effect_event_append_only_v1();

create or replace function destruktion_meta.browser_fabric_effect_event_outbox_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, destruktion_meta
as $$
begin
  insert into destruktion_meta.browser_fabric_effect_outbox_v1(event_id,effect_id,event_sha256,authority_effect)
  values(new.event_id,new.effect_id,new.event_sha256,false);
  return new;
end;
$$;

drop trigger if exists browser_fabric_effect_event_outbox_v1
  on destruktion_meta.browser_fabric_effect_event_v1;
create trigger browser_fabric_effect_event_outbox_v1
after insert on destruktion_meta.browser_fabric_effect_event_v1
for each row execute function destruktion_meta.browser_fabric_effect_event_outbox_v1();

-- Default privileges are fail-closed. The future append RPC should validate the
-- event digest/chain/capability in one transaction. Direct Data API mutation is
-- intentionally not part of this pilot contract.
revoke all on table destruktion_meta.browser_fabric_effect_event_v1 from public, anon, authenticated;
revoke all on table destruktion_meta.browser_fabric_effect_outbox_v1 from public, anon, authenticated;
revoke all on function destruktion_meta.browser_fabric_effect_event_append_only_v1() from public, anon, authenticated;
revoke all on function destruktion_meta.browser_fabric_effect_event_outbox_v1() from public, anon, authenticated;

-- Staging operator may uncomment only after creating a dedicated least-privilege
-- ledger writer role. Do NOT make service_role a general ledger writer by default.
-- grant select on destruktion_meta.browser_fabric_effect_event_v1 to browser_fabric_reader;
-- grant insert,select on destruktion_meta.browser_fabric_effect_event_v1 to browser_fabric_ledger_writer;
-- grant select,update on destruktion_meta.browser_fabric_effect_outbox_v1 to browser_fabric_outbox_publisher;

-- Invariants for the staging harness to prove after applying on a dev branch:
-- 1. UPDATE/DELETE of event rows always fails.
-- 2. duplicate INTENT/CAPABILITY/ATTEMPT/OUTCOME for one effect fails.
-- 3. event + outbox row commit atomically or neither commits.
-- 4. queue publisher payload contains only effect_id/event_id/event_sha256.
-- 5. losing queue/realtime delivery cannot create execution authority.
-- 6. reducer can rebuild projection from event rows alone.
-- 7. existing domain journal remains authoritative for physical effect until cutover.

commit;
