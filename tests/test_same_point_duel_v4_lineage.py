from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
M = ROOT / "supabase" / "migrations"

required = [
    "20260824044849_aop1_microstep_lockstep_duel_v2.sql",
    "20260824061721_duel_submit_pair_idempotent_v3.sql",
    "20260824070409_duel_sovereign_inference_v1.sql",
    "20260824073410_same_point_duel_v4.sql",
    "20260824073803_same_point_duel_v4_executor_fencing.sql",
    "20260824074927_same_point_duel_v4_recovery_readback.sql",
]
for name in required:
    assert (M / name).is_file(), name

# 070306 was the stale Git-only timestamp; live Supabase history is 070409.
assert not (M / "20260824070306_duel_sovereign_inference_v1.sql").exists()

base = (M / required[0]).read_text(encoding="utf-8")
pair = (M / required[1]).read_text(encoding="utf-8")
sovereign = (M / required[2]).read_text(encoding="utf-8")
v4 = (M / required[3]).read_text(encoding="utf-8")
fence = (M / required[4]).read_text(encoding="utf-8")
recovery = (M / required[5]).read_text(encoding="utf-8")

assert "h205f22_duel_create_lockstep_v2" in base
assert "h205f22_duel_read_lockstep_v2" in base
assert "h205f22_duel_submit_pair_v3" in pair
assert "h205f22_duel_create_sovereign_v1" in sovereign
assert "h205f22_duel_create_same_point_v4" in v4
assert "h205f22_duel_submit_rebut_finalize_v4" in v4
assert "sovereign:v4:%" in fence
assert "h205f22_same_point_v4_ready" in fence
assert "v_readback := public.h205f22_duel_read_lockstep_v2(d.duel_id,0)" in recovery

print("SAME_POINT_DUEL_V4 migration lineage guards: PASS")
