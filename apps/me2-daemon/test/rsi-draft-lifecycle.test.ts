import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// This suite owns its process, SQLite and filesystem. It invokes no model,
// network service, approval API or production skill consumer.
const previous = process.cwd();
const root = mkdtempSync(join(tmpdir(), 'metaengine-rsi-draft-'));
process.chdir(root);
process.env.ME2_DATA_DIR = join(root, 'data');
process.env.ME2_CONTOUR_HOME = root;
process.env.ME2_REPO_ROOT = root;
process.env.ME2_CHAT_ROOT = join(root, 'chats');
process.env.OPENAI_API_KEY = '';
const { db } = await import('../store');
const { rsiAdopt, rsiReject, rsiRollback, rsiList } = await import('../src/rsi');
const id = 'rsi_fixtureabc';
const file = join(root, 'skills', 'rsi', `rsi-${id}-test-draft.md`);

beforeEach(() => {
  db.query('DELETE FROM rsi_proposals').run();
  rmSync(join(root, 'skills'), { recursive: true, force: true });
  db.query("INSERT INTO rsi_proposals (id,title,body_md,status,created_at) VALUES (?, 'Test draft', 'Independent evaluation required.', 'PROPOSED', ?)").run(id, Date.now());
});
afterAll(() => { db.close(); process.chdir(previous); rmSync(root, { recursive: true, force: true }); });

test('accepted drafts retain a pinned digest and cannot be counted as runtime activation or improvement', () => {
  const adopted = rsiAdopt(id);
  expect(adopted.artifact_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(readFileSync(file, 'utf8')).toContain('advisory draft');
  expect(rsiList().runtime_skill_activation).toBe(false);
  expect(rsiList().verified_improvement_count).toBe(0);
  expect(() => rsiReject(id)).toThrow('invalid_state_ADOPTED');
  expect(rsiRollback(id).status).toBe('ROLLED_BACK');
  expect(existsSync(file)).toBe(false);
  expect(() => rsiRollback(id)).toThrow('invalid_state_ROLLED_BACK');
});

test('rollback preserves edited content and the original adopted state', () => {
  rsiAdopt(id);
  writeFileSync(file, 'operator edits');
  expect(() => rsiRollback(id)).toThrow('rsi_rollback_artifact_changed');
  expect(readFileSync(file, 'utf8')).toBe('operator edits');
  expect(rsiList().proposals[0].status).toBe('ADOPTED');
});

test('an arbitrary database artifact path cannot cause deletion outside the owned draft directory', () => {
  rsiAdopt(id);
  const outside = join(root, 'user-content.md');
  writeFileSync(outside, 'preserve');
  db.query('UPDATE rsi_proposals SET artifact=? WHERE id=?').run(outside, id);
  expect(() => rsiRollback(id)).toThrow('rsi_rollback_owned_digest_required');
  expect(readFileSync(outside, 'utf8')).toBe('preserve');
});

test('pre-existing unrelated files are never overwritten', () => {
  mkdirSync(join(root, 'skills', 'rsi'), { recursive: true });
  writeFileSync(file, 'existing draft');
  expect(() => rsiAdopt(id)).toThrow('rsi_artifact_existing_content_mismatch');
  expect(readFileSync(file, 'utf8')).toBe('existing draft');
  expect(rsiList().proposals[0].status).toBe('PROPOSED');
});

test('a crash after the exact immutable file write can reconcile without overwriting or repeating effects', () => {
  const adopted = rsiAdopt(id);
  db.query("UPDATE rsi_proposals SET status='PROPOSED', artifact=NULL, artifact_sha256=NULL WHERE id=?").run(id);
  const reconciled = rsiAdopt(id);
  expect(reconciled.artifact_sha256).toBe(adopted.artifact_sha256);
  expect(rsiList().artifacts).toBe(1);
});

test('a symlink cannot redirect adopted draft effects outside the owned directory', () => {
  const outside = join(root, 'external');
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(root, 'skills'), { recursive: true });
  symlinkSync(outside, join(root, 'skills', 'rsi'), 'dir');
  expect(() => rsiAdopt(id)).toThrow('rsi_artifact_directory_not_owned');
  expect(existsSync(join(outside, `rsi-${id}-test-draft.md`))).toBe(false);
});
