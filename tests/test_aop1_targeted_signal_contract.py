from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "supabase/migrations/20260821083934_aop1_targeted_run_signal_v1.sql").read_text(encoding="utf-8")

assert "h205f22_aop1_signal_run_v1" in SQL
assert "where run_id=p_run_id" in SQL
assert "run_not_waiting_event" in SQL
assert "wake_condition_mismatch" in SQL
assert "CONDITION_SIGNAL_TARGETED" in SQL
assert "resume_signal" in SQL
assert "resume_payload_attached" in SQL
assert "65536" in SQL
assert "authority_effect',false" in SQL
assert "revoke all on function public.h205f22_aop1_signal_run_v1" in SQL
assert "grant execute on function public.h205f22_aop1_signal_run_v1" in SQL

print("AOP1 targeted signal contract guards: PASS")
