import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeHostConfig } from './runtime-host.mjs';
import { provisionRestoredClientProvider } from './restored-client-provider.mjs';
import { LOCAL_STATE_INSTANCE_UUID, localStateProviderOwnerFile } from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

const ownerAction = 'USE_EXISTING_RESTORED_POSTGRES_17';
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = reason => { throw new Error('restored_client_cli_' + reason); };
const flags = Object.freeze({
  '--config': 'privateConfigFile',
  '--bundle-sha256': 'expectedBundleDigest',
  '--restore-receipt': 'restoreReceiptFile',
  '--restore-receipt-sha256': 'expectedRestoreReceiptSha256',
  '--appdata': 'appDataDirectory',
  '--owner-action': 'ownerAction',
});
const publicErrors = new Set([
  ...[
    'absolute_local_path_required', 'arguments_invalid', 'argument_unknown', 'argument_duplicate',
    'argument_value_required', 'arguments_required', 'explicit_owner_action_required', 'sha256_pin_required',
    'private_config_path_invalid', 'private_config_invalid', 'private_config_changed', 'private_config_json_invalid',
    'public_receipt_unconfirmed', 'bundle_pin_conflict', 'owner_file_invalid', 'public_receipt_pin_conflict',
  ].map(reason => 'restored_client_cli_' + reason),
  ...[
    'private_path_invalid', 'private_path_unavailable', 'private_path_alias_forbidden',
    'private_file_size_invalid', 'private_file_changed', 'private_json_invalid', 'database_url_invalid',
    'api_admission_unattested', 'api_admission_timeout', 'api_admission_failed', 'explicit_owner_choice_required',
    'source_pins_required', 'private_file_boundary_invalid', 'owner_file_invalid', 'owner_file_exists',
    'private_config_binding_mismatch', 'private_config_database_binding_invalid', 'existing_pg17_required',
    'existing_vault_key_required', 'existing_postmaster_state_requires_review', 'restore_receipt_pin_mismatch',
    'restore_evidence_unverified', 'host_identity_unattested', 'health_unattested', 'cleanup_unconfirmed',
    'private_input_changed', 'provisioning_failed',
  ].map(reason => 'restored_provider_' + reason),
]);

export const RESTORED_CLIENT_PROVIDER_HELP = [
  'Use an existing restored PostgreSQL 17 cluster with the local Browser.',
  'Required arguments:',
  '  --config <existing external private runtime-host v1 JSON file>',
  '  --bundle-sha256 <reviewed offline bundle SHA-256>',
  '  --restore-receipt <existing external restore report file>',
  '  --restore-receipt-sha256 <independently pinned restore report SHA-256>',
  '  --appdata <explicit owner-selected application data directory>',
  '  --owner-action USE_EXISTING_RESTORED_POSTGRES_17',
  'Credentials belong only in the private configuration file.',
  'The command verifies and stops the owned runtime before publishing a new owner profile.',
].join('\n');

function absoluteLocalPath(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || !path.isAbsolute(value)
    || /^(?:\\\\|\/\/)/.test(value) || /[\x00-\x1f]/.test(value)) fail('absolute_local_path_required');
  return path.resolve(value);
}

export function parseRestoredClientProviderArguments(argv = []) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) fail('arguments_invalid');
  if (argv.length === 1 && argv[0] === '--help') return Object.freeze({ help: true });
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = Object.hasOwn(flags, argv[index]) ? flags[argv[index]] : null;
    if (!key) fail('argument_unknown');
    if (Object.hasOwn(options, key)) fail('argument_duplicate');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('argument_value_required');
    options[key] = value;
  }
  if (Object.keys(options).length !== Object.keys(flags).length) fail('arguments_required');
  if (options.ownerAction !== ownerAction) fail('explicit_owner_action_required');
  if (!sha256(options.expectedBundleDigest) || !sha256(options.expectedRestoreReceiptSha256)) fail('sha256_pin_required');
  for (const key of ['privateConfigFile', 'restoreReceiptFile', 'appDataDirectory']) {
    options[key] = absoluteLocalPath(options[key]);
  }
  return Object.freeze({ ...options, ownerChoice: 'LOCAL_POSTGRES' });
}

