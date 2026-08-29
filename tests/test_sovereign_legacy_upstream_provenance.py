from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = (ROOT / "orchestration/sovereign/src/index.ts").read_text(encoding="utf-8")
PROVENANCE = (ROOT / "orchestration/sovereign/src/upstream_provenance.ts").read_text(encoding="utf-8")

# The legacy runner reads the same SOVEREIGN_*_URL env vars as v4, so it must obey
# the same tariff-provenance rule: a custom endpoint is tariff-dependent by default,
# a proved-local custom endpoint must explicitly opt out, and upstream metadata may
# raise dependency but never lower it.
assert "configuredTariffDependency" in RUNNER
assert "GPT_URL_RAW !== undefined" in RUNNER
assert "GLM_URL_RAW !== undefined" in RUNNER
assert "SOVEREIGN_GPT_TARIFF_DEPENDENCY" in RUNNER
assert "SOVEREIGN_GLM_TARIFF_DEPENDENCY" in RUNNER
assert "return customEndpointConfigured" in PROVENANCE
assert "configuredDependency || upstreamDependency" in PROVENANCE

# Executor receipts must carry full upstream provenance, not a hard-coded local claim.
assert "mergeUpstreamProvenance" in RUNNER
assert "served_model: provenance.servedModel" in RUNNER
assert "served_model_source: provenance.servedModelSource" in RUNNER
assert "zero_spend_verified: provenance.zeroSpendVerified" in RUNNER
assert "data_policy: provenance.dataPolicy" in RUNNER
assert "logical_model: provenance.logicalModel" in RUNNER

# Lockstep metadata derives per-actor dependency from the payload executor block.
assert RUNNER.count("tariff_dependency: payloadTariffDependency(") >= 2
assert "observedTariffDependency" in RUNNER
assert "let observedTariffDependency = RUNNER_TARIFF_DEPENDENCY" in RUNNER

# All terminal envelopes (BLOCKED / RESOLVED / CANARY_REQUIRED x2 / FAILED) derive
# from the sticky accumulator; nothing hard-codes independence.
assert RUNNER.count("tariff_dependency: observedTariffDependency") >= 5
assert "tariff_dependency: false" not in RUNNER

# Failed calls keep endpoint/model/tariff provenance instead of becoming
# provenance-free synthetic failures.
assert "executor_error: true" in RUNNER
assert "tariff_dependency: config.tariffDependency" in RUNNER
assert 'served_model_source: "unavailable"' in RUNNER
assert "endpoint_${actor.toLowerCase()}" in RUNNER

# Lifecycle telemetry reports the configuration minimum plus per-actor breakdown.
assert "tariff_dependency: RUNNER_TARIFF_DEPENDENCY" in RUNNER
assert RUNNER.count('tariff_dependency_basis: "CONFIGURATION_MINIMUM"') >= 2
assert "gpt_tariff_dependency: GPT_TARIFF_DEPENDENCY" in RUNNER
assert "glm_tariff_dependency: GLM_TARIFF_DEPENDENCY" in RUNNER

# Existing sovereign-runner contract invariants must be preserved.
assert "listen h205f22_duel_ready_v1" in RUNNER
assert "SOVEREIGN_PERSISTENT_RUNNER" in RUNNER
assert 'Promise.all([actorVisible("GPT"' in RUNNER
assert "h205f22_duel_submit_pair_v3" in RUNNER
assert "peer_hash_ack_failed" in RUNNER
assert 'http://127.0.0.1:8001' in RUNNER
for forbidden in ("ai-gateway.vercel.sh", "api.cloudflare.com/client/v4", "api.openai.com", "api.z.ai"):
    assert forbidden not in RUNNER

print("SOVEREIGN legacy upstream provenance guards: PASS")
