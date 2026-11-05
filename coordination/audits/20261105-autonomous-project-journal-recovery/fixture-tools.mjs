// Source-only fixture helpers. No production paths, network, databases or agents.
import {mkdtemp, lstat, realpath, truncate, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep, dirname} from 'node:path';

export async function withFixtureRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'metaengine-project-journal-inert-'));
  try { return await fn(root); }
  finally { await rm(root, {recursive: true, force: true}); }
}

export async function checkedFixtureFile(root, path) {
  const canonicalRoot = await realpath(root);
  const resolved = resolve(path);
  const parent = await realpath(dirname(resolved));
  if (!parent.startsWith(`${canonicalRoot}${sep}`) && parent !== canonicalRoot) {
    throw new Error('fixture path must stay within the temporary fixture root');
  }
  const st = await lstat(resolved);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error('fixture must be a regular file');
  return resolved;
}

export async function writeFixture(root, name, bytes) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('invalid fixture basename');
  const file = join(root, name);
  await writeFile(file, bytes, {flag: 'wx', mode: 0o600});
  return file;
}

export async function truncateFixture(root, file, newSize) {
  const path = await checkedFixtureFile(root, file);
  const {size} = await lstat(path);
  if (!Number.isSafeInteger(newSize) || newSize < 0 || newSize > size) {
    throw new Error('size must truncate, never extend');
  }
  await truncate(path, newSize);
  return readFile(path);
}

export function enospcFaultingSink(capacity, initial = Buffer.alloc(0)) {
  if (!Number.isSafeInteger(capacity) || capacity < initial.length) throw new Error('invalid capacity');
  let bytes = Buffer.from(initial);
  return {
    async append(chunk) {
      const content = Buffer.from(chunk);
      const left = capacity - bytes.length;
      if (left < content.length) {
        // Deliberately allow a torn tail before ENOSPC; never claim this is a durable commit.
        if (left > 0) bytes = Buffer.concat([bytes, content.subarray(0, left)]);
        const err = new Error('synthetic ENOSPC (fixture only)');
        err.code = 'ENOSPC';
        throw err;
      }
      bytes = Buffer.concat([bytes, content]);
      return {written: content.length};
    },
    inspect() { return Buffer.from(bytes); },
  };
}

export function incompleteJsonlTail(completeRecords, incompleteBytes) {
  if (!Array.isArray(completeRecords)) throw new Error('records must be an array');
  const prefix = completeRecords.map(x => `${JSON.stringify(x)}\n`).join('');
  return Buffer.concat([Buffer.from(prefix), Buffer.from(incompleteBytes)]);
}
