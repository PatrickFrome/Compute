-- H205F22 W1: the admission readback function observes clock_timestamp(), so
-- its volatility declaration must reflect real DB-time freshness semantics.
-- Applied live as Supabase migration 20260823141042.
--
-- Guarded: the function is created by 20260823141025, which skips creation when
-- the W1 tables (restored outside this chain by infra/pigsty/bootstrap/05) are
-- absent. Per the documented fresh-project contract
-- (supabase/operations/20261005191500) a missing function skips with NOTICE
-- instead of failing the fresh migration run.

do $guard$
begin
  if to_regprocedure('public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint)') is null then
    raise notice 'skip: public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint) not created (W1 tables absent, see 20260823141025)';
  else
    alter function public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint) volatile;
  end if;
end
$guard$;
