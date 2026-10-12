import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createWorkspaceReservation } from '../src/workspace-manager.mjs';
import { createManagedTaskProjectAuthorityResolver, createManagedTaskProjectBindingTransport, createManagedTaskProjectRepositoryProvisioner, managedProjectEffectKey } from '../src/managed-task-project-authority-resolver.mjs';
import { createManagedProjectRoutes } from '../supabase/a2-browser-native-supervisor-v1/managed-project-routes.mjs';

const device = { ok: true, id: 'project-test-client', device_id: 'dddddddd-1111-4111-8111-111111111111', admin_grant_epoch: 1, access_tier: 'ADMIN', admin_ready: true };
const claim = { coordination_workspace_id: '11111111-1111-4111-8111-111111111111', task_id: '22222222-2222-4222-8222-222222222222', agent_id: 'agent_project-test-001', claim_id: 10, claim_class: 'MUTATING', point_id: 'project.test', base_sha: 'a'.repeat(40), branch_name: 'work/project-test', tab_id: 'tab_project-test-001', target_id: 'webcontents:3', agent_generation_epoch: 2, lease_generation: 1, lease_expires_at: new Date(Date.now() + 600000).toISOString() };
const binding = createWorkspaceReservation({ claim, trusted_repo: { repo_id: 'github:test/project', repo_root: path.resolve('fixture-repo') }, workspace_root: path.resolve('fixture-projects'), workspace_id: '33333333-3333-4333-8333-333333333333', worktree_id: '44444444-4444-4444-8444-444444444444' });
const request = { idempotency_key: 'test:project:create', coordination_workspace_id: claim.coordination_workspace_id, task_id: claim.task_id, agent_id: claim.agent_id, claim_id: claim.claim_id, lease_generation: 1, workspace_id: binding.workspace_id, workspace_generation: 1 };
const admission = () => ({ schema: 'metaengine.devos.managed-project-admission.v1', authoritative: true, active: true, claim: structuredClone(claim), workspace_binding: structuredClone(binding), device_id: device.device_id, client_id: device.id, admin_grant_epoch: 1, scheduler_authority: false, browser_actuation_authority: false, automatic_retry_allowed: false, authority_effect: false });
const repoConfig = { schema: 'metaengine.devos.managed-project-repository-config.v1', coordination_workspace_id: claim.coordination_workspace_id, repo_id: binding.repo_id, repo_root: binding.repo_root, managed_root: binding.managed_root };

test('host-owned effect key unifies caller keys but preserves workspace and lease generations', () => {
  const key = managedProjectEffectKey(request);
  assert.equal(key, `project:${request.workspace_id}:g1:l1`);
  assert.equal(managedProjectEffectKey({ ...request, idempotency_key: 'another:caller:key' }), key);
  assert.equal(managedProjectEffectKey({ ...request, workspace_id: request.workspace_id.toUpperCase() }), key);
  assert.notEqual(managedProjectEffectKey({ ...request, workspace_generation: 2 }), key);
  assert.notEqual(managedProjectEffectKey({ ...request, lease_generation: 2 }), key);
  assert.throws(() => managedProjectEffectKey({ ...request, repo_root: '/caller/path' }), /request_invalid/);
  assert.throws(() => managedProjectEffectKey({ ...request, lease_generation: '1' }), /identity_invalid/);
});

test('signed project route injects exact device grant and sends identity-only RPC args', async () => {
  const calls = [];
  const routes = createManagedProjectRoutes({ workspaceId: claim.coordination_workspace_id, rpc: async (name, args) => { calls.push({ name, args }); return admission(); } });
  const response = await routes({ req: { method: 'POST' }, path: '/v1/devos/project-admission', body: request, identity: device });
  assert.equal(response.status, 200);
  assert.equal(calls[0].name, 'h205f22_a2_managed_project_admission_v1');
  assert.equal(calls[0].args.p_device_id, device.device_id);
  assert.equal(calls[0].args.p_client_id, device.id);
  assert.equal(calls[0].args.p_admin_grant_epoch, 1);
  assert.equal(Object.keys(calls[0].args).length, 10);
  assert(!Object.keys(calls[0].args).some(key => /path|root|argv|payload|spec/.test(key)));
  assert.equal(await routes({ req: { method: 'GET' }, path: '/unrelated' }), null);
});

test('project routes reject JSON authority, foreign identities and malformed receipts before RPC', async () => {
  let calls = 0;
  const routes = createManagedProjectRoutes({ workspaceId: claim.coordination_workspace_id, rpc: async () => { calls++; return admission(); } });
  for (const extra of [{ repo_root: '/unsafe' }, { claim }, { device_id: device.device_id }, { argv: ['git'] }, { client_id: device.id }]) {
    const response = await routes({ req: { method: 'POST' }, path: '/v1/devos/project-admission', body: { ...request, ...extra }, identity: device });
    assert.equal(response.status, 409);
  }
  assert.equal((await routes({ req: { method: 'GET' }, path: '/v1/devos/project-admission', body: request, identity: device })).status, 405);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project-admission', body: request, identity: { ...device, admin_ready: false } })).status, 403);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project-binding/readback', body: { ...request, effect_state: 'PROVEN', head_sha: claim.base_sha, locked: false, realpath_verified: true, ambiguity_code: null }, identity: device })).status, 409);
  assert.equal(calls, 0);
});

