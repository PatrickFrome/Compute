-- Mainline METAENGINE checkpoint ledger integrity guard v1.
-- New rows must seal the exact jsonb state text they persist. Historical rows are
-- not rewritten or backfilled here; append-only semantics make any discrepancy
-- explicit evidence debt instead of silently normalizing it away.

create or replace function destruktion_meta.checkpoint_ledger_integrity_guard_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_hash text;
begin
  if tg_op = 'INSERT' then
    v_expected_hash := encode(extensions.digest(new.state::text,'sha256'::text),'hex');
    if new.state_hash is distinct from v_expected_hash then
      raise exception 'checkpoint_ledger_state_hash_mismatch' using errcode='23514';
    end if;
    return new;
  end if;

  raise exception 'METAENGINE checkpoint ledger is append-only: %.% % forbidden',
    tg_table_schema,tg_table_name,tg_op using errcode='55000';
end;
$$;

revoke all on function destruktion_meta.checkpoint_ledger_integrity_guard_v1() from public;
revoke all on function destruktion_meta.checkpoint_ledger_integrity_guard_v1() from anon;
revoke all on function destruktion_meta.checkpoint_ledger_integrity_guard_v1() from authenticated;

drop trigger if exists checkpoint_ledger_insert_integrity_v1 on destruktion_meta.checkpoint_ledger;
create trigger checkpoint_ledger_insert_integrity_v1
before insert on destruktion_meta.checkpoint_ledger
for each row execute function destruktion_meta.checkpoint_ledger_integrity_guard_v1();

drop trigger if exists checkpoint_ledger_immutable_v1 on destruktion_meta.checkpoint_ledger;
create trigger checkpoint_ledger_immutable_v1
before update or delete on destruktion_meta.checkpoint_ledger
for each row execute function destruktion_meta.checkpoint_ledger_integrity_guard_v1();

comment on function destruktion_meta.checkpoint_ledger_integrity_guard_v1() is
  'METAENGINE mainline checkpoint ledger guard: verifies state_hash at insert and rejects UPDATE/DELETE. Historical rows are never rewritten by this migration.';
