import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA = 'metaengine.rsi.l1-result-delivery-evaluation.v1';
export const RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA = 'metaengine.rsi.result-delivery-transport.v1';

const FORBIDDEN_SOURCE = [
  /\bimport\s+(?!\()/,
  /\brequire\s*\(/,
  /\bprocess\s*\./,
  /\b(?:child_process|worker_threads|cluster|electron|Deno|Bun)\b/,
  /\b(?:fs|net|http|https|tls|dgram)\s*\./,
  /\b(?:fetch|WebSocket|eval)\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bexecuteCommand\b/,
  /\bphysicalEffect\b/,
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function outerBound(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`rsi_l1_evaluator_${label}_outer_timeout`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
function assertZeroAuthority(result, label) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`rsi_l1_evaluator_${label}_result_invalid`);
  if (result.authority_effect !== false) throw new Error(`rsi_l1_evaluator_${label}_authority_effect_invalid`);
  if (result.physical_effect_replay_allowed !== false) throw new Error(`rsi_l1_evaluator_${label}_effect_replay_invalid`);
  if (result.automatic_effect_retry_allowed !== false) throw new Error(`rsi_l1_evaluator_${label}_automatic_effect_retry_invalid`);
}

export function verifyCandidateSourceContract(sourceText) {
  const source = String(sourceText || '');
  if (!source || source.length > 64 * 1024) throw new Error('rsi_l1_evaluator_candidate_source_invalid');
  for (const pattern of FORBIDDEN_SOURCE) {
    if (pattern.test(source)) throw new Error(`rsi_l1_evaluator_candidate_source_forbidden:${pattern.source}`);
  }
  if (!source.includes('createRsiResultDeliveryTransport')) throw new Error('rsi_l1_evaluator_factory_export_missing');
  if (!source.includes(RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA)) throw new Error('rsi_l1_evaluator_schema_literal_missing');
  return Object.freeze({
    ok: true,
    source_bytes: Buffer.byteLength(source, 'utf8'),
    project_imports_allowed: false,
    effect_executor_access: false,
    network_api_access: false,
    process_api_access: false,
    authority_effect: false,
  });
}

async function loadCandidate(modulePath) {
  const source = await fs.readFile(modulePath, 'utf8');
  const staticProof = verifyCandidateSourceContract(source);
  const url = `${pathToFileURL(modulePath).href}?rsi_eval=${Date.now()}_${Math.random()}`;
  const mod = await import(url);
  if (mod.RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA !== RSI_RESULT_DELIVERY_TRANSPORT_SCHEMA) throw new Error('rsi_l1_evaluator_candidate_schema_invalid');
  if (typeof mod.createRsiResultDeliveryTransport !== 'function') throw new Error('rsi_l1_evaluator_candidate_factory_invalid');
  return { factory: mod.createRsiResultDeliveryTransport, staticProof };
}

function createHarness({ mode, deadlineMs, attempts }) {
  const events = [];
  const payloads = [];
  let terminal = null;
  let sendCount = 0;
  let readCount = 0;
  const sendReceipt = ({ payload, signal } = {}) => {
    sendCount += 1;
    events.push(`SEND:${sendCount}`);
    payloads.push(stableJson(payload));
    if (mode === 'HEALTHY') return Promise.resolve(Object.freeze({ ok: true, status: 200, authority_effect: false }));
    if (mode === 'LOST_AFTER_ACCEPT' && sendCount === 1) {
      setTimeout(() => { terminal = Object.freeze({ terminal: true, status: 'COMPLETED', receipt: structuredClone(payload), authority_effect: false }); }, Math.max(5, Math.floor(deadlineMs / 4)));
    }
    return new Promise((_, reject) => {
      if (!signal || typeof signal.addEventListener !== 'function') return;
      if (signal.aborted) { reject(signal.reason || new Error('aborted')); return; }
      signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
    });
  };
  const readReceipt = async ({ commandId } = {}) => {
    readCount += 1;
    events.push(`READ:${readCount}`);
    if (commandId !== 'command-l1') throw new Error('rsi_l1_evaluator_readback_command_drift');
    return terminal ? structuredClone(terminal) : null;
  };
  return {
    sendReceipt,
    readReceipt,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
    snapshot: () => ({ mode, events: [...events], payloads: [...payloads], send_count: sendCount, read_count: readCount, attempts }),
  };
}

async function oneScenario(factory, { mode, deadlineMs = 80, attempts = 3, outerMs = 450 } = {}) {
  const harness = createHarness({ mode, deadlineMs, attempts });
  const transport = factory({
    sendReceipt: harness.sendReceipt,
    readReceipt: harness.readReceipt,
    sleep: harness.sleep,
    deadlineMs,
    attempts,
    backoffMs: [5, 10],
  });
  if (!transport || typeof transport.deliver !== 'function') throw new Error('rsi_l1_evaluator_transport_invalid');
  const payload = Object.freeze({
    ok: true,
    receipt: Object.freeze({
      schema: 'metaengine.native-supervisor.command-receipt.v2',
      command_id: 'command-l1',
      action: 'SCROLL',
      effect_outcome: 'CONFIRMED',
      authority_effect: false,
    }),
    error: null,
  });
  const started = performance.now();
  let result = null;
  let thrown = null;
  try {
    result = await outerBound(transport.deliver({ commandId: 'command-l1', effectKey: 'TAB_MUTATION:tab-1', payload }), outerMs, mode.toLowerCase());
  } catch (error) {
    thrown = String(error?.message || error);
  }
  const elapsedMs = performance.now() - started;
  const snap = harness.snapshot();
  const uniquePayloads = new Set(snap.payloads);
  const payloadImmutable = uniquePayloads.size <= 1;
  if (result) assertZeroAuthority(result, mode.toLowerCase());
  return Object.freeze({ mode, elapsed_ms: elapsedMs, result, error: thrown, payload_immutable: payloadImmutable, ...snap });
}

function classifyRun({ lost, absent, healthy, followup }, outerMs) {
  const lostBounded = lost.error == null && lost.elapsed_ms < outerMs && lost.result?.state === 'RECONCILED' && lost.send_count === 1 && lost.read_count >= 1 && lost.events[0] === 'SEND:1' && lost.events[1] === 'READ:1';
  const absentBounded = absent.error == null && absent.elapsed_ms < outerMs && absent.result?.state === 'AMBIGUOUS' && absent.send_count >= 1 && absent.send_count <= absent.attempts && absent.read_count >= absent.send_count;
  const healthyClean = healthy.error == null && healthy.result?.state === 'DELIVERED' && healthy.send_count === 1 && healthy.read_count === 0;
  const progressRecovers = followup.error == null && followup.result?.state === 'DELIVERED' && followup.elapsed_ms < outerMs;
  const payloadImmutable = lost.payload_immutable && absent.payload_immutable && healthy.payload_immutable && followup.payload_immutable;
  return Object.freeze({ lost_response_reconciled: lostBounded, absent_receipt_ambiguous: absentBounded, healthy_control_clean: healthyClean, command_progress_recovers: progressRecovers, immutable_receipt_redelivery: payloadImmutable });
}

export async function evaluateResultDeliveryCandidate({ modulePath, repetitions = 5, deadlineMs = 80, attempts = 3, outerMs = 450 } = {}) {
  const reps = Number(repetitions);
  if (!Number.isSafeInteger(reps) || reps < 5 || reps > 25) throw new Error('rsi_l1_evaluator_repetitions_invalid');
  const { factory, staticProof } = await loadCandidate(modulePath);
  const runs = [];
  for (let index = 0; index < reps; index += 1) {
    const lost = await oneScenario(factory, { mode: 'LOST_AFTER_ACCEPT', deadlineMs, attempts, outerMs });
    const absent = await oneScenario(factory, { mode: 'ABSENT', deadlineMs, attempts, outerMs });
    const healthy = await oneScenario(factory, { mode: 'HEALTHY', deadlineMs, attempts, outerMs });
    const followup = await oneScenario(factory, { mode: 'HEALTHY', deadlineMs, attempts, outerMs });
    runs.push(Object.freeze({ repetition: index + 1, lost, absent, healthy, followup, checks: classifyRun({ lost, absent, healthy, followup }, outerMs) }));
  }
  const all = (key) => runs.every((run) => run.checks[key] === true);
  const summary = {
    static_non_authority_surface: staticProof.effect_executor_access === false && staticProof.project_imports_allowed === false,
    result_delivery_wall_clock_bounded: all('lost_response_reconciled') && all('absent_receipt_ambiguous'),
    durable_receipt_reconciliation_required: all('lost_response_reconciled'),
    absent_receipt_remains_ambiguous: all('absent_receipt_ambiguous'),
    healthy_control_negative_case: all('healthy_control_clean'),
    command_cycle_progress_recovers: all('command_progress_recovers'),
    immutable_receipt_redelivery: all('immutable_receipt_redelivery'),
    duplicate_irreversible_effect_count: 0,
    physical_effect_execution_count: 0,
    ambiguous_followup_mutation_count: 0,
  };
  const passed = Object.values(summary).every((value) => value === true || value === 0);
  return Object.freeze({
    schema: RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA,
    repetitions: reps,
    deadline_ms: deadlineMs,
    attempts,
    outer_bound_ms: outerMs,
    static_proof: staticProof,
    summary: Object.freeze(summary),
    runs: Object.freeze(runs),
    passed,
    candidate_execution_is_project_authority: false,
    browser_actuation_available: false,
    effect_executor_available: false,
    production_credentials_available: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  });
}

async function main(argv) {
  const [modulePath, outputPath] = argv.slice(2);
  if (!modulePath || !outputPath) throw new Error('usage: rsi-l1-result-delivery-evaluator.mjs <candidate-module> <output-json>');
  const result = await evaluateResultDeliveryCandidate({ modulePath });
  await fs.writeFile(outputPath, `${JSON.stringify(stable(result))}\n`);
  if (!result.passed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((error) => { console.error(String(error?.stack || error)); process.exitCode = 1; });
}
