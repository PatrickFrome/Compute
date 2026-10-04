from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = (ROOT / "orchestration/sovereign/src/actor-policy.ts").read_text(encoding="utf-8")
CONTROL = (ROOT / "orchestration/sovereign/src/control.ts").read_text(encoding="utf-8")
V4 = (ROOT / "orchestration/sovereign/src/same_point_v4.ts").read_text(encoding="utf-8")
LEGACY = (ROOT / "orchestration/sovereign/src/index.ts").read_text(encoding="utf-8")

assert 'SovereignActor = "ACTOR_A" | "ACTOR_B"' in POLICY
assert 'SOVEREIGN_ACTIVE_PROVIDER = "OPENAI"' in POLICY
assert 'SOVEREIGN_ACTIVE_PLATFORM = "CHATGPT"' in POLICY
assert 'legacy_db_slot: "GPT"' in POLICY
assert 'legacy_db_slot: "GLM"' in POLICY
assert 'legacy_db_slot_names_are_provider_identity: false' in POLICY
assert 'independent_actor_contexts_required: true' in POLICY
assert "sovereign_openai_model_required" in POLICY

for source in (CONTROL, V4, LEGACY):
    assert "SOVEREIGN_GLM_URL" not in source
    assert "SOVEREIGN_GLM_MODEL" not in source
    assert "SOVEREIGN_GLM_TOKEN" not in source
    assert "zai-org/" not in source

assert 'legacy_provider_endpoint_retired' in CONTROL
assert 'actorModelFromLegacyLease("ACTOR_A", lease)' in V4
assert 'actorModelFromLegacyLease("ACTOR_B", lease)' in V4
assert 'actorModelFromLegacyLease("ACTOR_A", lease)' in LEGACY
assert 'actorModelFromLegacyLease("ACTOR_B", lease)' in LEGACY

print("Sovereign ChatGPT actor policy guards: PASS")
