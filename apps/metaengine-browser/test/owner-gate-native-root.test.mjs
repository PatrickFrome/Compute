import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NativeSupervisorClient } from '../src/native-supervisor-client.mjs';
import { SupervisorDeviceIdentity } from '../src/supervisor-device-identity.mjs';

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8').replace(/^enc:/, ''),
};

test('signed owner GATE_DISABLE_ALL executes while native supervisor is OFF and DISARMED', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-owner-root-'));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  await identity.ensure();
  await identity.bindDevice(crypto.randomUUID());

  const commandId = crypto.randomUUID();
  let issued = false;
  let executed = null;
  let posted = null;
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return new Response('{}', { status:202, headers:{'content-type':'application/json'} });
    if (pathname.endsWith('/v1/commands/next')) {
      if (issued) return new Response(JSON.stringify({ command:null }), { status:200, headers:{'content-type':'application/json'} });
      issued = true;
      return new Response(JSON.stringify({
        command:{
          command_id:commandId,
          action:'GATE_DISABLE_ALL',
          payload:{ reason:'OWNER_BREAK_GLASS_TEST', override_id:'owner.override.root01', ttl_seconds:60 },
          issued_at:new Date().toISOString(),
          expires_at:new Date(Date.now()+60000).toISOString(),
        },
      }), { status:200, headers:{'content-type':'application/json'} });
    }
    if (/\/v1\/commands\/[^/]+\/result$/.test(pathname)) {
      posted = JSON.parse(init.body || '{}');
      return new Response('{}', { status:200, headers:{'content-type':'application/json'} });
    }
    throw new Error(`unexpected_fetch:${pathname}`);
  };

  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    version:'0.6.3-dev.test',
    intervalMs:60000,
    getState: async () => ({ tabs:[], active_tab:null, downloads:{ active:null }, development_plane:null, fleet:null, perception:null }),
    executeCommand: async (command) => {
      executed = structuredClone(command);
      return { all_internal_gates_disabled:true, authority_effect:true };
    },
  });
  client.setControlState({ mode:'OFF', armed:false });
  await client.cycle();

  assert.equal(client.snapshot().supervisor_mode, 'OFF');
  assert.equal(client.snapshot().armed, false);
  assert.equal(executed?.action, 'GATE_DISABLE_ALL');
  assert.equal(posted?.ok, true);
  assert.equal(posted?.receipt?.result?.all_internal_gates_disabled, true);
  assert.equal(client.snapshot().last_command_status, 'COMPLETED');
  await fs.rm(dir, { recursive:true, force:true });
});
