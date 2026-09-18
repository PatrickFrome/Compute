import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const runtime = await fs.readFile(new URL('../src/rsi-runtime-service.mjs', import.meta.url), 'utf8');
const ledger = await fs.readFile(new URL('../src/rsi-runtime-ledger.mjs', import.meta.url), 'utf8');

test('Browser lifecycle starts RSI only after exact Development Plane source binding', () => {
  assert.match(main, /import \{ RsiRuntimeService \} from '\.\/rsi-runtime-service\.mjs'/);
  assert.match(main, /const sourceSha = String\(dev\?\.devos_repo_read_model\?\.head \|\| ''\)/);
  assert.match(main, /rsi_runtime_exact_source_sha_unavailable/);
  assert.match(main, /ledgerPath: path\.join\(app\.getPath\('userData'\), 'metaengine-rsi-runtime-ledger-v1\.jsonl'\)/);
  assert.match(main, /runDegradableStartupStep\('RSI_RUNTIME', \(\) => initRsiRuntime\(\)\)/);
});

test('Browser shell snapshot exposes bounded RSI observability without actuation authority', () => {
  assert.match(main, /rsi: rsiRuntime\?\.snapshot\(\)/);
  assert.match(main, /candidate_effect_executor_exposed: false/);
  assert.match(main, /physical_effect_replay_allowed: false/);
  assert.match(main, /direct_promotion_enabled: false/);
  assert.match(main, /direct_self_update_enabled: false/);
  assert.match(main, /authority_effect: false/);
});

test('RSI runtime does not contain a Browser effect executor or direct promotion/install path', () => {
  assert.doesNotMatch(runtime, /executeNativeSupervisorCommand|executeSemanticCommand|TYPED_CLICK|TYPED_TEXT|SELF_UPDATE_APPLY|autoUpdater|quitAndInstall|spawn\(/);
  assert.match(runtime, /requires_external_promotion_gate: true/);
  assert.match(runtime, /direct_promotion_enabled: false/);
  assert.match(runtime, /self_update_authority: false/);
  assert.match(runtime, /physical_effect_replay_allowed: false/);
});

test('durable RSI ledger rejects authority-bearing and sensitive payloads', () => {
  assert.match(ledger, /AUTHORITY_BOOLEAN_KEYS/);
  assert.match(ledger, /FORBIDDEN_PAYLOAD_KEYS/);
  assert.match(ledger, /handle\.sync\(\)/);
  assert.match(ledger, /hash_chained: true/);
  assert.match(ledger, /automatic_retry_allowed: false/);
});
