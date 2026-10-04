from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "supabase/migrations/20260824070409_duel_sovereign_inference_v1.sql").read_text(encoding="utf-8")
RUNNER = (ROOT / "orchestration/sovereign/src/same_point_v4.ts").read_text(encoding="utf-8")
CONTROL = (ROOT / "orchestration/sovereign/src/control.ts").read_text(encoding="utf-8")
PACKAGE = (ROOT / "orchestration/sovereign/package.json").read_text(encoding="utf-8")
README = (ROOT / "orchestration/sovereign/README.md").read_text(encoding="utf-8")

# Managed inference must not be required for sovereign sessions.
assert "SOVEREIGN_ONLY" in MIGRATION
assert "tariff_dependency',false" in MIGRATION
assert "OPEN_WEIGHT_SELF_HOSTED" in MIGRATION
assert "h205f22_duel_create_sovereign_v1" in MIGRATION
assert "openai/gpt-oss-20b" in MIGRATION
assert "zai-org/GLM-4.7-Flash" in MIGRATION

# The database wakes a persistent runner directly and skips Cloudflare pg_net for sovereign-only duels.
assert "pg_notify" in MIGRATION
assert "h205f22_duel_ready_v1" in MIGRATION
assert "SOVEREIGN_WAKE_NOTIFIED" in MIGRATION
sovereign_branch = MIGRATION.split("if v_policy='SOVEREIGN_ONLY' then", 1)[1].split("end if;", 1)[0]
assert "return null" in sovereign_branch
assert "net.http_post" in MIGRATION
assert MIGRATION.index("if v_policy='SOVEREIGN_ONLY' then") < MIGRATION.index("net.http_post")

# Hosted Cloudflare leases are fenced away from sovereign-only sessions.
assert "p_worker like 'cf-workflow:%'" in MIGRATION
assert "EXECUTOR_POLICY_FENCED" in MIGRATION
assert "SOVEREIGN_ONLY' and v_hosted" in MIGRATION
assert "HOSTED_ONLY' and v_sovereign" in MIGRATION

# The local runner is event-driven in the hot path; periodic activity is recovery only.
assert 'listen h205f22_duel_ready_v1' in RUNNER
assert 'notification' in RUNNER
assert 'reconcile()' in RUNNER
assert 'DUEL_RECOVERY_MS' in RUNNER
assert 'SOVEREIGN_PERSISTENT_RUNNER' in RUNNER

# PRIMARY and CRITIC are independent OpenAI actors. GPT/GLM survive only as
# database wire slots required by the immutable historical pair RPC/schema.
assert 'actorVisible("PRIMARY"' in RUNNER
assert 'actorVisible("CRITIC"' in RUNNER
assert 'logical_role: actor' in RUNNER
assert 'provider: "OPENAI"' in RUNNER
assert 'platform: "CHATGPT"' in RUNNER
assert "h205f22_duel_submit_pair_v3" in RUNNER
assert "h205f22_duel_submit_rebut_finalize_v4" in RUNNER
assert 'legacy_wire_slot: wireActor(actor)' in RUNNER

# No active ZAI/GLM inference configuration or hosted vendor endpoint is allowed.
for source in (RUNNER, CONTROL):
    for forbidden in ("ai-gateway.vercel.sh", "api.cloudflare.com/client/v4", "api.openai.com", "api.z.ai", "zai-org/GLM", "SOVEREIGN_GLM_URL", "SOVEREIGN_GLM_MODEL", "SOVEREIGN_GLM_TOKEN"):
        assert forbidden not in source

# Two independent local/private OpenAI-compatible contexts stay available.
assert 'SOVEREIGN_PRIMARY_URL' in RUNNER
assert 'SOVEREIGN_CRITIC_URL' in RUNNER
assert 'http://127.0.0.1:8001' in RUNNER
assert 'http://127.0.0.1:8002' in RUNNER
assert '/v1/chat/completions' in RUNNER
assert 'finishReason !== "stop"' in RUNNER
assert '/primary/v1/chat/completions' in CONTROL
assert '/critic/v1/chat/completions' in CONTROL
assert "sovereign_legacy_runner_retired_chatgpt_only" in PACKAGE
assert "Do not expose raw vLLM to the public Internet" in README
assert "loopback/private LAN" in README

print("Sovereign inference contract guards: PASS")
