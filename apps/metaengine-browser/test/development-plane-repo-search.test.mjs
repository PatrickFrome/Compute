import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DevelopmentPlane,
  DEVELOPMENT_PLANE_CAPABILITIES,
  DEVELOPMENT_PLANE_PROTOCOL,
  DEVELOPMENT_PLANE_VERSION,
} from '../src/development-plane.mjs';

class FakeChild extends EventEmitter {
  pid = 5151;
  sent = [];
  postMessage(message) { this.sent.push(structuredClone(message)); }
  kill() { queueMicrotask(() => this.emit('exit', 0)); return true; }
}

async function readyPlane() {
  const child = new FakeChild();
  const plane = new DevelopmentPlane({ spawnWorker: () => child, timeout_ms: 500 });
  const starting = plane.start();
  child.emit('message', {
    protocol: DEVELOPMENT_PLANE_PROTOCOL,
    type: 'READY',
    version: DEVELOPMENT_PLANE_VERSION,
    capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES],
    authority_effect: false,
  });
  await starting;
  return { plane, child };
}

test('Development Plane advertises repo search as typed read-only capability', async () => {
  assert.equal(DEVELOPMENT_PLANE_CAPABILITIES.includes('DEVOS_REPO_SEARCH'), true);
  const { plane } = await readyPlane();
  const snap = plane.snapshot();
  assert.equal(snap.devos_repo_search, true);
  assert.equal(snap.devos_repo_search_arbitrary_path_selection, false);
  assert.equal(snap.browser_actuation_authority, false);
  plane.stop();
});

test('repo search payload crosses only the existing utility-process request boundary', async () => {
  const { plane, child } = await readyPlane();
  const pending = plane.request('DEVOS_REPO_SEARCH', {
    query: 'boundedNavigation AbortSignal',
    limit: 6,
    max_bytes: 4096,
    authority_effect: false,
  });
  const sent = child.sent.at(-1);
  assert.equal(sent.capability, 'DEVOS_REPO_SEARCH');
  assert.deepEqual(sent.payload, {
    query: 'boundedNavigation AbortSignal',
    limit: 6,
    max_bytes: 4096,
    authority_effect: false,
  });
  assert.equal(sent.authority_effect, false);
  child.emit('message', {
    protocol: DEVELOPMENT_PLANE_PROTOCOL,
    type: 'RESPONSE',
    request_id: sent.request_id,
    ok: true,
    result: { status: 'OK', hits: [], query_revision: 'rq:test', authority_effect: false },
    authority_effect: false,
  });
  const result = await pending;
  assert.equal(result.query_revision, 'rq:test');
  assert.equal(result.authority_effect, false);
  plane.stop();
});

test('worker owns one HEAD+worktree event index and no caller-selected path capability', async () => {
  const source = await readFile(new URL('../src/development-plane-worker.cjs', import.meta.url), 'utf8');
  assert.match(source, /const repoSearchIndex = new DevOSRepoSearchIndex\(\{ repoRoot \}\);/);
  assert.match(source, /armWorktreeWatchers/);
  assert.match(source, /repoSearchIndex\.notifyPathChanged/);
  assert.match(source, /capability === 'DEVOS_REPO_SEARCH'/);
  assert.match(source, /repoSearchIndex\.query\(await requireCurrentSource\(\), payload\)/);
  assert.match(source, /devos_repo_search_cache: 'HEAD_PLUS_WORKTREE_EVENT'/);
  assert.match(source, /devos_repo_search_arbitrary_path_selection: false/);
  assert.doesNotMatch(source, /DEVOS_REPO_SEARCH[\s\S]{0,500}(exec|spawn|fork)\(/);
});
