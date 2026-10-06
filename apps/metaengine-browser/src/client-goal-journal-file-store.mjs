import fs from 'node:fs/promises';
import path from 'node:path';

import { ClientGoalJournal } from './client-goal-journal.mjs';

export const CLIENT_GOAL_JOURNAL_FILENAME = 'metaengine-client-goal-journal-v1.json';

export function clientGoalJournalStatePath(userDataPath) {
  const root = String(userDataPath || '').trim();
  if (!root) throw new Error('client_goal_journal_user_data_path_required');
  return path.join(root, CLIENT_GOAL_JOURNAL_FILENAME);
}

export function createClientGoalJournalFileStore(userDataPath, { maxEntries = 32 } = {}) {
  const target = clientGoalJournalStatePath(userDataPath);
  const journal = new ClientGoalJournal({
    loadState: async () => JSON.parse(await fs.readFile(target, 'utf8')),
    saveState: async (snapshot) => {
      const temp = target + '.tmp';
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temp, target);
    },
    maxEntries,
  });
  return Object.freeze({ journal, target });
}
