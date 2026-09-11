import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SupervisorIdentitySignerClient,
  createSupervisorIdentitySignerServer,
  supervisorIdentitySignerEndpoint,
  supervisorIdentitySignerIpcManifest,
} from '../src/supervisor-identity-delegation-ipc.mjs';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';

function splitUtf8ServerNet(marker) {
  const markerBytes = Buffer.from(marker, 'utf8');
  return {
    createServer(onConnection) {
      return net.createServer((socket) => {
        const originalOn = socket.on.bind(socket);
        socket.on = (event, listener) => {
          if (event !== 'data') return originalOn(event, listener);
          return originalOn('data', (chunk) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const markerIndex = bytes.indexOf(markerBytes);
            if (markerIndex < 0) {
              listener(bytes);
              return;
            }
            const splitAt = markerIndex + 1;
            listener(bytes.subarray(0, splitAt));
            listener(bytes.subarray(splitAt));
          });
        };
        onConnection(socket);
      });
    },
  };
}

test('identity signer IPC preserves authenticated UTF-8 payloads split inside a multibyte code point', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-signer-ipc-utf8-'));
  const endpoint = supervisorIdentitySignerEndpoint({ userDataPath: root });
  const sessionKey = createHostAgentSessionKey();
  const bodyText = JSON.stringify({ text: 'split-✓-тест' });
  const signer = {
    async snapshot() {
      return { state: 'READY', authority_effect: false };
    },
    async signDeviceRequest(payload) {
      return { body_text: payload.body_text, authority_effect: false };
    },
  };
  const server = createSupervisorIdentitySignerServer({
    endpoint,
    sessionKey,
    signer,
    netModule: splitUtf8ServerNet('✓'),
  });
  const client = new SupervisorIdentitySignerClient({ endpoint, sessionKey });

  t.after(async () => {
    client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  await server.start();
  await client.connect();
  const result = await client.signDeviceRequest({ body_text: bodyText });

  assert.equal(result.body_text, bodyText);
  assert.equal(server.snapshot().binary_frame_accumulator, true);
  assert.equal(client.snapshot().binary_frame_accumulator, true);
  assert.equal(supervisorIdentitySignerIpcManifest().binary_frame_accumulator, true);
});
