import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLinuxSkillSourceAdapter, SKILL_SOURCE_ADAPTER_LIMITS } from '../skill-source-adapter-linux-v1.mjs';

function fakeLauncherSource() {
  return `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const root = process.argv[2];
appendFileSync(root + '/.spawn-count', '1');
if (Object.keys(process.env).length !== 0) {
  process.stderr.write('environment-not-empty');
  process.exit(72);
}
let mode = 'normal';
try { mode = readFileSync(root + '/.mode', 'utf8').trim() || 'normal'; } catch {}
let input = Buffer.alloc(0);
const frame = (payload) => { const out = Buffer.alloc(4 + payload.length); out.writeUInt32BE(payload.length, 0); payload.copy(out, 4); return out; };
const header = (opcode, status, id) => { const out = Buffer.alloc(12); out[0] = 1; out[1] = opcode; out[2] = status; out[3] = 0; out.writeBigUInt64BE(id, 4); return out; };
const sendList = (id) => {
  const name = Buffer.from('alpha');
  const payload = Buffer.concat([header(1, 0, id), Buffer.from([0, 1, name.length]), name]);
  process.stdout.write(frame(payload));
};
const sendError = (opcode, id, code) => {
  const bytes = Buffer.from(code);
  process.stdout.write(frame(Buffer.concat([header(opcode, 1, id), Buffer.from([bytes.length]), bytes])));
};
const sendPackage = (id) => {
  const skill = Buffer.from('---\\nname: alpha\\ndescription: adapter test\\n---\\nRead only.\\n');
  const reference = Buffer.from('reference-v1');
  const file = (path, executable, bytes) => {
    const p = Buffer.from(path); const out = Buffer.alloc(2 + 1 + 4 + p.length + bytes.length);
    out.writeUInt16BE(p.length, 0); out[2] = executable ? 1 : 0; out.writeUInt32BE(bytes.length, 3); p.copy(out, 7); bytes.copy(out, 7 + p.length); return out;
  };
  const payload = Buffer.concat([header(2, 0, id), Buffer.from([0, 2]), file('SKILL.md', false, skill), file('references/REFERENCE.md', false, reference)]);
  process.stdout.write(frame(payload));
};
function handle(payload) {
  const opcode = payload[1]; const id = payload.readBigUInt64BE(4);
  if (mode === 'oversized') { const prefix = Buffer.alloc(4); prefix.writeUInt32BE(3000000, 0); process.stdout.write(prefix); return; }
  if (mode === 'silent') return;
  if (mode === 'bad-id') { sendList(id + 1n); return; }
  if (opcode === 1) {
    if (mode === 'delay') setTimeout(() => sendList(id), 120); else sendList(id);
    return;
  }
  const nameLength = payload[12]; const name = payload.subarray(13, 13 + nameLength).toString('ascii');
  if (name === 'missing') sendError(2, id, 'skill_loader_skill_missing'); else sendPackage(id);
}
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32BE(0); if (input.length < 4 + length) break;
    const payload = input.subarray(4, 4 + length); input = input.subarray(4 + length); handle(payload);
  }
});
`;
}

function harness(mode = 'normal', label = 'transport with spaces') {
  const base = mkdtempSync(join(tmpdir(), 'a2-r7m-node-'));
  const binaryDir = join(base, label);
  const root = join(base, 'skills');
  mkdirSync(binaryDir, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '.mode'), mode);
  const launcherPath = join(binaryDir, 'a2-skill-source-launcher');
  writeFileSync(launcherPath, fakeLauncherSource());
  chmodSync(launcherPath, 0o755);
  return { base, root, launcherPath, spawnCount: () => readFileSync(join(root, '.spawn-count'), 'utf8').length };
}

