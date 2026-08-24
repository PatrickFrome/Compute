from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "supabase/migrations/20260824073410_same_point_duel_v4.sql").read_text(encoding="utf-8")
FENCING = (ROOT / "supabase/migrations/20260824073803_same_point_duel_v4_executor_fencing.sql").read_text(encoding="utf-8")
RUNNER = (ROOT / "orchestration/sovereign/src/same_point_v4.ts").read_text(encoding="utf-8")
PACKAGE = (ROOT / "orchestration/sovereign/package.json").read_text(encoding="utf-8")

# One semantic point is exactly two simultaneous waves, never a sequential GPT->GLM chat.
assert "SAME_POINT_DUEL_V4" in MIGRATION
assert "jsonb_build_array('PROPOSE','REBUT')" in MIGRATION
assert "EVIDENCE_FIRST_ONE_ACTION_V1" in MIGRATION
assert "OBSERVABLE_ENGINEERING_REASONING_V1" in MIGRATION
assert "p_gpt_model,p_glm_model,2" in MIGRATION
assert RUNNER.count("Promise.all([") >= 2
assert 'actorVisible("GPT", lease, read, wave)' in RUNNER
assert 'actorVisible("GLM", lease, read, wave)' in RUNNER

# Public engineering reasoning is explicit; hidden chain-of-thought is not used as shared state.
for field in (
    "claim",
    "reasoning_summary",
    "evidence_used",
    "assumptions",
    "peer_claims_addressed",
    "counterexample",
    "falsifier",
    "tests_required",
):
    assert field in RUNNER
assert "Private chain-of-thought is never shared" in RUNNER
assert "observable_reasoning_events" in RUNNER

# PROPOSE is persisted before REBUT. REBUT must address the exact peer PROPOSE event hash.
assert 'phase MUST be PROPOSE' in RUNNER
assert 'phase MUST be REBUT' in RUNNER
assert "v4_rebut_peer_hash_ack_failed" in MIGRATION
assert "gr->>'peer_event_hash_addressed' is distinct from lp_sha" in MIGRATION
assert "lr->>'peer_event_hash_addressed' is distinct from gp_sha" in MIGRATION

# The second pair and arbitration are one DB call, removing a post-rebut orchestration RTT.
assert "h205f22_duel_submit_rebut_finalize_v4" in MIGRATION
assert "pair := public.h205f22_duel_submit_pair_v3" in MIGRATION
assert "decision := public.h205f22_duel_finalize_same_point_v4" in MIGRATION
assert "h205f22_duel_submit_rebut_finalize_v4" in RUNNER

# Arbitration emits exactly one resulting action and fails closed to a canary on unresolved disagreement.
assert "compute_fabric_duel_decision_h205f22" in MIGRATION
assert "resulting_action jsonb not null" in MIGRATION
assert "decision_sha256" in MIGRATION
assert "duel_decision_immutable" in MIGRATION
for outcome in ("WIN_GPT", "WIN_GLM", "SYNTHESIS", "NO_ACTION", "CANARY_REQUIRED", "BLOCKED_EXECUTOR"):
    assert outcome in MIGRATION
assert "UNRESOLVED_ACTION_DISAGREEMENT" in MIGRATION
assert "RUN_CANARY" in MIGRATION

# V4 is isolated from legacy sovereign and Cloudflare executors until a native hosted V4 runner exists.
assert "sovereign:v4:%" in FENCING
assert "EXECUTOR_PROTOCOL_FENCED" in FENCING
assert "v4_hosted_executor_not_implemented" in FENCING
assert "h205f22_same_point_v4_ready" in FENCING
assert "SAME_POINT_V4_WAKE_NOTIFIED" in FENCING
assert 'const RUNNER_ID = `sovereign:v4:' in RUNNER
assert 'const CHANNEL = "h205f22_same_point_v4_ready"' in RUNNER

# V4 is now the default sovereign entrypoint; legacy remains available only explicitly.
assert '"start": "tsx src/same_point_v4.ts"' in PACKAGE
assert '"start:v4": "tsx src/same_point_v4.ts"' in PACKAGE
assert '"start:legacy": "tsx src/index.ts"' in PACKAGE

# The runner itself contains no managed-inference endpoint dependency.
for forbidden in ("ai-gateway.vercel.sh", "api.cloudflare.com/client/v4", "api.openai.com", "api.z.ai"):
    assert forbidden not in RUNNER

print("SAME_POINT_DUEL_V4 contract guards: PASS")
