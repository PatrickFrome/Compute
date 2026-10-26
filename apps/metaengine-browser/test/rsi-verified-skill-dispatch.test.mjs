import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import { RsiVerifiedSkillDispatch, RSI_DISPATCH_VERIFIER_IMPLEMENTATION as implementation, rsiVerifierDispatchContext } from '../src/rsi-verified-skill-dispatch.mjs';
import { createRsiSkillCapsule, createRsiSkillEvidence, createRsiVerifiedSkillLibrary } from '../src/rsi-verified-skill-library.mjs';
import { DevOsEffectDeliveryJournal } from '../src/devos-effect-delivery-journal.mjs';
import { DevOsNativeTaskCycle, renderDevosTaskPrompt } from '../src/devos-native-task-cycle.mjs';

// Synthetic composition fixtures only: these are NOT production skill approvals,
// real evaluator custody, measured learning or evidence of skill effectiveness.
const source = 'a'.repeat(40);
const d = char => `sha256:${char.repeat(64)}`;
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const lease = {
  task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb81', agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  role: 'CRITIC', tab_id: 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6', target_id: 'webcontents:10',
  agent_generation_epoch: 7, lease_generation: 1, base_sha: source, branch_name: 'work/synthetic-skill-dispatch',
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: 'Review evidence without expanding permissions.', constraints: ['no mutation'], deliverable: 'evidence report' },
};
const url = 'https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789abc';
const proof = { schema: 'metaengine.browser.fleet-transport-proof.v1', tab_id: lease.tab_id,
  target_id: lease.target_id, generation_epoch: 7, conversation_url: url, conversation_url_sha256: sha(url),
  agent_surface_sha256: 'b'.repeat(64), proven_at: '2026-08-31T18:00:00.000Z', authority_effect: false };
const fleet = { schema: 'metaengine.browser.fleet-snapshot.v1', readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
  policy: { warm_agents: 2, spawn_burst_limit: 4 }, agents: [{ agent_id: lease.agent_id, role: lease.role,
    lifecycle_state: 'ACTIVE', tab_id: lease.tab_id, target_id: lease.target_id, generation_epoch: 7,
    transport_proof: proof, automatic_retry_allowed: false, authority_effect: false }] };
const semref = id => ({ schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: `semref_${id.padEnd(64, '0')}` });
const response = body => ({ status: 200, ok: true, json: async () => structuredClone(body) });

