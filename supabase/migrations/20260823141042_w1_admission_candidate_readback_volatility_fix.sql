-- H205F22 W1: the admission readback function observes clock_timestamp(), so
-- its volatility declaration must reflect real DB-time freshness semantics.
-- Applied live as Supabase migration 20260823141042.

alter function public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint) volatile;
