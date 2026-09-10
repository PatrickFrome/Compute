import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DevelopmentPlane,
  DEVELOPMENT_PLANE_CAPABILITIES,
  DEVELOPMENT_PLANE_PROTOCOL,
  DEVELOPMENT_PLANE_VERSION,
} from '../src/development-plane.mjs';

class FakeChild extends EventEmitter {
  pid = 5151;
  sent = [];
  postMessage(message) { this.sent.push(message); }
  kill() { queueMicrotask(() => this.emit('exit', 0)); return true; }
}

async function ready() {
  const child = new FakeChild();
  const plane = new DevelopmentPlane({
    spawnWorker: () => child,
    timeout_ms: 500,
    uuid: () => '00000000-0000-4000-8000-000000000001',
    clock: () => 1788000000000,
  });
  const starting = plane.start();
  child.emit('message', {
    protocol: DEVELOPMENT_PLANE_PROTOCOL,
    type: 'READY',
    version: DEVELOPMENT_PLANE_VERSION,
    capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES],
  });
  await starting;
  return { plane, child };
}

test('DEVOS_REPO_SEARCH relies on the transport clone instead of two extra parent clones', async () => {
  const { plane, child } = await ready();
  const payload = Object.freeze({ query: 'warm hot path', limit: 8, authority_effect: false });
  const pending = plane.request('DEVOS_REPO_SEARCH', payload);
  const sent = child.sent.at(-1);

  // FakeChild intentionally does not clone. Identity here proves the parent did not
  // perform a redundant pre-postMessage structuredClone. Real utilityProcess
  // postMessage remains the one isolation/serialization boundary.
  assert.equal(sent.payload, payload);
  assert.equal(sent.authority_effect, false);

  const transportOwnedResult = {
    schema: 'metaengine.development-plane.repo-search.v1',
    status: 'OK',
    total_hits: 1,
    hits: [{ path: 'apps/metaengine-browser/src/main.mjs' }],
    authority_effect: false,
  };
  child.emit('message', {
    protocol: DEVELOPMENT_PLANE_PROTOCOL,
    type: 'RESPONSE',
    request_id: sent.request_id,
    ok: true,
    result: transportOwnedResult,
  });
  const result = await pending;

  // The incoming IPC message is already transport-owned data and DEVOS_REPO_SEARCH
  // is never retained in #lastResults, so a second local clone is unnecessary.
  assert.equal(result, transportOwnedResult);
  const snapshot = plane.snapshot();
  assert.equal(snapshot.devos_repo_search_parent_clone_passes, 0);
  assert.equal(snapshot.devos_repo_search_transport_clone_passes, 1);
  assert.equal(snapshot.devos_repo_search_transport_clone_sufficient, true);
  assert.equal(snapshot.authority_effect, false);
});

test('verification capabilities keep defensive parent cloning semantics', async () => {
  const { plane, child } = await ready();
  const payload = { envelope: { schema: 'example', value: 1 } };
  const pending = plane.request('ADVISORY_EVIDENCE_VERIFY', payload);
  const sent = child.sent.at(-1);
  assert.notEqual(sent.payload, payload);
  assert.deepEqual(sent.payload, payload);

  const response = { evidence_id: 'ev:test', authority_effect: false };
  child.emit('message', {
    protocol: DEVELOPMENT_PLANE_PROTOCOL,
    type: 'RESPONSE',
    request_id: sent.request_id,
    ok: true,
    result: response,
  });
  const result = await pending;
  assert.notEqual(result, response);
  assert.deepEqual(result, response);
});
