#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OPTIONS = new Map([
  ['--user-data-dir', 'userDataPath'],
  ['--repository-root', 'repo_root'],
  ['--coordination-workspace-id', 'coordination_workspace_id'],
  ['--repository-id', 'repo_id'],
  ['--managed-root', 'managed_root'],
]);
const USAGE = 'node scripts/configure-managed-project-repository.mjs --user-data-dir <Electron profile> --repository-root <existing Git repository> --coordination-workspace-id <UUID> --repository-id <ID> [--managed-root <new project parent>]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseManagedProjectRepositoryArguments(argv) {
  if (!Array.isArray(argv) || argv.length > 10) throw new Error('managed_project_configuration_arguments_invalid');
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const field = OPTIONS.get(argv[i]);
    const value = argv[i + 1];
    if (!field || Object.hasOwn(values, field) || typeof value !== 'string' || !value.trim() ||
        value.startsWith('--') || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('managed_project_configuration_arguments_invalid');
    }
    values[field] = value;
  }
  if (!values.userDataPath || !values.repo_root || !UUID.test(values.coordination_workspace_id || '') ||
      !/^[a-z0-9][a-z0-9:._/-]{2,159}$/i.test(values.repo_id || '')) {
    throw new Error('managed_project_configuration_identity_invalid');
  }
  // Relative paths are deliberately refused: the owner selects exact host roots.
  for (const field of ['userDataPath', 'repo_root', 'managed_root']) {
    if (values[field] && !path.isAbsolute(values[field])) throw new Error('managed_project_configuration_absolute_path_required');
  }
  const userDataPath = path.resolve(values.userDataPath);
  return {
    userDataPath,
    repository: {
      schema: 'metaengine.devos.managed-project-repository-config.v1',
      coordination_workspace_id: values.coordination_workspace_id.toLowerCase(),
      repo_id: values.repo_id,
      repo_root: path.resolve(values.repo_root),
      managed_root: path.resolve(values.managed_root || path.join(userDataPath, 'projects')),
    },
  };
}

export async function configureManagedProjectRepositoryCli(argv, { configure = null, write = line => process.stdout.write(`${line}\n`) } = {}) {
  const options = parseManagedProjectRepositoryArguments(argv);
  if (options.help) { write(USAGE); return { help: true }; }
  const effect = configure || (await import('../src/managed-task-project-repository.mjs')).configureManagedTaskProjectRepository;
  if (typeof effect !== 'function') throw new Error('managed_project_configuration_host_unavailable');
  const result = await effect(options);
  // Never print private roots, raw filesystem errors, or the signed bootstrap payload.
  write(JSON.stringify({ ok: true, state: 'CONFIGURED', authority_effect: false }));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  configureManagedProjectRepositoryCli(process.argv.slice(2)).catch(() => {
    process.stderr.write('managed_project_repository_configuration_failed\n');
    process.exitCode = 1;
  });
}
