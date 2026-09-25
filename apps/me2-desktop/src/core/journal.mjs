/**
 * Core lifecycle journal — the desktop's own evidence discipline.
 * Boot, plane results, window events, exit: every record is durable JSONL in
 * userData, readable by the operator and by verify-installed-bundle.
 */
import { appendJournal, readJournal } from '../shared/durable-file.mjs';
import { join } from 'node:path';

export class LifecycleJournal {
  constructor({ userDataDir, name = 'me2-desktop-lifecycle.jsonl' }) {
    this.file = join(userDataDir, name);
  }

  record(event, details = {}) {
    return appendJournal(this.file, { event, ...details });
  }

  history() {
    const [records, corrupt] = readJournal(this.file);
    return { records, corrupt };
  }
}
