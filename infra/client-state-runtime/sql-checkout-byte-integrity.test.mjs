import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('actual Git autocrlf checkout preserves pinned SQL bytes and stored-function hashes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sql-checkout-bytes-'));
  const planPath = 'infra/client-state-runtime/fresh-schema-candidate-plan.json';
  const planBytes = await fs.readFile(path.join(root, planPath));
  const plan = JSON.parse(planBytes);
  const resources = new Map([...plan.baseline, ...plan.upgrades].map(row => [row.path, row.sha256]));
  // Include ancillary local SQL resources (e.g. vault compatibility), not only
  // the current baseline list. Every SQL file in this directory is byte-sensitive.
  for (const name of await fs.readdir(path.join(root, 'infra/client-state-runtime'))) {
    if (name.endsWith('.sql')) {
      const resource = 'infra/client-state-runtime/' + name;
      if (!resources.has(resource)) resources.set(resource, sha(await fs.readFile(path.join(root, resource))));
    }
  }
  resources.set(planPath, sha(planBytes));
  const git = (...args) => exec('git', ['-c', 'core.autocrlf=true', '-c', 'core.eol=crlf',
    '-c', 'core.attributesFile=' + path.join(directory, 'empty-global-attributes'), ...args],
    { cwd: directory, windowsHide: true, maxBuffer: 1024 * 1024 });
  try {
    await fs.writeFile(path.join(directory, 'empty-global-attributes'), '');
    await git('init', '--quiet');
    await fs.copyFile(path.join(root, '.gitattributes'), path.join(directory, '.gitattributes'));
    for (const resource of resources.keys()) {
      const target = path.join(directory, resource);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(root, resource), target);
    }
    await fs.writeFile(path.join(directory, 'conversion-control.txt'), 'first\nsecond\n');
    await git('add', '--', '.gitattributes', 'conversion-control.txt', ...resources.keys());
    // Delete first so this is a real checkout, not a stat-cache/no-op check.
    for (const resource of [...resources.keys(), 'conversion-control.txt']) await fs.unlink(path.join(directory, resource));
    await git('checkout-index', '--all', '--force');
    assert.equal(await fs.readFile(path.join(directory, 'conversion-control.txt'), 'utf8'), 'first\r\nsecond\r\n', 'control proves CRLF conversion was active');
    for (const [resource, expected] of resources) {
      const bytes = await fs.readFile(path.join(directory, resource));
      assert.equal(sha(bytes), expected, resource);
      assert(!bytes.includes(Buffer.from('\r\n')), resource + ': reviewed resources must remain LF');
    }
    const sql = await fs.readFile(path.join(directory, 'infra/client-state-runtime/native-coding-running-agent-scope-v1.sql'), 'utf8');
    const original = await fs.readFile(path.join(directory, 'supabase/migrations/20261025090000_native_coding_agent_project_tools_v1.sql'), 'utf8');
    const body = (source, name) => {
      const start = source.indexOf('function destruktion_meta.' + name + '(');
      assert(start >= 0);
      const begin = source.indexOf('as $$', start) + 5, end = source.indexOf('$$;', begin);
      assert(end > begin); return source.slice(begin, end);
    };
    for (const value of [body(original, 'native_coding_agent_context_v1'), body(sql, 'native_coding_agent_context_v1'), body(sql, 'native_coding_running_critic_admissible_v1')])
      assert(sql.includes("'" + sha(value) + "'"), 'stored-function body pin survives checkout');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
