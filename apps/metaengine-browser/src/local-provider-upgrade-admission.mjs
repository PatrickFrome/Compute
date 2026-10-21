// A local QA upgrade has one final admission commit, separate from the
// temporary install gate. This record supplies no release/W74 authority.
import path from 'node:path';
import { createHash } from 'node:crypto';

export const QA_UPGRADE_ADMISSION_SCHEMA = 'metaengine.operator.qa-owner-admission.v1';
export const QA_UPGRADE_ADMISSION_FILE = 'installed-owner-admission.json';
const SHA = /^[a-f0-9]{64}$/;
const STATE = /^client-state-qa-upgrade-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = () => { throw new Error('local_state_provider_upgrade_admission_unverified'); };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function qaUpgradeAdmissionFile(owner) {
  const identity = owner?.runtime_identity_file, config = owner?.runtime_host?.config_file;
  if (typeof identity !== 'string' || typeof config !== 'string') return null;
  const state = path.dirname(identity), configState = path.dirname(config);
  if (![state, configState].some(directory => path.basename(directory).startsWith('client-state-qa-upgrade-'))) return null;
  if (!path.isAbsolute(identity) || !path.isAbsolute(config) || !same(state, configState)
    || !STATE.test(path.basename(state))) fail();
  return path.join(state, QA_UPGRADE_ADMISSION_FILE);
}

export function assertQaUpgradeAdmission(record, { owner, ownerBytes } = {}) {
  if (!qaUpgradeAdmissionFile(owner) || !Buffer.isBuffer(ownerBytes) || !ownerBytes.length
    || record?.schema !== QA_UPGRADE_ADMISSION_SCHEMA || record.state !== 'INSTALLED_VERIFIED'
    || record.owner_sha256 !== digest(ownerBytes)
    || !SHA.test(owner?.runtime_host?.expected_bundle_sha256 || '')
    || record.bundle_sha256 !== owner.runtime_host.expected_bundle_sha256
    || !['proof_sha256', 'completed_receipt_sha256', 'installed_asar_sha256',
      'installed_tree_sha256', 'publication_gate_sha256'].every(key => SHA.test(record[key] || ''))
    || !/^[a-f0-9]{40}$/.test(record.source_head || '')
    || !/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(record.package_version || '')
    || record.launch_allowed !== true || record.gate_retired !== true
    || record.production_authorized !== false || record.provenance_verified !== false
    || record.automatic_retry_allowed !== false || record.authority_effect !== false) fail();
  return true;
}
