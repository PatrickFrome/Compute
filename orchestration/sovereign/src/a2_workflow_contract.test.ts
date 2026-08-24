import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/a2-live-acceptance.yml", import.meta.url);

async function workflow(): Promise<string> {
  return readFile(workflowUrl, "utf8");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("exact inference probe is before baseline and peer registration", async () => {
  const source = await workflow();
  const probe = source.indexOf("Probe actual exact-model inference readiness before peer registration");
  const baseline = source.indexOf("Capture exact-model acceptance baseline");
  const peers = source.indexOf("Run exact GPT-5.6 Sol and GLM-5.3 peers without relay");
  assert.ok(probe >= 0, "model readiness probe missing");
  assert.ok(baseline > probe, "baseline must be after readiness probe");
  assert.ok(peers > baseline, "peer registration/runtime launch must be after readiness probe");
  assert.match(source, /exit \"\$status\"/);
});

test("both exact peers have matching lease keepers and private keys", async () => {
  const source = await workflow();
  assert.equal(count(source, "npx tsx src/a2_lease_keeper.ts"), 2);
  assert.ok(count(source, "A2_ED25519_PRIVATE_KEY_PEM_B64=\"$gpt_key\"") >= 2);
  assert.ok(count(source, "A2_ED25519_PRIVATE_KEY_PEM_B64=\"$glm_key\"") >= 2);
  assert.ok(count(source, "A2_RUNTIME_ID=\"$gpt_runtime_id\"") >= 2);
  assert.ok(count(source, "A2_RUNTIME_ID=\"$glm_runtime_id\"") >= 2);
  assert.match(source, /A2_LEASE_RENEW_MS=\"20000\"/);
});

test("live acceptance never supplies a database credential to peers", async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /DATABASE_URL=/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.match(source, /A2_INGRESS_TOKEN=/);
});
