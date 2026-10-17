import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

// Use the production SQL and control flow with a real private SQLite database.
// Importing commands.ts would also bootstrap the Bun store and provider graph.
const source = stripTypeScriptTypes(readFileSync(new URL('../commands.ts', import.meta.url), 'utf8'), { mode: 'strip' });
function productionFunction(name) {
  const start = source.indexOf(`export function ${name}(`) >= 0
    ? source.indexOf(`export function ${name}(`)
    : source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name}: production function missing`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next < 0 ? source.length : next).replace(/^export /, '');
}

function fixture(t, { failEvent = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE commands (id TEXT PRIMARY KEY, action TEXT, lane TEXT, status TEXT,
      payload TEXT, result TEXT, idempotency_key TEXT, cost INTEGER,
      run_after INTEGER, created_at TEXT, leased_at TEXT, completed_at TEXT, error TEXT);
    CREATE TABLE events (type TEXT, payload TEXT);
    CREATE TABLE effects (command_id TEXT, ordinal INTEGER);
  `);
  const db = {
    query: (sql) => sqlite.prepare(sql),
    transaction: (fn) => () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = fn(); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const emit = (type, payload) => {
    if (failEvent) throw new Error('event_write_failed');
    sqlite.prepare('INSERT INTO events VALUES (?,?)').run(type, JSON.stringify(payload));
  };
  const reconcile = new Function('db', 'emit', `${productionFunction('reconcileOrphanRunningCommands')}; return reconcileOrphanRunningCommands;`)(db, emit);
  const claim = new Function('db', 'nowIso', `${productionFunction('claimCommand')}; return claimCommand;`)(db, () => new Date().toISOString());
  const run = async (command) => {
    sqlite.prepare('INSERT INTO effects VALUES (?,?)').run(command.id, 2);
    sqlite.prepare("UPDATE commands SET status='COMPLETED' WHERE id=?").run(command.id);
  };
  const drain = new Function('db', 'claimCommand', 'runCommand', `${productionFunction('drainCommands')}; return drainCommands;`)(db, claim, run);
  const add = (id, status = 'RUNNING') => sqlite.prepare(`INSERT INTO commands VALUES
    (?, 'TASK_ENQUEUE', 'MUTATION', ?, '{"title":"persisted effect"}', 'partial-result',
     ?, 3, NULL, '2026-10-17T19:00:00Z', '2026-10-17T19:00:01Z', NULL, 'previous-evidence')`)
    .run(id, status, `dedup:${id}`);
  return { sqlite, reconcile, drain, add };
}

test('a committed effect followed by a crash is fenced instead of replayed after restart', async (t) => {
  const { sqlite, reconcile, drain, add } = fixture(t);
  add('lost-ack');
  sqlite.prepare('INSERT INTO effects VALUES (?,?)').run('lost-ack', 1);
  const before = { ...sqlite.prepare('SELECT * FROM commands WHERE id=?').get('lost-ack') };
  assert.deepEqual(reconcile(), { ambiguous: 1, automatic_retry_allowed: false });
  const after = { ...sqlite.prepare('SELECT * FROM commands WHERE id=?').get('lost-ack') };
  assert.deepEqual(after, { ...before, status: 'AMBIGUOUS' });
  assert.equal(await drain(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM effects').get().n, 1);
  const event = sqlite.prepare('SELECT * FROM events').get();
  assert.equal(event.type, 'COMMAND_EFFECT_UNKNOWN');
  const payload = JSON.parse(event.payload);
  assert.equal(payload.id, 'lost-ack');
  assert.equal(payload.automatic_retry_allowed, false);
});

test('repeated restart reconciliation leaves ambiguous evidence unchanged', (t) => {
  const { sqlite, reconcile, add } = fixture(t);
  add('orphan');
  reconcile();
  const row = { ...sqlite.prepare('SELECT * FROM commands').get() };
  assert.deepEqual(reconcile(), { ambiguous: 0, automatic_retry_allowed: false });
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM commands').get() }, row);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
});

test('pending work continues once while completed and failed receipts remain unchanged', async (t) => {
  const { sqlite, reconcile, drain, add } = fixture(t);
  add('pending', 'PENDING');
  add('done', 'COMPLETED');
  add('failed', 'FAILED');
  add('ambiguous', 'AMBIGUOUS');
  const terminal = sqlite.prepare("SELECT * FROM commands WHERE status<>'PENDING' ORDER BY id").all().map((row) => ({ ...row }));
  assert.deepEqual(reconcile(), { ambiguous: 0, automatic_retry_allowed: false });
  assert.equal(await drain(), 1);
  assert.equal(await drain(), 0);
  assert.deepEqual(sqlite.prepare("SELECT * FROM commands WHERE id<>'pending' ORDER BY id").all().map((row) => ({ ...row })), terminal);
  assert.deepEqual(sqlite.prepare('SELECT * FROM effects').all().map((row) => ({ ...row })), [{ command_id: 'pending', ordinal: 2 }]);
});

test('failed durable event publication rolls back the recovery classification', (t) => {
  const { sqlite, reconcile, add } = fixture(t, { failEvent: true });
  add('event-failure');
  const before = { ...sqlite.prepare('SELECT * FROM commands').get() };
  assert.throws(() => reconcile(), /event_write_failed/);
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM commands').get() }, before);
});
