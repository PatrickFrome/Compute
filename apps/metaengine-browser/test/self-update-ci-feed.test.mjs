import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCiTestFeedUrl } from '../src/self-update-runtime.mjs';

test('CI self-update feed accepts GitHub Actions loopback only', () => {
  assert.equal(
    validateCiTestFeedUrl('http://127.0.0.1:43117/', { testMode: true, githubActions: true }),
    'http://127.0.0.1:43117/',
  );
  assert.equal(
    validateCiTestFeedUrl('http://localhost:43117/feed/', { testMode: true, githubActions: true }),
    'http://localhost:43117/feed/',
  );
});

test('CI self-update feed cannot be enabled outside explicit GitHub Actions test mode', () => {
  assert.throws(
    () => validateCiTestFeedUrl('http://127.0.0.1:43117/', { testMode: false, githubActions: true }),
    /test_feed_not_allowed/,
  );
  assert.throws(
    () => validateCiTestFeedUrl('http://127.0.0.1:43117/', { testMode: true, githubActions: false }),
    /test_feed_not_allowed/,
  );
});

test('CI self-update feed rejects remote TLS and credential-bearing endpoints', () => {
  assert.throws(
    () => validateCiTestFeedUrl('https://127.0.0.1:43117/', { testMode: true, githubActions: true }),
    /protocol_invalid/,
  );
  assert.throws(
    () => validateCiTestFeedUrl('http://example.com/', { testMode: true, githubActions: true }),
    /not_loopback/,
  );
  assert.throws(
    () => validateCiTestFeedUrl('http://user:pass@127.0.0.1:43117/', { testMode: true, githubActions: true }),
    /url_components_invalid/,
  );
});
