import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMetaengineDevVersion } from '../src/trusted-dev-release-resolver.mjs';

test('live bootstrap 77.1 keeps same-family monotonic ordering for autonomous N+1', () => {
  const installed = parseMetaengineDevVersion('0.6.3-dev.77.1');
  const successor = parseMetaengineDevVersion('0.6.3-dev.78.1');
  assert.ok(installed);
  assert.ok(successor);
  assert.equal(successor.core, installed.core);
  assert.ok(successor.build > installed.build);
});
