from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "supabase/migrations/20261004093000_same_point_duel_chatgpt_actor_compat_v1.sql").read_text(encoding="utf-8")
OLD = (ROOT / "supabase/migrations/20260824083901_same_point_duel_v4_peer_relay.sql").read_text(encoding="utf-8")

# Historical append-only relay migration remains unchanged vocabulary.
assert "actor in ('GPT','GLM')" in OLD
assert "h205f22_duel_submit_peer_v4" in OLD

# New public surface names truthful actor identities and forces OpenAI/ChatGPT.
assert "h205f22_duel_create_chatgpt_relay_v1" in MIGRATION
assert "h205f22_duel_submit_chatgpt_peer_v1" in MIGRATION
assert "CHATGPT_ACTOR_PAIR_V1" in MIGRATION
assert "'active_inference_provider','OPENAI'" in MIGRATION
assert "'active_inference_platform','CHATGPT'" in MIGRATION
assert "chatgpt:actor-a:" in MIGRATION
assert "chatgpt:actor-b:" in MIGRATION
assert "actor_a_chatgpt_peer_id_required" in MIGRATION
assert "actor_b_chatgpt_peer_id_required" in MIGRATION

# Mapping to old slots occurs only at the DB compatibility boundary.
assert "v_slot := case when v_actor='ACTOR_A' then 'GPT' else 'GLM' end" in MIGRATION
assert "'legacy_db_slot',v_slot" in MIGRATION
assert "'legacy_db_slot_names_are_provider_identity',false" in MIGRATION
assert "actor_a_row.payload" in MIGRATION
assert "actor_b_row.payload" in MIGRATION

# New submissions persist truthful ChatGPT peer IDs even though actor column is the old slot.
assert ") values(p_duel_id,p_wave,v_slot,trim(p_peer_id)" in MIGRATION
assert "glm:5.3" not in MIGRATION
assert "zai-org/" not in MIGRATION
assert "SOVEREIGN_GLM_" not in MIGRATION

# Direct writes remain denied; only guarded RPCs execute as service_role.
assert "security definer" in MIGRATION
assert "revoke all on function public.h205f22_duel_create_chatgpt_relay_v1" in MIGRATION
assert "grant execute on function public.h205f22_duel_create_chatgpt_relay_v1" in MIGRATION
assert "revoke all on function public.h205f22_duel_submit_chatgpt_peer_v1" in MIGRATION
assert "grant execute on function public.h205f22_duel_submit_chatgpt_peer_v1" in MIGRATION

# Pair/finalize authority remains the existing deterministic V4 implementation.
assert "h205f22_duel_submit_pair_v3" in MIGRATION
assert "h205f22_duel_submit_rebut_finalize_v4" in MIGRATION
assert "canonical',false" in MIGRATION
assert "authority_effect',false" in MIGRATION

print("SAME_POINT_DUEL ChatGPT actor compatibility guards: PASS")
