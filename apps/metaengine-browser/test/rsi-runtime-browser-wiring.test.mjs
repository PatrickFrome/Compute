import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const runtime = await fs.readFile(new URL('../src/rsi-runtime-service.mjs', import.meta.url), 'utf8');
const ledger = await fs.readFile(new URL('../src/rsi-runtime-ledger.mjs', import.meta.url), 'utf8');
const consoleSource = await fs.readFile(new URL('../src/rsi-operator-console.mjs', import.meta.url), 'utf8');

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


test('Browser enables trusted result reconciliation and feeds only stored receipt readback into RSI runtime', () => {
  assert.match(main, /rsiResultReceiptReconciliation:\s*true/);
  assert.match(main, /onRsiOutcomeReadback:\s*async \(\{ command, readback \}\)/);
  assert.match(main, /await initRsiRuntime\(\)/);
  assert.match(main, /await rsiRuntime\.ingestBrowserOutcome\(\{/);
  assert.match(main, /readback,/);
  // Outcome River contract: a BOUND registry binding is ingested with
  // attribution null (the service resolves + consumes the trusted binding);
  // every other command keeps the synthetic candidate-less attribution.
  assert.match(main, /rsiRuntime\.peekCommandAttribution\(\{/);
  assert.match(main, /attribution:\s*bound \? null : rsiOutcomeAttributionForCommand\(command\)/);
});

test('Outcome River binds task-attributed queued commands pre-execution and credits eligible episodes', () => {
  assert.match(main, /import \{ RsiOutcomeRiver, extractRsiCommandTaskContext \} from '\.\/rsi-outcome-river\.mjs'/);
  assert.match(main, /let rsiOutcomeRiver = null/);
  assert.match(main, /new RsiOutcomeRiver\(\{/);
  assert.match(main, /metaengine-rsi-runtime-ledger-v1\.jsonl\.outcome-river\.json/);
  // Pre-execution binding: gated on a DB command_id + declared task context,
  // wrapped so a bind failure can never gate command execution.
  assert.match(main, /if \(command\?\.command_id && extractRsiCommandTaskContext\(command\)\)/);
  assert.match(main, /rsiOutcomeRiver\?\.bindLeasedCommand\(command/);
  // Post-ingest credit assignment closes the loop (1 attributed command = 1 case).
  assert.match(main, /episode\.eligible_for_credit_assignment === true/);
  assert.match(main, /rsiOutcomeRiver\?\.creditIngestedEpisode\(episode/);
  // River observability rides the supervisor state snapshot.
  assert.match(main, /rsi_outcome_river: rsiOutcomeRiver\?\.snapshot\(\) \|\| null/);
});

test('RSI operator steering wheel exposes status/pause/resume/nominate/approve without execution authority', () => {
  assert.match(main, /import \{ RsiOperatorSteering \} from '\.\/rsi-operator-steering\.mjs'/);
  assert.match(main, /metaengine-rsi-runtime-ledger-v1\.jsonl\.operator-steering\.json/);
  // Single RSI_* entry point: every RSI_* shell command routes through the
  // operator console, which delegates the steering actions to the controller.
  assert.match(main, /command\.startsWith\('RSI_'\)/);
  assert.match(main, /rsiOperatorConsole\.execute\(command, payload\)/);
  for (const cmd of ['RSI_STATUS', 'RSI_PAUSE', 'RSI_RESUME', 'RSI_NOMINATE', 'RSI_APPROVE']) {
    assert.ok(consoleSource.includes(`'${cmd}'`), `console action list missing ${cmd}`);
  }
  // The console wires the steering provider and fails closed without it.
  assert.match(main, /ensureSteering: async \(\)/);
  assert.match(consoleSource, /rsi_operator_console_steering_unavailable/);
  // Pause gates only the learning-side credit effect; episodes still ingest.
  assert.match(main, /rsiOperatorSteering\?\.allows\?\.\('CREDIT_ASSIGNMENT'\) === false/);
  assert.match(main, /rsiOperatorSteering\.recordGateSkip\('CREDIT_ASSIGNMENT'\)/);
  assert.match(main, /rsi_operator_steering: rsiOperatorSteering\?\.snapshot\(\) \|\| null/);
});

test('generic Browser command attribution cannot manufacture candidate or skill credit', () => {
  const start = main.indexOf('function rsiOutcomeAttributionForCommand(command)');
  const end = main.indexOf('async function initNativeSupervisor()', start);
  assert.ok(start >= 0 && end > start, 'Browser outcome attribution boundary missing');
  const binding = main.slice(start, end);
  assert.match(binding, /task_signature_digest:\s*taskSignature/);
  assert.match(binding, /model_family:\s*'NATIVE_SUPERVISOR'/);
  assert.match(binding, /candidate_id:\s*null/);
  assert.match(binding, /candidate_sha:\s*null/);
  assert.match(binding, /proposal_digest:\s*null/);
  assert.match(binding, /skill_digests:\s*\[\]/);
  assert.match(binding, /external_attribution:\s*true/);
  assert.match(binding, /authored_by_candidate:\s*false/);
  assert.doesNotMatch(binding, /payload|result|page_text|input_value/);
});

test('Browser outcome bridge does not give RSI a Browser effect executor', () => {
  const start = main.indexOf('onRsiOutcomeReadback: async');
  const end = main.indexOf('if (nativeSupervisor.snapshot()?.running !== true)', start);
  assert.ok(start >= 0 && end > start, 'Browser RSI sidecar wiring missing');
  const bridge = main.slice(start, end);
  assert.doesNotMatch(bridge, /executeNativeSupervisorCommand|executeSemanticCommand|handleCommand\(/);
  assert.match(bridge, /rsiRuntime\.ingestBrowserOutcome/);
  assert.match(runtime, /candidate_effect_executor_exposed: false/);
  assert.match(runtime, /physical_effect_replay_allowed: false/);
});
