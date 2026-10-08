import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only admission preflight. It deliberately DOES NOT initialize PostgreSQL,
// generate a Vault key, provision roles or write an owner configuration.
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
};
const fail = code => { throw Object.assign(new Error(code), { code }); };

function absolute(value) {
  if (typeof value !== 'string' || value.length > 2048 || !path.isAbsolute(value)
    || /^(?:\\\\|\/\/)/.test(value) || /[\x00-\x1f]/.test(value)) fail('client_first_run_absolute_local_path_required');
  return path.resolve(value);
}

// Inspect every existing component. On Windows realpath may expand a legal
// short name such as RUNNER~1, so compare *physical* paths, but reject junctions
// and symlinks along the entire existing ancestry. Missing tails remain plans,
// not permissions to create directories.
async function inspect(pathValue, expectedKind) {
  const input = absolute(pathValue);
  let current = path.parse(input).root;
  let physical = await fs.realpath(current);
  let missing = false;
  for (const segment of path.relative(current, input).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (missing) { physical = path.join(physical, segment); continue; }
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error?.code !== 'ENOENT') fail('client_first_run_path_unreadable');
      missing = true;
      physical = path.join(physical, segment);
      continue;
    }
    if (stat.isSymbolicLink()) fail('client_first_run_reparse_point_denied');
    if (!stat.isDirectory() && current !== input) fail('client_first_run_ancestor_not_directory');
    if (current === input && !(expectedKind === 'file' ? stat.isFile() && stat.nlink === 1 : stat.isDirectory())) {
      fail('client_first_run_target_type_invalid');
    }
    physical = await fs.realpath(current);
  }
  return { exists: !missing, physical: path.resolve(physical) };
}

export async function inspectClientFirstRun({
  bundleDirectory, stateDirectory, pgDataDirectory, runtimeConfigFile, ownerFile,
} = {}) {
  const [bundle, state, pgdata, config, owner, source] = await Promise.all([
    inspect(bundleDirectory, 'directory'), inspect(stateDirectory, 'directory'),
    inspect(pgDataDirectory, 'directory'), inspect(runtimeConfigFile, 'file'),
    inspect(ownerFile, 'file'), inspect(sourceRoot, 'directory'),
  ]);
  if (!bundle.exists) fail('client_first_run_bundle_missing');
  if (inside(bundle.physical, state.physical) || inside(state.physical, bundle.physical)
    || inside(source.physical, state.physical) || inside(state.physical, source.physical)
    || !inside(state.physical, pgdata.physical) || state.physical === pgdata.physical
    || !inside(state.physical, config.physical) || state.physical === config.physical
    || inside(bundle.physical, owner.physical) || inside(source.physical, owner.physical)
    || inside(state.physical, owner.physical)) {
    fail('client_first_run_private_layout_invalid');
  }
  let stateHasEntries = false;
  if (state.exists) {
    const entries = await fs.readdir(stateDirectory);
    stateHasEntries = entries.length !== 0;
  }
  const reasons = [];
  if (owner.exists) reasons.push('EXISTING_OWNER_RECONCILIATION_REQUIRED');
  if (pgdata.exists) reasons.push('EXISTING_PGDATA_RECONCILIATION_REQUIRED');
  if (config.exists) reasons.push('EXISTING_PRIVATE_CONFIG_RECONCILIATION_REQUIRED');
  if (stateHasEntries) reasons.push('EXISTING_PRIVATE_STATE_RECONCILIATION_REQUIRED');
  return Object.freeze({
    schema: 'compute.client-first-run-preflight.v1',
    state: reasons.length ? 'HOLD_EXISTING_PRIVATE_STATE' : 'PREPARATION_REVIEW_REQUIRED',
    reasons: Object.freeze(reasons),
    bundle_directory_present: true,
    local_postgres_required: true,
    hosted_fallback_allowed: false,
    pgdata_created: false,
    vault_key_created: false,
    profile_written: false,
    database_mutated: false,
    initialization_authorized: false,
    authority_effect: false,
  });
}
