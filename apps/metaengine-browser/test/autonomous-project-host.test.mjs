import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAutonomousProjectHost } from '../src/autonomous-project-host.mjs';

const task = { task_id: '22222222-2222-4222-8222-222222222222', agent_id: 'agent_host-project-001',
  claim_id: 11, lease_generation: 1, role: 'CODER', depth: 0, state: 'LEASED',
  coordination_workspace_id: '11111111-1111-4111-8111-111111111111', base_sha: 'a'.repeat(40), branch_name: 'work/host-project',
  tab_id: 'tab_44444444-4444-4444-8444-444444444444', target_id: 'webcontents:9', agent_generation_epoch: 2 };
const projectId = '55555555-5555-4555-8555-555555555555';
const binding = { ...task, workspace_id: '33333333-3333-4333-8333-333333333333', workspace_generation: 1,
  state: 'RESERVED', lease_current: true, dirty_hold: false, ambiguity_code: null };

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'autonomous-project-host-')));
  const calls = []; let native = { runtime_control: { state: 'OPEN', continuous_service_allowed: true },
    workspace_bindings: { state: 'AVAILABLE', bindings: [binding] } };
  const supervisor = {
    snapshot: () => structuredClone(native),
    projectContinuityRequest: async ({ operation, body }) => {
      calls.push({ operation, body });
      return { schema: 'metaengine.devos.project-snapshot.v1', found: true, project_id: projectId,
        coordination_workspace_id: task.coordination_workspace_id,
        root_task_id: task.task_id, tasks: [task], selected_task: task, authority_effect: false };
    },
  };
  const hostCalls = [];
  const host = await createAutonomousProjectHost({ userDataPath: root, supervisor,
    prepareStorage: async () => root, verifyFile: async () => ({ owner_dacl_verified: true }),
    getManagedHost: () => ({ snapshot: () => ({ state: 'READY' }), executeCommand: async command => {
      hostCalls.push(command);
      return { state: 'PROVEN', authority_effect: false, automatic_retry_allowed: false,
        reservation: { workspace_id: command.payload.workspace_id, task_id: task.task_id,
          claim_id: task.claim_id, agent_id: task.agent_id, lease_generation: task.lease_generation },
        proof: { head_sha: task.base_sha, locked: true } };
    } }),
  });
  t.after(async () => { await host.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { host, calls, hostCalls, supervisor, update: patch => { native = { ...native, ...patch }; } };
}

test('host materializes current writable task through managed admission and never exposes caller paths', async t => {
  const f = await fixture(t);
  const prepared = await f.host.prepareLease(task);
  assert.equal(prepared.project_id, projectId); assert.equal(f.hostCalls.length, 1);
  assert.equal(f.hostCalls[0].action, 'PROJECT_CREATE');
  assert.deepEqual(Object.keys(f.hostCalls[0].payload).sort(), ['idempotency_key', 'coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation', 'workspace_id', 'workspace_generation'].sort());
  assert.equal(f.calls[0].operation, 'snapshot');
  assert.equal(f.calls[0].body.task_id, task.task_id);
});

test('host verifier task remains read-only and runtime control owner stop prevents work', async t => {
  const f = await fixture(t);
  await f.host.prepareLease({ ...task, role: 'CRITIC' });
  assert.equal(f.hostCalls.length, 0);
  f.update({ runtime_control: { owner_stop: true } });
  await assert.rejects(f.host.prepareLease(task), /owner_stopped/);
  assert.equal(f.hostCalls.length, 0);
});

test('new leased mutation gets a deterministic workspace through fresh managed authority without a prior observation', async t => {
  const f = await fixture(t);
  f.update({ workspace_bindings: { state: 'AVAILABLE', bindings: [] } });
  await f.host.prepareLease({ ...task, role: 'IMPLEMENTER' });
  await f.host.prepareLease({ ...task, role: 'IMPLEMENTER' });
  assert.equal(f.hostCalls.length, 2);
  assert.equal(f.hostCalls[0].payload.workspace_id, f.hostCalls[1].payload.workspace_id);
  assert.notEqual(f.hostCalls[0].payload.workspace_id, binding.workspace_id);
  assert.equal(f.hostCalls[0].payload.coordination_workspace_id, task.coordination_workspace_id);
  assert.equal(f.hostCalls[0].payload.claim_id, task.claim_id);
});

test('malformed coordination identity and authoritative CLOSED control cannot reach the physical host', async t => {
  const f = await fixture(t);
  f.update({ workspace_bindings: { state: 'AVAILABLE', bindings: [] } });
  f.supervisor.projectContinuityRequest = async () => ({ schema: 'metaengine.devos.project-snapshot.v1', found: true,
    project_id: projectId, root_task_id: task.task_id, coordination_workspace_id: 'malformed',
    tasks: [task], selected_task: task, authority_effect: false });
  await assert.rejects(f.host.prepareLease(task), /workspace|identity|project/);
  assert.equal(f.hostCalls.length, 0);
  f.update({ runtime_control: { authoritative: true, state: 'CLOSED', continuous_service_allowed: false } });
  await assert.rejects(f.host.prepareLease(task), /owner_stopped/);
  assert.equal(f.hostCalls.length, 0);
});