async function fixture(t, { adopt = true, credit = true, capsuleOverrides = {}, negative = false, wrongContext = false, quarantined = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-dispatch-synthetic-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ledgerPath = path.join(dir, 'rsi.jsonl');
  const runtime = new RsiRuntimeService({ source_sha: source, ledgerPath });
  await runtime.start();
  const capsule = createRsiSkillCapsule({ skill_id: implementation.skill_id, version: implementation.skill_version,
    source_candidate_sha: source, role: implementation.role, capabilities: implementation.capabilities,
    input_schema_digest: implementation.input_schema_digest, output_schema_digest: implementation.output_schema_digest,
    implementation_digest: implementation.implementation_digest,
    components: [{ component_id: 'verifier.evidence-checklist.v1', kind: 'TYPED_TRANSFORM', artifact_digest: implementation.implementation_digest }],
    max_context_tokens: 4096, max_output_tokens: 1024, max_invocations: 1,
    external_builder: true, authored_by_candidate: false, ...capsuleOverrides });
  const evidence = createRsiSkillEvidence({ capsule, hidden_holdout_digest: d('1'), evaluator_root_digest: d('2'),
    unit_test_digest: d('3'), runtime_feedback_digest: d('4'), attempt_count: 12, success_count: 10,
    hard_invariants_pass: true, verified_for_library: true, evidence_refs: ['test:synthetic-only'],
    external_evaluator: true, authored_by_candidate: false });
  const library = createRsiVerifiedSkillLibrary({ library_id: 'test.synthetic.dispatch', entries: [{ capsule, evidence }], external_library_owner: true, authored_by_candidate: false });
  if (adopt) await runtime.adoptVerifiedSkillLibrary({ library, external_library_owner: true, authored_by_candidate: false });
  const context = rsiVerifierDispatchContext(lease, source);
  if (credit) {
    const candidate = await runtime.proposeCandidate({ candidate_id: 'candidate.synthetic.dispatch', parent_sha: source,
      candidate_sha: 'b'.repeat(40), mutation_surface: 'BROWSER_RUNTIME', hypothesis: 'Synthetic fixture; not production effect evidence.' });
    await runtime.beginEvaluation(candidate.candidate_id);
    const commandId = '66666666-6666-4666-8666-666666666666';
    await runtime.bindBrowserCommandAttribution({ command_id: commandId, action: 'SCROLL', platform: 'CHATGPT',
      effect_key: 'synthetic.dispatch.effect', task_id: lease.task_id, task_signature_digest: wrongContext ? d('9') : context.task_signature_digest,
      environment_fingerprint: context.environment_fingerprint, model_family: context.model_family,
      candidate_id: candidate.candidate_id, proposal_digest: d('5'), skill_digests: [capsule.skill_digest],
      trajectory_id: 'trajectory.synthetic.dispatch', step_index: 1, step_count: 1, external_planner: true, authored_by_candidate: false });
    const episode = await runtime.ingestBrowserOutcome({ readback: {
      schema: 'metaengine.rsi.result-receipt-readback.v1', command_id: commandId, found: true, terminal: true, status: 'COMPLETED',
      receipt: { schema: 'metaengine.native-supervisor.command-receipt.v2', command_id: commandId, action: 'SCROLL', platform: 'CHATGPT',
        result: { moved: true }, effect_outcome: 'CONFIRMED', lane: 'MUTATION', effect_key: 'synthetic.dispatch.effect', execution_ms: 1,
        recorded_at: '2026-09-18T18:10:00.000Z', authority_effect: false }, error: null, execution_authority: false,
      production_mutation_authority: false, promotion_authority: false, self_update_authority: false, automatic_retry_allowed: false, authority_effect: false } });
    await runtime.recordBrowserStepCredit({ episode, task_anchor: { task_id: lease.task_id,
      task_signature_digest: wrongContext ? d('9') : context.task_signature_digest, challenge_family: context.challenge_family,
      hidden_manifest_digest: d('6'), external_writer: true, authored_by_candidate: false }, credit_id: 'credit.synthetic.dispatch',
      credit_sign: negative ? 'NEGATIVE' : 'POSITIVE', credit_score: negative ? -0.5 : 0.5,
      failure_codes: negative ? ['SYNTHETIC_FAILURE'] : [], method: 'EXTERNAL_STEP_EVALUATOR', evaluator_digest: d('7'),
      evaluation_digest: d('8'), evidence_refs: ['test:synthetic-only'], skill_generation: 1,
      skill_authoring_prior: 'VERIFIED_DIRECT_SKILL', skill_authoring_provenance_digest: d('9'), skill_hard_invariant_violation: quarantined,
      external_credit_assigner: true, authored_by_candidate: false });
  }
  let allowed = true;
  const consumer = new RsiVerifiedSkillDispatch({ ensureRuntime: async () => runtime, allowsRouting: () => allowed });
  return { runtime, consumer, capsule, library, ledgerPath, pause: () => { allowed = false; },
    events: async () => (await fs.readFile(ledgerPath, 'utf8')).trim().split('\n').map(JSON.parse).filter(row => row.type.startsWith('SKILL_DISPATCH_')) };
}

function composition(consumer, { taskLease = lease, onType = null, beforeApply = null, throwSend = false, failPostSendReadback = false, effectJournal = null } = {}) {
  let typed = ''; let cycleCount = 0; let sent = false; const drafts = []; const commands = [];
  const getState = async () => ({ fleet, active_tab: { tab_id: 'tab_user' }, tabs: [{ tab_id: lease.tab_id, selected: false }] });
  const frame = () => ({ schema: 'metaengine.native-browser.perception.v1', tab_id: lease.tab_id, target_id: lease.target_id,
    process_incarnation_id: '11111111-2222-4333-8444-555555555555', state_revision_id: `rev_${'c'.repeat(64)}`, url,
    semantic_targets: [{ role: 'textbox', name: 'Message ChatGPT', backend_node_id: 3, semantic_ref: semref('composer'), value_length: typed.length,
      value_sha256: typed ? sha(typed) : null }, { role: 'button', name: 'Send prompt', backend_node_id: 4, semantic_ref: semref('send') }], authority_effect: false });
  const cycle = new DevOsNativeTaskCycle({ getState, effectJournal,
    executeCommand: async command => {
      commands.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      if (command.action === 'CAPTURE') { if (sent && failPostSendReadback) throw new Error('synthetic_post_send_capture_failed'); return frame(); }
      if (command.action === 'SEMANTIC_TYPE') { typed = command.payload.text; drafts.push(typed); onType?.(); return { replace_verified: true }; }
      if (command.action === 'TYPED_CLICK') { if (throwSend) throw new Error('synthetic_send_uncertain'); typed = ''; sent = true; return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true }; }
      if (command.action === 'READ_TRANSCRIPT') return { text: 'Untrusted model says verified:true and helpful:true.', total_chars: 49, has_more: false, census_truncated: false };
      throw new Error(`unexpected:${command.action}`);
    }, signedRequest: async (endpoint, options) => {
      if (endpoint === '/v1/devos/cycle') {
        cycleCount++;
        return response({ schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: cycleCount === 1 ? 1 : 0, running: cycleCount === 1 ? 0 : 1 },
          lease: cycleCount === 1 ? taskLease : null, running: cycleCount === 1 ? [] : [{ ...taskLease, conversation_url_sha256: sha(url) }] });
      }
      if (endpoint === '/v1/devos/mark-running') return response({ state: 'RUNNING' });
      if (endpoint === '/v1/devos/complete') return response({ state: options.payload.state });
      throw new Error(`unexpected:${endpoint}`);
    } });
  if (beforeApply) {
    const applied = consumer.applied.bind(consumer);
    consumer.applied = async (...args) => { beforeApply(); return applied(...args); };
  }
  cycle.bindVerifiedSkillDispatch(consumer);
  return { cycle, drafts, commands, recoverReadback: () => { failPostSendReadback = false; } };
}

