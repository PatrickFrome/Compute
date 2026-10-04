from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTROL = (ROOT / "orchestration/sovereign/src/control.ts").read_text(encoding="utf-8")
POLICY = (ROOT / "orchestration/sovereign/src/actor-policy.ts").read_text(encoding="utf-8")
PACKAGE = (ROOT / "orchestration/sovereign/package.json").read_text(encoding="utf-8")
START = (ROOT / "orchestration/sovereign/scripts/start-all.sh").read_text(encoding="utf-8")

# Local sovereign gateway is loopback-first and refuses an unauthenticated public bind.
assert 'process.env.SOVEREIGN_HTTP_HOST || "127.0.0.1"' in CONTROL
assert "SOVEREIGN_CONTROL_TOKEN_required_for_non_loopback_bind" in CONTROL
assert "timingSafeEqual" in CONTROL
assert 'header.startsWith("Bearer ")' in CONTROL

# Active endpoint surface is provider-neutral Actor A/B.
for route in (
    '"/healthz"',
    '"/readyz"',
    '"/metrics"',
    '"/status"',
    '"/v1/models"',
    '"/actor-a/v1/models"',
    '"/actor-b/v1/models"',
    '"/actor-a/v1/chat/completions"',
    '"/actor-b/v1/chat/completions"',
    '"/v4/duels"',
):
    assert route in CONTROL
assert "decision|wake" in CONTROL

# Old provider-labelled inference endpoints are fail-closed compatibility tombstones.
assert 'url.pathname.startsWith("/glm/")' in CONTROL
assert 'url.pathname.startsWith("/gpt/")' in CONTROL
assert "legacy_provider_endpoint_retired" in CONTROL
assert 'proxyModel(req, res, "GLM"' not in CONTROL
assert 'proxyModel(req, res, "GPT"' not in CONTROL

# Actor proxies pin exact OpenAI model identities and stream responses.
assert "input.model = cfg.model" in CONTROL
assert 'proxyModel(req, res, "ACTOR_A"' in CONTROL
assert 'proxyModel(req, res, "ACTOR_B"' in CONTROL
assert '"/v1/chat/completions"' in CONTROL
assert "AsyncIterable<Uint8Array>" in CONTROL
assert 'SOVEREIGN_ACTIVE_PROVIDER = "OPENAI"' in POLICY
assert 'SOVEREIGN_ACTIVE_PLATFORM = "CHATGPT"' in POLICY
assert "SOVEREIGN_GLM_URL" not in CONTROL
assert "SOVEREIGN_GLM_MODEL" not in CONTROL
assert "zai-org/" not in CONTROL

# Local control creates/reads/signals V4 through the fenced DB protocol.
assert "h205f22_duel_create_same_point_v4" in CONTROL
assert "h205f22_duel_read_same_point_v4" in CONTROL
assert "h205f22_same_point_v4_ready" in CONTROL
assert "hosted_v4_executor_not_implemented" in CONTROL
assert "legacy_db_actor_slot_mapping" in CONTROL

# npm start supervises both coordinator and endpoint gateway.
assert '"start": "bash scripts/start-all.sh"' in PACKAGE
assert '"start:v4": "tsx src/same_point_v4.ts"' in PACKAGE
assert '"start:control": "tsx src/control.ts"' in PACKAGE
assert "tsx src/control.ts" in START
assert "tsx src/same_point_v4.ts" in START

print("Sovereign endpoint contract guards: PASS")
