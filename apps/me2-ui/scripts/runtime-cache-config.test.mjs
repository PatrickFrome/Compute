import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('production route/fetch/image caches do not write into immutable resources', () => {
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    (async () => {
      const config = await require('next/dist/server/config').default(
        require('next/constants').PHASE_PRODUCTION_BUILD, process.cwd());
      assert.equal(config.experimental.isrFlushToDisk, false);
      assert.equal(config.cacheMaxMemorySize, 50 * 1024 * 1024);
      const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache').default;
      let writes = 0;
      const forbid = () => { writes++; throw new Error('disk cache write'); };
      const cache = new FileSystemCache({
        fs: { writeFileAtomic: forbid, writeFile: forbid, mkdir: forbid },
        serverDistDir: '/immutable/server', revalidatedTags: [],
        flushToDisk: config.experimental.isrFlushToDisk,
        maxMemoryCacheSize: config.cacheMaxMemorySize,
      });
      await cache.promoteSeed('/route-cache/test', '/seed', { value: { kind: 'APP_PAGE' } });
      const value = { kind: 'FETCH', data: { headers: {}, body: 'ok', status: 200, url: '/fixture' }, revalidate: 60 };
      await cache.set('memory-fixture', value, { fetchCache: true, tags: [] });
      const cached = await cache.get('memory-fixture', { kind: 'FETCH', tags: [], softTags: [] });
      assert.equal(cached.value.data.body, 'ok');
      assert.equal(writes, 0);
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'me2-image-cache-'));
      try {
        const { ImageOptimizerCache } = require('next/dist/server/image-optimizer');
        const imageCache = new ImageOptimizerCache({ distDir: temporary, nextConfig: config });
        assert.equal(await imageCache.get('image-fixture'), null);
        await imageCache.set('image-fixture', { kind: 'IMAGE', buffer: Buffer.from('image'), extension: 'png', etag: 'etag', upstreamEtag: 'upstream' }, { cacheControl: { revalidate: 60 } });
        assert.deepEqual(fs.readdirSync(temporary), []);
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
    timeout: 10_000, maxBuffer: 64 * 1024,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});
