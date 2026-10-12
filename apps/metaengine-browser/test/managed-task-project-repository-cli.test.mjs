import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseManagedProjectRepositoryArguments, configureManagedProjectRepositoryCli } from '../scripts/configure-managed-project-repository.mjs';

const profile = path.join(os.tmpdir(), 'private-owner-profile');
const repo = path.join(os.tmpdir(), 'trusted-owner-repo');
const workspace = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const args = ['--user-data-dir', profile, '--repository-root', repo, '--coordination-workspace-id', workspace, '--repository-id', 'owner/repo'];

test('repository configuration CLI binds exact owner-selected roots and one coordination workspace', async () => {
  const config = parseManagedProjectRepositoryArguments(args);
  assert.equal(config.userDataPath, path.resolve(profile));
  assert.deepEqual(config.repository, {
    schema: 'metaengine.devos.managed-project-repository-config.v1',
    coordination_workspace_id: workspace, repo_id: 'owner/repo',
    repo_root: path.resolve(repo), managed_root: path.join(profile, 'projects'),
  });
  const lines = []; let received;
  await configureManagedProjectRepositoryCli(args, {
    configure: async value => { received = value; return { configured: true }; },
    write: line => lines.push(line),
  });
  assert.deepEqual(received, config);
  assert.deepEqual(JSON.parse(lines[0]), { ok: true, state: 'CONFIGURED', authority_effect: false });
  assert.equal(lines.join('').includes(profile), false);
  assert.equal(lines.join('').includes(repo), false);
});

test('invalid, duplicate, missing and relative configuration cannot reach host effect', async () => {
  let called = 0;
  for (const input of [[], [...args, '--command', 'git init'], [...args.slice(0, 6), '--repository-id'],
    [...args.slice(0, 2), '--user-data-dir', profile, ...args.slice(2)],
    args.map((value, index) => index === 3 ? './caller-directory' : value),
    args.map((value, index) => index === 5 ? 'not-a-workspace' : value),
    args.map((value, index) => index === 7 ? 'repo\npassword' : value)]) {
    await assert.rejects(configureManagedProjectRepositoryCli(input, { configure: async () => { called++; }, write() {} }), /managed_project_configuration_/);
  }
  assert.equal(called, 0);
});

test('configuration failure is propagated without emitting a success receipt', async () => {
  const lines = [];
  await assert.rejects(configureManagedProjectRepositoryCli(args, {
    configure: async () => { throw new Error('managed_project_repository_config_conflict'); },
    write: line => lines.push(line),
  }), /config_conflict/);
  assert.deepEqual(lines, []);
});
