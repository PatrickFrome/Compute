import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cwd = fileURLToPath(new URL('../', import.meta.url));

// These exercise installed transitives, not merely package-version strings.
// Keep adversarial inputs in bounded subprocesses: a dependency regression must
// fail the check rather than hang or exhaust the parent test runner.
function check(source) {
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=64', '-e',
    `const assert = require('node:assert/strict');\n${source}`,
  ], { cwd, encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
}

test('unused Prisma starter tooling is absent while the own-PG client remains', () => {
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(cwd, 'bun.lock'), 'utf8')
    .replace(/,\s*([}\]])/g, '$1'));
  assert.equal(pkg.dependencies.prisma, undefined);
  assert.equal(pkg.dependencies['@prisma/client'], undefined);
  for (const name of ['db:push', 'db:generate', 'db:migrate', 'db:reset']) {
    assert.equal(pkg.scripts[name], undefined);
  }
  assert.equal(existsSync(join(cwd, 'prisma/schema.prisma')), false);
  for (const [identity] of Object.values(lock.packages)) {
    assert.doesNotMatch(identity, /^(?:@prisma\/|prisma@|deepmerge-ts@|effect@)/);
  }
  assert.equal(lock.workspaces[''].dependencies.pg, pkg.dependencies.pg);
  assert.match(lock.packages.pg[0], /^pg@/);
  assert.match(readFileSync(join(cwd, 'src/lib/pg.ts'), 'utf8'), /from "pg"/);
});

test('flatted does not expose Array.prototype through a forged reference', () => {
  check(`
    const { parse, stringify } = require('flatted');
    const result = parse('[{"x":"__proto__"}]');
    assert.equal(result.x, undefined);
    const input = { value: 42 }; input.self = input;
    const restored = parse(stringify(input));
    assert.equal(restored.value, 42);
    assert.equal(restored.self, restored);
  `);
});

test('nanoid non-secure generators terminate for negative and zero sizes', () => {
  check(`
    const { nanoid, customAlphabet } = require('nanoid/non-secure');
    for (const size of [-1, 0]) {
      assert.equal(nanoid(size), '');
      assert.equal(customAlphabet('ab')(size), '');
    }
    assert.equal(nanoid(12).length, 12);
    assert.match(customAlphabet('ab')(12), /^[ab]{12}$/);
  `);
});

test('source-map-js rejects oversized indexed section offsets', () => {
  check(`
    const { SourceMapConsumer } = require('source-map-js');
    const map = { version: 3, sources: ['input.js'], names: [], mappings: 'AAAA' };
    const indexed = line => ({ version: 3, sections: [{ offset: { line, column: 0 }, map }] });
    assert.throws(() => new SourceMapConsumer(indexed(1e12)), /offset line/i);
    const valid = new SourceMapConsumer(indexed(0));
    const mappings = [];
    valid.eachMapping(mapping => mappings.push(mapping));
    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].source, 'input.js');
  `);
});
