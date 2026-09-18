#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=receipt_canary}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

psql17() {
  docker run --rm -i --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:17 \
    psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
}

for _ in $(seq 1 60); do
  if docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:17 \
      pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql17 <<'SQL'
create schema destruktion_meta;
create schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create extension pgcrypto with schema extensions;
SQL

psql17 < supabase/migrations/20260825050000_a2_chat_bridge_receipts_v1.sql

psql17 <<'SQL'
do $$
declare
  v_ws uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
  v_cmd uuid := '11111111-1111-4111-8111-111111111111';
  v_cmd2 uuid := '22222222-2222-4222-8222-222222222222';
  v_first jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_result_replay jsonb;
  v_seen boolean;
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'destruktion_meta'
      and c.relname = 'compute_fabric_a2_chat_bridge_receipt_h205f22'
      and c.relrowsecurity
  ) then
    raise exception 'canary_rls_not_enabled';
  end if;

  v_first := public.h205f22_a2_chat_bridge_receipt_ingest_v1(
    v_ws,'ci-sql','COMMAND_LEASED','GLM','GLM_ZAI',repeat('a',64),108,
    null,false,null,null,null,v_cmd,repeat('b',64),repeat('c',64),null,null,null
  );
  if v_first->>'replayed' <> 'false' then raise exception 'canary_first_insert_not_fresh'; end if;
  if v_first->>'canonical' <> 'false' or v_first->>'authority_effect' <> 'false' then
    raise exception 'canary_authority_nonclaim_broken';
  end if;

  v_replay := public.h205f22_a2_chat_bridge_receipt_ingest_v1(
    v_ws,'ci-sql','COMMAND_LEASED','GLM','GLM_ZAI',repeat('a',64),108,
    null,false,null,null,null,v_cmd,repeat('b',64),repeat('c',64),null,null,null
  );
  if v_replay->>'replayed' <> 'true'
     or v_replay->>'receipt_id' <> v_first->>'receipt_id'
     or v_replay->>'receipt_sha256' <> v_first->>'receipt_sha256' then
    raise exception 'canary_exact_replay_identity_changed';
  end if;

  v_seen := false;
  begin
    perform public.h205f22_a2_chat_bridge_receipt_ingest_v1(
      v_ws,'ci-sql','COMMAND_LEASED','GLM','GLM_ZAI',repeat('a',64),108,
      null,false,null,null,null,v_cmd,repeat('b',64),repeat('d',64),null,null,null
    );
  exception when others then
    if sqlerrm <> 'bridge_receipt_conflict' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_conflicting_replay_accepted'; end if;

  v_seen := false;
  begin
    perform public.h205f22_a2_chat_bridge_receipt_ingest_v1(
      v_ws,'ci-sql','SEND_RESULT','GLM','GLM_ZAI',repeat('a',64),108,
      null,false,null,null,null,v_cmd2,repeat('b',64),repeat('c',64),
      'SENT_AND_DOM_VERIFIED',true,true
    );
  exception when others then
    if sqlerrm <> 'bridge_send_result_lease_missing' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_result_without_lease_accepted'; end if;

  v_seen := false;
  begin
    perform public.h205f22_a2_chat_bridge_receipt_ingest_v1(
      v_ws,'ci-sql','SEND_RESULT','GLM','GLM_ZAI',repeat('e',64),108,
      null,false,null,null,null,v_cmd,repeat('b',64),repeat('c',64),
      'SENT_AND_DOM_VERIFIED',true,true
    );
  exception when others then
    if sqlerrm <> 'bridge_send_result_lease_mismatch' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_result_lease_mismatch_accepted'; end if;

  v_seen := false;
  begin
    perform public.h205f22_a2_chat_bridge_receipt_ingest_v1(
      v_ws,'ci-sql','SEND_RESULT','GLM','GLM_ZAI',repeat('a',64),108,
      null,false,null,null,null,v_cmd,repeat('b',64),repeat('c',64),
      'SENT',true,false
    );
  exception when others then
    if sqlerrm <> 'bridge_result_status_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_generic_sent_accepted'; end if;

  v_seen := false;
  begin
    perform public.h205f22_a2_chat_bridge_receipt_ingest_v1(
      v_ws,'ci-sql','SEND_RESULT','GLM','GLM_ZAI',repeat('a',64),108,
      null,false,null,null,null,v_cmd,repeat('b',64),repeat('c',64),
      'SENT_AND_DOM_VERIFIED',true,false
    );
  exception when others then
    if sqlerrm <> 'bridge_strong_send_verification_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_forged_strong_result_accepted'; end if;

  v_result := public.h205f22_a2_chat_bridge_receipt_ingest_v1(
    v_ws,'ci-sql','SEND_RESULT','GLM','GLM_ZAI',repeat('a',64),108,
    null,false,null,null,null,v_cmd,repeat('b',64),repeat('c',64),
    'SENT_AND_DOM_VERIFIED',true,true
  );
  v_result_replay := public.h205f22_a2_chat_bridge_receipt_ingest_v1(
    v_ws,'ci-sql','SEND_RESULT','GLM','GLM_ZAI',repeat('a',64),108,
    null,false,null,null,null,v_cmd,repeat('b',64),repeat('c',64),
    'SENT_AND_DOM_VERIFIED',true,true
  );
  if v_result_replay->>'replayed' <> 'true'
     or v_result_replay->>'receipt_id' <> v_result->>'receipt_id' then
    raise exception 'canary_result_replay_identity_changed';
  end if;

  if exists (
    select 1 from destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22
    where canonical or authority_effect
  ) then
    raise exception 'canary_authority_row_found';
  end if;
end;
$$;
SQL

# The narrow RPC is callable by service_role.
psql17 <<'SQL' >/tmp/a2-receipt-service-role-read.txt
set role service_role;
select public.h205f22_a2_chat_bridge_receipt_read_v1(
  '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid, 20
)::text;
reset role;
SQL
grep -q 'metaengine.compute.a2-chat-bridge-receipt-read.h205f22.v1' /tmp/a2-receipt-service-role-read.txt

# Direct table access remains closed even to service_role.
if psql17 -c "set role service_role; select count(*) from destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22;" \
    >/tmp/a2-direct-table.out 2>/tmp/a2-direct-table.err; then
  echo 'service_role direct table read unexpectedly succeeded' >&2
  exit 1
fi
grep -Eqi 'permission denied|no permission' /tmp/a2-direct-table.err

# anon cannot execute the read RPC.
if psql17 -c "set role anon; select public.h205f22_a2_chat_bridge_receipt_read_v1('2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid, 20);" \
    >/tmp/a2-anon-rpc.out 2>/tmp/a2-anon-rpc.err; then
  echo 'anon receipt RPC unexpectedly succeeded' >&2
  exit 1
fi
grep -Eqi 'permission denied|no permission' /tmp/a2-anon-rpc.err

echo 'A2 chat bridge receipt PostgreSQL 17 canary: PASS'
