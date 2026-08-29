import test from "node:test";
import assert from "node:assert/strict";
import { configuredTariffDependency, mergeUpstreamProvenance } from "./upstream_provenance.js";

test("default built-in local endpoint is tariff independent", () => {
  assert.equal(configuredTariffDependency(false, undefined, "GPT"), false);
});

test("custom endpoint is tariff dependent unless explicitly proven local", () => {
  assert.equal(configuredTariffDependency(true, undefined, "GPT"), true);
  assert.equal(configuredTariffDependency(true, "false", "GPT"), false);
  assert.equal(configuredTariffDependency(true, "1", "GPT"), true);
  assert.throws(() => configuredTariffDependency(true, "maybe", "GPT"), /GPT_invalid_boolean/);
});

test("upstream metadata may raise tariff dependency but never lower configured dependency", () => {
  assert.equal(mergeUpstreamProvenance({
    model: "local/model",
    metaengine: { tariff_dependency: true }
  }, "logical/a", false).tariffDependency, true);

  assert.equal(mergeUpstreamProvenance({
    model: "remote/model",
    metaengine: { tariff_dependency: false }
  }, "logical/a", true).tariffDependency, true);
});

test("served model and data policy prefer explicit gateway metadata", () => {
  const provenance = mergeUpstreamProvenance({
    model: "provider/transport-model",
    metaengine: {
      upstream_served_model: "provider/actual-fallback",
      tariff_dependency: true,
      zero_spend_verified: true,
      data_policy: "PUBLIC_OR_NON_SENSITIVE_ONLY",
      confidential_data_supported: false
    }
  }, "metaengine/peer-b-free", false);

  assert.equal(provenance.logicalModel, "metaengine/peer-b-free");
  assert.equal(provenance.servedModel, "provider/actual-fallback");
  assert.equal(provenance.servedModelSource, "metaengine");
  assert.equal(provenance.tariffDependency, true);
  assert.equal(provenance.zeroSpendVerified, true);
  assert.equal(provenance.dataPolicy, "PUBLIC_OR_NON_SENSITIVE_ONLY");
  assert.equal(provenance.confidentialDataSupported, false);
});

test("ordinary OpenAI-compatible endpoint falls back to response model provenance", () => {
  const provenance = mergeUpstreamProvenance({ model: "local/served" }, "local/requested", false);
  assert.equal(provenance.servedModel, "local/served");
  assert.equal(provenance.servedModelSource, "response");
  assert.equal(provenance.tariffDependency, false);
  assert.equal(provenance.zeroSpendVerified, null);
});
