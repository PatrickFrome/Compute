import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { exactCommandTargetProjection } from '../src/native-supervisor-client.mjs';

const commandId = '123e4567-e89b-42d3-a456-426614174000';
const tabId = 'tab_123e4567-e89b-42d3-a456-426614174111';

test('exact DB-leased command target projection exposes only command and tab identity', () => {
  const projected = exactCommandTargetProjection({
    command_id: commandId,
    action: 'TYPED_CLICK',
    payload: {
      tab_id: tabId,
      prompt: 'must-not-cross-telemetry-boundary',
      page_text: 'untrusted',
      secret: 'never-exposed',
    },
  });
  assert.deepEqual(projected, {
    command_id: commandId,
    target_tab_id: tabId,
    payload_exposed: false,
    page_data_authority: false,
    authority_effect: false,
  });
  assert.equal('payload' in projected, false);
  assert.equal('prompt' in projected, false);
  assert.equal('page_text' in projected, false);
  assert.equal('secret' in projected, false);
});

test('non-leased or malformed target identity cannot become action telemetry', () => {
  assert.equal(exactCommandTargetProjection({ action: 'TYPED_CLICK', payload: { tab_id: tabId } }), null);
  assert.deepEqual(exactCommandTargetProjection({ command_id: commandId, payload: { tab_id: 'tab_not_exact' } }), {
    command_id: commandId,
    target_tab_id: null,
    payload_exposed: false,
    page_data_authority: false,
    authority_effect: false,
  });
});

test('public supervisor wrapper binds target telemetry to matching current command id and exposes no payload', async () => {
  const source = await fs.readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  assert.match(source, /target\?\.command_id === String\(base\.current_command\.command_id \|\| ''\)\.toLowerCase\(\)/);
  assert.match(source, /target_tab_id: target\.target_tab_id/);
  assert.match(source, /current_command_payload_exposed: false/);
  assert.match(source, /current_command_target_authority: 'DB_LEASED_TYPED_COMMAND_ONLY'/);
  assert.doesNotMatch(source, /current_command:\s*\{[^}]*payload:/s);
});