async function readPrivateConfig(filename) {
  // Validate every ancestor before opening. Windows 8.3 aliases are expanded;
  // existing junctions, symlinks and hardlinked config files remain forbidden.
  let current = path.parse(filename).root;
  for (const part of path.relative(current, filename).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || (current !== filename && !info.isDirectory())) fail('private_config_path_invalid');
  }
  const physical = await fs.realpath(filename);
  const before = await fs.lstat(physical);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 16384) fail('private_config_invalid');
  const handle = await fs.open(physical, 'r');
  let content;
  try {
    const bytes = Buffer.alloc(16385);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16384) fail('private_config_invalid');
    content = bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
  const after = await fs.lstat(physical);
  if (content.length !== before.size || after.size !== before.size || after.ino !== before.ino
    || after.mtimeMs !== before.mtimeMs || after.isSymbolicLink() || after.nlink !== 1) fail('private_config_changed');
  let config;
  try { config = JSON.parse(content.toString('utf8')); } catch { fail('private_config_json_invalid'); }
  return validateRuntimeHostConfig(config);
}

function publicReceipt(receipt) {
  if (receipt?.schema !== 'compute.restored-client-provider-provisioning.v1' || receipt.state !== 'CONFIGURED'
    || receipt.provider !== 'LOCAL_POSTGRES' || receipt.existing_restored_database_selected !== true
    || receipt.source_restore_receipt_verified !== true
    || receipt.database_initialized !== false || receipt.owner_profile_written !== true
    || receipt.runtime_ready !== false || receipt.cleanup_confirmed !== true
    || receipt.private_vault_key_preserved !== true || typeof receipt.source_schema_exact !== 'boolean'
    || receipt.authority_effect !== false || !LOCAL_STATE_INSTANCE_UUID.test(String(receipt.attested_instance_id || ''))
    || !['source_dump_sha256', 'source_restore_receipt_sha256', 'bundle_sha256'].every(key => sha256(receipt[key]))) {
    fail('public_receipt_unconfirmed');
  }
  // Select only the fixed public fields even if a future implementation adds
  // private paths, URLs, credentials or configuration to its return object.
  return Object.freeze(Object.fromEntries([
    'schema', 'state', 'provider', 'existing_restored_database_selected', 'source_restore_receipt_verified', 'database_initialized',
    'owner_profile_written', 'runtime_ready', 'cleanup_confirmed', 'attested_instance_id',
    'source_dump_sha256', 'source_restore_receipt_sha256', 'bundle_sha256',
    'private_vault_key_preserved', 'source_schema_exact', 'authority_effect',
  ].map(key => [key, receipt[key]])));
}

export async function runRestoredClientProviderCli(argv, { provision = provisionRestoredClientProvider } = {}) {
  const options = parseRestoredClientProviderArguments(argv);
  if (options.help) return Object.freeze({ help: RESTORED_CLIENT_PROVIDER_HELP });
  const config = await readPrivateConfig(options.privateConfigFile);
  if (config.expected_bundle_sha256 !== options.expectedBundleDigest) fail('bundle_pin_conflict');
  const ownerFile = localStateProviderOwnerFile({ env: { APPDATA: options.appDataDirectory }, platform: 'win32' });
  if (!ownerFile) fail('owner_file_invalid');
  const receipt = await provision({
    ...options, ownerFile,
    stateDirectory: config.state_directory,
    pgDataDirectory: config.pg_data_directory,
    bundleDirectory: config.bundle_directory,
  });
  const result = publicReceipt(receipt);
  if (result.bundle_sha256 !== options.expectedBundleDigest
    || result.source_restore_receipt_sha256 !== options.expectedRestoreReceiptSha256) fail('public_receipt_pin_conflict');
  return result;
}

export function restoredClientProviderPublicError(error) {
  const message = String(error?.message || '');
  const reason = publicErrors.has(message)
    ? message : 'restored_client_cli_provisioning_failed';
  return Object.freeze({ schema: 'compute.restored-client-provider-cli-error.v1',
    state: 'BLOCKED', reason, completion_confirmed: false, authority_effect: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRestoredClientProviderCli(process.argv.slice(2)).then(
    receipt => console.log(receipt.help || JSON.stringify(receipt)),
    error => { console.error(JSON.stringify(restoredClientProviderPublicError(error))); process.exitCode = 1; },
  );
}
