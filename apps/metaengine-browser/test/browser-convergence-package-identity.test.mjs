import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from '../package.json' with { type: 'json' };
import { parseMetaengineDevVersion } from '../src/trusted-dev-release-resolver.mjs';

test('convergence candidate keeps unpublished trusted successor package identity', () => {
  assert.equal(pkg.version, '0.7.0-dev.36336130139.1');
  assert.deepEqual(parseMetaengineDevVersion(pkg.version), {
    version: '0.7.0-dev.36336130139.1',
    core: '0.7.0',
    build: 36336130139,
  });
});
