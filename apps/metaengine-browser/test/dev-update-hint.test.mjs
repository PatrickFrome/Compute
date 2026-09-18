import assert from 'node:assert/strict';
import test from 'node:test';
import { isNewerCompatibleDevVersion, probeDevUpdateHint } from '../src/dev-update-hint.mjs';

function response(row, { status = 200 } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(row));
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const valid = {
  schema: 'metaengine.browser.dev-update-hint.v1',
  version: '0.6.3-dev.125.1',
  tag: 'v0.6.3-dev.125.1',
  git_sha: 'a'.repeat(40),
  authority_effect: false,
};

test('valid hint only reports a newer compatible dev release', async () => {
  const hint = await probeDevUpdateHint({
    currentVersion: '0.6.3-dev.124.1',
    fetchImpl: async () => response(valid),
  });
  assert.equal(hint.version, valid.version);
  assert.equal(hint.newer_than_current, true);
  assert.equal(hint.authority_effect, false);
});

test('hint cannot acquire authority or escape exact version family', async () => {
  await assert.rejects(() => probeDevUpdateHint({
    currentVersion: '0.6.3-dev.124.1',
    fetchImpl: async () => response({ ...valid, authority_effect: true }),
  }), /dev_update_hint_authority_invalid/);
  assert.equal(isNewerCompatibleDevVersion('0.6.4-dev.999.1', '0.6.3-dev.124.1'), false);
  assert.equal(isNewerCompatibleDevVersion('0.6.3-dev.123.9', '0.6.3-dev.124.1'), false);
});

test('missing hint is a zero-authority no-op', async () => {
  const hint = await probeDevUpdateHint({
    currentVersion: '0.6.3-dev.124.1',
    fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
  });
  assert.equal(hint, null);
});
