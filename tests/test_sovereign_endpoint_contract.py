from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTROL = (ROOT / "orchestration/sovereign/src/control.ts").read_text(encoding="utf-8")
PACKAGE = (ROOT / "orchestration/sovereign/package.json").read_text(encoding="utf-8")
START = (ROOT / "orchestration/sovereign/scripts/start-all.sh").read_text(encoding="utf-8")

# Local sovereign gateway is loopback-first and refuses an unauthenticated public bind.
assert 'process.env.SOVEREIGN_HTTP_HOST || "127.0.0.1"' in CONTROL
assert "SOVEREIGN_CONTROL_TOKEN_required_for_non_loopback_bind" in CONTROL
assert "timingSafeEqual" in CONTROL
assert 'header.startsWith("Bearer ")' in CONTROL

# Complete operational endpoint surface.
for route in (
    '"/healthz"',
    '"/readyz"',
    '"/metrics"',
    '"/status"',
    '"/v1/models"',
    '"/primary/v1/models"',
    '"/critic/v1/models"',
    '"/primary/v1/chat/completions"',
    '"/critic/v1/chat/completions"',
    '"/v4/duels"',
):
    assert route in CONTROL
assert "decision|wake" in CONTROL

# Role proxies pin exact configured model identities and stream responses.
POLICY = (ROOT / "orchestration/sovereign/src/inference-policy.ts").read_text(encoding="utf-8")
assert 'requestOpenAiChat(cfg, await readJson(req)' in CONTROL
assert 'model: openAiModel(cfg.model)' in POLICY
assert 'https://api.openai.com/v1/chat/completions' in POLICY
assert '"/agent-a/v1/chat/completions"' in CONTROL
assert '"/agent-b/v1/chat/completions"' in CONTROL
assert 'error: "legacy_provider_endpoint_retired"' in CONTROL
assert 'openAiModel(input.critic_model || input.agent_b_model || input.glm_model || CRITIC_MODEL)' in CONTROL
assert 'provider: "OPENAI", platform: "OPENAI_API"' in CONTROL
assert '/v1/chat/completions' in CONTROL
assert "AsyncIterable<Uint8Array>" in CONTROL

# Local control creates/reads/signals V4 through the fenced DB protocol.
assert "h205f22_duel_create_same_point_v4" in CONTROL
assert "h205f22_duel_read_same_point_v4" in CONTROL
assert "h205f22_same_point_v4_ready" in CONTROL
assert "hosted_v4_executor_not_implemented" in CONTROL

# npm start supervises both coordinator and endpoint gateway.
assert '"start": "bash scripts/start-all.sh"' in PACKAGE
assert '"start:v4": "tsx src/same_point_v4.ts"' in PACKAGE
assert '"start:control": "tsx src/control.ts"' in PACKAGE
assert "tsx src/control.ts" in START
assert "tsx src/same_point_v4.ts" in START

print("Sovereign endpoint contract guards: PASS")

assert 'legacy_provider_endpoint_retired' in CONTROL
assert 'url.pathname.startsWith("/glm/")' in CONTROL
assert 'url.pathname.startsWith("/gpt/")' in CONTROL
assert 'role_endpoints: ["/primary/v1", "/critic/v1"]' in CONTROL