test('route fails closed on missing provisioning, revoked DB grant or dishonest DB response without private error text', async () => {
  for (const rpc of [async () => { throw new Error('MANAGED_PROJECT_REPOSITORY_NOT_PROVISIONED'); }, async () => { throw new Error('db_password=private'); }, async () => ({ ...admission(), client_id: 'another-client' }), async () => ({ ...admission(), claim: { ...claim, claim_id: 99 } })]) {
    const routes = createManagedProjectRoutes({ workspaceId: claim.coordination_workspace_id, rpc });
    const response = await routes({ req: { method: 'POST' }, path: '/v1/devos/project-admission', body: request, identity: device });
    assert.notEqual(response.status, 200);
    assert(!JSON.stringify(await response.json()).includes('private'));
  }
});

test('resolver requires exact live admission and rejects path, claim or lease drift', async () => {
  const seen = [];
  const resolve = createManagedTaskProjectAuthorityResolver({ request: async wire => { seen.push(wire); return admission(); } });
  assert.equal((await resolve(request)).workspace_binding.worktree_path, binding.worktree_path);
  assert.deepEqual(seen[0], { method: 'POST', path: '/v1/devos/project-admission', body: request });
  await assert.rejects(resolve({ ...request, claim }), /request_invalid/);
  for (const bad of [{ ...admission(), authoritative: false }, { ...admission(), claim: { ...claim, lease_generation: 2 } }, { ...admission(), workspace_binding: { ...binding, worktree_path: path.resolve('foreign') } }, { ...admission(), workspace_binding: { ...binding, dirty_hold: true } }]) {
    await assert.rejects(createManagedTaskProjectAuthorityResolver({ request: async () => bad })(request), /authority|workspace/);
  }
});

test('binding callbacks transmit receipts without paths and require exact durable readback', async () => {
  const wires = [];
  const callbacks = createManagedTaskProjectBindingTransport({ request: async wire => {
    wires.push(wire);
    const proven = wire.path.endsWith('/readback');
    return { ok: true, operation: proven ? 'readback' : 'reserve', binding: proven ? { ...binding, state: 'READY', initial_head_sha: claim.base_sha, worktree_realpath: binding.worktree_path } : binding, automatic_retry_allowed: false, authority_effect: false };
  } });
  await callbacks.reserveBinding(binding);
  await callbacks.finalizeBinding({ state: 'PROVEN', reservation: { ...binding, state: 'READY' }, proof: { head_sha: claim.base_sha, worktree_path: binding.worktree_path, locked: true }, authority_effect: false, automatic_retry_allowed: false });
  assert(wires.every(wire => !Object.keys(wire.body).some(key => ['worktree_path', 'repo_root', 'managed_root', 'argv', 'claim'].includes(key))));
  assert.equal(wires[1].body.realpath_verified, true);
  const bad = createManagedTaskProjectBindingTransport({ request: async () => ({ ok: true, operation: 'reserve', binding: { ...binding, repo_root: path.resolve('foreign') }, automatic_retry_allowed: false, authority_effect: false }) });
  await assert.rejects(bad.reserveBinding(binding), /binding_drift/);
});

test('separate repository provisioning is exact device-bound host configuration with immutable metadata readback', async () => {
  const value = { schema: 'metaengine.devos.managed-project-repository.v1', provisioned: true, replayed: false, repository: { ...repoConfig, device_id: device.device_id, client_id: device.id, admin_grant_epoch: 1 }, automatic_retry_allowed: false, authority_effect: false };
  let wire;
  const provision = createManagedTaskProjectRepositoryProvisioner({ request: async input => { wire = input; return value; } });
  assert.equal((await provision(repoConfig)).provisioned, true);
  assert.equal(wire.path, '/v1/devos/project-repository/provision');
  await assert.rejects(provision({ ...repoConfig, argv: [] }), /config_invalid/);
  await assert.rejects(createManagedTaskProjectRepositoryProvisioner({ request: async () => ({ ...value, repository: { ...value.repository, managed_root: '/foreign' } }) })(repoConfig), /readback_drift/);
  const routes = createManagedProjectRoutes({ workspaceId: claim.coordination_workspace_id, rpc: async () => value });
  assert.equal((await routes({ req: { method: 'POST' }, path: wire.path, body: repoConfig, identity: device })).status, 200);
});
