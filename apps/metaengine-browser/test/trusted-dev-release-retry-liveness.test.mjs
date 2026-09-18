import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Reproduce the exact process shape used by the physical self-update baseline
// resolver: a standalone Node ESM entrypoint whose only pending work after a
// rate-limit response is the resolver's awaited retry delay. An unref() on that
// timer lets Node terminate with an unsettled top-level await before retry #2.
test('awaited trusted-release retry keeps a standalone ESM resolver alive', () => {
  const resolverUrl = new URL('../src/trusted-dev-release-resolver.mjs', import.meta.url).href;
  const script = `
    import { resolveTrustedMetaengineDevRelease } from ${JSON.stringify(resolverUrl)};

    const nativeSetTimeout = globalThis.setTimeout;
    let retryTimerUnrefCalls = 0;
    globalThis.setTimeout = (fn, ms, ...args) => {
      // Keep the regression test fast while preserving a real Node Timer handle.
      const timer = nativeSetTimeout(fn, Math.min(Math.max(Number(ms) || 0, 1), 25), ...args);
      const nativeUnref = typeof timer.unref === 'function' ? timer.unref.bind(timer) : null;
      if (nativeUnref) {
        timer.unref = () => {
          retryTimerUnrefCalls += 1;
          return nativeUnref();
        };
      }
      return timer;
    };

    const makeResponse = (value, status = 200) => {
      const body = JSON.stringify(value);
      return new Response(body, {
        status,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body, 'utf8')),
        },
      });
    };

    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return makeResponse({ message: 'API rate limit exceeded' }, 403);
      return makeResponse([], 200);
    };

    const result = await resolveTrustedMetaengineDevRelease({
      currentVersion: '0.6.3-dev.0.1',
      fetchImpl,
    });
    if (result !== null) throw new Error('retry_liveness_expected_null_result');
    if (calls !== 2) throw new Error('retry_liveness_second_attempt_missing:' + calls);
    if (retryTimerUnrefCalls !== 0) throw new Error('awaited_retry_timer_was_unrefed:' + retryTimerUnrefCalls);
    process.stdout.write('RETRY_LIVENESS_OK\\n');
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });

  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(
    child.status,
    0,
    `standalone resolver failed: status=${child.status} signal=${child.signal}\nstdout=${child.stdout}\nstderr=${child.stderr}`,
  );
  assert.match(child.stdout, /RETRY_LIVENESS_OK/);
  assert.doesNotMatch(child.stderr, /unsettled top-level await/i);
});
