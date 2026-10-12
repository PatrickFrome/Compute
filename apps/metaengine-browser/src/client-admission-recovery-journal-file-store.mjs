import fs from 'node:fs/promises';
import path from 'node:path';

import durableJson from './durable-json-file.cjs';
import { ClientAdmissionRecoveryJournal } from './client-admission-recovery-journal.mjs';

const { durableWriteJson } = durableJson;
export const CLIENT_ADMISSION_RECOVERY_JOURNAL_FILENAME = 'metaengine-client-admission-recovery-v1.json';

export function createClientAdmissionRecoveryJournalFileStore(userDataPath, {
  writeDurable = durableWriteJson, readFile = fs.readFile,
} = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new Error('client_admission_recovery_user_data_path_required');
  }
  const target = path.join(userDataPath, CLIENT_ADMISSION_RECOVERY_JOURNAL_FILENAME);
  const journal = new ClientAdmissionRecoveryJournal({
    loadState: async () => JSON.parse(await readFile(target, 'utf8')),
    saveState: async snapshot => {
      const expected = JSON.stringify(snapshot, null, 2) + '\n';
      const receipt = await writeDurable(target, snapshot);
      if (receipt?.contract !== 'METAENGINE_DURABLE_JSON_V1'
        || receipt.file_synced !== true || receipt.rename_committed !== true) {
        throw new Error('client_admission_recovery_durable_receipt_missing');
      }
      if (await readFile(target, 'utf8') !== expected) {
        throw new Error('client_admission_recovery_durable_readback_mismatch');
      }
    },
  });
  return Object.freeze({ target, journal });
}
