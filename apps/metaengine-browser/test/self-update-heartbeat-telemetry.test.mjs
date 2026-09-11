import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const basePath = path.resolve(here, '../src/native-supervisor-client-base.mjs');
const corePath = path.resolve(here, '../src/native-supervisor-client-core.mjs');
const publicPath = path.resolve(here, '../src/native-supervisor-client.mjs');
const source = (p) => fs.readFileSync(p, 'utf8');

test('native supervisor heartbeat telemetry remains owned by exact base used by public client', () => {
  const base = source(basePath);
  const core = source(corePath);
  const publicClient = source(publicPath);
  assert.match(base, /shell_version:\s*this\.#version/);
  assert.match(base, /self_update:\s*this\.#selfUpdate\?\.snapshot\(\)\s*\|\|\s*null/);
  // Heartbeat collection/network work must never sit in front of command admission.
  // The base owns one coalesced in-flight heartbeat promise and the cycle only kicks
  // it before immediately entering the command fast lane.
  assert.match(base, /#heartbeatPromise/);
  assert.match(base, /#kickHeartbeat\(\)/);
  assert.match(base, /this\.#heartbeatPromise\s*=\s*this\.#heartbeat\(\)/);
  assert.doesNotMatch(base, /await\s+this\.#heartbeat\(\)/);
  assert.match(base, /response\.status !== 202/);
  assert.match(core, /extends BaseNativeSupervisorClient/);
  assert.match(publicClient, /NativeSupervisorClient as CoreNativeSupervisorClient/);
  assert.match(publicClient, /extends CoreNativeSupervisorClient/);
  assert.match(publicClient, /createBoundedSupervisorFetch/);
});

test('typed self-update status/check/apply remain in the inherited authority path', () => {
  const base = source(basePath);
  assert.match(base, /action === 'SELF_UPDATE_STATUS'/);
  assert.match(base, /action === 'SELF_UPDATE_CHECK'/);
  assert.match(base, /action === 'SELF_UPDATE_APPLY'/);
  assert.match(base, /native_supervisor_control_required/);
  assert.match(base, /native_supervisor_disarmed/);
  assert.match(base, /applyWhenSafe\(\)/);
});
