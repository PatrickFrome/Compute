import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nasync function ', start + 1);
  const nextSync = source.indexOf('\nfunction ', start + 1);
  const candidates = [next, nextSync].filter((value) => value > start);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test('bootstrap/watchdog liveness uses the dedicated signed heartbeat endpoint', async () => {
  const source = await readSource('../src/native-supervisor-client-core-base.mjs');
  const block = functionBlock(source, 'postStateHeartbeat');

  assert.match(block, /NATIVE_SUPERVISOR_RUNTIME_PATH}\/v1\/heartbeat/);
  assert.match(block, /NATIVE_SUPERVISOR_BASE}\/v1\/heartbeat/);
  assert.match(block, /deviceHeaders\('POST', requestPath, bodyText\)/);
  assert.doesNotMatch(block, /\/v1\/state/);
});

test('server heartbeat is authenticated liveness-only and fails closed without state', async () => {
  const source = await readSource('../supabase/a2-browser-native-supervisor-v1/index.ts');
  const block = functionBlock(source, 'touchHeartbeat');

  assert.match(block, /identity\?\.id/);
  assert.match(block, /method:'PATCH'/);
  assert.match(block, /JSON\.stringify\(\{last_seen_at:new Date\(\)\.toISOString\(\)\}\)/);
  assert.doesNotMatch(block, /on_conflict|resolution=merge-duplicates|supervisor_mode|armed|authority_effect|state:/);

  assert.match(source, /path==='\/v1\/heartbeat'/);
  assert.match(source, /supervisor_state_not_found/);
  assert.match(source, /isLivenessStatePulse\(body\).*touchHeartbeat\(identity\)/s);
});

test('authoritative full-state publication remains a separate state route', async () => {
  const server = await readSource('../supabase/a2-browser-native-supervisor-v1/index.ts');
  const baseClient = await readSource('../src/native-supervisor-client-base.mjs');

  assert.match(server, /path==='\/v1\/state'/);
  assert.match(server, /upsertState\(req,body,identity\)/);
  assert.match(baseClient, /\/v1\/state/);
});
