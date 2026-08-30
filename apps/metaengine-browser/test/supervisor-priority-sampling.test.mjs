import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../src/supervisor-lifecycle-runtime.mjs');

async function source() { return fs.readFile(sourcePath, 'utf8'); }

test('supervisor continuity is observed before any fleet worker capture fanout', async () => {
  const text = await source();
  const cycle = text.slice(text.indexOf('async cycle({ force = false } = {})'));
  const supervisorAt = cycle.indexOf('await this.#observeSupervisor(supervisor, state)');
  const workersAt = cycle.indexOf('await this.#observeWorkers(state)');
  assert.ok(supervisorAt >= 0);
  assert.ok(workersAt > supervisorAt);
});

test('worker observation uses a bounded rotating sample instead of O(N) capture fanout', async () => {
  const text = await source();
  assert.match(text, /workerSampleSize = 4/);
  assert.match(text, /Math\.max\(1, Math\.min\(8,/);
  assert.match(text, /this\.#workerSampleCursor = \(start \+ count\) % liveCandidates\.length/);
  assert.match(text, /sampled\.has\(agentId\)/);
  assert.ok(text.includes('worker_sampling_bounded: true'));
  assert.ok(text.includes('supervisor_priority: true'));
});
