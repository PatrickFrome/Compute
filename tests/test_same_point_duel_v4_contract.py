from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "supabase/migrations/20260824073410_same_point_duel_v4.sql").read_text(encoding="utf-8")
FENCING = (ROOT / "supabase/migrations/20260824073803_same_point_duel_v4_executor_fencing.sql").read_text(encoding="utf-8")
RECOVERY = (ROOT / "supabase/migrations/20260824074927_same_point_duel_v4_recovery_readback.sql").read_text(encoding="utf-8")
RUNNER = (ROOT / "orchestration/sovereign/src/same_point_v4.ts").read_text(encoding="utf-8")
POLICY = (ROOT / "orchestration/sovereign/src/actor-policy.ts").read_text(encoding="utf-8")
PACKAGE = (ROOT / "orchestration/sovereign/package.json").read_text(encoding="utf-8")

# Historical DB V4 remains append-compatible: its GPT/GLM slot vocabulary is immutable storage.
assert "SAME_POINT_DUEL_V4" in MIGRATION
assert "jsonb_build_array('PROPOSE','REBUT')" in MIGRATION
assert "EVIDENCE_FIRST_ONE_ACTION_V1" in MIGRATION
assert "OBSERVABLE_ENGINEERING_REASONING_V1" in MIGRATION
assert "p_gpt_model,p_glm_model,2" in MIGRATION

# Active inference is two independent OpenAI/ChatGPT actors, never GPT->GLM provider sequencing.
assert RUNNER.count("Promise.all([") >= 2
assert 'actorVisible("ACTOR_A", lease, read, wave)' in RUNNER
assert 'actorVisible("ACTOR_B", lease, read, wave)' in RUNNER
assert 'actorVisible("GLM"' not in RUNNER
assert 'actorVisible("GPT"' not in RUNNER
assert 'SOVEREIGN_GLM_' not in RUNNER
assert 'zai-org/' not in RUNNER
assert 'SOVEREIGN_ACTIVE_PROVIDER = "OPENAI"' in POLICY
assert 'SOVEREIGN_ACTIVE_PLATFORM = "CHATGPT"' in POLICY
assert 'legacy_db_slot' in RUNNER
assert 'actorModelFromLegacyLease("ACTOR_A", lease)' in RUNNER
assert 'actorModelFromLegacyLease("ACTOR_B", lease)' in RUNNER

# Public engineering reasoning is explicit; hidden chain-of-thought is not shared.
for field in (
    "claim", "reasoning_summary", "evidence_used", "assumptions",
    "peer_claims_addressed", "counterexample", "falsifier", "tests_required",
):
    assert field in RUNNER
assert "Private chain-of-thought is never shared" in RUNNER
assert "observable_reasoning_events" in RUNNER

# PROPOSE is persisted before REBUT. REBUT addresses the exact peer event hash.
assert 'phase MUST be PROPOSE' in RUNNER
assert 'phase MUST be REBUT' in RUNNER
assert "v4_rebut_peer_hash_ack_failed" in MIGRATION
assert "gr->>'peer_event_hash_addressed' is distinct from lp_sha" in MIGRATION
assert "lr->>'peer_event_hash_addressed' is distinct from gp_sha" in MIGRATION

# Second pair + arbitration remains one DB transaction.
assert "h205f22_duel_submit_rebut_finalize_v4" in MIGRATION
assert "pair := public.h205f22_duel_submit_pair_v3" in MIGRATION
assert "decision := public.h205f22_duel_finalize_same_point_v4" in MIGRATION
assert "h205f22_duel_submit_rebut_finalize_v4" in RUNNER

# Historical outcome strings remain DB compatibility vocabulary only.
for outcome in ("WIN_GPT", "WIN_GLM", "SYNTHESIS", "NO_ACTION", "CANARY_REQUIRED", "BLOCKED_EXECUTOR"):
    assert outcome in MIGRATION
assert "WIN_GPT => ACTOR_A" in RUNNER
assert "WIN_GLM => ACTOR_B" in RUNNER
assert "UNRESOLVED_ACTION_DISAGREEMENT" in MIGRATION
assert "RUN_CANARY" in MIGRATION

# V4 executor fencing and crash recovery remain unchanged.
assert "sovereign:v4:%" in FENCING
assert "EXECUTOR_PROTOCOL_FENCED" in FENCING
assert "v4_hosted_executor_not_implemented" in FENCING
assert "h205f22_same_point_v4_ready" in FENCING
assert "SAME_POINT_V4_WAKE_NOTIFIED" in FENCING
assert 'const RUNNER_ID = `sovereign:v4:' in RUNNER
assert 'const CHANNEL = "h205f22_same_point_v4_ready"' in RUNNER
assert "v_readback := public.h205f22_duel_read_lockstep_v2(d.duel_id,0)" in RECOVERY
assert "'readback',v_readback" in RECOVERY
assert "lease.readback" in RUNNER

# Startup surface remains explicit.
assert '"start": "bash scripts/start-all.sh"' in PACKAGE
assert '"start:all": "bash scripts/start-all.sh"' in PACKAGE
assert '"start:v4": "tsx src/same_point_v4.ts"' in PACKAGE
assert '"start:control": "tsx src/control.ts"' in PACKAGE

# The runner itself contains no hosted-vendor API endpoint dependency.
for forbidden in ("ai-gateway.vercel.sh", "api.cloudflare.com/client/v4", "api.openai.com", "api.z.ai"):
    assert forbidden not in RUNNER

print("SAME_POINT_DUEL_V4 contract guards: PASS")
