import fs from 'node:fs/promises';
import path from 'node:path';

import durableJson from './durable-json-file.cjs';
import { ClientGoalJournal } from './client-goal-journal.mjs';

const { durableWriteJson } = durableJson;

export const CLIENT_GOAL_JOURNAL_FILENAME = 'metaengine-client-goal-journal-v1.json';

export function clientGoalJournalStatePath(userDataPath) {
  const root = String(userDataPath || '').trim();
  if (!root) throw new Error('client_goal_journal_user_data_path_required');
  return path.join(root, CLIENT_GOAL_JOURNAL_FILENAME);
}

export function createClientGoalJournalFileStore(userDataPath, {
  maxEntries = 32, writeDurable = durableWriteJson, readFile = fs.readFile,
} = {}) {
  const target = clientGoalJournalStatePath(userDataPath);
  const journal = new ClientGoalJournal({
    loadState: async () => JSON.parse(await readFile(target, 'utf8')),
    saveState: async (snapshot) => {
      // Stable JSON payload with a unique exclusive temp path, fsync and
      // rename-readback. No task is sent unless SUBMITTING was durable.
      const payload = JSON.stringify(snapshot, null, 2) + '\n';
      const receipt = await writeDurable(target, snapshot);
      if (receipt?.contract !== 'METAENGINE_DURABLE_JSON_V1'
        || receipt.file_synced !== true || receipt.rename_committed !== true) {
        throw new Error('client_goal_journal_durable_receipt_missing');
      }
      // A nominally successful rename may still be overwritten or observed
      // only partially. Require exact bytes, otherwise fence this incarnation.
      if (await readFile(target, 'utf8') !== payload) {
        throw new Error('client_goal_journal_durable_readback_mismatch');
      }
    },
    maxEntries,
  });
  return Object.freeze({ journal, target });
}
