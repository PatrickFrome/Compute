from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "supabase/migrations/20260824070409_duel_sovereign_inference_v1.sql").read_text(encoding="utf-8")
RUNNER = (ROOT / "orchestration/sovereign/src/same_point_v4.ts").read_text(encoding="utf-8")
CONTROL = (ROOT / "orchestration/sovereign/src/control.ts").read_text(encoding="utf-8")
LEGACY = (ROOT / "orchestration/sovereign/src/index.ts").read_text(encoding="utf-8")
PACKAGE = (ROOT / "orchestration/sovereign/package.json").read_text(encoding="utf-8")
README = (ROOT / "orchestration/sovereign/README.md").read_text(encoding="utf-8")

# Historical migration guarantees remain readable and are not rewritten by the OpenAI-only source slice.
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
assert 'await client.query(`listen ${CHANNEL}`)' in RUNNER
assert 'const CHANNEL = "h205f22_same_point_v4_ready"' in RUNNER
assert 'notification' in RUNNER
assert 'reconcile()' in RUNNER
assert 'DUEL_RECOVERY_MS' in RUNNER
assert 'SOVEREIGN_SAME_POINT_V4' in RUNNER

# PRIMARY and CRITIC are independent OpenAI actors. GPT/GLM survive only as
# database wire slots required by the immutable historical pair RPC/schema.
assert 'actorVisible("PRIMARY"' in RUNNER
assert 'actorVisible("CRITIC"' in RUNNER
assert 'logical_role: actor' in RUNNER
assert 'provider: "OPENAI"' in RUNNER
assert 'platform: "OPENAI_API"' in RUNNER
assert "h205f22_duel_submit_pair_v3" in RUNNER
assert "h205f22_duel_submit_rebut_finalize_v4" in RUNNER
assert 'legacy_wire_slot: wireActor(actor)' in RUNNER

# Active actors A/B are OpenAI only; historical GPT/GLM labels are DB wire aliases.
POLICY = (ROOT / "orchestration/sovereign/src/inference-policy.ts").read_text(encoding="utf-8")
assert 'openAiPolicy()' in RUNNER
assert 'actorConfig(INFERENCE, actor, lease)' in RUNNER
assert 'requestOpenAiChat(cfg' in RUNNER
assert 'tariff_dependency: true' in RUNNER
assert 'agent_id: cfg.agent_id' in RUNNER
assert 'https://api.openai.com/v1/chat/completions' in POLICY
assert 'openai_api_key_required' in POLICY
assert 'SOVEREIGN_OPENAI_API_KEY || env.OPENAI_API_KEY' in POLICY
assert 'store: false' in POLICY
assert 'redirect: "error"' in POLICY
for forbidden in ('SOVEREIGN_GLM_URL', 'SOVEREIGN_GLM_TOKEN', 'zai-org/', 'api.z.ai'):
    assert forbidden not in RUNNER
    assert forbidden not in POLICY
assert 'legacyHint' in POLICY
assert 'tariff_dependency=true' in README
assert 'separate authentication' in README

print("Sovereign inference contract guards: PASS")

# Historical V2 source is a terminal tombstone, not a dormant executable.
assert "sovereign_legacy_runner_retired_chatgpt_only" in LEGACY
for forbidden in ("zai-org/GLM", "SOVEREIGN_GLM_URL", "SOVEREIGN_GLM_MODEL", "SOVEREIGN_GLM_TOKEN", "SOVEREIGN_GPT_URL"):
    assert forbidden not in LEGACY
