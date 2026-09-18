import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationDecision, newWindowDecision, parseUserUrl, REMOTE_WEB_PREFERENCES, SECURITY_POLICY } from '../src/browser-policy.mjs';

test('ChatGPT and normal HTTPS are allowed while privileged schemes are blocked', () => {
  assert.equal(navigationDecision('https://chatgpt.com/').kind, 'CHATGPT');
  assert.equal(navigationDecision('https://github.com/').allow, true);
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', 'devtools://devtools/', 'metaengine://shell/']) assert.equal(navigationDecision(url).allow, false);
});

test('localhost HTTP is allowed for development but public HTTP is blocked', () => {
  assert.equal(navigationDecision('http://127.0.0.1:3000/').kind, 'LOCAL_DEV');
  assert.equal(navigationDecision('http://example.com/').allow, false);
  assert.equal(parseUserUrl('chatgpt.com').href, 'https://chatgpt.com/');
});

test('new windows are converted to managed tabs only for allowed URLs', () => {
  assert.equal(newWindowDecision('https://openai.com/').disposition, 'OPEN_AS_MANAGED_TAB');
  assert.equal(newWindowDecision('file:///etc/passwd').disposition, 'DENY');
});

test('remote renderer and cross-space policy fail closed', () => {
  assert.equal(REMOTE_WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(REMOTE_WEB_PREFERENCES.contextIsolation, true);
  assert.equal(REMOTE_WEB_PREFERENCES.sandbox, true);
  assert.equal(SECURITY_POLICY.cookie_transfer_to_compute_space, false);
  assert.equal(SECURITY_POLICY.raw_cdp_exposed, false);
});
