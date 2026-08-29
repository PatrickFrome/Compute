from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = (ROOT / "orchestration/sovereign/src/same_point_v4.ts").read_text(encoding="utf-8")
PROVENANCE = (ROOT / "orchestration/sovereign/src/upstream_provenance.ts").read_text(encoding="utf-8")
PACKAGE = (ROOT / "orchestration/sovereign/package.json").read_text(encoding="utf-8")

# A custom endpoint is remote/tariff-dependent by default; a proved-local backend must opt out explicitly.
assert "configuredTariffDependency" in RUNNER
assert "GPT_URL_RAW !== undefined" in RUNNER
assert "GLM_URL_RAW !== undefined" in RUNNER
assert "SOVEREIGN_GPT_TARIFF_DEPENDENCY" in RUNNER
assert "SOVEREIGN_GLM_TARIFF_DEPENDENCY" in RUNNER
assert "return customEndpointConfigured" in PROVENANCE
assert "invalid_boolean" in PROVENANCE

# Response provenance can only raise dependency; it cannot turn a configured remote endpoint into local evidence.
assert "configuredDependency || upstreamDependency" in PROVENANCE
assert "mergeUpstreamProvenance" in RUNNER
assert "served_model: provenance.servedModel" in RUNNER
assert "served_model_source: provenance.servedModelSource" in RUNNER
assert "zero_spend_verified: provenance.zeroSpendVerified" in RUNNER
assert "data_policy: provenance.dataPolicy" in RUNNER

# Executor, lockstep and lifecycle telemetry must derive the dependency rather than hard-code false.
assert "tariff_dependency: provenance.tariffDependency" in RUNNER
assert RUNNER.count("tariff_dependency: payloadTariffDependency(") >= 4
assert "tariff_dependency: RUNNER_TARIFF_DEPENDENCY" in RUNNER
assert "tariff_dependency: false" not in RUNNER
assert "tariff_dependency_basis: \"CONFIGURATION_MINIMUM\"" in RUNNER

# Failed calls still carry endpoint provenance instead of becoming provenance-free synthetic errors.
assert "executor_error: true" in RUNNER
assert "tariff_dependency: config.tariffDependency" in RUNNER
assert "served_model_source: \"unavailable\"" in RUNNER

# Pure helper has its own executable tests and is part of the package contract.
assert '"test:provenance": "tsx --test src/upstream_provenance.test.ts"' in PACKAGE

print("SAME_POINT_DUEL_V4 upstream provenance guards: PASS")
