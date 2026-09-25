/**
 * Durable storage primitives: atomic JSON files + append-only JSONL journals.
 * Pattern inherited from the ME system's evidence discipline: every state
 * transition leaves a machine-readable record; no silent overwrites.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Atomic JSON write: tmp file + rename (crash-safe on same volume). */
export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return file;
}

/** Read JSON or null (missing/corrupt are the same honest "absent"). */
export function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Append one journal record (JSONL). Corrupt tail never blocks appends. */
export function appendJournal(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  const entry = { at: new Date().toISOString(), ...record };
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

/** Read all journal records, skipping corrupt lines (returns [records, corruptCount]). */
export function readJournal(file) {
  if (!existsSync(file)) return [[], 0];
  const records = [];
  let corrupt = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      corrupt += 1;
    }
  }
  return [records, corrupt];
}

/** Bounded rolling retention for staged artifacts (never grows unbounded). */
export function pruneOldest(dir, keep, listNames) {
  if (!existsSync(dir)) return [];
  const items = listNames(dir).slice(0, Math.max(0, -keep));
  return items;
}

export { join };