test('configuration is absolute, normalized, exact-launcher-named and timeout-bounded', () => {
  const h = harness();
  assert.throws(() => createLinuxSkillSourceAdapter({ launcherPath: 'relative', skillRoot: h.root }), /skill_source_adapter_launcher_path_invalid/);
  assert.throws(() => createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath + '/../a2-skill-source-launcher', skillRoot: h.root }), /skill_source_adapter_launcher_path_invalid/);
  assert.throws(() => createLinuxSkillSourceAdapter({ launcherPath: join(h.base, 'wrong-name'), skillRoot: h.root }), /skill_source_adapter_launcher_identity_invalid/);
  assert.throws(() => createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: 'relative' }), /skill_source_adapter_skill_root_invalid/);
  assert.throws(() => createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root, requestTimeoutMs: 99 }), /skill_source_adapter_timeout_invalid/);
});

test('one long-lived empty-environment child serves list then package with no path or process authority exposed', async () => {
  const h = harness('normal', 'direct spawn; shell metacharacters stay data');
  const adapter = createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root });
  assert.deepEqual(Object.keys(adapter).sort(), ['close', 'listSkillNames', 'readSkillPackage']);
  assert.deepEqual(await adapter.listSkillNames(), ['alpha']);
  const files = await adapter.readSkillPackage('alpha');
  assert.equal(h.spawnCount(), 1);
  assert.deepEqual(files.map(({ path, executable }) => ({ path, executable })), [
    { path: 'SKILL.md', executable: false },
    { path: 'references/REFERENCE.md', executable: false }
  ]);
  assert.match(files[0].bytes.toString('utf8'), /name: alpha/);
  assert.equal(JSON.stringify(adapter).includes(h.launcherPath), false);
  assert.equal(JSON.stringify(adapter).includes(h.root), false);
  adapter.close();
});

test('valid bounded remote source error rejects one request without desynchronizing or respawning', async () => {
  const h = harness();
  const adapter = createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root });
  await assert.rejects(adapter.readSkillPackage('missing'), (error) => {
    assert.equal(error.code, 'skill_source_adapter_remote_error');
    assert.equal(error.remote_code, 'skill_loader_skill_missing');
    return true;
  });
  assert.deepEqual(await adapter.listSkillNames(), ['alpha']);
  assert.equal(h.spawnCount(), 1);
  adapter.close();
});

test('single-outstanding-request fence rejects concurrency instead of correlating ambiguous responses', async () => {
  const h = harness('delay');
  const adapter = createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root });
  const first = adapter.listSkillNames();
  await assert.rejects(adapter.readSkillPackage('alpha'), /skill_source_adapter_busy/);
  assert.deepEqual(await first, ['alpha']);
  assert.equal(h.spawnCount(), 1);
  adapter.close();
});

test('oversized response prefix is terminal before body buffering and never silently respawns', async () => {
  const h = harness('oversized');
  const adapter = createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root });
  await assert.rejects(adapter.listSkillNames(), /skill_source_adapter_frame_length_invalid/);
  await assert.rejects(adapter.listSkillNames(), /skill_source_adapter_frame_length_invalid/);
  assert.equal(h.spawnCount(), 1);
});

test('request-id mismatch is terminal and future requests cannot cross the failed process epoch', async () => {
  const h = harness('bad-id');
  const adapter = createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root });
  await assert.rejects(adapter.listSkillNames(), /skill_source_adapter_bad_response/);
  await assert.rejects(adapter.listSkillNames(), /skill_source_adapter_bad_response/);
  assert.equal(h.spawnCount(), 1);
});

test('timeout is terminal and cannot be converted into an implicit retry', async () => {
  const h = harness('silent');
  const adapter = createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root, requestTimeoutMs: SKILL_SOURCE_ADAPTER_LIMITS.minRequestTimeoutMs });
  await assert.rejects(adapter.listSkillNames(), /skill_source_adapter_timeout/);
  await assert.rejects(adapter.listSkillNames(), /skill_source_adapter_timeout/);
  assert.equal(h.spawnCount(), 1);
});

test('skill names are validated before native I/O', async () => {
  const h = harness();
  const adapter = createLinuxSkillSourceAdapter({ launcherPath: h.launcherPath, skillRoot: h.root });
  await assert.rejects(adapter.readSkillPackage('../escape'), /skill_source_adapter_skill_name_invalid/);
  assert.throws(() => readFileSync(join(h.root, '.spawn-count')), /ENOENT/);
  adapter.close();
});
