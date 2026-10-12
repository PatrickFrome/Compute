import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectContinuityRoutes } from '../supabase/a2-browser-native-supervisor-v1/project-continuity-routes.mjs';

const workspace = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const id = '11111111-1111-4111-8111-111111111111';
const identity = { ok: true, id: 'client-project-1', device_id: '22222222-2222-4222-8222-222222222222', admin_ready: true, access_tier: 'ADMIN', admin_grant_epoch: 4 };
const body = async response => response.json();

test('project continuity routes inject authenticated identity and strict RPC contracts', async () => {
  const calls = [];
  const routes = createProjectContinuityRoutes({ workspaceId: workspace, rpc: async (name, args) => { calls.push({ name, args }); return { schema: 'metaengine.devos.project-registration.v1', authority_effect: false, automatic_retry_allowed: false }; } });
  const response = await routes({ req: { method: 'POST' }, path: '/v1/devos/project/register', body: { request_id: id }, identity });
  assert.equal(response.status, 200);
  assert.equal(calls[0].name, 'h205f22_project_register_v1');
  assert.deepEqual(calls[0].args, { p_workspace_id: workspace, p_request_id: id, p_device_id: identity.device_id, p_client_id: identity.id, p_admin_grant_epoch: 4 });
  const bad = await routes({ req: { method: 'POST' }, path: '/v1/devos/project/register', body: { request_id: id, device_id: identity.device_id }, identity });
  assert.equal(bad.status, 400);
  assert.equal((await body(bad)).error, 'PROJECT_REQUEST_INVALID');
});

test('project snapshot/history/spawn/activity/policy reject authority and malformed JSON', async () => {
  const routes = createProjectContinuityRoutes({ workspaceId: workspace, rpc: async () => ({ schema:'metaengine.devos.project-policy.v1',project_id:id,authority_effect: false,automatic_retry_allowed:false }) });
  assert.equal((await routes({ req: { method: 'GET' }, path: '/v1/devos/project/history', body: {}, identity })).status, 405);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project/history', body: {}, identity })).status, 400);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project/register', body: { request_id: id }, identity: { ...identity, admin_ready: false } })).status, 403);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project/snapshot', body: { project_id: id, task_id: null, task_after_seq: 0, limit: 129 }, identity })).status, 400);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project/spawn', body: { project_id: id, parent_task_id: id, claim_id: 1, lease_generation: 1, request_id: id, children: [] }, identity })).status, 400);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project/activity', body: { project_id: id, task_id: id, claim_id: 1, lease_generation: 1, request_id: id, event_type: 'TOOL', causal_parent_seq: null, tool: null, artifact: null, content: [], receipt_event_id: null }, identity })).status, 400);
  assert.equal((await routes({ req: { method: 'POST' }, path: '/v1/devos/project/policy', body: { project_id: id, expected_generation: 1, max_depth: null, max_tasks: null, max_children: null }, identity })).status, 200);
});

test('project route does not intercept unrelated paths', async () => {
  const routes = createProjectContinuityRoutes({ workspaceId: workspace, rpc: async () => { throw new Error('must_not_call'); } });
  assert.equal(await routes({ req: { method: 'POST' }, path: '/v1/devos/project/admission', body: {}, identity }), null);
});