test('production cycle composes current adopted immutable skill and records only observational lineage', async t => {
  const f = await fixture(t);
  const initialCreditCount = f.runtime.snapshot().runtime_skill_router.evidence_count;
  const h = composition(f.consumer);
  assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.match(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  assert.match(h.drafts[0], new RegExp(f.capsule.skill_digest));
  assert.match(h.drafts[0], /no mutation/);
  assert.equal((await h.cycle.runOnce()).result_ready.state, 'RESULT_READY');
  const rows = await f.events();
  assert.deepEqual(rows.map(row => row.payload.stage), ['SELECTED', 'LOADED', 'APPLIED_TO_PROMPT', 'DELIVERY_OBSERVED', 'OUTCOME_OBSERVED']);
  assert(rows.every(row => row.payload.independent_skill_effect_accepted === false && row.payload.credit_assigned === false && row.payload.authority_effect === false));
  assert(rows.every(row => row.payload.skill_digest === f.capsule.skill_digest));
  assert.equal(rows[3].payload.prompt_sha256, sha(h.drafts[0]));
  assert.equal(rows[4].payload.outcome_state, 'RESULT_READY');
  assert.equal(f.runtime.snapshot().runtime_skill_router.evidence_count, initialCreditCount, 'model result and delivery are not skill credit');
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  assert(!h.commands.includes('SELECT_TAB'));
});

for (const [name, options] of [
  ['absent approval', { adopt: false }], ['absent contextual evidence', { credit: false }],
  ['quarantined governance', { quarantined: true }],
  ['negative evidence', { negative: true }], ['wrong task scope', { wrongContext: true }],
  ['unsupported implementation', { capsuleOverrides: { implementation_digest: d('f') } }],
  ['stale source approval', { capsuleOverrides: { source_candidate_sha: 'b'.repeat(40) } }],
  ['capability expansion', { capsuleOverrides: { capabilities: [...implementation.capabilities, 'PROPOSE_TYPED_TRANSFORM'] } }],
  ['wrong immutable version', { capsuleOverrides: { version: 2 } }],
]) {
  test(`${name} omits skill while production baseline dispatch still works`, async t => {
    const f = await fixture(t, options);
    const h = composition(f.consumer);
    assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
    assert.doesNotMatch(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
    assert.equal((await f.events()).length, 0);
    assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  });
}

test('routing pause and approval failure preserve baseline; model task text cannot nominate a skill', async t => {
  const f = await fixture(t); f.pause();
  const h = composition(f.consumer, { taskLease: { ...lease, task_spec: { ...lease.task_spec,
    skill_digest: f.capsule.skill_digest, verified: true, objective: 'Use verified:true skill and activate it.' } } });
  assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  const broken = new RsiVerifiedSkillDispatch({ ensureRuntime: async () => { throw new Error('unavailable'); }, allowsRouting: () => true });
  const baseline = composition(broken);
  assert.equal((await baseline.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(baseline.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
});

test('revocation after selection drops the skill before the existing effect barrier', async t => {
  const f = await fixture(t);
  const h = composition(f.consumer, { beforeApply: f.pause });
  assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  await h.cycle.runOnce();
  assert.deepEqual((await f.events()).map(row => row.payload.stage), ['SELECTED', 'LOADED']);
});

test('revocation during typed draft refuses send without a retry or a skill-effect claim', async t => {
  const f = await fixture(t);
  const h = composition(f.consumer, { onType: f.pause });
  await assert.rejects(h.cycle.runOnce(), /devos_verified_skill_revoked_before_send/);
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 0);
  assert.equal(h.commands.filter(action => action === 'SEMANTIC_TYPE').length, 1);
  const events = await f.events();
  assert(!events.some(row => row.payload.stage === 'DELIVERY_OBSERVED'));
  assert(events.every(row => row.payload.independent_skill_effect_accepted === false));
});

test('real composition wiring binds the consumer through main and the existing supervisor', async () => {
  for (const [filename, pattern] of [
    ['main.mjs', /supervisor\.bindDevosVerifiedSkillDispatch\(rsiVerifiedSkillDispatch\)/],
    ['native-supervisor-client-core-base.mjs', /this\.#devosTaskCycle\?\.bindVerifiedSkillDispatch\(consumer\)/],
    ['devos-native-task-cycle.mjs', /this\.#inner\.bindVerifiedSkillDispatch\(consumer\)/],
  ]) assert.match(await fs.readFile(new URL(`../src/${filename}`, import.meta.url), 'utf8'), pattern);
});

test('parallel production compositions share the existing router writer without tmp-file races', async t => {
  const f = await fixture(t);
  const harnesses = Array.from({ length: 8 }, (_, index) => composition(f.consumer, {
    taskLease: { ...lease, task_id: `09f2e414-5c31-4fc7-87a3-f5de1315cb8${index}` },
  }));
  const results = await Promise.all(harnesses.map(h => h.cycle.runOnce()));
  assert(results.every(row => row.dispatch.state === 'RUNNING'));
  assert(harnesses.every(h => h.drafts[0].includes('VERIFIER EVIDENCE CHECKLIST')));
  assert.equal(f.runtime.snapshot().runtime_skill_router.route_count, 8);
  assert.equal((await f.events()).filter(row => row.payload.stage === 'DELIVERY_OBSERVED').length, 8);
});

test('tampered persisted/readback approval is not replaced by a verified boolean or task skill id', async t => {
  const f = await fixture(t);
  const original = f.runtime.verifiedSkillStateReadback.bind(f.runtime);
  f.runtime.verifiedSkillStateReadback = () => {
    const row = structuredClone(original());
    row.library.entries[0].capsule.implementation_digest = d('f');
    row.library.entries[0].verified = true;
    return row;
  };
  const h = composition(f.consumer);
  assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
});

test('failed audit persistence omits skill; uncertain send is never turned into accepted skill effect', async t => {
  const f = await fixture(t);
  f.runtime.recordSkillDispatchObservation = async () => { throw new Error('synthetic_audit_write_failed'); };
  const fallback = composition(f.consumer);
  assert.equal((await fallback.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(fallback.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  const uncertain = await fixture(t);
  const h = composition(uncertain.consumer, { throwSend: true });
  await assert.rejects(h.cycle.runOnce(), /synthetic_send_uncertain/);
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  assert(!(await uncertain.events()).some(row => row.payload.stage === 'DELIVERY_OBSERVED'));
  assert.equal(uncertain.runtime.snapshot().runtime_skill_router.evidence_count, 1);
});


test('optional skill instructions never push a baseline task over its prompt budget', () => {
  const task = { ...lease, task_spec: { ...lease.task_spec, objective: 'x'.repeat(12000), constraints: Array(10).fill('y'.repeat(1000)), deliverable: 'z'.repeat(1000) } };
  const baseline = renderDevosTaskPrompt(task);
  assert(baseline.length > 22800 && baseline.length <= 24000);
  assert.equal(renderDevosTaskPrompt(task, { verified_skill: 's'.repeat(1200) }), baseline);
  const bounded = renderDevosTaskPrompt(lease, { verified_skill: 's'.repeat(10000) });
  assert.equal(bounded.length - renderDevosTaskPrompt(lease).length, 1202);
});


test('post-send readback failures cannot permanently exhaust observational skill tracking', async t => {
  const f = await fixture(t);
  const abandoned = [];
  for (let index = 0; index < 128; index++) {
    const taskLease = { ...lease, task_id: `09f2e414-5c31-4fc7-87a3-${index.toString(16).padStart(12, '0')}` };
    const h = composition(f.consumer, { taskLease, failPostSendReadback: true });
    await assert.rejects(h.cycle.runOnce(), /synthetic_post_send_capture_failed/);
    assert.match(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
    assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
    abandoned.push({ h, taskLease });
  }
  const next = composition(f.consumer);
  assert.equal((await next.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.match(next.drafts[0], /VERIFIER EVIDENCE CHECKLIST/, 'abandoned observation metadata must never become a permanent activation veto');
  const observations = await f.events();
  assert.equal(observations.filter(row => row.payload.stage === 'OUTCOME_OBSERVED').length, 0);
  assert.equal(f.runtime.snapshot().runtime_skill_router.evidence_count, 1);
  assert.equal(f.consumer.snapshot().pending_observation_count, 128);
  const releases = observations.filter(row => row.payload.stage === 'TRACKING_RELEASED');
  assert.equal(releases.length, 1);
  assert.equal(releases[0].payload.task_id, abandoned[0].taskLease.task_id);
  assert.equal(releases[0].payload.outcome_status, 'UNOBSERVED');
  assert.equal(releases[0].payload.unknown_effect_resolved, false);
  assert.equal(releases[0].payload.task_lifecycle_changed, false);
  assert.equal(releases[0].payload.effect_state_changed, false);
  const record = f.runtime.recordSkillDispatchObservation.bind(f.runtime);
  let failedReleaseWrites = 0;
  f.runtime.recordSkillDispatchObservation = async observation => {
    if (observation.stage === 'TRACKING_RELEASED' && failedReleaseWrites === 0) {
      failedReleaseWrites++;
      throw new Error('synthetic_release_audit_failed');
    }
    return record(observation);
  };
  const failedRelease = composition(f.consumer, { taskLease: { ...lease, task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  assert.equal((await failedRelease.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(failedRelease.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  assert.equal(f.consumer.snapshot().pending_observation_count, 127);
  const recoveredCapacity = composition(f.consumer, { taskLease: { ...lease, task_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } });
  assert.equal((await recoveredCapacity.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.match(recoveredCapacity.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  assert.equal(f.consumer.snapshot().pending_observation_count, 128);
  assert.equal(failedReleaseWrites, 1, 'metadata cleanup must not retry an uncertain release audit');
  // The observation slot was released, not the task/effect. A later existing
  // running-task readback still cannot invent a lost prompt-delivery binding.
  abandoned[0].h.recoverReadback();
  assert.equal((await abandoned[0].h.cycle.runOnce()).result_ready.state, 'RESULT_READY');
  assert.equal(abandoned[0].h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  const recovered = (await f.events()).filter(row => row.payload.stage === 'OUTCOME_OBSERVED');
  assert.equal(recovered.length, 0, 'no durable delivery binding exists for the evicted post-send failure');
  await f.consumer.discard(abandoned[0].taskLease);
  const firstHistory = (await f.events()).filter(row => row.payload.task_id === abandoned[0].taskLease.task_id);
  assert.equal(firstHistory.at(-1).payload.release_reason, 'COMPOSITION_DISCARDED');
  assert.equal(await f.consumer.outcome(abandoned[0].taskLease, 'RESULT_READY'), false);
  assert.equal(f.runtime.snapshot().runtime_skill_router.evidence_count, 1);
});


test('restart recovers only bounded durable observation lineage and never replays a task effect', async t => {
  const f = await fixture(t);
  const h = composition(f.consumer);
  await h.cycle.runOnce();
  const restartedRuntime = new RsiRuntimeService({ source_sha: source, ledgerPath: f.ledgerPath });
  await restartedRuntime.start();
  const restarted = new RsiVerifiedSkillDispatch({ ensureRuntime: async () => restartedRuntime, allowsRouting: () => true });
  h.cycle.bindVerifiedSkillDispatch(restarted);
  assert.equal(restarted.snapshot().pending_observation_count, 0);
  assert.equal((await h.cycle.runOnce()).result_ready.state, 'RESULT_READY');
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  const outcomes = (await f.events()).filter(row => row.payload.stage === 'OUTCOME_OBSERVED');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].payload.prompt_sha256, sha(h.drafts[0]));
  assert.equal(outcomes[0].payload.independent_skill_effect_accepted, false);
  assert.equal(await restarted.outcome(lease, 'COMPLETED'), false, 'terminal observation readback must not fabricate another result');
});

test('unavailable recent lineage stays unknown instead of being invented after restart', async t => {
  const f = await fixture(t);
  const h = composition(f.consumer);
  await h.cycle.runOnce();
  const restarted = new RsiVerifiedSkillDispatch({ ensureRuntime: async () => f.runtime, allowsRouting: () => true });
  f.runtime.skillDispatchObservationReadback = () => null;
  h.cycle.bindVerifiedSkillDispatch(restarted);
  assert.equal((await h.cycle.runOnce()).result_ready.state, 'RESULT_READY');
  assert.equal((await f.events()).filter(row => row.payload.stage === 'OUTCOME_OBSERVED').length, 0);
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  assert.equal(f.runtime.snapshot().runtime_skill_router.evidence_count, 1);
});


test('recovery rejects another lease generation, target and source without changing task authority', async t => {
  const f = await fixture(t);
  const h = composition(f.consumer);
  await h.cycle.runOnce();
  const recovered = new RsiVerifiedSkillDispatch({ ensureRuntime: async () => f.runtime, allowsRouting: () => true });
  assert.equal(await recovered.outcome({ ...lease, lease_generation: 2 }, 'RESULT_READY'), false);
  assert.equal(await recovered.outcome({ ...lease, target_id: 'webcontents:99' }, 'RESULT_READY'), false);
  const delivery = (await f.events()).find(row => row.payload.stage === 'DELIVERY_OBSERVED');
  const differentSourceLedger = `${f.ledgerPath}.different-source`;
  await fs.copyFile(f.ledgerPath, differentSourceLedger);
  const differentSource = new RsiRuntimeService({ source_sha: 'b'.repeat(40), ledgerPath: differentSourceLedger });
  await differentSource.start();
  assert.equal(differentSource.skillDispatchObservationReadback(delivery.payload.dispatch_digest), null);
  assert.equal((await f.events()).filter(row => row.payload.stage === 'OUTCOME_OBSERVED').length, 0);
});

test('crash after composition but before send cannot attribute a restarted baseline result to the skill', async t => {
  const f = await fixture(t);
  const selection = await f.consumer.prepare(lease);
  const skillPrompt = renderDevosTaskPrompt(lease, { verified_skill: selection.block });
  assert.equal(await f.consumer.applied(lease, selection, skillPrompt), true);
  const restartedRuntime = new RsiRuntimeService({ source_sha: source, ledgerPath: f.ledgerPath });
  await restartedRuntime.start();
  const restarted = new RsiVerifiedSkillDispatch({ ensureRuntime: async () => restartedRuntime, allowsRouting: () => false });
  const h = composition(restarted);
  assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  assert.equal((await h.cycle.runOnce()).result_ready.state, 'RESULT_READY');
  assert.equal((await f.events()).filter(row => row.payload.stage === 'OUTCOME_OBSERVED').length, 0);
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
});

test('capacity-released delivered lineage remains recoverable without resolving or replaying another effect', async t => {
  const f = await fixture(t);
  let first = null;
  for (let index = 0; index < 129; index++) {
    const taskLease = { ...lease, task_id: `19f2e414-5c31-4fc7-87a3-${index.toString(16).padStart(12, '0')}` };
    const h = composition(f.consumer, { taskLease });
    assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
    if (index === 0) first = h;
  }
  const release = (await f.events()).find(row => row.payload.stage === 'TRACKING_RELEASED');
  assert.equal(release.payload.delivery_observed, true);
  assert.equal(release.payload.prompt_sha256, sha(first.drafts[0]));
  assert.equal(release.payload.unknown_effect_resolved, false);
  assert.equal(f.consumer.snapshot().pending_observation_count, 128);
  assert.equal((await first.cycle.runOnce()).result_ready.state, 'RESULT_READY');
  assert.equal(first.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  const outcomes = (await f.events()).filter(row => row.payload.stage === 'OUTCOME_OBSERVED');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].payload.prompt_sha256, sha(first.drafts[0]));
  assert.equal(outcomes[0].payload.outcome_is_skill_usage_evidence, false);
  assert.equal(f.runtime.snapshot().runtime_skill_router.evidence_count, 1);
});


test('retained pre-send lineage cannot claim a later same-process baseline result', async t => {
  const f = await fixture(t);
  const selection = await f.consumer.prepare(lease);
  assert.equal(await f.consumer.applied(lease, selection, renderDevosTaskPrompt(lease, { verified_skill: selection.block })), true);
  f.pause();
  const h = composition(f.consumer);
  assert.equal((await h.cycle.runOnce()).dispatch.state, 'RUNNING');
  assert.doesNotMatch(h.drafts[0], /VERIFIER EVIDENCE CHECKLIST/);
  assert.equal((await h.cycle.runOnce()).result_ready.state, 'RESULT_READY');
  assert.equal((await f.events()).filter(row => row.payload.stage === 'OUTCOME_OBSERVED').length, 0);
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
});


test('observation eviction and discard leave the real unresolved effect journal byte-identical', async t => {
  const f = await fixture(t);
  const journalPath = `${f.ledgerPath}.effect-journal`;
  const journal = new DevOsEffectDeliveryJournal({ statePath: journalPath });
  const h = composition(f.consumer, { effectJournal: journal, failPostSendReadback: true });
  await assert.rejects(h.cycle.runOnce(), /synthetic_post_send_capture_failed/);
  const before = await fs.readFile(journalPath, 'utf8');
  assert.equal(journal.recoveryCandidates(1).length, 1);
  for (let index = 0; index < 128; index++) {
    const taskLease = { ...lease, task_id: `29f2e414-5c31-4fc7-87a3-${index.toString(16).padStart(12, '0')}` };
    const selection = await f.consumer.prepare(taskLease);
    assert(selection);
    assert.equal(await f.consumer.applied(taskLease, selection, renderDevosTaskPrompt(taskLease, { verified_skill: selection.block })), true);
  }
  assert.equal(await fs.readFile(journalPath, 'utf8'), before);
  await f.consumer.discard(lease);
  assert.equal(await fs.readFile(journalPath, 'utf8'), before);
  const reload = new DevOsEffectDeliveryJournal({ statePath: journalPath });
  await reload.init();
  const unresolved = reload.recoveryCandidates(1);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].state, 'DELIVERY_PENDING');
  assert.equal(unresolved[0].automatic_retry_allowed, false);
  assert.equal(h.commands.filter(action => action === 'TYPED_CLICK').length, 1);
  assert.equal(f.consumer.snapshot().pending_observation_count, 128);
});
