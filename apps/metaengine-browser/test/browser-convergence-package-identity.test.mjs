import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from '../package.json' with { type: 'json' };

test('convergence candidate keeps unpublished trusted successor package identity', () => {
  assert.equal(pkg.version, '0.7.0-dev.2.1');
});
