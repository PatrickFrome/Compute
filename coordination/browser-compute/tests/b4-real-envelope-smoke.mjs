import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { captureComputePerceptionEnvelope } from '../src/perception-envelope.mjs';

const executablePath = process.env.A2_CHROME_EXECUTABLE;
if (!executablePath) throw new Error('b4_smoke_chrome_executable_required');

const stateRoot = process.env.A2_COMPUTE_STATE_ROOT || await fs.mkdtemp(path.join(os.tmpdir(), 'a2-b4-envelope-'));
const runtime = await new ComputeBrowserRuntime({
  stateRoot,
  engineExecutable: executablePath,
  headlessDefault: true,
  allowNoSandbox: process.env.A2_CI_ALLOW_NO_SANDBOX === '1'
}).init();

const profileId = `b4-envelope-${process.pid}`;
const targetId = 'b4_envelope_target';
try {
  await runtime.startProfile({ profileId });
  const target = await runtime.createTarget({ profileId, targetId, contextId: 'default', role: 'CI_B4', url: 'about:blank' });
  const entry = runtime.running.get(profileId);
  assert.ok(entry?.sessionScheduler);
  const binding = entry.bindings.get(targetId);
  assert.ok(binding?.cdp_target_id);
  const identity = {
    targetId,
    cdpTargetId: binding.cdp_target_id,
    conversationEpoch: target.conversation_epoch,
    processIncarnationId: entry.processRef.processIncarnationId
  };

  const first = await captureComputePerceptionEnvelope({
    scheduler: entry.sessionScheduler,
    identity,
    contextId: 'default',
    nodeKey: entry.perceptionNodeKey,
    capturedAt: '2026-08-28T00:00:00.000Z'
  });
  const second = await captureComputePerceptionEnvelope({
    scheduler: entry.sessionScheduler,
    identity,
    contextId: 'default',
    nodeKey: entry.perceptionNodeKey,
    capturedAt: '2026-08-28T00:00:01.000Z'
  });

  assert.equal(first.envelope.schema, 'metaengine.a2-browser-operator.perception-envelope.v1');
  assert.equal(first.envelope.source_surface, 'COMPUTE_BROWSER');
  assert.equal(first.envelope.target_id, targetId);
  assert.equal(first.envelope.context_id, 'default');
  assert.equal(first.envelope.conversation_epoch, target.conversation_epoch);
  assert.equal(first.envelope.document_epoch, second.envelope.document_epoch);
  assert.equal(first.envelope.tainted_page_data, true);
  assert.equal(first.envelope.authority_effect, false);
  assert.equal(first.envelope.actuation_eligible, false);
  assert.equal(first.envelope.evidence.visibility, 'POSITIVE_ONLY');
  assert.equal(first.envelope.evidence.oopif, 'PARTIAL');

  const serialized = JSON.stringify(first.envelope);
  assert.doesNotMatch(serialized, new RegExp(binding.cdp_target_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, new RegExp(entry.processRef.processIncarnationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, /loaderId|session_generation|process_incarnation|cdp_target|backendDOMNodeId/);

  console.log(JSON.stringify({
    schema: 'metaengine.a2-browser-operator.b4-real-envelope-smoke.v1',
    ok: true,
    document_epoch_stable: true,
    raw_engine_identity_exposed: false,
    remote_navigation_used: false,
    actuation_used: false,
    node_count: first.envelope.nodes.length
  }));
} finally {
  await runtime.shutdown().catch(() => {});
  if (process.env.A2_SELF_TEST_REMOVE_STATE === '1') await fs.rm(stateRoot, { recursive: true, force: true }).catch(() => {});
}
