from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "supabase/migrations/20260824070409_duel_sovereign_inference_v1.sql").read_text(encoding="utf-8")
RUNNER = (ROOT / "orchestration/sovereign/src/index.ts").read_text(encoding="utf-8")
POLICY = (ROOT / "orchestration/sovereign/src/actor-policy.ts").read_text(encoding="utf-8")
README = (ROOT / "orchestration/sovereign/README.md").read_text(encoding="utf-8")

# Historical migration is immutable and may mention its original model pair.
assert "SOVEREIGN_ONLY" in MIGRATION
assert "tariff_dependency',false" in MIGRATION
assert "OPEN_WEIGHT_SELF_HOSTED" in MIGRATION
assert "h205f22_duel_create_sovereign_v1" in MIGRATION

# DB wake and executor fencing stay durable.
assert "pg_notify" in MIGRATION
assert "h205f22_duel_ready_v1" in MIGRATION
assert "SOVEREIGN_WAKE_NOTIFIED" in MIGRATION
sovereign_branch = MIGRATION.split("if v_policy='SOVEREIGN_ONLY' then", 1)[1].split("end if;", 1)[0]
assert "return null" in sovereign_branch
assert "net.http_post" in MIGRATION
assert MIGRATION.index("if v_policy='SOVEREIGN_ONLY' then") < MIGRATION.index("net.http_post")
assert "p_worker like 'cf-workflow:%'" in MIGRATION
assert "EXECUTOR_POLICY_FENCED" in MIGRATION

# Active local runner is event-driven and uses two OpenAI/ChatGPT actors.
assert 'listen h205f22_duel_ready_v1' in RUNNER
assert 'notification' in RUNNER
assert 'reconcile()' in RUNNER
assert 'DUEL_RECOVERY_MS' in RUNNER
assert 'SOVEREIGN_PERSISTENT_RUNNER' in RUNNER
assert 'actorVisible("ACTOR_A"' in RUNNER
assert 'actorVisible("ACTOR_B"' in RUNNER
assert 'actorVisible("GLM"' not in RUNNER
assert 'SOVEREIGN_GLM_' not in RUNNER
assert 'zai-org/' not in RUNNER
assert "h205f22_duel_submit_pair_v3" in RUNNER
assert "h205f22_duel_complete_lockstep_v2" in RUNNER
assert "peer_hash_ack_failed" in RUNNER

# Actor policy makes both independent slots OpenAI/ChatGPT and rejects non-GPT model ids.
assert 'SOVEREIGN_ACTIVE_PROVIDER = "OPENAI"' in POLICY
assert 'SOVEREIGN_ACTIVE_PLATFORM = "CHATGPT"' in POLICY
assert 'ACTOR_A' in POLICY and 'ACTOR_B' in POLICY
assert 'legacy_glm_provider_active: false' in POLICY
assert "sovereign_openai_model_required" in POLICY
assert 'http://127.0.0.1:8001' in POLICY
assert 'http://127.0.0.1:8002' in POLICY

# No hosted inference API is hard-coded into the runner.
for forbidden in ("ai-gateway.vercel.sh", "api.cloudflare.com/client/v4", "api.openai.com", "api.z.ai"):
    assert forbidden not in RUNNER

assert '/v1/chat/completions' in RUNNER
assert "Do not expose raw vLLM to the public Internet" in README
assert "loopback/private LAN" in README

print("Sovereign inference contract guards: PASS")
